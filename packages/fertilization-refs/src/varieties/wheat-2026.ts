/**
 * Besoins unitaires d'azote par variété, campagne 2026 (classements COMIFER /
 * Arvalis) : blé tendre d'hiver (coefficients b et bq11,5 %) et blé dur Sud-Ouest
 * (coefficient bq14 %).
 *
 * Blé tendre : colonnes du tableau « Classes de b », « Variétés », « Classes de
 * bq11.5% », « bc11.5% », « Mise en réserve minimale conseillée pour la fin de
 * montaison » (« Modalités de fractionnement à respecter en utilisant bq11.5% »).
 * Dans toutes les lignes, bq = b + bc. La classe b imprimée entre deux groupes
 * de variétés couvre les deux groupes (2,8 : LG NIKLAS et ADVISOR… ; 3 : ACADEMY…
 * et ACCOMPLY…), ce que confirme bq = b + bc.
 *
 * Blé dur Sud-Ouest : colonnes « Variétés », « Classes de bq14% », « Mise en
 * réserve minimale conseillée pour la fin de montaison ».
 *
 * Les mises en forme (variétés nouvelles en gras, modifiées en rouge) sont
 * perdues à l'extraction du texte.
 */
import type { Table } from "../types.js";

export interface SoftWheatVarietyNeed {
  variety: string;
  /** Besoin unitaire b (kg N/q). */
  b: number;
  /** Besoin unitaire bq11,5 % (kg N/q). */
  bq115: number;
  /** Complément qualité bc11,5 % (kg N/q). */
  bc: number;
  /** Mise en réserve minimale conseillée pour la fin de montaison (kg N/ha). */
  endOfStemReserveKgN: number;
  /** true quand le tableau imprime « 40* » : réserve réductible en cas de faible potentiel. */
  reserveReducible: boolean;
}

export interface DurumWheatVarietyNeed {
  variety: string;
  /** Besoin unitaire bq14 % (kg N/q). */
  bq14: number;
  /** Mise en réserve minimale conseillée pour la fin de montaison, texte imprimé. */
  endOfStemReserve: string;
}

const licence = "COMIFER/Arvalis, accord de réutilisation demandé";

