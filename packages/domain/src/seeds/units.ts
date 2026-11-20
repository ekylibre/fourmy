import { unitScale } from "../fertilization/units.js";

/**
 * Unités des semences (claudedocs/conception_semences.md §3.1) : masse, nombre
 * de grains, ou dose de N grains. Les libellés libres des articles existants
 * (« Sac de 50 000 grains », « Mille graines », « Kg »…) sont reconnus ; rien
 * n'est deviné : une unité inconnue rend null.
 */
export type SeedUnit = { dim: "mass"; kg: number } | { dim: "grain"; grains: number } | { dim: "dose"; grains: number | null };

/** Ce qui permet de convertir : PMG (g) et nombre de grains d'une dose. */
export interface SeedConversionCtx {
  tgwG?: number | null;
  grainsPerDose?: number | null;
}

/** Codes enregistrés, dans l'ordre où ils sont proposés à la saisie. */
export const SEED_UNIT_CODES = ["kilogram", "thousand", "grain", "dose", "million", "gram"] as const;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const GRAIN_WORDS = new Set(["grain", "grains", "graine", "graines", "unity", "unite", "unites", "seed", "seeds"]);
const THOUSAND_WORDS = new Set(["thousand", "thousands", "mille", "millier", "milliers", "mille grains", "mille graines", "millier de grains", "milliers de grains", "milliers de graines"]);
const MILLION_WORDS = new Set(["million", "millions", "million de grains", "millions de grains", "millions de graines"]);
const DOSE_WORDS = new Set(["dose", "doses", "sac", "sacs", "dose de semis"]);
// « Sac de 50 000 grains », « dose de 150 000 graines », « 1000 grains ».
const COUNTED = /^(?:(sacs?|doses?|boites?)\s*(?:de\s*)?)?(\d[\d .]*)\s*(?:grains?|graines?)$/;

