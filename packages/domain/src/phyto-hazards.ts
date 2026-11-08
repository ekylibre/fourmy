/**
 * Pictogrammes de danger d'un produit phytosanitaire (SGH01 à SGH09,
 * règlement CLP n° 1272/2008, annexe V) d'après ses mentions de danger
 * (H…). Correspondance complète ici : celle de Lexicon ne couvre qu'une
 * partie des mentions (H361d n'y donne pas SGH08, par exemple).
 */

export type HazardPictogram = "SGH01" | "SGH02" | "SGH03" | "SGH04" | "SGH05" | "SGH06" | "SGH07" | "SGH08" | "SGH09";

const BY_CODE: Record<string, HazardPictogram[]> = {};
const add = (picto: HazardPictogram, codes: number[]) => {
  for (const c of codes) (BY_CODE[`H${c}`] ??= []).push(picto);
};
add("SGH01", [200, 201, 202, 203, 204, 205, 240, 241]);
add("SGH02", [220, 221, 222, 223, 224, 225, 226, 228, 241, 242, 250, 251, 252, 260, 261]);
add("SGH03", [270, 271, 272]);
add("SGH04", [280, 281]);
add("SGH05", [290, 314, 318]);
add("SGH06", [300, 301, 310, 311, 330, 331]);
add("SGH07", [302, 312, 315, 317, 319, 332, 335, 336, 420]);
add("SGH08", [304, 334, 340, 341, 350, 351, 360, 361, 370, 371, 372, 373]);
add("SGH09", [400, 410, 411]);

export const HAZARD_LABELS: Record<HazardPictogram, string> = {
  SGH01: "Explosif",
  SGH02: "Inflammable",
  SGH03: "Comburant",
  SGH04: "Gaz sous pression",
  SGH05: "Corrosif",
  SGH06: "Toxicité aiguë",
  SGH07: "Nocif, irritant",
  SGH08: "Danger pour la santé (CMR, sensibilisant)",
  SGH09: "Dangereux pour l'environnement aquatique",
};

/**
 * Pictogrammes d'une liste de mentions (H319, H361d…), dans l'ordre SGH01 →
 * SGH09, avec les règles de préséance du CLP (art. 26) : la tête de mort
 * (SGH06) exclut le point d'exclamation (SGH07) ; la corrosion (SGH05)
 * l'exclut pour l'irritation de la peau ou des yeux (H315, H319).
 */
export function hazardPictograms(codes: string[], extra: string[] = []): HazardPictogram[] {
  const set = new Set<HazardPictogram>();
  const sources = new Map<HazardPictogram, string[]>();
  for (const raw of codes) {
    const code = /^H\d{3}/.exec(raw.trim().toUpperCase())?.[0];
    for (const p of (code && BY_CODE[code]) || []) {
      set.add(p);
      sources.set(p, [...(sources.get(p) ?? []), code!]);
    }
  }
  for (const p of extra) if (/^SGH0[1-9]$/.test(p)) set.add(p as HazardPictogram);
  if (set.has("SGH06")) set.delete("SGH07");
  if (set.has("SGH05") && (sources.get("SGH07") ?? []).every((c) => c === "H315" || c === "H319")) set.delete("SGH07");
  return [...set].sort();
}
