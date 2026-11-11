/**
 * Fractionnement obligatoire des apports d'engrais minéraux en zone vulnérable
 * de Nouvelle-Aquitaine (7e programme d'actions régional), d'après le guide
 * de mise en œuvre de la DREAL (version du 16/10/2026), page 22, tableaux 6 à 8.
 *
 * Texte du guide : « Le fractionnement des apports d'engrais minéraux est
 * obligatoire sur céréales à paille d'hiver, colza et maïs et le premier apport
 * est plafonné selon les modalités détaillées dans les tableaux 6, 7 et 8
 * suivants. La dose indiquée dans les tableaux correspond à la dose totale
 * apportée à la culture sous forme d'engrais minéraux, exprimée en azote
 * efficace. Pour les céréales, le stade « épi 1 cm » symbolise le passage entre
 * la phase de tallage et celle de montaison. Le premier apport est plafonné
 * avant l'atteinte de ce stade. »
 */
import type { CropGroup, Table } from "../types.js";

export interface SplittingRule {
  /** Tableau du guide. */
  table: 6 | 7 | 8;
  /** Libellé du guide. */
  crop: string;
  cropGroups: CropGroup[];
  /** Plafond du premier apport (kg N efficace/ha, engrais minéraux). */
  firstApplicationCapKgN: number;
  /** Condition du plafond, citée. */
  firstApplicationCapCondition: string;
  /** Nombre minimal d'apports selon la dose totale minérale (kg N efficace/ha). */
  minApplications: {
    count: number;
    /** Borne basse de dose totale ; null si non bornée. */
    doseFromKgN: number | null;
    /** Borne haute de dose totale ; null si non bornée. */
    doseToKgN: number | null;
    /** true : borne basse stricte (« > »). */
    fromExclusive: boolean;
    /** Condition citée du guide. */
    quoted: string;
  }[];
  note?: string;
}

const boundsNote =
  "Le guide écrit « entre X et Y kgN/ha » sans préciser si les bornes sont incluses ; la classe suivante est « > Y ». Bornes traitées comme incluses (X ≤ dose ≤ Y).";

export const naSplittingRules: Table<SplittingRule> = {
  id: "na-par7-splitting",
  source: {
    title: "Le 7e programme d'actions nitrates dans les zones vulnérables de Nouvelle-Aquitaine : guide pour la mise en œuvre",
    organisation: "DREAL Nouvelle-Aquitaine / DRAAF Nouvelle-Aquitaine",
    date: "2026-10-16",
    url: "https://www.nouvelle-aquitaine.developpement-durable.gouv.fr/IMG/pdf/guide_pour_la_mise_en_oeuvre_du_7e_programme_d_actions_nitrates.pdf",
    ref: "Mesure fractionnement des apports, page 22, tableaux 6 (céréales à paille d'hiver), 7 (colza) et 8 (maïs)",
    licence: "Information publique (CRPA art. L. 321-1 et L. 322-1 : réutilisation avec mention de la source et de la date) ; pas de licence explicite dans le document",
  },
  notes: [
    "Les doses s'entendent en azote efficace apporté sous forme d'engrais minéraux (dose totale de la culture).",
    "Maïs : seul le plafond du premier apport est conditionné à un semis avant le 1er mai ; l'obligation d'au moins 2 apports au-delà de 120 kgN/ha est imprimée sans condition de date de semis.",
  ],
  rows: [
    {
      table: 6,
      crop: "céréales à paille d'hiver",
      cropGroups: ["soft_wheat", "durum_wheat", "improver_wheat", "barley_winter", "oat", "rye", "triticale", "spelt"],
      firstApplicationCapKgN: 50,
      firstApplicationCapCondition: "Plafonnement pendant la phase de tallage : 50 kgN/ha avant l'apport visant le stade « épi 1 cm »",
      minApplications: [
        { count: 2, doseFromKgN: 110, doseToKgN: 160, fromExclusive: false, quoted: "Au moins 2 apports obligatoires si dose totale entre 110 et 160 kgN/ha" },
        { count: 3, doseFromKgN: 160, doseToKgN: null, fromExclusive: true, quoted: "Au moins 3 apports obligatoires si dose totale > 160 kgN/ha" },
      ],
      note: boundsNote + " cropGroups : avoine, seigle, épeautre inclus au titre de « céréales à paille d'hiver » quand semés à l'automne.",
    },
    {
      table: 7,
      crop: "colza",
      cropGroups: ["rapeseed_winter"],
      firstApplicationCapKgN: 80,
      firstApplicationCapCondition: "Plafonnement du 1er apport : 80 kgN/ha à la reprise de végétation",
      minApplications: [
        { count: 2, doseFromKgN: 80, doseToKgN: 170, fromExclusive: false, quoted: "Au moins 2 apports obligatoires si dose totale entre 80 et 170 kgN/ha" },
        { count: 3, doseFromKgN: 170, doseToKgN: null, fromExclusive: true, quoted: "Au moins 3 apports obligatoires si dose totale > 170 kgN/ha" },
      ],
      note: boundsNote,
    },
    {
      table: 8,
      crop: "maïs",
      cropGroups: ["maize_grain", "maize_silage", "maize_sweet", "maize_seed", "maize_popcorn"],
      firstApplicationCapKgN: 50,
      firstApplicationCapCondition: "Plafonnement du 1er apport (pour un semis avant le 1er mai) : 50 kgN/ha avant le stade 2 feuilles",
      minApplications: [
        { count: 2, doseFromKgN: 120, doseToKgN: null, fromExclusive: true, quoted: "Au moins 2 apports obligatoires si dose totale > 120 kgN/ha" },
      ],
      note: "Le plafond de 50 kgN/ha avant 2 feuilles ne vaut que pour un semis avant le 1er mai (texte du tableau 8).",
    },
  ],
};
