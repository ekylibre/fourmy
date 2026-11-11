import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  INTEGRATION_PROVIDERS,
  type Integration,
  type IntegrationProvider,
  type IntegrationWrite,
} from "@fourmy/contracts";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";
import { decryptSecret, encryptSecret, secretHint } from "../secrets.js";
import { PROVIDERS } from "./providers.js";

/**
 * Intégrations d'une ferme : configuration (secret chiffré, jamais renvoyé),
 * test avant enregistrement, synchronisation verrouillée (une seule à la fois
 * par intégration), état et dernier rapport.
 */

type Row = {
  id: string;
  provider: IntegrationProvider;
  settings: Record<string, string>;
  secret_ciphertext: string | null;
  secret_hint: string | null;
  enabled: boolean;
  status: Integration["status"];
  running_since: string | Date | null;
  last_sync_at: string | Date | null;
  last_error: string | null;
  last_report: Record<string, unknown> | null;
};

const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());
const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

function view(r: Row): Integration {
  return {
    id: r.id,
    provider: r.provider,
    settings: r.settings ?? {},
    hasSecret: r.secret_ciphertext !== null,
    secretHint: r.secret_hint,
    enabled: r.enabled,
    status: r.status,
    running: r.running_since !== null && Date.now() - new Date(r.running_since).getTime() < 30 * 60_000,
    lastSyncAt: iso(r.last_sync_at),
    lastError: r.last_error,
    lastReport: r.last_report,
  };
}

const definition = (provider: IntegrationProvider) => {
  const def = INTEGRATION_PROVIDERS.find((p) => p.provider === provider);
  if (!def) throw new NotFound(`Intégration inconnue : ${provider}`);
  return def;
};

/** Message d'erreur sûr à stocker et afficher (jamais le secret). */
function safeMessage(e: unknown, secret?: string): string {
  const message = e instanceof Error ? e.message : String(e);
  return (secret ? message.split(secret).join("•••") : message).slice(0, 500);
}

async function equipments(tx: Tx) {
  return rows<{ id: string; name: string }>(tx, sql`SELECT id, name FROM equipments`);
}

export async function listIntegrations(db: Database, farmId: string): Promise<Integration[]> {
  return withFarm(db, farmId, async (tx) =>
    (await rows<Row>(tx, sql`SELECT * FROM integrations ORDER BY provider`)).map(view),
  );
}

/**
 * Crée ou met à jour l'intégration d'un fournisseur. Toute configuration
 * active est **testée avant d'être enregistrée** : un jeton refusé ou une
 * adresse injoignable n'est pas sauvegardé.
 */
export async function configureIntegration(
  db: Database,
  farmId: string,
  provider: IntegrationProvider,
  input: IntegrationWrite,
): Promise<{ integration: Integration; test: Record<string, unknown> | null }> {
  const def = definition(provider);
  if (def.connect === "oauth") {
    // Seule la désactivation passe par ce formulaire ; la connexion se fait par consentement.
    const [row] = await withFarm(db, farmId, (tx) => rows<Row>(tx, sql`SELECT * FROM integrations WHERE provider = ${provider}`));
    if (!row?.secret_ciphertext || input.enabled === undefined) throw new BadRequest(`${def.label} : utilisez le bouton « Connecter ».`);
    const [updated] = await withFarm(db, farmId, (tx) =>
      rows<Row>(tx, sql`UPDATE integrations SET enabled = ${input.enabled!}, updated_at = now() WHERE id = ${row.id} RETURNING *`),
    );
    return { integration: view(updated!), test: null };
  }
  const [existing] = await withFarm(db, farmId, (tx) =>
    rows<Row>(tx, sql`SELECT * FROM integrations WHERE provider = ${provider}`),
  );

  const settings: Record<string, string> = {};
  for (const field of def.fields.filter((f) => f.kind !== "secret")) {
    const value = input.settings[field.key] ?? existing?.settings?.[field.key] ?? "";
    if (field.required && !value) throw new BadRequest(`${field.label} : requis.`);
    if (value) settings[field.key] = value;
  }
  const secret = input.secret ?? (existing?.secret_ciphertext ? decryptSecret(existing.secret_ciphertext) : undefined);
  if (!secret) throw new BadRequest(`${def.fields.find((f) => f.kind === "secret")?.label ?? "Secret"} : requis.`);
  const enabled = input.enabled ?? existing?.enabled ?? true;

  let test: Record<string, unknown> | null = null;
  if (enabled) {
    const equipmentList = await withFarm(db, farmId, equipments);
    try {
      test = await PROVIDERS[provider].test({ farmId, settings, secret, equipments: equipmentList });
    } catch (e) {
      if (e instanceof BadRequest) throw e;
      throw new BadRequest(`Connexion impossible : ${safeMessage(e, secret)}`);
    }
  }

  const integration = await withFarm(db, farmId, async (tx) => {
    const ciphertext = input.secret ? encryptSecret(input.secret) : existing?.secret_ciphertext ?? null;
    const hint = input.secret ? secretHint(input.secret) : existing?.secret_hint ?? null;
    const [row] = await rows<Row>(
      tx,
      sql`
        INSERT INTO integrations (id, farm_id, provider, settings, secret_ciphertext, secret_hint, enabled, status, last_error)
        VALUES (${existing?.id ?? crypto.randomUUID()}, ${farmId}, ${provider}, ${JSON.stringify(settings)}::jsonb,
                ${ciphertext}, ${hint}, ${enabled}, 'pending', NULL)
        ON CONFLICT (farm_id, provider) DO UPDATE SET
          settings = excluded.settings, secret_ciphertext = excluded.secret_ciphertext,
          secret_hint = excluded.secret_hint, enabled = excluded.enabled,
          status = 'pending', last_error = NULL, updated_at = now()
        RETURNING *`,
    );
    return view(row!);
  });
  return { integration, test };
}

