import { z } from "zod";
import { uuid } from "./primitives.js";

/**
 * Imports de fichiers (claudedocs/conception_import_onboarding.md §7) :
 * suivi d'un import, aperçu de l'analyse, décisions de l'utilisateur.
 * La reprise Ekylibre partage le suivi (`source` = `ekylibre:<base>`).
 */

export const importFormat = z.enum(["daplos", "geofolia", "telepac"]);
export type ImportFormat = z.infer<typeof importFormat>;

export const IMPORT_FORMAT_LABELS: Record<ImportFormat, string> = {
  daplos: "EDI DAPLOS",
  geofolia: "Geofolia (export JSON)",
  telepac: "TelePAC (dossier PAC XML)",
};

/**
 * analyzed → running → completed | failed ; analyzed → discarded ;
 * completed → reverting → reverted. La reprise Ekylibre : running → completed | failed.
 */
export const importRunStatus = z.enum(["analyzed", "running", "completed", "failed", "discarded", "reverting", "reverted"]);
export type ImportRunStatus = z.infer<typeof importRunStatus>;

export const importWarning = z.object({
  level: z.enum(["info", "warning", "blocking"]),
  message: z.string(),
  ref: z.string().optional(),
});
export type ImportWarning = z.infer<typeof importWarning>;

const identity = z.object({
  siret: z.string().nullable(),
  pacage: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  address: z
    .object({
      line1: z.string().optional(),
      line2: z.string().optional(),
      postalCode: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
    })
    .nullable(),
});

/**
 * Aperçu d'un fichier analysé : ce que le fichier contient (comptes,
 * opérations) et les avertissements. `reconciliation` (création ou lien des
 * parcelles, activités proposées, articles rapprochés…) arrive avec le
 * rapprochement (lot IM2) ; `null` tant que le format n'est pas lu.
 */
export const importPreview = z.object({
  format: importFormat,
  fileName: z.string(),
  /** Le format a un lecteur : sans lui, le fichier est reconnu mais pas lu. */
  readable: z.boolean(),
  producedBy: z.string().nullable(),
  exportedAt: z.string().nullable(),
  campaigns: z.array(z.number().int()),
  farm: z.object({
    /** Identité lue dans le fichier. */
    identity,
    /** SIRET du fichier = SIRET de la ferme ; null si l'un des deux manque. */
    siretMatches: z.boolean().nullable(),
  }),
  counts: z.object({
    parcels: z.number().int(),
    areaHa: z.number(),
    history: z.number().int(),
    articles: z.number().int(),
    people: z.number().int(),
    workUnits: z.number().int(),
    capIslets: z.number().int(),
    capParcels: z.number().int(),
    landscape: z.number().int(),
  }),
  /** Opérations par code AEE et procédure Fourmy proposée. */
  operations: z.array(
    z.object({
      code: z.string().nullable(),
      label: z.string(),
      procedure: z.string(),
      done: z.number().int(),
      planned: z.number().int(),
    }),
  ),
  notImported: z.array(z.object({ kind: z.string(), label: z.string(), count: z.number().int() })),
  warnings: z.array(importWarning),
  reconciliation: z.unknown().nullable(),
});
export type ImportPreview = z.infer<typeof importPreview>;

/**
 * Décisions de l'utilisateur, indexées par clés source (elles survivent au
 * recalcul du rapprochement). Les sections s'étoffent avec les lots IM2 à IM4.
 */
export const importDecisions = z
  .object({
    /** « Ce fichier concerne bien ma ferme » malgré un SIRET différent. */
    confirmSiret: z.boolean().optional(),
    /** Cultures → activités : nom choisi, référence Lexicon, fusion avec une autre clé. */
    activities: z
      .record(z.string(), z.object({ name: z.string().trim().min(1).max(120).optional(), reference: z.string().max(80).nullable().optional(), mergeInto: z.string().optional() }))
      .optional(),
    /** Articles : article existant, ou création (avec son unité). */
    articles: z
      .record(z.string(), z.object({ articleId: uuid.optional(), create: z.boolean().optional(), unit: z.string().max(40).optional() }))
      .optional(),
    /** Personnes : personne existante, création ou rien. */
    people: z.record(z.string(), z.object({ personId: uuid.optional(), create: z.boolean().optional(), skip: z.boolean().optional() })).optional(),
  })
  .strict();
export type ImportDecisions = z.infer<typeof importDecisions>;

export const importFileView = z.object({
  name: z.string(),
  size: z.number().int(),
  sha256: z.string(),
  uploadedAt: z.string(),
  expiresAt: z.string(),
});

export const importRunView = z.object({
  id: uuid,
  /** `file:<format>` pour un fichier, `ekylibre:<base>` pour une reprise. */
  source: z.string(),
  format: importFormat.nullable(),
  status: importRunStatus,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  file: importFileView.nullable(),
  preview: importPreview.nullable(),
  decisions: importDecisions,
  report: z.unknown().nullable(),
});
export type ImportRunView = z.infer<typeof importRunView>;
