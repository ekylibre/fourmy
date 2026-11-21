import { getProcedure, unitLabel, type InputNeedLine, type ItkArticleInfo, type ItkContent, type ItkInputsContext } from "@fourmy/contracts";
import { convertQuantity } from "../fertilization/units.js";
import { convertSeedQuantity, seedRate } from "../seeds/units.js";
import { scheduleSteps } from "./schedule.js";

/**
 * Besoins en intrants de l'assolement (lot IT5, claudedocs/conception_assolement_itk.md
 * §9) : dose × surface × part × passages, dans l'unité du stock ; plan de
 * fumure établi prioritaire sur la fertilisation minérale de l'ITK ;
 * comparaison au stock disponible moins ce que réservent déjà les
 * interventions prévues saisies à la main. Rien d'inconvertible n'est compté
 * pour zéro (I4) : la quantité reste dans l'unité de la dose, signalée.
 */

export interface NeedsItem {
  parcelKey: string;
  areaM2: number;
  itineraryId: string | null;
  sowingOn: string | null;
  harvestOn: string | null;
  year: number;
}

/** Procédures de fertilisation minérale que remplace un plan de fumure établi (l'organique reste celle de l'ITK). */
const isMineralFertilization = (procedure: string) => getProcedure(procedure).shape === "fertilization" && procedure !== "organic_fertilizing" && procedure !== "vine_soil_fertilizing";

/** Quantité totale d'une dose sur `ha`, dans l'unité du stock de l'article ; null si elle ne s'y convertit pas. */
export function doseToStock(dose: number, unit: string, ha: number, article: ItkArticleInfo): number | null {
  if (article.kind === "seed") {
    const rate = seedRate(unit);
    if (rate.perM2 === null) return null;
    const total = (dose * ha * 10_000) * rate.perM2; // perM2 = 1/10 000 pour une dose à l'hectare
    return convertSeedQuantity(total, rate.unit, article.unit, { tgwG: article.tgwG, grainsPerDose: article.grainsPerDose });
  }
  const m = /^(.+)_per_hectare$/.exec(unit);
  if (!m) return null;
  return convertQuantity(dose * ha, m[1]!, article.unit, article.density);
}

/** Quantité de produit d'un apport d'azote total (kg N/ha × ha), dans l'unité du stock ; null sans teneur. */
export function nitrogenToStock(nKg: number, article: ItkArticleInfo): number | null {
  const f = article.fertilizer;
  if (!f || !(f.nTotal > 0)) return null;
  if (f.basis === "mass_percent") return convertQuantity((nKg * 100) / f.nTotal, "kilogram", article.unit, f.density ?? article.density);
  if (f.basis === "kg_per_t") return convertQuantity((nKg / f.nTotal) * 1000, "kilogram", article.unit, f.density ?? article.density);
  return convertQuantity((nKg / f.nTotal) * 1000, "liter", article.unit, f.density ?? article.density);
}

/** Quantité brute d'une dose sur `ha`, dans l'unité de la dose sans « par surface » (grains/m² → grains). */
function rawOf(dose: number, unit: string, ha: number): { quantity: number; unit: string } {
  const m2 = /^(.+)_per_square_meter$/.exec(unit);
  if (m2) return { quantity: dose * ha * 10_000, unit: unitLabel(m2[1]!) };
  const m = /^(.+)_per_hectare$/.exec(unit);
  return { quantity: dose * ha, unit: unitLabel(m ? m[1]! : unit) };
}

