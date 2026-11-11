import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  PLAN_REFERENTIAL,
  PROCEDURES,
  rshTotal,
  type FertilizationPlan,
  type FertilizationPlanSummary,
  type FertilizerArticle,
  type PlanContext,
  type PlanDraft,
  type PlannedApplication,
  type PlanResult,
  type PlanVersion,
  type SoilHorizon,
} from "@fourmy/contracts";
import {
  computeBalance,
  cropGroupOf,
  effectiveComposition,
  isMaizeOrSorghum,
  isStrawCereal,
  nitrogenOfInput,
  splitDose,
  steeringAllowance,
  exportedCoverDefault,
  keqOf,
  keqTotal,
  type KeqApplication,
  SPRING_CROPS,
  yieldTarget as olympicYield,
  type BalanceInput,
} from "@fourmy/domain";
import { isNaSoilType, naYieldReferences, type CropGroup } from "@fourmy/fertilization-refs";
import { BadRequest, NotFound } from "../routes/helpers.js";
import { farmDailyWeather } from "./crop-model.js";
import { listFertilizers } from "./fertilizers.js";
import { coversInTx } from "./cover-crops.js";
import { steeringInTx } from "./steering.js";

/**
 * Plans prévisionnels de fumure (lot AG, docs/fertilisation-design.md §4.2,
 * §9) : un plan par parcelle et par campagne. Fourmy rassemble ce qu'il sait
 * (culture, sol, précédent réalisé, pluie, reliquats, irrigation), y ajoute
 * les saisies du brouillon et calcule la dose (domaine, `computeBalance`).
 * Établir fige une version : données, termes, référentiel et apports prévus.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
const iso = (v: string | Date) => new Date(v).toISOString();
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const HARVEST = PROCEDURES.filter((p) => p.shape === "harvest").map((p) => p.code);
const FERTILIZING = PROCEDURES.filter((p) => p.shape === "fertilization" || p.code === "all_in_one_sowing" || p.code === "vine_spraying_with_fertilizing").map((p) => p.code);
const IRRIGATION = ["watering", "plant_watering", "vine_watering"];
const SOWING = PROCEDURES.filter((p) => p.shape === "sowing").map((p) => p.code);
const arr = (xs: string[]) => `{${xs.join(",")}}`;

const CROP_LABELS: Partial<Record<CropGroup, string>> = {
  maize_grain: "Maïs grain",
  maize_silage: "Maïs fourrage",
  maize_sweet: "Maïs doux",
  maize_seed: "Maïs semence",
  sorghum_grain: "Sorgho grain",
  soft_wheat: "Blé tendre",
  durum_wheat: "Blé dur",
  barley_winter: "Orge d'hiver",
  barley_spring: "Orge de printemps",
  oat: "Avoine",
  rye: "Seigle",
  triticale: "Triticale",
  rapeseed_winter: "Colza",
  sunflower: "Tournesol",
  grassland: "Prairie",
  vine: "Vigne",
  legumes: "Légumineuse",
  other: "Autre culture",
};
export const cropLabel = (g: CropGroup) => CROP_LABELS[g] ?? g;

// --- Données de la ferme --------------------------------------------------------------

interface PlanRow {
  id: string;
  kind: "main" | "cover_exported";
  campaign: number;
  land_parcel_id: string;
  parcel_name: string;
  area_m2: string;
  status: FertilizationPlan["status"];
  current_version: number | null;
  draft: PlanDraft;
  reference: string | null;
  cultivation: string | null;
  species: string | null;
}

const PLAN_SELECT = sql`
  SELECT p.id, p.kind, p.campaign, p.land_parcel_id, lp.name AS parcel_name, p.status, p.current_version, p.draft,
         (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = lp.id
          ORDER BY (v.valid @> make_date(p.campaign, 6, 1)::timestamptz) DESC, upper(v.valid) DESC NULLS FIRST LIMIT 1) AS area_m2,
         a.reference, coalesce(pr.cultivation, a.cultivation) AS cultivation, pr.species
  FROM fertilization_plans p
  JOIN land_parcels lp ON lp.id = p.land_parcel_id
  LEFT JOIN productions pr ON pr.id = p.production_id
  LEFT JOIN activities a ON a.id = pr.activity_id`;

/** Rendement à l'hectare d'une sortie de récolte (q/ha), d'après son unité ; null si non convertible. */
function quintalsPerHa(quantity: number, unit: string | null, areaHa: number | null): number | null {
  if (!unit) return null;
  const perHa = /_per_hectare$/.test(unit);
  const base = unit.replace(/_per_hectare$/, "").toLowerCase();
  const toQ = base === "quintal" ? 1 : base === "ton" || base === "tonne" || base === "t" ? 10 : base === "kilogram" || base === "kg" ? 0.01 : null;
  if (toQ === null) return null;
  if (perHa) return quantity * toQ;
  return areaHa && areaHa > 0 ? (quantity * toQ) / areaHa : null;
}

