import type { RefSource } from "../source.js";

/**
 * BCAE 7 « La rotation et la diversification des cultures », campagne PAC
 * 2026 (claudedocs/conception_assolement.md §4.2) : catégories de culture,
 * cultures exclues de la rotation annuelle, seuils, exemptions et grille de
 * sanctions. Recopié de la fiche technique de conditionnalité 2026
 * (Télépac), annexes 1 à 4 et §2 à §6 ; les libellés perdus par l'extraction
 * de texte (apostrophes, « d'hiver ») ont été relus à l'image des pages.
 * Codes cultures vérifiés contre la nomenclature PAC 2026 de Lexicon.
 * Lecture et choix d'interprétation : docs/pac/rapport_pac.md.
 */
export const BCAE7_2026_SOURCE: RefSource = {
  text: "Fiche conditionnalité 2026 - Métropole, BCAE 7 « La rotation et la diversification des cultures »",
  version: "campagne PAC 2026",
  at: "Télépac, fiche technique",
};

export const bcae7At = (at: string): RefSource => ({ ...BCAE7_2026_SOURCE, at });

export interface Bcae7Category {
  id: string;
  label: string;
  /** Codes cultures 2026 (annexe 4). */
  codes: readonly string[];
  /**
   * Annexe 3, renvoi (1) : catégorie exclue des terres arables cultivées
   * (rotation annuelle), comptée comme culture différente pour la rotation
   * pluriannuelle et la diversification.
   */
  annualExcluded?: true;
  /**
   * Annexe 3, renvois (2) et (3) : chaque code culture est une culture
   * différente (fruits, légumes, fleurs ; plantes à parfum, aromatiques et
   * médicinales).
   */
  perCode?: true;
  /** Annexe 3, renvoi (4) : cultures associées, rotation respectée par nature. */
  rotationByNature?: true;
}