export function inputNeeds(items: readonly NeedsItem[], itineraries: Record<string, { content: Pick<ItkContent, "steps"> }>, ctx: ItkInputsContext): InputNeedLine[] {
  const lines = new Map<string, InputNeedLine>();
  const line = (key: string, init: () => InputNeedLine) => {
    let l = lines.get(key);
    if (!l) {
      l = init();
      lines.set(key, l);
    }
    return l;
  };
  const addArticle = (articleId: string, label: string, quantity: number | null, rawQuantity: number, rawUnit: string, optional: boolean, source: "itk" | "plan", kind: InputNeedLine["kind"]) => {
    const article = ctx.articles[articleId];
    if (article && quantity !== null) {
      const l = line(`a:${articleId}`, () => ({ articleId, label: article.name, kind: article.kind, unit: article.unit, needed: 0, optional: 0, stock: ctx.stock[articleId] ?? 0, reserved: ctx.reserved[articleId] ?? 0, toBuy: 0, sources: [], unconvertible: false }));
      if (optional) l.optional += quantity;
      else l.needed += quantity;
      if (!l.sources.includes(source)) l.sources.push(source);
      return;
    }
    // Inconvertible : gardé dans l'unité de la dose, sans comparaison au stock.
    const name = article?.name ?? label;
    const l = line(`u:${articleId}:${rawUnit}`, () => ({ articleId, label: name, kind: article?.kind ?? kind, unit: rawUnit, needed: 0, optional: 0, stock: null, reserved: null, toBuy: null, sources: [], unconvertible: true }));
    if (optional) l.optional += rawQuantity;
    else l.needed += rawQuantity;
    if (!l.sources.includes(source)) l.sources.push(source);
  };

  for (const item of items) {
    const ha = item.areaM2 / 10_000;
    const plan = item.parcelKey.startsWith("p:") ? ctx.plans[item.parcelKey] : undefined;
    const itk = item.itineraryId ? itineraries[item.itineraryId] : undefined;
    if (itk) {
      for (const { step, occurrences } of scheduleSteps(itk.content, { sowingOn: item.sowingOn, harvestOn: item.harvestOn, year: item.year })) {
        const replaced = !!plan && isMineralFertilization(step.procedure);
        const area = ha * step.share * occurrences.length;
        for (const input of step.inputs) {
          if (replaced && input.kind === "fertilizer") continue;
          const { quantity: raw, unit: rawUnit } = rawOf(input.dose, input.unit, area);
          if (input.articleId) {
            const article = ctx.articles[input.articleId];
            addArticle(input.articleId, input.label, article ? doseToStock(input.dose, input.unit, area, article) : null, raw, rawUnit, step.optional, "itk", input.kind);
          } else {
            const l = line(`g:${input.label}|${input.unit}`, () => ({ articleId: null, label: input.label, kind: input.kind, unit: rawUnit, needed: 0, optional: 0, stock: null, reserved: null, toBuy: null, sources: [], unconvertible: false }));
            if (step.optional) l.optional += raw;
            else l.needed += raw;
            if (!l.sources.includes("itk")) l.sources.push("itk");
          }
        }
      }
    }
    if (plan) {
      for (const a of plan.applications) {
        const nKg = a.nTotalKgHa * ha;
        if (a.articleId) {
          const article = ctx.articles[a.articleId];
          addArticle(a.articleId, `Apport ${a.stage}`, article ? nitrogenToStock(nKg, article) : null, nKg, "kg N", false, "plan", "fertilizer");
        } else {
          const l = line("g:plan-n", () => ({ articleId: null, label: "Azote du plan de fumure (engrais à choisir)", kind: "fertilizer", unit: "kg N", needed: 0, optional: 0, stock: null, reserved: null, toBuy: null, sources: ["plan"], unconvertible: false }));
          l.needed += nKg;
        }
      }
    }
  }

  const round = (n: number) => Math.round(n * 1000) / 1000;
  const KIND_ORDER = ["seed", "fertilizer", "phyto", "other"];
  return [...lines.values()]
    .map((l) => {
      const needed = round(l.needed);
      const toBuy = l.stock === null || l.reserved === null ? null : round(Math.max(0, needed - Math.max(0, l.stock - l.reserved)));
      return { ...l, needed, optional: round(l.optional), toBuy };
    })
    .sort((a, b) => (KIND_ORDER.indexOf(a.kind) + 10) % 10 - (KIND_ORDER.indexOf(b.kind) + 10) % 10 || a.label.localeCompare(b.label, "fr"));
}
