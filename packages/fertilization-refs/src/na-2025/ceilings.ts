/**
 * Annexes 4.0 à 4.4 du référentiel GREN Nouvelle-Aquitaine (arrêté du
 * 29/07/2025) : cultures à dose plafond (légumes, légumineuses, couverts
 * d'interculture, autres cultures). Recopié et contrôlé sur le rendu des pages
 * (les tableaux de l'annexe 4.3 et le tableau asperge 33/40 sont des images).
 */

import type { CropGroup, Source, Table } from "../types.js";
import type { NaDepartment } from "./methods.js";

const ORG = "Préfecture de la région Nouvelle-Aquitaine (GREN)";
const DATE = "2025-07-29";
const LICENCE = "Arrêté préfectoral publié (document administratif) ; valeurs citées de leurs organismes";
const URL_BASE = "https://www.nouvelle-aquitaine.developpement-durable.gouv.fr/IMG/pdf/";

function src(file: string, title: string, ref: string): Source {
  return { title, organisation: ORG, date: DATE, url: URL_BASE + file, ref, licence: LICENCE };
}

/** Règle générale des doses plafond (annexe 4, intro), citée. */
export const naCeilingRules = {
  inequality: "X + Nirr + Xa ≤ Dose plafond",
  terms: {
    X: "fertilisation azotée minérale",
    Nirr: "apport d'azote par l'eau d'irrigation",
    Xa: "équivalent engrais minéral de l'azote fourni par les produits résiduaires organiques",
  },
  text: [
    "Pour les cultures présentées dans cette annexe, la méthode opérationnelle du bilan d’azote prévisionnel n’est pas appliquée. La limitation de l’épandage des fertilisants est assurée par la fixation d’une dose plafond d’azote total par hectare.",
    "Ces doses plafond correspondent à un apport d’azote maximum. Un raisonnement de la fertilisation conduisant à des doses d’apport inférieures est recommandé.",
    "Les doses plafond sont exprimées en kg d’azote efficace par hectare. La dose d’azote prévisionnelle tient compte des apports sous forme d’engrais minéral, d’eau d’irrigation, et d’engrais organique.",
    "Xa = Npro x Q x Keq (annexe 5 ; apport de fin d’été, d’automne ou de printemps). Si des produits résiduaires organiques différents sont appliqués ou s’ils sont appliqués à des dates différentes, les valeurs de Xa s’additionnent.",
    "Nirr = (Q H2O) x (T NO3) / 443, pris en compte seulement si l'eau prévue est supérieure à 100 mm ; T NO3 de référence 25 mg/L (superficielle), 40 mg/L (souterraine).",
    "Le GREN recommande de fractionner les apports d’azote en fonction de la longueur du cycle de la culture et de ses besoins.",
  ],
  /** Annexe 4.1 : cumul des plafonds pour plusieurs espèces la même année. */
  vegetablesSuccession:
    "Lorsque plusieurs espèces sont cultivées sur la même surface au cours d’une même année culturale, la quantité totale d’azote pouvant être apportée est calculée en ajoutant les doses plafond de chaque espèce cultivée sur cette surface.",
  /** Annexe 4.4 §6 : plafond par défaut. */
  defaultOtherCrops:
    "Pour les cultures non mentionnées dans les annexes 2, 3 et 4 de l’arrêté référentiel, la dose totale d'azote efficace prévisionnelle est plafonnée à 210 kg N/ha.",
} as const;

export interface CeilingRow {
  cropLabel: string;
  crops: CropGroup[];
  /** Dose plafond (kgN/ha) ; pour une fourchette, la borne haute. */
  doseKgNHa: number;
  /** Borne basse quand l'annexe donne une fourchette (pois chiche 50 à 100). */
  doseMinKgNHa?: number;
  unit: "efficient";
  period: "year" | "3_years";
  /** Plafond portant sur le seul azote minéral (vigne 80 kgN/ha/an). */
  mineralOnly?: boolean;
  /** Organisme source imprimé sous le tableau. */
  sourceOrg: string;
  annex: "4.1" | "4.2" | "4.4";
  departments?: NaDepartment[] | "all";
  excludedDepartments?: NaDepartment[];
  /** Conditions d'application imprimées. */
  condition?: string;
  /** « Recommandation en termes de répartition des apports » (4.1). */
  splitRecommendation?: string;
}

const V = (
  cropLabel: string,
  doseKgNHa: number,
  splitRecommendation?: string,
  extra: Partial<CeilingRow> = {},
): CeilingRow => ({
  cropLabel,
  crops: ["vegetables"],
  doseKgNHa,
  unit: "efficient",
  period: "year",
  sourceOrg: "GREN",
  annex: "4.1",
  ...(splitRecommendation ? { splitRecommendation } : {}),
  ...extra,
});

const ASP_REC =
  "Les apports d’azote minéral doivent obligatoirement être fractionnés, la dose maximale par apport ne pouvant pas dépasser 70 kg/ha. Sur sol sableux (> 70 %), du compost de déchets verts peut être initialement apporté la première année. Références fertilisation raisonnée : www.sudexpe.net/Fertilisation-de-l-asperge";
const POIVRON = "50 U avant plantation. Le reste en fractionnement en cours de culture après nouaison.";
const TOMATE = "50 U avant plantation. Fractionnement en cours de culture à partir de la nouaison du 1er bouquet.";
const AUBERGINE = "60 U maximum à la plantation. Le reste à partir de la nouaison des fruits.";
const PDT = "Dose à diminuer en fonction de la teneur en matière organique du sol.";

