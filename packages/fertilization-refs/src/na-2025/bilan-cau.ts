/**
 * Référentiel régional Nouvelle-Aquitaine (arrêté référentiel GREN du 29/07/2025),
 * méthode du bilan avec CAU, départements 24, 33, 40, 47, 64, 19, 23, 87 :
 *  - annexe 2.2.b : maïs (grain et ensilage) et sorgho ;
 *  - annexe 2.1.b : céréales à paille.
 *
 * Valeurs recopiées des PDF publiés par la DREAL Nouvelle-Aquitaine et
 * contrôlées sur le rendu des pages. Une cellule illisible ou absente (« - »)
 * est laissée à `null` ou omise, avec une note ; aucune valeur n'est complétée.
 * Unités : kg N/ha sauf mention contraire.
 */
import type { CropGroup, NaSoilType, Opening, Source, Table } from "../types.js";

const LICENCE =
  "Arrêté préfectoral publié (document administratif) ; valeurs Arvalis/COMIFER/GREN citées";
const DATE = "2025-07-29";
const ORGANISATION = "Préfecture de région Nouvelle-Aquitaine / DREAL Nouvelle-Aquitaine (GREN)";

const MAIZE_URL =
  "https://www.nouvelle-aquitaine.developpement-durable.gouv.fr/IMG/pdf/2_2_b_mais_sorgho_bilan_cau_gren_na_vdef.pdf";
const CEREALS_URL =
  "https://www.nouvelle-aquitaine.developpement-durable.gouv.fr/IMG/pdf/2_1_b_cap_bilan_cau_gren_na_vdef.pdf";
const GREN_PAGE_URL =
  "https://www.nouvelle-aquitaine.developpement-durable.gouv.fr/le-referentiel-regional-na-de-mise-en-oeuvre-de-l-a15285.html";

const maizeSource = (ref: string): Source => ({
  title:
    "Arrêté référentiel GREN Nouvelle-Aquitaine, annexe 2.2.b : fertilisation du maïs (grain et ensilage) et du sorgho, méthode bilan avec CAU (départements 24, 33, 40, 47, 64, 19, 23, 87)",
  organisation: ORGANISATION,
  date: DATE,
  url: MAIZE_URL,
  ref,
  licence: LICENCE,
});

const cerealsSource = (ref: string): Source => ({
  title:
    "Arrêté référentiel GREN Nouvelle-Aquitaine, annexe 2.1.b : fertilisation des céréales à paille, méthode bilan avec CAU (départements 24, 33, 40, 47, 64, 19, 23, 87)",
  organisation: ORGANISATION,
  date: DATE,
  url: CEREALS_URL,
  ref,
  licence: LICENCE,
});

/* -------------------------------------------------------------------------- */
/* Équations                                                                  */
/* -------------------------------------------------------------------------- */

export const equations = {
  maize: {
    ref: "Annexe 2.2.b, p. 1 et § 9 p. 11",
    /**
     * Équation générale (p. 1), texte imprimé sur une ligne avec « CAU » sous la
     * barre de fraction. Sur le rendu, la barre couvre « (Pf + Rf) – (…) » seulement :
     * Xa est soustrait après division par CAU.
     */
    general: {
      printed: "X = (Pf + Rf) – (Ri + Mh + Mhp + Mr + MrCi + Nirr) – Xa",
      numerator: "(Pf + Rf) – (Ri + Mh + Mhp + Mr + MrCi + Nirr)",
      denominator: "CAU",
      linear: "X = [(Pf + Rf) – (Ri + Mh + Mhp + Mr + MrCi + Nirr)] / CAU – Xa",
    },
    /** Phase 1 : azote minéral utile apporté avant 4 feuilles. */
    before4Leaves:
      "Nminéral avant 4 feuilles = Dose d’azote minéral apportée avant 4 feuilles x CAUavant 4 feuilles = Dose d’azote minéral apportée avant 4 feuilles x 0,6",
    /** Phase 2 : dose à apporter après 4 feuilles. */
    after4Leaves: {
      printed: "X = (Pf + Rf) – (Ri + Mh + Mhp + Mr + MrCi + Nirr + Nminéral avant 4 feuilles) – Xa",
      numerator: "(Pf + Rf) – (Ri + Mh + Mhp + Mr + MrCi + Nirr + Nminéral avant 4 feuilles)",
      denominator: "CAU après 4 feuilles",
      linear: "X = [(Pf + Rf) – (Ri + Mh + Mhp + Mr + MrCi + Nirr + Nminéral avant 4 feuilles)] / CAU après 4 feuilles – Xa",
    },
    /** Règle du programme d'actions recopiée dans l'annexe (encadré p. 11). */
    firstApplicationCap: {
      text:
        "Conformément au programme d'actions régional en vigueur sur l’ensemble de la zone vulnérable de la région Nouvelle-Aquitaine, le premier apport minéral sur maïs (pour un semis avant le 1er mai) est plafonné à 50 kg d'azote efficace par ha. C’est-à-dire : dose d'azote minéral apportée avant 4 feuilles < 50 kgN/ha.",
      maxKgNHa: 50,
      appliesTo: "first mineral application on maize sown before 1 May, in the vulnerable zone",
      /** Le texte dit « 50 kg d'azote efficace » puis « dose apportée avant 4 feuilles < 50 » : les deux lectures diffèrent (×0,6). */
      ambiguity:
        "« azote efficace » (≤ 50 après ×0,6) contre « dose apportée < 50 » (strictement inférieur, en dose brute) : le texte donne les deux formulations.",
    },
    seedMaizePf: "Pf = Pf semences femelles / coefficient d’occupation des sols des rangs femelles",
    pf: "Pf = b x y",
    xa: "Xa = Npro x Q x Keq bilan",
  },
  cereals: {
    ref: "Annexe 2.1.b, p. 1",
    /** Même mise en page que le maïs : Xa hors de la barre de fraction. */
    general: {
      printed: "X = (Pf + Rf) – (Ri + Pi + Mh + Mhp + Mr + MrCi + Nirr) – Xa",
      numerator: "(Pf + Rf) – (Ri + Pi + Mh + Mhp + Mr + MrCi + Nirr)",
      denominator: "CAU",
      linear: "X = [(Pf + Rf) – (Ri + Pi + Mh + Mhp + Mr + MrCi + Nirr)] / CAU – Xa",
    },
    pf: "Pf = b x y",
    xa: "Xa = Npro x Q x Keq bilan",
  },
  /** Commun aux deux annexes (cas n° 1 du calcul de Ri ou Ri + Pi). */
  apl: {
    case1:
      "APL = Bilan azoté précédent x coef RPR + Xa apporté avant ouverture = [(Valeur A + XPrécédent + XaPrécédent + MhpPrécédent + MrCiPrécédent) – PfPrécédent] x coef RPR + Xa apporté avant ouverture",
    case2And3: "APL = Reliquat avant lixiviation + Xa avant ouverture",
    xaPrecedent:
      "XaPrécédent = quantité de produit organique apportée au précédent (t/ha ou m³/ha) x teneur en N (kg N/t ou m³) x Keqcycle",
    pfPrecedent: "PfPrécédent = rendement réalisé par le précédent x besoin N unitaire du précédent",
    xaBeforeOpening:
      "Xa avant ouverture = quantité de produit organique apportée avant l'ouverture du bilan (t/ha ou m³/ha) x teneur en N (kg N/t ou m³) x Keq Ri",
  },
  nirr: { numerator: "Nirr = (Q H2O) x (T NO3)", denominator: "443" },
} as const;

/* -------------------------------------------------------------------------- */
/* 1. b : besoin par unité de production                                      */
/* -------------------------------------------------------------------------- */

export type YieldUnit = "q" | "t_ms" | "t_epis";

export interface MaizeBRow {
  crop: CropGroup;
  label: string;
  /** Variante sans classe de rendement (maïs doux). */
  variant?: "epis_vetus" | "epis_nus";
  /** Borne basse de la classe de rendement (unité `unit`/ha) ; null = pas de borne. */
  yieldMin: number | null;
  yieldMinInclusive: boolean;
  yieldMax: number | null;
  yieldMaxInclusive: boolean;
  /** kg N par unité de production. */
  b: number;
  unit: YieldUnit;
}

const band = (
  yieldMin: number | null,
  yieldMinInclusive: boolean,
  yieldMax: number | null,
  yieldMaxInclusive: boolean,
) => ({ yieldMin, yieldMinInclusive, yieldMax, yieldMaxInclusive });
const NO_BAND = band(null, false, null, false);

