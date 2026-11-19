import { z } from "zod";

/**
 * Contrôles HVE et Agriculture biologique (claudedocs/conception_controle_hve_ab.md
 * §5.1, §6) : constats d'une règle, rapport d'une campagne, réglages.
 */

export const controlKind = z.enum(["hve", "ab"]);
export type ControlKind = z.infer<typeof controlKind>;

export const CONTROL_KIND_LABELS: Record<ControlKind, string> = {
  hve: "Haute Valeur Environnementale",
  ab: "Agriculture biologique",
};

/**
 * ok : conforme ; warning : à vérifier ; danger : non conforme ; missing :
 * données manquantes (jamais compté conforme) ; na : sans objet.
 */
export const controlLevel = z.enum(["ok", "warning", "danger", "missing", "na"]);
export type ControlLevel = z.infer<typeof controlLevel>;

export const controlBreach = z.object({
  /** N° du manquement au catalogue INAO. */
  inao: z.string(),
  label: z.string(),
  class: z.enum(["minor", "major", "critical"]),
  /** Mesure encourue au 1er constat (libellé). */
  measure: z.string(),
  unconfirmed: z.boolean().optional(),
});

export const controlMissing = z.object({
  what: z.string(),
  where: z.enum(["parcel", "production", "intervention", "article", "questionnaire", "farm", "settings"]),
  id: z.string().optional(),
});
export type ControlMissing = z.infer<typeof controlMissing>;

export const controlFinding = z.object({
  /** « hve.5.1 », « ab.R21 ». */
  ruleId: z.string(),
  level: controlLevel,
  message: z.string(),
  value: z.number().optional(),
  threshold: z.number().optional(),
  unit: z.string().optional(),
  points: z.object({ got: z.number(), max: z.number() }).optional(),
  breach: controlBreach.optional(),
  refs: z
    .object({
      parcelIds: z.array(z.string()).optional(),
      interventionIds: z.array(z.string()).optional(),
      articleIds: z.array(z.string()).optional(),
    })
    .default({}),
  missing: z.array(controlMissing).optional(),
  /** Texte, version et emplacement de la règle. */
  source: z.string(),
  /** Écart entre le plan de contrôle et la grille (D6), signalé. */
  gridDivergence: z.string().optional(),
});
export type ControlFinding = z.infer<typeof controlFinding>;

export const controlSection = z.object({
  id: z.string(),
  label: z.string(),
  level: controlLevel,
  /** HVE : points obtenus, maximum, minimum à atteindre. */
  points: z.object({ got: z.number(), max: z.number(), min: z.number() }).optional(),
  findings: z.array(controlFinding),
});
export type ControlSection = z.infer<typeof controlSection>;

export const controlReport = z.object({
  kind: controlKind,
  campaign: z.number().int(),
  period: z.object({ from: z.string(), to: z.string() }),
  verdict: controlLevel,
  sections: z.array(controlSection),
  refsVersion: z.string(),
  computedAt: z.string(),
  /** Dernier export de ce calcul, et données modifiées depuis. */
  exportedAt: z.string().nullable(),
  changedSinceExport: z.boolean(),
});
export type ControlReport = z.infer<typeof controlReport>;

/** Certifications de parcelle actives pendant la campagne (menu Réglementaire, D2). */
export const controlAvailability = z.object({ hve: z.boolean(), ab: z.boolean() });
export type ControlAvailability = z.infer<typeof controlAvailability>;

/** Constats de certification d'une intervention (saisie), comme `compliance`. */
export const certificationCheck = z.object({
  level: controlLevel,
  findings: z.array(controlFinding),
  checkedAt: z.string(),
  reason: z.string().nullable().optional(),
});
export type CertificationCheck = z.infer<typeof certificationCheck>;

/** Réglages des contrôles (farm_settings.certification). */
export const certificationSettings = z
  .object({
    /** Début de la période HVE de 12 mois (MM-JJ), par défaut le 1er janvier. */
    hveCampaignStartMd: z
      .string()
      .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Date au format MM-JJ")
      .default("01-01"),
    /** IFT et bilan azoté : campagne seule, ou moyenne pluriannuelle. */
    hveMethod: z.enum(["campaign", "average"]).default("campaign"),
    /** Rotation AB (D12) : légumineuse sur N campagnes, même espèce au plus K années de suite. */
    rotationYears: z.number().int().min(2).max(10).default(5),
    rotationSameSpeciesMax: z.number().int().min(1).max(5).default(2),
    /** 170 kg N : année civile ou campagne. */
    organicNitrogenPeriod: z.enum(["calendar", "campaign"]).default("calendar"),
    /** Notification à l'Agence Bio et engagement auprès de l'organisme certificateur. */
    abNotifiedOn: z.string().date().nullable().default(null),
    abCommittedOn: z.string().date().nullable().default(null),
  })
  .strict();
export type CertificationSettings = z.infer<typeof certificationSettings>;
export const DEFAULT_CERTIFICATION_SETTINGS: CertificationSettings = certificationSettings.parse({});
