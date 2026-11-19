import type { TreatmentPurpose } from "@fourmy/contracts";
import type { ArticleNature } from "./model.js";

/**
 * Codes AgroEDI (AEE) → concepts Fourmy (claudedocs/conception_import_onboarding.md
 * §5.3, §5.8). Un code AEE n'est unique que dans sa table : chaque fonction lit
 * une table précise. Établi et vérifié le 19/11/2026 sur le dictionnaire
 * AgroEDI de Lexicon (`data/agroedi`) et le gabarit DAPLOS d'Ekylibre.
 *
 * Seule la traduction en concepts Fourmy est ici ; les libellés viennent du
 * référentiel (jeu `agroedi` de Lexicon) ou du lecteur DAPLOS.
 */

// --- Table 14 : nature d'intervention -----------------------------------------

export type SowingTechnique = "direct" | "precision" | "conventional" | "planting" | "broadcast";

export interface OperationTarget {
  /** Procédure du catalogue Fourmy (`packages/contracts/src/procedures.ts`). */
  procedure: string;
  /** Technique de semis portée par l'intervention (bloc `sowing`). */
  sowing?: SowingTechnique;
  /** Dose d'eau portée par le bloc `irrigation`. */
  irrigation?: true;
  /** La procédure dépend des intrants (fertilisation minérale ou organique). */
  dependsOnInputs?: true;
}

/**
 * Codes de la table 14 rencontrés chez les pilotes et les codes voisins
 * courants. `ekylibre_value` du dictionnaire a servi de point de départ, sans
 * être repris tel quel (procédures absentes du catalogue, erreurs comme
 * Sous-solage → roulage).
 */
export const OPERATIONS: Record<string, OperationTarget> = {
  SEM: { procedure: "mineral_fertilizing", dependsOnInputs: true }, // Fertilisation
  SEK: { procedure: "organic_fertilizing" }, // Épandage organique
  SEX: { procedure: "spraying" }, // Traitement phytosanitaire
  V95: { procedure: "spraying" }, // Désherbage (vigne)
  SEU: { procedure: "sowing", sowing: "direct" }, // Semis direct
  ZKE: { procedure: "sowing", sowing: "precision" }, // Semis de précision
  SET: { procedure: "sowing", sowing: "conventional" }, // Semis classique
  SEW: { procedure: "sowing", sowing: "planting" }, // Plantation
  SER: { procedure: "harvesting" }, // Récolte
  SEQ: { procedure: "grains_harvest" }, // Moisson
  SEO: { procedure: "plant_watering", irrigation: true }, // Irrigation
  SFK: { procedure: "crop_residues_grinding" }, // Broyage des résidus
  SEC: { procedure: "crop_residues_grinding" }, // Broyage cailloux
  SEP: { procedure: "plowing" }, // Labour
  SEE: { procedure: "superficial_plowing" }, // Déchaumage
  SEF: { procedure: "superficial_plowing" }, // Décompactage
  SEV: { procedure: "superficial_plowing" }, // Sous-solage
  SEB: { procedure: "hoeing" }, // Binage
  SED: { procedure: "hoeing" }, // Buttage
  SEI: { procedure: "hoeing" }, // Enfouissement
  V96: { procedure: "hoeing" }, // Travail de surface
  SEN: { procedure: "raking" }, // Hersage
  SES: { procedure: "rolling" }, // Roulage
  SEL: { procedure: "plant_mowing" }, // Fauchage
};

/**
 * Procédure d'un code d'opération. Code inconnu : « Travail du sol (PV) »
 * (`generic_tillage`) si la catégorie AEE est `ZF8`, sinon « Tâche technique
 * générale » (`technical_task`), libellé d'origine en note. Ces deux codes
 * d'Ekylibre sont hors du catalogue v1 mais lisibles (`getProcedure`), comme
 * les procédures rares reprises d'Ekylibre.
 */
export function operationTarget(code: string | null | undefined, category?: string | null): OperationTarget {
  const known = code ? OPERATIONS[code.trim()] : undefined;
  if (known) return known;
  return { procedure: category?.trim() === "ZF8" ? "generic_tillage" : "technical_task" };
}