export const maizeB: Table<MaizeBRow> = {
  id: "na-2025-maize-b",
  source: maizeSource("Annexe 2.2.b, tableau 1, p. 2"),
  notes: [
    "Classes recopiées telles qu'écrites : « < 100 », « 100 à ≤ 120 », « > 120 » (borne basse « 100 à » lue inclusive car la classe précédente l'exclut).",
    "Sorgho fourrage : « 0 à < 10 t MS/ha » (borne 0 inclusive).",
    "Maïs doux : b = 10 kg N/t pour les épis vêtus, 12 pour les épis nus (tableau 1). Le tableau 7 (bp du précédent) donne l'inverse (épis + spathes 12, épis dépouillés 10) ; les deux sont recopiés tels quels.",
    "Source du tableau : Arvalis – Institut du Végétal.",
  ],
  rows: [
    { crop: "maize_grain", label: "Maïs grain < 100 q/ha", ...band(null, false, 100, false), b: 2.3, unit: "q" },
    { crop: "maize_grain", label: "Maïs grain 100 à ≤ 120 q/ha", ...band(100, true, 120, true), b: 2.2, unit: "q" },
    { crop: "maize_grain", label: "Maïs grain > 120 q/ha", ...band(120, false, null, false), b: 2.1, unit: "q" },
    { crop: "maize_popcorn", label: "Maïs pop-corn", ...NO_BAND, b: 4.1, unit: "q" },
    { crop: "maize_silage", label: "Maïs fourrage < 14 t MS/ha", ...band(null, false, 14, false), b: 14, unit: "t_ms" },
    { crop: "maize_silage", label: "Maïs fourrage 14 à ≤ 18 t MS/ha", ...band(14, true, 18, true), b: 13, unit: "t_ms" },
    { crop: "maize_silage", label: "Maïs fourrage > 18 t MS/ha", ...band(18, false, null, false), b: 12, unit: "t_ms" },
    { crop: "maize_sweet", label: "Maïs doux, épis vêtus", variant: "epis_vetus", ...NO_BAND, b: 10, unit: "t_epis" },
    { crop: "maize_sweet", label: "Maïs doux, épis nus", variant: "epis_nus", ...NO_BAND, b: 12, unit: "t_epis" },
    { crop: "sorghum_grain", label: "Sorgho grain < 50 q/ha", ...band(null, false, 50, false), b: 2.9, unit: "q" },
    { crop: "sorghum_grain", label: "Sorgho grain 50 à < 80 q/ha", ...band(50, true, 80, false), b: 2.5, unit: "q" },
    { crop: "sorghum_grain", label: "Sorgho grain 80 à ≤ 100 q/ha", ...band(80, true, 100, true), b: 2.3, unit: "q" },
    { crop: "sorghum_grain", label: "Sorgho grain > 100 q/ha", ...band(100, false, null, false), b: 2.1, unit: "q" },
    { crop: "sorghum_silage", label: "Sorgho fourrage 0 à < 10 t MS/ha", ...band(0, true, 10, false), b: 16, unit: "t_ms" },
    { crop: "sorghum_silage", label: "Sorgho fourrage 10 à ≤ 15 t MS/ha", ...band(10, true, 15, true), b: 14, unit: "t_ms" },
    { crop: "sorghum_silage", label: "Sorgho fourrage > 15 t MS/ha", ...band(15, false, null, false), b: 12.5, unit: "t_ms" },
  ],
};

export interface CerealsBRow {
  key: string;
  label: string;
  /** Groupes de cultures auxquels la valeur par défaut s'applique. */
  crops: CropGroup[];
  /** kg N/q, valeur par défaut. */
  b: number;
  /** « (variable selon variété) » dans le tableau : la valeur par variété publiée par la DREAL prime. */
  variableByVariety: boolean;
}

export const cerealsB: Table<CerealsBRow> = {
  id: "na-2025-cereals-b",
  source: cerealsSource("Annexe 2.1.b, tableau 1, p. 2"),
  notes: [
    "Valeurs par défaut (kg N/q). « Pour les blés et orges, le GREN recommande d’utiliser les valeurs de b et bq par variété ou débouché » (publiées sur le site de la DREAL à partir de février).",
    "« Orge » est rattachée à barley_winter et barley_spring (le tableau ne distingue pas).",
    "« Autres céréales et mélanges de céréales » : rattachement à spelt (épeautre) par interprétation ; aucune espèce n'est nommée dans le texte.",
    "Écarts avec le tableau 7 (bp du précédent, autre usage) : avoine 2,2 ici contre 2,5 en bp ; blé dur 3,7 ici contre 3,5 en bp.",
    "Méteils (p. 2) : b des espèces non fixatrices au prorata du semis ; objectif de rendement pondéré par la densité relative ; dose plafonnée à celle de la culture pure non fixatrice la plus exigeante.",
    "Source du tableau : Arvalis – Institut du Végétal.",
  ],
  rows: [
    { key: "triticale", label: "Triticale", crops: ["triticale"], b: 2.6, variableByVariety: false },
    { key: "seigle", label: "Seigle", crops: ["rye"], b: 2.3, variableByVariety: false },
    { key: "orge", label: "Orge", crops: ["barley_winter", "barley_spring"], b: 2.5, variableByVariety: false },
    { key: "avoine", label: "Avoine", crops: ["oat"], b: 2.2, variableByVariety: false },
    {
      key: "autres_cereales_melanges",
      label: "Autres céréales et mélanges de céréales",
      crops: ["spelt"],
      b: 2.5,
      variableByVariety: false,
    },
    { key: "ble_tendre_hiver", label: "Blé tendre d’hiver", crops: ["soft_wheat"], b: 3, variableByVariety: true },
    { key: "ble_dur", label: "Blé dur", crops: ["durum_wheat"], b: 3.7, variableByVariety: true },
    { key: "ble_tendre_ameliorant", label: "Blé tendre améliorant", crops: ["improver_wheat"], b: 3.5, variableByVariety: true },
  ],
};

export interface MaizeSeedPfRow {
  /** Objectif de rendement des rangs femelles à 15 % H2O (q/ha). */
  yieldMinQ: number | null;
  yieldMinInclusive: boolean;
  yieldMaxQ: number | null;
  yieldMaxInclusive: boolean;
  label: string;
  /** Pf semences femelles (kg N/ha des rangs femelles). */
  pfFemaleKgNHa: number;
}

const seedBand = (min: number, max: number, pf: number): MaizeSeedPfRow => ({
  yieldMinQ: min,
  yieldMinInclusive: true,
  yieldMaxQ: max,
  yieldMaxInclusive: false,
  label: `[${min} ; ${max}[`,
  pfFemaleKgNHa: pf,
});

export const maizeSeedPf: Table<MaizeSeedPfRow> = {
  id: "na-2025-maize-seed-pf",
  source: maizeSource("Annexe 2.2.b, tableau 3a, p. 2-3"),
  notes: [
    "Pf = Pf semences femelles / COF (tableau 3b). En absence de références, se référer au contrat de production.",
    "Il n'y a pas de tableau 2 dans l'annexe 2.2.b.",
    "Source du tableau : Arvalis – Institut du Végétal.",
  ],
  rows: [
    { yieldMinQ: null, yieldMinInclusive: false, yieldMaxQ: 10, yieldMaxInclusive: false, label: "< 10", pfFemaleKgNHa: 70 },
    seedBand(10, 15, 85),
    seedBand(15, 20, 95),
    seedBand(20, 25, 105),
    seedBand(25, 30, 115),
    seedBand(30, 35, 125),
    seedBand(35, 40, 130),
    seedBand(40, 45, 135),
    seedBand(45, 50, 140),
    seedBand(50, 55, 145),
    seedBand(55, 60, 150),
    seedBand(60, 70, 155),
    { yieldMinQ: 70, yieldMinInclusive: true, yieldMaxQ: null, yieldMaxInclusive: false, label: "≥ 70", pfFemaleKgNHa: 165 },
  ],
};

export interface MaizeSeedCofRow {
  key: string;
  /** Dispositif de semis tel qu'imprimé. */
  label: string;
  /** Coefficient d'occupation des sols des rangs femelles. */
  cof: number;
}

