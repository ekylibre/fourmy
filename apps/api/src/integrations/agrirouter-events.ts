import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { AgrirouterClient, AgrirouterEvent } from "@fourmy/agrirouter";
import { decryptSecret } from "../secrets.js";
import { completeAgrirouterConnect, recipientsFrom, stateHash, tenantHash, type AgrirouterSettings } from "./agrirouter.js";

/**
 * agrirouter, lot AR2 (claudedocs/conception_agrirouter.md §5) : événements
 * du flux `GET /events`. L'écouteur ne fait qu'enregistrer : fichier rangé
 * sur le volume, ligne dans la boîte de réception, état de la connexion. La
 * confirmation à agrirouter est une tâche du worker, rejouable.
 */

type Log = (message: string) => void;
const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

// --- Fichiers reçus ------------------------------------------------------------

/** Volume des fichiers agrirouter (monté dans l'API et le worker en production). */
export const agrirouterFilesConfig = { dir: resolve(process.env.FOURMY_AGRIROUTER_FILES_DIR ?? ".cache/agrirouter") };

const filePath = (sha256: string) => join(agrirouterFilesConfig.dir, sha256.slice(0, 2), sha256);

/** Range un contenu par son empreinte (écriture atomique, sans doublon) ; renvoie l'empreinte. */
export async function storeAgrirouterFile(bytes: Uint8Array): Promise<string> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = filePath(sha256);
  const exists = await stat(path).then(
    (s) => s.size === bytes.byteLength,
    () => false,
  );
  if (!exists) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, path);
  }
  return sha256;
}

export const readAgrirouterFile = (sha256: string) => readFile(filePath(sha256));

// --- Résolution des fermes (fonctions SECURITY DEFINER, identifiants seulement) --

type Resolver = "fourmy_agrirouter_farm_by_endpoint" | "fourmy_agrirouter_farm_by_external" | "fourmy_agrirouter_farms_by_tenant" | "fourmy_agrirouter_farm_by_state";

async function farmsBy(db: Database, fn: Resolver, value: string): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    const found = await rows<{ farm_id: string }>(tx, sql`SELECT farm_id FROM ${sql.raw(fn)}(${value})`);
    return found.map((r) => r.farm_id);
  });
}

// --- Connexion défaite ---------------------------------------------------------

/**
 * Connexion défaite dans agrirouter (autorisation retirée, point de
 * terminaison supprimé) : « déconnectée », sans secret, avec date et motif.
 * Avec `externalId`, seulement si c'est toujours le point de terminaison de la
 * ferme (une reconnexion entre-temps l'emporte).
 */
export async function markAgrirouterDisconnected(
  db: Database,
  farmId: string,
  reason: "revoked" | "endpoint_deleted",
  message: string,
  externalId?: string,
): Promise<boolean> {
  const marks = JSON.stringify({ disconnectedAt: new Date().toISOString(), disconnectReason: reason });
  const updated = await withFarm(db, farmId, (tx) =>
    rows(
      tx,
      sql`
        UPDATE integrations SET status = 'disconnected', secret_ciphertext = NULL, last_error = ${message},
          settings = settings || ${marks}::jsonb, updated_at = now()
        WHERE provider = 'agrirouter' AND secret_ciphertext IS NOT NULL
          AND (${externalId ?? null}::text IS NULL OR settings->>'externalId' = ${externalId ?? null}::text)
        RETURNING id`,
    ),
  );
  return updated.length > 0;
}

// --- Traitement d'un événement -----------------------------------------------

type Received = Extract<AgrirouterEvent, { type: "MESSAGE_RECEIVED" | "FILE_RECEIVED" }>;

