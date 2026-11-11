/**
 * Annexe 2.4 du référentiel GREN Nouvelle-Aquitaine (arrêté du 29/07/2025) :
 * colza d'hiver, méthode du bilan additif, tous départements.
 * Recopié et contrôlé sur le rendu des pages.
 */

import type { Source, Table } from "../types.js";

const SRC = {
  title: "Arrêté référentiel GREN Nouvelle-Aquitaine – Annexe 2.4 : fertilisation du colza d'hiver, méthode bilan additif",
  organisation: "Préfecture de la région Nouvelle-Aquitaine (GREN)",
  date: "2025-07-29",
  url: "https://www.nouvelle-aquitaine.developpement-durable.gouv.fr/IMG/pdf/2_4_colza_bilan_gren_na_vdef.pdf",
  licence: "Arrêté préfectoral publié (document administratif) ; valeurs citées de leurs organismes",
} satisfies Omit<Source, "ref">;

/** Équation et constantes de l'annexe 2.4 (texte cité, p. 1-6). */
export const naRapeseedEquation = {
  equation: "X = (Pf + Rf) – (Pi + Ri + M + Fleg + Fass + Mha + Nirr + Xa)",
  terms: {
    X: "Fertilisation azotée minérale",
    Pf: "Quantité d’azote absorbé par la culture à la fermeture du bilan",
    Rf: "Quantité d’azote minéral dans le sol à la fermeture du bilan",
    Pi: "Quantité d’azote absorbé par la culture à l'ouverture du bilan",
    Ri: "Quantité d’azote minéral dans le sol à l’ouverture du bilan",
    M: "Minéralisation nette de l’humus du sol et des résidus de récolte du précédent (Mh + Mr)",
    Fleg: "Supplément de fourniture d’azote lié à un précédent pois protéagineux",
    Fass: "Supplément de fourniture d’azote lié à des cultures compagnes",
    Mha: "Fourniture d’azote liée à l’historique d’apport de produits résiduaires organiques",
    Nirr: "Apport d'azote par l'eau d'irrigation",
    Xa: "Équivalent engrais minéral de l'azote fourni par les produits résiduaires organiques",
  },
  /** « X est plafonné à 250 unités d’azote quel que soit le résultat du calcul. » */
  xMaxKgNHa: 250,
  /** Pf = b x y ; b = 7 kgN/q/ha (Terres Inovia). */
  pf: "Pf = b x y",
  bKgNPerQ: 7,
  bSource: "Terres Inovia",
  /** « Plafonnement de Pf : si b x y > 330, alors Pf = 330 kgN/ha. » */
  pfMaxKgNHa: 330,
  /** Fleg = 25 kgN/ha en cas de précédent pois protéagineux, sinon 0. */
  flegPeaPreviousKgNHa: 25,
  /** Fass = 30 kgN/ha si colza associé à un couvert de légumineuses correctement levé et à croissance suffisante, sinon 0 (Terres Inovia). */
  fassLegumeCompanionKgNHa: 30,
  fassCondition:
    "Fass = 30 kgN/ha dans le cas où le colza est associé à un couvert de légumineuses, si ce couvert a correctement levé et si sa croissance est suffisante. Sinon Fass = 0. L’exploitant agricole décrit la croissance des légumineuses dans son cahier d’enregistrement des pratiques",
  xa: "Xa = Npro x Q x Keq bilan (annexe 5 ; apport de fin d’été ou d’automne, ou de printemps) ; les Xa de plusieurs produits ou dates s’additionnent.",
  nirr: "Nirr = (Q H2O) x (T NO3) / 443 ; pris en compte seulement si la quantité d'eau prévue est supérieure à 100 mm ; T NO3 de référence = 25 mg/L (eau superficielle), 40 mg/L (eau souterraine), valeur inférieure possible en eau souterraine si justifiée (analyse, bandelette pendant l'irrigation, références locales annuelles).",
  openingRules: [
    "Pour être valables, tous les termes du bilan doivent être calculés, mesurés ou évalués à la même date. Ainsi, la date de prélèvement et donc de mesure de Ri est aussi la date d’ouverture du bilan.",
    "Pour les cultures d’hiver, il est recommandé d’ouvrir le bilan avant tout apport minéral ou organique sur la culture et de préférence après la phase de drainage la plus importante.",
  ],
} as const;

/**
 * Calcul de Pi (annexe 2.4 §3, p. 2-3) : règles citées. Le moteur de dose
 * doit les implémenter ; ce ne sont pas des tables.
 */