export const maizeSeedCof: Table<MaizeSeedCofRow> = {
  id: "na-2025-maize-seed-cof",
  source: maizeSource("Annexe 2.2.b, tableau 3b, p. 3"),
  notes: ["Source du tableau : Arvalis – Institut du Végétal."],
  rows: [
    { key: "6x3", label: "6 x 3", cof: 0.75 },
    { key: "6x2", label: "6 x 2", cof: 0.77 },
    { key: "4x2_normal", label: "4 x 2 normal", cof: 0.69 },
    { key: "4x2_reduit", label: "4 x 2 réduit", cof: 0.71 },
    { key: "4x3", label: "4 x 3", cof: 0.67 },
    { key: "2x1x2x2_reduit", label: "2 x 1 x 2 x 2 réduit", cof: 0.63 },
    { key: "2x2", label: "2 x 2", cof: 0.57 },
    { key: "interplanting", label: "Inter-planting", cof: 0.67 },
    { key: "semences_de_base", label: "Semences de base", cof: 1 },
  ],
};

/* -------------------------------------------------------------------------- */
/* 2. Rf                                                                      */
/* -------------------------------------------------------------------------- */

export interface RfRow {
  soil: NaSoilType;
  /** kg N/ha ; null quand le tableau renvoie à un autre sol (« (*) »). */
  rfKgNHa: number | null;
  /** Sol dont il faut reprendre la valeur (renvoi « (*) »). */
  sameAs?: NaSoilType;
}

const RF_ROWS: RfRow[] = [
  { soil: "argilo_calcaire", rfKgNHa: 30 },
  { soil: "sableux", rfKgNHa: 10 },
  { soil: "fond_vallee_terres_noires", rfKgNHa: 30 },
  { soil: "marais_argileux_sodiques", rfKgNHa: null, sameAs: "fond_vallee_terres_noires" },
  { soil: "limoneux", rfKgNHa: 30 },
  { soil: "terrasses_vallees", rfKgNHa: 15 },
  { soil: "sur_granite", rfKgNHa: null, sameAs: "argileux_sablo_argileux" },
  { soil: "argileux_sablo_argileux", rfKgNHa: 40 },
];

const RF_NOTE =
  "(*) Pour les sols de marais argileux sodiques, utiliser la valeur des sols de fond de vallées, terres noires. Pour les sols sur granite, utiliser la valeur des sols argileux à sablo-argileux. Source : GREN.";

export const maizeRf: Table<RfRow> = {
  id: "na-2025-maize-rf",
  source: maizeSource("Annexe 2.2.b, tableau 4, p. 3"),
  notes: [RF_NOTE],
  rows: RF_ROWS.map((r) => ({ ...r })),
};

export const cerealsRf: Table<RfRow> = {
  id: "na-2025-cereals-rf",
  source: cerealsSource("Annexe 2.1.b, tableau 3, p. 3"),
  notes: [RF_NOTE],
  rows: RF_ROWS.map((r) => ({ ...r })),
};

/* -------------------------------------------------------------------------- */
/* 3. Pi selon le nombre de talles (céréales)                                 */
/* -------------------------------------------------------------------------- */

export interface PiTillersRow {
  label: string;
  /** Nombre de talles primaires (0 = pas de talle). */
  tillersMin: number;
  /** null = « > 5 talles ». */
  tillersMax: number | null;
  piKgNHa: number;
}

export const piTillers: Table<PiTillersRow> = {
  id: "na-2025-cereals-pi-tillers",
  source: cerealsSource("Annexe 2.1.b, tableau 4, p. 3"),
  notes: [
    "Utilisé quand Ri est mesuré en sortie d'hiver (céréales d'hiver).",
    "Texte sous le tableau : « 5 kgN/ha par talle supplémentaire. En cas de forte biomasse, la valeur est plafonnée à 50 kgN/ha. » La colonne « > 5 talles » vaut 40 ; l'articulation avec la règle +5/talle (jusqu'au plafond 50) n'est pas précisée.",
    "Source du tableau : Arvalis – Institut du Végétal.",
  ],
  rows: [
    { label: "Pas de talle", tillersMin: 0, tillersMax: 0, piKgNHa: 10 },
    { label: "1", tillersMin: 1, tillersMax: 1, piKgNHa: 15 },
    { label: "2", tillersMin: 2, tillersMax: 2, piKgNHa: 20 },
    { label: "3", tillersMin: 3, tillersMax: 3, piKgNHa: 25 },
    { label: "4", tillersMin: 4, tillersMax: 4, piKgNHa: 30 },
    { label: "5", tillersMin: 5, tillersMax: 5, piKgNHa: 35 },
    { label: "> 5 talles", tillersMin: 6, tillersMax: null, piKgNHa: 40 },
  ],
};

/* -------------------------------------------------------------------------- */
/* 4. Précédents pour l'APL (tableau 7, identique dans les deux annexes)     */
/* -------------------------------------------------------------------------- */

export type PrecedentBpUnit = "q" | "t_ms" | "t_epis";

export interface PrecedentAplRow {
  key: string;
  label: string;
  /** bp de base (kg N par unité `bpUnit`) ; null = « Voir fiches cultures ». */
  bpBase: number | null;
  /**
   * Unité de bp, déduite de l'en-tête « kg N par q de grain ou par tonne de MS »
   * (non imprimée ligne par ligne) ; null si bp absent.
   */
  bpUnit: PrecedentBpUnit | null;
  /** Pailles restituées : true/false pour les céréales, null sinon. */
  strawReturned: boolean | null;
  /** « + 0,3 » imprimé pour les pailles restituées (kg N/q), 0 sinon. */
  strawReturnedBonus: number;
  coefRpr: number;
  /** Renvois (1) bp par variété publiés par la DREAL ; (2) valeur moyenne, détail dans la fiche culture. */
  footnotes: (1 | 2)[];
}

const cereal = (
  key: string,
  label: string,
  bp: number,
  returned: boolean,
  footnotes: (1 | 2)[] = [],
): PrecedentAplRow => ({
  key,
  label,
  bpBase: bp,
  bpUnit: "q",
  strawReturned: returned,
  strawReturnedBonus: returned ? 0.3 : 0,
  coefRpr: 0.27,
  footnotes,
});

export const precedentsApl: Table<PrecedentAplRow> = {
  id: "na-2025-precedents-apl",
  source: maizeSource(
    "Annexe 2.2.b, tableau 7, p. 5 (identique : annexe 2.1.b, tableau 7, p. 5)",
  ),
  notes: [
    "bp total = bpBase + strawReturnedBonus.",
    "(1) Les valeurs des besoins unitaires par variété sont publiées sur le site internet de la DREAL à compter de février.",
    "(2) Les valeurs des besoins unitaires pour le maïs et le sorgho varient selon le potentiel de rendement. La valeur indiquée dans le tableau est une valeur moyenne. Les valeurs détaillées sont dans la fiche culture correspondante.",
    "Orge pailles restituées : le renvoi (1) est imprimé après « 0,3 » (« 2,5 + 0,3(1) ») ; rattaché ici à la ligne.",
    "Maïs doux : bp 12 pour « épis + spathes » et 10 pour « épis dépouillés », alors que le tableau 1 donne b = 10 (épis vêtus) et 12 (épis nus) ; recopié tel quel.",
    "bpUnit est une déduction de l'en-tête (q pour grains, t MS pour fourrages, t d'épis pour le maïs doux) ; maïs semence 5,7 rattaché au quintal.",
    "Source du tableau : Arvalis – Institut du Végétal.",
  ],
  rows: [
    cereal("avoine_pailles_enlevees", "Avoine pailles enlevées", 2.5, false),
    cereal("avoine_pailles_restituees", "Avoine pailles restituées", 2.5, true),
    cereal("ble_tendre_pailles_enlevees", "Blé tendre pailles enlevées", 3, false, [1]),
    cereal("ble_tendre_pailles_restituees", "Blé tendre pailles restitués", 3, true, [1]),
    cereal("ble_dur_pailles_enlevees", "Blé dur pailles enlevées", 3.5, false, [1]),
    cereal("ble_dur_pailles_restituees", "Blé dur pailles restitués", 3.5, true, [1]),
    { key: "colza", label: "Colza", bpBase: 7, bpUnit: "q", strawReturned: null, strawReturnedBonus: 0, coefRpr: 0.4, footnotes: [] },
    { key: "mais_doux_epis_spathes", label: "Maïs doux épis + spathes", bpBase: 12, bpUnit: "t_epis", strawReturned: null, strawReturnedBonus: 0, coefRpr: 0.48, footnotes: [2] },
    { key: "mais_doux_epis_depouilles", label: "Maïs doux épis dépouillés", bpBase: 10, bpUnit: "t_epis", strawReturned: null, strawReturnedBonus: 0, coefRpr: 0.48, footnotes: [2] },
    { key: "mais_fourrage", label: "Maïs fourrage", bpBase: 13, bpUnit: "t_ms", strawReturned: null, strawReturnedBonus: 0, coefRpr: 0.48, footnotes: [2] },
    { key: "mais_grain", label: "Maïs grain", bpBase: 2.2, bpUnit: "q", strawReturned: null, strawReturnedBonus: 0, coefRpr: 0.48, footnotes: [2] },
    { key: "mais_semence", label: "Maïs semence", bpBase: 5.7, bpUnit: "q", strawReturned: null, strawReturnedBonus: 0, coefRpr: 0.48, footnotes: [] },
    cereal("orge_pailles_enlevees", "Orge pailles enlevées", 2.5, false, [1]),
    cereal("orge_pailles_restituees", "Orge pailles restituées", 2.5, true, [1]),
    cereal("seigle_pailles_enlevees", "Seigle pailles enlevées", 2.3, false),
    cereal("seigle_pailles_restituees", "Seigle pailles restitués", 2.3, true),
    { key: "sorgho_ensilage", label: "Sorgho ensilage", bpBase: 13, bpUnit: "t_ms", strawReturned: null, strawReturnedBonus: 0, coefRpr: 0.48, footnotes: [] },
    { key: "sorgho_grain", label: "Sorgho grain", bpBase: 2.8, bpUnit: "q", strawReturned: null, strawReturnedBonus: 0, coefRpr: 0.48, footnotes: [] },
    { key: "tournesol", label: "Tournesol", bpBase: 4, bpUnit: "q", strawReturned: null, strawReturnedBonus: 0, coefRpr: 0.4, footnotes: [] },
    cereal("triticale_pailles_enlevees", "Triticale pailles enlevées", 2.6, false),
    cereal("triticale_pailles_restituees", "Triticale pailles restitués", 2.6, true),
    { key: "autres_cultures", label: "Autres cultures (voir fiches cultures)", bpBase: null, bpUnit: null, strawReturned: null, strawReturnedBonus: 0, coefRpr: 0.4, footnotes: [] },
  ],
};

