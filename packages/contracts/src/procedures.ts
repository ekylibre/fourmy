import { z } from "zod";
import { PROCEDURE_LABELS } from "./procedure-labels.js";
import { procedureIcon } from "./procedure-icons.js";

/**
 * Catalogue des procédures (docs/interventions.md §3). Une procédure est une
 * DONNÉE : code (celui d'Ekylibre, conservé pour la migration), libellé
 * officiel, forme, natures d'articles acceptées. Pas de grammaire de filtres,
 * pas de formules : les règles sont celles de la forme (domaine).
 */

export const procedureShape = z.enum(["work", "treatment", "fertilization", "sowing", "harvest", "maintenance"]);
export type ProcedureShape = z.infer<typeof procedureShape>;

export const procedureCategory = z.enum(["crops", "vine", "equipment", "general"]);
export type ProcedureCategory = z.infer<typeof procedureCategory>;

export const articleKind = z.enum(["phyto", "fertilizer", "seed", "harvest", "wine", "part", "fluid", "other"]);
export type ArticleKind = z.infer<typeof articleKind>;

export const procedureDefinition = z.object({
  code: z.string(),
  label: z.string(),
  shape: procedureShape,
  category: procedureCategory,
  /** Natures d'articles acceptées en intrant (vide = aucun intrant). */
  inputKinds: z.array(articleKind),
  /** Natures d'articles acceptées en sortie (vide = aucune sortie). */
  outputKinds: z.array(articleKind),
  /** Procédure hors catalogue (reprise d'Ekylibre) : forme « travail » par défaut. */
  legacy: z.boolean().default(false),
  /** Icône Agric (procedure-icons.ts) ; à défaut, celle de la forme. */
  icon: z.string(),
});
export type ProcedureDefinition = z.infer<typeof procedureDefinition>;

/** Motifs de traitement : liste fermée, facultative (rien de coché par défaut). */
export const treatmentPurpose = z.enum([
  "herbicide",
  "fungicide",
  "insecticide",
  "acaricide",
  "molluscicide",
  "nematicide",
  "growth_regulator",
  "biostimulant",
  "desiccation",
  "other",
]);
export type TreatmentPurpose = z.infer<typeof treatmentPurpose>;

export const TREATMENT_PURPOSE_LABELS: Record<TreatmentPurpose, string> = {
  herbicide: "Herbicide",
  fungicide: "Fongicide",
  insecticide: "Insecticide",
  acaricide: "Acaricide",
  molluscicide: "Molluscicide",
  nematicide: "Nématicide",
  growth_regulator: "Régulateur de croissance",
  biostimulant: "Biostimulant",
  desiccation: "Défanage / dessiccation",
  other: "Autre",
};

/** Libellés des formes, pour les écrans. */
export const SHAPE_LABELS: Record<ProcedureShape, string> = {
  work: "Travail",
  treatment: "Traitement",
  fertilization: "Fertilisation",
  sowing: "Semis, plantation",
  harvest: "Récolte",
  maintenance: "Entretien",
};

type Def = [code: string, shape: ProcedureShape, category: ProcedureCategory, inputKinds?: ArticleKind[], outputKinds?: ArticleKind[]];

const WORK_SUPPLIES: ArticleKind[] = ["other"];
// Entretien : pièces et fluides (huiles, graisses, AdBlue), plus les fournitures.
const MAINTENANCE_SUPPLIES: ArticleKind[] = ["part", "fluid", "other"];