/** Annexe 4 : codes cultures correspondant aux catégories de l'annexe 3. */
export const BCAE7_CATEGORIES: readonly Bcae7Category[] = [
  { id: "autres-legumineuses-fourrageres", label: "Autres légumineuses fourragères y compris en mélange", codes: ["LOT", "MLF", "SAI", "TRE", "VES"] },
  { id: "autres-cereales-printemps", label: "Autres céréales et mélanges de printemps", codes: ["CAG", "MCS"] },
  { id: "autres-cereales-hiver", label: "Autres céréales et mélanges d'hiver", codes: ["CAH", "MCR"] },
  { id: "autres-fourrages", label: "Autres fourrages", codes: ["AFG", "CPL"] },
  { id: "autres-oleagineux", label: "Autres oléagineux d'hiver et de printemps", codes: ["OAG", "OHR", "CML"] },
  { id: "autres-proteagineux", label: "Autres protéagineux", codes: ["ARA", "PAG", "GES", "FNU", "PHF", "PHS"] },
  { id: "avoine-hiver", label: "Avoine d'hiver", codes: ["AVH"] },
  { id: "avoine-printemps", label: "Avoine de printemps", codes: ["AVP"] },
  { id: "betterave", label: "Betterave", codes: ["BTN"], annualExcluded: true },
  { id: "ble-dur-hiver", label: "Blé dur d'hiver", codes: ["BDH"] },
  { id: "ble-dur-printemps", label: "Blé dur de printemps", codes: ["BDP"] },
  { id: "ble-tendre-hiver", label: "Blé tendre d'hiver", codes: ["BTH"] },
  { id: "ble-tendre-printemps", label: "Blé tendre de printemps", codes: ["BTP"] },
  { id: "chanvre", label: "Chanvre", codes: ["CHV"] },
  { id: "colza-hiver", label: "Colza d'hiver", codes: ["CZH"] },
  { id: "colza-printemps", label: "Colza de printemps", codes: ["CZP"] },
  { id: "cultures-associees", label: "Cultures conduites en inter-rangs", codes: ["CIT", "CID"], rotationByNature: true },
  { id: "epeautre", label: "Épeautre", codes: ["EPE"] },
  { id: "feve-feverole", label: "Fève et féverole", codes: ["FEV", "FVP", "FVL"] },
  {
    id: "fruits-legumes-fleurs",
    label: "Fruits, légumes, fleurs",
    codes: ["AIL", "ANA", "ART", "CAR", "CCN", "CEL", "CHU", "EPI", "FLA", "FRA", "LBF", "MDI", "MLO", "NVT", "OIG", "POR", "POT", "PVP", "RDI", "TBT", "TOM"],
    perCode: true,
  },
  { id: "herbe", label: "Herbe prédominante (prairies, jachères, mélanges légumineuses/graminées)", codes: ["JAC", "MLG", "PTR", "GRA"], annualExcluded: true },
  { id: "melange-legumineuses-cereales", label: "Mélange de légumineuses / protéagineux prépondérants et de céréales/oléagineux", codes: ["MLC", "MPC"] },
  { id: "lentille", label: "Lentille", codes: ["LEC"] },
  { id: "lin-hiver", label: "Lin d'hiver", codes: ["LIH"] },
  { id: "lin-printemps", label: "Lin de printemps", codes: ["LIP"] },
  { id: "lin-fibres", label: "Lin fibres", codes: ["LIF"] },
  { id: "lupin-hiver", label: "Lupin d'hiver", codes: ["LDH"], annualExcluded: true },
  { id: "lupin-printemps", label: "Lupin de printemps", codes: ["LDP"], annualExcluded: true },
  { id: "luzerne", label: "Luzerne", codes: ["LUZ"], annualExcluded: true },
  { id: "mais", label: "Maïs et maïs semence", codes: ["MID", "MIS"] },
  { id: "millet", label: "Millet", codes: ["MLT"] },
  { id: "moha", label: "Moha", codes: ["MOH"] },
  { id: "moutarde", label: "Moutarde", codes: ["MOT"] },
  { id: "oeillette", label: "Œillette (pavot)", codes: ["OEI"] },
  { id: "orge-printemps", label: "Orge de printemps", codes: ["ORP"] },
  { id: "orge-hiver", label: "Orge d'hiver", codes: ["ORH"] },
  { id: "ppam", label: "Plantes à parfum, aromatiques et médicinales", codes: ["AAR", "AME", "PSL", "HPC"], annualExcluded: true, perCode: true },
  { id: "pois-chiche", label: "Pois chiche", codes: ["PCH"] },
  { id: "pois-hiver", label: "Pois protéagineux d'hiver", codes: ["PHI"] },
  { id: "pois-printemps", label: "Pois protéagineux de printemps", codes: ["PPR"] },
  { id: "pomme-de-terre", label: "Pomme de terre", codes: ["PTC"] },
  { id: "riz", label: "Riz", codes: ["RIZ"] },
  { id: "sarrasin", label: "Sarrasin", codes: ["SRS"] },
  { id: "seigle-printemps", label: "Seigle de printemps", codes: ["SGP"] },
  { id: "seigle-hiver", label: "Seigle d'hiver", codes: ["SGH"] },
  { id: "soja", label: "Soja", codes: ["SOJ"] },
  { id: "sorgho", label: "Sorgho", codes: ["SOG"] },
  { id: "tabac", label: "Tabac", codes: ["TAB"] },
  { id: "tournesol", label: "Tournesol", codes: ["TRN"] },
  { id: "triticale-hiver", label: "Triticale d'hiver", codes: ["TTH"] },
  { id: "triticale-printemps", label: "Triticale de printemps", codes: ["TTP"] },
];

/**
 * Annexe 1 : cultures exclues de la vérification de la rotation annuelle
 * (cultures pluriannuelles, surfaces herbacées temporaires, jachères,
 * cultures sous eau). Terres arables, hors « terres arables cultivées ».
 */
export const BCAE7_ANNEX1_CODES: readonly string[] = [
  "LOT", "LDH", "LDP", "LUZ", "VES", "SAI", "TRE", // légumineuses à graines et fourragères
  "BTN", "CSA", "HBL", // cultures industrielles et plantes sarclées
  "ART", "CEL", "FRA", // légumes et fruits
  "AME", "AAR", "PSL", // plantes aromatiques, médicinales et à parfum non pérennes
  "HPC", // horticulture ornementale
  "MLG", "PTR", "JAC", // surfaces herbacées temporaires, jachère
  "RIZ",
];

/**
 * Terres arables de l'annexe 1 sans catégorie à l'annexe 4 (canne à sucre,
 * houblon) : chaque code compte comme une culture différente.
 */
export const BCAE7_ANNEX1_WITHOUT_CATEGORY: readonly string[] = ["CSA", "HBL"];

/** Maraîchage diversifié : rotation respectée par défaut (annexe 3, renvoi 2). */
export const BCAE7_ROTATION_BY_DEFAULT: readonly string[] = ["MDI"];

/** Surface temporairement non exploitée : rotation pluriannuelle respectée par défaut (§3 B). */
export const BCAE7_NOT_EXPLOITED: readonly string[] = ["SNE"];