/* -------------------------------------------------------------------------- */
/* 5. Valeur A                                                                */
/* -------------------------------------------------------------------------- */

export interface ValueADefaultRow {
  key: "forte" | "moyenne" | "faible";
  label: string;
  aKgNHa: number;
}

export const valueA: Table<ValueADefaultRow> = {
  id: "na-2025-value-a-defaults",
  source: maizeSource("Annexe 2.2.b, tableau 6, p. 4 (identique : annexe 2.1.b, tableau 6, p. 4)"),
  notes: [
    "Valeurs indicatives « pour le Sud-Ouest », à utiliser à défaut de la valeur annuelle d'Arvalis publiée par la DREAL chaque début d'année. « Le GREN recommande d’utiliser la valeur annuelle du A d'Arvalis – Institut du Végétal dès sa publication. »",
  ],
  rows: [
    { key: "forte", label: "Forte minéralisation (climat chaud et humide)", aKgNHa: 160 },
    { key: "moyenne", label: "Minéralisation moyenne (année normale)", aKgNHa: 120 },
    { key: "faible", label: "Faible minéralisation (climat froid et sec)", aKgNHa: 70 },
  ],
};

export interface ValueAAnnualRow {
  year: number;
  aKgNHa: number;
  sourceNote: string;
}

export const valueAAnnual: Table<ValueAAnnualRow> = {
  id: "na-2025-value-a-annual",
  source: {
    title: "Valeur A annuelle (Arvalis) publiée sur la page GREN de la DREAL Nouvelle-Aquitaine",
    organisation: "Arvalis – Institut du Végétal, publié par la DREAL Nouvelle-Aquitaine",
    date: DATE,
    url: GREN_PAGE_URL,
    ref: "Page GREN DREAL NA, valeur A annuelle (prévue par l'annexe 2.2.b, p. 4 et 2.1.b, p. 4)",
    licence: LICENCE,
  },
  notes: [
    "La date de source est celle de l'arrêté qui prévoit cette publication annuelle ; la date exacte de mise en ligne de la valeur n'a pas été relevée.",
    "L'année désigne l'année de la publication ; le texte définit A comme l'azote minéralisé par le sol pendant l'année précédente.",
  ],
  rows: [{ year: 2025, aKgNHa: 140, sourceNote: "Arvalis, publié par la DREAL NA (page GREN), 2025" }],
};

/* -------------------------------------------------------------------------- */
/* 6. Grilles Ri (maïs) et Ri + Pi (céréales) selon APL et pluie               */
/* -------------------------------------------------------------------------- */

const APL_STEPS = [0, 20, 40, 60, 80, 100] as const;

/** Lignes imprimées : une ligne par APL (0 → 100), une colonne par cumul de pluie. */
function expandGrid<K extends string>(
  grids: [NaSoilType, number[][]][],
  rains: readonly number[],
  valueKey: K,
): ({ soil: NaSoilType; aplKgNHa: number; rainMm: number } & Record<K, number>)[] {
  const out: ({ soil: NaSoilType; aplKgNHa: number; rainMm: number } & Record<K, number>)[] = [];
  for (const [soil, lines] of grids) {
    if (lines.length !== APL_STEPS.length) throw new Error(`grille ${soil} : ${lines.length} lignes`);
    lines.forEach((line, i) => {
      if (line.length !== rains.length) throw new Error(`grille ${soil} APL ${APL_STEPS[i]} : ${line.length} colonnes`);
      line.forEach((v, j) => {
        out.push({ soil, aplKgNHa: APL_STEPS[i]!, rainMm: rains[j]!, [valueKey]: v } as {
          soil: NaSoilType;
          aplKgNHa: number;
          rainMm: number;
        } & Record<K, number>);
      });
    });
  }
  return out;
}

export interface RiMaizeAplRow {
  soil: NaSoilType;
  /** Azote potentiellement lixiviable (kg N/ha) : 0, 20, …, 100. */
  aplKgNHa: number;
  /** Cumul de pluie du 01/10 au 01/05 (mm). */
  rainMm: number;
  riKgNHa: number;
}

export const MAIZE_RAIN_MM = [250, 300, 350, 400, 450, 500, 600, 700, 800] as const;

export const riMaizeApl: Table<RiMaizeAplRow> = {
  id: "na-2025-maize-ri-apl",
  source: maizeSource("Annexe 2.2.b, tableau 8, p. 6"),
  notes: [
    "Cumul de pluie entre le 01/10 et le 01/05 (mm). APL de 0 à 100 kg N/ha par pas de 20.",
    "Sols de marais argileux sodiques et sols sur granite : « - » dans le tableau, aucune ligne.",
    "Le tableau ne dit pas comment traiter un APL > 100, une pluie < 250 ou > 800 mm, ni l'interpolation entre colonnes.",
    "Source du tableau : Arvalis – Institut du Végétal.",
  ],
  rows: expandGrid<"riKgNHa">(
    [
      ["argilo_calcaire", [
        [36, 35, 32, 29, 26, 24, 21, 20, 20],
        [51, 48, 44, 38, 32, 27, 22, 21, 20],
        [67, 62, 56, 46, 37, 30, 23, 21, 20],
        [82, 76, 67, 55, 43, 33, 24, 21, 20],
        [98, 90, 79, 64, 49, 37, 25, 21, 20],
        [113, 104, 91, 73, 54, 40, 25, 21, 20],
      ]],
      ["sableux", [
        [71, 58, 44, 35, 32, 31, 30, 30, 30],
        [86, 69, 49, 37, 33, 31, 30, 30, 30],
        [102, 79, 55, 40, 33, 31, 30, 30, 30],
        [117, 90, 60, 42, 34, 31, 30, 30, 30],
        [132, 100, 65, 44, 35, 32, 30, 30, 30],
        [148, 111, 70, 46, 35, 32, 30, 30, 30],
      ]],
      ["fond_vallee_terres_noires", [
        [61, 60, 57, 53, 47, 41, 35, 34, 33],
        [76, 74, 69, 62, 54, 46, 37, 34, 33],
        [90, 87, 82, 72, 61, 50, 38, 34, 33],
        [105, 101, 94, 82, 68, 54, 39, 34, 33],
        [119, 115, 106, 92, 75, 58, 40, 35, 34],
        [134, 128, 118, 102, 82, 63, 41, 35, 34],
      ]],
      ["limoneux", [
        [50, 48, 46, 41, 36, 32, 27, 26, 26],
        [66, 63, 59, 52, 44, 37, 29, 27, 26],
        [81, 78, 72, 62, 51, 41, 30, 28, 27],
        [97, 93, 85, 72, 58, 46, 32, 28, 27],
        [113, 107, 98, 83, 66, 50, 34, 29, 28],
        [129, 122, 111, 93, 73, 55, 35, 30, 29],
      ]],
      ["terrasses_vallees", [
        [50, 47, 44, 39, 35, 31, 28, 27, 26],
        [65, 61, 55, 48, 40, 34, 28, 27, 26],
        [80, 75, 67, 56, 45, 37, 29, 27, 27],
        [95, 88, 78, 64, 50, 40, 30, 27, 27],
        [110, 102, 89, 73, 56, 43, 31, 27, 27],
        [125, 116, 101, 81, 61, 46, 31, 28, 27],
      ]],
      ["argileux_sablo_argileux", [
        [24, 23, 22, 20, 19, 17, 16, 16, 16],
        [39, 37, 33, 28, 24, 20, 17, 16, 16],
        [54, 50, 44, 37, 29, 23, 18, 16, 16],
        [69, 64, 56, 45, 34, 26, 18, 16, 16],
        [84, 77, 67, 53, 39, 29, 19, 16, 16],
        [99, 91, 78, 61, 44, 31, 20, 17, 16],
      ]],
    ],
    MAIZE_RAIN_MM,
    "riKgNHa",
  ),
};

