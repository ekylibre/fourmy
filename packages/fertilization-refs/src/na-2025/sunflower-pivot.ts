/**
 * Annexe 3.1 du référentiel GREN Nouvelle-Aquitaine (arrêté du 29/07/2025) :
 * tournesol, méthode de la dose pivot, tous départements.
 * Recopié et contrôlé sur le rendu des pages.
 */

import type { Source, Table } from "../types.js";

const SRC = {
  title: "Arrêté référentiel GREN Nouvelle-Aquitaine – Annexe 3.1 : fertilisation du tournesol, méthode pivot",
  organisation: "Préfecture de la région Nouvelle-Aquitaine (GREN)",
  date: "2025-07-29",
  url: "https://www.nouvelle-aquitaine.developpement-durable.gouv.fr/IMG/pdf/3_1_tournesol_pivot_gren_na_vdef.pdf",
  licence: "Arrêté préfectoral publié (document administratif) ; valeurs citées de leurs organismes",
} satisfies Omit<Source, "ref">;

/** Règles textuelles de l'annexe 3 (intro) et 3.1. */
export const naSunflowerPivotRules = {
  inequality: "X + Nirr + Xa ≤ Dose pivot",
  unit: "La dose pivot d’azote prévisionnelle est exprimée en kg d’azote efficace par hectare.",
  methods: ["soit en fonction de l'objectif de rendement (tableau 2)", "soit selon la méthode dite « Héliotest » (tableau 3)"],
  intro: [
    "Une dose pivot est une dose à partir de laquelle on peut faire des ajustements en plus ou en moins.",
    "Ces doses correspondent à un apport d’azote maximum.",
    "Un raisonnement de la fertilisation conduisant à des doses d’apport inférieures est recommandé.",
  ],
  yieldTarget: "Le calcul de l'objectif de rendement est décrit dans l'article 2 de l'arrêté préfectoral.",
  sowingResidue: [
    "Pour les tournesols irrigués et pour les tournesols non irrigués, les préconisations sont déterminées en fonction de l'objectif de rendement.",
    "Les reliquats d’azote au semis se mesurent en prélevant des échantillons de sol à différentes profondeurs, par couche de 30 cm d'épaisseur jusqu'à 90 cm, voire 120 cm pour les sols les plus profonds.",
    "A défaut, les valeurs de reliquat d’azote au semis sont déterminées selon les méthodes décrites à l’article 8 de l'arrêté préfectoral.",
  ],
  heliotest: [
    "La méthode Héliotest ne peut être utilisée que par les agriculteurs qui maîtrisent parfaitement la quantité d'azote apportée sur la bande témoin (fertilisation exclusivement minérale ou épandage homogène de produits résiduaires organiques dont la valeur azotée précise est connue).",
    "1re étape : l’agriculteur applique 60 à 80 unités d’azote au semis sur une bande de la parcelle mais n'applique aucune fertilisation sur le reste de la parcelle.",
    "2e étape : l’agriculteur observe si une éventuelle différence apparaît entre la bande témoin fertilisée au semis et le reste de la parcelle entre le stade 6 et 14 feuilles (différence de couleur, de hauteur ou de volume).",
    "Aucune fertilisation minérale azotée n'est nécessaire en l'absence de différence avec le témoin entre le stade 6 et 14 feuilles.",
  ],
  nirr: "Nirr = (Q H2O) x (T NO3) / 443 ; seulement si l'eau prévue est supérieure à 100 mm ; T NO3 de référence 25 mg/L (superficielle), 40 mg/L (souterraine). Tables identiques à l'annexe 2.4 (voir naRapeseedIrrigation).",
  xa: "Xa = Npro x Q x Keq (annexe 5) ; les Xa de plusieurs produits ou dates s’additionnent.",
} as const;

