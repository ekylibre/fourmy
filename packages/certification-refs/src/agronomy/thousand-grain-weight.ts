/**
 * Repères de PMG (poids de mille grains) par espèce, pour les semences
 * (claudedocs/conception_semences.md §2.6, décision S6) : d'après Arvalis et
 * Terres Inovia, avec leur accord de reprise (20/11/2026), chaque valeur avec
 * sa page et la phrase ou le tableau d'où elle vient.
 *
 * Un repère sert à défaut d'un PMG saisi (étiquette du sac, mesure) : les
 * quantités converties avec lui sont « estimées ». Il sert aussi à signaler
 * un PMG saisi qui s'en écarte beaucoup (erreur de saisie probable).
 *
 * `typicalStated` : la valeur type est écrite telle quelle sur la page ;
 * sinon, c'est le milieu (ou la médiane) de la plage ou du tableau cité.
 * `minG`, `maxG` : bornes de la plage ou du tableau de doses cité, pas un
 * minimum ou un maximum mesuré. Espèces sans valeur sur ces deux sites (avoine,
 * triticale, seigle, épeautre, tournesol, espèces de couverts) : absentes ;
 * leur PMG se saisit sur la fiche de la semence.
 */

export interface TgwReferenceSource {
  org: "Arvalis" | "Terres Inovia";
  title: string;
  url: string;
  /** Phrase ou intitulé du tableau d'où vient la valeur. */
  quote: string;
  consultedOn: string;
}

export interface TgwReferenceEntry {
  /** Taxon Lexicon (taxonomy.reference_name). */
  species: string;
  /** Autres taxons du même repère (catalogue des variétés : `lupinus`, `sorghum`). */
  aliases?: readonly string[];
  label: string;
  typicalG: number;
  minG: number | null;
  maxG: number | null;
  typicalStated: boolean;
  source: TgwReferenceSource;
  note?: string;
}

const ON = "2026-11-20";

