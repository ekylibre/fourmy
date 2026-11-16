import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { AgrirouterRecipient, PrescriptionFormat } from "@fourmy/contracts";
import { AgrirouterClient, MESSAGE_TYPES, type AgrirouterApp, type AgrirouterOptions } from "@fourmy/agrirouter";
import { BadRequest } from "../routes/helpers.js";
import { decryptSecret, encryptSecret } from "../secrets.js";
import { ProviderDisconnected } from "./errors.js";

/**
 * agrirouter (lot AD, docs/modulation.md) : l'application Fourmy est
 * enregistrée une fois chez agrirouter (variables AGRIROUTER_* du serveur) ;
 * chaque ferme l'autorise par un consentement dans son compte agrirouter.
 * Le « secret » chiffré de l'intégration est l'identifiant de la ferme dans
 * agrirouter (tenant) ; les réglages gardent le point de terminaison de
 * Fourmy dans cette ferme.
 */

export const AGRIROUTER_ENV_VARS = [
  "AGRIROUTER_CLIENT_ID",
  "AGRIROUTER_CLIENT_SECRET",
  "AGRIROUTER_APPLICATION_ID",
  "AGRIROUTER_SOFTWARE_VERSION_ID",
  "AGRIROUTER_REDIRECT_URI",
] as const;

/** Durée de validité d'un consentement commencé. */
const STATE_TTL_MS = 30 * 60_000;

/** Options de test (simulation de l'API). */
let clientOptions: AgrirouterOptions = {};
export const setAgrirouterClientOptions = (o: AgrirouterOptions) => {
  clientOptions = o;
};

export function agrirouterConfig(): (AgrirouterApp & { redirectUri: string }) | null {
  const env = process.env;
  if (AGRIROUTER_ENV_VARS.some((k) => !env[k]?.trim())) return null;
  return {
    clientId: env.AGRIROUTER_CLIENT_ID!.trim(),
    clientSecret: env.AGRIROUTER_CLIENT_SECRET!.trim(),
    applicationId: env.AGRIROUTER_APPLICATION_ID!.trim(),
    softwareVersionId: env.AGRIROUTER_SOFTWARE_VERSION_ID!.trim(),
    redirectUri: env.AGRIROUTER_REDIRECT_URI!.trim(),
    environment: env.AGRIROUTER_ENVIRONMENT === "qa" ? "qa" : "production",
    ...(env.AGRIROUTER_API_URL ? { apiUrl: env.AGRIROUTER_API_URL } : {}),
    ...(env.AGRIROUTER_AUTHORIZE_URL ? { authorizeUrl: env.AGRIROUTER_AUTHORIZE_URL } : {}),
  };
}

export function agrirouterClient(): AgrirouterClient {
  const config = agrirouterConfig();
  if (!config) throw new BadRequest("agrirouter n'est pas configuré sur ce serveur (variables AGRIROUTER_*).");
  return new AgrirouterClient(config, clientOptions);
}

/**
 * Point de terminaison de Fourmy dans le compte agrirouter : un par ferme
 * Fourmy, au format recommandé `urn:<domaine>:<application>:<instance>`.
 */
export const externalEndpointId = (farmId: string) => `urn:fourmy.org:fourmy:farm-${farmId}`;

/**
 * Nom reconnaissable par l'exploitant (exigé par la revue) : « Fourmy - <ferme> ».
 * agrirouter n'accepte que lettres, chiffres, espaces et `_ . , : @ -`.
 */
export const endpointName = (farmName: string) => {
  const farm = farmName.replace(/[^\p{L}\p{N} _.,:@-]/gu, " ").replace(/\s+/g, " ").trim();
  return (farm ? `Fourmy - ${farm}` : "Fourmy").slice(0, 200);
};

/**
 * Configuration complète du point de terminaison de la ferme (chaque PUT
 * remplace tout) : elle doit rester un sous-ensemble des capacités déclarées
 * dans la version de l'application (portail agrirouter, version 1) :
 * TaskData en envoi et réception, Shapefile en envoi, TimeLog et Device
 * Description EFDI en réception. Abonnements : ce que les machines publient.
 */
