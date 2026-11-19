import type { BundleParcel, ImportBundle } from "./model.js";

/**
 * Couverts d'interculture (lot IM2) : une culture secondaire de Geofolia
 * (ou une culture DAPLOS sur la terre d'une autre) qui est un couvert —
 * CINE, CIE, CIPAN, engrais vert — devient un couvert de la parcelle
 * (`cover_crops`, utilisé par les contrôles nitrates), pas une production.
 * Les dérobées (épinard, second maïs) restent des productions datées.
 */

/** Familles de couverts de Fourmy (`cover_crops.family`). */
export type CoverFamily =
  | "cruciferes"
  | "graminees_seigle_avoine"
  | "graminees_ray_grass"
  | "legumineuses"
  | "hydrophyllacees"
  | "melange_graminees_legumineuses"
  | "melange_cruciferes_legumineuses";

export interface CoverInfo {
  family: CoverFamily;
  /** Espèces lisibles : libellé de la culture, et semences employées s'il y en a. */
  species: string;
  sownOn: string;
  destroyedOn: string | null;
  /** CIE (récolté, fauché, pâturé) ou CINE (non exporté). */
  exported: boolean;
}

const COVER_LABEL = /\b(CINE|CIE|CIPAN|couverts?|interculture|engrais vert|piège à nitrates)\b/i;

/** Codes d'espèce AgroEDI (table 18) des couverts courants. */
const SPECIES_FAMILY: Record<string, "cruciferes" | "legumineuses" | "graminees_seigle_avoine" | "graminees_ray_grass" | "hydrophyllacees"> = {
  ZDA: "cruciferes", // moutarde blanche
  ZDC: "cruciferes", // moutarde
  ZDE: "cruciferes", // navette
  ZBE: "cruciferes", // colza
  ZDN: "cruciferes", // radis
  ZEJ: "hydrophyllacees", // phacélie
  ZDK: "graminees_seigle_avoine", // seigle
  ZAM: "graminees_seigle_avoine", // avoine
  ZDB: "graminees_ray_grass", // ray-grass
  ZDQ: "legumineuses", // vesce
  ZMF: "legumineuses", // trèfle
  ZBT: "legumineuses", // féverole
};

/** Espèces semées presque toujours en couvert (moutardes, navette, radis, phacélie). */
const COVER_ONLY = new Set(["ZDA", "ZDC", "ZDE", "ZDN", "ZEJ"]);

/** Espèce AgroEDI (table 18) qui ne se cultive guère qu'en couvert d'interculture. */
export function isCoverSpecies(code: string | null | undefined): boolean {
  return !!code && COVER_ONLY.has(code.trim());
}

const KEYWORDS: [RegExp, "cruciferes" | "legumineuses" | "graminees_seigle_avoine" | "graminees_ray_grass" | "hydrophyllacees"][] = [
  [/moutarde|radis|navette|colza|chou|cameline/i, "cruciferes"],
  [/phac[ée]lie/i, "hydrophyllacees"],
  [/ray[- ]?grass/i, "graminees_ray_grass"],
  [/seigle|avoine|orge|triticale|bl[ée]/i, "graminees_seigle_avoine"],
  [/vesce|tr[èe]fle|f[ée]verole|pois|lentille|luzerne|gesse|fenugrec|\bTI\b/i, "legumineuses"],
];

/** Famille d'un couvert d'après les espèces nommées (libellé, semences) et le code AgroEDI. */
export function coverFamily(texts: string[], aeeCode: string | null): CoverFamily | null {
  const found = new Set<string>();
  for (const t of texts) for (const [re, family] of KEYWORDS) if (re.test(t)) found.add(family);
  if (!found.size && aeeCode && SPECIES_FAMILY[aeeCode]) found.add(SPECIES_FAMILY[aeeCode]!);
  if (!found.size) return null;
  const legume = found.has("legumineuses");
  const grass = found.has("graminees_seigle_avoine") || found.has("graminees_ray_grass");
  if (found.has("cruciferes") && legume) return "melange_cruciferes_legumineuses";
  if (grass && legume) return "melange_graminees_legumineuses";
  // Mélange sans légumineuse : la famille qui piège le plus d'azote d'abord (crucifères).
  for (const f of ["cruciferes", "hydrophyllacees", "graminees_seigle_avoine", "graminees_ray_grass", "legumineuses"] as const) {
    if (found.has(f)) return f;
  }
  return null;
}

/**
 * Couvert d'interculture d'une culture du fichier, ou null (production).
 * Exige une culture secondaire (sur la terre d'une autre), un libellé de
 * couvert ou un usage « biomasse » sans récolte, et une date de semis.
 */
export function coverOf(bundle: ImportBundle, p: BundleParcel): CoverInfo | null {
  if (!p.secondary) return null;
  const units = bundle.workUnits.filter((u) => u.parcelKey === p.key);
  const harvested = units.some((u) => u.outputs.length > 0);
  if (!COVER_LABEL.test(p.crop.label) && !(p.crop.aeeUsage === "ZPB" && !harvested) && !isCoverSpecies(p.crop.aeeCode)) return null;
  // Semences employées pour ce couvert (noms des articles des semis).
  const articles = new Map(bundle.articles.map((a) => [a.key, a]));
  const seeds = [...new Set(units.flatMap((u) => u.inputs.map((i) => articles.get(i.articleKey)).filter((a) => a?.nature === "seed").map((a) => a!.name)))];
  const family = coverFamily([p.crop.label, ...seeds], p.crop.aeeCode);
  const sownOn = p.crop.sownOn ?? units.filter((u) => u.inputs.length).map((u) => u.on).sort()[0] ?? null;
  if (!family || !sownOn) return null;
  const destroyedOn = p.crop.harvestedOn && p.crop.harvestedOn >= sownOn ? p.crop.harvestedOn : null;
  const exported = /\bCIE\b/i.test(p.crop.label) ? true : /CINE/i.test(p.crop.label) ? false : /p[âa]tur|fauch|fourrage/i.test(p.crop.destination ?? "");
  return {
    family,
    species: [p.crop.label, ...seeds.filter((s) => s.toLowerCase() !== p.crop.label.toLowerCase())].join(", ").slice(0, 200),
    sownOn,
    destroyedOn,
    exported,
  };
}

/** Dates d'une production (semis → récolte), si elles sont connues et cohérentes. */
export function productionDates(p: BundleParcel): { startedOn: string | null; stoppedOn: string | null } {
  const startedOn = p.crop.sownOn;
  const stoppedOn = p.crop.harvestedOn && (!startedOn || p.crop.harvestedOn >= startedOn) ? p.crop.harvestedOn : null;
  return { startedOn, stoppedOn };
}
