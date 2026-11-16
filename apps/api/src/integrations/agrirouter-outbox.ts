import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { sendFailure } from "@fourmy/agrirouter";
import { decryptSecret } from "../secrets.js";
import { agrirouterClient, agrirouterConfig, type AgrirouterSettings } from "./agrirouter.js";
import { readAgrirouterFile } from "./agrirouter-events.js";

/**
 * agrirouter, lot AR3 (claudedocs/conception_agrirouter.md §6) : file
 * d'envoi. L'API met l'envoi en file et le tente aussitôt ; ce qui n'a pas
 * pu partir parce que la connexion est coupée est repris par le worker.
 * Jamais de renvoi après un 200 : agrirouter ne dédoublonne pas.
 */

/** Attentes entre deux tentatives (minutes), puis toutes les heures. */
export const RETRY_DELAYS_MIN = [1, 2, 5, 15, 30, 60];
/** Au-delà, l'envoi est abandonné. */
export const GIVE_UP_MS = 24 * 3_600_000;
/** Durée de prise en charge d'un envoi (un processus mort la laisse expirer). */
const LOCK = "2 minutes";

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
const pgTextArray = (values: string[]) => `{${values.map((v) => `"${v.replace(/["\\]/g, "\\$&")}"`).join(",")}}`;

export type OutboxState = "queued" | "sent" | "partial" | "failed";
export interface OutboxOutcome {
  state: OutboxState;
  error: string | null;
  nextAttemptAt: string | null;
}

/** État d'un envoi de carte d'après celui de la file. */
const SEND_STATUS: Record<OutboxState, "queued" | "sent" | "partial" | "error"> = { queued: "queued", sent: "sent", partial: "partial", failed: "error" };

/**
 * Met un fichier en file. `claimed` : l'appelant le tente tout de suite
 * (ligne prise en charge, première tentative comptée).
 */
export async function enqueueAgrirouterSend(
  tx: Tx,
  e: { farmId: string; prescriptionSendId: string | null; messageType: string; filename: string; recipients: string[]; fileSha256: string; claimed: boolean },
): Promise<string> {
  const id = randomUUID();
  await tx.execute(sql`
    INSERT INTO agrirouter_outbox (id, farm_id, prescription_send_id, message_type, filename, recipients, file_sha256, state, attempts, locked_until)
    VALUES (${id}, ${e.farmId}, ${e.prescriptionSendId}, ${e.messageType}, ${e.filename}, ${pgTextArray(e.recipients)}::text[], ${e.fileSha256},
      ${e.claimed ? "sending" : "queued"}, ${e.claimed ? 1 : 0}, ${e.claimed ? sql`now() + ${LOCK}::interval` : null})`);
  return id;
}

/** Enregistre l'issue d'une tentative, dans la file et dans l'historique de la carte. */
async function finish(tx: Tx, id: string, o: OutboxOutcome): Promise<void> {
  const [row] = await rows<{ prescription_send_id: string | null }>(
    tx,
    sql`UPDATE agrirouter_outbox SET state = ${o.state}, last_error = ${o.error}, locked_until = NULL,
          next_attempt_at = coalesce(${o.nextAttemptAt}::timestamptz, next_attempt_at),
          sent_at = CASE WHEN ${o.state} = 'sent' THEN now() ELSE sent_at END
        WHERE id = ${id} RETURNING prescription_send_id`,
  );
  if (row?.prescription_send_id) {
    await tx.execute(sql`
      UPDATE prescription_sends SET status = ${SEND_STATUS[o.state]}, error = ${o.error},
        next_attempt_at = ${o.state === "queued" ? o.nextAttemptAt : null}::timestamptz
      WHERE id = ${row.prescription_send_id}`);
  }
}

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/**
 * Tente un envoi déjà pris en charge (état `sending`). Lit le compte
 * agrirouter de la ferme au moment de l'envoi : une ferme déconnectée entre
 * la mise en file et l'envoi fait échouer l'envoi, sans renvoi.
 */
