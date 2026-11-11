/**
 * Annexe 7 du référentiel GREN Nouvelle-Aquitaine (arrêté du 29/07/2025) :
 * types de sols. Recopié du tableau et contrôlé sur le rendu de la page.
 */

import type { NaSoilType, Table } from "../types.js";

/** Une ligne « Nom vernaculaire » du tableau, avec ses cases propres. */
export interface NaSoilVernacular {
  name: string;
  /** « Texture de surface » telle qu'imprimée ; null si case vide. */
  texture: string | null;
  ph: string | null;
  /** « Cailloux » ; null si case vide. */
  stones: string | null;
}

export interface NaSoilRow {
  key: NaSoilType;
  /** Libellé(s) de la première colonne tel(s) qu'imprimé(s). */
  label: string;
  vernacularNames: string[];
  /**
   * « Classes de réserve utile possibles », imprimées une seule fois par groupe
   * (sur la première ligne vernaculaire) ; texte tel qu'imprimé.
   */
  ruClasses: { low: string | null; medium: string | null; high: string | null };
  /** Textures des lignes vernaculaires, dans l'ordre (dédoublonnées). */
  texture: string[];
  ph: string[];
  stones: string[];
  vernaculars: NaSoilVernacular[];
}

function row(
  key: NaSoilType,
  label: string,
  ruClasses: NaSoilRow["ruClasses"],
  vernaculars: NaSoilVernacular[],
): NaSoilRow {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => x !== null))];
  return {
    key,
    label,
    vernacularNames: vernaculars.map((v) => v.name),
    ruClasses,
    texture: uniq(vernaculars.map((v) => v.texture)),
    ph: uniq(vernaculars.map((v) => v.ph)),
    stones: uniq(vernaculars.map((v) => v.stones)),
    vernaculars,
  };
}

const RU_STD = { low: "<80 mm", medium: "de 80 à 120", high: ">120 mm" };

export const naSoils: Table<NaSoilRow> = {
  id: "na-2025/soils",
  source: {
    title: "Arrêté référentiel GREN Nouvelle-Aquitaine – Annexe 7 : types de sols",
    organisation: "Préfecture de la région Nouvelle-Aquitaine (GREN)",
    date: "2025-07-29",
    url: "https://www.nouvelle-aquitaine.developpement-durable.gouv.fr/IMG/pdf/7_sols_gren_na_vdef.pdf",
    ref: "Annexe 7, tableau « Types de sols », p. 1",
    licence: "Arrêté préfectoral publié (document administratif) ; valeurs citées de leurs organismes",
  },
  notes: [
    "Abréviations de texture telles qu'imprimées (Arg, LAS/A, S/SL, L/LA, LA, SL/LS, SL, LS/SL, LA/A) ; Cx = cailloux, Qtz = quartz.",
    "Le type « fond_vallee_terres_noires » regroupe deux lignes distinctes de l'annexe : « Sols de fond de vallées » (RU : Non observé / de 80 120 mm / >120 mm) et « Terres noires » (cases RU vides). Les classes RU retenues sont celles imprimées pour les fonds de vallées ; elles ne sont pas imprimées pour les terres noires.",
    "Sols sableux : la case Cailloux est tronquée dans l'annexe (« Gravier de »), recopiée telle quelle.",
    "Les classes RU ne sont imprimées que sur la première ligne vernaculaire de chaque groupe ; elles sont rattachées au groupe.",
  ],
  rows: [
    row("argilo_calcaire", "Argilo-calcaire", RU_STD, [
      { name: "Groies superficielle, moyenne et profonde, argileuse", texture: "Arg", ph: ">7", stones: "Cx Calcaire" },
      { name: "Aubues, champagnes, tuffeau", texture: "LAS/A", ph: ">7", stones: "Cx de Craie" },
    ]),
    row("sableux", "Sols sableux", { low: "<80 mm", medium: "de 80 à 120", high: "Non concerné" }, [
      { name: "Sols sableux", texture: "S/SL", ph: "<7", stones: "Gravier de" },
      { name: "Doucins sableux hydromorphes", texture: "S/SL", ph: "<7", stones: null },
      { name: "Podzols (sables noirs et sables blancs)", texture: "S/SL", ph: "<5", stones: null },
    ]),
    row(
      "fond_vallee_terres_noires",
      "Sols de fond de vallées ; Terres noires",
      { low: "Non observé", medium: "de 80 120 mm", high: ">120 mm" },
      [
        { name: "Marais tourbeux ou fond de vallée", texture: "Arg", ph: "acide", stones: null },
        { name: "Touyas, terres noires de vallées", texture: "Arg", ph: "neutre ou >7", stones: null },
      ],
    ),
    row("marais_argileux_sodiques", "Sols de marais argileux sodiques", { low: "Non concerné", medium: "de 80 à 120 mm", high: ">120 mm" }, [
      { name: "Marais argileux", texture: "Arg", ph: ">7", stones: null },
    ]),
    row("limoneux", "Sols Limoneux", RU_STD, [
      { name: "Terres rouges à châtaigniers", texture: "Arg", ph: "neutre", stones: "Cx et graviers" },
      { name: "Bornais, limons", texture: "L/LA", ph: "<7", stones: "Cx et graviers" },
      { name: "Sols limono-argileux à argilo-limoneux, doucins limoneux", texture: "L/LA", ph: null, stones: null },
      { name: "Limons sur schistes ou gneiss", texture: "LA", ph: "<7", stones: "Cx de schistes" },
    ]),
    row("terrasses_vallees", "Sols de terrasses de vallées", RU_STD, [
      { name: "Sols de terrasses de vallées", texture: "SL/LS", ph: "<7", stones: "Gravier de quartz" },
      { name: "Alluvions, colluvions, alluvions hydromorphes, colluvions hydromorphes", texture: "SL/LS", ph: "<7 voire neutre", stones: "Gravier de quartz" },
      { name: "Alluvions sableuses et caillouteuses, boulbènes", texture: "SL", ph: "<7", stones: "Gravier de quartz" },
    ]),
    row("sur_granite", "Sols sur granite", RU_STD, [
      { name: "Sable sur granite, sables limoneux", texture: "LS/SL", ph: "<7", stones: "cx de granite et Qtz" },
    ]),
    row("argileux_sablo_argileux", "Sols argileux à sablo argileux", { low: "< 80 mm", medium: "de 80 à 120", high: ">120 mm" }, [
      {
        name: "Argile à silex, brandes, doucins argileux, terreforts, palus, coteaux molassiques du piémont pyrénéen, silex, galets...)",
        texture: "LA/A",
        ph: "<7",
        stones: "Cx de silex",
      },
    ]),
  ],
};