export const naVegetableCeilings: Table<CeilingRow> = {
  id: "na-2025/ceilings-vegetables",
  source: src(
    "4_1_legumes_gren_na_vdef.pdf",
    "Arrêté référentiel GREN Nouvelle-Aquitaine – Annexe 4.1 : fertilisation des légumes de plein champ et des cultures maraîchères, dose plafond",
    "Annexe 4.1, tableau des doses plafond par espèce, pp. 1-2",
  ),
  notes: [
    "Doses plafond en kgN/ha d'azote efficace (annexe 4, intro) ; l'annexe 4.1 n'imprime pas d'organisme source sous le tableau : sourceOrg = « GREN » par défaut.",
    "Le plafond s'entend par espèce et par culture ; plusieurs espèces sur la même surface la même année : doses plafond additionnées (naCeilingRules.vegetablesSuccession).",
    "Une recommandation de répartition imprimée sur une cellule fusionnée (aubergine, poivron, pommes de terre, tomates) est recopiée sur chaque ligne concernée.",
    "Chou-fleur : case de recommandation vide.",
    "Les pois et les haricots se trouvent dans l’annexe 4.2 – Légumineuses.",
  ],
  rows: [
    V("Ail", 150, "Fractionnement à la plantation, sortie hiver et au printemps"),
    V("Artichaut", 180, "30 U un mois après la plantation. 30 U à la formation des capitules"),
    V("Asperge (sauf départements 33 et 40) – Année 1", 60, ASP_REC, { excludedDepartments: ["33", "40"] }),
    V("Asperge (sauf départements 33 et 40) – Année 2", 100, ASP_REC, { excludedDepartments: ["33", "40"] }),
    V("Asperge (sauf départements 33 et 40) – Année 3", 150, ASP_REC, { excludedDepartments: ["33", "40"] }),
    V("Asperges (départements 33 et 40) – 1re pousse", 200, "Se référer au tableau ci-après", { departments: ["33", "40"] }),
    V("Asperges (départements 33 et 40) – Production", 350, "Se référer au tableau ci-après", { departments: ["33", "40"] }),
    V("Aubergine", 250, AUBERGINE),
    V("Aubergine sous abri", 300, AUBERGINE),
    V("Betterave potagère", 250, "Avant semis : 40 à 80 U. Le reste en 2 apports (2 et 3 mois après le semis)."),
    V("Brocoli à jet", 230, "1/3 à la plantation. Le reste : 1 mois après."),
    V("Carotte", 120, "10 à 40 U au semis si nécessaire. Le reste en 2 ou 3 fois en cours de culture."),
    V("Céleri rave", 260, "Fractionnement en 2 à 3 fois entre la plantation et le boulage."),
    V("Céleri branche", 220, "Fractionnement en 2 ou 4 fois entre et après la plantation."),
    V("Chou pomme", 200, "Fractionnement en 3 fois : 1/3 avant plantation – 1/3 1 mois après plantation – 1/3 2 mois après plantation."),
    V("Chou-fleur", 340),
    V("Concombre", 300, "50 U avant plantation. Le reste en fractionnement en cours de culture."),
    V("Cornichon", 100, "30 à 40 U à la plantation. Le reste en cours de culture"),
    V("Courgette (sous abri)", 300, "40 à 50 U avant plantation. Fractionnement en cours de culture."),
    V("Échalote", 110, "20 à 30 U à l’installation. Le reste en couverture en 2 fois."),
    V("Épinard", 185, "50 % semis ou plantation. 50 % au stade 2 à 3 feuilles."),
    V("Fraise précoce et saison", 180, "Fractionnement"),
    V("Fraise remontante", 250, "Fractionnement"),
    V("Fenouil", 130, "30 U avant plantation. Le reste en 2 fois entre la reprise et à mi-développement."),
    V("Laitue Batavia", 120, "40 à 50 U avant plantation. Complément au stade 10-12 feuilles."),
    V("Mâche", 70, "30 à 50 U au semis ou plantation. 20 U 3 semaines à 1 mois avant récolte"),
    V("Melon", 140, "Fractionnement"),
    V("Navet potager", 120, "20 à 40 U au semis si nécessaire. Le reste en couverture au cours du grossissement."),
    V("Oignon", 150, "30 à 50 U avant semis ou plantation. Le reste en fractionnement en cours de culture mais pas plus de 50 U par apport minéral"),
    V("Persil", 170, "30 à 50 U avant semis, en cours de culture si besoin et 30 à 50 U après chaque coupe"),
    V("Poireau", 300, "50 à 75 U avant plantation. Le reste en fractionnement en cours de culture"),
    V("Poivron et piments", 250, POIVRON),
    V("Poivron et piments sous abri", 300, POIVRON),
    V("Pommes de terre industrie", 280, PDT),
    V("Pommes de terre primeur", 200, PDT),
    V("Radis", 70, "En 2 fois : au semis et avant le grossissement des racines."),
    V("Tomates", 170, TOMATE),
    V("Tomates sous serres", 420, TOMATE),
  ],
};