/**
 * Récolte de grains (usage final `ZLD`, table 17) : `grains_harvest`, sinon
 * la procédure du code d'opération.
 */
export function harvestProcedure(usage: string | null | undefined): "grains_harvest" | "harvesting" {
  return usage?.trim() === "ZLD" ? "grains_harvest" : "harvesting";
}

// --- Table 11 : état de l'évènement -------------------------------------------

/** `ZK1` évènement prévu → planifié ; `ZK2` réalisé (et inconnu) → réalisé. */
export function eventStatus(code: string | null | undefined): "planned" | "done" {
  return code?.trim() === "ZK1" ? "planned" : "done";
}

// --- Table 26 : catégorie d'intervention ---------------------------------------

export const CATEGORIES: Record<string, "harvest" | "tillage" | "other_work" | "decision" | "input"> = {
  ZF7: "harvest",
  ZF8: "tillage",
  ZF9: "other_work",
  ZG1: "decision",
  ZG7: "input",
};

// --- Table 5 : nature d'intrant -------------------------------------------------

export interface InputNature {
  nature: ArticleNature;
  /** Motif de traitement, pour un phyto. */
  purpose?: TreatmentPurpose;
  /** Fertilisant organique (effluent, sous-produit) : décide de `organic_fertilizing`. */
  organic?: true;
}

export const INPUT_NATURES: Record<string, InputNature> = {
  ZIU: { nature: "phyto", purpose: "herbicide" },
  ZIV: { nature: "phyto", purpose: "fungicide" },
  ZIW: { nature: "phyto", purpose: "insecticide" },
  ZIX: { nature: "phyto", purpose: "molluscicide" },
  ZIY: { nature: "phyto", purpose: "nematicide" },
  ZIZ: { nature: "phyto", purpose: "growth_regulator" },
  ZJA: { nature: "phyto" }, // Divers (huiles)
  ZJG: { nature: "phyto" }, // Traitement de semence
  ZJJ: { nature: "phyto", purpose: "acaricide" },
  ZJK: { nature: "phyto", purpose: "other" }, // Bactéricides
  ZJL: { nature: "phyto" }, // Moyens biologiques
  ZJN: { nature: "phyto", purpose: "other" }, // Rodenticides
  ZJO: { nature: "phyto" }, // Taupicides
  ZJP: { nature: "phyto" }, // Corvicides
  ZJQ: { nature: "phyto" }, // Corvifuges
  ZJR: { nature: "phyto" }, // Répulsifs oiseaux-gibiers
  ZJS: { nature: "phyto", purpose: "growth_regulator" }, // Substance de croissance
  ZMT: { nature: "phyto" }, // Inhibiteurs de germination
  ZQG: { nature: "adjuvant" },
  ZJB: { nature: "fertilizer", organic: true }, // Effluents d'élevage
  ZKA: { nature: "fertilizer", organic: true }, // Sous-produits filières alimentaires
  ZKB: { nature: "fertilizer", organic: true }, // Sous-produits filières non alimentaires
  ZKC: { nature: "fertilizer", organic: true }, // Boues, compost urbain
  U64: { nature: "fertilizer", organic: true }, // Boues, compost d'industrie
  ZJC: { nature: "fertilizer" }, // Fertilisation minérale
  ZJD: { nature: "fertilizer" }, // Fertirrigation
  ZKD: { nature: "fertilizer" }, // Minéral type bulk
  ZSU: { nature: "fertilizer" }, // Organo-minérale
  ZKE: { nature: "amendment" }, // Amendements calco-magnésiens
  ZJE: { nature: "water" }, // Irrigation
  ZJF: { nature: "seed" }, // Semence
  ZJT: { nature: "seed" }, // Plants
};

/** Nature d'un intrant (table 5) ; `other` si inconnue. */
export function inputNature(code: string | null | undefined): InputNature {
  return (code && INPUT_NATURES[code.trim()]) || { nature: "other" };
}

// --- Table 6 : effluents d'élevage ------------------------------------------------

export type EffluentForm = "manure" | "slurry" | "liquid_manure" | "droppings";

export interface Effluent {
  form: EffluentForm;
  animal: "cattle" | "pig" | "sheep" | "goat" | "horse" | "turkey" | "duck" | "guinea_fowl" | "laying_hen" | "broiler" | "rabbit";
}

