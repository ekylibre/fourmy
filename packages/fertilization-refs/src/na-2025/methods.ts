/**
 * Annexe 1 du référentiel GREN Nouvelle-Aquitaine (arrêté du 29/07/2025) :
 * méthode de calcul de la dose prévisionnelle par culture et par département.
 */

import type { CropGroup, Method, Table } from "../types.js";

export type NaDepartment = "16" | "17" | "19" | "23" | "24" | "33" | "40" | "47" | "64" | "79" | "86" | "87";

export const NA_DEPARTMENTS: readonly NaDepartment[] = ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"];

/** Départements où bilan additif et bilan CAU sont au choix (annexes x.a). */
export const NA_DEPTS_ADDITIVE: readonly NaDepartment[] = ["16", "17", "79", "86"];
/** Départements en bilan CAU (annexes x.b). */
export const NA_DEPTS_CAU: readonly NaDepartment[] = ["19", "23", "24", "33", "40", "47", "64", "87"];

export interface NaMethodRow {
  /** Libellé « CULTURE » tel qu'imprimé. */
  cropLabel: string;
  crops: CropGroup[];
  method: Method;
  departments: NaDepartment[] | "all";
  /** Annexe du référentiel (ex. « 2.2.b »). */
  annex: string;
  /** Libellé de la méthode tel qu'imprimé. */
  methodLabel: string;
  /** Restriction imprimée dans l'annexe 1. */
  condition?: string;
}

const CEREALS: CropGroup[] = ["soft_wheat", "durum_wheat", "improver_wheat", "barley_winter", "barley_spring", "oat", "rye", "triticale", "spelt"];
const MAIZE_SORGHUM: CropGroup[] = ["maize_grain", "maize_silage", "maize_sweet", "maize_seed", "maize_popcorn", "sorghum_grain", "sorghum_silage"];
const A = [...NA_DEPTS_ADDITIVE];
const C = [...NA_DEPTS_CAU];

