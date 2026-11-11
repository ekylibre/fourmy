import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  PROCEDURES,
  type FertilizationCheck,
  type FertilizationCheckRequest,
  type FertilizationIndicator,
  type FertilizationRecord,
  type FertilizerArticle,
  type FertilizerComposition,
  type RecordApplication,
  type RecordParcel,
  type CoverCrop,
  type SoilCoverStatus,
} from "@fourmy/contracts";
import {
  checkCalendar,
  checkSoilCover,
  checkSpreadingConditions,
  cropGroupOf,
  effectiveComposition,
  isMaizeOrSorghum,
  isStrawCereal,
  nitrogenOfInput,
  steeringAllowance,
  coverSpreading,
  SPRING_CROPS,
  aplshOfApplication,
  aplshTotal,
  efficiencyGrid,
  efficiencyMessage,
  mineralFormOf,
  type EfficiencyInput,
  type MineralForm,
  type AplshSituation,
} from "@fourmy/domain";
import { defaultAplshZone, type AplshZone, type CropGroup } from "@fourmy/fertilization-refs";
import { cropLabel, previousOf } from "./fertilization-plans.js";
import { getSettings, settingsInTx } from "./fertilization-context.js";
import { fertilizersInTx, listFertilizers } from "./fertilizers.js";
import { coversInTx } from "./cover-crops.js";
import { farmDailyWeather } from "./crop-model.js";
import { steeringInTx } from "./steering.js";

/** Unité d'une dose telle qu'on l'écrit (cahier, CSV) : kg, L, t, m³… */
const UNIT_SHORT: Record<string, string> = {
  kilogram: "kg",
  gram: "g",
  ton: "t",
  tonne: "t",
  quintal: "q",
  liter: "L",
  litre: "L",
  hectoliter: "hL",
  cubic_meter: "m³",
  unity: "unité",
  unit: "unité",
};
const unitShort = (u: string) => UNIT_SHORT[u.toLowerCase()] ?? u;

const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Cahier d'enregistrement et contrôles à la saisie (lot AH,
 * docs/fertilisation-design.md §3.6, §8). Le cahier se lit dans les
 * interventions réalisées ; rien n'est saisi deux fois.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const arr = (xs: string[]) => `{${xs.join(",")}}`;
const FERTILIZING = PROCEDURES.filter((p) => p.shape === "fertilization" || p.code === "all_in_one_sowing" || p.code === "vine_spraying_with_fertilizing").map((p) => p.code);
const SOWING = PROCEDURES.filter((p) => p.shape === "sowing").map((p) => p.code);
const HARVEST = PROCEDURES.filter((p) => p.shape === "harvest").map((p) => p.code);
const PLOWING = ["plowing", "vine_plowing"];
const RESIDUES = ["crop_residues_grinding", "plant_grinding", "plowing", "superficial_plowing", "plant_mowing"];
const LATE_DAYS = 30;

/** Campagne d'une date selon le début de campagne de la ferme (1er septembre par défaut : le 10/10/2025 est en campagne 2026). */
export const campaignOf = (day: string, startMmdd = "09-01") => Number(day.slice(0, 4)) + (day.slice(5, 10) >= startMmdd ? 1 : 0);
const window = (campaign: number, startMmdd: string) => ({ from: `${campaign - 1}-${startMmdd}`, to: `${campaign}-${startMmdd}` });

function contentLabel(c: FertilizerComposition): string {
  const f = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  if (c.basis === "mass_percent") return c.p2o5 !== null || c.k2o !== null ? `${f(c.nTotal)}-${f(c.p2o5 ?? 0)}-${f(c.k2o ?? 0)}` : `${f(c.nTotal)} % N`;
  return `${f(c.nTotal)} kg N/${c.basis === "kg_per_t" ? "t" : "m³"}`;
}

function nitrogen(f: FertilizerArticle | undefined, day: string, quantity: number, unit: string | null, areaHa: number | null) {
  if (!f) return { missing: "produit inconnu" } as const;
  const eff = effectiveComposition(f, day);
  if (!eff) return { missing: "teneur en azote inconnue" } as const;
  const m = /^(.+)_per_hectare$/.exec(unit ?? "");
  const r = nitrogenOfInput({ quantity, per: m ? "hectare" : "total", unit: m ? m[1]! : (unit ?? ""), areaHa, composition: eff.composition });
  if ("missing" in r) return { missing: r.missing === "density" ? "densité inconnue" : r.missing === "unit" ? "unité non convertible" : r.missing === "area" ? "surface inconnue" : "teneur inconnue" } as const;
  return { ...r, composition: eff.composition, proposed: eff.from === "proposal" };
}

// --- Culture et plan d'une parcelle ---------------------------------------------------------

interface ParcelCrop {
  parcelId: string;
  name: string;
  crop: CropGroup;
  campaign: number;
  irrigated: boolean;
  zones: string[];
  zone: string | null;
  plan: { id: string; dose: number; version: number; reservedKgNHa: number } | null;
  /** Cours d'eau le plus proche (fossés exclus), si les cours d'eau de la ferme sont chargés. */
  water: { name: string | null; distanceM: number } | null;
  /** Département de la commune (zone climatique APLSH par défaut). */
  department: string | null;
}