export interface AsparagusReferenceRow {
  cycleLabel: string;
  stage: string;
  /** « Quantité d'N / Ha » telle qu'imprimée (fourchettes). */
  nPerHa: string;
  nMin: number;
  nMax: number;
  rationale: string;
  applicationPeriod: string;
}

/** Tableau de référence asperge Gironde et Landes (image, annexe 4.1 p. 3). */
export const naAsparagusReference3340: Table<AsparagusReferenceRow> = {
  id: "na-2025/asparagus-reference-33-40",
  source: src(
    "4_1_legumes_gren_na_vdef.pdf",
    "Arrêté référentiel GREN Nouvelle-Aquitaine – Annexe 4.1 : références pour la fertilisation de l’asperge dans les départements de la Gironde et des Landes",
    "Annexe 4.1, tableau « Références pour la fertilisation de l’asperge dans les départements de la Gironde et des Landes » (image), p. 3",
  ),
  notes: [
    "Source : COPADAX - INVENIO. Tableau de référence ; les plafonds réglementaires 33/40 sont ceux de naVegetableCeilings (1re pousse 200, production 350).",
    "Première année : « 175 à 200 u/ha » = 50 (avant plantation, accompagné d'une croix « + ») + 125 à 150 (après plantation).",
  ],
  rows: [
    {
      cycleLabel: "Première Année 175 à 200 u/ha",
      stage: "1° année avant plantation AVANT PREMIERE RECOLTE",
      nPerHa: "50",
      nMin: 50,
      nMax: 50,
      rationale:
        "Soit 5 à 30 % fraction minéralisable (suivant analyse et type de produit: exemple pour 100 tonnes/ha de compost de déchets verts apportés). Le compost ou les amendements organiques \"en bouchons\" sont utilisés plus pour leur rôle structurant dans les sols sableux",
      applicationPeriod: "janvier à mi avril",
    },
    {
      cycleLabel: "Première Année 175 à 200 u/ha",
      stage: "1° année, après plantation AVANT PREMIERE RECOLTE",
      nPerHa: "125 à 150",
      nMin: 125,
      nMax: 150,
      rationale:
        "Fonction des rendements attendus soit 4 à 5 tonnes/ha avec une base de besoin de 25 u par tonne récoltée + 25 u /tonne pour mettre en place le système racinaire. LA PREMIERE ANNEE est une période cruciale pour l’aspergeraie car la réussite de son implantation conditionne sa pérennité",
      applicationPeriod: "En fractionnement de mai à mi août",
    },
    {
      cycleLabel: "Seconde Année 250 à 350 u/Ha",
      stage: "2° année APRES PREMIERE RECOLTE",
      nPerHa: "250 à 350",
      nMin: 250,
      nMax: 350,
      rationale:
        "Fonction des rendements attendus soit 7 à 9 tonnes/ha avec une base de besoin de 25 u par tonne récoltée + 12,5 u /tonne pour finaliser la mise en place du système racinaire",
      applicationPeriod: "En fractionnement d'avril à mi août",
    },
    {
      cycleLabel: "Troisième Année et Suivantes 250 à 350 u/Ha",
      stage: "> 3° année APRES SECONDE RECOLTE+SUIVANTES",
      nPerHa: "250 à 350",
      nMin: 250,
      nMax: 350,
      rationale: "Fonction des rendements attendus soit 10 à 14 tonnes/ha avec une base de besoin de 25 u par tonne récoltée",
      applicationPeriod: "En fractionnement de mai à mi août",
    },
  ],
};

const LEG = (cropLabel: string, doseKgNHa: number, condition?: string, extra: Partial<CeilingRow> = {}): CeilingRow => ({
  cropLabel,
  crops: ["legumes"],
  doseKgNHa,
  unit: "efficient",
  period: "year",
  sourceOrg: "GREN",
  annex: "4.2",
  ...(condition ? { condition } : {}),
  ...extra,
});

export const naLegumeCeilings: Table<CeilingRow> = {
  id: "na-2025/ceilings-legumes",
  source: src(
    "4_2_legumineuses_plafond_gren_na_vdef.pdf",
    "Arrêté référentiel GREN Nouvelle-Aquitaine – Annexe 4.2 : fertilisation des légumineuses, dose plafond",
    "Annexe 4.2, tableau 2 (légumes) et §2-3 (luzerne, pois chiche), pp. 1-2",
  ),
  notes: [
    "En règle générale, TOUT apport d'azote est INTERDIT sur les légumineuses ; seules exceptions ci-dessous (naLegumeNitrogenAuthorisations).",
    "Pois protéagineux et autres légumineuses : apport interdit (pas de ligne de plafond).",
    "Soja : uniquement en cas d'échec de nodulation, dose pivot (naSoyNodulationPivot), pas une dose plafond.",
  ],
  rows: [
    LEG("Haricot vert", 100),
    LEG("Haricot sec et demi-sec", 100),
    LEG(
      "Pois potager",
      50,
      "Certaines situations particulières peuvent justifier une fertilisation azotée : conditions de levée difficiles (semis précoces, terres froides) ; variétés courtes (favoriser l'élongation des entre-nœuds pour la récolte machine) ; parasitisme conduisant à une absence de nodulation (maladies telluriques, larves de silitones).",
    ),
    LEG(
      "Luzerne",
      30,
      "Sols avec un taux faible en matières organiques : MO < 15 g/kg sur sol avec texture grossière (sable) ; MO < 18-20 g/kg sur sol avec texture moyenne (limon) ; MO < 22 g/kg sur sol avec texture fine (argile) ; MO < 25 g/kg sur sol argilo-calcaire ; ou sols avec une matière organique se minéralisant lentement (C/N du sol > 12). L'apport peut être effectué pour faciliter le départ en végétation.",
    ),
    LEG(
      "Pois chiche (échec de nodulation)",
      100,
      "Uniquement en cas d’échec de la nodulation sur sols alcalins (pH > 7) : juste avant le début de la floraison (début mai pour un semis début mars), si la végétation présente globalement un aspect jaunâtre et si plus de 30 % des pieds ne portent pas de nodosités (20 pieds observés). Entre 50 et 100 kgN/ha en un ou deux apports selon le potentiel de rendement, entre BBCH60 et BBCH65. Résultats du test consignés dans le cahier d’enregistrement ; objectif de rendement initial revu à la baisse.",
      { doseMinKgNHa: 50 },
    ),
  ],
};