/** Enregistre un message reçu (une fois, même redélivré) ; confirme sans stocker s'il ne concerne aucune ferme. */
async function receive(db: Database, client: AgrirouterClient, e: Received, log: Log): Promise<void> {
  const messageIds = e.type === "MESSAGE_RECEIVED" ? [e.id] : e.message_ids;
  if (!messageIds.length) return;
  const [farmId] = await farmsBy(db, "fourmy_agrirouter_farm_by_endpoint", e.receiving_endpoint_id);
  if (!farmId) {
    // Point de terminaison retiré de Fourmy entre-temps : on vide la file d'agrirouter.
    if (e.tenant_id) await client.confirm(e.tenant_id, messageIds.map((messageId) => ({ messageId, endpointId: e.receiving_endpoint_id })));
    log(`message pour un point de terminaison inconnu (${e.receiving_endpoint_id.slice(0, 8)}) : confirmé sans être gardé`);
    return;
  }
  const [known] = await withFarm(db, farmId, (tx) => rows(tx, sql`SELECT 1 FROM agrirouter_inbox WHERE message_ids[1] = ${messageIds[0]!}`));
  if (known) return; // redélivraison : la confirmation est à faire, ou déjà faite
  const bytes = await client.payload(e);
  const sha256 = await storeAgrirouterFile(bytes);
  await withFarm(db, farmId, (tx) =>
    tx.execute(sql`
      INSERT INTO agrirouter_inbox (id, farm_id, endpoint_id, message_ids, message_type, filename, size,
        sender_endpoint_id, teamset_context_id, sent_at, file_sha256)
      VALUES (${randomUUID()}, ${farmId}, ${e.receiving_endpoint_id}, ${`{${messageIds.join(",")}}`}::text[], ${e.message_type},
        ${e.filename ?? null}, ${bytes.byteLength}, ${e.sending_endpoint_id ?? null}, ${e.teamset_context_id ?? null},
        ${e.sent_at ?? null}::timestamptz, ${sha256})
      ON CONFLICT DO NOTHING`),
  );
  log(`ferme ${farmId.slice(0, 8)} : ${e.message_type} reçu (${bytes.byteLength} octets)`);
}

/** Traite un événement du flux. Une erreur ne concerne que cet événement. */
export async function handleAgrirouterEvent(db: Database, client: AgrirouterClient, e: AgrirouterEvent, log: Log = () => {}): Promise<void> {
  switch (e.type) {
    case "MESSAGE_RECEIVED":
    case "FILE_RECEIVED":
      return receive(db, client, e, log);
    case "ENDPOINT_DELETED":
      for (const farmId of await farmsBy(db, "fourmy_agrirouter_farm_by_external", e.external_id)) {
        if (await markAgrirouterDisconnected(db, farmId, "endpoint_deleted", "Le point de terminaison de Fourmy a été supprimé dans agrirouter.", e.external_id)) {
          log(`ferme ${farmId.slice(0, 8)} : point de terminaison supprimé dans agrirouter`);
        }
      }
      return;
    case "AUTHORIZATION_REVOKED":
      for (const farmId of await farmsBy(db, "fourmy_agrirouter_farms_by_tenant", tenantHash(e.tenant_id))) {
        if (await markAgrirouterDisconnected(db, farmId, "revoked", "L'autorisation de Fourmy a été retirée dans agrirouter.")) {
          log(`ferme ${farmId.slice(0, 8)} : autorisation retirée dans agrirouter`);
        }
      }
      return;
    case "AUTHORIZATION_ADDED": {
      // Filet de sécurité : le navigateur n'est pas revenu sur Fourmy (onglet fermé).
      if (!e.state || !e.tenant?.tenant_id) return;
      const [farmId] = await farmsBy(db, "fourmy_agrirouter_farm_by_state", stateHash(e.state));
      if (!farmId) return;
      await completeAgrirouterConnect(db, farmId, { state: e.state, tenantId: e.tenant.tenant_id });
      log(`ferme ${farmId.slice(0, 8)} : connexion terminée depuis l'événement d'autorisation`);
      return;
    }
    case "ENDPOINTS_LIST_CHANGED":
      for (const farmId of await farmsBy(db, "fourmy_agrirouter_farms_by_tenant", tenantHash(e.tenant_id))) {
        await withFarm(db, farmId, async (tx) => {
          const [row] = await rows<{ settings: AgrirouterSettings; last_report: Record<string, unknown> | null }>(
            tx,
            sql`SELECT settings, last_report FROM integrations WHERE provider = 'agrirouter' AND secret_ciphertext IS NOT NULL`,
          );
          if (!row?.settings.endpointId) return;
          const report = { ...(row.last_report ?? {}), recipients: recipientsFrom(e.endpoints, row.settings.endpointId) };
          await tx.execute(sql`UPDATE integrations SET last_report = ${JSON.stringify(report)}::jsonb, updated_at = now() WHERE provider = 'agrirouter'`);
        });
      }
      return;
    case "UNKNOWN":
      log(`événement ignoré : ${e.event}`);
      return;
  }
}

// --- Confirmations (worker) ---------------------------------------------------

/** Au-delà, la confirmation n'est plus retentée (motif gardé sur la ligne). */
const MAX_CONFIRM_ATTEMPTS = 20;

/**
 * Confirme à agrirouter les fichiers rangés dans la boîte de réception : ils
 * quittent la file du point de terminaison (compteur à 0 dans agrirouter).
 * Lot AR2 : un fichier est « traité » dès qu'il est rangé ; sa lecture
 * (AR4, AR5) se fait depuis le volume.
 */