export interface RiCerealsAplRow {
  soil: NaSoilType;
  aplKgNHa: number;
  /** Cumul de pluie du 01/10 au 01/03 (mm). */
  rainMm: number;
  /** Ri + Pi à l'ouverture du bilan (kg N/ha). */
  riPlusPiKgNHa: number;
}

export const CEREALS_RAIN_MM = [150, 200, 250, 300, 350, 400, 450, 500, 600] as const;

export const riCerealsApl: Table<RiCerealsAplRow> = {
  id: "na-2025-cereals-ri-pi-apl",
  source: cerealsSource("Annexe 2.1.b, tableau 10, p. 6-7"),
  notes: [
    "Valeurs de Ri + Pi (et non de Ri seul). Cumul de pluie entre le 01/10 et le 01/03 (mm), colonnes 150 à 600. APL de 0 à 100 kg N/ha par pas de 20.",
    "Le texte introduit ce tableau pour « les départements 24, 33, 40, 47 et 64 » alors que l'annexe couvre aussi 19, 23, 87.",
    "Sols de marais argileux sodiques et sols sur granite : « - » dans le tableau, aucune ligne.",
    "Source du tableau : Arvalis – Institut du Végétal.",
  ],
  rows: expandGrid<"riPlusPiKgNHa">(
    [
      ["argilo_calcaire", [
        [30, 30, 29, 29, 28, 27, 27, 27, 26],
        [45, 44, 42, 40, 37, 33, 30, 28, 27],
        [59, 58, 55, 51, 45, 39, 33, 30, 27],
        [74, 72, 68, 62, 53, 44, 37, 32, 27],
        [89, 86, 82, 73, 62, 50, 40, 33, 28],
        [104, 101, 95, 84, 70, 55, 43, 35, 28],
      ]],
      ["sableux", [
        [53, 45, 31, 25, 24, 24, 24, 24, 24],
        [72, 58, 35, 25, 24, 24, 24, 24, 24],
        [90, 71, 39, 26, 24, 24, 24, 24, 24],
        [108, 83, 43, 27, 24, 24, 24, 24, 24],
        [126, 96, 47, 28, 24, 24, 24, 24, 24],
        [144, 109, 52, 28, 24, 24, 24, 24, 24],
      ]],
      ["fond_vallee_terres_noires", [
        [50, 49, 48, 46, 44, 41, 39, 38, 37],
        [64, 63, 61, 57, 51, 45, 41, 39, 38],
        [78, 76, 73, 67, 58, 49, 43, 40, 38],
        [92, 89, 85, 77, 65, 54, 45, 41, 38],
        [105, 103, 97, 87, 72, 58, 48, 42, 38],
        [119, 116, 109, 97, 80, 62, 50, 43, 38],
      ]],
      ["limoneux", [
        [40, 39, 38, 36, 34, 33, 32, 32, 32],
        [54, 52, 49, 43, 38, 34, 33, 32, 32],
        [68, 65, 59, 50, 42, 36, 33, 32, 32],
        [83, 79, 70, 57, 45, 38, 34, 33, 32],
        [97, 92, 81, 65, 49, 39, 35, 33, 32],
        [111, 105, 91, 72, 53, 41, 35, 33, 32],
      ]],
      ["terrasses_vallees", [
        [41, 41, 40, 38, 36, 34, 33, 32, 32],
        [56, 55, 52, 47, 41, 36, 34, 33, 32],
        [71, 69, 65, 57, 47, 39, 35, 33, 32],
        [86, 84, 78, 66, 52, 42, 36, 34, 32],
        [101, 98, 90, 76, 58, 44, 37, 34, 32],
        [116, 112, 103, 85, 64, 47, 38, 34, 32],
      ]],
      ["argileux_sablo_argileux", [
        [22, 22, 22, 22, 22, 22, 21, 21, 21],
        [37, 36, 34, 32, 28, 25, 23, 22, 22],
        [52, 50, 47, 41, 35, 29, 25, 23, 22],
        [67, 64, 59, 51, 41, 33, 27, 24, 22],
        [82, 78, 71, 61, 48, 37, 29, 25, 22],
        [97, 92, 84, 70, 54, 41, 31, 26, 22],
      ]],
    ],
    CEREALS_RAIN_MM,
    "riPlusPiKgNHa",
  ),
};

/* -------------------------------------------------------------------------- */
/* 7. Précédent légumineuse, prairie, culture intermédiaire                   */
/* -------------------------------------------------------------------------- */

export interface RiLegumeRow {
  key: "pois" | "feverole_lupin" | "soja";
  label: string;
  /** Reliquat avant lixiviation = constantKgNHa + coefA × Valeur A. */
  constantKgNHa: number;
  coefA: number;
}

export const riLegume: Table<RiLegumeRow> = {
  id: "na-2025-ri-legume",
  source: maizeSource("Annexe 2.2.b, tableau 9, p. 7 (identique : annexe 2.1.b, tableau 8, p. 6)"),
  notes: [
    "Donne le reliquat avant lixiviation ; APL = reliquat avant lixiviation + Xa avant ouverture, puis Ri (maïs, tableau 8) ou Ri + Pi (céréales, tableau 10) se lit dans la grille APL × pluie.",
    "Source du tableau : Arvalis – Institut du Végétal.",
  ],
  rows: [
    { key: "pois", label: "Pois", constantKgNHa: 30, coefA: 0.5 },
    { key: "feverole_lupin", label: "Féverole, lupin", constantKgNHa: 20, coefA: 0.4 },
    { key: "soja", label: "Soja", constantKgNHa: 20, coefA: 0.3 },
  ],
};

export type GrasslandProductionType = "graminees_pures" | "association_graminees_legumineuses";
export type GrasslandMode = "pature_integrale" | "fauche_paturage" | "fauche_integrale";

export interface RiGrasslandRow {
  productionType: GrasslandProductionType;
  /** null pour l'association (« / »). */
  mode: GrasslandMode | null;
  precedent:
    | "prairie_1_2_ans"
    | "prairie_3_6_ans"
    | "prairie_plus_6_ans"
    | "jachere_annuelle"
    | "jachere_pluriannuelle";
  /** Valeur = constantKgNHa + coefA × A. */
  constantKgNHa: number;
  coefA: number;
}

const GRASSLAND_COLS = [
  "prairie_1_2_ans",
  "prairie_3_6_ans",
  "prairie_plus_6_ans",
  "jachere_annuelle",
  "jachere_pluriannuelle",
] as const;

function grasslandLine(
  productionType: GrasslandProductionType,
  mode: GrasslandMode | null,
  terms: [number, number][],
): RiGrasslandRow[] {
  return terms.map(([c, a], i) => ({
    productionType,
    mode,
    precedent: GRASSLAND_COLS[i]!,
    constantKgNHa: c,
    coefA: a,
  }));
}

