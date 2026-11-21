import {
  getProcedure,
  priceKey,
  type ActivityMargin,
  type CropPlanForecast,
  type CropPlanMargins,
  type EcoContext,
  type ItkContent,
  type ItkInputsContext,
  type ItkWorkContext,
  type MarginFigures,
  type MarginMissing,
  type MarginPost,
  type Price,
  type PriceKind,
  type RealizedFacts,
} from "@fourmy/contracts";
import { inputNeeds } from "../itk/needs.js";
import { toStockQuantity } from "../quantities.js";
import { scheduleSteps } from "../itk/schedule.js";
import { resolveWorkRate, stepStaffing } from "../itk/workload.js";
import { convertPrice, priceAt } from "./prices.js";

/**
 * Marges prévues de l'assolement (temps 3, lot E4, claudedocs/conception_assolement_eco.md
 * §3.3 et §3.4) : produit (rendement × prix), charges opérationnelles (besoins
 * en intrants × prix), mécanisation (passages × prix du matériel, barème BCMA
 * ou prestation), main-d'œuvre (heures × coût horaire), marges brute et
 * directe. Les quantités sont celles du temps 2 (principe E4) ; un prix ou un
 * rendement inconnu rend le poste incomplet et figure dans `missing` (E3).
 */

export interface MarginItem {
  id: string;
  parcelKey: string;
  /** Parcelle de base du trajet (clé `p:`) ; null sans trajet. */
  routeKey: string | null;
  areaM2: number;
  activityId: string;
  itineraryId: string | null;
  sowingOn: string | null;
  harvestOn: string | null;
  year: number;
  forecasts?: CropPlanForecast[];
}

export interface MarginsContext {
  work: ItkWorkContext;
  inputs: ItkInputsContext;
  eco: EcoContext;
  /** Prix de la ferme (historique ou en vigueur) ; ceux en vigueur à `day` sont retenus. */
  prices: readonly Price[];
  day: string;
}

/** Productions de référence sans produit vendu (jachère) : ni rendement ni prix attendus. */
const NO_PRODUCT = new Set(["fallow"]);

const zero = (): MarginFigures => ({ product: 0, operational: 0, grossMargin: 0, mechanisation: 0, labour: 0, directMargin: 0 });
const finish = (f: MarginFigures): MarginFigures => {
  const r = (n: number) => Math.round(n * 100) / 100;
  const grossMargin = f.product - f.operational;
  return { product: r(f.product), operational: r(f.operational), grossMargin: r(grossMargin), mechanisation: r(f.mechanisation), labour: r(f.labour), directMargin: r(grossMargin - f.mechanisation - f.labour) };
};
const perHa = (f: MarginFigures, ha: number): MarginFigures =>
  ha > 0 ? finish({ product: f.product / ha, operational: f.operational / ha, grossMargin: 0, mechanisation: f.mechanisation / ha, labour: f.labour / ha, directMargin: 0 }) : zero();

const key = (kind: PriceKind, ref: Partial<Pick<Price, "articleId" | "equipmentId" | "activityId" | "product" | "procedure">>) =>
  priceKey({ kind, articleId: null, equipmentId: null, activityId: null, product: null, procedure: null, ...ref });