async function parcelCrops(tx: Tx, farmId: string, parcelIds: string[], day: string, startMmdd: string): Promise<ParcelCrop[]> {
  if (!parcelIds.length) return [];
  const campaign = campaignOf(day, startMmdd);
  const list = await rows<{
    id: string;
    name: string;
    reference: string | null;
    cultivation: string | null;
    year: number | null;
    irrigated: boolean | null;
    zones: string[] | null;
    status: string | null;
    plan_id: string | null;
    dose: string | null;
    version: number | null;
    reserved: string | null;
    water_name: string | null;
    water_m: number | null;
    insee: string | null;
  }>(
    tx,
    sql`SELECT lp.id, lp.name, pr.reference, pr.cultivation, pr.year, ps.irrigated, z.zones, z.status, fp.id AS plan_id, v.dose_efficient AS dose, v.version,
               (SELECT sum(a.n_efficient) FROM fertilization_plan_applications a WHERE a.plan_id = fp.id AND a.version = fp.current_version AND a.reserved_for_steering) AS reserved,
               w.name AS water_name, w.d AS water_m, z.insee
        FROM land_parcels lp
        LEFT JOIN LATERAL (
          SELECT wi.name, ST_Distance(wi.geom::geography, sh.shape::geography) AS d
          FROM (SELECT shape FROM land_parcel_versions WHERE land_parcel_id = lp.id AND valid @> ${day}::timestamptz LIMIT 1) sh, water_items wi
          WHERE NOT wi.ditch ORDER BY wi.geom <-> sh.shape LIMIT 1) w ON true
        LEFT JOIN LATERAL (
          SELECT a.reference, coalesce(p.cultivation, a.cultivation) AS cultivation, c.year FROM productions p
          JOIN campaigns c ON c.id = p.campaign_id LEFT JOIN activities a ON a.id = p.activity_id
          WHERE p.land_parcel_id = lp.id AND c.year IN (${campaign}, ${Number(day.slice(0, 4))})
          ORDER BY abs(c.year - ${campaign}) LIMIT 1) pr ON true
        LEFT JOIN parcel_soils ps ON ps.land_parcel_id = lp.id
        LEFT JOIN parcel_nitrate_zones z ON z.land_parcel_id = lp.id
        LEFT JOIN fertilization_plans fp ON fp.land_parcel_id = lp.id AND fp.campaign = coalesce(pr.year, ${campaign}) AND fp.kind = 'main'
        LEFT JOIN fertilization_plan_versions v ON v.plan_id = fp.id AND v.version = fp.current_version
        WHERE lp.farm_id = ${farmId} AND lp.id IN (SELECT unnest(${arr(parcelIds)}::uuid[]))`,
  );
  return list.map((r) => ({
    parcelId: r.id,
    name: r.name,
    crop: cropGroupOf({ reference: r.reference, cultivation: r.cultivation }),
    campaign: r.year ?? campaign,
    irrigated: !!r.irrigated,
    zones: r.zones ?? [],
    zone: r.status,
    plan: r.plan_id && r.dose !== null && r.version !== null ? { id: r.plan_id, dose: Number(r.dose), version: r.version, reservedKgNHa: Number(r.reserved ?? 0) } : null,
    water: r.water_m !== null ? { name: r.water_name, distanceM: Number(r.water_m) } : null,
    department: r.insee ? r.insee.slice(0, 2) : null,
  }));
}

/**
 * Conditions de la grille d'efficacité (lot AL) : pH et CEC de la dernière
 * analyse de terre, couverture estimée d'après le dernier NDVI de moins de
 * 15 jours (NDVI moyen d'au moins 0,5 : plus de 50 % de couverture), pluie du
 * jour et des deux suivants, vent maximal et température moyenne du jour
 * (cache Open-Meteo de la ferme ; moyenne = (minimum + maximum) / 2).
 */
async function efficiencyConditions(
  tx: Tx,
  farmId: string,
  parcelId: string,
  day: string,
): Promise<Omit<EfficiencyInput, "form">> {
  const [soil] = await rows<{ ph: number | null; cec: number | null }>(
    tx,
    sql`SELECT (soil_values->>'ph')::float8 AS ph, (soil_values->>'cecMeq')::float8 AS cec FROM soil_analyses
        WHERE land_parcel_id = ${parcelId} AND kind = 'soil' AND sampled_on <= ${day}::date AND soil_values IS NOT NULL
        ORDER BY sampled_on DESC LIMIT 1`,
  );
  const [ndvi] = await rows<{ mean: number | null }>(
    tx,
    sql`SELECT pi.mean FROM parcel_indices pi JOIN land_parcel_versions v ON v.id = pi.land_parcel_version_id
        WHERE v.land_parcel_id = ${parcelId} AND pi.vegetation_index = 'ndvi' AND pi.mean IS NOT NULL
          AND pi.acquired_on <= ${day}::date AND pi.acquired_on > ${day}::date - 15
        ORDER BY pi.acquired_on DESC LIMIT 1`,
  );
  const days = await rows<{ day: string; tmin: number | null; tmax: number | null; rain: number | null; wind: number | null }>(
    tx,
    sql`SELECT day::text, tmin_c AS tmin, tmax_c AS tmax, rain_mm AS rain, wind_max_kmh AS wind FROM daily_weather
        WHERE farm_id = ${farmId} AND day >= ${day}::date AND day <= ${day}::date + 2 ORDER BY day`,
  );
  const today = days.find((d) => d.day === day);
  const rain3 = days.length === 3 && days.every((d) => d.rain !== null) ? days.reduce((sum, d) => sum + d.rain!, 0) : null;
  const mean = today?.tmin != null && today.tmax != null ? (today.tmin + today.tmax) / 2 : null;
  return {
    ph: soil?.ph ?? null,
    cecMeq: soil?.cec ?? null,
    coverOver50: ndvi?.mean != null ? ndvi.mean >= 0.5 : null,
    rain3dMm: rain3 === null ? null : Math.round(rain3 * 10) / 10,
    windKmh: today?.wind ?? null,
    temperatureC: mean !== null ? Math.round(mean * 10) / 10 : null,
  };
}

/**
 * APLSH (lot AK, FR-FERT-28) : si l'apport tombe sur un couvert d'interculture
 * (de la récolte du précédent à la destruction du couvert) ou sur une prairie
 * (du 1er septembre au 15 janvier), cumul de l'azote potentiellement libéré
 * jusqu'en sortie d'hiver depuis le début de la période, plafonné à 70 kg.
 */