export interface LegumeAuthorisationRow {
  crop: string;
  /** « Apport d'azote » tel qu'imprimé. */
  nitrogen: string;
  allowed: "conditional" | "conditional_national_programme" | "forbidden";
}

export const naLegumeNitrogenAuthorisations: Table<LegumeAuthorisationRow> = {
  id: "na-2025/legume-nitrogen-authorisations",
  source: src(
    "4_2_legumineuses_plafond_gren_na_vdef.pdf",
    "Arrêté référentiel GREN Nouvelle-Aquitaine – Annexe 4.2 : fertilisation des légumineuses, dose plafond",
    "Annexe 4.2, tableau 1 : récapitulatif des autorisations et interdictions d’apport d’azote sur les légumineuses, p. 1",
  ),
  notes: ["« potageers » : coquille imprimée."],
  rows: [
    { crop: "Légumes (haricots et pois potageers)", nitrogen: "Autorisé uniquement dans les cas et les conditions décrits ci-après", allowed: "conditional" },
    { crop: "Luzerne", nitrogen: "Autorisé uniquement dans les cas et les conditions décrits ci-après", allowed: "conditional" },
    { crop: "Pois chiche", nitrogen: "Autorisé uniquement dans les cas et les conditions décrits ci-après", allowed: "conditional" },
    { crop: "Soja", nitrogen: "Autorisé uniquement dans les cas et les conditions décrits ci-après", allowed: "conditional" },
    {
      crop: "Légumineuses pures en tant que couvert végétal d’interculture",
      nitrogen: "Autorisé uniquement dans les cas et les conditions décrits dans le programme d’actions national",
      allowed: "conditional_national_programme",
    },
    { crop: "Pois protéagineux", nitrogen: "Interdit", allowed: "forbidden" },
    { crop: "Autres légumineuses", nitrogen: "Interdit", allowed: "forbidden" },
  ],
};

export interface SoyNodulationPivotRow {
  yieldQHa: number;
  mineralNKgNHa: number;
}

export const naSoyNodulationPivot: Table<SoyNodulationPivotRow> = {
  id: "na-2025/soy-nodulation-pivot",
  source: src(
    "4_2_legumineuses_plafond_gren_na_vdef.pdf",
    "Arrêté référentiel GREN Nouvelle-Aquitaine – Annexe 4.2 : fertilisation des légumineuses, dose plafond",
    "Annexe 4.2, tableau 3 : dose pivot en cas d’accident de nodulation du soja, p. 3",
  ),
  notes: [
    "Uniquement en cas d’échec de la nodulation : juste avant la floraison (stade R1, mi-juin pour un semis mi-avril), si la végétation présente un aspect jaunâtre et si plus de 30 % des pieds (sur 20) ne portent pas de nodosités. Apport minéral entre R1 et R3, en un ou de préférence deux apports. Recommandations Terres Inovia.",
    "L'annexe ne précise pas l'interpolation entre les objectifs de rendement tabulés (25 à 45 q/ha).",
    "Soja irrigué : apport de préférence juste avant une irrigation.",
  ],
  rows: [
    { yieldQHa: 25, mineralNKgNHa: 80 },
    { yieldQHa: 30, mineralNKgNHa: 100 },
    { yieldQHa: 35, mineralNKgNHa: 120 },
    { yieldQHa: 40, mineralNKgNHa: 140 },
    { yieldQHa: 45, mineralNKgNHa: 150 },
  ],
};

const O = (
  cropLabel: string,
  crops: CropGroup[],
  doseKgNHa: number,
  sourceOrg: string,
  extra: Partial<CeilingRow> = {},
): CeilingRow => ({ cropLabel, crops, doseKgNHa, unit: "efficient", period: "year", sourceOrg, annex: "4.4", ...extra });

const PPAM = "ITEIPMAI 2012";
const FNMAS = "FNMAS 2012";