export const riGrassland: Table<RiGrasslandRow> = {
  id: "na-2025-ri-grassland",
  source: maizeSource("Annexe 2.2.b, tableau 10, p. 7 (identique : annexe 2.1.b, tableau 9, p. 6)"),
  notes: [
    "Annexe 2.1.b (céréales) : intitulé « Reliquat avant lixiviation », avec APL = reliquat avant lixiviation + Xa avant ouverture puis lecture de Ri + Pi dans le tableau 10.",
    "Annexe 2.2.b (maïs) : même intitulé « Reliquat avant lixiviation » mais l'en-tête de colonne est « Ri (kgN/ha) » et le cas n° 3 ne donne pas de formule d'APL ni de renvoi au tableau 8 : le texte ne tranche pas entre lecture directe de Ri et passage par la grille APL.",
    "Source du tableau : Arvalis – Institut du Végétal.",
  ],
  rows: [
    ...grasslandLine("graminees_pures", "pature_integrale", [[25, 0.3], [75, 0.3], [100, 0.3], [10, 0.4], [20, 0.4]]),
    ...grasslandLine("graminees_pures", "fauche_paturage", [[17.5, 0.3], [52.5, 0.3], [70, 0.3], [10, 0.4], [20, 0.4]]),
    ...grasslandLine("graminees_pures", "fauche_integrale", [[10, 0.3], [30, 0.3], [40, 0.3], [10, 0.4], [20, 0.4]]),
    ...grasslandLine("association_graminees_legumineuses", null, [[25, 0.3], [75, 0.3], [100, 0.3], [20, 0.4], [20, 0.4]]),
  ],
};

export interface RiAfterCoverRow {
  soil: NaSoilType;
  /** null = « - » dans le tableau. */
  riKgNHa: number | null;
}

export const riAfterCover: Table<RiAfterCoverRow> = {
  id: "na-2025-maize-ri-after-cover",
  source: maizeSource("Annexe 2.2.b, tableau 11, p. 7"),
  notes: [
    "Cas n° 4 du maïs : une culture intermédiaire précède la culture. Valeur de Ri directe (pas de grille APL).",
    "Sols de marais argileux sodiques et sols sur granite : « - » (null), sans renvoi vers un autre sol.",
    "L'annexe 2.1.b (céréales) n'a pas d'équivalent.",
    "Source du tableau : GREN.",
  ],
  rows: [
    { soil: "argilo_calcaire", riKgNHa: 40 },
    { soil: "sableux", riKgNHa: 15 },
    { soil: "fond_vallee_terres_noires", riKgNHa: 30 },
    { soil: "marais_argileux_sodiques", riKgNHa: null },
    { soil: "limoneux", riKgNHa: 30 },
    { soil: "terrasses_vallees", riKgNHa: 30 },
    { soil: "sur_granite", riKgNHa: null },
    { soil: "argileux_sablo_argileux", riKgNHa: 40 },
  ],
};

/* -------------------------------------------------------------------------- */
/* 8. Mh                                                                      */
/* -------------------------------------------------------------------------- */

export interface MaizeMhRow {
  soil: NaSoilType;
  /** Maïs et sorgho (grain et ensilage) SEC ; null = « - ». */
  dryKgNHa: number | null;
  /** Maïs et sorgho (grain et ensilage) IRRIGUÉ. */
  irrigatedKgNHa: number | null;
  /** Maïs doux et semence. */
  sweetSeedKgNHa: number | null;
}

export const maizeMh: Table<MaizeMhRow> = {
  id: "na-2025-maize-mh",
  source: maizeSource("Annexe 2.2.b, tableau 12, p. 8"),
  notes: [
    "Sols de marais argileux sodiques et sols sur granite : « - » (null) dans les trois colonnes.",
    "Source du tableau : GREN.",
  ],
  rows: [
    { soil: "argilo_calcaire", dryKgNHa: 25, irrigatedKgNHa: 35, sweetSeedKgNHa: 20 },
    { soil: "sableux", dryKgNHa: 55, irrigatedKgNHa: 70, sweetSeedKgNHa: 40 },
    { soil: "fond_vallee_terres_noires", dryKgNHa: 35, irrigatedKgNHa: 45, sweetSeedKgNHa: 25 },
    { soil: "marais_argileux_sodiques", dryKgNHa: null, irrigatedKgNHa: null, sweetSeedKgNHa: null },
    { soil: "limoneux", dryKgNHa: 45, irrigatedKgNHa: 60, sweetSeedKgNHa: 35 },
    { soil: "terrasses_vallees", dryKgNHa: 45, irrigatedKgNHa: 55, sweetSeedKgNHa: 30 },
    { soil: "sur_granite", dryKgNHa: null, irrigatedKgNHa: null, sweetSeedKgNHa: null },
    { soil: "argileux_sablo_argileux", dryKgNHa: 30, irrigatedKgNHa: 40, sweetSeedKgNHa: 20 },
  ],
};

export interface CerealsMhRow {
  soil: NaSoilType;
  /** Mh céréales à paille après l'ouverture du bilan ; null = « - ». */
  mhKgNHa: number | null;
}

export const cerealsMh: Table<CerealsMhRow> = {
  id: "na-2025-cereals-mh",
  source: cerealsSource("Annexe 2.1.b, tableau 11, p. 8"),
  notes: [
    "Une seule colonne (céréales à paille). Dans le PDF, terrasses de vallées précède limoneux (ordre inversé par rapport aux autres tableaux).",
    "Sols de marais argileux sodiques et sols sur granite : « - » (null).",
    "Source du tableau : GREN.",
  ],
  rows: [
    { soil: "argilo_calcaire", mhKgNHa: 20 },
    { soil: "sableux", mhKgNHa: 40 },
    { soil: "fond_vallee_terres_noires", mhKgNHa: 30 },
    { soil: "marais_argileux_sodiques", mhKgNHa: null },
    { soil: "terrasses_vallees", mhKgNHa: 35 },
    { soil: "limoneux", mhKgNHa: 35 },
    { soil: "sur_granite", mhKgNHa: null },
    { soil: "argileux_sablo_argileux", mhKgNHa: 25 },
  ],
};

/* -------------------------------------------------------------------------- */
/* 9. Mhp (identique dans les deux annexes)                                   */
/* -------------------------------------------------------------------------- */

export type GrasslandAgeClass = "lt_18_months" | "2_3_years" | "4_5_years" | "6_10_years" | "gt_10_years";

export interface MhpRow {
  destruction: "spring" | "autumn";
  /** Rang de la culture après destruction. */
  rank: 1 | 2;
  /** "any" : ligne « / » unique (automne, 2e culture). */
  productionType: GrasslandProductionType | "any";
  /** null pour l'association ou la ligne « / ». */
  mode: GrasslandMode | null;
  ageClass: GrasslandAgeClass;
  mhpKgNHa: number;
}

const AGE_CLASSES: GrasslandAgeClass[] = ["lt_18_months", "2_3_years", "4_5_years", "6_10_years", "gt_10_years"];

function mhpLine(
  destruction: MhpRow["destruction"],
  rank: MhpRow["rank"],
  productionType: MhpRow["productionType"],
  mode: GrasslandMode | null,
  values: number[],
): MhpRow[] {
  return values.map((v, i) => ({ destruction, rank, productionType, mode, ageClass: AGE_CLASSES[i]!, mhpKgNHa: v }));
}

export const mhp: Table<MhpRow> = {
  id: "na-2025-mhp",
  source: maizeSource("Annexe 2.2.b, tableau 13, p. 8-9 (identique : annexe 2.1.b, tableau 12, p. 8-9)"),
  notes: [
    "Vaut pour Mhp et Mhp précédent.",
    "Classes d'âge imprimées : < 18 mois, 2-3 ans, 4-5 ans, 6-10 ans, > 10 ans ; l'intervalle 18 mois – 2 ans et les bornes entre classes ne sont pas précisés.",
    "Destruction d'automne, 2e culture : une seule ligne « / » à 0 pour tous les types (productionType \"any\").",
    "Source du tableau : GREN.",
  ],
  rows: [
    ...mhpLine("spring", 1, "graminees_pures", "pature_integrale", [20, 60, 100, 120, 140]),
    ...mhpLine("spring", 1, "graminees_pures", "fauche_paturage", [14, 42, 70, 84, 98]),
    ...mhpLine("spring", 1, "graminees_pures", "fauche_integrale", [8, 24, 40, 48, 56]),
    ...mhpLine("spring", 1, "association_graminees_legumineuses", null, [20, 60, 100, 120, 140]),
    ...mhpLine("spring", 2, "graminees_pures", "pature_integrale", [0, 0, 25, 35, 40]),
    ...mhpLine("spring", 2, "graminees_pures", "fauche_paturage", [0, 0, 17.5, 24.5, 28]),
    ...mhpLine("spring", 2, "graminees_pures", "fauche_integrale", [0, 0, 10, 14, 16]),
    ...mhpLine("spring", 2, "association_graminees_legumineuses", null, [0, 0, 25, 35, 40]),
    ...mhpLine("autumn", 1, "graminees_pures", "pature_integrale", [10, 30, 50, 60, 70]),
    ...mhpLine("autumn", 1, "graminees_pures", "fauche_paturage", [7, 21, 35, 42, 49]),
    ...mhpLine("autumn", 1, "graminees_pures", "fauche_integrale", [4, 12, 20, 24, 28]),
    ...mhpLine("autumn", 1, "association_graminees_legumineuses", null, [10, 30, 50, 60, 70]),
    ...mhpLine("autumn", 2, "any", null, [0, 0, 0, 0, 0]),
  ],
};

