import { BCAE7_ANNEX2_LEGUMES, BCAE7_PERMANENT_GRASSLAND } from "../pac/bcae7-2026.js";

/**
 * Repères agronomiques de l'assolement (claudedocs/conception_assolement.md
 * §4.3, décision A8) : délais de retour d'une culture sur elle-même et
 * précédents à éviter, d'après le wiki Triple Performance (CC-BY-SA 4.0).
 *
 * Les pages du wiki sont du texte libre : chaque valeur est recopiée d'une
 * phrase citée mot pour mot, avec sa page. Seules les phrases qui donnent un
 * nombre d'années pour une culture sont reprises ; les conseils liés à une
 * maladie déclarée (sclérotinia des oléo-protéagineux, précédents du soja)
 * ne le sont pas. `reviewed` : relu par un agronome (Q3 du plan). La ferme
 * peut changer chaque délai dans ses réglages.
 */

export interface AgronomySource {
  /** Titre de la page du wiki. */
  page: string;
  url: string;
  /** Phrase d'où vient la valeur, mot pour mot. */
  quote: string;
  /** Date de consultation. */
  consultedOn: string;
}

export interface ReturnInterval {
  id: string;
  label: string;
  /** Codes cultures PAC du groupe : une culture du groupe compte comme un retour. */
  capCodes: readonly string[];
  /** Années au moins entre deux cultures du groupe sur une parcelle. */
  minYears: number;
  source: AgronomySource;
  /** Relu par un agronome. */
  reviewed: boolean;
  /** Remarque de lecture (valeur retenue dans une fourchette, sources divergentes). */
  note?: string;
}

export interface DiscouragedSuccession {
  id: string;
  label: string;
  /** Culture concernée. */
  capCodes: readonly string[];
  /** Précédents à éviter (culture principale de l'année précédente). */
  previous: readonly string[];
  reason: string;
  source: AgronomySource;
  reviewed: boolean;
}

const WIKI = "https://wiki.tripleperformance.fr/wiki/";
const CONSULTED = "2026-11-20";
const tp = (page: string, quote: string): AgronomySource => ({ page, url: WIKI + encodeURIComponent(page.replace(/ /g, "_")), quote, consultedOn: CONSULTED });

const DIVERSIFIER = "Cultiver des espèces diversifiées dans la rotation";
const DIVERSIFIER_QUOTE =
  "Le délai de retour \"recommandé\" est variable selon les cultures : entre 2 à 3 ans pour un blé, jusqu'à 4 à 6 ans pour des cultures comme le colza, le pois ou le soja.";

export const RETURN_INTERVALS: readonly ReturnInterval[] = [
  {
    id: "ble",
    label: "Blé",
    capCodes: ["BTH", "BTP", "BDH", "BDP"],
    minYears: 2,
    source: tp(DIVERSIFIER, DIVERSIFIER_QUOTE),
    reviewed: false,
    note: "Bas de la fourchette « 2 à 3 ans ».",
  },
  {
    id: "cruciferes",
    label: "Crucifères (colza, moutarde, cameline)",
    capCodes: ["CZH", "CZP", "MOT", "CML"],
    minYears: 4,
    source: tp(
      "Le radis chinois, une crucifère structurante pour les intercultures",
      "Un délai de rotation d’au moins 4 ans avant le retour d’une culture crucifère est généralement conseillé pour limiter la pression parasitaire.",
    ),
    reviewed: false,
    note: "Concorde avec « 4 à 6 ans » pour le colza (page « Cultiver des espèces diversifiées dans la rotation »).",
  },
  {
    id: "pois",
    label: "Pois protéagineux",
    capCodes: ["PHI", "PPR"],
    minYears: 4,
    source: tp(DIVERSIFIER, DIVERSIFIER_QUOTE),
    reviewed: false,
    note: "Bas de la fourchette « 4 à 6 ans ».",
  },
  {
    id: "soja",
    label: "Soja",
    capCodes: ["SOJ"],
    minYears: 2,
    source: tp("Soja", "Un retour maximum tous les 2 ans du soja"),
    reviewed: false,
    note: "La page « Cultiver des espèces diversifiées dans la rotation » donne 4 à 6 ans : sources divergentes, la page de la culture est retenue.",
  },
  {
    id: "feverole",
    label: "Féverole",
    capCodes: ["FEV", "FVP", "FVL"],
    minYears: 4,
    source: tp("Féverole", "Utiliser des semences saines et respecter les rotations (pas de retour avant 4 ans)."),
    reviewed: false,
    note: "La même page indique que la féverole « revient environ tous les 5 ans ».",
  },
  {
    id: "lentille",
    label: "Lentille",
    capCodes: ["LEC"],
    minYears: 5,
    source: tp(
      "Ascochytose / Anthracnose sur lentille",
      "Diversifier et allonger la rotation, favoriser un délai de retour entre une culture sensible et/ou hôte > 5 ans (pois et fèves : hôtes alternatifs)",
    ),
    reviewed: false,
  },
  {
    id: "luzerne",
    label: "Luzerne",
    capCodes: ["LUZ"],
    minYears: 5,
    source: tp("Luzerne", "Attention : respecter un délai de retour de minimum 5 ans entre deux luzernes."),
    reviewed: false,
  },
  {
    id: "lin",
    label: "Lin",
    capCodes: ["LIH", "LIP", "LIF"],
    minYears: 6,
    source: tp("Lin", "Le respect d'un intervalle de 6 à 7 ans entre 2 lins"),
    reviewed: false,
    note: "Bas de la fourchette « 6 à 7 ans ».",
  },
  {
    id: "betterave",
    label: "Betterave",
    capCodes: ["BTN"],
    minYears: 3,
    source: tp("Nématode à kystes sur betterave", "Allonger la rotation, délai de retour de 3 ans minimum"),
    reviewed: false,
  },
  {
    id: "pomme-de-terre",
    label: "Pomme de terre",
    capCodes: ["PTC"],
    minYears: 6,
    source: tp(
      "La pomme de terre dans un système en Agriculture de Conservation des Sols",
      "un retour de la pomme de terre sur une même parcelle ne se fait pas avant 6 ou 7 ans.",
    ),
    reviewed: false,
    note: "Pratique d'un agriculteur, pas une recommandation générale : à relire en priorité.",
  },
];

export const DISCOURAGED_SUCCESSIONS: readonly DiscouragedSuccession[] = [
  {
    id: "feverole-apres-legumineuse",
    label: "Féverole après prairie permanente ou légumineuse",
    capCodes: ["FEV", "FVP", "FVL"],
    previous: [...BCAE7_PERMANENT_GRASSLAND, ...BCAE7_ANNEX2_LEGUMES],
    reason: "trop d'azote laissé : nodulation moindre, risque de verse",
    source: tp(
      "Féverole",
      "Précédents à éviter : Prairies permanentes, luzernières ou autres légumineuses, ou des apports importants d’engrais de ferme, qui laisseraient trop d’azote.",
    ),
    reviewed: false,
  },
];

const BY_CODE = new Map<string, ReturnInterval>();
for (const r of RETURN_INTERVALS) for (const c of r.capCodes) BY_CODE.set(c, r);

/** Délai de retour d'un code culture, ou undefined. */
export function returnIntervalOf(capCode: string): ReturnInterval | undefined {
  return BY_CODE.get(capCode.toUpperCase());
}