export const naOtherCeilings: Table<CeilingRow> = {
  id: "na-2025/ceilings-other",
  source: src(
    "4_4_autres_plafonds_gren_na_vdef.pdf",
    "Arrêté référentiel GREN Nouvelle-Aquitaine – Annexe 4.4 : autres cultures, dose plafond",
    "Annexe 4.4, §1 à §6, pp. 1-2",
  ),
  notes: [
    "Vigne : deux plafonds simultanés — 80 kgN/ha/an d'azote minéral (y compris la part minérale des engrais organo-minéraux) ET 240 kgN/ha d'azote total efficace (minéral + organique) sur trois ans (« il est possible de raisonner sur trois ans »).",
    "PPAM : plafonds imprimés en kgN/ha/an.",
    "Porte-graines : seulement celles pour lesquelles la méthode du bilan n'est pas opérationnelle (les autres : annexe 2.6).",
    "Persil figure en PPAM (320 kgN/ha/an) et en légume (annexe 4.1 : 170 kgN/ha) ; concombre, cornichon, melon figurent en porte-graines (120) et en légumes (4.1).",
  ],
  rows: [
    O("Pommiers", ["orchard"], 100, "GREN Aquitaine, Limousin et Poitou-Charentes"),
    O("Arboriculture (hors noyers, kiwis et pommiers)", ["orchard"], 120, "GREN Aquitaine, Limousin et Poitou-Charentes"),
    O("Petits fruits : cassis, framboises, myrtilles, groseilles…", ["orchard"], 120, "GREN Aquitaine, Limousin et Poitou-Charentes"),
    O("Vigne – dose plafond annuelle d’azote apporté sous forme minérale", ["vine"], 80, "GREN Poitou-Charentes", {
      mineralOnly: true,
      condition: "Y compris la part minérale des engrais organo-minéraux.",
    }),
    O("Vigne – dose plafond sur trois ans d’azote total efficace (minéral + organique)", ["vine"], 240, "GREN Poitou-Charentes", {
      period: "3_years",
      condition: "Certaines vignes ne reçoivent pas d’azote tous les ans ; raisonnement possible sur trois ans avec le plafond minéral annuel de 80 kgN/ha.",
    }),
    O("Pavot - œillette", ["ppam"], 100, PPAM),
    O("Sauge sarclée", ["ppam"], 60, PPAM),
    O("Basilic", ["ppam"], 180, PPAM),
    O("Camomille romaine", ["ppam"], 60, PPAM),
    O("Chardon Marie", ["ppam"], 60, PPAM),
    O("Coriandre", ["ppam"], 140, PPAM),
    O("Estragon", ["ppam"], 150, PPAM),
    O("Ginkgo", ["ppam"], 180, PPAM),
    O("Menthe poivrée", ["ppam"], 260, PPAM),
    O("Persil", ["ppam"], 320, PPAM),
    O("Thym", ["ppam"], 160, PPAM),
    O("Aneth", ["ppam"], 120, PPAM),
    O("Cerfeuil", ["ppam"], 200, PPAM),
    O("Ciboulette", ["ppam"], 300, PPAM),
    O("Fenugrec", ["ppam"], 40, PPAM),
    O("Mélisse officinale", ["ppam"], 200, PPAM),
    O("Origan sp", ["ppam"], 140, PPAM),
    O("Psyllium", ["ppam"], 60, PPAM),
    O("Romarin", ["ppam"], 100, PPAM),
    O("Pâturin des prés (porte-graines)", ["seed_crops"], 80, FNMAS),
    O("Ciboule (porte-graines)", ["seed_crops"], 90, FNMAS),
    O("Choux potager – choux fourrager (porte-graines)", ["seed_crops"], 125, FNMAS),
    O("Courge – courgette (porte-graines)", ["seed_crops"], 120, FNMAS),
    O("Concombre (porte-graines)", ["seed_crops"], 120, FNMAS),
    O("Cornichon (porte-graines)", ["seed_crops"], 120, FNMAS),
    O("Melon (porte-graines)", ["seed_crops"], 120, FNMAS),
    O("Citrouille – pâtisson (porte-graines)", ["seed_crops"], 120, FNMAS),
    O("Chanvre", ["hemp"], 120, "GREN"),
    O("Sarrasin", ["other"], 50, "GREN Bretagne 2023"),
    O("Autres cultures (non mentionnées dans les annexes 2, 3 et 4)", ["other"], 210, "GREN", {
      condition: "Plafond par défaut pour les cultures non mentionnées dans les annexes 2, 3 et 4 de l’arrêté référentiel.",
    }),
  ],
};

/* ---------------------------------------------------------------------------
 * Annexe 4.3 : couverts d'interculture
 * ------------------------------------------------------------------------ */

const CI_FILE = "4_3_ci_pafond_gren_na_vdef.pdf";
const CI_TITLE = "Arrêté référentiel GREN Nouvelle-Aquitaine – Annexe 4.3 : fertilisation des couverts d’interculture";