/* -------------------------------------------------------------------------- */
/* 10. Mr (identique dans les deux annexes)                                   */
/* -------------------------------------------------------------------------- */

export interface MrRow {
  key: string;
  label: string;
  /** Ouverture du bilan en sortie d'hiver. */
  endOfWinterKgNHa: number | null;
  /** Ouverture du bilan en avril. */
  aprilKgNHa: number | null;
}

export const mr: Table<MrRow> = {
  id: "na-2025-mr",
  source: maizeSource("Annexe 2.2.b, tableau 14, p. 9 (identique : annexe 2.1.b, tableau 13, p. 9)"),
  notes: [
    "* Ouverture en avril : « Date d’ouverture du bilan dans certains cas pour des cultures d’été (maïs, pomme de terre...) ».",
    "Aucune cellule vide dans ce tableau.",
    "Source du tableau : COMIFER.",
  ],
  rows: [
    { key: "betterave", label: "Betterave", endOfWinterKgNHa: 20, aprilKgNHa: 10 },
    { key: "carotte", label: "Carotte", endOfWinterKgNHa: 10, aprilKgNHa: 0 },
    { key: "cereales_pailles_enfouies", label: "Céréales, pailles enfouies", endOfWinterKgNHa: -20, aprilKgNHa: -10 },
    { key: "cereales_pailles_enlevees", label: "Céréales, pailles enlevées ou brûlées", endOfWinterKgNHa: 0, aprilKgNHa: 0 },
    { key: "colza", label: "Colza", endOfWinterKgNHa: 20, aprilKgNHa: 10 },
    { key: "culture_intermediaire", label: "Culture intermédiaire", endOfWinterKgNHa: 0, aprilKgNHa: 0 },
    { key: "endive", label: "Endive", endOfWinterKgNHa: 10, aprilKgNHa: 0 },
    { key: "feverole", label: "Féverole", endOfWinterKgNHa: 30, aprilKgNHa: 20 },
    { key: "lin_fibre", label: "Lin fibre", endOfWinterKgNHa: 0, aprilKgNHa: 0 },
    { key: "lupin", label: "Lupin", endOfWinterKgNHa: 20, aprilKgNHa: 10 },
    { key: "luzerne_automne_n1", label: "Luzerne (retournement fin été / début automne) : année n+1", endOfWinterKgNHa: 40, aprilKgNHa: 30 },
    { key: "luzerne_automne_n2", label: "Luzerne (retournement fin été / début automne) : année n+2", endOfWinterKgNHa: 20, aprilKgNHa: 20 },
    { key: "luzerne_printemps", label: "Luzerne (retournement de printemps)", endOfWinterKgNHa: 60, aprilKgNHa: 60 },
    { key: "mais_fourrage", label: "Maïs fourrage", endOfWinterKgNHa: 0, aprilKgNHa: 0 },
    { key: "mais_grain", label: "Maïs grain (y compris maïs semence, maïs doux…)", endOfWinterKgNHa: -10, aprilKgNHa: 0 },
    { key: "pois_haricots_conserve", label: "Pois, haricots de conserve", endOfWinterKgNHa: 20, aprilKgNHa: 10 },
    { key: "pois_proteagineux", label: "Pois protéagineux", endOfWinterKgNHa: 20, aprilKgNHa: 10 },
    { key: "pomme_de_terre", label: "Pomme de terre", endOfWinterKgNHa: 20, aprilKgNHa: 10 },
    { key: "prairie", label: "Prairie", endOfWinterKgNHa: 0, aprilKgNHa: 0 },
    { key: "ray_grass_derobe", label: "Ray-grass dérobé", endOfWinterKgNHa: -30, aprilKgNHa: 0 },
    { key: "soja", label: "Soja", endOfWinterKgNHa: 20, aprilKgNHa: 10 },
    { key: "sorgho", label: "Sorgho (ensilage ou grain)", endOfWinterKgNHa: -10, aprilKgNHa: 0 },
    { key: "tournesol", label: "Tournesol", endOfWinterKgNHa: -10, aprilKgNHa: 0 },
  ],
};

/* -------------------------------------------------------------------------- */
/* 11. MrCi (identique dans les deux annexes)                                 */
/* -------------------------------------------------------------------------- */

export type CoverFamily =
  | "cruciferes"
  | "graminees_seigle_avoine"
  | "graminees_ray_grass"
  | "legumineuses"
  | "hydrophyllacees"
  | "melange_graminees_legumineuses"
  | "melange_cruciferes_legumineuses";

/** Production de la culture intermédiaire (t MS/ha) : ≤ 1, entre 1 et 3, ≥ 3. */
export type CoverBiomassClass = "le_1" | "1_3" | "ge_3";

export interface MrciRow {
  family: CoverFamily;
  biomass: CoverBiomassClass;
  /** Destruction nov./déc. ou après janvier (« > Janv »). */
  destruction: "nov_dec" | "after_january";
  opening: Opening;
  mrciKgNHa: number;
}

const BIOMASS: CoverBiomassClass[] = ["le_1", "1_3", "ge_3"];

/** Une ligne imprimée = [sortie hiver nov/déc, sortie hiver > janv, avril nov/déc, avril > janv]. */
function mrciFamily(family: CoverFamily, lines: [number, number, number, number][]): MrciRow[] {
  return lines.flatMap(([ewNd, ewJ, apNd, apJ], i) => [
    { family, biomass: BIOMASS[i]!, destruction: "nov_dec" as const, opening: "end_of_winter" as const, mrciKgNHa: ewNd },
    { family, biomass: BIOMASS[i]!, destruction: "after_january" as const, opening: "end_of_winter" as const, mrciKgNHa: ewJ },
    { family, biomass: BIOMASS[i]!, destruction: "nov_dec" as const, opening: "april" as const, mrciKgNHa: apNd },
    { family, biomass: BIOMASS[i]!, destruction: "after_january" as const, opening: "april" as const, mrciKgNHa: apJ },
  ]);
}

export const mrci: Table<MrciRow> = {
  id: "na-2025-mrci",
  source: maizeSource("Annexe 2.2.b, tableau 15, p. 10 (identique : annexe 2.1.b, tableau 14, p. 10)"),
  notes: [
    "Vaut pour MrCi et MrCi précédent.",
    "Céréales (annexe 2.1.b, p. 10) : « Pour les cultures d’hiver : MrCi est négligeable donc MrCi = 0 » ; le tableau ne s'applique qu'aux cultures de printemps.",
    "Classes de biomasse imprimées « ≤1 » (« <=1 » pour le ray-grass), « entre 1 et 3 », « ≥3 » : les bornes 1 et 3 appartiennent à deux classes, le texte ne tranche pas.",
    "Il n'y a pas de tableau 16 dans l'annexe 2.2.b.",
    "Source du tableau : COMIFER.",
  ],
  rows: [
    ...mrciFamily("cruciferes", [[5, 10, 0, 5], [10, 15, 5, 10], [15, 20, 10, 15]]),
    ...mrciFamily("graminees_seigle_avoine", [[0, 5, 0, 0], [5, 10, 0, 5], [10, 15, 5, 10]]),
    ...mrciFamily("graminees_ray_grass", [[5, 10, 0, 5], [10, 15, 5, 10], [15, 20, 10, 15]]),
    ...mrciFamily("legumineuses", [[10, 20, 5, 10], [20, 30, 10, 20], [30, 40, 20, 30]]),
    ...mrciFamily("hydrophyllacees", [[0, 5, 0, 0], [5, 10, 0, 5], [10, 15, 5, 10]]),
    ...mrciFamily("melange_graminees_legumineuses", [[5, 13, 3, 5], [13, 20, 5, 13], [20, 28, 13, 20]]),
    ...mrciFamily("melange_cruciferes_legumineuses", [[8, 15, 3, 8], [15, 23, 8, 15], [23, 30, 15, 23]]),
  ],
};