export const naMethods: Table<NaMethodRow> = {
  id: "na-2025/methods",
  source: {
    title: "Arrêté référentiel GREN Nouvelle-Aquitaine – Annexe 1 : sommaire, méthodes de calcul de la dose prévisionnelle",
    organisation: "Préfecture de la région Nouvelle-Aquitaine (GREN)",
    date: "2025-07-29",
    url: "https://www.nouvelle-aquitaine.developpement-durable.gouv.fr/IMG/pdf/1_sommaire_gren_na_vdef.pdf",
    ref: "Annexe 1, tableau récapitulatif, p. 1",
    licence: "Arrêté préfectoral publié (document administratif) ; valeurs citées de leurs organismes",
  },
  notes: [
    "Dans les départements 16, 17, 79 et 86, céréales à paille et maïs-sorgho : « Bilan additif ou bilan CAU » dans la même annexe (2.1.a, 2.2.a) ; deux lignes sont donc données, au choix de l'exploitant.",
    "Tabac 16, 17, 79, 86 : bilan additif seul (2.3.a).",
    "Pour le maïs et le sorgho, la méthode CAU est codée bilan_cau_two_phase ; pour céréales, tabac et prairies, bilan_cau.",
    "« Autres cultures » (4.4) regroupe arboriculture, vigne, PPAM, porte-graines sans bilan opérationnel, chanvre, sarrasin et la dose plafond par défaut de 210 kgN/ha.",
    "Annexes transversales : 5 (produits résiduaires organiques), 6 (RSH), 7 (types de sols), 8 (volatilisation).",
  ],
  rows: [
    { cropLabel: "Céréales à paille", crops: CEREALS, method: "bilan_additive", departments: A, annex: "2.1.a", methodLabel: "Bilan additif ou bilan CAU pour les départements 16, 17, 79 et 86" },
    { cropLabel: "Céréales à paille", crops: CEREALS, method: "bilan_cau", departments: A, annex: "2.1.a", methodLabel: "Bilan additif ou bilan CAU pour les départements 16, 17, 79 et 86" },
    { cropLabel: "Céréales à paille", crops: CEREALS, method: "bilan_cau", departments: C, annex: "2.1.b", methodLabel: "Bilan CAU pour les départements 19, 23, 24, 33, 40, 47, 64 et 87" },
    { cropLabel: "Maïs et sorgho", crops: MAIZE_SORGHUM, method: "bilan_additive", departments: A, annex: "2.2.a", methodLabel: "Bilan additif ou bilan CAU pour les départements 16, 17, 79 et 86" },
    { cropLabel: "Maïs et sorgho", crops: MAIZE_SORGHUM, method: "bilan_cau_two_phase", departments: A, annex: "2.2.a", methodLabel: "Bilan additif ou bilan CAU pour les départements 16, 17, 79 et 86" },
    { cropLabel: "Maïs et sorgho", crops: MAIZE_SORGHUM, method: "bilan_cau_two_phase", departments: C, annex: "2.2.b", methodLabel: "Bilan CAU pour les départements 19, 23, 24, 33, 40, 47, 64 et 87" },
    { cropLabel: "Tabac", crops: ["tobacco"], method: "bilan_additive", departments: A, annex: "2.3.a", methodLabel: "Bilan additif pour les départements 16, 17, 79 et 86" },
    { cropLabel: "Tabac", crops: ["tobacco"], method: "bilan_cau", departments: C, annex: "2.3.b", methodLabel: "Bilan CAU pour les départements 19, 23, 24, 33, 40, 47, 64 et 87" },
    { cropLabel: "Colza", crops: ["rapeseed_winter"], method: "bilan_additive", departments: "all", annex: "2.4", methodLabel: "Bilan additif pour toute la Nouvelle-Aquitaine" },
    { cropLabel: "Lin", crops: ["flax"], method: "bilan_additive", departments: "all", annex: "2.5", methodLabel: "Bilan additif pour toute la Nouvelle-Aquitaine" },
    {
      cropLabel: "Cultures porte-graines",
      crops: ["seed_crops"],
      method: "bilan_additive",
      departments: "all",
      annex: "2.6",
      methodLabel: "Bilan additif pour toute la Nouvelle-Aquitaine pour les cultures listées dans l’annexe",
      condition: "Uniquement les cultures porte-graines listées dans l'annexe 2.6 ; les autres relèvent de la dose plafond (annexe 4.4 §3).",
    },
    { cropLabel: "Prairies", crops: ["grassland"], method: "bilan_cau", departments: "all", annex: "2.7", methodLabel: "Bilan CAU pour toute la Nouvelle-Aquitaine" },
    { cropLabel: "Tournesol", crops: ["sunflower"], method: "pivot", departments: "all", annex: "3.1", methodLabel: "Pivot pour toute la Nouvelle-Aquitaine" },
    { cropLabel: "Kiwi", crops: ["kiwi"], method: "pivot", departments: "all", annex: "3.2", methodLabel: "Pivot pour toute la Nouvelle-Aquitaine" },
    { cropLabel: "Noyer", crops: ["walnut"], method: "pivot", departments: "all", annex: "3.3", methodLabel: "Pivot pour toute la Nouvelle-Aquitaine" },
    { cropLabel: "Légumes de plein champ et cultures maraîchères", crops: ["vegetables"], method: "ceiling", departments: "all", annex: "4.1", methodLabel: "Plafond pour toute la Nouvelle-Aquitaine" },
    { cropLabel: "Légumineuses", crops: ["legumes"], method: "ceiling", departments: "all", annex: "4.2", methodLabel: "Plafond pour toute la Nouvelle-Aquitaine" },
    { cropLabel: "Cultures intermédiaires", crops: ["cover_crop"], method: "ceiling", departments: "all", annex: "4.3", methodLabel: "Plafond pour toute la Nouvelle-Aquitaine" },
    {
      cropLabel: "Autres cultures",
      crops: ["vine", "orchard", "ppam", "hemp", "seed_crops", "other"],
      method: "ceiling",
      departments: "all",
      annex: "4.4",
      methodLabel: "Plafond pour toute la Nouvelle-Aquitaine",
      condition: "Cultures non couvertes par les annexes 2, 3, 4.1 à 4.3 ; porte-graines seulement si la méthode du bilan n'est pas opérationnelle (non listées en 2.6).",
    },
  ],
};
