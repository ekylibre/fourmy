import { z } from "zod";

/**
 * Droits d'accès par module (claudedocs/conception_api_mcp.md §3, lot AM1).
 * Un accès — membre restreint, clé d'API, application OAuth — porte pour
 * chaque module un niveau, et un périmètre d'activités.
 */

/** Les 11 modules ouverts aux accès restreints (besoins §1, Q7). */
export const accessModules = [
  "farm",
  "parcels",
  "activities",
  "interventions",
  "phyto",
  "fertilization",
  "stocks",
  "equipments",
  "people",
  "economics",
  "certifications",
] as const;
export const accessModule = z.enum(accessModules);
export type AccessModule = z.infer<typeof accessModule>;

/** `write` = lecture + propositions (B6) ; jamais d'écriture directe pour un accès restreint. */
export const accessLevel = z.enum(["none", "read", "write"]);
export type AccessLevel = z.infer<typeof accessLevel>;

/** Activités couvertes : toutes (y compris celles créées plus tard) ou une liste. */
export const accessActivities = z.union([z.literal("all"), z.array(z.uuid()).min(1).max(200)]);
export type AccessActivities = z.infer<typeof accessActivities>;

/** Droits d'un accès : un module absent vaut `none`. */
export const accessGrant = z.object({
  modules: z.partialRecord(accessModule, accessLevel),
  activities: accessActivities,
});
export type AccessGrant = z.infer<typeof accessGrant>;

export const ACCESS_MODULE_LABELS: Record<AccessModule, string> = {
  farm: "Ferme",
  parcels: "Parcellaire",
  activities: "Activités et assolement",
  interventions: "Interventions",
  phyto: "Phytosanitaire et registres",
  fertilization: "Fertilisation",
  stocks: "Stocks et semences",
  equipments: "Matériels",
  people: "Personnes et équipes",
  economics: "Économique",
  certifications: "Certifications",
};

/**
 * Modules où « écriture » a un sens (lot AM8) : on y dépose des propositions.
 * Ailleurs, l'écriture demandée est ramenée à la lecture.
 */
export const WRITABLE_MODULES: readonly AccessModule[] = ["interventions"];

/** Droits ramenés à ce qui a un sens : l'écriture seulement sur les modules à propositions. */
export function writableOnly(g: AccessGrant): AccessGrant {
  const modules = Object.fromEntries(Object.entries(g.modules).map(([m, l]) => [m, l === "write" && !WRITABLE_MODULES.includes(m as AccessModule) ? "read" : l]));
  return { modules, activities: g.activities };
}

/** Les droits ouvrent-ils une écriture (propositions) ? */
export const grantWrites = (g: AccessGrant) => Object.values(g.modules).some((l) => l === "write");

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  none: "Aucun accès",
  read: "Lecture",
  write: "Lecture et propositions",
};

/** Durées proposées pour une clé d'API (jours) ; absente : sans expiration. */
export const ACCESS_KEY_DURATIONS = [30, 90, 365] as const;

/** Création d'une clé d'API (POST /accesses, lot AM4). */
export const farmAccessCreate = z.object({
  name: z.string().trim().min(1).max(100),
  grant: accessGrant,
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable().optional(),
});
export type FarmAccessCreate = z.infer<typeof farmAccessCreate>;

/** Modification d'un accès (PATCH /accesses/:id). */
export const farmAccessUpdate = z.object({ name: z.string().trim().min(1).max(100).optional(), grant: accessGrant.optional() });
export type FarmAccessUpdate = z.infer<typeof farmAccessUpdate>;

/** Accès externe d'une ferme (GET /accesses). */
export const farmAccess = z.object({
  id: z.uuid(),
  kind: z.enum(["api_key", "oauth"]),
  name: z.string(),
  /** Début de la clé (affichage) : `fmy_ab…`. */
  keyStart: z.string().nullable(),
  user: z.object({ id: z.uuid(), name: z.string() }),
  grant: accessGrant,
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  /** Modules réduits par le plafond des droits de son auteur (API-4), à l'enregistrement. */
  reduced: z.array(accessModule).optional(),
});
export type FarmAccess = z.infer<typeof farmAccess>;

/** Clé créée : la clé complète n'est renvoyée qu'ici, une seule fois. */
export const farmAccessCreated = z.object({ access: farmAccess, key: z.string() });
export type FarmAccessCreated = z.infer<typeof farmAccessCreated>;

/** Ligne du journal des appels (GET /accesses/:id/log). */
export const accessLogEntry = z.object({
  at: z.string(),
  channel: z.enum(["rest", "mcp"]),
  operation: z.string(),
  status: z.number().int(),
  durationMs: z.number().int().nullable(),
  /** Objets écrits par l'appel (lot AM8) : propositions déposées. */
  written: z.object({ proposals: z.array(z.uuid()) }).nullable().optional(),
});
export type AccessLogEntry = z.infer<typeof accessLogEntry>;

/** Demande d'autorisation OAuth en cours (GET /api/v1/oauth/request, lot AM5). */
export const oauthRequest = z.object({
  client: z.object({ id: z.string(), name: z.string(), uri: z.string().nullable(), icon: z.string().nullable() }),
  /** Écriture demandée (scope `fourmy:write`) ; sinon lecture seulement. */
  write: z.boolean(),
  /** Fermes de l'utilisateur, avec ses propres droits (plafond du consentement). */
  farms: z.array(z.object({ id: z.uuid(), name: z.string(), role: z.enum(["owner", "worker", "reader", "guest"]), grant: accessGrant })),
  /** Ferme choisie (étape « ferme ») et droits déjà consentis sur elle, s'il y en a. */
  farmId: z.uuid().nullable(),
  current: accessGrant.nullable(),
});
export type OAuthRequest = z.infer<typeof oauthRequest>;

/** Choix de la ferme (POST /api/v1/oauth/farm). */
export const oauthFarmChoice = z.object({ farmId: z.uuid(), oauthQuery: z.string().min(1).max(8000) });
export type OAuthFarmChoice = z.infer<typeof oauthFarmChoice>;

/** Réponse au consentement (POST /api/v1/oauth/consent). */
export const oauthConsent = z.discriminatedUnion("accept", [
  z.object({ accept: z.literal(true), grant: accessGrant, oauthQuery: z.string().min(1).max(8000) }),
  z.object({ accept: z.literal(false), oauthQuery: z.string().min(1).max(8000) }),
]);
export type OAuthConsent = z.infer<typeof oauthConsent>;

/** Suite du parcours : l'adresse où envoyer le navigateur. */
export const oauthNext = z.object({ url: z.string() });
export type OAuthNext = z.infer<typeof oauthNext>;
