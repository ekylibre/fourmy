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
});
export type AccessLogEntry = z.infer<typeof accessLogEntry>;
