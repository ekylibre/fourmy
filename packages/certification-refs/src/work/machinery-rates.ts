import type { RefSource } from "../source.js";
import { BCMA_2024 } from "./bcma-2024.js";

/**
 * Barème BCMA des matériels agricoles (lot IT4,
 * claudedocs/conception_assolement_itk.md §15.3) : pour chaque matériel,
 * performance par heure (ha/h pour les outils à l'hectare), prix d'achat,
 * utilisation annuelle, coûts fixe et variable. Accord du CEGARA et du BCMA du
 * 21/11/2026 ; extrait par `scripts/extract-bcma.ts` (`data/bcma-2024.csv`).
 * Les coûts serviront au temps 3 (FR-AS-30).
 */
export interface MachineryRate {
  id: string;
  family: string;
  /** Unité d'utilisation : hectares, heures, voyages, m3, tonnes… */
  unit: string;
  label: string;
  /** Largeur de travail lue dans le libellé, en mètres ; null si absente. */
  widthM: number | null;
  purchasePrice: number;
  annualUse: number;
  fixedCost: number;
  variableCost: number;
  costPerUnit: number;
  /** Performance en unités par heure (ha/h quand `unit` = hectares). */
  performancePerH: number;
  costPerHour: number;
}

export const MACHINERY_RATES_SOURCE: RefSource = {
  text: "Barème BCMA, guides CEGARA « Coût des façons culturales » (grandes cultures, viti-arbo)",
  version: "édition 2024",
  at: "tableaux par famille de matériels, colonne « Performance en unité par h »",
};
export const MACHINERY_RATES_EDITION = "2024";
export const MACHINERY_RATES: readonly MachineryRate[] = BCMA_2024;

const BY_ID = new Map(MACHINERY_RATES.map((r) => [r.id, r]));
export const machineryRate = (id: string | null | undefined): MachineryRate | null => (id ? (BY_ID.get(id) ?? null) : null);

/** Débit à l'hectare d'une ligne (ha/h) ; null si son unité n'est pas l'hectare. */
export const hectareRate = (r: MachineryRate): number | null => (r.unit === "hectares" && r.performancePerH > 0 ? r.performancePerH : null);

/**
 * Familles du barème proposées pour une procédure (choix d'un type de
 * matériel dans une étape, débit de repli par la largeur). Correspondance
 * établie à la main sur les intitulés des familles.
 */
export const PROCEDURE_FAMILIES: Record<string, string[]> = {
  plowing: ["Travail du sol profond ou semi-profond"],
  superficial_plowing: ["Outils de travail du sol superficiel"],
  seedbed_preparing: ["Outils de travail du sol superficiel"],
  raking: ["Outils de travail du sol superficiel"],
  rolling: ["Outils de travail du sol superficiel"],
  hoeing: ["Outils de désherbage mécanique et alternatif"],
  inter_row_hoeing: ["Outils de désherbage mécanique et alternatif", "Autres semoirs - Planteuses et bineuses"],
  sowing: ["Semis"],
  all_in_one_sowing: ["Semis"],
  sowing_with_spraying: ["Semis"],
  plant_cover_sowing: ["Semis"],
  implanting: ["Autres semoirs - Planteuses et bineuses"],
  spraying: ["Pulvérisateur"],
  generic_spraying: ["Pulvérisateur"],
  spraying_on_cultivation: ["Pulvérisateur"],
  spraying_on_land_parcel: ["Pulvérisateur"],
  fertilizing: ["Distributeur d'engrais minéraux"],
  generic_fertilizing: ["Distributeur d'engrais minéraux"],
  mineral_fertilizing: ["Distributeur d'engrais minéraux"],
  organic_fertilizing: ["Effluents d'élevage"],
  harvesting: ["Moissonneuse-batteuse", "Récolte de betteraves", "Récolte de pommes de terre", "Récolte du lin", "Matériels spécifiques Maïs épis et semences"],
  grains_harvest: ["Moissonneuse-batteuse"],
  generic_harvesting: ["Moissonneuse-batteuse", "Récolte de betteraves", "Récolte de pommes de terre", "Récolte du lin"],
  crop_residues_grinding: ["Matériels de broyage et débroussaillage"],
  plant_grinding: ["Matériels de broyage et débroussaillage"],
  plant_mowing: ["Matériels de fenaison 1", "Matériels de fenaison 2"],
  watering: ["Irrigation"],
  plant_watering: ["Irrigation"],
  vine_plowing: ["Travail du sol et entretien de l'inter-rangs"],
  intervine_maintenance: ["Travail du sol et entretien de l'inter-rangs"],
  intervine_hilling: ["Travail du sol et entretien de l'inter-rangs"],
  intervine_hill_removing: ["Travail du sol et entretien de l'inter-rangs"],
  vine_inter_row_grinding: ["Travail du sol et entretien de l'inter-rangs"],
  vine_shoot_grinding: ["Travail du sol et entretien de l'inter-rangs"],
  vine_spraying_without_fertilizing: ["Poudreuse et pulvérisateur"],
  vine_spraying_with_fertilizing: ["Poudreuse et pulvérisateur"],
  vine_trimming: ["Travail de la plante et en vert 1", "Travail de la plante et en vert 2"],
  vine_pruning: ["Travail de la plante et en vert 1", "Travail de la plante et en vert 2"],
  vine_shearing: ["Travail de la plante et en vert 1", "Travail de la plante et en vert 2"],
  mecanical_vine_harvest: ["Récolte vigne"],
};

