/**
 * Règles de correspondance Ekylibre → Fourmy, pures et testées.
 */

/** Convertit un volume en litres ; null si l'unité n'est pas un volume connu. */
export function toLiters(value: number | null, unit: string | null): number | null {
  if (value === null || unit === null) return null;
  const factor: Record<string, number> = {
    liter: 1,
    hectoliter: 100,
    cubic_meter: 1000,
    cubic_decimeter: 1,
  };
  const f = factor[unit];
  return f === undefined ? null : value * f;
}

export type ArticleKind = "phyto" | "fertilizer" | "seed" | "harvest" | "wine" | "other";

/**
 * Nature d'un article à partir de la variante Ekylibre. Un n° AMM
 * (`france_maaid`) signe un produit phytopharmaceutique.
 */
export function articleKind(v: { variety: string | null; france_maaid: string | null }): ArticleKind {
  if (v.france_maaid?.trim()) return "phyto"; // AMM vide ('') ≠ phyto
  const variety = v.variety ?? "";
  if (/seed|seedling|plant_seed/.test(variety)) return "seed";
  if (/fertilizer|manure|slurry|preparation/.test(variety)) return "fertilizer";
  if (/wine|must/.test(variety)) return "wine";
  if (/grape|harvest|vegetable|cereal|crop/.test(variety)) return "harvest";
  return "other";
}

/** Nature de production à partir de la famille d'activité Ekylibre. */
/** Familles d'activité reprises (celles d'Ekylibre). */
export const ACTIVITY_FAMILIES = new Set([
  "plant_farming",
  "vine_farming",
  "animal_farming",
  "plant_nursery",
  "processing",
  "wine_making",
  "administering",
  "tool_maintaining",
  "service_delivering",
]);

export function productionNature(
  family: string | null,
): "field_crop" | "vine" | "grassland" | null {
  if (family === "vine_farming") return "vine";
  if (family === "plant_farming") return "field_crop";
  if (family === "animal_farming") return "grassland";
  return null;
}

/**
 * Culture d'une production (taxonomie Lexicon, la même que celle d'Ekylibre :
 * zea_mays, vitis…) : la variété cultivée de l'activité ; une vigne sans
 * variété renseignée reste de la vigne. Sert aux contrôles phyto (usages
 * autorisés par culture) et à l'IFT.
 */
export function cultivationOf(cultivationVariety: string | null, nature: "field_crop" | "vine" | "grassland"): string | null {
  const v = cultivationVariety?.trim().toLowerCase() || null;
  if (v && /^[a-z_]+$/.test(v) && v !== "plant") return v;
  return nature === "vine" ? "vitis" : null;
}

/** Statut d'intervention : seules les interventions réalisées entrent au journal. */
export function interventionStatus(state: string | null): "done" | "planned" | null {
  if (state === "done" || state === "validated") return "done";
  if (state === "in_progress" || state === "request") return "planned";
  return null; // rejected, etc. : non migrées
}

/** Rôle d'un paramètre Ekylibre. */
export function parameterRole(
  type: string,
): "target" | "input" | "output" | "tool" | "doer" | null {
  switch (type) {
    case "InterventionTarget":
      return "target";
    case "InterventionInput":
      return "input";
    case "InterventionOutput":
      return "output";
    case "InterventionTool":
      return "tool";
    case "InterventionDoer":
      return "doer";
    default:
      return null; // InterventionGroupParameter : conteneur logique, ignoré
  }
}

/** Type de contenant à partir de la variété du produit. */
export function containerKind(variety: string | null): "tank" | "silo" | "barrel" | null {
  if (variety === "tank" || variety === "vat") return "tank";
  if (variety === "silo") return "silo";
  if (variety === "barrel" || variety === "cask") return "barrel";
  return null;
}

/**
 * Capacité annoncée par un libellé (« Cuve 50 hl », « Garde vin 5hl ») en
 * litres, pour détecter les saisies incohérentes. null si rien de lisible.
 */
export function capacityFromLabel(label: string | null): number | null {
  if (!label) return null;
  const m = /(\d+(?:[.,]\d+)?)\s*(hl|l)\b/i.exec(label);
  if (!m) return null;
  const value = Number(m[1]!.replace(",", "."));
  return m[2]!.toLowerCase() === "hl" ? value * 100 : value;
}
