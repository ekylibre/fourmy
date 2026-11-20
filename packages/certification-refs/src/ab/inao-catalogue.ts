import type { RefSource } from "../source.js";

/**
 * Catalogue national des mesures (sanctions) de l'INAO pour la production
 * végétale biologique, manquements utilisés par les contrôles AB de Fourmy
 * (FR-AB-10). Classe et mesures au 1er constat puis en récurrence.
 *
 * Classe (AB-4 p. 102) : mineur = pas d'atteinte à l'intégrité du produit ;
 * majeur = atteinte à l'intégrité, déclassement au moins ; critique =
 * manquement grave, répété ou intentionnel. Le feu d'une règle en découle :
 * rouge si majeur ou critique, orange si mineur.
 */
export const INAO_CATALOGUE_SOURCE: RefSource = {
  text: "INAO-DEC-CONT-AB-4 (catalogue national des mesures)",
  version: "v10 du 17/09/2026",
  at: "p. 100 à 123",
};

export type BreachClass = "minor" | "major" | "critical";

/** Mesures : avertissement, déclassement du lot, de la parcelle, suspensions, retrait. */
export type BreachMeasure = "none" | "AV" | "DL" | "DPA" | "SPC" | "SC" | "RC";

export const BREACH_MEASURE_LABELS: Record<BreachMeasure, string> = {
  none: "aucune mesure",
  AV: "avertissement",
  DL: "déclassement du lot",
  DPA: "déclassement de la parcelle (nouvelle conversion)",
  SPC: "suspension partielle de la certification",
  SC: "suspension de la certification",
  RC: "retrait de la certification",
};

export interface InaoBreach {
  /** N° du manquement au catalogue. */
  number: string;
  label: string;
  class: BreachClass;
  /** Mesures au 1er constat, puis en récurrence. */
  first: BreachMeasure[];
  repeat: BreachMeasure[];
  /** Page de AB-4. */
  page: number;
  /** Rattachement à confirmer avec un organisme certificateur. */
  unconfirmed?: true;
}

const b = (number: string, label: string, cls: BreachClass, first: BreachMeasure[], repeat: BreachMeasure[], page: number, unconfirmed?: true): InaoBreach => ({
  number,
  label,
  class: cls,
  first,
  repeat,
  page,
  ...(unconfirmed ? { unconfirmed } : {}),
});

/** Manquements par règle (R1 à R34 : docs/ab/rapport_ab.md §2 et §8.3.3). */
export const INAO_BREACHES: Record<string, InaoBreach> = {
  "27": b("27", "Produits vendus comme biologiques avant la fin de la conversion", "major", ["DL"], ["SC"], 117),
  "28": b("28", "Produits végétaux vendus « en conversion » avant la conversion minimale requise", "major", ["DL"], ["SC"], 118),
  "4": b("4", "Usage de substances ou produits non autorisés (dont engrais azoté minéral)", "major", ["DL", "DPA"], ["SC", "DL", "DPA"], 112),
  "328": b("328", "Produit autorisé, conditions d'utilisation non conformes", "minor", ["AV"], ["SPC", "DL"], 112),
  "31": b("31", "Mixité dans une configuration non autorisée (espèces, variétés)", "major", ["DL"], ["AV", "DL"], 119),
  "36": b("36", "Production hydroponique", "critical", ["SPC"], ["RC"], 120),
  "354": b("354", "Conditions de la culture hors sol (annexe II partie I 1.4) non respectées", "major", ["DL"], ["DL"], 120),
  "362": b("362", "Serres chauffées à l'énergie non renouvelable", "major", ["DL"], ["SC"], 120),
  "39": b("39", "Absence de rotation des cultures ou rotation inadaptée", "minor", ["AV"], ["DL"], 121),
  "40": b("40", "Dépassement de 170 kg N/an/ha de SAU issus des effluents d'élevage", "minor", ["AV"], ["DL"], 121),
  "41": b("41", "Engrais autorisés sans justification étayée", "minor", ["AV"], ["DL"], 121),
  "364": b("364", "Engrais provenant d'élevages industriels", "minor", ["AV"], ["DL", "DPA"], 121),
  "44": b("44", "Produit phytopharmaceutique autorisé sans justification étayée", "minor", ["none"], ["AV"], 122),
  "37": b("37", "Semences ou plants OGM ou traités avec un produit non autorisé ; plants non biologiques", "major", ["DL"], ["SPC"], 120),
  "38": b("38", "Semences non biologiques sans dérogation, ou dérogation obtenue après le semis", "minor", ["AV"], ["DL"], 121),
  "349": b("349", "Semences non biologiques « hors dérogation » (dérogation refusée ou non demandée)", "major", ["DL"], ["DL"], 121),
  "350": b("350", "Absence de mesures de précaution ou de nettoyage", "major", ["SPC"], ["SC"], 115),
  "19": b("19", "Description insuffisante des mesures de précaution ou de nettoyage, mesures insuffisantes en pratique", "minor", ["AV"], ["SPC"], 115),
  "366": b("366", "Nettoyage avec des produits non autorisés", "minor", ["AV"], ["AV"], 114),
  "50": b("50", "Cahier de culture absent ou mal tenu, ne permettant pas de s'assurer de la conformité", "major", ["DL", "DPA"], ["SPC"], 123),
};

/**
 * Règle AB de Fourmy → manquement. Le cuivre (R21) n'a pas de manquement
 * propre dans les documents INAO : rattaché au n° 328 (conditions
 * d'utilisation), à confirmer.
 */
export const RULE_BREACH: Record<string, string> = {
  R1: "27",
  R2: "28",
  R5: "4",
  R7: "31",
  R10: "354",
  R10_hydroponic: "36",
  R11: "39",
  R13: "362",
  R14: "4",
  R15: "4",
  R16: "40",
  R17: "364",
  R20: "44",
  R21: "328",
  R24: "37",
  R25: "38",
  /** Semence non bio sans dérogation demandée. */
  R25_none: "349",
  R27: "350",
  /** Nettoyage non enregistré entre un usage hors AB et un usage AB. */
  R27_unrecorded: "19",
  R28: "366",
};

/** Manquement d'une règle, avec l'indication « à confirmer » pour le cuivre. */
export function breachOf(rule: string): InaoBreach | null {
  const n = RULE_BREACH[rule];
  if (!n) return null;
  const breach = INAO_BREACHES[n]!;
  return rule === "R21" ? { ...breach, unconfirmed: true } : breach;
}
