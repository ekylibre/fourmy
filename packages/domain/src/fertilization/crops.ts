import type { CropGroup } from "@fourmy/fertilization-refs";

/**
 * Groupe de cultures du référentiel d'après une production Fourmy : la
 * nature de production Lexicon de l'activité (`grain_corn`,
 * `winter_triticale`…) d'abord, puis la culture botanique (`zea_mays`).
 * Inconnu : « other » (dose plafond des autres cultures).
 */

const BY_REFERENCE: [RegExp, CropGroup][] = [
  [/pop_?corn/, "maize_popcorn"],
  [/sweet_corn/, "maize_sweet"],
  [/seed_corn|corn_seed/, "maize_seed"],
  [/(silage|fodder|forage)_corn|corn_silage/, "maize_silage"],
  [/corn|maize/, "maize_grain"],
  [/(silage|fodder|forage)_sorghum/, "sorghum_silage"],
  [/sorghum/, "sorghum_grain"],
  [/durum/, "durum_wheat"],
  [/improver|baking_wheat|strong_wheat/, "improver_wheat"],
  [/spelt/, "spelt"],
  [/wheat/, "soft_wheat"],
  [/spring_barley/, "barley_spring"],
  [/barley/, "barley_winter"],
  [/oat/, "oat"],
  [/rye/, "rye"],
  [/triticale/, "triticale"],
  [/rape|colza/, "rapeseed_winter"],
  [/sunflower/, "sunflower"],
  [/flax|linseed/, "flax"],
  [/hemp/, "hemp"],
  [/tobacco/, "tobacco"],
  [/meadow|grassland|pasture|prairie/, "grassland"],
  [/vine|grape/, "vine"],
  [/soy|pea\b|peas|faba|bean|lupin|lentil|chickpea|alfalfa|lucerne/, "legumes"],
  [/walnut/, "walnut"],
  [/kiwi/, "kiwi"],
  [/orchard|apple|pear|plum|cherry|peach/, "orchard"],
  [/cover|catch_crop|green_manure/, "cover_crop"],
];

const BY_CULTIVATION: [RegExp, CropGroup][] = [
  [/^zea_mays/, "maize_grain"],
  [/^sorghum/, "sorghum_grain"],
  [/^triticum_durum|^triticum_turgidum_durum/, "durum_wheat"],
  [/^triticum_spelta/, "spelt"],
  [/^triticum/, "soft_wheat"],
  [/^hordeum/, "barley_winter"],
  [/^avena/, "oat"],
  [/^secale/, "rye"],
  [/^x_triticosecale/, "triticale"],
  [/^brassica_napus/, "rapeseed_winter"],
  [/^helianthus/, "sunflower"],
  [/^linum/, "flax"],
  [/^cannabis/, "hemp"],
  [/^nicotiana/, "tobacco"],
  [/^vitis/, "vine"],
  [/^(glycine|pisum|vicia|lupinus|lens|cicer|medicago|phaseolus)/, "legumes"],
  [/^(lolium|festuca|dactylis|poa|trifolium|phleum)/, "grassland"],
];

export function cropGroupOf(p: { reference?: string | null; cultivation?: string | null }): CropGroup {
  const ref = p.reference?.toLowerCase() ?? "";
  for (const [re, g] of BY_REFERENCE) if (ref && re.test(ref)) return g;
  const cult = p.cultivation?.toLowerCase() ?? "";
  for (const [re, g] of BY_CULTIVATION) if (cult && re.test(cult)) return g;
  return "other";
}

/** Cultures de printemps : ouverture du bilan en avril dans les tables Mr et MrCi, Pi nul. */
export const SPRING_CROPS: ReadonlySet<CropGroup> = new Set([
  "maize_grain",
  "maize_silage",
  "maize_sweet",
  "maize_seed",
  "maize_popcorn",
  "sorghum_grain",
  "sorghum_silage",
  "barley_spring",
  "sunflower",
  "tobacco",
  "hemp",
]);

const CEREALS: ReadonlySet<CropGroup> = new Set(["soft_wheat", "durum_wheat", "improver_wheat", "barley_winter", "barley_spring", "oat", "rye", "triticale", "spelt"]);
export const isStrawCereal = (g: CropGroup) => CEREALS.has(g);
export const isMaizeOrSorghum = (g: CropGroup) => g.startsWith("maize_") || g.startsWith("sorghum_");

/**
 * Clé du précédent dans la table Mr (minéralisation des résidus) ; null si la
 * table ne le prévoit pas. Pour une céréale, la gestion des pailles décide.
 */
export function mrKeyOf(previous: CropGroup, strawReturned: boolean | null): string | null {
  if (isStrawCereal(previous)) return strawReturned === null ? null : strawReturned ? "cereales_pailles_enfouies" : "cereales_pailles_enlevees";
  switch (previous) {
    case "maize_grain":
    case "maize_seed":
    case "maize_sweet":
    case "maize_popcorn":
      return "mais_grain";
    case "maize_silage":
      return "mais_fourrage";
    case "sorghum_grain":
    case "sorghum_silage":
      return "sorgho";
    case "rapeseed_winter":
      return "colza";
    case "sunflower":
      return "tournesol";
    case "grassland":
      return "prairie";
    case "cover_crop":
      return "culture_intermediaire";
    default:
      return null;
  }
}

/** Clé du précédent dans la table des besoins et coefficients RPR (calcul de l'APL). */
export function aplKeyOf(previous: CropGroup, strawReturned: boolean | null): string | null {
  const straw = (base: string) => (strawReturned === null ? null : `${base}_pailles_${strawReturned ? "restituees" : "enlevees"}`);
  switch (previous) {
    case "oat":
      return straw("avoine");
    case "soft_wheat":
    case "improver_wheat":
      return straw("ble_tendre");
    case "durum_wheat":
      return straw("ble_dur");
    case "barley_winter":
    case "barley_spring":
      return straw("orge");
    case "rye":
      return straw("seigle");
    case "triticale":
      return straw("triticale");
    case "rapeseed_winter":
      return "colza";
    case "maize_grain":
    case "maize_popcorn":
      return "mais_grain";
    case "maize_seed":
      return "mais_semence";
    case "maize_silage":
      return "mais_fourrage";
    case "sorghum_grain":
      return "sorgho_grain";
    case "sorghum_silage":
      return "sorgho_ensilage";
    case "sunflower":
      return "tournesol";
    default:
      return null;
  }
}