export interface SunflowerYieldPivotRow {
  /** Classe d'objectif de rendement telle qu'imprimée. */
  yieldClass: string;
  /** Borne basse incluse (q/ha), null si aucune. */
  yieldMinQHa: number | null;
  /** Borne haute exclue (q/ha), null si aucune. */
  yieldMaxExclQHa: number | null;
  /** Reliquat azoté au semis faible (30 kgN/ha). */
  lowResidue30: number;
  /** Reliquat azoté au semis moyen (60 kgN/ha). */
  mediumResidue60: number;
  /** Reliquat azoté au semis élevé (90 kgN/ha). */
  highResidue90: number;
}

export const naSunflowerPivotByYield: Table<SunflowerYieldPivotRow> = {
  id: "na-2025/sunflower-pivot-yield",
  source: { ...SRC, ref: "Annexe 3.1, tableau 2 : dose pivot en fonction de l’objectif de rendement, p. 1" },
  notes: [
    "Doses pivot en kgN/ha (azote efficace). Source : GREN.",
    "Les colonnes de reliquat sont des classes nommées par une valeur (30, 60, 90 kgN/ha) ; l'annexe ne fixe pas de seuils entre classes ni d'interpolation.",
  ],
  rows: [
    { yieldClass: "≥ 35 q/ha", yieldMinQHa: 35, yieldMaxExclQHa: null, lowResidue30: 90, mediumResidue60: 60, highResidue90: 30 },
    { yieldClass: "≥ 30 q/ha et < 35 q/ha", yieldMinQHa: 30, yieldMaxExclQHa: 35, lowResidue30: 75, mediumResidue60: 45, highResidue90: 15 },
    { yieldClass: "< 30 q/ha", yieldMinQHa: null, yieldMaxExclQHa: 30, lowResidue30: 60, mediumResidue60: 30, highResidue90: 0 },
  ],
};

export interface SunflowerHeliotestRow {
  /** « Stade d’apparition de la différence avec le témoin ». */
  stage: string;
  minLeaves: number;
  maxLeaves: number;
  /** Colonnes 20 - 25, 25 - 30, 30 - 35, 35 - 40, ≥ 40 q/ha. */
  y20to25: number;
  y25to30: number;
  y30to35: number;
  y35to40: number;
  y40plus: number;
}

export const naSunflowerHeliotest: Table<SunflowerHeliotestRow> = {
  id: "na-2025/sunflower-heliotest",
  source: { ...SRC, ref: "Annexe 3.1, tableau 3 : méthode Héliotest, dose pivot d’azote à apporter (kgN/ha) suivant le constat entre le stade 6 et 14 feuilles, p. 2" },
  notes: [
    "Source : Terres Inovia.",
    "Classes de rendement imprimées « 20 - 25 », « 25 - 30 », « 30 - 35 », « 35 - 40 », « ≥ 40 q/ha » : bornes partagées sans indication d'inclusion ; aucun objectif < 20 q/ha n'est couvert.",
    "Pas de ligne pour une différence apparue à 6 feuilles ; en l'absence de différence entre 6 et 14 feuilles, aucune fertilisation minérale n'est nécessaire.",
  ],
  rows: [
    { stage: "7 à 8 feuilles", minLeaves: 7, maxLeaves: 8, y20to25: 0, y25to30: 30, y30to35: 40, y35to40: 70, y40plus: 100 },
    { stage: "9 à 10 feuilles", minLeaves: 9, maxLeaves: 10, y20to25: 0, y25to30: 0, y30to35: 30, y35to40: 50, y40plus: 80 },
    { stage: "11 à 12 feuilles", minLeaves: 11, maxLeaves: 12, y20to25: 0, y25to30: 0, y30to35: 0, y35to40: 30, y40plus: 60 },
    { stage: "13 à 14 feuilles", minLeaves: 13, maxLeaves: 14, y20to25: 0, y25to30: 0, y30to35: 0, y35to40: 30, y40plus: 40 },
  ],
};