/** Catalogue v1 : procédures utilisées par les fermes pilotes + procédures courantes. */
const DEFINITIONS: Def[] = [
  // --- Cultures : travail du sol et entretien des cultures ---
  ["plowing", "work", "crops"],
  ["superficial_plowing", "work", "crops"],
  ["seedbed_preparing", "work", "crops"],
  ["raking", "work", "crops"],
  ["hoeing", "work", "crops"],
  ["inter_row_hoeing", "work", "crops"],
  ["rolling", "work", "crops"],
  ["crop_residues_grinding", "work", "crops"],
  ["plant_grinding", "work", "crops"],
  ["plant_mowing", "work", "crops"],
  ["hand_weeding", "work", "crops"],
  ["plant_watering", "work", "crops", ["other"]],
  ["watering", "work", "crops"],
  // --- Cultures : traitements, fertilisation, semis, récolte ---
  ["spraying", "treatment", "crops", ["phyto"]],
  ["generic_spraying", "treatment", "crops", ["phyto"]],
  ["spraying_on_cultivation", "treatment", "crops", ["phyto"]],
  ["spraying_on_land_parcel", "treatment", "crops", ["phyto"]],
  ["fertilizing", "fertilization", "crops", ["fertilizer"]],
  ["generic_fertilizing", "fertilization", "crops", ["fertilizer"]],
  ["mineral_fertilizing", "fertilization", "crops", ["fertilizer"]],
  ["organic_fertilizing", "fertilization", "crops", ["fertilizer"]],
  ["sowing", "sowing", "crops", ["seed"]],
  ["all_in_one_sowing", "sowing", "crops", ["seed", "fertilizer", "phyto"]],
  ["sowing_with_spraying", "sowing", "crops", ["seed", "phyto"]],
  ["plant_cover_sowing", "sowing", "crops", ["seed"]],
  ["implanting", "sowing", "crops", ["seed", "other"]],
  ["harvesting", "harvest", "crops", [], ["harvest"]],
  ["grains_harvest", "harvest", "crops", [], ["harvest"]],
  ["generic_harvesting", "harvest", "crops", [], ["harvest"]],
  // --- Vigne ---
  ["vine_pruning", "work", "vine"],
  ["vine_trunk_cleaning_debudding", "work", "vine"],
  ["vine_shearing", "work", "vine"],
  ["vine_folding", "work", "vine"],
  ["vine_lifting", "work", "vine"],
  ["vine_shoot_extracting", "work", "vine"],
  ["vine_trimming", "work", "vine"],
  ["vine_wire_lifting_dropping", "work", "vine"],
  ["vine_raking", "work", "vine"],
  ["vine_plowing", "work", "vine"],
  ["intervine_maintenance", "work", "vine"],
  ["intervine_hilling", "work", "vine"],
  ["intervine_hill_removing", "work", "vine"],
  ["vine_inter_row_grinding", "work", "vine"],
  ["vine_shoot_grinding", "work", "vine"],
  ["vine_grubbing", "work", "vine"],
  ["vine_trellising_construction", "work", "vine", WORK_SUPPLIES],
  ["vine_stakes_replacing", "work", "vine", WORK_SUPPLIES],
  ["vine_spraying_without_fertilizing", "treatment", "vine", ["phyto"]],
  ["vine_spraying_with_fertilizing", "treatment", "vine", ["phyto", "fertilizer"]],
  ["vine_soil_fertilizing", "fertilization", "vine", ["fertilizer"]],
  ["vine_inter_row_sowing", "sowing", "vine", ["seed"]],
  ["vine_planting", "sowing", "vine", ["seed", "other"]],
  ["vine_complanting", "sowing", "vine", ["seed", "other"]],
  ["manual_vine_harvest", "harvest", "vine", [], ["harvest"]],
  ["mecanical_vine_harvest", "harvest", "vine", [], ["harvest"]], // orthographe d'Ekylibre conservée
  // --- Matériel et bâtiments ---
  ["equipment_maintenance", "maintenance", "equipment", MAINTENANCE_SUPPLIES],
  ["installation_maintenance", "maintenance", "equipment", MAINTENANCE_SUPPLIES],
];

const humanize = (code: string) => code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const PROCEDURES: ProcedureDefinition[] = DEFINITIONS.map(([code, shape, category, inputKinds = [], outputKinds = []]) => ({
  code,
  label: PROCEDURE_LABELS[code] ?? humanize(code),
  shape,
  category,
  inputKinds,
  outputKinds,
  legacy: false,
  icon: procedureIcon(code, shape),
}));

const BY_CODE = new Map(PROCEDURES.map((p) => [p.code, p]));

/**
 * Définition d'une procédure. Un code inconnu du catalogue (reprise d'une
 * procédure Ekylibre rare) reste lisible : forme « travail », libellé
 * officiel d'Ekylibre, consommables acceptés.
 */
export function getProcedure(code: string): ProcedureDefinition {
  return (
    BY_CODE.get(code) ?? {
      code,
      label: PROCEDURE_LABELS[code] ?? humanize(code),
      shape: "work",
      category: "general",
      inputKinds: ["phyto", "fertilizer", "seed", "other"],
      outputKinds: [],
      legacy: true,
      icon: procedureIcon(code, "work"),
    }
  );
}

export { PROCEDURE_LABELS };

/**
 * Procédures d'irrigation (docs/modele-croissance.md) : leur dose d'eau
 * (bloc `irrigation` de l'intervention) alimente le bilan hydrique des
 * parcelles ciblées.
 */
export const IRRIGATION_PROCEDURES = ["watering", "plant_watering", "vine_watering"] as const;
export const isIrrigation = (code: string): boolean => (IRRIGATION_PROCEDURES as readonly string[]).includes(code);

/** Réponse de GET /procedures : catalogue + usage et suggestions de la ferme (3 dernières années). */
export type ProcedureCatalogueItem = ProcedureDefinition & {
  /** Nombre d'interventions réalisées avec cette procédure. */
  usage: number;
  /** Identifiants les plus utilisés avec cette procédure, du plus fréquent au moins fréquent. */
  suggestions: { tools: string[]; inputs: string[]; doers: string[] };
};
export type ProcedureCatalogue = {
  shapes: Record<ProcedureShape, string>;
  purposes: Record<TreatmentPurpose, string>;
  items: ProcedureCatalogueItem[];
};
