import { useQuery } from "@tanstack/react-query";
import { COMPOSITION_ORIGIN_LABELS, type FertilizerArticle, type FertilizerComposition } from "@fourmy/contracts";
import { effectiveComposition, nitrogenOfInput, type NitrogenMissing } from "@fourmy/domain";
import { api, farmPath } from "../../app/api";

/** Fertilisation azotée côté web (lot AE, docs/fertilisation-design.md). */

export function useFertilizers(farmId: string, enabled = true) {
  return useQuery({
    queryKey: ["fertilizers", farmId],
    enabled,
    queryFn: () => api.get<{ items: FertilizerArticle[] }>(farmPath(farmId, "/fertilizers")),
    select: (r) => new Map(r.items.map((f) => [f.id, f])),
    staleTime: 5 * 60_000,
  });
}

/** Première lettre en minuscule ; une origine inconnue de l'interface ne fait pas planter la fiche. */
const lowerFirst = (s: string | undefined) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "origine inconnue");

const MISSING: Record<NitrogenMissing, string> = {
  composition: "teneur en azote inconnue",
  unit: "unité de la dose non convertible",
  density: "densité du produit inconnue",
  area: "surface traitée inconnue",
};

export type NitrogenNote =
  | { ok: true; totalKgHa: number; efficientKgHa: number | null; origin: string; proposed: boolean }
  | { ok: false; reason: string };

/** Azote apporté par un intrant, avec l'origine de la teneur ; null si l'article n'est pas un fertilisant. */
export function nitrogenNote(
  fert: FertilizerArticle | undefined,
  q: { quantity: number; per: "hectare" | "total"; unit: string },
  areaHa: number | null,
  on: string,
): NitrogenNote | null {
  if (!fert) return null;
  const eff = effectiveComposition(fert, on);
  if (!eff) return fert.kind === "fertilizer" ? { ok: false, reason: MISSING.composition } : null;
  const r = nitrogenOfInput({ ...q, areaHa, composition: eff.composition });
  if ("missing" in r) return { ok: false, reason: MISSING[r.missing] };
  const origin =
    eff.from === "analysis" ? "analyse" : eff.from === "proposal" ? "teneur proposée, à confirmer" : lowerFirst(COMPOSITION_ORIGIN_LABELS[fert.origin ?? "confirmed"]);
  return { ok: true, totalKgHa: r.totalKgHa, efficientKgHa: r.efficientKgHa, origin, proposed: eff.from === "proposal" };
}

const fmt = (v: number | null) => (v === null ? "—" : v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }));

/** « 9,5-15-30 », « 46 % N », « 390 kg N/m³ ». */
export function compositionLabel(c: FertilizerComposition): string {
  const unit = c.basis === "mass_percent" ? "%" : c.basis === "kg_per_t" ? "kg/t" : "kg/m³";
  if (c.basis === "mass_percent" && (c.p2o5 !== null || c.k2o !== null)) return `${fmt(c.nTotal)}-${fmt(c.p2o5 ?? 0)}-${fmt(c.k2o ?? 0)}`;
  return `${fmt(c.nTotal)} ${unit === "%" ? "% N" : `kg N/${unit.split("/")[1]}`}`;
}

export const kgN = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kg N/ha`;
