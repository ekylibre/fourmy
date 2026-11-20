import type { ProcedureShape } from "./procedures.js";

/**
 * Icônes des procédures (exigences INT-UI-1) : noms du jeu d'icônes Agric
 * d'Ekylibre (github.com/ekylibre/agric, MIT). Ekylibre n'associe pas
 * d'icône aux procédures : correspondance choisie pour Fourmy. Une procédure
 * absente de cette table prend l'icône de sa forme.
 *
 * Les dessins sont intégrés dans l'application web
 * (`apps/web/src/icons/agric.ts`, généré par `apps/web/scripts/agric-icons.mjs`) :
 * ajouter un nom ici impose de régénérer ce fichier (un test le vérifie).
 */

export const SHAPE_ICONS: Record<ProcedureShape, string> = {
  work: "tractor-alt",
  treatment: "sprayer",
  fertilization: "fertilization",
  sowing: "seeding",
  harvest: "harvesting",
  maintenance: "tools",
};

export const PROCEDURE_ICONS: Record<string, string> = {
  // Cultures : travail du sol et entretien
  plowing: "plow",
  superficial_plowing: "superficial-plow",
  seedbed_preparing: "seedbed-preparator",
  raking: "harrow",
  hoeing: "hoe",
  inter_row_hoeing: "hoe-weeder",
  rolling: "roll",
  crop_residues_grinding: "grinder",
  plant_grinding: "shoot-grinder",
  plant_mowing: "mower",
  hand_weeding: "seedling-solid",
  plant_watering: "irrigation",
  watering: "irrigation",
  // Cultures : traitements, fertilisation, semis, récolte
  spraying: "sprayer",
  generic_spraying: "spraying",
  spraying_on_cultivation: "crop-protection",
  spraying_on_land_parcel: "spraying",
  fertilizing: "fertilization",
  generic_fertilizing: "fertilization",
  mineral_fertilizing: "sower",
  organic_fertilizing: "raised-manure",
  sowing: "seeding",
  all_in_one_sowing: "implanter",
  sowing_with_spraying: "airplanter",
  plant_cover_sowing: "cover-implanter",
  implanting: "net-implanter",
  harvesting: "harvester",
  grains_harvest: "wheat",
  generic_harvesting: "harvesting",
  // Vigne
  vine_pruning: "cutter",
  vine_trunk_cleaning_debudding: "cut",
  vine_shearing: "mower", // libellé Ekylibre : « Tonte »
  vine_folding: "wire-fence",
  vine_lifting: "wire-lifter",
  vine_shoot_extracting: "vine-extractor",
  vine_trimming: "vine-trimmer",
  vine_wire_lifting_dropping: "wire-lifter",
  vine_raking: "disc-harrow",
  vine_plowing: "soil-loosener",
  intervine_maintenance: "hoe-weeder",
  intervine_hilling: "soil-preparation",
  intervine_hill_removing: "vibrocultivator",
  vine_inter_row_grinding: "grinder",
  vine_shoot_grinding: "shoot-grinder",
  vine_grubbing: "subsoil-plow",
  vine_trellising_construction: "wire-fence",
  vine_stakes_replacing: "stakes",
  vine_spraying_without_fertilizing: "sprayer",
  vine_spraying_with_fertilizing: "spraying",
  vine_soil_fertilizing: "spreader-trailer",
  vine_inter_row_sowing: "cover-implanter",
  vine_planting: "seedling-solid", // « vine » d'Agric est le logo du réseau Vine
  vine_complanting: "seedling-solid",
  manual_vine_harvest: "grape",
  mecanical_vine_harvest: "grape-harvester",
  // Matériel et bâtiments
  equipment_maintenance: "tools",
  equipment_cleaning: "tools",
  installation_maintenance: "wrench",
};

/** Icône d'une procédure : la sienne, sinon celle de sa forme. */
export function procedureIcon(code: string, shape: ProcedureShape): string {
  return PROCEDURE_ICONS[code] ?? SHAPE_ICONS[shape];
}

/** Tous les noms d'icônes utilisés (pour générer les dessins). */
export const AGRIC_ICON_NAMES: string[] = [...new Set([...Object.values(SHAPE_ICONS), ...Object.values(PROCEDURE_ICONS)])].sort();
