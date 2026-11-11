import { z } from "zod";
import { isoDate } from "./primitives.js";

/**
 * Fertilisation azotée (FR-REG-3, docs/fertilisation-design.md). Lot AE :
 * composition des fertilisants et azote apporté par une intervention.
 */

/** Base des teneurs : % de la masse (engrais minéraux), kg par tonne ou par m³ de produit brut (organiques). */
export const fertilizerBasis = z.enum(["mass_percent", "kg_per_t", "kg_per_m3"]);
export type FertilizerBasis = z.infer<typeof fertilizerBasis>;

export const FERTILIZER_BASIS_LABELS: Record<FertilizerBasis, string> = {
  mass_percent: "% de la masse",
  kg_per_t: "kg par tonne",
  kg_per_m3: "kg par m³",
};

/**
 * Types de fertilisants du programme d'actions nitrates (PAN 7, annexe I) :
 * 0 et I (organiques à minéralisation lente), II (organiques riches en azote
 * minéral : lisiers, fientes, digestats), III (engrais minéraux et uréiques).
 */
export const nitrateType = z.enum(["0", "Ia", "Ib", "II", "III"]);
export type NitrateType = z.infer<typeof nitrateType>;

export const NITRATE_TYPE_LABELS: Record<NitrateType, string> = {
  "0": "Type 0 (C/N > 20, organisation de l'azote)",
  Ia: "Type Ia (minéralisation très lente)",
  Ib: "Type Ib (minéralisation lente)",
  II: "Type II (minéralisation rapide : lisiers, fientes, digestats)",
  III: "Type III (engrais minéraux et uréiques)",
};

/** D'où vient la composition : proposée par Fourmy, reprise d'Ekylibre, confirmée par l'utilisateur, analyse. */
export const compositionOrigin = z.enum(["proposed", "migrated", "confirmed", "analysis"]);
export type CompositionOrigin = z.infer<typeof compositionOrigin>;

export const COMPOSITION_ORIGIN_LABELS: Record<CompositionOrigin, string> = {
  proposed: "Proposée",
  migrated: "Reprise d'Ekylibre",
  confirmed: "Confirmée",
  analysis: "Analyse",
};

const share = z.number().min(0).max(1);
const content = z.number().min(0).max(1000);

export const fertilizerComposition = z.object({
  basis: fertilizerBasis,
  /** Azote total, dans la base choisie. */
  nTotal: content,
  /** Part minérale de l'azote (NH4 + NO3) des organiques ; 1 pour un engrais minéral. */
  nMineralShare: share.nullable().default(null),
  p2o5: content.nullable().default(null),
  k2o: content.nullable().default(null),
  so3: content.nullable().default(null),
  /** Densité (kg/L), pour convertir une dose en litres. */
  density: z.number().positive().max(3).nullable().default(null),
  nitrateType: nitrateType.nullable().default(null),
  /** Apport foliaire : hors calendrier d'épandage. */
  foliar: z.boolean().default(false),
});
export type FertilizerComposition = z.infer<typeof fertilizerComposition>;

/** Saisie d'une composition (confirmée par l'utilisateur), avec la source de l'information. */
export const fertilizerWrite = fertilizerComposition.extend({ source: z.string().trim().max(200).nullable().default(null) });
export type FertilizerWrite = z.infer<typeof fertilizerWrite>;

/** Analyse d'un produit organique : remplace les valeurs de référence pendant 5 ans. */
export const productAnalysisWrite = z.object({
  sampledOn: isoDate,
  basis: z.enum(["kg_per_t", "kg_per_m3"]),
  dryMatter: z.number().min(0).max(100).nullable().default(null),
  nTotal: content,
  nNh4: content.nullable().default(null),
  cN: z.number().min(0).max(500).nullable().default(null),
  lab: z.string().trim().max(200).nullable().default(null),
});
export type ProductAnalysisWrite = z.infer<typeof productAnalysisWrite>;
export type ProductAnalysis = ProductAnalysisWrite & { id: string; articleId: string };

/** Validité d'une analyse de produit (référentiel Nouvelle-Aquitaine, art. 8). */
export const PRODUCT_ANALYSIS_VALID_YEARS = 5;

/** Fertilisant de la ferme : article, composition retenue (ou proposée), analyses. */
export interface FertilizerArticle {
  id: string;
  name: string;
  kind: string;
  unit: string;
  lexiconRef: string | null;
  composition: FertilizerComposition | null;
  origin: CompositionOrigin | null;
  source: string | null;
  /** Proposition de Fourmy (nom, Lexicon), même quand une composition est enregistrée : pour comparer. */
  proposal: (FertilizerComposition & { source: string }) | null;
  analyses: ProductAnalysis[];
  /** Interventions réalisées qui l'utilisent. */
  usage: number;
}