export const farmEndpointConfig = (farmName: string) => ({
  name: endpointName(farmName),
  endpointType: "cloud_software" as const,
  capabilities: [
    { message_type: MESSAGE_TYPES.taskdata, direction: "SEND_RECEIVE" as const },
    { message_type: MESSAGE_TYPES.shape, direction: "SEND" as const },
    { message_type: MESSAGE_TYPES.timeLog, direction: "RECEIVE" as const },
    { message_type: MESSAGE_TYPES.deviceDescription, direction: "RECEIVE" as const },
  ],
  subscriptions: [MESSAGE_TYPES.taskdata, MESSAGE_TYPES.timeLog, MESSAGE_TYPES.deviceDescription],
  allowDeleteByUser: true,
});

/**
 * Délai après la connexion pendant lequel l'absence du point de terminaison
 * dans la liste n'est pas une suppression (agrirouter propage les points de
 * terminaison de façon asynchrone).
 */
const ENDPOINT_PROPAGATION_MS = 10 * 60_000;

const FORMAT_OF: Record<string, PrescriptionFormat> = { [MESSAGE_TYPES.taskdata]: "isoxml", [MESSAGE_TYPES.shape]: "shape" };
export const MESSAGE_TYPE_OF: Record<PrescriptionFormat, string> = { isoxml: MESSAGE_TYPES.taskdata, shape: MESSAGE_TYPES.shape };

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/**
 * Commence la connexion : état aléatoire lié à la ferme (son empreinte est
 * gardée, valable 30 min), adresse du consentement agrirouter.
 */
export async function startAgrirouterConnect(db: Database, farmId: string): Promise<{ url: string }> {
  const config = agrirouterConfig();
  const client = agrirouterClient();
  const state = `${farmId}.${randomBytes(24).toString("base64url")}`;
  await withFarm(db, farmId, (tx) =>
    tx.execute(sql`
      INSERT INTO integrations (id, farm_id, provider, settings, enabled, status)
      VALUES (${crypto.randomUUID()}, ${farmId}, 'agrirouter',
              jsonb_build_object('pendingState', ${hash(state)}::text, 'pendingUntil', ${new Date(Date.now() + STATE_TTL_MS).toISOString()}::text),
              true, 'pending')
      ON CONFLICT (farm_id, provider) DO UPDATE SET
        settings = integrations.settings || excluded.settings, updated_at = now()`),
  );
  return { url: client.authorizeUrl(state, config!.redirectUri) };
}

/** Réglages enregistrés d'une ferme connectée. */
export interface AgrirouterSettings {
  endpointId: string;
  externalId: string;
  companyName?: string;
  connectedAt: string;
}

/**
 * Termine la connexion au retour du consentement : l'état doit être celui
 * émis pour cette ferme et non expiré, et agrirouter doit confirmer que la
 * ferme (tenant) a autorisé Fourmy avec cet état. Crée ensuite le point de
 * terminaison de Fourmy dans la ferme agrirouter.
 */
