import { TGW_ORIGIN_LABELS, unitLabel, type SeedListItem } from "@fourmy/contracts";
import { parseSeedUnit } from "@fourmy/domain";

export const ORGANIC_LABELS: Record<NonNullable<SeedListItem["organicStatus"]>, string> = {
  organic: "Bio",
  conversion: "En conversion",
  conventional: "Non bio",
};

/** « doses de 50 000 grains », « kg », « milliers de grains ». */
export function stockUnitLabel(s: Pick<SeedListItem, "unit" | "unitDim" | "sheet">): string {
  const u = parseSeedUnit(s.unit, s.sheet?.grainsPerDose ?? null);
  if (u?.dim === "dose") return u.grains ? `doses de ${u.grains.toLocaleString("fr-FR")} grains` : "doses";
  if (u?.dim === "grain") return u.grains === 1 ? "grains" : u.grains === 1000 ? "milliers de grains" : `lots de ${u.grains.toLocaleString("fr-FR")} grains`;
  if (u?.dim === "mass") return u.kg === 1 ? "kg" : unitLabel(s.unit);
  return s.unit;
}

const fmt = (v: number, digits = 1) => v.toLocaleString("fr-FR", { maximumFractionDigits: digits });

/** PMG retenu : « 300 g (étiquette) », « 320 g, repère Arvalis ». */
export function tgwLabel(s: SeedListItem): string | null {
  if (!s.tgw) return null;
  if (s.tgw.from === "reference") return `${fmt(s.tgw.tgwG)} g, repère ${s.reference?.org ?? ""}`.trim();
  return `${fmt(s.tgw.tgwG)} g (${TGW_ORIGIN_LABELS[s.tgw.origin].toLowerCase()})`;
}

export { fmt };
