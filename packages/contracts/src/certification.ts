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
    /** Références IFT des grandes cultures : notation « en cours » ou « ancienne » (admise jusqu'à la campagne 2025). */
    hveIftScale: z.enum(["current", "old"]).default("current"),
    /** Rhône et Saône-et-Loire : siège dans le périmètre de l'AOC Beaujolais (bassin viticole des références IFT). */
    hveBeaujolais: z.boolean().nullable().default(null),
    /** Élevage sur l'exploitation (bilan azoté : rejets des animaux, pâturage) ; null : non déclaré. */
    hveLivestock: z.boolean().nullable().default(null),
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

/** Teneur en cuivre métal saisie sur un produit cuprique (prime sur celle déduite d'E-Phy) ; null : effacée. */
export const articleCopperWrite = z.object({
  g: z.number().positive().max(1000).nullable(),
  per: z.enum(["kg", "L"]).default("kg"),
});
export type ArticleCopperWrite = z.infer<typeof articleCopperWrite>;

/** Cuivre d'un produit : saisi, déduit d'E-Phy, ou à saisir (`unknown`). */
export type ArticleCopper = { g: number; per: "kg" | "L"; from: "article" | "ephy" } | { from: "unknown" };

export const cropCycle = z.enum(["annual", "semi_perennial", "perennial"]);
export const CROP_CYCLE_LABELS: Record<z.infer<typeof cropCycle>, string> = {
  annual: "Annuelle",
  semi_perennial: "Semi-pérenne (prairie, fraise, asperge…)",
  perennial: "Pérenne (vigne, verger…)",
};
export const cultivationMode = z.enum(["open_field", "shelter", "heated_shelter", "soilless", "pot", "container"]);
export const CULTIVATION_MODE_LABELS: Record<z.infer<typeof cultivationMode>, string> = {
  open_field: "Plein champ",
  shelter: "Sous abri",
  heated_shelter: "Sous abri chauffé",
  soilless: "Hors sol",
  pot: "En pot",
  container: "En conteneur",
};

/** Statut biologique d'un article (semence : et traitement), pour les contrôles AB (R24). */
export const articleOrganicWrite = z
  .object({
    organicStatus: z.enum(["organic", "conversion", "conventional"]).nullable(),
    seedTreated: z.boolean().nullable().optional(),
  })
  .strict();
export type ArticleOrganicWrite = z.infer<typeof articleOrganicWrite>;

/** Dérogation pour une semence non biologique (R25) : avant le semis, pour une saison. */
export const seedDerogationWrite = z
  .object({
    species: z.string().trim().min(1).max(120),
    variety: z.string().trim().max(120).nullable().default(null),
    articleId: z.string().uuid().nullable().default(null),
    grantedOn: z.string().date(),
    season: z.number().int().min(2000).max(2100),
    quantity: z.number().positive().nullable().default(null),
    unit: z.string().trim().max(40).nullable().default(null),
    reference: z.string().trim().max(120).nullable().default(null),
    certifier: z.string().trim().max(120).nullable().default(null),
  })
  .strict();
export type SeedDerogationWrite = z.infer<typeof seedDerogationWrite>;
export type SeedDerogation = SeedDerogationWrite & { id: string };

/** Semence utilisée sur une parcelle AB (onglet Semences). */
export interface AbSeedUse {
  articleId: string;
  name: string;
  organicStatus: "organic" | "conversion" | "conventional" | null;
  seedTreated: boolean | null;
  firstSownOn: string;
  parcels: string[];
}

/** IAE (HVE 4.1) : type validé par l'exploitant (null : pas une IAE), linéaire mitoyen. */
export const landscapeFeatureHveWrite = z
  .object({
    type: z.string().trim().min(1).max(40).nullable(),
    validated: z.boolean(),
    shared: z.boolean().default(false),
  })
  .strict();
export type LandscapeFeatureHveWrite = z.infer<typeof landscapeFeatureHveWrite>;

/** IAE de l'exploitation, telles que le contrôle HVE les compte. */
export interface HveIaeItem {
  id: string;
  label: string;
  capType: string | null;
  /** Type HVE retenu (validé) ou proposé d'après TelePAC. */
  type: string | null;
  proposed: boolean;
  validated: boolean;
  shared: boolean;
  quantity: number;
  unit: "m" | "m2" | "tree" | null;
  equivalentM2: number | null;
  onArable: boolean;
}

