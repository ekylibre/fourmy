import type { FertilizerComposition } from "@fourmy/contracts";
import { unitScale } from "./units.js";

/**
 * Azote apporté par un intrant (FR-FERT-20) : dose ramenée à l'hectare, en
 * masse ou en volume de produit, multipliée par la teneur. L'azote efficace
 * des organiques (× Keq) dépend du référentiel régional (lot AG) : il n'est
 * donné ici que pour les engrais minéraux (type III), où il vaut l'azote total.
 */

export type NitrogenMissing = "composition" | "unit" | "density" | "area";

export interface NitrogenOfInput {
  /** Produit apporté par hectare. */
  productPerHa: { kg: number | null; l: number | null };
  totalKgHa: number;
  mineralKgHa: number | null;
  /** Azote efficace : connu pour un engrais minéral seulement à ce stade. */
  efficientKgHa: number | null;
  p2o5KgHa: number | null;
  k2oKgHa: number | null;
}

export function nitrogenOfInput(input: {
  quantity: number;
  /** « hectare » : dose par ha ; « total » : quantité sur la surface travaillée. */
  per: "hectare" | "total";
  unit: string;
  areaHa: number | null;
  composition: FertilizerComposition | null;
}): NitrogenOfInput | { missing: NitrogenMissing } {
  const c = input.composition;
  if (!c) return { missing: "composition" };
  const scale = unitScale(input.unit);
  if (!scale) return { missing: "unit" };
  let perHa = input.quantity * scale.factor;
  if (input.per === "total") {
    if (!input.areaHa || input.areaHa <= 0) return { missing: "area" };
    perHa /= input.areaHa;
  }
  // Masse et volume de produit par hectare, la densité faisant le lien.
  const kg = scale.dim === "mass" ? perHa : c.density ? perHa * c.density : null;
  const l = scale.dim === "volume" ? perHa : c.density ? perHa / c.density : null;
  const contentOf = (v: number | null): number | null | "density" => {
    if (v === null) return null;
    if (c.basis === "mass_percent") return kg === null ? "density" : (kg * v) / 100;
    if (c.basis === "kg_per_t") return kg === null ? "density" : (kg / 1000) * v;
    return l === null ? "density" : (l / 1000) * v;
  };
  const n = contentOf(c.nTotal);
  if (n === "density" || n === null) return { missing: "density" };
  const p = contentOf(c.p2o5);
  const k = contentOf(c.k2o);
  const mineralShare = c.nitrateType === "III" ? 1 : c.nMineralShare;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    productPerHa: { kg: kg === null ? null : round(kg), l: l === null ? null : round(l) },
    totalKgHa: round(n),
    mineralKgHa: mineralShare === null ? null : round(n * mineralShare),
    efficientKgHa: c.nitrateType === "III" ? round(n) : null,
    p2o5KgHa: p === null || p === "density" ? null : round(p),
    k2oKgHa: k === null || k === "density" ? null : round(k),
  };
}

/**
 * Composition à retenir à une date : la dernière analyse de moins de 5 ans
 * d'un produit organique prime sur la composition enregistrée (FR-FERT-7),
 * puis la composition enregistrée, puis la proposition de Fourmy.
 */
export function effectiveComposition(
  article: {
    composition: FertilizerComposition | null;
    proposal: FertilizerComposition | null;
    analyses: { sampledOn: string; basis: "kg_per_t" | "kg_per_m3"; nTotal: number; nNh4: number | null }[];
  },
  on: string,
  validYears = 5,
): { composition: FertilizerComposition; from: "analysis" | "stored" | "proposal" } | null {
  const limit = `${Number(on.slice(0, 4)) - validYears}${on.slice(4, 10)}`;
  const analysis = [...article.analyses]
    .filter((a) => a.sampledOn <= on.slice(0, 10) && a.sampledOn > limit)
    .sort((a, b) => b.sampledOn.localeCompare(a.sampledOn))[0];
  const base = article.composition ?? article.proposal;
  if (analysis) {
    return {
      from: "analysis",
      composition: {
        basis: analysis.basis,
        nTotal: analysis.nTotal,
        nMineralShare: analysis.nNh4 !== null && analysis.nTotal > 0 ? Math.min(1, analysis.nNh4 / analysis.nTotal) : (base?.nMineralShare ?? null),
        p2o5: null,
        k2o: null,
        so3: null,
        density: base?.density ?? null,
        nitrateType: base?.nitrateType ?? null,
        foliar: false,
      },
    };
  }
  if (article.composition) return { composition: article.composition, from: "stored" };
  if (article.proposal) return { composition: article.proposal, from: "proposal" };
  return null;
}