/**
 * Annexe 2, exemption « plus de 75 % des terres arables » : herbe et
 * jachère (liste 1.5 de la notice Cultures et précisions : MLG, PTR, JAC)
 * et légumineuses (liste 1.3). La liste 1.3 n'est pas dans la fiche : elle
 * est reconstituée d'après les catégories de légumineuses de l'annexe 4
 * (rapport_pac.md §3).
 */
export const BCAE7_ANNEX2_GRASS_FALLOW: readonly string[] = ["MLG", "PTR", "JAC"];
export const BCAE7_ANNEX2_LEGUMES: readonly string[] = [
  "LOT", "MLF", "SAI", "TRE", "VES", "GES", "FNU", "ARA", "PAG", "PHF", "PHS",
  "FEV", "FVP", "FVL", "LEC", "LDH", "LDP", "LUZ", "PCH", "PHI", "PPR", "SOJ", "MLC", "MPC",
];
/**
 * Annexe 2, exemption « plus de 75 % de la surface agricole admissible » :
 * prairies permanentes (liste 1.6), MLG, PTR, riz.
 */
export const BCAE7_PERMANENT_GRASSLAND: readonly string[] = ["PPH", "SPH", "SPL"];
export const BCAE7_ANNEX2_GRASSLAND_SAU: readonly string[] = [...BCAE7_PERMANENT_GRASSLAND, "MLG", "PTR", "RIZ"];

/**
 * Codes cultures 2026 hors terres arables (cultures permanentes, prairies
 * permanentes, surfaces pastorales, éléments non productifs) : nomenclature
 * PAC 2026 de Lexicon, moins les codes de l'annexe 4 et de l'annexe 1.
 */
export const BCAE7_NON_ARABLE_CODES: readonly string[] = [
  "ACP", "AGR", "ARP", "BCA", "BEF", "BFS", "BOR", "BTA", "CAC", "CAE", "CBT", "CEE", "CSS", "CTG",
  "FLP", "JNO", "LAV", "MRS", "MSW", "NOS", "NOX", "OLI", "PEP", "PEV", "PFR", "PME", "PPH", "PPP",
  "PRF", "PRU", "PVT", "PWT", "SAG", "SBO", "SHD", "SIN", "SNU", "SPH", "SPL", "TCR", "TRU", "VNL",
  "VRC", "VRG",
];

export const BCAE7_2026 = {
  /** §3 A : part minimale des terres arables cultivées en rotation. */
  annualMinShare: 0.35,
  /** §3 B : période du critère pluriannuel (n-3 à n). */
  multiannualYears: 4,
  /** §3 B : catégories différentes attendues sur la période. */
  multiannualMinCategories: 2,
  /** §2 : exemptions. */
  exemptArableMaxHa: 10,
  exemptGrassLegumeShare: 0.75,
  exemptPermanentGrasslandShare: 0.75,
  /** §2 : pas de contrôle sous ce seuil de SAU à partir de 2026. */
  noControlUnderSauHa: 30,
  /** §5 : diversification hors Alsace. */
  diversification: {
    smallFarm: { fromHa: 10, toHa: 30, minCrops: 2, mainMaxShare: 0.75, toleranceHa: 0.5 },
    largeFarm: { fromHa: 30, minCrops: 3, mainMaxShare: 0.75, twoMainMaxShare: 0.95, toleranceHa: 2 },
  },
  /** §6 : alerte informative (pas de réduction) si l'écart est faible. */
  tolerance: { share: 0.03, ha: 2 },
  /** §4 : plaine du Rhin, diversification à points (annexe 5), minimum. */
  alsaceMinPoints: 3,
} as const;

export const BCAE7_2026_AT = {
  exemptions: "§2 « Qui est concerné ? », p. 3",
  annual: "§3 A « Critère annuel », p. 4-5",
  multiannual: "§3 B « Critère pluriannuel », p. 6-9",
  alsace: "§4 et annexe 5, p. 10 et 22-23",
  diversification: "§5 « La diversification des cultures sur le reste du territoire », p. 10-11",
  sanctions: "§6 « Grille de sanctions », p. 12-15",
  categories: "annexes 3 et 4, p. 18-21",
} as const;

const BY_CODE = new Map<string, Bcae7Category>();
for (const c of BCAE7_CATEGORIES) for (const code of c.codes) BY_CODE.set(code, c);

/** Catégorie BCAE 7 d'un code culture, ou undefined. */
export function bcae7Category(code: string): Bcae7Category | undefined {
  return BY_CODE.get(code.toUpperCase());
}