/** Production : ce que les contrôles AB lisent (conversion, mode de culture). Absent : inchangé ; cycle null : déduit de Lexicon. */
export const productionCertificationWrite = z
  .object({
    cycle: cropCycle.nullable().optional(),
    plantedOn: z.string().date().nullable().optional(),
    cultivationMode: cultivationMode.optional(),
    /** HVE 7.1 : variété tolérante à la sécheresse, autres pratiques économes en eau. */
    droughtTolerant: z.boolean().nullable().optional(),
    waterSaving: z.string().trim().max(200).nullable().optional(),
  })
  .strict();
export type ProductionCertificationWrite = z.infer<typeof productionCertificationWrite>;

// --- Questionnaire HVE annuel (lot CT4b, D10) ---------------------------------------------

const pct = z.number().min(0).max(100);
const count = z.number().int().min(0).max(1000);

/**
 * Réponses du questionnaire HVE d'une campagne : items déclaratifs des
 * quatre indicateurs. Chaque réponse est facultative ; absente, l'item reste
 * en « données manquantes » (jamais de point d'office).
 */
export const hveAnswers = z
  .object({
    biodiversity: z
      .object({
        /** 4.5 : espèces animales élevées (pas les races), abeilles exclues. */
        animalSpecies: count.nullable().optional(),
        /** 4.6 : 3 ruches sédentaires au moins, toute la campagne. */
        hives: z.boolean().nullable().optional(),
        /** 4.7 : variétés (annexe 3, région) et races menacées (arrêté du 29/04/2015). */
        threatenedVarieties: count.nullable().optional(),
        threatenedBreeds: count.nullable().optional(),
        /** 4.8 : test bêche OPVT (valable 3 campagnes) ou analyse de biomasse microbienne (année précédente). */
        soilBiology: z.enum(["none", "spade_test", "microbial_analysis"]).nullable().optional(),
      })
      .strict()
      .default({}),
    phyto: z
      .object({
        /** 5.5 : outil de diagnostic ou de modélisation (BSV tracé), prospection collective, observateur BSV (% de SAU représentée). */
        diagnosticTool: z.boolean().nullable().optional(),
        collectiveProspection: z.boolean().nullable().optional(),
        bsvObserverPercent: pct.nullable().optional(),
        /** 5.6 : % de SAU où une méthode alternative a remplacé un traitement. */
        alternativeMethodsPercent: pct.nullable().optional(),
        /** 5.7 : équipements de l'annexe 6 présents sur tous les pulvérisateurs. */
        leakEquipment: count.nullable().optional(),
        /** 5.9 : % de l'inter-rang couvert toute la campagne, sans destruction chimique. */
        interRowCoverPercent: pct.nullable().optional(),
      })
      .strict()
      .default({}),
    fertilization: z
      .object({
        /** Bilan azoté : azote des animaux (rejets − effluents cédés + effluents reçus, kg N), restitutions au pâturage comprises. */
        livestockNitrogenKg: z.number().min(0).max(10_000_000).nullable().optional(),
        /** 6.4 : % de la surface en blé sous OPI ; cultures mineures : % sous PPF ajusté ou outil de pilotage, PPF sur plus de 50 %. */
        opiWheatPercent: pct.nullable().optional(),
        minorOadPercent: pct.nullable().optional(),
        minorPpf: z.boolean().nullable().optional(),
        /** 6.7 : durée réglementaire de couverture respectée partout, semaines de couvert, % de surface couverte, zone vulnérable. */
        coverRegulatory: z.boolean().nullable().optional(),
        coverWeeks: z.number().int().min(0).max(52).nullable().optional(),
        coverPercent: pct.nullable().optional(),
        vulnerableZone: z.boolean().nullable().optional(),
      })
      .strict()
      .default({}),
    irrigation: z
      .object({
        /** 7.2 : outils d'offre (sondes…), de demande (ETP…), OAD mixte. */
        supplyTool: z.boolean().nullable().optional(),
        demandTool: z.boolean().nullable().optional(),
        mixedTool: z.boolean().nullable().optional(),
        /** 7.3 et 7.5 : % de la SAU irriguée équipée, en pratiques économes. */
        efficientEquipmentPercent: pct.nullable().optional(),
        /** 7.4 : démarche collective de gestion de la ressource. */
        collective: z.boolean().nullable().optional(),
        waterSavingPercent: pct.nullable().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type HveAnswers = z.infer<typeof hveAnswers>;
export const EMPTY_HVE_ANSWERS: HveAnswers = hveAnswers.parse({});

export interface HveQuestionnaire {
  id: string | null;
  campaign: number;
  answers: HveAnswers;
  updatedAt: string | null;
}
