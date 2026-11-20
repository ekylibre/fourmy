import { IFT_FIELD_CROPS, IFT_ORCHARD, IFT_POTATO, IFT_VINE, type IftReference, type IftScales } from "./ift-references.js";
import { HVE_COMMUNES_07_26, HVE_DEPARTMENTS, HVE_VINE_BASIN_KEYS } from "./regions.js";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const find = (t: Record<string, IftReference>, key: string): IftReference | null => {
  const k = norm(key);
  const hit = Object.entries(t).find(([name]) => norm(name) === k);
  return hit ? hit[1] : null;
};

/** Département d'un code INSEE de commune (« 64389 » → « 64 », « 97411 » → « 974 », Corse → 2A/2B). */
export function departmentOf(insee: string): string {
  if (insee.startsWith("97")) return insee.slice(0, 3);
  return insee.slice(0, 2);
}

/** Ancienne région d'un département (références IFT grandes cultures et arboriculture). */
export function oldRegionOf(department: string): string | null {
  return HVE_DEPARTMENTS[department.padStart(2, "0")]?.oldRegion ?? null;
}

/**
 * Bassin viticole du siège : par département ; Ardèche et Drôme selon la
 * commune ; Rhône et Saône-et-Loire selon le périmètre de l'AOC Beaujolais
 * (`beaujolais`, à régler). `null` : à préciser.
 */
export function vineBasinOf(insee: string, beaujolais?: boolean | null): string | null {
  const dep = HVE_DEPARTMENTS[departmentOf(insee)];
  if (!dep) return null;
  if (dep.name === "Ardèche" || dep.name === "Drôme") {
    const part = HVE_COMMUNES_07_26[insee];
    return part ? (HVE_VINE_BASIN_KEYS[`${dep.name} Partie ${part}`] ?? null) : null;
  }
  if (dep.name === "Rhône" || dep.name === "Saône-et-Loire") {
    if (beaujolais === null || beaujolais === undefined) return null;
    return HVE_VINE_BASIN_KEYS[`${dep.name} ${beaujolais ? "Périmètre" : "Hors périmètre"} AOC Beaujolais`] ?? null;
  }
  return HVE_VINE_BASIN_KEYS[dep.name] ?? null;
}

const pick = (t: IftScales, scale: "current" | "old", key: string) => find(t[scale], key) ?? (scale === "old" ? find(t.current, key) : null);

/**
 * Références IFT des grandes cultures d'une ancienne région, recalées sur la
 * part de pomme de terre dans l'assolement (PdC4 p. 44) : Pc = (1 − p) × Pc GC
 * + p × Pc PdT, de même pour Pf.
 */
export function fieldCropsReference(region: string, potatoShare: number, scale: "current" | "old" = "current"): IftReference | null {
  const gc = pick(IFT_FIELD_CROPS, scale, region);
  if (!gc) return null;
  if (potatoShare <= 0) return gc;
  const pdt = pick(IFT_POTATO, scale, region);
  if (!pdt) return null;
  return gc.map((v, i) => Math.round(((1 - potatoShare) * v + potatoShare * pdt[i]!) * 1000) / 1000) as IftReference;
}

export function vineReference(basin: string): IftReference | null {
  return find(IFT_VINE.current, basin);
}

/** Arboriculture : moyenne des références des vergers, pondérée par leur surface. */
export function orchardReference(region: string, orchards: { orchard: string; areaM2: number }[]): IftReference | null {
  const total = orchards.reduce((s, o) => s + o.areaM2, 0);
  if (!total) return null;
  const sum: IftReference = [0, 0, 0, 0];
  for (const o of orchards) {
    const r = find(IFT_ORCHARD.current, `${region}|${o.orchard}`) ?? find(IFT_ORCHARD.current, `${region}|Autres`);
    if (!r) return null;
    r.forEach((v, i) => (sum[i] = sum[i]! + (v * o.areaM2) / total));
  }
  return sum.map((v) => Math.round(v * 1000) / 1000) as IftReference;
}

/** Espèce (taxonomie Lexicon) → type de verger des références arboricoles. */
export const ORCHARD_OF_SPECIES: Record<string, string> = {
  malus: "Pommier",
  malus_domestica: "Pommier",
  pyrus: "Poirier",
  pyrus_communis: "Poirier",
  prunus_persica: "Pêcher",
  prunus_persica_nucipersica: "Nectarinier",
  prunus_armeniaca: "Abricotier",
  prunus_avium: "Cerisier",
  prunus_cerasus: "Cerisier",
  prunus_domestica: "Prunier",
  prunus_domestica_syriaca: "Mirabellier",
  juglans: "Noyer",
  juglans_regia: "Noyer",
  citrus: "Agrumes",
  musa: "Bananier",
};