export async function completeAgrirouterConnect(
  db: Database,
  farmId: string,
  input: { state: string; tenantId: string },
): Promise<void> {
  const [row] = await withFarm(db, farmId, (tx) =>
    rows<{ id: string; settings: Record<string, string> }>(tx, sql`SELECT id, settings FROM integrations WHERE provider = 'agrirouter'`),
  );
  const expected = row?.settings.pendingState;
  const until = Date.parse(row?.settings.pendingUntil ?? "");
  const given = Buffer.from(hash(input.state));
  if (!expected || !input.state.startsWith(`${farmId}.`) || given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected))) {
    throw new BadRequest("Connexion agrirouter : demande inconnue ou déjà utilisée. Recommencez depuis Intégrations.");
  }
  if (!(until > Date.now())) throw new BadRequest("Connexion agrirouter expirée. Recommencez depuis Intégrations.");

  const client = agrirouterClient();
  const tenant = (await client.tenants()).find((t) => t.tenant_id === input.tenantId);
  if (!tenant || (tenant.state !== undefined && tenant.state !== input.state)) {
    throw new BadRequest("agrirouter ne confirme pas l'autorisation de cette ferme.");
  }
  const [farm] = await withFarm(db, farmId, (tx) => rows<{ name: string }>(tx, sql`SELECT name FROM farms WHERE id = ${farmId}`));
  const externalId = externalEndpointId(farmId);
  const endpoint = await client.putEndpoint(input.tenantId, externalId, farmEndpointConfig(farm?.name ?? ""));
  const settings: AgrirouterSettings = {
    endpointId: endpoint.id,
    externalId,
    connectedAt: new Date().toISOString(),
    ...(tenant.company_name ? { companyName: tenant.company_name } : {}),
  };
  await withFarm(db, farmId, (tx) =>
    tx.execute(sql`
      UPDATE integrations SET settings = ${JSON.stringify(settings)}::jsonb,
        secret_ciphertext = ${encryptSecret(input.tenantId)}, secret_hint = NULL,
        enabled = true, status = 'pending', last_error = NULL, last_sync_at = NULL, updated_at = now()
      WHERE provider = 'agrirouter'`),
  );
}

/**
 * Destinataires joignables par une route depuis le point de terminaison de
 * Fourmy, avec les formats permis. Avec `check`, vérifie d'abord que la
 * connexion tient toujours : autorisation présente (`GET /tenants`) et point
 * de terminaison encore là (sauf juste après la connexion). Sinon,
 * `ProviderDisconnected`.
 */
export async function agrirouterRecipients(
  tenantId: string,
  endpointId: string,
  check?: { connectedAt?: string },
): Promise<{ companyName: string | null; recipients: AgrirouterRecipient[] }> {
  const client = agrirouterClient();
  if (check && !(await client.tenants()).some((t) => t.tenant_id === tenantId)) {
    throw new ProviderDisconnected("revoked", "L'autorisation de Fourmy a été retirée dans agrirouter.");
  }
  const { companyName, endpoints } = await client.tenantEndpoints(tenantId);
  const own = endpoints.find((e) => e.id === endpointId);
  const settled = !check?.connectedAt || Date.now() - Date.parse(check.connectedAt) > ENDPOINT_PROPAGATION_MS;
  if (check && !own && settled) {
    throw new ProviderDisconnected("endpoint_deleted", "Le point de terminaison de Fourmy a été supprimé dans agrirouter.");
  }
  const routes = own?.routed_endpoints?.can_send_to ?? {};
  const recipients = endpoints
    .filter((e) => e.id !== endpointId && routes[e.id]?.length)
    .map((e) => ({
      id: e.id,
      name: e.name,
      endpointType: e.endpoint_type,
      formats: [...new Set(routes[e.id]!.map((t) => FORMAT_OF[t]).filter((f): f is PrescriptionFormat => !!f))],
    }))
    .filter((r) => r.formats.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return { companyName, recipients };
}

/** Intégration agrirouter connectée d'une ferme (tenant déchiffré), ou erreur lisible. */
export async function connectedAgrirouter(tx: Tx): Promise<{ tenantId: string; settings: AgrirouterSettings }> {
  const [row] = await rows<{ settings: AgrirouterSettings; secret_ciphertext: string | null; enabled: boolean }>(
    tx,
    sql`SELECT settings, secret_ciphertext, enabled FROM integrations WHERE provider = 'agrirouter'`,
  );
  if (!row?.secret_ciphertext || !row.settings.endpointId) throw new BadRequest("Ferme non connectée à agrirouter (Intégrations).");
  if (!row.enabled) throw new BadRequest("Intégration agrirouter désactivée.");
  return { tenantId: decryptSecret(row.secret_ciphertext), settings: row.settings };
}