export const TGW_REFERENCES: readonly TgwReferenceEntry[] = [
  {
    species: "triticum_aestivum",
    label: "Blé tendre",
    typicalG: 46,
    minG: 36,
    maxG: 56,
    typicalStated: false,
    source: {
      org: "Arvalis",
      title: "Dose de semis du blé tendre selon le PMG (tableau régional)",
      url: "https://www.arvalis.fr/file-download/download/public/203106",
      quote: "Tableau des doses de semis, lignes « PMG en g » de 36 à 56",
      consultedOn: ON,
    },
    note: "Arvalis relève 39 g en moyenne en 2022 dans le Sud-Ouest, année jugée faible à moyenne.",
  },
  {
    species: "triticum_durum",
    label: "Blé dur",
    typicalG: 48,
    minG: 40,
    maxG: 55,
    typicalStated: false,
    source: {
      org: "Arvalis",
      title: "Bulletin régional 2025 (essais Arvalis) : doses de semis",
      url: "https://www.arvalis.fr/file-download/download/public/259206",
      quote: "semer 320 grains/m² soit 175 kg/ha si le PMG … est de 55g",
      consultedOn: ON,
    },
  },
  {
    species: "hordeum_vulgare",
    label: "Orge",
    typicalG: 43,
    minG: 35,
    maxG: 50,
    typicalStated: false,
    source: {
      org: "Arvalis",
      title: "Bulletin régional 2025 (essais Arvalis) : doses de semis",
      url: "https://www.arvalis.fr/file-download/download/public/259206",
      quote: "Tableau de l'orge, « Poids de 1000 grains » 35, 40, 45, 50",
      consultedOn: ON,
    },
  },
  {
    species: "zea_mays",
    label: "Maïs",
    typicalG: 320,
    minG: 270,
    maxG: 346,
    typicalStated: false,
    source: {
      org: "Arvalis",
      title: "Essai variétés de maïs grain en agriculture biologique (17/12/2024)",
      url: "https://www.arvalis.fr/file-download/download/public/251572",
      quote: "PMG : Poids de mille grains à 15% d'humidité",
      consultedOn: ON,
    },
    note: "Médiane et bornes des variétés de l'essai.",
  },
  {
    species: "sorghum_bicolor",
    aliases: ["sorghum"],
    label: "Sorgho",
    typicalG: 30,
    minG: null,
    maxG: null,
    typicalStated: true,
    source: {
      org: "Arvalis",
      title: "Sorgho fourrager monocoupe",
      url: "https://www.arvalis.fr/file-download/download/public/247100",
      quote: "Petite graine (PMG ≈ 30g)",
      consultedOn: ON,
    },
  },
  {
    species: "linum_usitatissimum",
    label: "Lin",
    typicalG: 7,
    minG: 5,
    maxG: 8,
    typicalStated: true,
    source: {
      org: "Terres Inovia",
      title: "Lin de printemps : les points de vigilance pour réussir les semis 2026",
      url: "https://www.terresinovia.fr/fr/actualites/lin-de-printemps-les-points-de-vigilance-pour-reussir-les-semis-2026",
      quote: "le Poids de Mille Grains peut varier de 5 à 8 g",
      consultedOn: ON,
    },
    note: "Lin oléagineux. Lin fibre (Arvalis) : « Le PMG variant de 4 à 7 g selon les variétés ».",
  },
  {
    species: "brassica_napus_napus",
    label: "Colza",
    typicalG: 4.5,
    minG: 4,
    maxG: 5,
    typicalStated: false,
    source: {
      org: "Terres Inovia",
      title: "Colza : densité de semis, éviter les surdensités",
      url: "https://www.terresinovia.fr/fr/informations-techniques/colza/densite-de-semis-eviter-les-surdensites",
      quote: "dose de semis en kg/ha pour un PMG de 4 à 5 g",
      consultedOn: ON,
    },
  },
  {
    species: "pisum_sativum",
    label: "Pois",
    typicalG: 245,
    minG: 180,
    maxG: 260,
    typicalStated: false,
    source: {
      org: "Terres Inovia",
      title: "Guide de culture pois conventionnel 2025",
      url: "https://www.terresinovia.fr/sites/default/files/2025-05/guide-de-culture-pois-conventionnel-2025.pdf",
      quote: "PMG = 230 g … PMG = 260 g (pois de printemps)",
      consultedOn: ON,
    },
    note: "Pois de printemps 230 à 260 g ; pois d'hiver 180 à 220 g (Terres Inovia, « Semer son pois d'hiver au bon moment et à la bonne densité »).",
  },
  {
    species: "vicia_faba",
    label: "Féverole",
    typicalG: 450,
    minG: 400,
    maxG: 500,
    typicalStated: false,
    source: {
      org: "Terres Inovia",
      title: "Guide de culture féverole 2026",
      url: "https://www.terresinovia.fr/sites/default/files/2026-10/guide_culture_feverole_2026.pdf",
      quote: "PMG 400 g … PMG 450 g … PMG 500 g",
      consultedOn: ON,
    },
  },
  {
    species: "glycine_max",
    label: "Soja",
    typicalG: 180,
    minG: 104,
    maxG: 235,
    typicalStated: true,
    source: {
      org: "Terres Inovia",
      title: "Guide de culture soja conventionnel 2025",
      url: "https://www.terresinovia.fr/sites/default/files/2025-06/guide-de-culture-soja-conventionnel-2025.pdf",
      quote: "calculée selon une hypothèse de PMG de 180 grammes",
      consultedOn: ON,
    },
    note: "Récolte 2025 : moyenne 164 g, de 104 à 235 g (fiche qualité des graines de soja 2025, Terres Inovia).",
  },
  {
    species: "lens_culinaris",
    label: "Lentille",
    typicalG: 28,
    minG: 26,
    maxG: 30,
    typicalStated: false,
    source: {
      org: "Terres Inovia",
      title: "Tout savoir sur l'implantation de la lentille",
      url: "https://www.terresinovia.fr/fr/informations-techniques/lentille/tout-savoir-sur-limplantation-de-la-lentille",
      quote: "Tableau « Densité de semis et PMG » : 26, 28, 30 g",
      consultedOn: ON,
    },
  },
  {
    species: "cicer_arietinum",
    label: "Pois chiche",
    typicalG: 350,
    minG: 150,
    maxG: 550,
    typicalStated: false,
    source: {
      org: "Terres Inovia",
      title: "Guide de culture pois chiche 2026",
      url: "https://www.terresinovia.fr/sites/default/files/2026-04/guide_culture_pois-chiche_2026_terresinovia.pdf",
      quote: "La variabilité du poids de mille grains (PMG) est forte",
      consultedOn: ON,
    },
    note: "Bornes du tableau des doses ; le PMG dépend beaucoup de la variété : le saisir.",
  },
  {
    species: "lupinus_albus",
    aliases: ["lupinus"],
    label: "Lupin",
    typicalG: 325,
    minG: 300,
    maxG: 350,
    typicalStated: false,
    source: {
      org: "Terres Inovia",
      title: "Préparer son sol pour cultiver du lupin bio",
      url: "https://www.terresinovia.fr/fr/informations-techniques/lupin-dhiver/preparer-son-sol-pour-cultiver-du-lupin-bio",
      quote: "Tableau « PMG 300–350 »",
      consultedOn: ON,
    },
    note: "Tableau repris par Terres Inovia d'un guide des chambres d'agriculture (lupin d'hiver bio).",
  },
  {
    species: "cannabis_sativa",
    label: "Chanvre",
    typicalG: 17.5,
    minG: 15,
    maxG: 20,
    typicalStated: false,
    source: {
      org: "Terres Inovia",
      title: "Le semis du chanvre",
      url: "https://www.terresinovia.fr/fr/informations-techniques/chanvre/le-semis-du-chanvre",
      quote: "PMG est généralement compris entre 15 et 20 grammes",
      consultedOn: ON,
    },
  },
];

const BY_SPECIES = new Map<string, TgwReferenceEntry>();
for (const r of TGW_REFERENCES) for (const s of [r.species, ...(r.aliases ?? [])]) BY_SPECIES.set(s, r);

/**
 * Repère de PMG d'une espèce (taxon ou alias) ; null si aucun : le PMG se
 * saisit. Pas de repli sur l'espèce parente : un maïs pop-corn ou doux
 * (`zea_mays_everta`, `zea_mays_saccharata`) n'a pas le PMG d'un maïs grain.
 */
export function tgwReference(species: string | null | undefined): TgwReferenceEntry | null {
  return species ? (BY_SPECIES.get(species) ?? null) : null;
}