export function cropPlanMargins(items: readonly MarginItem[], ctx: MarginsContext): CropPlanMargins {
  const price = (kind: PriceKind, ref: Parameters<typeof key>[1]) => priceAt(ctx.prices, key(kind, ref), ctx.day);
  const eco = new Map(ctx.eco.activities.map((a) => [a.activityId, a]));
  const labourRate = price("labour", {}) ?? ctx.eco.labour;
  const byActivity = new Map<string, { figures: MarginFigures; areaHa: number; incomplete: Set<MarginPost>; withoutItinerary: number }>();
  const missing = new Map<string, MarginMissing>();
  // Hectares d'un manque comptés une fois par culture (pas une fois par passage).
  let counted = new Set<string>();
  const miss = (post: MarginPost, label: string, tab: PriceKind | null, areaHa: number, activity: { incomplete: Set<MarginPost> }) => {
    activity.incomplete.add(post);
    const k = `${post}|${label}`;
    const m = missing.get(k) ?? { post, label, tab, areaHa: 0 };
    if (!counted.has(k)) m.areaHa += areaHa;
    counted.add(k);
    missing.set(k, m);
  };
  const equipmentName = new Map(ctx.work.equipments.map((e) => [e.id, e]));

  for (const item of items) {
    counted = new Set<string>();
    const ha = item.areaM2 / 10_000;
    const a = byActivity.get(item.activityId) ?? { figures: zero(), areaHa: 0, incomplete: new Set<MarginPost>(), withoutItinerary: 0 };
    byActivity.set(item.activityId, a);
    a.areaHa += ha;
    const ref = eco.get(item.activityId);

    // Produit : prévision saisie, sinon défaut (rendement de la ferme ou Agreste, prix de la ferme ou de marché).
    const f = item.forecasts?.find((x) => x.product === "principal") ?? item.forecasts?.[0];
    const yieldValue = f?.yield ?? ref?.yield?.value ?? null;
    const yieldUnit = f?.yield !== undefined ? f.unit : (ref?.yield?.unit ?? "quintal_per_hectare");
    const priceValue = f?.price ?? ref?.price?.value ?? null;
    const priceUnit = f?.price !== undefined ? (f.priceUnit ?? "ton") : (ref?.price?.unit ?? "ton");
    if (!f && ref?.production && NO_PRODUCT.has(ref.production)) {
      // Jachère : pas de produit.
    } else if (yieldValue === null) miss("product", "Rendement prévu", null, ha, a);
    else if (priceValue === null) miss("product", "Prix de vente", "product", ha, a);
    else {
      const base = yieldUnit.replace(/_per_hectare$/, "");
      const unitPrice = convertPrice(priceValue, priceUnit, base);
      if (unitPrice === null) miss("product", `Prix de vente (unité ${priceUnit} pour un rendement en ${yieldUnit})`, "product", ha, a);
      else a.figures.product += yieldValue * ha * unitPrice;
    }

    const itk = item.itineraryId ? ctx.work.itineraries[item.itineraryId] : undefined;
    if (!itk) {
      a.withoutItinerary++;
      continue;
    }

    // Charges opérationnelles : besoins en intrants de la culture (étapes « si besoin » non comptées).
    const needs = inputNeeds(
      [{ parcelKey: item.parcelKey, areaM2: item.areaM2, itineraryId: item.itineraryId, sowingOn: item.sowingOn, harvestOn: item.harvestOn, year: item.year }],
      ctx.work.itineraries,
      ctx.inputs,
    );
    for (const line of needs) {
      if (!(line.needed > 0)) continue;
      const article = line.articleId ? ctx.inputs.articles[line.articleId] : undefined;
      if (!line.articleId || !article || line.unconvertible) {
        miss("operational", line.articleId ? `${line.label} (dose non convertible)` : `${line.label} (intrant à choisir)`, null, ha, a);
        continue;
      }
      const p = price("article", { articleId: line.articleId });
      const unitPrice = p ? convertPrice(p.amount, p.unit, line.unit, { density: article.density, seed: article.kind === "seed" ? { tgwG: article.tgwG, grainsPerDose: article.grainsPerDose } : undefined }) : null;
      if (unitPrice === null) miss("operational", `Prix de ${line.label}`, "article", ha, a);
      else a.figures.operational += line.needed * unitPrice;
    }

    // Mécanisation et main-d'œuvre : passage par passage, comme le temps de travaux (lot IT4).
    const route = item.routeKey ? ctx.work.routes[item.routeKey] : undefined;
    for (const { step, occurrences } of scheduleSteps(itk.content as ItkContent, { sowingOn: item.sowingOn, harvestOn: item.harvestOn, year: item.year })) {
      if (step.optional) continue;
      const rate = resolveWorkRate(step, ctx.work);
      const staff = stepStaffing(step, ctx.work);
      const stepHa = ha * step.share;
      const procedureLabel = getProcedure(step.procedure).label;
      for (const _ of occurrences) {
        void _;
        const field = rate ? stepHa / rate.haH : null;
        const days = field !== null ? Math.max(1, Math.ceil(field / ctx.work.settings.workdayHours)) : 0;
        const hours = field !== null ? field + (route ? (2 * days * route.durationS) / 3600 : 0) : null;
        // Coût d'un matériel ou d'un type du barème : prix propre, sinon barème (à l'hectare ou à l'heure).
        const cost = (own: Price | null, rateId: string | null | undefined) => {
          if (own) {
            if (own.unit === "hectare") return own.amount * stepHa;
            if (own.unit === "hour") return hours === null ? null : own.amount * hours;
            return null;
          }
          const r = rateId ? ctx.work.machineryRates[rateId] : undefined;
          if (r?.costPerUnit !== undefined && r.unit === "hectares") return r.costPerUnit * stepHa;
          if (r?.costPerHour !== undefined && hours !== null) return r.costPerHour * hours;
          return null;
        };
        const service = price("service", { procedure: step.procedure });
        if (staff.equipmentIds.length) {
          for (const id of staff.equipmentIds) {
            const e = equipmentName.get(id);
            const c = cost(price("equipment", { equipmentId: id }), e?.machineryRateId);
            if (c === null) miss("mechanisation", hours === null && e?.machineryRateId ? `Débit de chantier : ${e?.name ?? "matériel"}` : `Coût de ${e?.name ?? "matériel"} (prix ou barème)`, "equipment", stepHa, a);
            else a.figures.mechanisation += c;
          }
        } else if (step.staffing.machineryRateId) {
          const c = cost(null, step.staffing.machineryRateId);
          if (c === null) miss("mechanisation", `Coût du type de matériel : ${procedureLabel}`, null, stepHa, a);
          else a.figures.mechanisation += c;
        } else if (service) {
          const c = service.unit === "hectare" ? service.amount * stepHa : service.unit === "hour" && hours !== null ? service.amount * hours : null;
          if (c === null) miss("mechanisation", `Prestation ${procedureLabel} (unité)`, "service", stepHa, a);
          else a.figures.mechanisation += c;
        } else miss("mechanisation", `Matériel ou prestation : ${procedureLabel}`, "service", stepHa, a);

        // Main-d'œuvre : heures × personnes ; pas de main-d'œuvre propre pour une prestation sans matériel de la ferme.
        if (!staff.equipmentIds.length && !step.staffing.machineryRateId && service) continue;
        const people = staff.personIds.length || (step.staffing.people ?? 1);
        if (!people) continue;
        if (hours === null) miss("labour", "Débit de chantier inconnu", null, stepHa, a);
        else if (!labourRate) miss("labour", "Coût horaire de la main-d'œuvre", "labour", stepHa, a);
        else if (labourRate.unit !== "hour") miss("labour", "Coût de la main-d'œuvre à l'heure", "labour", stepHa, a);
        else a.figures.labour += hours * people * labourRate.amount;
      }
    }
  }

  const activities: ActivityMargin[] = [...byActivity.entries()]
    .map(([activityId, a]) => {
      const f = finish(a.figures);
      return { activityId, areaHa: Math.round(a.areaHa * 100) / 100, ...f, perHa: perHa(f, a.areaHa), incomplete: [...a.incomplete], withoutItinerary: a.withoutItinerary };
    })
    .sort((x, y) => y.areaHa - x.areaHa);
  const sum = zero();
  let areaHa = 0;
  for (const [, a] of byActivity) {
    areaHa += a.areaHa;
    for (const k of ["product", "operational", "mechanisation", "labour"] as const) sum[k] += a.figures[k];
  }
  const total = finish(sum);
  return {
    activities,
    total: { ...total, areaHa: Math.round(areaHa * 100) / 100, perHa: perHa(total, areaHa) },
    missing: [...missing.values()].map((m) => ({ ...m, areaHa: Math.round(m.areaHa * 100) / 100 })).sort((x, y) => y.areaHa - x.areaHa),
  };
}

