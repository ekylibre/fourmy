/**
 * Types des référentiels de la fertilisation azotée (docs/fertilisation-design.md
 * §5). Chaque table porte sa source : texte, organisme, date, page, licence.
 * Les valeurs sont recopiées des textes officiels ; un test recalcule les
 * exemples qu'ils impriment.
 */

export interface Source {
  title: string;
  organisation: string;
  /** Date du texte ou de la mise à jour (AAAA-MM-JJ). */
  date: string;
  url: string;
  /** Annexe, tableau et page du document. */
  ref?: string;
  /** Conditions de réutilisation connues ; « à confirmer » tant que l'accord n'est pas obtenu. */
  licence: string;
}

export interface Table<R> {
  id: string;
  source: Source;
  notes?: string[];
  rows: R[];
}

/** Groupes de cultures du référentiel (clés stables, indépendantes des libellés). */
export const CROP_GROUPS = [
  "maize_grain",
  "maize_silage",
  "maize_sweet",
  "maize_seed",
  "maize_popcorn",
  "sorghum_grain",
  "sorghum_silage",
  "soft_wheat",
  "durum_wheat",
  "improver_wheat",
  "barley_winter",
  "barley_spring",
  "oat",
  "rye",
  "triticale",
  "spelt",
  "rapeseed_winter",
  "sunflower",
  "flax",
  "hemp",
  "tobacco",
  "seed_crops",
  "grassland",
  "vegetables",
  "legumes",
  "cover_crop",
  "vine",
  "orchard",
  "kiwi",
  "walnut",
  "ppam",
  "other",
] as const;
export type CropGroup = (typeof CROP_GROUPS)[number];

/** Types de sols du référentiel Nouvelle-Aquitaine (annexe 7). */
export const NA_SOIL_TYPES = [
  "argilo_calcaire",
  "sableux",
  "fond_vallee_terres_noires",
  "marais_argileux_sodiques",
  "limoneux",
  "terrasses_vallees",
  "sur_granite",
  "argileux_sablo_argileux",
] as const;
export type NaSoilType = (typeof NA_SOIL_TYPES)[number];

/** Libellés des types de sols de l'annexe 7 (exemples de noms vernaculaires entre parenthèses). */
export const NA_SOIL_TYPE_LABELS: Record<NaSoilType, string> = {
  argilo_calcaire: "Argilo-calcaire (groies, aubues, champagnes)",
  sableux: "Sols sableux (doucins sableux, podzols)",
  fond_vallee_terres_noires: "Fond de vallée, terres noires (touyas)",
  marais_argileux_sodiques: "Marais argileux sodiques",
  limoneux: "Sols limoneux (bornais, limons, doucins limoneux)",
  terrasses_vallees: "Terrasses de vallées (alluvions, boulbènes)",
  sur_granite: "Sols sur granite",
  argileux_sablo_argileux: "Argileux à sablo-argileux (terreforts, coteaux molassiques du piémont pyrénéen)",
};

export const isNaSoilType = (v: string): v is NaSoilType => (NA_SOIL_TYPES as readonly string[]).includes(v);

/** Écritures opérationnelles du bilan et autres méthodes (annexe 1). */
export type Method = "bilan_additive" | "bilan_cau" | "bilan_cau_two_phase" | "pivot" | "ceiling";

/** Classes de date d'ouverture du bilan des tables Mr et MrCi. */
export type Opening = "end_of_winter" | "april";

/** Périodes d'apport des produits organiques (annexe 5). */
export type ApplicationPeriod = "late_summer" | "autumn" | "winter" | "spring" | "after_opening";