/** Rendements réalisés (q/ha) par parcelle et par année, sur les interventions de récolte. */
async function harvestYields(tx: Tx, farmId: string, from: number, to: number): Promise<{ parcelId: string; year: number; yieldQHa: number }[]> {
  const list = await rows<{ parcel_id: string; year: number; quantity: string; unit: string | null; area_m2: string | null; worked: string | null }>(
    tx,
    sql`SELECT t.ref_id AS parcel_id, extract(year FROM i.started_at)::int AS year, o.quantity, o.unit,
               (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = t.ref_id AND v.valid @> i.started_at LIMIT 1) AS area_m2,
               t.attrs->>'workedAreaM2' AS worked
        FROM interventions i
        JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel'
        JOIN intervention_parameters o ON o.intervention_id = i.id AND o.role = 'output' AND o.quantity IS NOT NULL
        WHERE i.farm_id = ${farmId} AND i.status = 'done' AND i.procedure = ANY(${arr(HARVEST)}::text[])
          AND extract(year FROM i.started_at) BETWEEN ${from} AND ${to}`,
  );
  const by = new Map<string, number[]>();
  for (const r of list) {
    const areaHa = (num(r.worked) ?? num(r.area_m2) ?? 0) / 10_000;
    const q = quintalsPerHa(Number(r.quantity), r.unit, areaHa || null);
    if (q === null || !(q > 0) || q > 2000) continue;
    const k = `${r.parcel_id}|${r.year}`;
    by.set(k, [...(by.get(k) ?? []), q]);
  }
  return [...by.entries()].map(([k, qs]) => {
    const [parcelId, year] = k.split("|");
    return { parcelId: parcelId!, year: Number(year), yieldQHa: Math.round((qs.reduce((s, q) => s + q, 0) / qs.length) * 10) / 10 };
  });
}

/** Productions de la ferme par campagne avec leur groupe de cultures. */
async function productionsByYear(tx: Tx, farmId: string, from: number, to: number) {
  return rows<{ year: number; parcel_id: string; reference: string | null; cultivation: string | null }>(
    tx,
    sql`SELECT c.year, pr.land_parcel_id AS parcel_id, a.reference, coalesce(pr.cultivation, a.cultivation) AS cultivation
        FROM productions pr JOIN campaigns c ON c.id = pr.campaign_id LEFT JOIN activities a ON a.id = pr.activity_id
        WHERE pr.farm_id = ${farmId} AND c.year BETWEEN ${from} AND ${to}`,
  );
}

/** Précédent : production de la campagne précédente sur la parcelle qui recouvre au moins la moitié de celle-ci. */
export async function previousOf(tx: Tx, farmId: string, parcelId: string, campaign: number) {
  const [r] = await rows<{ parcel_id: string; name: string; reference: string | null; cultivation: string | null; share: number }>(
    tx,
    sql`WITH cur AS (
          SELECT shape FROM land_parcel_versions WHERE land_parcel_id = ${parcelId}
          ORDER BY (valid @> make_date(${campaign}, 6, 1)::timestamptz) DESC, upper(valid) DESC NULLS FIRST LIMIT 1)
        SELECT lp.id AS parcel_id, lp.name, a.reference, coalesce(pr.cultivation, a.cultivation) AS cultivation,
               ST_Area(ST_Intersection(v.shape, cur.shape)::geography) / nullif(ST_Area(cur.shape::geography), 0) AS share
        FROM productions pr
        JOIN campaigns c ON c.id = pr.campaign_id AND c.year = ${campaign - 1}
        JOIN land_parcels lp ON lp.id = pr.land_parcel_id
        JOIN land_parcel_versions v ON v.land_parcel_id = lp.id AND v.valid @> make_date(${campaign - 1}, 6, 1)::timestamptz
        LEFT JOIN activities a ON a.id = pr.activity_id, cur
        WHERE pr.farm_id = ${farmId} AND ST_Intersects(v.shape, cur.shape)
        ORDER BY share DESC NULLS LAST LIMIT 1`,
  );
  return r && r.share >= 0.5 ? r : null;
}

/** Azote minéral apporté (kg N/ha) sur une parcelle entre deux dates, d'après les compositions ; null si un apport est incalculable. */
async function mineralNApplied(
  tx: Tx,
  parcelId: string,
  from: string,
  to: string,
  fertilizers: Map<string, FertilizerArticle>,
): Promise<{ total: number; uncounted: string[]; organics: KeqApplication[] }> {
  const inputs = await rows<{ day: string; article_id: string; quantity: string; unit: string | null; area_m2: string | null; worked: string | null }>(
    tx,
    sql`SELECT i.started_at::date::text AS day, p.ref_id AS article_id, p.quantity, p.unit,
               (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = t.ref_id AND v.valid @> i.started_at LIMIT 1) AS area_m2,
               t.attrs->>'workedAreaM2' AS worked
        FROM interventions i
        JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = ${parcelId}
        JOIN intervention_parameters p ON p.intervention_id = i.id AND p.role = 'input' AND p.ref_type = 'article' AND p.quantity IS NOT NULL
        WHERE i.status = 'done' AND i.procedure = ANY(${arr(FERTILIZING)}::text[]) AND i.started_at >= ${from}::date AND i.started_at < ${to}::date`,
  );
  let total = 0;
  const uncounted = new Set<string>();
  // Produits organiques (types 0 à II) : leur équivalent minéral se lit à l'annexe 5 (lot AO).
  const organics: KeqApplication[] = [];
  for (const r of inputs) {
    const f = fertilizers.get(r.article_id);
    if (!f) continue;
    const eff = effectiveComposition(f, r.day);
    const m = /^(.+)_per_hectare$/.exec(r.unit ?? "");
    const area = (num(r.worked) ?? num(r.area_m2) ?? 0) / 10_000;
    const n = eff ? nitrogenOfInput({ quantity: Number(r.quantity), per: m ? "hectare" : "total", unit: m ? m[1]! : (r.unit ?? ""), areaHa: area || null, composition: eff.composition }) : null;
    if (!n || "missing" in n) {
      if (f.kind === "fertilizer") uncounted.add(`${f.name} (teneur ou dose inconnue)`);
      continue;
    }
    if (eff!.composition.nitrateType === "III" || eff!.composition.nMineralShare === 1) total += n.totalKgHa;
    else if (n.totalKgHa > 0 && eff!.composition.nitrateType) organics.push({ date: r.day, product: f.name, proKey: eff!.composition.proProduct ?? null, nTotalKgHa: n.totalKgHa });
    else if (n.totalKgHa > 0) uncounted.add(`${f.name} (type de fertilisant à préciser)`);
  }
  return { total: Math.round(total), uncounted: [...uncounted], organics };
}