/**
 * Retire une intégration. Si le fournisseur sait défaire la connexion de son
 * côté (agrirouter), il est appelé d'abord ; un échec n'empêche pas le retrait
 * dans Fourmy (l'exploitant peut aussi retirer l'accès chez le fournisseur).
 */
export async function removeIntegration(db: Database, farmId: string, id: string): Promise<{ remoteError: string | null }> {
  const [row] = await withFarm(db, farmId, (tx) => rows<Row>(tx, sql`SELECT * FROM integrations WHERE id = ${id}`));
  if (!row) throw new NotFound("Intégration introuvable.");
  let remoteError: string | null = null;
  const disconnect = PROVIDERS[row.provider].disconnect;
  if (disconnect && row.secret_ciphertext) {
    let secret: string | undefined;
    try {
      secret = decryptSecret(row.secret_ciphertext);
      await disconnect({ farmId, settings: row.settings, secret, equipments: [] });
    } catch (e) {
      remoteError = safeMessage(e, secret);
    }
  }
  await withFarm(db, farmId, async (tx) => {
    const removed = await rows(tx, sql`DELETE FROM integrations WHERE id = ${id} RETURNING id`);
    if (removed.length === 0) throw new NotFound("Intégration introuvable.");
  });
  return { remoteError };
}

/**
 * Synchronise une intégration. Verrou : la prise en charge pose
 * `running_since` atomiquement (un verrou de plus de 30 min est considéré
 * abandonné) ; une seconde demande pendant la synchro reçoit Conflict.
 */
export async function syncIntegration(db: Database, farmId: string, id: string): Promise<Integration> {
  const targetUrl = process.env.DATABASE_URL;
  if (!targetUrl) throw new Error("DATABASE_URL manquant");
  const claimed = await withFarm(db, farmId, async (tx) => {
    const [row] = await rows<Row>(
      tx,
      sql`
        UPDATE integrations SET running_since = now()
        WHERE id = ${id} AND enabled AND secret_ciphertext IS NOT NULL
          AND (running_since IS NULL OR running_since < now() - interval '30 minutes')
        RETURNING *`,
    );
    if (row) return { row, equipmentList: await equipments(tx) };
    const [exists] = await rows<Row>(tx, sql`SELECT * FROM integrations WHERE id = ${id}`);
    if (!exists) throw new NotFound("Intégration introuvable.");
    if (!exists.enabled || !exists.secret_ciphertext) throw new BadRequest("Intégration désactivée ou incomplète.");
    throw new Conflict("Une synchronisation est déjà en cours.");
  });

  const { row, equipmentList } = claimed;
  let secret: string | undefined;
  let outcome: { status: "ok" | "error"; error: string | null; report: Record<string, unknown> | null };
  try {
    secret = decryptSecret(row.secret_ciphertext!);
    const report = await PROVIDERS[row.provider].sync(
      { farmId, settings: row.settings, secret, equipments: equipmentList },
      targetUrl,
    );
    outcome = { status: "ok", error: null, report };
  } catch (e) {
    outcome = { status: "error", error: safeMessage(e, secret), report: null };
  }

  return withFarm(db, farmId, async (tx) => {
    const [updated] = await rows<Row>(
      tx,
      sql`
        UPDATE integrations SET running_since = NULL, last_sync_at = now(), status = ${outcome.status},
          last_error = ${outcome.error},
          last_report = coalesce(${outcome.report === null ? null : JSON.stringify(outcome.report)}::jsonb, last_report),
          updated_at = now()
        WHERE id = ${id} RETURNING *`,
    );
    return view(updated!);
  });
}

/** Intégrations à synchroniser, toutes fermes confondues (worker). */
export async function dueIntegrations(
  db: Database,
  every = "1 minute",
): Promise<{ id: string; farm_id: string; provider: IntegrationProvider }[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    return rows(tx, sql`SELECT * FROM fourmy_due_integrations(${every}::interval)`);
  });
}
