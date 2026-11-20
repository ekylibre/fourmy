import type { RefSource } from "../source.js";

/**
 * Engrais, amendements et éléments nutritifs utilisables en Agriculture
 * biologique (règlement 2021/1165, annexe II) : catégories de matières, pas
 * de noms commerciaux (docs/ab/rapport_ab.md §8.2.4). Un produit n'est admis
 * que s'il ne contient que des matières de la liste, dans leurs conditions.
 * Aucun engrais azoté de synthèse, aucune boue : exclus par le caractère
 * limitatif de la liste.
 */
export const ANNEX_II_SOURCE: RefSource = {
  text: "Règlement d'exécution (UE) 2021/1165",
  version: "15/07/2021 (version d'origine, modifications ultérieures non lues)",
  at: "annexe II, p. 13 à 17",
};

export type AnnexIIGroup = "effluent" | "compost" | "digestate" | "animal" | "plant" | "mineral" | "calcium" | "humic";

export const ANNEX_II_GROUP_LABELS: Record<AnnexIIGroup, string> = {
  effluent: "Effluents d'élevage",
  compost: "Composts et déchets",
  digestate: "Digestat",
  animal: "Produits animaux transformés",
  plant: "Matières végétales",
  mineral: "Phosphates et potasse",
  calcium: "Calcium, magnésium, soufre, oligo-éléments",
  humic: "Matières humiques et divers",
};

export interface AnnexIICategory {
  code: string;
  label: string;
  group: AnnexIIGroup;
  page: number;
  /** « Provenance d'élevages industriels interdite ». */
  industrialForbidden?: true;
  /** Compté dans le plafond de 170 kg N/ha (effluents d'élevage, annexe II partie I 1.9.4 du 2018/848). */
  counts170N?: true;
  /** Condition à justifier (pièce), non vérifiable par Fourmy. */
  condition?: string;
}

const c = (code: string, label: string, group: AnnexIIGroup, page: number, extra: Partial<AnnexIICategory> = {}): AnnexIICategory => ({ code, label, group, page, ...extra });

export const ANNEX_II: AnnexIICategory[] = [
  c("manure", "Fumier (excréments d'animaux et matière végétale)", "effluent", 13, { industrialForbidden: true, counts170N: true }),
  c("dried_manure", "Fumier séché et fiente de volaille déshydratée", "effluent", 13, { industrialForbidden: true, counts170N: true }),
  c("composted_manure", "Compost d'excréments d'animaux solides, fientes et fumiers compostés", "effluent", 13, { industrialForbidden: true, counts170N: true }),
  c("liquid_manure", "Excréments d'animaux liquides (lisier, purin)", "effluent", 13, { industrialForbidden: true, counts170N: true, condition: "après fermentation contrôlée ou dilution appropriée" }),
  c("household_compost", "Déchets ménagers compostés ou fermentés", "compost", 13, { condition: "tri à la source, collecte agréée, plafonds de métaux lourds" }),
  c("peat", "Tourbe", "compost", 13, { condition: "horticulture seulement (maraîchage, floriculture, arboriculture, pépinière)" }),
  c("mushroom_compost", "Compost de champignonnières", "compost", 13, { condition: "substrat initial composé de produits de l'annexe" }),
  c("vermicompost", "Lombricompost et déjections d'insectes", "compost", 13),
  c("guano", "Guano", "compost", 13),
  c("plant_compost", "Mélange composté ou fermenté de matières végétales (y compris biogaz)", "compost", 13),
  c("digestate", "Digestat de biogaz contenant des sous-produits animaux", "digestate", 14, { industrialForbidden: true, condition: "sous-produits de catégorie 3 ou contenu du tube digestif de catégorie 2 ; pas sur les parties comestibles" }),
  c("animal_meal", "Farines de sang, d'os, de corne, d'onglons, de poisson, de viande, de plumes", "animal", 14),
  c("wool_hair", "Laine, poils, fourrure", "animal", 14, { condition: "fourrure : chrome VI non détectable" }),
  c("dairy", "Produits laitiers", "animal", 14),
  c("hydrolysed_protein", "Protéines hydrolysées", "animal", 14, { condition: "pas sur les parties comestibles" }),
  c("plant_byproduct", "Produits et sous-produits organiques végétaux (tourteaux, coques de cacao, radicelles de malt)", "plant", 14),
  c("seaweed", "Algues et produits d'algues", "plant", 14, { condition: "procédés physiques, extraction aqueuse ou fermentation ; récolte biologique ou durable" }),
  c("wood", "Sciures, copeaux, écorces compostées, cendres de bois", "plant", 14, { condition: "bois non traité chimiquement après abattage" }),
  c("soft_rock_phosphate", "Phosphate naturel tendre", "mineral", 14),
  c("aluminium_calcium_phosphate", "Phosphate aluminocalcique", "mineral", 14, { condition: "sols basiques (pH > 7,5) seulement" }),
  c("basic_slag", "Scories de déphosphoration", "mineral", 15),
  c("crude_potash", "Sel brut de potasse", "mineral", 15),
  c("potassium_sulphate", "Sulfate de potassium", "mineral", 15, { condition: "obtenu par procédé physique, peut contenir du sel de magnésium" }),
  c("vinasse", "Vinasse et extraits de vinasse", "mineral", 15, { condition: "vinasses ammoniacales exclues" }),
  c("calcium_carbonate", "Carbonate de calcium (craie, marne, maërl…)", "calcium", 16, { condition: "origine naturelle" }),
  c("mollusc_waste", "Résidus de mollusques", "calcium", 16, { condition: "aquaculture biologique ou pêche durable" }),
  c("eggshells", "Coquilles d'œufs", "calcium", 16, { industrialForbidden: true }),
  c("calcium_magnesium_carbonate", "Carbonate de calcium et de magnésium, kiésérite", "calcium", 16, { condition: "origine naturelle" }),
  c("calcium_chloride", "Solution de chlorure de calcium", "calcium", 16, { condition: "traitement foliaire des pommiers seulement" }),
  c("gypsum", "Sulfate de calcium (gypse)", "calcium", 16),
  c("industrial_lime", "Chaux résiduaire de sucrerie ou de saline sous vide", "calcium", 16),
  c("sulphur", "Soufre élémentaire", "calcium", 16),
  c("trace_elements", "Engrais inorganique à oligo-éléments", "calcium", 16),
  c("sodium_chloride", "Chlorure de sodium", "calcium", 16),
  c("rock_dust", "Poudres de roche, argiles", "calcium", 16),
  c("leonardite", "Léonardite et xylite", "humic", 16),
  c("humic_acids", "Acides humiques et fulviques", "humic", 16, { condition: "hors sels d'ammonium" }),
  c("chitin", "Chitine", "humic", 16, { condition: "aquaculture biologique ou pêche durable" }),
  c("sapropel", "Sédiments anaérobies d'eau douce (sapropèle)", "humic", 16),
  c("biochar", "Biochar", "humic", 17, { condition: "matières végétales seulement" }),
];

export const ANNEX_II_BY_CODE: Record<string, AnnexIICategory> = Object.fromEntries(ANNEX_II.map((x) => [x.code, x]));

/** Plafond d'azote des effluents d'élevage (règle R16). */
export const ORGANIC_NITROGEN = {
  maxKgPerHa: 170,
  warnShare: 0.8,
} as const;

export const ORGANIC_NITROGEN_SOURCE: RefSource = {
  text: "Règlement (UE) 2018/848",
  version: "30/05/2018",
  at: "annexe II partie I point 1.9.4, p. 59",
};