/** Règles citées de l'annexe 4.3 (non tabulaires). */
export const naCoverCropRules = {
  ceilingKinds: [
    "Plafonds fixés dans le programme d’actions régional nitrates en vigueur (article 2, partie I.4 hors zones d’actions renforcées ; article 3, partie II.1 en ZAR) : tous types de fertilisants azotés.",
    "Plafonds d'azote potentiellement libéré jusqu'en sortie d'hiver (APLSH) fixés à l’annexe I.I de l'arrêté du 19 décembre 2011 modifié.",
  ],
  aplsh:
    "APLSH = azote présent dans un fertilisant azoté sous forme minérale + azote présent sous forme organique minéralisable jusqu'à la sortie de l'hiver ; la sortie d’hiver est fixée au 15 janvier.",
  splitApplications:
    "Si l’apport est réparti en plusieurs fois, la quantité totale de produit brut appliquée sur toute la période du 01/07 au 15/11 ne doit pas dépasser celle indiquée dans la colonne de la période d’apport du 01/10 au 15/11.",
  noCumul:
    "La quantité maximale de produit brut indiquée concerne chaque produit s’il est utilisé seul. Si plusieurs produits sont utilisés, les quantités maximales applicables ne se cumulent pas. En cas de mélange, il faut se référer au tableau des produits non référencés.",
  adjustment: "Qpro ajustée = Qpro tableau 1 x Npro analysé / Npro tableau (Qpro en t/ha ou m3/ha ; Npro en kgN/t ou kgN/m3 de produit brut)",
  unlistedCalculation: "Quantité maximale de produit brut = dose maximum Ntot (de la classe C/N × Nmin/Ntot) / teneur en azote total du PRO",
  lowLoadedEffluents:
    "Les effluents peu chargés sont les effluents issus d’un traitement d’effluents bruts et ayant une quantité d’azote inférieure à 0,5 kg/m3 ; en l’absence de connaissance des critères C/N, Nmin/Ntot et ISMO, ils doivent être considérés comme fertilisants azotés de type II.",
  typeIILowLoadedBanPeriod:
    "X + Y ≤ 70 kg APLSH / ha, avec X = apport entre la récolte du précédent et la période d’interdiction et Y = apport maximum de 20 kg APLSH / ha pendant la période d’autorisation du cas particulier (effluents de type II peu chargés issus d’élevage, couverts d’interculture longue ; plans d’épandage soumis à autorisation et étude d’impact non concernés).",
  typeIILowLoadedMaxAplshKgHa: 70,
  typeIILowLoadedBanPeriodMaxAplshKgHa: 20,
  exportedCoverTypeIII: [
    "L’apport minéral de type III est autorisé sur les couverts d’interculture exportés dans les cas où il est possible de calculer la dose prévisionnelle d’azote pour la culture ou le mélange implanté en couvert.",
    "Si la dose calculée est inférieure au plafond fixé dans le programme d’actions régional nitrates en vigueur, c’est cette dose calculée qui s’applique ; si elle est supérieure, c’est ce plafond qui s’applique. Ces valeurs plafonds s’entendent en cumulant les apports organiques et minéraux.",
  ],
  recording: [
    "Les îlots culturaux concernés par un couvert végétal d’interculture exporté font l'objet de deux plans de fumure séparés : l'un pour le couvert végétal d’interculture exporté et l'autre pour la culture principale.",
    "Tous les apports de fertilisant en interculture doivent être enregistrés dans le cahier d’enregistrement des pratiques de la culture suivante.",
  ],
} as const;

export interface CoverCropListedProRow {
  /** 1 : apport hors période d'interdiction ; 3 : apport pendant la période d'interdiction (cas e). */
  table: 1 | 3;
  group: string;
  product: string;
  /** Teneur en azote total (kgN/t ou kgN/m3 de produit brut). */
  nTotal: number;
  /** Tableau 1 : quantité max de produit brut si apport entre le 01/07 et le 30/09. */
  maxJul1Sep30?: number | null;
  /** Tableau 1 : quantité max de produit brut si apport entre le 01/10 et le 15/11. */
  maxOct1Nov15?: number | null;
  /** Tableau 3 : quantité max de produit brut pour un apport dans la période d'interdiction. */
  maxBanPeriod?: number | null;
  /** Vrai quand l'annexe renvoie au calcul de la dose prévisionnelle (minéralisation particulièrement faible). */
  useForecastDose?: boolean;
}

const LOW_MIN_1 =
  "La minéralisation étant particulièrement faible pour ce produit, la quantité maximale de produit brut qui peut être épandue est celle issue du calcul de la dose prévisionnelle dans la limite des plafonds du PAR";