export const softWheatVarietyNeeds2026: Table<SoftWheatVarietyNeed> = {
  id: "comifer-bth-2026",
  source: {
    title: "Classement des variétés selon leur besoin en azote 2026 (coefficients b et bq11,5%) : blé tendre",
    organisation: "COMIFER / Arvalis",
    date: "2025-11-27",
    url: "https://comifer.asso.fr/wp-content/uploads/2026/01/besoin_unitaire_BTH_2026_tableau.pdf",
    ref: "Tableau unique, daté du 27 novembre 2025 (fichier publié en janvier 2026)",
    licence,
  },
  notes: [
    "*: la mise en réserve minimale de 40 kg N pourra être réduite en cas de faible potentiel (renvoi du tableau).",
    "Pour un usage en blé biscuitier, il faut tenir compte uniquement des besoins unitaires, sans le complément qualité (texte du tableau).",
    "Valeur par défaut pour une variété non classée : non indiquée par ce tableau (voir `softWheatDefaultB`).",
  ],
  rows: [
    { variety: "LG NIKLAS", b: 2.8, bq115: 2.8, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "ADVISOR", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "AMPLEUR", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "ARCACHON", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "BELZEBUTH", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "CAMPESINO", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "CELEBRITY", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "CHEVIGNON", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "FACILITY", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "GODZILLA", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "HYBIZA", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "HYLIGO", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "HYMALAYA", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "HYSTAR", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "KARABOL", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "KINGKONG", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "KWS AGRUM", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "KWS ETOILE", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "KWS GLOBE", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "LG AERO", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "LG AKATHON", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "LG ASTERION", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "OLAF", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "RGT FARMEO", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "RGT INDEXO", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "RGT MAJESKO", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "RGT PROPULSO", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "SHREK", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "SU HORIZON", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "SU HYLORD", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "SU HYREAL", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "SU HYSTORIC", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "SY ADMIRATION", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "SY ROCINANTE", b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "ACADEMY", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "AGENOR", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "APACHE", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "ARKEOS", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "AUCHY", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "BALZAC", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "CHAMDOR", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "CONQUISTADOR", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "GEOPOLIS", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "GERRY", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "HANSEL", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "INTENSITY", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "JERIKO", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "JUNIOR", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "KAKTUS", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "KAROQUE", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "KWS ERRUPTIUM", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "KWS PARFUM", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "KWS SPHERE", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "LG ABRAZO", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "LG ABSALON", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "LG ACADIE", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "LG ACROBAT", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "LG ARLETY", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "LG AUDACE", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "OBIWAN", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "OREGRAIN", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "OUTDOOR", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "PAILLEDOR", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "PIBRAC", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "PRESTANCE", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "PROVIDENCE", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "RGT LUXEO", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "RGT NOBELLO", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "RGT PROFUSIO", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "RGT VALPARAISO", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "STROMBOLI", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "SU ECUSSON", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "SU ELECTRON", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "SU HYANKEE", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "SU HYBISCUS", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "SU HYCARDI", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "SU HYTONI", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "SU MASTER", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "SU MOUSQUETON", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "SU SAUVIGNON", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "SY PASSION", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "TALENDOR", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "THERMIDOR", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "WINNER", b: 3, bq115: 3, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "ACCOMPLY", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "COMPLICE", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "GARFIELD", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "GENERIK", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "GRAVELINE", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "HYACINTH", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "KWS ASTRUM", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "KWS EXTASE", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "KWS MILLESIME", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "KWS PERCEPTIUM", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "KWS REGATE", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "KWS ULTIM", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "LID PAVANE", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "MACARON", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "PONDOR", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "RGT KOESIO", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "RGT LOOKEO", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "RGT PALMEO", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "RGT SACRAMENTO", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "RGT SUNDEO", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "RGT TWEETEO", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "SPIROU", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "SU HYCLASS", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "SU PULSION", b: 3, bq115: 3.2, bc: 0.2, endOfStemReserveKgN: 60, reserveReducible: false },
    { variety: "FABULOR", b: 3.2, bq115: 3.2, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "GREKAU", b: 3.2, bq115: 3.2, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "LG ABILENE", b: 3.2, bq115: 3.2, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "LG AIKIDO", b: 3.2, bq115: 3.2, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "LID MACUMBA", b: 3.2, bq115: 3.2, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "RGT BORSALINO", b: 3.2, bq115: 3.2, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "RGT LETSGO", b: 3.2, bq115: 3.2, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "RGT MONTECARLO", b: 3.2, bq115: 3.2, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "RGT PACTEO", b: 3.2, bq115: 3.2, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "SU ADDICTION", b: 3.2, bq115: 3.2, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "SY TRANSITION", b: 3.2, bq115: 3.2, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
    { variety: "UNIK", b: 3.2, bq115: 3.2, bc: 0, endOfStemReserveKgN: 40, reserveReducible: true },
  ],
};

/** Besoin unitaire par défaut d'un blé tendre non classé : absent du tableau 2026 (null). */
export const softWheatDefaultB: number | null = null;

export const durumWheatSudOuestVarietyNeeds2026: Table<DurumWheatVarietyNeed> = {
  id: "comifer-bd-sud-ouest-2026",
  source: {
    title: "Classement des variétés blé dur selon leur besoin en azote 2026 (coefficients bq14%) : Sud-Ouest",
    organisation: "COMIFER / Arvalis",
    date: "2026-01-15",
    url: "https://comifer.asso.fr/wp-content/uploads/2026/01/BD-2026-SUD-OUEST.pdf",
    ref: "Tableau unique ; le pied de page imprime « 29 novembre 2023 », date retenue : mise en ligne du fichier (en-tête HTTP Last-Modified du 15/01/2026)",
    licence,
  },
  notes: [
    "D'autres variétés peu représentées sont aussi classées, voir le correspondant Arvalis. Sinon, on propose un bq par défaut de 3.7 pour les variétés non référencées, dans l'attente de plus d'informations techniques (texte du tableau).",
    "RGT AVENTADUR, RGT VOILUR et RGT BELALUR sont imprimés coupés en fin de ligne (« RGT » / « AVENTADUR », etc.) et recomposés.",
  ],
  rows: [
    { variety: "ACALOU", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "ACTISUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "ATOUDUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "BIENSUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "COMBO", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "DAKTER", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "GIBUS", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "LEVANTE", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "LUMINUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "NEODUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "ORJAUNE", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "PESCADOU", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "PLUSSUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "RGT AVENTADUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "RGT ENCABLUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "RGT FABIONUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "RGT IZALMUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "RGT VOILUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "SANTUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "SURMESUR", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "SY BANCO", bq14: 3.5, endOfStemReserve: "40 kg N" },
    { variety: "ANVERGUR", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "ARGELES", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "BYBLOS", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "CABAYOU", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "CASTELDOUX", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "CLAUDIO", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "CLOVIS", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "CULTUR", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "FABULIS", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "JANEIRO", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "JOYAU", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "KARUR", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "LLOYD", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "MIRADOUX", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "NAUTILUR", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "NEMESIS", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "NEFER", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "ORLU", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "PASTADOU", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "PLATONE", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "PROVENZAL", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "QUALIDOU", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "RGT KAPSUR", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "RGT MONBECUR", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "ROCAILLOU", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "SACHEM", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "SY CARMA", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "SY CYSCO", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "TOSCADOU", bq14: 3.7, endOfStemReserve: "De 40 à 60 kg N" },
    { variety: "ALEXIS", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "CANAILLOU", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "BABYLONE", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "DAURUR", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "FLORIDOU", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "FORMIDOU", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "FUSILOU", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "HARISTIDE", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "HERAKLION", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "LG BORIS", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "NOBILIS", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "RELIEF", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "RGT BELALUR", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "RGT MUSCLUR", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "RGT SOISSUR", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "RGT VANUR", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "SARAGOLLA", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "SCULPTUR", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "SILUR", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
    { variety: "TABLUR", bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" },
  ],
};

/** bq14 % par défaut pour un blé dur non référencé (Sud-Ouest 2026). */
export const durumWheatSudOuestDefaultBq14 = 3.7;