/** Pluie du 1er octobre de l'année précédente à `toMd` (MM-JJ) : observée, puis normales pour les jours à venir. */
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function rainSince(db: Database, farmId: string, campaign: number, toMd: string, fetchImpl: typeof fetch) {
  const from = `${campaign - 1}-10-01`;
  const to = `${campaign}-${toMd}`;
  const weather = await farmDailyWeather(db, farmId, from, fetchImpl);
  if (!weather.until && !weather.normals.size) return null;
  let mm = 0;
  let normalsFrom: string | null = null;
  for (let d = new Date(`${from}T00:00:00Z`); d < new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const known = weather.known.get(day);
    if (known) {
      mm += known.rainMm;
      continue;
    }
    const normal = weather.normals.get(day.slice(5));
    if (!normal) return null;
    normalsFrom ??= day;
    mm += normal.rainMm;
  }
  return { mm: Math.round(mm), from, to, normalsFrom };
}

// --- Contexte et calcul -------------------------------------------------------------------

async function contextOf(
  db: Database,
  farmId: string,
  plan: PlanRow,
  fertilizers: Map<string, FertilizerArticle>,
  fetchImpl: typeof fetch,
  rainMemo: Map<string, ReturnType<typeof rainSince>> = new Map(),
): Promise<{ context: PlanContext; input: BalanceInput }> {
  const crop = cropGroupOf({ reference: plan.reference, cultivation: plan.cultivation });
  const variety = plan.species && plan.species !== plan.cultivation ? plan.species : null;
  const d = plan.draft;
  const gathered = await withFarm(db, farmId, async (tx) => {
    const [soil] = await rows<{ soil_type: string | null; irrigated: boolean | null; depth: number | null; origin: "surface" | "groundwater" | null; nitrate: string | null; wname: string | null; insee: string | null; status: string | null }>(
      tx,
      sql`SELECT ps.soil_type, ps.irrigated, ps.rooting_depth_cm AS depth, w.origin, w.nitrate_mg_l AS nitrate, w.name AS wname, z.insee, z.status
          FROM land_parcels lp
          LEFT JOIN parcel_soils ps ON ps.land_parcel_id = lp.id
          LEFT JOIN water_sources w ON w.id = ps.water_source_id
          LEFT JOIN parcel_nitrate_zones z ON z.land_parcel_id = lp.id
          WHERE lp.id = ${plan.land_parcel_id}`,
    );
    const prev = await previousOf(tx, farmId, plan.land_parcel_id, plan.campaign);
    const yields = await harvestYields(tx, farmId, plan.campaign - 7, plan.campaign - 1);
    const prods = await productionsByYear(tx, farmId, plan.campaign - 7, plan.campaign - 1);
    let prevN: Awaited<ReturnType<typeof mineralNApplied>> | null = null;
    let prevIrrigation: number | null = null;
    if (prev) {
      prevN = await mineralNApplied(tx, prev.parcel_id, `${plan.campaign - 2}-09-01`, `${plan.campaign - 1}-12-31`, fertilizers);
      const [irr] = await rows<{ mm: string | null }>(
        tx,
        sql`SELECT sum((i.irrigation->>'depthMm')::numeric) AS mm FROM interventions i
            JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = ${prev.parcel_id}
            WHERE i.status = 'done' AND i.procedure = ANY(${arr(IRRIGATION)}::text[]) AND extract(year FROM i.started_at) = ${plan.campaign - 1}`,
      );
      prevIrrigation = num(irr?.mm);
    }
    const rsh = await rows<{ sampled_on: string; horizons: SoilHorizon[] }>(
      tx,
      sql`SELECT sampled_on::text, horizons FROM soil_analyses WHERE land_parcel_id = ${plan.land_parcel_id} AND kind = 'rsh'
            AND sampled_on BETWEEN make_date(${plan.campaign - 1}, 11, 1) AND make_date(${plan.campaign}, 6, 30)
          ORDER BY sampled_on DESC LIMIT 1`,
    );
    const cover = (await coversInTx(tx, [plan.land_parcel_id], plan.campaign)).get(plan.land_parcel_id) ?? null;
    const [sown] = await rows<{ day: string }>(
      tx,
      sql`SELECT min(i.started_at)::date::text AS day FROM interventions i
          JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = ${plan.land_parcel_id}
          WHERE i.status = 'done' AND i.procedure = ANY(${arr(SOWING)}::text[]) AND i.started_at >= make_date(${plan.campaign - 1}, 7, 1) AND i.started_at < make_date(${plan.campaign}, 8, 1)`,
    );
    // Maïs : starter réalisé du semis à 30 jours après (azote avant 4 feuilles, recette du 11/11).
    const starterTo = sown?.day ? new Date(Date.parse(`${sown.day}T00:00:00Z`) + 31 * 86_400_000).toISOString().slice(0, 10) : null;
    const starter = sown?.day && starterTo ? { ...(await mineralNApplied(tx, plan.land_parcel_id, sown.day, starterTo, fertilizers)), from: sown.day, to: starterTo } : null;
    // Apports organiques réalisés sur la parcelle depuis l'été qui précède la campagne (lot AO).
    const campaignN = await mineralNApplied(tx, plan.land_parcel_id, `${plan.campaign - 1}-07-01`, `${plan.campaign}-08-01`, fertilizers);
    return { soil, prev, yields, prods, prevN, prevIrrigation, rsh: rsh[0] ?? null, cover, sownOn: sown?.day ?? null, campaignOrganics: campaignN.organics, starter };
  });
  const { soil, prev, prevN } = gathered;
  const department = soil?.insee ? soil.insee.slice(0, 2) : null;
  const irrigated = !!soil?.irrigated;
  const prevCrop = prev ? cropGroupOf({ reference: prev.reference, cultivation: prev.cultivation }) : null;
  const prevYield = prev ? (gathered.yields.find((y) => y.parcelId === prev.parcel_id && y.year === plan.campaign - 1)?.yieldQHa ?? null) : null;

  // Objectif : saisi, sinon moyenne olympique des campagnes de la ferme pour la même culture, sinon référence départementale.
  const sameCrop = new Set(gathered.prods.filter((p) => cropGroupOf(p) === crop).map((p) => `${p.parcel_id}|${p.year}`));
  const byYear = new Map<number, number[]>();
  for (const y of gathered.yields) if (sameCrop.has(`${y.parcelId}|${y.year}`)) byYear.set(y.year, [...(byYear.get(y.year) ?? []), y.yieldQHa]);
  const history = [...byYear.entries()].map(([campaign, ys]) => ({ campaign, yield: Math.round((ys.reduce((s, v) => s + v, 0) / ys.length) * 10) / 10 }));
  const ref = department ? naYieldReferences.rows.find((r) => r.department === department && r.crops.includes(crop) && (r.irrigated === undefined || r.irrigated === irrigated)) : undefined;
  const auto = olympicYield(history, plan.campaign, ref?.yieldQHa ? { value: ref.yieldQHa, source: `référence départementale ${department} (${ref.cropLabel}, statistique agricole annuelle)` } : null);
  const yieldTarget: PlanContext["yieldTarget"] =
    d.yieldTarget != null ? { value: d.yieldTarget, origin: "entered", detail: "saisi" } : "missing" in auto ? null : { value: auto.value, origin: auto.origin, detail: auto.detail };

  const spring = SPRING_CROPS.has(crop);
  // Pluie : lue une fois par campagne et date de fin pour tous les plans d'une même liste.
  const rainKey = `${plan.campaign}|${spring ? "05-01" : "03-01"}`;
  if (!rainMemo.has(rainKey)) rainMemo.set(rainKey, rainSince(db, farmId, plan.campaign, spring ? "05-01" : "03-01", fetchImpl).catch(() => null));
  const rain = await rainMemo.get(rainKey)!;
  const rshKg = gathered.rsh?.horizons?.length ? rshTotal(gathered.rsh.horizons) : null;
  const irrigationMm: PlanContext["irrigationMm"] =
    d.irrigationMm != null
      ? { value: d.irrigationMm, detail: "saisi" }
      : irrigated && gathered.prevIrrigation
        ? { value: gathered.prevIrrigation, detail: `irrigations saisies en ${plan.campaign - 1} sur ${prev?.name}` }
        : null;
  const strawReturned = d.strawReturned ?? null;

  // Ouverture du bilan : saisie, sinon la date du reliquat mesuré, sinon le 1er avril (printemps) ou le 1er février.
  const opening: PlanContext["opening"] = d.openingOn
    ? { on: d.openingOn, origin: "entered" }
    : rshKg !== null
      ? { on: gathered.rsh!.sampled_on, origin: "rsh" }
      : { on: `${plan.campaign}-${spring ? "04-01" : "02-01"}`, origin: "default" };
  const openingMd = opening.on.slice(5, 10);
  const openingClass = openingMd >= "04-01" && openingMd <= "09-30" ? "april" : "end_of_winter";
  const cover = gathered.cover;
  // Équivalent minéral des organiques : réalisés et prévus sur la campagne (Xa, Keq Ri), et du précédent (Keq cycle).
  const planned: KeqApplication[] = (d.organics ?? []).flatMap((o) => {
    const f = fertilizers.get(o.articleId);
    const eff = f ? effectiveComposition(f, o.plannedOn) : null;
    if (!f || !eff) return [];
    const n = nitrogenOfInput({ quantity: o.quantity, per: "hectare", unit: f.unit, areaHa: null, composition: eff.composition });
    return "missing" in n ? [] : [{ date: o.plannedOn, product: f.name, proKey: eff.composition.proProduct ?? null, nTotalKgHa: n.totalKgHa }];
  });
  const organicResults = [
    ...gathered.campaignOrganics.map((a) => ({ ...keqOf(a, crop, opening.on, "campaign"), planned: false })),
    ...planned.map((a) => ({ ...keqOf(a, crop, opening.on, "campaign"), planned: true })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const organicTotal = keqTotal(organicResults);
  const prevOrganics = prevCrop && prevN ? keqTotal(prevN.organics.map((a) => keqOf(a, prevCrop, null, "previous"))) : null;
  const destroyedMonth = cover?.destroyedOn ? Number(cover.destroyedOn.slice(5, 7)) : null;

  const context: PlanContext = {
    department,
    crop,
    cropLabel: cropLabel(crop),
    variety,
    soilType: soil?.soil_type ?? null,
    irrigated,
    previous: prev && prevCrop ? { crop: prevCrop, label: cropLabel(prevCrop), parcelName: prev.name, yieldRealized: prevYield, xMineral: prevN?.total ?? null, strawReturned, uncounted: prevN?.uncounted ?? [] } : null,
    yieldTarget,
    rain,
    rsh: rshKg !== null ? { kgNHa: rshKg, sampledOn: gathered.rsh!.sampled_on } : null,
    water: { origin: soil?.origin ?? null, no3MgL: num(soil?.nitrate), name: soil?.wname ?? null },
    irrigationMm,
    zone: soil?.status ?? null,
    opening,
    sowing: { period: d.sowingPeriod ?? null, sownOn: gathered.sownOn },
    starter: isMaizeOrSorghum(crop) && gathered.starter?.total ? { kgNHa: gathered.starter.total, from: gathered.starter.from, to: addDaysIso(gathered.starter.to, -1) } : null,
    cover,
    organics: organicResults.map((r) => ({
      date: r.date,
      product: r.product,
      planned: r.planned,
      nTotalKgHa: Math.round(r.nTotalKgHa * 10) / 10,
      period: r.period,
      xa: Math.round(r.xa * 10) / 10,
      ri: Math.round(r.ri * 10) / 10,
      keq: r.keq,
      missing: r.missing,
      notRecommended: r.notRecommended,
    })),
  };
  if (context.previous && prevOrganics?.missing.length) context.previous.uncounted.push(...prevOrganics.missing);
  const input: BalanceInput = {
    campaign: plan.campaign,
    department: department ?? "",
    crop,
    variety,
    soilType: soil?.soil_type && isNaSoilType(soil.soil_type) ? soil.soil_type : null,
    irrigated,
    yieldTarget: yieldTarget?.value ?? null,
    rshMeasured: context.rsh,
    tillers: d.tillers ?? null,
    previous: prevCrop
      ? { crop: prevCrop, strawReturned: isStrawCereal(prevCrop) ? strawReturned : null, yieldRealized: prevYield, xMineral: prevN?.total ?? null, xaCycle: prevOrganics?.xa ?? 0 }
      : null,
    xa: organicTotal.missing.length
      ? { missing: `équivalent minéral des produits organiques : ${organicTotal.missing.join(" ; ")}` }
      : organicResults.length
        ? { value: organicTotal.xa, detail: organicTotal.detail }
        : null,
    xaBeforeOpening: organicTotal.ri,
    // Colza (annexe 2.4) : profondeur du sol, précédent pois, pesées et historique organique.
    rootingDepthCm: soil?.depth ?? null,
    previousIsPea: !!prev && /pisum|\bpea\b|_pea|pois/i.test(`${prev.reference ?? ""} ${prev.cultivation ?? ""}`),
    rapeseed: d.rapeseed ?? null,
    opening: openingClass,
    // Repousses : pas de référence MrCi, comptées nulles.
    cover: cover?.family
      ? {
          family: cover.family,
          biomass: cover.biomass,
          destruction: destroyedMonth === null ? null : destroyedMonth >= 8 ? "nov_dec" : "after_january",
        }
      : null,
    rainMm: rain?.mm ?? null,
    valueA: d.valueA ?? null,
    irrigation: irrigated && irrigationMm ? { plannedMm: irrigationMm.value, no3MgL: context.water.no3MgL, origin: context.water.origin } : null,
    nBefore4Leaves: d.nBefore4Leaves ?? (isMaizeOrSorghum(crop) && gathered.starter?.total ? gathered.starter.total : 0),
    nBefore4Source:
      d.nBefore4Leaves == null && isMaizeOrSorghum(crop) && gathered.starter?.total
        ? `apports réalisés du ${gathered.starter.from.slice(8, 10)}/${gathered.starter.from.slice(5, 7)} au ${addDaysIso(gathered.starter.to, -1).slice(8, 10)}/${addDaysIso(gathered.starter.to, -1).slice(5, 7)} (semis + 30 jours)`
        : null,
    unfavourable: d.unfavourable ?? false,
    overrides: d.overrides,
  };
  return { context, input };
}

function resultOf(input: BalanceInput, context: PlanContext): PlanResult {
  const r = computeBalance(input);
  const warnings = [...r.warnings];
  if (!context.department) warnings.unshift("Zonage de la parcelle non déterminé : actualisez-le (Réglementaire → Fertilisation azotée).");
  if (context.previous?.uncounted.length && !context.rsh)
    warnings.push(`Apports du précédent non comptés dans l'estimation du reliquat : ${context.previous.uncounted.join(", ")}. Complétez leur composition (Stocks → Fertilisants) ou mesurez le reliquat.`);
  return { ...r, warnings };
}

async function plansData(db: Database, farmId: string, where: ReturnType<typeof sql>, fetchImpl: typeof fetch) {
  const list = await withFarm(db, farmId, (tx) => rows<PlanRow>(tx, sql`${PLAN_SELECT} WHERE ${where} ORDER BY lp.name`));
  if (!list.length) return [];
  const fertilizers = new Map((await listFertilizers(db, farmId)).map((f) => [f.id, f]));
  const out = [];
  const rainMemo = new Map<string, ReturnType<typeof rainSince>>();
  for (const p of list) {
    const { context, input } = await contextOf(db, farmId, p, fertilizers, fetchImpl, rainMemo);
    out.push(p.kind === "cover_exported" ? { row: p, ...(await coverPlanOf(db, farmId, p, context)) } : { row: p, context, result: resultOf(input, context) });
  }
  return out;
}

/**
 * Plan d'un couvert d'interculture exporté (lot AQ) : le guide du PAR 7 NA
 * demande deux plans séparés sur l'îlot. Dose : celle d'un bilan (outil ou
 * conseiller, saisie comme dose externe), sinon le plafond du tableau 4.
 */
async function coverPlanOf(db: Database, farmId: string, row: PlanRow, main: PlanContext): Promise<{ context: PlanContext; result: PlanResult }> {
  const { cover, zones, nextCrop } = await withFarm(db, farmId, async (tx) => {
    const c = (await coversInTx(tx, [row.land_parcel_id], row.campaign)).get(row.land_parcel_id) ?? null;
    const [z] = await rows<{ zones: string[] | null }>(tx, sql`SELECT zones FROM parcel_nitrate_zones WHERE land_parcel_id = ${row.land_parcel_id}`);
    const [n] = await rows<{ reference: string | null; cultivation: string | null }>(
      tx,
      sql`SELECT a.reference, coalesce(pr.cultivation, a.cultivation) AS cultivation FROM productions pr
          JOIN campaigns c ON c.id = pr.campaign_id AND c.year = ${row.campaign} LEFT JOIN activities a ON a.id = pr.activity_id
          WHERE pr.land_parcel_id = ${row.land_parcel_id} ORDER BY pr.created_at LIMIT 1`,
    );
    return { cover: c, zones: z?.zones ?? [], nextCrop: n ? cropGroupOf(n) : null };
  });
  const context: PlanContext = {
    ...main,
    crop: "cover_crop",
    cropLabel: cover ? `Couvert exporté : ${cover.species}` : "Couvert exporté",
    variety: null,
    previous: null,
    yieldTarget: null,
    organics: main.organics.filter((o) => !cover || (o.date >= cover.sownOn && (!cover.destroyedOn || o.date <= cover.destroyedOn))),
  };
  const base = { annex: "PAR 7 NA, tableau 4", terms: {}, floor30: false, negative: false };
  if (!cover || !cover.exported || cover.kind !== "sown") {
    return {
      context,
      result: { ...base, method: "ceiling", equation: "Couvert exporté", dose: null, ceiling: null, warnings: [], missing: ["couvert exporté : à saisir dans le plan de la culture principale"] },
    };
  }
  const d = exportedCoverDefault({ sownOn: cover.sownOn, destroyedOn: cover.destroyedOn, interculture: nextCrop && !SPRING_CROPS.has(nextCrop) ? "short" : "long", zar: zones.includes("zar"), west: zones.includes("ouest") });
  const warnings = [
    `Dose par défaut du tableau 4 (${d.label}). Une dose prévisionnelle calculée par bilan (annexe 4.3 : bilan de type céréales à paille avec b = 2 kg N/q, ou de type prairie) peut être saisie comme dose d'un outil ou d'un conseiller${d.withBilanMax ? `, ${d.withBilanMax} kg au plus` : ""}.`,
    "Les apports sur le couvert sont aussi consignés au cahier d'enregistrement de la culture principale.",
  ];
  return {
    context,
    result: { ...base, method: "ceiling", equation: "Dose prévisionnelle par bilan, sinon dose maximale du tableau 4 du PAR 7", dose: d.dose, ceiling: d.withBilanMax ?? null, warnings, missing: [] },
  };
}

// --- Lecture --------------------------------------------------------------------------------

/** Brouillons pour chaque parcelle cultivée de la campagne qui n'a pas encore de plan. */
export async function preparePlans(db: Database, farmId: string, campaign: number): Promise<{ created: number }> {
  return withFarm(db, farmId, async (tx) => {
    const created = await rows(
      tx,
      sql`INSERT INTO fertilization_plans (id, farm_id, campaign, land_parcel_id, production_id)
          SELECT DISTINCT ON (pr.land_parcel_id) gen_random_uuid(), ${farmId}, ${campaign}, pr.land_parcel_id, pr.id
          FROM productions pr JOIN campaigns c ON c.id = pr.campaign_id AND c.year = ${campaign}
          WHERE pr.farm_id = ${farmId}
          ORDER BY pr.land_parcel_id, pr.created_at
          ON CONFLICT (farm_id, campaign, land_parcel_id, kind) DO NOTHING
          RETURNING id`,
    );
    // Couverts exportés semés avant la culture de la campagne : un plan séparé (lot AQ).
    const covers = await rows(
      tx,
      sql`INSERT INTO fertilization_plans (id, farm_id, campaign, land_parcel_id, kind)
          SELECT gen_random_uuid(), ${farmId}, ${campaign}, cc.land_parcel_id, 'cover_exported'
          FROM cover_crops cc WHERE cc.campaign = ${campaign} AND cc.exported AND cc.kind = 'sown'
          ON CONFLICT (farm_id, campaign, land_parcel_id, kind) DO NOTHING
          RETURNING id`,
    );
    return { created: created.length + covers.length };
  });
}

export async function listPlans(db: Database, farmId: string, campaign: number, fetchImpl: typeof fetch = fetch): Promise<FertilizationPlanSummary[]> {
  const data = await plansData(db, farmId, sql`p.campaign = ${campaign}`, fetchImpl);
  const versions = await withFarm(db, farmId, (tx) =>
    rows<{ plan_id: string; dose_efficient: string | null; established_at: string | Date; external: unknown }>(
      tx,
      sql`SELECT v.plan_id, v.dose_efficient, v.established_at, v.external FROM fertilization_plan_versions v
          JOIN fertilization_plans p ON p.id = v.plan_id AND v.version = p.current_version WHERE p.campaign = ${campaign}`,
    ),
  );
  return data.map(({ row, context, result }) => {
    const v = versions.find((x) => x.plan_id === row.id);
    const external = row.draft.external ?? null;
    return {
      id: row.id,
      kind: row.kind,
      campaign: row.campaign,
      parcel: { id: row.land_parcel_id, name: row.parcel_name, areaM2: Math.round(Number(row.area_m2)) },
      cropLabel: context.cropLabel,
      zone: context.zone,
      status: row.status,
      currentVersion: row.current_version,
      dose: v ? num(v.dose_efficient) : external ? external.doseKgNHa : result.dose,
      doseOrigin: v ? (v.external ? "external" : "fourmy") : external ? "external" : result.dose !== null ? "fourmy" : null,
      missing: result.missing.length,
      establishedAt: v ? iso(v.established_at) : null,
    };
  });
}

export async function getPlan(db: Database, farmId: string, planId: string, fetchImpl: typeof fetch = fetch): Promise<FertilizationPlan> {
  const [data] = await plansData(db, farmId, sql`p.id = ${planId}`, fetchImpl);
  if (!data) throw new NotFound("Plan de fumure introuvable.");
  const { row, context, result } = data;
  const versions = await withFarm(db, farmId, async (tx) => {
    const vs = await rows<{ version: number; established_at: string | Date; who: string | null; reason: string | null; referential: string; method: string; external: PlanDraft["external"]; dose_efficient: string | null; snapshot: PlanVersion["snapshot"] }>(
      tx,
      sql`SELECT v.version, v.established_at, coalesce(u.name, u.email) AS who, v.reason, v.referential, v.method, v.external, v.dose_efficient, v.snapshot
          FROM fertilization_plan_versions v LEFT JOIN users u ON u.id = v.established_by
          WHERE v.plan_id = ${planId} ORDER BY v.version DESC`,
    );
    const apps = await rows<{ version: number; rank: number; stage: string; planned_on: string | null; article_id: string | null; n_efficient: string; n_total: string; reserved_for_steering: boolean }>(
      tx,
      sql`SELECT version, rank, stage, planned_on::text, article_id, n_efficient, n_total, reserved_for_steering
          FROM fertilization_plan_applications WHERE plan_id = ${planId} ORDER BY version, rank`,
    );
    return vs.map(
      (v): PlanVersion => ({
        version: v.version,
        establishedAt: iso(v.established_at),
        establishedBy: v.who,
        reason: v.reason,
        referential: v.referential,
        method: v.method,
        external: v.external ?? null,
        doseEfficient: num(v.dose_efficient),
        applications: apps
          .filter((a) => a.version === v.version)
          .map((a) => ({ stage: a.stage, plannedOn: a.planned_on, articleId: a.article_id, nKgHa: Number(a.n_efficient), nTotal: Number(a.n_total), reservedForSteering: a.reserved_for_steering })),
        snapshot: v.snapshot,
      }),
    );
  });
  const dose = row.draft.external?.doseKgNHa ?? result.dose;
  const measurements = (await withFarm(db, farmId, (tx) => steeringInTx(tx, [planId]))).get(planId) ?? [];
  const prescriptions = await withFarm(db, farmId, (tx) =>
    rows<{ id: string; name: string; plan_stage: string | null; product: string; unit: string; target_rate: number; mean: number | null; created_at: string | Date }>(
      tx,
      sql`SELECT p.id, p.name, p.plan_stage, p.product, p.unit, p.target_rate, p.created_at,
                 (SELECT sum(z.rate * z.area_m2) / nullif(sum(z.area_m2), 0) FROM prescription_zones z WHERE z.prescription_id = p.id) AS mean
          FROM prescriptions p WHERE p.fertilization_plan_id = ${planId} ORDER BY p.created_at`,
    ),
  );
  const current = versions.find((v) => v.version === row.current_version) ?? null;
  const reserved = (current?.applications ?? []).filter((a) => a.reservedForSteering).reduce((sum, a) => sum + a.nKgHa, 0);
  return {
    id: row.id,
    kind: row.kind,
    campaign: row.campaign,
    parcel: { id: row.land_parcel_id, name: row.parcel_name, areaM2: Math.round(Number(row.area_m2)) },
    status: row.status,
    currentVersion: row.current_version,
    draft: row.draft,
    context,
    result,
    proposedApplications: dose !== null && row.kind === "main" ? splitDose(dose, context.crop as CropGroup, { nBefore4Leaves: row.draft.nBefore4Leaves ?? context.starter?.kgNHa ?? 0 }) : [],
    versions,
    prescriptions: prescriptions.map((x) => ({
      id: x.id,
      name: x.name,
      stage: x.plan_stage,
      product: x.product,
      unit: x.unit,
      targetRate: x.target_rate,
      meanRate: Math.round(Number(x.mean ?? 0) * 10) / 10,
      createdAt: new Date(x.created_at).toISOString(),
    })),
    steering: {
      measurements,
      reservedKgNHa: Math.round(reserved),
      allowedDose: current?.doseEfficient != null ? steeringAllowance(current.doseEfficient, reserved, measurements) : null,
    },
  };
}

// --- Écriture -------------------------------------------------------------------------------

export async function saveDraft(db: Database, farmId: string, planId: string, draft: PlanDraft): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows(tx, sql`UPDATE fertilization_plans SET draft = ${JSON.stringify(draft)}::jsonb, updated_at = now() WHERE id = ${planId} RETURNING id`);
    if (!done.length) throw new NotFound("Plan de fumure introuvable.");
  });
}