async function aplshCheck(
  tx: Tx,
  p: ParcelCrop,
  day: string,
  before: string,
  exclude: string | null,
  current: CurrentApplication[],
  fertilizers: Map<string, FertilizerArticle>,
  zone: AplshZone | null,
  cover: CoverAt | null,
): Promise<Omit<FertilizationIndicator, "parcelName"> | null> {
  if (!current.length) return null;
  let situation: AplshSituation | null = null;
  const md = day.slice(5, 10);
  if (p.crop === "grassland" && (md >= "09-01" || md <= "01-15")) {
    situation = { kind: "grassland", from: `${md >= "09-01" ? day.slice(0, 4) : Number(day.slice(0, 4)) - 1}-09-01`, countsMineral: true };
  } else if (cover) {
    const from = cover.harvest && cover.harvest <= day ? cover.harvest : addDays(cover.sownOn, -15);
    situation = { kind: "cover", from, countsMineral: cover.exported };
  }
  if (!situation) return null;
  const applications = [...(await pastApplications(tx, p.parcelId, situation.from, before, exclude, fertilizers)), ...current.filter((c) => !c.composition.foliar)].map((a) => ({
    date: a.date,
    product: a.product,
    type: a.composition.nitrateType,
    aplsh: aplshOfApplication(a.composition, a.date, a.nTotalKgHa, zone),
  }));
  const t = aplshTotal(situation, applications);
  const what = situation.kind === "cover" ? `depuis la récolte du précédent (${fr(situation.from)}), sur le couvert d'interculture` : `depuis le ${fr(situation.from)} sur la prairie`;
  if (t.over) return { code: "fert_aplsh", level: "warning", message: `APLSH ${what} : ${t.kgNHa} kg N/ha pour un plafond de ${t.ceiling} kg (PAN 7).` };
  if (t.missing.length) return { code: "fert_aplsh", level: "info", message: `APLSH ${what} : ${t.kgNHa} kg N/ha comptés, plafond ${t.ceiling} kg ; non calculable pour ${t.missing.join(" ; ")}.` };
  return { code: "fert_aplsh", level: "ok", message: `APLSH ${what} : ${t.kgNHa} kg N/ha sur ${t.ceiling} kg permis.` };
}

type CurrentApplication = { date: string; product: string; composition: FertilizerComposition; nTotalKgHa: number; nEfficientKgHa: number | null };

interface CoverAt {
  kind: CoverCrop["kind"];
  family: CoverCrop["family"];
  exported: boolean;
  sownOn: string;
  destroyedOn: string | null;
  /** Dernière récolte sur la parcelle de l'apport, dans l'année qui précède. */
  harvest: string | null;
  /** Culture principale qui suit le couvert, si elle est saisie. */
  nextCrop: CropGroup | null;
  /** Dose du plan établi du couvert exporté (lot AQ), s'il existe. */
  planDose: number | null;
}

/**
 * Couvert d'interculture en place à la date d'un apport : saisi pour la
 * campagne suivante, sur la parcelle ou sur celle qui la recouvre (Ekylibre :
 * une parcelle par campagne). Sans date de destruction, il est réputé détruit
 * avant le 1er mars de la campagne.
 */
async function coverAt(tx: Tx, parcelId: string, day: string, before: string, startMmdd: string): Promise<CoverAt | null> {
  const campaign = campaignOf(day, startMmdd);
  const [c] = await rows<{
    kind: CoverCrop["kind"];
    family: CoverCrop["family"];
    sown_on: string;
    destroyed_on: string | null;
    exported: boolean;
    harvest: string | null;
    reference: string | null;
    cultivation: string | null;
    plan_dose: string | null;
  }>(
    tx,
    sql`WITH cur AS (SELECT shape FROM land_parcel_versions WHERE land_parcel_id = ${parcelId} AND valid @> ${day}::timestamptz LIMIT 1)
        SELECT cc.kind, cc.family, cc.sown_on::text, cc.destroyed_on::text, cc.exported,
               (SELECT max(i.started_at)::date::text FROM interventions i
                JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = ${parcelId}
                WHERE i.status = 'done' AND i.procedure = ANY(${arr(HARVEST)}::text[])
                  AND i.started_at <= ${before}::timestamptz AND i.started_at > ${before}::timestamptz - interval '1 year') AS harvest,
               nx.reference, nx.cultivation,
               (SELECT v.dose_efficient FROM fertilization_plans fp
                JOIN fertilization_plan_versions v ON v.plan_id = fp.id AND v.version = fp.current_version
                WHERE fp.land_parcel_id = cc.land_parcel_id AND fp.campaign = cc.campaign AND fp.kind = 'cover_exported') AS plan_dose
        FROM cover_crops cc
        JOIN land_parcel_versions v ON v.land_parcel_id = cc.land_parcel_id
        LEFT JOIN LATERAL (
          SELECT a.reference, coalesce(pr.cultivation, a.cultivation) AS cultivation FROM productions pr
          JOIN campaigns c ON c.id = pr.campaign_id AND c.year = cc.campaign LEFT JOIN activities a ON a.id = pr.activity_id
          WHERE pr.land_parcel_id = cc.land_parcel_id ORDER BY pr.created_at LIMIT 1) nx ON true
        , cur
        WHERE cc.campaign = ${campaign} AND ST_Intersects(v.shape, cur.shape)
          AND ST_Area(ST_Intersection(v.shape, cur.shape)::geography) >= 0.5 * ST_Area(cur.shape::geography)
        ORDER BY cc.sown_on DESC LIMIT 1`,
  );
  // Avant la récolte du précédent (ou, sans récolte connue, plus de 15 jours avant le semis), l'apport vise la culture en place.
  if (!c || day > (c.destroyed_on ?? `${campaign}-02-28`)) return null;
  if (c.harvest ? day < c.harvest : day < addDays(c.sown_on, -15)) return null;
  return {
    kind: c.kind,
    family: c.family,
    exported: c.exported,
    sownOn: c.sown_on,
    destroyedOn: c.destroyed_on,
    harvest: c.harvest,
    nextCrop: c.reference || c.cultivation ? cropGroupOf({ reference: c.reference, cultivation: c.cultivation }) : null,
    planDose: c.plan_dose !== null ? Number(c.plan_dose) : null,
  };
}

/** Apports d'azote réalisés sur une parcelle entre deux dates, avec leur azote total et efficace. */
async function pastApplications(tx: Tx, parcelId: string, from: string, before: string, exclude: string | null, fertilizers: Map<string, FertilizerArticle>): Promise<CurrentApplication[]> {
  const past = await rows<{ day: string; article_id: string; quantity: string; unit: string | null; area_m2: string | null; worked: string | null }>(
    tx,
    sql`SELECT i.started_at::date::text AS day, p.ref_id AS article_id, p.quantity, p.unit,
               (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = t.ref_id AND v.valid @> i.started_at LIMIT 1) AS area_m2,
               t.attrs->>'workedAreaM2' AS worked
        FROM interventions i
        JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = ${parcelId}
        JOIN intervention_parameters p ON p.intervention_id = i.id AND p.role = 'input' AND p.ref_type = 'article' AND p.quantity IS NOT NULL
        WHERE i.status = 'done' AND i.procedure = ANY(${arr(FERTILIZING)}::text[])
          AND i.started_at >= ${from}::date AND i.started_at < ${before}::timestamptz
          ${exclude ? sql`AND i.id <> ${exclude}` : sql``}`,
  );
  return past.flatMap((r) => {
    const f = fertilizers.get(r.article_id);
    const n = nitrogen(f, r.day, Number(r.quantity), r.unit, ((num(r.worked) ?? num(r.area_m2)) ?? 0) / 10_000 || null);
    return "missing" in n || !(n.totalKgHa > 0) || n.composition.foliar
      ? []
      : [{ date: r.day, product: f!.name, composition: n.composition, nTotalKgHa: n.totalKgHa, nEfficientKgHa: n.efficientKgHa }];
  });
}