export async function deliverAgrirouterSend(db: Database, farmId: string, id: string, now = () => Date.now()): Promise<OutboxOutcome> {
  const loaded = await withFarm(db, farmId, async (tx) => {
    const [o] = await rows<{ message_type: string; filename: string; recipients: string[]; file_sha256: string; attempts: number; created_at: Date | string; state: string }>(
      tx,
      sql`SELECT message_type, filename, recipients, file_sha256, attempts, created_at, state FROM agrirouter_outbox WHERE id = ${id}`,
    );
    const [i] = await rows<{ settings: AgrirouterSettings; secret_ciphertext: string | null; enabled: boolean }>(
      tx,
      sql`SELECT settings, secret_ciphertext, enabled FROM integrations WHERE provider = 'agrirouter'`,
    );
    return { o, i };
  });
  const { o, i } = loaded;
  if (!o || o.state !== "sending") return { state: "failed", error: "Envoi introuvable ou déjà traité.", nextAttemptAt: null };

  const conclude = (outcome: OutboxOutcome) => withFarm(db, farmId, (tx) => finish(tx, id, outcome)).then(() => outcome);
  if (!i?.secret_ciphertext || !i.settings.endpointId || !i.enabled) {
    return conclude({ state: "failed", error: "Ferme déconnectée d'agrirouter : reconnectez-la, puis renvoyez la carte.", nextAttemptAt: null });
  }
  if (!agrirouterConfig()) return conclude({ state: "failed", error: "agrirouter n'est plus configuré sur ce serveur.", nextAttemptAt: null });
  const payload = await readAgrirouterFile(o.file_sha256).catch(() => null);
  if (!payload) return conclude({ state: "failed", error: "Fichier de l'envoi introuvable sur le serveur.", nextAttemptAt: null });

  try {
    await agrirouterClient().sendFile(decryptSecret(i.secret_ciphertext), {
      senderEndpointId: i.settings.endpointId,
      messageType: o.message_type,
      recipients: o.recipients,
      filename: o.filename,
      payload: new Uint8Array(payload),
    });
    return conclude({ state: "sent", error: null, nextAttemptAt: null });
  } catch (e) {
    const kind = sendFailure(e, o.recipients.length);
    if (kind === "partial") {
      return conclude({ state: "partial", error: `Livraison peut-être partielle, non renvoyée : ${short(e)}`, nextAttemptAt: null });
    }
    if (kind === "failed") return conclude({ state: "failed", error: short(e), nextAttemptAt: null });
    if (now() - new Date(o.created_at).getTime() >= GIVE_UP_MS) {
      return conclude({ state: "failed", error: `agrirouter injoignable depuis 24 h : ${short(e)}`, nextAttemptAt: null });
    }
    const delay = RETRY_DELAYS_MIN[Math.min(o.attempts - 1, RETRY_DELAYS_MIN.length - 1)]!;
    return conclude({ state: "queued", error: `En attente : ${short(e)}`, nextAttemptAt: new Date(now() + delay * 60_000).toISOString() });
  }
}

/** Worker : reprend les envois dus (ou abandonnés par un processus mort), au plus `max` par tour ; `farmId` : une seule ferme (tests). */
export async function drainAgrirouterOutbox(db: Database, max = 20, farmId: string | null = null): Promise<Record<OutboxState, number>> {
  const counts: Record<OutboxState, number> = { queued: 0, sent: 0, partial: 0, failed: 0 };
  for (let n = 0; n < max; n++) {
    const [claimed] = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
      return rows<{ id: string; farm_id: string }>(tx, sql`SELECT * FROM fourmy_agrirouter_claim_outbox(${LOCK}::interval, ${farmId}::uuid)`);
    });
    if (!claimed) break;
    const outcome = await deliverAgrirouterSend(db, claimed.farm_id, claimed.id).catch(
      (e: unknown): OutboxOutcome => ({ state: "queued", error: short(e), nextAttemptAt: null }),
    );
    counts[outcome.state]++;
  }
  return counts;
}