export const naRapeseedPi = {
  coeffEH: 50,
  coeffSH: 65,
  nabs: "Nabs = MV x coeff ; Nabs EH = MV EH x 50 ; Nabs SH = MV SH x 65 (MV en kg/m², Nabs en kgN/ha)",
  rules: [
    "En l’absence de gel hivernal : si Nabs SH (MV SH x 65) est supérieur ou égal à Nabs EH (MV EH x 50), ou si MV EH n’est pas disponible, alors Pi = MV SH x 65",
    "En cas de gel hivernal, si Nabs SH (MV SH x 65) est inférieur à Nabs EH (MV EH x 50), alors Pi = (MV SH x 65) + 0,5 x (MV EH x 50 – MV SH x 65) / 1,35",
    "Dans tous les cas, si le poids frais de la matière verte en sortie hiver MV SH n’est pas disponible, alors le calcul de Pi est impossible (impossibilité de calculer le bilan sans intégrer l’absorption automnale).",
  ],
  /** Formule gel, telle qu'imprimée : la fraction porte sur (MV EH x 50 – MV SH x 65), divisée par 1,35. */
  frostFormula: "Pi = (MV SH x 65) + 0,5 x (MV EH x 50 – MV SH x 65) / 1,35",
  weighing: [
    "Si le gel est fréquent : 1re pesée en entrée d’hiver (EH) avant la destruction des feuilles par le gel, puis 2e pesée en sortie d’hiver (SH) juste avant le 1er apport d’azote à la reprise de végétation.",
    "Si le gel est peu fréquent : pesée unique en sortie d’hiver (SH).",
    "Réaliser une pesée pour chaque parcelle représentative.",
    "Placettes de 1 m² représentatives, en évitant les bordures : 2 placettes si la parcelle est homogène, 4 si elle est hétérogène.",
    "Secouer les plantes (rosée, pluie), enlever les mottes, couper au ras du sol, peser (kg/m²).",
    "Le poids frais peut aussi être estimé par télédétection satellitaire (par exemple méthode Farmstar ®) ou tout autre capteur (drone, téléphone portable...).",
  ],
  source: "Terres Inovia (méthode de prélèvement)",
} as const;

export interface RapeseedDepthRow {
  /** Profondeur de sol telle qu'imprimée. */
  depth: "≤ 80 cm" | "> 80 cm";
  maxDepthCm: number | null;
  minDepthExclusiveCm: number | null;
  valueKgNHa: number;
}

const DEPTH_NOTE = "Source : GREN";

export const naRapeseedRf: Table<RapeseedDepthRow> = {
  id: "na-2025/rapeseed-rf",
  source: { ...SRC, ref: "Annexe 2.4, tableau 2 : quantité d'azote non extractible par la culture (Rf), p. 2" },
  notes: [DEPTH_NOTE],
  rows: [
    { depth: "≤ 80 cm", maxDepthCm: 80, minDepthExclusiveCm: null, valueKgNHa: 15 },
    { depth: "> 80 cm", maxDepthCm: null, minDepthExclusiveCm: 80, valueKgNHa: 30 },
  ],
};

export const naRapeseedRi: Table<RapeseedDepthRow> = {
  id: "na-2025/rapeseed-ri",
  source: { ...SRC, ref: "Annexe 2.4, tableau 3 : quantité d’azote minéral dans le sol à l’ouverture du bilan (Ri), p. 3" },
  notes: [
    DEPTH_NOTE,
    "Deux solutions pour Ri « au 15 janvier » : méthodes de l'article 8 de l'arrêté préfectoral, ou ce paramétrage forfaitaire.",
    "Pour un précédent légume le GREN recommande une analyse de reliquat.",
  ],
  rows: [
    { depth: "≤ 80 cm", maxDepthCm: 80, minDepthExclusiveCm: null, valueKgNHa: 20 },
    { depth: "> 80 cm", maxDepthCm: null, minDepthExclusiveCm: 80, valueKgNHa: 30 },
  ],
};

export const naRapeseedM: Table<RapeseedDepthRow> = {
  id: "na-2025/rapeseed-m",
  source: { ...SRC, ref: "Annexe 2.4, tableau 4 : minéralisation nette de l'humus du sol et des résidus de récolte du précédent (M), p. 4" },
  notes: [DEPTH_NOTE, "Le colza n'a pas de tables Mh et Mr séparées : M (= Mh + Mr) est forfaitaire selon la profondeur."],
  rows: [
    { depth: "≤ 80 cm", maxDepthCm: 80, minDepthExclusiveCm: null, valueKgNHa: 20 },
    { depth: "> 80 cm", maxDepthCm: null, minDepthExclusiveCm: 80, valueKgNHa: 40 },
  ],
};

export interface RapeseedMhaRow {
  /** « Produits résiduaires organiques » tel qu'imprimé. */
  product: string;
  everyYear: number;
  twoYearsInThree: number;
  everyTwoYears: number;
  everyThreeYearsOrMore: number;
}