/**
 * Épandage sur un couvert d'interculture (lot AM, guide du PAR 7 NA, tableau
 * 4) : interdictions (repousses, légumineuses pures, période, type III sur
 * CINE, ZAR), puis plafond d'azote efficace cumulé depuis 15 jours avant le
 * semis du couvert.
 */
async function coverSpreadingCheck(
  tx: Tx,
  p: ParcelCrop,
  cover: CoverAt,
  day: string,
  before: string,
  exclude: string | null,
  current: CurrentApplication[],
  fertilizers: Map<string, FertilizerArticle>,
): Promise<Omit<FertilizationIndicator, "parcelName">[]> {
  const out: Omit<FertilizationIndicator, "parcelName">[] = [];
  const interculture = cover.nextCrop && !SPRING_CROPS.has(cover.nextCrop) ? "short" : "long";
  const base = {
    date: day,
    cover: { kind: cover.kind, pureLegumes: cover.family === "legumineuses", exported: cover.exported, sownOn: cover.sownOn, destroyedOn: cover.destroyedOn },
    interculture,
    zar: p.zones.includes("zar"),
    west: p.zones.includes("ouest"),
  } as const;
  const ceilings = new Map<string, { ceiling: number; cumulates: "organic" | "all"; label: string }>();
  for (const c of current.filter((x) => !x.composition.foliar)) {
    const r = coverSpreading({ ...base, type: c.composition.nitrateType });
    // Avant le couvert (sur chaume), l'interdiction est probable mais Fourmy ne sait pas si l'apport vise le couvert : orange.
    if (!r.allowed) out.push({ code: "fert_cover", level: day < addDays(cover.sownOn, -15) ? "warning" : "danger", message: `${c.product} : ${r.reason}` });
    else {
      // Plan établi du couvert exporté (lot AQ) : sa dose remplace la valeur par défaut (100 kg au plus exporté l'an suivant, hors ZAR).
      let ceiling = r.ceiling;
      let label = r.label;
      if (cover.planDose !== null && cover.exported) {
        const nextYear = !(cover.destroyedOn && cover.destroyedOn.slice(0, 4) === cover.sownOn.slice(0, 4));
        ceiling =
          r.cumulates === "all" && !base.zar ? Math.min(cover.planDose, nextYear && interculture === "long" ? 100 : cover.planDose) : Math.min(r.ceiling, cover.planDose);
        label = `plan du couvert : ${cover.planDose} kg d'azote efficace`;
      }
      ceilings.set(`${ceiling}|${r.cumulates}`, { ceiling, cumulates: r.cumulates, label });
    }
  }
  if (!ceilings.size) return out;
  const from = addDays(cover.sownOn, -15);
  const all = [...(await pastApplications(tx, p.parcelId, from, before, exclude, fertilizers)), ...current.filter((c) => !c.composition.foliar)];
  for (const r of ceilings.values()) {
    const counted = all.filter((a) => r.cumulates === "all" || a.composition.nitrateType !== "III");
    const unknown = counted.filter((a) => a.nEfficientKgHa === null).map((a) => a.product);
    const kg = Math.round(counted.reduce((sum, a) => sum + (a.nEfficientKgHa ?? 0), 0));
    const what = `Couvert d'interculture (${r.label}) : ${kg} kg N efficace/ha apportés depuis le ${fr(from)}`;
    if (kg > r.ceiling) out.push({ code: "fert_cover", level: "warning", message: `${what}, au-delà du plafond de ${r.ceiling} kg.` });
    else if (unknown.length) out.push({ code: "fert_cover", level: "info", message: `${what} ; azote efficace inconnu pour ${[...new Set(unknown)].join(", ")}.` });
    else out.push({ code: "fert_cover", level: "ok", message: `${what}, sur ${r.ceiling} kg permis, dans la limite des besoins du couvert.` });
  }
  return out;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Azote efficace (minéral) déjà apporté sur la parcelle pendant la campagne, hors une intervention. */
async function appliedSoFar(tx: Tx, parcelId: string, from: string, before: string, exclude: string | null, fertilizers: Map<string, FertilizerArticle>): Promise<{ total: number; count: number }> {
  const inputs = await rows<{ id: string; day: string; article_id: string; quantity: string; unit: string | null; area_m2: string | null; worked: string | null }>(
    tx,
    sql`SELECT i.id, i.started_at::date::text AS day, p.ref_id AS article_id, p.quantity, p.unit,
               (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = t.ref_id AND v.valid @> i.started_at LIMIT 1) AS area_m2,
               t.attrs->>'workedAreaM2' AS worked
        FROM interventions i
        JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = ${parcelId}
        JOIN intervention_parameters p ON p.intervention_id = i.id AND p.role = 'input' AND p.ref_type = 'article' AND p.quantity IS NOT NULL
        WHERE i.status = 'done' AND i.procedure = ANY(${arr(FERTILIZING)}::text[]) AND i.started_at >= ${from}::date AND i.started_at < ${before}::timestamptz
          ${exclude ? sql`AND i.id <> ${exclude}` : sql``}`,
  );
  let total = 0;
  const done = new Set<string>();
  for (const r of inputs) {
    const n = nitrogen(fertilizers.get(r.article_id), r.day, Number(r.quantity), r.unit, ((num(r.worked) ?? num(r.area_m2)) ?? 0) / 10_000 || null);
    if ("missing" in n || !(n.totalKgHa > 0)) continue;
    // Un apport d'azote compte comme apport (fractionnement) même si son azote efficace est inconnu.
    done.add(r.id);
    if (n.efficientKgHa !== null) total += n.efficientKgHa;
  }
  return { total: Math.round(total), count: done.size };
}

// --- Contrôle d'un apport --------------------------------------------------------------------

const worst = (levels: FertilizationIndicator["level"][]) =>
  (["danger", "warning", "info", "ok"] as const).find((l) => levels.includes(l)) ?? "ok";

/**
 * Contrôles d'un apport en cours de saisie (FR-FERT-25, FR-FERT-21) :
 * calendrier d'épandage par parcelle, plan établi et dépassement de sa dose,
 * plafond du premier apport, teneur connue. Ce que Fourmy ne peut pas vérifier
 * est dit « non vérifié », jamais « conforme ».
 */
export async function checkApplication(db: Database, farmId: string, req: FertilizationCheckRequest, fetchImpl?: typeof fetch): Promise<FertilizationCheck> {
  // Météo du jour et des deux suivants (grille d'efficacité) : cache de la ferme, rafraîchi hors transaction.
  if (fetchImpl) await farmDailyWeather(db, farmId, req.startedAt.slice(0, 10), fetchImpl).catch(() => null);
  return withFarm(db, farmId, (tx) => checkApplicationTx(tx, farmId, req));
}

export async function checkApplicationTx(tx: Tx, farmId: string, req: FertilizationCheckRequest): Promise<FertilizationCheck> {
  const fertilizers = new Map((await fertilizersInTx(tx)).map((f) => [f.id, f]));
  const settings = await settingsInTx(tx);
  const day = req.startedAt.slice(0, 10);
  const fert = req.inputs.filter((i) => fertilizers.has(i.articleId));
  if (!fert.length) return { level: "ok", nitrogen: null, indicators: [] };
  {
    const parcels = await parcelCrops(tx, farmId, req.parcelIds, day, settings.campaignStartMmdd);
    const indicators: FertilizationIndicator[] = [];
    const areaHa = req.areaM2 ? req.areaM2 / 10_000 : null;
    let total = 0;
    let efficient: number | null = 0;
    for (const i of fert) {
      const f = fertilizers.get(i.articleId)!;
      const n = nitrogen(f, day, i.quantity, i.per === "hectare" ? `${f.unit}_per_hectare` : f.unit, areaHa);
      if ("missing" in n) {
        indicators.push({ code: "fert_composition", level: "warning", message: `${f.name} : ${n.missing}, l'azote apporté n'est pas compté.` });
        efficient = null;
        continue;
      }
      total += n.totalKgHa;
      efficient = efficient === null || n.efficientKgHa === null ? null : efficient + n.efficientKgHa;
      if (n.proposed) indicators.push({ code: "fert_composition", level: "info", message: `${f.name} : teneur proposée par Fourmy, à confirmer.` });
      for (const p of parcels) {
        const cal = checkCalendar({ date: day, crop: p.crop, type: n.composition.nitrateType, foliar: n.composition.foliar, irrigated: p.irrigated, zones: p.zones });
        if (cal.level !== "ok" || parcels.length === 1) indicators.push({ code: "fert_calendar", level: cal.level, message: `${f.name} : ${cal.message}`, parcelName: p.name });
        // Conditions d'épandage (lot AJ) : en zone vulnérable, où le PAN s'applique.
        if (p.zone === "in" || p.zone === "partial") {
          const c = n.composition;
          for (const x of checkSpreadingConditions({
            type: c.nitrateType,
            solid: c.basis === "kg_per_t",
            liquid: c.basis === "kg_per_m3" || c.density !== null,
            foliar: c.foliar,
            weather: req.weather ?? null,
            water: p.water,
          })) {
            // Gel et pluie valent pour l'intervention : une fois par parcelle.
            const same = indicators.some((y) => y.code === x.code && y.parcelName === p.name && (x.code === "fert_frost" || x.code === "fert_wet" || y.message.endsWith(x.message)));
            if (!same) indicators.push({ ...x, message: x.code === "fert_water" ? `${f.name} : ${x.message}` : x.message, parcelName: p.name });
          }
        }
      }
    }
    // Plan : établi, dose non dépassée, premier apport plafonné.
    for (const p of parcels) {
      const w = window(p.campaign, settings.campaignStartMmdd);
      const so = await appliedSoFar(tx, p.parcelId, w.from, req.startedAt, req.interventionId, fertilizers);
      if (!p.plan) {
        if (p.zone === "in" || p.zone === "partial")
          indicators.push({ code: "fert_plan", level: "warning", message: `Pas de plan de fumure établi pour la campagne ${p.campaign} : il doit l'être avant le premier apport de sortie d'hiver.`, parcelName: p.name });
      } else if (efficient !== null && so.total + efficient > p.plan.dose) {
        // Pilotage : la dernière mesure fixe l'apport de pilotage et peut justifier le dépassement.
        const measures = (await steeringInTx(tx, [p.plan.id])).get(p.plan.id) ?? [];
        const allowed = steeringAllowance(p.plan.dose, p.plan.reservedKgNHa, measures);
        const applied = so.total + Math.round(efficient);
        const last = measures.at(-1);
        indicators.push(
          measures.length && applied <= allowed
            ? {
                code: "fert_plan",
                level: "info",
                message: `${applied} kg N apportés pour ${p.plan.dose} kg prévus : dépassement justifié par la mesure ${last!.tool} du ${fr(last!.measuredOn)} (${allowed} kg permis).`,
                parcelName: p.name,
              }
            : {
                code: "fert_plan",
                level: "warning",
                message: measures.length
                  ? `Dépassement : ${applied} kg N apportés pour ${allowed} kg permis après la mesure ${last!.tool} du ${fr(last!.measuredOn)} (plan version ${p.plan.version} : ${p.plan.dose} kg).`
                  : `Dépassement du plan (version ${p.plan.version}) : ${applied} kg N apportés pour ${p.plan.dose} kg prévus. Justifiez-le par une mesure de pilotage.`,
                parcelName: p.name,
              },
        );
      } else if (efficient !== null) {
        indicators.push({ code: "fert_plan", level: "ok", message: `${so.total + Math.round(efficient)} kg N apportés sur ${p.plan.dose} kg prévus (reste ${Math.max(0, p.plan.dose - so.total - Math.round(efficient))} kg).`, parcelName: p.name });
      }
      if (so.count === 0 && efficient !== null && efficient > 50 && (isMaizeOrSorghum(p.crop) || (isStrawCereal(p.crop) && p.crop !== "barley_spring"))) {
        indicators.push({ code: "fert_first_split", level: "warning", message: `Premier apport de ${Math.round(efficient)} kg N : 50 kg au plus (PAR 7 Nouvelle-Aquitaine).`, parcelName: p.name });
      }
      // Efficacité d'un apport d'azote minéral en surface (lot AL) : grille du COMIFER.
      const forms = [
        ...new Set(
          fert.flatMap((i) => {
            const f = fertilizers.get(i.articleId)!;
            const eff = effectiveComposition(f, day);
            const form = eff && !eff.composition.foliar ? mineralFormOf(f, eff.composition) : null;
            return form ? [form] : [];
          }),
        ),
      ];
      if (forms.length) {
        const conditions = await efficiencyConditions(tx, farmId, p.parcelId, day);
        for (const form of forms) {
          const r = efficiencyGrid({ form, ...conditions });
          const level = r.quality[0] === "good" ? "ok" : r.quality[0] === "medium" ? "info" : "warning";
          indicators.push({ code: "fert_efficiency", level, message: efficiencyMessage(r), parcelName: p.name });
        }
      }
      // Plafond d'APLSH (lot AK) : couvert d'interculture ou prairie, en zone vulnérable.
      if (p.zone === "in" || p.zone === "partial") {
        const current = fert.flatMap((i) => {
          const f = fertilizers.get(i.articleId)!;
          const n = nitrogen(f, day, i.quantity, i.per === "hectare" ? `${f.unit}_per_hectare` : f.unit, areaHa);
          return "missing" in n || !(n.totalKgHa > 0) ? [] : [{ date: day, product: f.name, composition: n.composition, nTotalKgHa: n.totalKgHa, nEfficientKgHa: n.efficientKgHa }];
        });
        const cover = await coverAt(tx, p.parcelId, day, req.startedAt, settings.campaignStartMmdd);
        const x = await aplshCheck(tx, p, day, req.startedAt, req.interventionId, current, fertilizers, settings.aplshZone ?? defaultAplshZone(p.department), cover);
        if (x) indicators.push({ ...x, parcelName: p.name });
        // Épandage sur le couvert (lot AM) : interdictions et plafonds du tableau 4 du PAR 7.
        if (cover) for (const y of await coverSpreadingCheck(tx, p, cover, day, req.startedAt, req.interventionId, current, fertilizers)) indicators.push({ ...y, parcelName: p.name });
      }
    }
    return {
      level: worst(indicators.map((x) => x.level)),
      nitrogen: { totalKgHa: Math.round(total * 10) / 10, efficientKgHa: efficient === null ? null : Math.round(efficient * 10) / 10 },
      indicators,
    };
  }
}

// --- Cahier d'enregistrement -------------------------------------------------------------------

/**
 * Cahier d'enregistrement d'une campagne (FR-FERT-19 à 22) : pour chaque
 * parcelle cultivée, l'interculture (travaux des résidus), la culture, le
 * semis, les apports (date, surface, produit, teneur, azote), les récoltes et
 * le rendement, les techniques culturales simplifiées.
 */
/** Dernière récolte avant le semis de la culture (ou avant le 1er mars) : celle du précédent. */
function previousHarvest(events: { procedure: string; day: string }[], sown: string | null, campaign: number): string | null {
  const limit = sown ?? `${campaign}-03-01`;
  return (
    events
      .filter((e) => HARVEST.includes(e.procedure) && e.day >= `${campaign - 1}-06-01` && e.day < limit)
      .map((e) => e.day)
      .sort()
      .at(-1) ?? null
  );
}

/**
 * APLSH sur le couvert d'interculture (lot AK) : apports de la récolte du
 * précédent à la destruction du couvert, types 0 à II (et III si le couvert
 * est exporté), comparés au plafond de 70 kg.
 */
function coverAplsh(
  events: { procedure: string; day: string; role: string | null; article_id: string | null; quantity: string | null; unit: string | null; worked: string | null; area_m2: string | null }[],
  areaM2: number,
  sown: string | null,
  cover: CoverCrop | null,
  campaign: number,
  fertilizers: Map<string, FertilizerArticle>,
  zone: AplshZone | null,
): RecordParcel["aplsh"] {
  if (!cover) return null;
  const from = previousHarvest(events, sown, campaign) ?? cover.sownOn;
  const to = cover.destroyedOn ?? sown ?? `${campaign}-03-01`;
  const applications = events
    .filter((e) => FERTILIZING.includes(e.procedure) && e.role === "input" && e.article_id && fertilizers.has(e.article_id) && e.quantity !== null && e.day >= from && e.day <= to)
    .flatMap((e) => {
      const f = fertilizers.get(e.article_id!)!;
      const n = nitrogen(f, e.day, Number(e.quantity), e.unit, ((num(e.worked) ?? num(e.area_m2)) ?? areaM2) / 10_000);
      if ("missing" in n || !(n.totalKgHa > 0) || n.composition.foliar) return [];
      return [{ date: e.day, product: f.name, type: n.composition.nitrateType, aplsh: aplshOfApplication(n.composition, e.day, n.totalKgHa, zone) }];
    });
  const t = aplshTotal({ kind: "cover", from, countsMineral: cover.exported }, applications);
  return { from, to, kgNHa: t.kgNHa, ceiling: t.ceiling, over: t.over, missing: t.missing };
}

/**
 * Couverture des sols avant la culture (FR-FERT-27) : précédent de la
 * campagne d'avant, sa dernière récolte avant le semis, le couvert saisi et
 * les travaux des résidus (broyage, enfouissement).
 */
function soilCoverOf(
  prev: { reference: string | null; cultivation: string | null } | null,
  zones: string[] | null,
  crop: CropGroup,
  events: { procedure: string; day: string }[],
  sown: string | null,
  cover: CoverCrop | null,
  campaign: number,
): SoilCoverStatus {
  const previous = prev ? cropGroupOf({ reference: prev.reference, cultivation: prev.cultivation }) : null;
  const harvestedOn = previousHarvest(events, sown, campaign);
  return checkSoilCover({
    crop,
    previous: previous ? { crop: previous, harvestedOn } : null,
    zar: (zones ?? []).includes("zar"),
    cover: cover
      ? { kind: cover.kind, pureLegumes: cover.family === "legumineuses", sownOn: cover.sownOn, destroyedOn: cover.destroyedOn, destructionMode: cover.destructionMode }
      : null,
    residueWorks: events.filter((e) => RESIDUES.includes(e.procedure)).map((e) => e.day),
  });
}

export async function fertilizationRecord(db: Database, farmId: string, campaign: number): Promise<FertilizationRecord> {
  const settings = await getSettings(db, farmId);
  const w = window(campaign, settings.campaignStartMmdd);
  const fertilizers = new Map((await listFertilizers(db, farmId)).map((f) => [f.id, f]));
  return withFarm(db, farmId, async (tx) => {
    const parcels = await rows<{
      id: string;
      name: string;
      area_m2: string;
      soil_type: string | null;
      zone: string | null;
      zones: string[] | null;
      reference: string | null;
      cultivation: string | null;
      species: string | null;
      plan_id: string | null;
      dose: string | null;
      version: number | null;
      insee: string | null;
    }>(
      tx,
      sql`SELECT DISTINCT ON (lp.id) lp.id, lp.name,
                 (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = lp.id
                  ORDER BY (v.valid @> make_date(${campaign}, 6, 1)::timestamptz) DESC, upper(v.valid) DESC NULLS FIRST LIMIT 1) AS area_m2,
                 ps.soil_type, z.status AS zone, z.zones, z.insee, a.reference, coalesce(pr.cultivation, a.cultivation) AS cultivation, pr.species,
                 fp.id AS plan_id, v.dose_efficient AS dose, v.version
          FROM productions pr JOIN campaigns c ON c.id = pr.campaign_id AND c.year = ${campaign}
          JOIN land_parcels lp ON lp.id = pr.land_parcel_id
          LEFT JOIN activities a ON a.id = pr.activity_id
          LEFT JOIN parcel_soils ps ON ps.land_parcel_id = lp.id
          LEFT JOIN parcel_nitrate_zones z ON z.land_parcel_id = lp.id
          LEFT JOIN fertilization_plans fp ON fp.land_parcel_id = lp.id AND fp.campaign = ${campaign} AND fp.kind = 'main'
          LEFT JOIN fertilization_plan_versions v ON v.plan_id = fp.id AND v.version = fp.current_version
          WHERE pr.farm_id = ${farmId}
          ORDER BY lp.id, pr.created_at`,
    );
    const ids = parcels.map((p) => p.id);
    // Précédent (couverture des sols) : la parcelle de la campagne d'avant qui recouvre celle-ci,
    // la même ou une autre (Ekylibre crée une parcelle par campagne).
    const prevs = new Map<string, Awaited<ReturnType<typeof previousOf>>>();
    for (const p of parcels) if (p.zone === "in" || p.zone === "partial") prevs.set(p.id, await previousOf(tx, farmId, p.id, campaign));
    const prevIds = [...prevs.values()].map((x) => x?.parcel_id).filter((x): x is string => !!x && !ids.includes(x));
    const prevEvents = prevIds.length
      ? await rows<{ parcel_id: string; procedure: string; day: string; worked: string | null; area_m2: string | null; article_id: string | null; quantity: string | null; unit: string | null; role: string | null }>(
          tx,
          sql`SELECT t.ref_id AS parcel_id, i.procedure, i.started_at::date::text AS day, t.attrs->>'workedAreaM2' AS worked,
                     (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = t.ref_id AND v.valid @> i.started_at LIMIT 1) AS area_m2,
                     p.ref_id AS article_id, p.quantity, p.unit, p.role
              FROM interventions i JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target'
              LEFT JOIN intervention_parameters p ON p.intervention_id = i.id AND p.role = 'input' AND p.ref_type = 'article'
              WHERE i.farm_id = ${farmId} AND i.status = 'done' AND t.ref_id IN (SELECT unnest(${arr(prevIds)}::uuid[]))
                AND i.procedure = ANY(${arr([...HARVEST, ...RESIDUES, ...FERTILIZING])}::text[])
                AND i.started_at >= make_date(${campaign - 1}, 6, 1) AND i.started_at < ${w.to}::date`,
        )
      : [];
    const events = ids.length
      ? await rows<{ parcel_id: string; id: string; procedure: string; origin: string; day: string; created: string; worked: string | null; article_id: string | null; quantity: string | null; unit: string | null; role: string | null }>(
          tx,
          sql`SELECT t.ref_id AS parcel_id, i.id, i.procedure, i.origin, i.started_at::date::text AS day, i.created_at::date::text AS created,
                     t.attrs->>'workedAreaM2' AS worked, p.ref_id AS article_id, p.quantity, p.unit, p.role
              FROM interventions i
              JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target'
              LEFT JOIN intervention_parameters p ON p.intervention_id = i.id AND p.role IN ('input', 'output') AND p.ref_type = 'article'
              WHERE i.farm_id = ${farmId} AND i.status = 'done' AND t.ref_id IN (SELECT unnest(${arr(ids)}::uuid[]))
                AND i.started_at >= (${w.from}::date - interval '1 year') AND i.started_at < ${w.to}::date
              ORDER BY i.started_at`,
        )
      : [];
    const covers = await coversInTx(tx, ids, campaign);
    // Contrôles enregistrés avec les interventions (efficacité des apports, lot AL).
    const interventionIds = [...new Set(events.map((e) => e.id))];
    const stored = new Map(
      (interventionIds.length
        ? await rows<{ id: string; indicators: FertilizationIndicator[] | null }>(
            tx,
            sql`SELECT id, nitrate_check->'indicators' AS indicators FROM interventions WHERE id IN (SELECT unnest(${arr(interventionIds)}::uuid[])) AND nitrate_check IS NOT NULL`,
          )
        : []
      ).map((r) => [r.id, r.indicators ?? []]),
    );
    const steering = await steeringInTx(tx, parcels.map((p) => p.plan_id).filter((x): x is string => !!x));
    // Épandages enregistrés en période d'interdiction, avec leur motif.
    const forced = await rows<{ id: string; day: string; parcels: string[]; reason: string | null }>(
      tx,
      sql`SELECT i.id, i.started_at::date::text AS day, i.nitrate_check->>'reason' AS reason,
                 array(SELECT lp.name FROM intervention_parameters t JOIN land_parcels lp ON lp.id = t.ref_id
                       WHERE t.intervention_id = i.id AND t.role = 'target' ORDER BY lp.name) AS parcels
          FROM interventions i
          WHERE i.farm_id = ${farmId} AND i.status = 'done' AND i.nitrate_check->>'level' = 'danger'
            AND i.started_at >= ${w.from}::date AND i.started_at < ${w.to}::date
          ORDER BY i.started_at`,
    );
    const out: RecordParcel[] = [];
    for (const p of parcels) {
      const crop = cropGroupOf({ reference: p.reference, cultivation: p.cultivation });
      const areaHa = Number(p.area_m2) / 10_000;
      const mine = events.filter((e) => e.parcel_id === p.id);
      const inCampaign = mine.filter((e) => e.day >= w.from && e.day < w.to);
      const sown = inCampaign.find((e) => SOWING.includes(e.procedure))?.day ?? null;
      const harvests = [...new Set(inCampaign.filter((e) => HARVEST.includes(e.procedure)).map((e) => e.day))];
      const yields = inCampaign
        .filter((e) => HARVEST.includes(e.procedure) && e.role === "output" && e.quantity !== null && /quintal_per_hectare|ton_per_hectare/.test(e.unit ?? ""))
        .map((e) => Number(e.quantity) * (e.unit === "ton_per_hectare" ? 10 : 1));
      const applications: (RecordApplication & { form: MineralForm | null })[] = inCampaign
        .filter((e) => FERTILIZING.includes(e.procedure) && e.role === "input" && e.article_id && fertilizers.has(e.article_id) && e.quantity !== null)
        .map((e) => {
          const f = fertilizers.get(e.article_id!)!;
          const area = (num(e.worked) ?? Number(p.area_m2)) / 10_000;
          const n = nitrogen(f, e.day, Number(e.quantity), e.unit, area);
          // Une intervention reprise d'Ekylibre porte la date de la migration, pas celle de sa saisie.
          const late = e.origin !== "migration" && (Date.parse(e.created) - Date.parse(e.day)) / 86_400_000 > LATE_DAYS;
          const per = /_per_hectare$/.test(e.unit ?? "");
          return {
            interventionId: e.id,
            date: e.day,
            recordedOn: e.origin === "migration" ? e.day : e.created,
            late,
            procedure: e.procedure,
            areaHa: Math.round(area * 100) / 100,
            product: f.name,
            content: "missing" in n ? null : contentLabel(n.composition),
            nitrateType: "missing" in n ? null : n.composition.nitrateType,
            doseLabel: `${Number(e.quantity).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${unitShort((e.unit ?? "").replace(/_per_hectare$/, ""))}${per ? "/ha" : " au total"}`,
            nTotalKgHa: "missing" in n ? null : n.totalKgHa,
            nEfficientKgHa: "missing" in n ? null : n.efficientKgHa,
            missing: "missing" in n ? (n.missing ?? null) : null,
            efficiency: null as RecordApplication["efficiency"],
            form: "missing" in n ? null : mineralFormOf(f, n.composition),
          };
        })
        // Cahier de l'azote : les apports sans azote (potasse, chaux) n'y figurent pas.
        .filter((a) => a.nTotalKgHa === null || a.nTotalKgHa > 0);
      // Efficacité des apports d'azote minéral (lot AL) : celle enregistrée à la saisie, sinon recalculée d'après le cache météo.
      for (const a of applications) {
        if (!a.form) continue;
        const saved = stored.get(a.interventionId)?.find((i) => i.code === "fert_efficiency" && (!i.parcelName || i.parcelName === p.name));
        if (saved) a.efficiency = { level: saved.level === "danger" ? "warning" : (saved.level as "ok" | "info" | "warning"), message: saved.message };
        else {
          const r = efficiencyGrid({ form: a.form, ...(await efficiencyConditions(tx, farmId, p.id, a.date)) });
          a.efficiency = { level: r.quality[0] === "good" ? "ok" : r.quality[0] === "medium" ? "info" : "warning", message: efficiencyMessage(r) };
        }
      }
      const plowed = mine.some((e) => PLOWING.includes(e.procedure));
      // Interculture : travaux et apports sur cette parcelle et sur celle du précédent.
      const around = [...mine.map((e) => ({ ...e, area_m2: p.area_m2 })), ...prevEvents.filter((e) => e.parcel_id === prevs.get(p.id)?.parcel_id)];
      const interculture = [
        ...new Map(
          mine
            .filter((e) => RESIDUES.includes(e.procedure) && (!sown || e.day <= sown) && e.day >= `${campaign - 1}-07-01`)
            .map((e) => [`${e.day}|${e.procedure}`, { date: e.day, label: PROCEDURES.find((x) => x.code === e.procedure)?.label ?? e.procedure }]),
        ).values(),
      ];
      out.push({
        parcelId: p.id,
        name: p.name,
        areaHa: Math.round(areaHa * 100) / 100,
        soilType: p.soil_type,
        zone: p.zone,
        crop: cropLabel(crop),
        variety: p.species && p.species !== p.cultivation ? p.species : null,
        sownOn: sown,
        harvestedOn: harvests,
        yieldQHa: yields.length ? Math.round((yields.reduce((s, v) => s + v, 0) / yields.length) * 10) / 10 : null,
        interculture,
        cover: covers.get(p.id) ?? null,
        soilCover: prevs.has(p.id)
          ? {
              ...soilCoverOf(prevs.get(p.id) ?? null, p.zones, crop, around, sown, covers.get(p.id) ?? null, campaign),
              previousParcelId: prevs.get(p.id)?.parcel_id ?? null,
              harvestedOn: previousHarvest(around, sown, campaign),
            }
          : null,
        aplsh: prevs.has(p.id) ? coverAplsh(around, Number(p.area_m2), sown, covers.get(p.id) ?? null, campaign, fertilizers, settings.aplshZone ?? defaultAplshZone(p.insee?.slice(0, 2) ?? null)) : null,
        steering: p.plan_id ? (steering.get(p.plan_id) ?? []) : [],
        // Trois campagnes de recul ne sont pas toutes chargées : « null » quand on ne peut pas conclure.
        noPlowing: plowed ? false : null,
        applications: applications.map(({ form: _form, ...a }) => a),
        totalNKgHa: Math.round(applications.reduce((s, a) => s + (a.nEfficientKgHa ?? 0), 0)),
        plannedDose: num(p.dose),
        planVersion: p.version,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const all = out.flatMap((p) => p.applications);
    return {
      campaign,
      from: w.from,
      to: w.to,
      parcels: out,
      toComplete: all.filter((a) => a.missing).length,
      late: all.filter((a) => a.late).length,
      forced: forced.map((f) => ({ interventionId: f.id, date: f.day, parcels: f.parcels, reason: f.reason })),
    };
  });
}