/** Lignes du barème proposées pour une procédure (toutes si aucune famille connue). */
export function machineryRatesFor(procedure: string | null): readonly MachineryRate[] {
  const families = procedure ? PROCEDURE_FAMILIES[procedure] : undefined;
  return families ? MACHINERY_RATES.filter((r) => families.includes(r.family)) : MACHINERY_RATES;
}

/**
 * Débit par mètre de largeur (ha/h/m) d'une famille : médiane des lignes à
 * l'hectare dont la largeur est connue. Repli « largeur × vitesse déduite du
 * barème » d'un matériel de la ferme sans ligne rattachée.
 */
export function familyRatePerMeter(family: string): number | null {
  const ratios = MACHINERY_RATES.filter((r) => r.family === family && r.widthM && hectareRate(r)).map((r) => hectareRate(r)! / r.widthM!);
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  const m = Math.floor(ratios.length / 2);
  return ratios.length % 2 ? ratios[m]! : (ratios[m - 1]! + ratios[m]!) / 2;
}

/** Gabarit d'avatar ou type de matériel de Fourmy → familles du barème (proposition de rattachement). */
export const EQUIPMENT_TYPE_FAMILIES: Record<string, string[]> = {
  sower: ["Semis", "Autres semoirs - Planteuses et bineuses"],
  rotary_harrow: ["Outils de travail du sol superficiel"],
  plough: ["Travail du sol profond ou semi-profond"],
  disc_harrow: ["Outils de travail du sol superficiel"],
  cultivator: ["Outils de travail du sol superficiel", "Travail du sol profond ou semi-profond"],
  roller: ["Outils de travail du sol superficiel"],
  shredder: ["Matériels de broyage et débroussaillage"],
  mounted_sprayer: ["Pulvérisateur"],
  trailed_sprayer: ["Pulvérisateur"],
  fertilizer_spreader: ["Distributeur d'engrais minéraux", "Effluents d'élevage"],
  self_propelled: ["Moissonneuse-batteuse", "Pulvérisateur"],
};

/** Ligne proposée pour un matériel : familles de son type, largeur la plus proche (sinon la première). */
export function suggestMachineryRate(type: string | null, widthM: number | null): MachineryRate | null {
  const families = type ? EQUIPMENT_TYPE_FAMILIES[type] : undefined;
  if (!families) return null;
  const candidates = MACHINERY_RATES.filter((r) => families.includes(r.family) && hectareRate(r));
  if (!candidates.length) return null;
  if (!widthM) return candidates[0]!;
  return [...candidates].filter((r) => r.widthM).sort((a, b) => Math.abs(a.widthM! - widthM) - Math.abs(b.widthM! - widthM))[0] ?? candidates[0]!;
}