export const naCoverCropListedPro: Table<CoverCropListedProRow> = {
  id: "na-2025/cover-crop-listed-pro",
  source: src(CI_FILE, CI_TITLE, "Annexe 4.3, tableau 1 (p. 4, image) et tableau 3 (p. 7, image) : quantité maximale de produit brut épandable par PRO"),
  notes: [
    "Quantités maximales de produit brut en t/ha ou m3/ha, arrondies à l’unité la plus proche. Sources : rapport final 2024 COMIFER « évaluation de l’azote potentiellement libéré jusqu’en sortie d’hiver par les fertilisants organiques » et GREN.",
    `useForecastDose : ${LOW_MIN_1} (tableau 3 : « … dose prévisionnelle », sans « dans la limite des plafonds du PAR »).`,
    "Tableau 3 : cas particulier (e) des plans d’épandage soumis à autorisation et à étude d’impact ou d’incidence, couverts d’interculture longue, produits de type 0 et I.a.",
    "Les teneurs de référence proviennent du guide COMIFER 2013 ; ajustement possible avec Npro analysé (naCoverCropRules.adjustment).",
  ],
  rows: [
    { table: 1, group: "Boues de stations d'épuration de papeterie", product: "Boues mixtes papetières 20<C/N<35", nTotal: 2.8, maxJul1Sep30: null, maxOct1Nov15: null, useForecastDose: true },
    { table: 1, group: "Boues de stations d'épuration de papeterie", product: "Boues mixtes papetières", nTotal: 1.6, maxJul1Sep30: null, maxOct1Nov15: null, useForecastDose: true },
    { table: 1, group: "Boues de stations d'épuration de papeterie", product: "Boues de désencrage 40<C/N<70", nTotal: 1.6, maxJul1Sep30: null, maxOct1Nov15: null, useForecastDose: true },
    { table: 1, group: "Compost de fumier de porcs de LP + paille (Guernevez)", product: "Compost de fumier de porcs jeune (moins de 6 mois)", nTotal: 6.7, maxJul1Sep30: 30, maxOct1Nov15: 35 },
    { table: 1, group: "Compost de fumier de porcs de LP + paille (Guernevez)", product: "Compost de fumier de porcs âgé (de 6 à 10 mois)", nTotal: 6.7, maxJul1Sep30: 30, maxOct1Nov15: 35 },
    { table: 1, group: "Fumier de porcs", product: "Fumier de porcs", nTotal: 8, maxJul1Sep30: 18, maxOct1Nov15: 22 },
    { table: 1, group: "Fumier de bovins", product: "Fumier de bovin pailleux de litière accumulée", nTotal: 5.8, maxJul1Sep30: 24, maxOct1Nov15: 27 },
    { table: 1, group: "Fumier de bovins", product: "Fumier de bovin décomposé d'étable animaux entravés", nTotal: 5.3, maxJul1Sep30: 29, maxOct1Nov15: 44 },
    { table: 1, group: "Fientes de volaille avec litière", product: "Fientes de volaille avec litière", nTotal: 25, maxJul1Sep30: 6, maxOct1Nov15: 8 },
    { table: 1, group: "Compost de fumiers de bovins", product: "Composts de fumiers de bovins jeune de moins de 6 mois", nTotal: 6.3, maxJul1Sep30: null, maxOct1Nov15: null, useForecastDose: true },
    { table: 1, group: "Compost de fumiers de bovins", product: "Composts de fumiers de bovins vieux de plus de 6 mois", nTotal: 6.5, maxJul1Sep30: null, maxOct1Nov15: null, useForecastDose: true },
    { table: 1, group: "Fientes de volaille", product: "Fientes de volaille séchées (80%MS)", nTotal: 40, maxJul1Sep30: 4, maxOct1Nov15: 4 },
    { table: 1, group: "Fientes de volaille", product: "Fientes de volailles 60 % MS", nTotal: 24, maxJul1Sep30: 6, maxOct1Nov15: 6 },
    { table: 1, group: "Lisier de porc mixte", product: "Lisier de porc mixte", nTotal: 3.5, maxJul1Sep30: 25, maxOct1Nov15: 27 },
    { table: 1, group: "Lisier de bovins", product: "Lisier de bovins non dilué", nTotal: 4.5, maxJul1Sep30: 24, maxOct1Nov15: 26 },
    { table: 3, group: "Compost de déchets verts", product: "Compost de déchets verts de moins de 6 mois", nTotal: 10, maxBanPeriod: null, useForecastDose: true },
    { table: 3, group: "Digestats de méthanisation agricole", product: "Fraction sèche après séparation de phase", nTotal: 2, maxBanPeriod: null, useForecastDose: true },
    { table: 3, group: "Boues de stations d'épuration de papeterie", product: "Boues mixtes papetières 20<C/N<35", nTotal: 2.8, maxBanPeriod: null, useForecastDose: true },
    { table: 3, group: "Boues de stations d'épuration de papeterie", product: "Boues mixtes papetières", nTotal: 1.6, maxBanPeriod: null, useForecastDose: true },
    { table: 3, group: "Boues de stations d'épuration de papeterie", product: "Boues de désencrage 40<C/N<70", nTotal: 1.6, maxBanPeriod: null, useForecastDose: true },
    { table: 3, group: "Compost de fumier de porcs de LP + paille (Guernevez)", product: "Compost de fumier de porcs jeune (moins de 6 mois)", nTotal: 6.7, maxBanPeriod: 50 },
    { table: 3, group: "Compost de fumier de porcs de LP + paille (Guernevez)", product: "Compost de fumier de porcs âgé (de 6 à 10 mois)", nTotal: 6.7, maxBanPeriod: 50 },
    { table: 3, group: "Fumier de bovins", product: "Fumier de bovin décomposé d'étable animaux entravés", nTotal: 5.3, maxBanPeriod: 63 },
    { table: 3, group: "Compost de fumiers de bovins", product: "Composts de fumiers de bovins jeune de moins de 6 mois", nTotal: 6.3, maxBanPeriod: null, useForecastDose: true },
    { table: 3, group: "Compost de fumiers de bovins", product: "Composts de fumiers de bovins vieux de plus de 6 mois", nTotal: 6.5, maxBanPeriod: null, useForecastDose: true },
  ],
};

export interface CoverCropUnlistedProRow {
  /**
   * 2 : PRO non référencés, apport hors période d'interdiction ;
   * 4 : cas (e) plans soumis à autorisation, période d'interdiction ;
   * 5 : cas (f) plans soumis à déclaration ou enregistrement, période d'interdiction ;
   * 6 : cas (g) effluents de type II peu chargés issus d'élevage, période d'interdiction.
   */
  table: 2 | 4 | 5 | 6;
  /** Classe C/N telle qu'imprimée. */
  cnClass: string;
  /** Classe Nmin/Ntot (%) telle qu'imprimée. */
  nminNtotClass: string;
  /** Tableau 2 : dose maximale Ntot (kgN/ha) si apport entre le 01/07 et le 30/09. */
  maxNtotJul1Sep30?: number | null;
  /** Tableau 2 : dose maximale Ntot (kgN/ha) si apport entre le 01/10 et le 15/11. */
  maxNtotOct1Nov15?: number | null;
  /** Tableaux 4, 5, 6 : dose maximale Ntot (kgN/ha) pour un apport dans la période d'interdiction. */
  maxNtotBanPeriod?: number | null;
  useForecastDose?: boolean;
}