/**
 * Marges réalisées d'une campagne (lot E5, réalisé simplifié) : produit des
 * récoltes enregistrées, intrants des interventions réalisées, mécanisation
 * et main-d'œuvre sur leurs heures (ou leur surface), aux prix en vigueur le
 * jour de chaque intervention ; prix de vente de la ferme à la fin de la
 * campagne, sinon le prix par défaut du contexte économique. Mêmes manques
 * que les marges prévues.
 */
export function realizedMargins(
  facts: RealizedFacts,
  ctx: { work: Pick<ItkWorkContext, "equipments" | "machineryRates">; eco: EcoContext; prices: readonly Price[] },
): CropPlanMargins {
  const price = (kind: PriceKind, ref: Parameters<typeof key>[1], day: string) => priceAt(ctx.prices, key(kind, ref), day);
  const eco = new Map(ctx.eco.activities.map((a) => [a.activityId, a]));
  const equipments = new Map(ctx.work.equipments.map((e) => [e.id, e]));
  const byActivity = new Map<string, { figures: MarginFigures; areaHa: number; incomplete: Set<MarginPost> }>();
  const missing = new Map<string, MarginMissing>();
  const counted = new Set<string>();
  const activityOf = (id: string) => {
    const a = byActivity.get(id) ?? { figures: zero(), areaHa: 0, incomplete: new Set<MarginPost>() };
    byActivity.set(id, a);
    return a;
  };
  /** Manque d'une culture : hectares comptés une fois par culture et par libellé. */
  const miss = (post: MarginPost, label: string, tab: PriceKind | null, productionId: string, areaHa: number, a: { incomplete: Set<MarginPost> }) => {
    a.incomplete.add(post);
    const k = `${post}|${label}`;
    const m = missing.get(k) ?? { post, label, tab, areaHa: 0 };
    if (!counted.has(`${k}|${productionId}`)) m.areaHa += areaHa;
    counted.add(`${k}|${productionId}`);
    missing.set(k, m);
  };
  const end = `${facts.year}-12-31`;
  const areaOf = new Map(facts.productions.map((p) => [p.productionId, p.areaHa]));

  for (const p of facts.productions) {
    const a = activityOf(p.activityId);
    a.areaHa += p.areaHa;
    const production = eco.get(p.activityId)?.production;
    if (p.yieldQHa === null && production && NO_PRODUCT.has(production)) continue;
    if (p.yieldQHa === null) {
      miss("product", "Récolte non enregistrée", null, p.productionId, p.areaHa, a);
      continue;
    }
    const farm = price("product", { activityId: p.activityId, product: "principal" }, end);
    const ref = farm ? { value: farm.amount, unit: farm.unit } : eco.get(p.activityId)?.price;
    const unitPrice = ref ? convertPrice(ref.value, ref.unit, "quintal") : null;
    if (unitPrice === null) miss("product", "Prix de vente", "product", p.productionId, p.areaHa, a);
    else a.figures.product += p.yieldQHa * p.areaHa * unitPrice;
  }

  for (const w of facts.works) {
    const a = activityOf(w.activityId);
    const ha = areaOf.get(w.productionId) ?? w.areaHa;
    for (const i of w.inputs) {
      const article = facts.articles[i.articleId];
      if (!article) continue;
      let quantity: number | null;
      try {
        quantity = toStockQuantity({
          quantity: i.quantity,
          unit: i.unit,
          articleUnit: article.unit,
          areaHa: w.areaHa,
          density: article.density,
          ...(article.kind === "seed" ? { seed: { tgwG: article.tgwG, grainsPerDose: article.grainsPerDose } } : {}),
        });
      } catch {
        quantity = null;
      }
      if (quantity === null) {
        miss("operational", `${article.name} (quantité non convertible)`, null, w.productionId, ha, a);
        continue;
      }
      const p = price("article", { articleId: i.articleId }, w.day);
      const unitPrice = p ? convertPrice(p.amount, p.unit, article.unit, { density: article.density, seed: article.kind === "seed" ? { tgwG: article.tgwG, grainsPerDose: article.grainsPerDose } : undefined }) : null;
      if (unitPrice === null) miss("operational", `Prix de ${article.name}`, "article", w.productionId, ha, a);
      else a.figures.operational += quantity * unitPrice;
    }
    const procedureLabel = getProcedure(w.procedure).label;
    for (const id of w.equipmentIds) {
      const e = equipments.get(id);
      const own = price("equipment", { equipmentId: id }, w.day);
      const r = e?.machineryRateId ? ctx.work.machineryRates[e.machineryRateId] : undefined;
      let cost: number | null = null;
      if (own) cost = own.unit === "hectare" ? own.amount * w.areaHa : own.unit === "hour" && w.hours !== null ? own.amount * w.hours : null;
      else if (r?.costPerUnit !== undefined && r.unit === "hectares") cost = r.costPerUnit * w.areaHa;
      else if (r?.costPerHour !== undefined && w.hours !== null) cost = r.costPerHour * w.hours;
      if (cost !== null) a.figures.mechanisation += cost;
      else if ((own?.unit === "hour" || r) && w.hours === null) miss("mechanisation", `Durée des interventions (${procedureLabel})`, null, w.productionId, ha, a);
      else miss("mechanisation", `Coût de ${e?.name ?? "matériel"} (prix ou barème)`, "equipment", w.productionId, ha, a);
    }
    if (w.hours === null) {
      if (w.equipmentIds.length || w.people) miss("labour", `Durée des interventions (${procedureLabel})`, null, w.productionId, ha, a);
      continue;
    }
    const labour = price("labour", {}, w.day) ?? ctx.eco.labour;
    if (!labour || labour.unit !== "hour") miss("labour", "Coût horaire de la main-d'œuvre", "labour", w.productionId, ha, a);
    else a.figures.labour += w.hours * Math.max(1, w.people) * labour.amount;
  }

  const activities: ActivityMargin[] = [...byActivity.entries()]
    .map(([activityId, a]) => {
      const f = finish(a.figures);
      return { activityId, areaHa: Math.round(a.areaHa * 100) / 100, ...f, perHa: perHa(f, a.areaHa), incomplete: [...a.incomplete], withoutItinerary: 0 };
    })
    .sort((x, y) => y.areaHa - x.areaHa);
  const sum = zero();
  let areaHa = 0;
  for (const [, a] of byActivity) {
    areaHa += a.areaHa;
    for (const k of ["product", "operational", "mechanisation", "labour"] as const) sum[k] += a.figures[k];
  }
  const total = finish(sum);
  return {
    activities,
    total: { ...total, areaHa: Math.round(areaHa * 100) / 100, perHa: perHa(total, areaHa) },
    missing: [...missing.values()].map((m) => ({ ...m, areaHa: Math.round(m.areaHa * 100) / 100 })).sort((x, y) => y.areaHa - x.areaHa),
  };
}