/** Reconnaît une unité de semence ; `grainsPerDose` donne N à une « dose » ou un « sac » sans nombre. */
export function parseSeedUnit(unit: string | null | undefined, grainsPerDose?: number | null): SeedUnit | null {
  if (!unit) return null;
  const u = norm(unit);
  if (!u) return null;
  if (GRAIN_WORDS.has(u)) return { dim: "grain", grains: 1 };
  if (THOUSAND_WORDS.has(u)) return { dim: "grain", grains: 1_000 };
  if (MILLION_WORDS.has(u)) return { dim: "grain", grains: 1_000_000 };
  if (DOSE_WORDS.has(u)) return { dim: "dose", grains: grainsPerDose && grainsPerDose > 0 ? grainsPerDose : null };
  const counted = COUNTED.exec(u);
  if (counted) {
    const n = Number(counted[2]!.replace(/[ .]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return null;
    return counted[1] ? { dim: "dose", grains: n } : { dim: "grain", grains: n };
  }
  const mass = unitScale(u);
  if (mass?.dim === "mass") return { dim: "mass", kg: mass.factor };
  return null;
}

/** Quantité en kg ou en grains ; null pour une dose dont on ignore le nombre de grains. */
function toBase(quantity: number, u: SeedUnit): { kind: "kg" | "grains"; value: number } | null {
  if (u.dim === "mass") return { kind: "kg", value: quantity * u.kg };
  if (u.grains === null) return null;
  return { kind: "grains", value: quantity * u.grains };
}

/** Pourquoi une conversion de semence est impossible, ou null si elle l'est. */
export function seedConversionGap(from: string, to: string, ctx: SeedConversionCtx = {}): "unit_unknown" | "grains_per_dose_missing" | "tgw_missing" | null {
  const a = parseSeedUnit(from, ctx.grainsPerDose);
  const b = parseSeedUnit(to, ctx.grainsPerDose);
  if (!a || !b) return "unit_unknown";
  if ((a.dim === "dose" && a.grains === null) || (b.dim === "dose" && b.grains === null)) return "grains_per_dose_missing";
  if ((a.dim === "mass") !== (b.dim === "mass") && !(ctx.tgwG && ctx.tgwG > 0)) return "tgw_missing";
  return null;
}

/**
 * Convertit une quantité de semence d'une unité à une autre : même dimension
 * par facteur ; grains ↔ masse par le PMG (kg = grains × PMG ÷ 1 000 000).
 * Null si c'est impossible (unité inconnue, PMG ou grains par dose manquants).
 */
export function convertSeedQuantity(quantity: number, from: string, to: string, ctx: SeedConversionCtx = {}): number | null {
  if (from === to) return quantity;
  const a = parseSeedUnit(from, ctx.grainsPerDose);
  const b = parseSeedUnit(to, ctx.grainsPerDose);
  if (!a || !b) return null;
  const base = toBase(quantity, a);
  const unit = toBase(1, b);
  if (!base || !unit) return null;
  if (base.kind === unit.kind) return base.value / unit.value;
  const tgw = ctx.tgwG;
  if (!tgw || tgw <= 0) return null;
  const converted = base.kind === "grains" ? (base.value * tgw) / 1_000_000 : (base.value * 1_000_000) / tgw;
  return converted / unit.value;
}

/** Sépare une dose par surface : `_per_hectare`, ou `_per_square_meter` (grains/m²). */
export function seedRate(unit: string): { unit: string; perM2: number | null } {
  const ha = /^(.+)_per_hectare$/.exec(unit);
  if (ha) return { unit: ha[1]!, perM2: 1 / 10_000 };
  const m2 = /^(.+)_per_square_meter$/.exec(unit);
  if (m2) return { unit: m2[1]!, perM2: 1 };
  return { unit, perM2: null };
}

/**
 * Unités proposées à la saisie d'une semence stockée dans `articleUnit` : la
 * sienne d'abord, puis celles qui s'y convertissent (FR-SE-20).
 */
export function seedUnitChoices(articleUnit: string, ctx: SeedConversionCtx = {}): string[] {
  if (!parseSeedUnit(articleUnit, ctx.grainsPerDose)) return [articleUnit];
  const out = [articleUnit];
  for (const code of SEED_UNIT_CODES) {
    if (code === "gram" || code === "million") continue;
    if (seedConversionGap(code, articleUnit, ctx) !== null) continue;
    const same = parseSeedUnit(code, ctx.grainsPerDose);
    const own = parseSeedUnit(articleUnit, ctx.grainsPerDose);
    // Une seule fois chaque unité (« Kilogramme » et kilogram sont la même).
    if (same && own && JSON.stringify(same) === JSON.stringify(own)) continue;
    out.push(code);
  }
  return out;
}

/** Équivalences d'une dose de semis, par hectare et par m² (FR-SE-20, 22). */
export interface SeedEquivalents {
  grainsPerM2: number | null;
  grainsPerHa: number | null;
  dosesPerHa: number | null;
  kgPerHa: number | null;
}

/**
 * Équivalents d'une quantité saisie (`unit` stockée : `kilogram_per_hectare`,
 * `grain_per_square_meter`, `dose`…). Une quantité totale se ramène à
 * l'hectare par la surface. Null pour ce qui ne se convertit pas.
 */
export function seedEquivalents(quantity: number, unit: string, ctx: SeedConversionCtx, areaHa: number | null): SeedEquivalents | null {
  const { unit: base, perM2 } = seedRate(unit);
  let perHa: number;
  if (perM2 !== null) perHa = quantity * (10_000 * perM2);
  else if (areaHa && areaHa > 0) perHa = quantity / areaHa;
  else return null;
  if (!parseSeedUnit(base, ctx.grainsPerDose)) return null;
  const grainsPerHa = convertSeedQuantity(perHa, base, "grain", ctx);
  const kgPerHa = convertSeedQuantity(perHa, base, "kilogram", ctx);
  const dosesPerHa = ctx.grainsPerDose ? convertSeedQuantity(perHa, base, "dose", ctx) : null;
  return { grainsPerM2: grainsPerHa === null ? null : grainsPerHa / 10_000, grainsPerHa, dosesPerHa, kgPerHa };
}