/** Effluents d'élevage (codes SC*) : forme et espèce, pour la fertilisation. */
export const EFFLUENTS: Record<string, Effluent> = {
  SCA: { form: "manure", animal: "cattle" },
  SCB: { form: "slurry", animal: "cattle" },
  SCC: { form: "liquid_manure", animal: "cattle" },
  SCD: { form: "manure", animal: "pig" },
  SCE: { form: "slurry", animal: "pig" },
  SCF: { form: "manure", animal: "sheep" },
  SCG: { form: "slurry", animal: "sheep" },
  SCH: { form: "manure", animal: "goat" },
  SCI: { form: "slurry", animal: "goat" },
  SCJ: { form: "manure", animal: "horse" },
  SCK: { form: "manure", animal: "turkey" },
  SCL: { form: "droppings", animal: "turkey" },
  SCM: { form: "slurry", animal: "turkey" },
  SCN: { form: "slurry", animal: "duck" },
  SCO: { form: "manure", animal: "duck" },
  SCP: { form: "slurry", animal: "guinea_fowl" },
  SCQ: { form: "droppings", animal: "guinea_fowl" },
  SCR: { form: "manure", animal: "guinea_fowl" },
  SCS: { form: "droppings", animal: "laying_hen" },
  SCT: { form: "manure", animal: "laying_hen" },
  SCU: { form: "manure", animal: "broiler" },
  SCV: { form: "droppings", animal: "broiler" },
  SCW: { form: "slurry", animal: "broiler" },
  SCY: { form: "slurry", animal: "rabbit" },
};

// --- Table 20 : composition des fertilisants (% du produit brut) ----------------

export const COMPONENTS: Record<string, "n" | "p2o5" | "k2o" | "mgo" | "so3" | "cao" | "na2o" | "b" | "cu" | "zn" | "mn" | "fe" | "mo" | "co"> = {
  NT: "n",
  PT: "p2o5",
  KT: "k2o",
  MT: "mgo",
  ST: "so3",
  CA: "cao",
  SO: "na2o",
  BT: "b",
  UT: "cu",
  ZT: "zn",
  GT: "mn",
  FT: "fe",
  LT: "mo",
  OT: "co",
};

// --- Table 36 (et rendement) : unités ---------------------------------------------

export interface AeeUnit {
  /** Unité Fourmy (`packages/contracts/src/units.ts`). */
  unit: string;
  /** Unité par hectare (dose, rendement). */
  perHa: boolean;
}

/**
 * Unités AEE → unités Fourmy. `ZHK` (unité de rendement) est absent de la
 * table 36 : t/ha d'après les valeurs (5,54 t sur 1,4568 ha = 3,80 ZHK).
 */
export const UNITS: Record<string, AeeUnit> = {
  LTR: { unit: "liter", perHa: false },
  KGM: { unit: "kilogram", perHa: false },
  TNE: { unit: "ton", perHa: false },
  MTQ: { unit: "cubic_meter", perHa: false },
  DOS: { unit: "unity", perHa: false },
  NAR: { unit: "unity", perHa: false },
  PLT: { unit: "unity", perHa: false },
  GRA: { unit: "unity", perHa: false },
  HAR: { unit: "hectare", perHa: false },
  MMT: { unit: "millimeter", perHa: false },
  CMT: { unit: "centimeter", perHa: false },
  PCD: { unit: "percent", perHa: false },
  ZKK: { unit: "liter_per_hectare", perHa: true },
  ZKL: { unit: "kilogram_per_hectare", perHa: true },
  ZKM: { unit: "unity_per_hectare", perHa: true },
  ZKN: { unit: "unity_per_hectare", perHa: true },
  ZHL: { unit: "cubic_meter_per_hectare", perHa: true },
  ZHK: { unit: "ton_per_hectare", perHa: true },
};

/** Unité Fourmy d'un code AEE ; `null` si inconnue (choix demandé à l'utilisateur). */
export function aeeUnit(code: string | null | undefined): AeeUnit | null {
  // Le dictionnaire contient « ZKM » et « ZKN » avec une espace finale.
  return (code && UNITS[code.trim()]) || null;
}