export const naRapeseedMha: Table<RapeseedMhaRow> = {
  id: "na-2025/rapeseed-mha",
  source: { ...SRC, ref: "Annexe 2.4, tableau 5 : fourniture d'azote liée à l'historique de produits résiduaires organiques (Mha) en kgN/ha, pp. 4-5" },
  notes: ["Colonnes : Tous les ans / 2 années sur 3 / Tous les 2 ans / Tous les 3 ans et plus. Source : GREN.", "« Lisier de bovins dilue » : orthographe imprimée."],
  rows: [
    { product: "Fumier de bovins", everyYear: 30, twoYearsInThree: 20, everyTwoYears: 15, everyThreeYearsOrMore: 5 },
    { product: "Fumier de volailles", everyYear: 15, twoYearsInThree: 10, everyTwoYears: 5, everyThreeYearsOrMore: 5 },
    { product: "Fumier de porcs", everyYear: 20, twoYearsInThree: 15, everyTwoYears: 5, everyThreeYearsOrMore: 0 },
    { product: "Fumier de cheval", everyYear: 40, twoYearsInThree: 25, everyTwoYears: 20, everyThreeYearsOrMore: 10 },
    { product: "Fumier d'ovins", everyYear: 35, twoYearsInThree: 20, everyTwoYears: 15, everyThreeYearsOrMore: 10 },
    { product: "Lisier de porcs", everyYear: 20, twoYearsInThree: 15, everyTwoYears: 10, everyThreeYearsOrMore: 5 },
    { product: "Lisier de bovins", everyYear: 25, twoYearsInThree: 15, everyTwoYears: 10, everyThreeYearsOrMore: 5 },
    { product: "Lisier de bovins dilue", everyYear: 10, twoYearsInThree: 5, everyTwoYears: 5, everyThreeYearsOrMore: 0 },
    { product: "Lisier, fientes de volailles (≤ 60 % MS)", everyYear: 10, twoYearsInThree: 5, everyTwoYears: 5, everyThreeYearsOrMore: 0 },
    { product: "Fientes de volailles sèches (80 % MS)", everyYear: 20, twoYearsInThree: 10, everyTwoYears: 10, everyThreeYearsOrMore: 0 },
    { product: "Boues urbaines liquides et pâteuses (≤ 20 % MS)", everyYear: 15, twoYearsInThree: 15, everyTwoYears: 10, everyThreeYearsOrMore: 5 },
    { product: "Boues urbaines séchées (90 % MS)", everyYear: 100, twoYearsInThree: 60, everyTwoYears: 50, everyThreeYearsOrMore: 25 },
    { product: "Boues urbaines compostées", everyYear: 30, twoYearsInThree: 20, everyTwoYears: 15, everyThreeYearsOrMore: 5 },
    { product: "Compost de déchets verts", everyYear: 30, twoYearsInThree: 20, everyTwoYears: 15, everyThreeYearsOrMore: 10 },
    { product: "Compost de fumier de bovins, boues STEP + déchets verts", everyYear: 30, twoYearsInThree: 20, everyTwoYears: 15, everyThreeYearsOrMore: 5 },
    { product: "Compost de fumier de volailles", everyYear: 25, twoYearsInThree: 15, everyTwoYears: 10, everyThreeYearsOrMore: 10 },
  ],
};

export interface IrrigationNitrogenRow {
  water: "groundwater" | "surface";
  nitrateMgL: 40 | 25;
  waterMm: number;
  nitrogenKgNHa: number;
}

const IRR: [number, number, number][] = [
  [100, 9, 6],
  [120, 11, 7],
  [140, 13, 8],
  [160, 14, 9],
  [180, 16, 10],
  [200, 18, 11],
  [220, 20, 12],
  [240, 22, 14],
];

/** Tables de correspondance hauteur d'eau → azote apporté (identiques en 2.4, 3.1 et 4.0). */
export const naRapeseedIrrigation: Table<IrrigationNitrogenRow> = {
  id: "na-2025/rapeseed-irrigation",
  source: { ...SRC, ref: "Annexe 2.4 §9, tableaux « Azote apporté par une eau d’irrigation souterraine / superficielle », p. 5" },
  notes: [
    "Valeurs arrondies de Nirr = Q x T NO3 / 443 (formule à appliquer hors des points tabulés).",
    "Le texte dit « pris en compte que si la quantité d'eau prévue est supérieure à 100 mm » alors que le tableau commence à 100 mm (9 et 6 kgN/ha) : ambiguïté de l'annexe à 100 mm exactement.",
  ],
  rows: [
    ...IRR.map(([mm, gw]) => ({ water: "groundwater" as const, nitrateMgL: 40 as const, waterMm: mm, nitrogenKgNHa: gw })),
    ...IRR.map(([mm, , sw]) => ({ water: "surface" as const, nitrateMgL: 25 as const, waterMm: mm, nitrogenKgNHa: sw })),
  ],
};