const UNL = (
  table: 2 | 4 | 5 | 6,
  values: (number | [number, number])[],
): CoverCropUnlistedProRow[] => {
  const classes: [string, string][] = [
    ["<=8", "<=20"],
    ["<=8", ">40"],
    [">8 ; <=10", "<=20"],
    [">8 ; <=10", ">40"],
    [">10 ; <=20", ">20 ; <=40"],
    [">10 ; <=20", ">40"],
  ];
  const rows: CoverCropUnlistedProRow[] = classes.map(([cnClass, nminNtotClass], i) => {
    const v = values[i]!;
    return Array.isArray(v)
      ? { table, cnClass, nminNtotClass, maxNtotJul1Sep30: v[0], maxNtotOct1Nov15: v[1] }
      : { table, cnClass, nminNtotClass, maxNtotBanPeriod: v };
  });
  const low = (cnClass: string): CoverCropUnlistedProRow =>
    table === 2
      ? { table, cnClass, nminNtotClass: "<=20", maxNtotJul1Sep30: null, maxNtotOct1Nov15: null, useForecastDose: true }
      : { table, cnClass, nminNtotClass: "<=20", maxNtotBanPeriod: null, useForecastDose: true };
  return [...rows, low(">10 ; <=20"), low(">20")];
};

export const naCoverCropUnlistedPro: Table<CoverCropUnlistedProRow> = {
  id: "na-2025/cover-crop-unlisted-pro",
  source: src(CI_FILE, CI_TITLE, "Annexe 4.3, tableaux 2 (p. 5), 4 (p. 8), 5 (p. 9) et 6 (p. 11), images : dose maximale Ntot par classe C/N et Nmin/Ntot"),
  notes: [
    "Doses maximales Ntot en kgN/ha, arrondies à l’unité la plus proche ; quantité maximale de produit brut = dose maximum Ntot / teneur en azote total du PRO.",
    "Les classes sont recopiées telles qu'imprimées ; elles ne couvrent pas toutes les combinaisons : C/N <=8 ou >8;<=10 avec Nmin/Ntot >20;<=40, et C/N >20 avec Nmin/Ntot >20, n'ont pas de ligne. Le moteur doit refuser ces cas plutôt que d'interpoler.",
    "Tableau 2 : sur un apport réparti, le total 01/07–15/11 ne doit pas dépasser la colonne 01/10–15/11.",
    "Tableau 6 : cas des effluents de type II peu chargés (Y ≤ 20 kg APLSH/ha pendant la période d'autorisation, X + Y ≤ 70 kg APLSH/ha).",
  ],
  rows: [
    ...UNL(2, [[140, 140], [93, 100], [140, 175], [108, 117], [156, 200], [108, 117]]),
    ...UNL(4, [222, 143, 286, 167, 286, 167]),
    ...UNL(5, [156, 100, 200, 117, 200, 117]),
    ...UNL(6, [44, 29, 57, 33, 57, 33]),
  ],
};

export interface ExportedCoverCropRow {
  cover: string;
  cropPeriod: string;
  fertiliserTypes: string;
  doseMethod: string;
}

export const naExportedCoverCrops: Table<ExportedCoverCropRow> = {
  id: "na-2025/exported-cover-crops",
  source: src(CI_FILE, CI_TITLE, "Annexe 4.3 §2, tableau des couverts d’interculture exportés, p. 12"),
  notes: ["Un calcul précis doit être réalisé en se référant aux annexes 2 (méthode bilan) et 3 (méthode pivot) et en prenant en compte un objectif de rendement adapté aux couverts d’interculture."],
  rows: [
    {
      cover: "CIE de type fourrager (ray-grass d'Italie, méteil...) ; CIVE d'hiver",
      cropPeriod: "Semis en fin d’été ou début d’automne et récoltes au début du printemps",
      fertiliserTypes: "Type III possible ; Types I et II possibles : calcul selon annexe 5",
      doseMethod:
        "Bilan de type prairie ou bilan de type céréales à paille avec : lorsque les céréales sont récoltées immatures, le besoin retenu est b = 2 kgN/q (soit 2/3 des besoins en mature) ; dans le cas d'un mélange graminées / légumineuses, le besoin retenu est celui des espèces non fixatrices d'azote calculé au prorata du semis (en nombre de graines), exemple : seigle 90 % + vesce 10 %, b = 2 x 0.9 = 1,8 kgN/q ; le pourcentage peut être adapté avec une mesure en sortie d’hiver.",
    },
    {
      cover: "CIVE d'été / sorgho-maïs fourrage en récolte « plante entière »",
      cropPeriod: "Semis en été et récoltes en début d’automne",
      fertiliserTypes: "Type III possible ; Types I et II possibles avant semis : calcul selon annexe 5",
      doseMethod: "Bilan de type prairie ou maïs-sorgho",
    },
  ],
};