/**
 * Établit le plan : version 1, ou révision (version n + 1, motif obligatoire).
 * Il faut une dose : calculée par Fourmy (tous les termes connus) ou venue
 * d'un outil ou d'un conseiller. La somme des apports prévus ne dépasse pas
 * la dose retenue.
 */
export async function establishPlan(db: Database, farmId: string, userId: string, planId: string, reason: string | null, fetchImpl: typeof fetch = fetch): Promise<FertilizationPlan> {
  const plan = await getPlan(db, farmId, planId, fetchImpl);
  const external = plan.draft.external ?? null;
  const dose = external?.doseKgNHa ?? plan.result.dose;
  if (dose === null) throw new BadRequest(`Dose incomplète : ${plan.result.missing.join(" ; ") || "méthode non prise en charge"}. Complétez le plan ou saisissez la dose d'un outil ou d'un conseiller.`);
  if (plan.currentVersion !== null && !reason) throw new BadRequest("Une révision demande son motif.");
  const applications: PlannedApplication[] = plan.draft.applications?.length ? plan.draft.applications : plan.proposedApplications;
  const sum = applications.reduce((s, a) => s + a.nKgHa, 0);
  if (sum > dose + 0.5) throw new BadRequest(`Les apports prévus (${Math.round(sum)} kg N) dépassent la dose retenue (${dose} kg N).`);
  const version = (plan.currentVersion ?? 0) + 1;
  await withFarm(db, farmId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO fertilization_plan_versions (plan_id, version, farm_id, established_by, reason, referential, method, external, snapshot, dose_efficient, dose_total)
      VALUES (${planId}, ${version}, ${farmId}, ${userId}, ${version === 1 ? null : reason}, ${PLAN_REFERENTIAL}, ${external ? "external" : plan.result.method},
              ${external ? JSON.stringify(external) : null}::jsonb,
              ${JSON.stringify({ context: plan.context, result: plan.result, draft: plan.draft })}::jsonb, ${dose}, ${sum})`);
    for (const [k, a] of applications.entries()) {
      await tx.execute(sql`
        INSERT INTO fertilization_plan_applications (plan_id, version, rank, farm_id, stage, planned_on, article_id, n_efficient, n_total, reserved_for_steering)
        VALUES (${planId}, ${version}, ${k + 1}, ${farmId}, ${a.stage}, ${a.plannedOn}::date, ${a.articleId}, ${a.nKgHa}, ${a.nKgHa}, ${a.reservedForSteering})`);
    }
    await tx.execute(sql`UPDATE fertilization_plans SET status = ${version === 1 ? "established" : "revised"}, current_version = ${version}, updated_at = now() WHERE id = ${planId}`);
  });
  return getPlan(db, farmId, planId, fetchImpl);
}