/* -------------------------------------------------------------------------- */
/* 12. Nirr                                                                   */
/* -------------------------------------------------------------------------- */

export type NirrScope = "maize_sorghum" | "straw_cereals";

export interface NirrParamsRow {
  scope: NirrScope;
  /** Nirr = mm × NO3 (mg/L) / divisor. */
  divisor: number;
  /** L'apport n'est compté que si l'eau prévue est « supérieure à » ce seuil (mm). */
  thresholdMm: number;
  /** Teneur de référence, eau superficielle (mg NO3/L). */
  surfaceNo3MgL: number;
  /** Teneur de référence, eau souterraine (mg NO3/L) ; une valeur inférieure est admise sur justificatif. */
  groundNo3MgL: number;
}

export const nirr: Table<NirrParamsRow> = {
  id: "na-2025-nirr",
  source: maizeSource("Annexe 2.2.b, § 8, p. 10-11 ; annexe 2.1.b, § 8, p. 11"),
  notes: [
    "Seuil différent selon l'annexe : 100 mm pour le maïs/sorgho, 120 mm pour les céréales à paille.",
    "Le texte dit « supérieure à 100 mm » (strict) mais le tableau de correspondance maïs commence à 100 mm (9 et 6 kg N/ha).",
    "Eau souterraine : une teneur < 40 mg/L peut être retenue si elle est justifiée par une mesure (analyse ou bandelette pendant la période d'irrigation) ou des références locales annuelles ; l'agriculteur tient le justificatif à disposition.",
  ],
  rows: [
    { scope: "maize_sorghum", divisor: 443, thresholdMm: 100, surfaceNo3MgL: 25, groundNo3MgL: 40 },
    { scope: "straw_cereals", divisor: 443, thresholdMm: 120, surfaceNo3MgL: 25, groundNo3MgL: 40 },
  ],
};

export interface NirrExampleRow {
  scope: NirrScope;
  waterSource: "ground" | "surface";
  no3MgL: number;
  waterMm: number;
  /** Azote apporté imprimé (kg N/ha). */
  nKgNHa: number;
}

const nirrLine = (
  scope: NirrScope,
  waterSource: NirrExampleRow["waterSource"],
  pairs: [number, number][],
): NirrExampleRow[] =>
  pairs.map(([waterMm, nKgNHa]) => ({
    scope,
    waterSource,
    no3MgL: waterSource === "ground" ? 40 : 25,
    waterMm,
    nKgNHa,
  }));

export const nirrExamples: Table<NirrExampleRow> = {
  id: "na-2025-nirr-examples",
  source: maizeSource("Annexe 2.2.b, p. 11 ; annexe 2.1.b, p. 11 (tableaux de correspondance)"),
  notes: ["Les valeurs imprimées correspondent à Math.round(mm × NO3 / 443)."],
  rows: [
    ...nirrLine("maize_sorghum", "ground", [[100, 9], [120, 11], [140, 13], [160, 14], [180, 16], [200, 18], [220, 20], [240, 22]]),
    ...nirrLine("maize_sorghum", "surface", [[100, 6], [120, 7], [140, 8], [160, 9], [180, 10], [200, 11], [220, 12], [240, 14]]),
    ...nirrLine("straw_cereals", "ground", [[120, 11], [140, 13], [160, 14], [180, 16], [200, 18], [220, 20], [240, 22]]),
    ...nirrLine("straw_cereals", "surface", [[120, 7], [140, 8], [160, 9], [180, 10], [200, 11], [220, 12], [240, 14]]),
  ],
};

/* -------------------------------------------------------------------------- */
/* 13. CAU                                                                    */
/* -------------------------------------------------------------------------- */

export type MaizeCauStage = "before_4_leaves" | "4_leaves_to_flowering" | "4_to_12_leaves";

export interface MaizeCauRow {
  crops: CropGroup[];
  label: string;
  stage: MaizeCauStage;
  /** Classe de rendement (q/ha), maïs semence seulement. */
  yieldMaxQ?: number;
  yieldMaxInclusive?: boolean;
  yieldMinQ?: number;
  yieldMinInclusive?: boolean;
  cau: number;
}

const GRAIN_SILAGE: CropGroup[] = ["maize_grain", "maize_silage", "sorghum_grain", "sorghum_silage"];

export const maizeCau: Table<MaizeCauRow> = {
  id: "na-2025-maize-cau",
  source: maizeSource("Annexe 2.2.b, tableau 17, p. 12"),
  notes: [
    "Maïs semence : le rendement (≤ 30 / > 30 q/ha) ne départage que la phase 4 – 12 feuilles ; il s'agit vraisemblablement du rendement des rangs femelles mais le tableau ne le précise pas.",
    "Le maïs pop-corn n'est pas cité dans le tableau 17.",
    "Source du tableau : GREN.",
  ],
  rows: [
    { crops: GRAIN_SILAGE, label: "Maïs / sorgho grain et fourrage, avant 4 feuilles", stage: "before_4_leaves", cau: 0.6 },
    { crops: GRAIN_SILAGE, label: "Maïs / sorgho grain et fourrage, 4 feuilles - floraison", stage: "4_leaves_to_flowering", cau: 0.8 },
    { crops: ["maize_seed"], label: "Maïs semence, avant 4 feuilles", stage: "before_4_leaves", cau: 0.6 },
    {
      crops: ["maize_seed"],
      label: "Maïs semence, 4 – 12 feuilles, Rdt ≤ 30 q/ha",
      stage: "4_to_12_leaves",
      yieldMaxQ: 30,
      yieldMaxInclusive: true,
      cau: 0.7,
    },
    {
      crops: ["maize_seed"],
      label: "Maïs semence, 4 – 12 feuilles, Rdt > 30 q/ha",
      stage: "4_to_12_leaves",
      yieldMinQ: 30,
      yieldMinInclusive: false,
      cau: 0.8,
    },
    { crops: ["maize_sweet"], label: "Maïs doux, avant 4 feuilles", stage: "before_4_leaves", cau: 0.6 },
    { crops: ["maize_sweet"], label: "Maïs doux, 4 – 12 feuilles", stage: "4_to_12_leaves", cau: 0.7 },
  ],
};

export interface CerealsCauRow {
  condition: "standard" | "unfavourable";
  cau: number;
  /** Texte de la condition, recopié. */
  conditionText: string;
}

export const cerealsCau: Table<CerealsCauRow> = {
  id: "na-2025-cereals-cau",
  source: cerealsSource("Annexe 2.1.b, § 9, p. 11"),
  notes: [
    "Avec CAU 0,8 : « L'objectif de rendement doit alors être revu à la baisse, et dans tous les cas, être inférieur : à celui du calcul décrit dans l'article 2 de l'arrêté préfectoral ; à la valeur moyenne départementale indiquée dans le tableau 2. » Le tableau 2 n'existe pas dans l'annexe 2.1.b (renvoi à rapprocher des références de rendement publiées à part).",
  ],
  rows: [
    { condition: "standard", cau: 0.9, conditionText: "Pour les céréales à paille, CAU = 0,9." },
    {
      condition: "unfavourable",
      cau: 0.8,
      conditionText:
        "Exceptionnellement et sur justificatifs : en cas de mauvaise structure sol, de conditions climatiques très défavorables (excès d'eau) ou de maladies (du pied, maladies précoces sur le feuillage), un CAU de 0,8 peut être utilisé.",
    },
  ],
};

/** Toutes les tables de ce module, pour les contrôles transverses. */
export const bilanCauTables = {
  maizeB,
  cerealsB,
  maizeSeedPf,
  maizeSeedCof,
  maizeRf,
  cerealsRf,
  piTillers,
  precedentsApl,
  valueA,
  valueAAnnual,
  riMaizeApl,
  riCerealsApl,
  riLegume,
  riGrassland,
  riAfterCover,
  maizeMh,
  cerealsMh,
  mhp,
  mr,
  mrci,
  nirr,
  nirrExamples,
  maizeCau,
  cerealsCau,
} as const;