export async function confirmAgrirouterInbox(db: Database, client: AgrirouterClient): Promise<{ confirmed: number; failed: number }> {
  const farms = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    return rows<{ farm_id: string }>(tx, sql`SELECT farm_id FROM fourmy_agrirouter_unconfirmed_farms()`);
  });
  let confirmed = 0;
  let failed = 0;
  for (const { farm_id: farmId } of farms) {
    const pending = await withFarm(db, farmId, async (tx) => {
      const [integration] = await rows<{ secret_ciphertext: string | null }>(tx, sql`SELECT secret_ciphertext FROM integrations WHERE provider = 'agrirouter'`);
      if (!integration?.secret_ciphertext) return null; // ferme déconnectée : plus rien à confirmer chez agrirouter
      const items = await rows<{ id: string; endpoint_id: string; message_ids: string[] }>(
        tx,
        sql`SELECT id, endpoint_id, message_ids FROM agrirouter_inbox
            WHERE confirmed_at IS NULL AND confirm_attempts < ${MAX_CONFIRM_ATTEMPTS} ORDER BY received_at LIMIT 100`,
      );
      return { tenantId: decryptSecret(integration.secret_ciphertext), items };
    });
    if (!pending?.items.length) continue;
    const ids = pending.items.map((i) => i.id);
    const idList = `{${ids.join(",")}}`;
    try {
      await client.confirm(
        pending.tenantId,
        pending.items.flatMap((i) => i.message_ids.map((messageId) => ({ messageId, endpointId: i.endpoint_id }))),
      );
      await withFarm(db, farmId, (tx) =>
        tx.execute(sql`UPDATE agrirouter_inbox SET confirmed_at = now(), confirm_error = NULL WHERE id = ANY(${idList}::uuid[])`),
      );
      confirmed += ids.length;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await withFarm(db, farmId, (tx) =>
        tx.execute(sql`UPDATE agrirouter_inbox SET confirm_attempts = confirm_attempts + 1, confirm_error = ${message} WHERE id = ANY(${idList}::uuid[])`),
      );
      failed += ids.length;
    }
  }
  return { confirmed, failed };
}

// --- Écouteur permanent (worker) -----------------------------------------------

export interface ListenerOptions {
  db: Database;
  databaseUrl: string;
  client: () => AgrirouterClient;
  signal: AbortSignal;
  log?: Log;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Attente quand un autre worker tient déjà l'écoute. */
  lockRetryMs?: number;
}

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), done()), { once: true });
  });

/**
 * Écoute le flux `/events` tant que `signal` n'est pas levé. Une seule
 * instance écoute, tous workers confondus : verrou consultatif PostgreSQL tenu
 * par une connexion dédiée (libéré si le worker meurt). Reconnexion avec une
 * attente croissante (1 s à 60 s), remise à 1 s dès qu'un événement arrive.
 */
export async function runAgrirouterListener(opts: ListenerOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  const sleep = opts.sleep ?? abortableSleep;
  const lock = postgres(opts.databaseUrl, { max: 1, onnotice: () => {} });
  let holding = false;
  try {
    while (!opts.signal.aborted) {
      if (!holding) {
        // Base indisponible : on réessaie plus tard, sans arrêter l'écoute pour de bon.
        const r = await lock<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('fourmy:agrirouter:events')) AS ok`.then(
          ([row]) => row,
          (err: unknown) => (log(`verrou d'écoute : ${err instanceof Error ? err.message : String(err)}`), undefined),
        );
        holding = !!r?.ok;
        if (!holding) {
          await sleep(opts.lockRetryMs ?? 60_000, opts.signal);
          continue;
        }
        log("écoute des événements agrirouter");
      }
      let backoff = 1000;
      while (!opts.signal.aborted) {
        try {
          // Un client par connexion : son jeton sert au flux et aux téléchargements.
          const client = opts.client();
          for await (const e of client.events(opts.signal)) {
            backoff = 1000;
            await handleAgrirouterEvent(opts.db, client, e, log).catch((err: unknown) =>
              log(`événement ${e.type} : ${err instanceof Error ? err.message : String(err)}`),
            );
          }
          if (!opts.signal.aborted) log("flux agrirouter fermé, reconnexion");
        } catch (err) {
          if (opts.signal.aborted) break;
          log(`flux agrirouter interrompu : ${err instanceof Error ? err.message : String(err)}`);
        }
        await sleep(backoff, opts.signal);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  } finally {
    if (holding) await lock`SELECT pg_advisory_unlock(hashtext('fourmy:agrirouter:events'))`.catch(() => undefined);
    await lock.end({ timeout: 5 });
  }
}
