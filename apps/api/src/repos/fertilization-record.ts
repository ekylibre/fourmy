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
} from "@fourmy/contracts";
import { checkCalendar, cropGroupOf, effectiveComposition, isMaizeOrSorghum, isStrawCereal, nitrogenOfInput } from "@fourmy/domain";
import type { CropGroup } from "@fourmy/fertilization-refs";
import { cropLabel } from "./fertilization-plans.js";
import { getSettings } from "./fertilization-context.js";
import { listFertilizers } from "./fertilizers.js";

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
  plan: { dose: number; version: number } | null;
}

async function parcelCrops(tx: Tx, farmId: string, parcelIds: string[], day: string, startMmdd: string): Promise<ParcelCrop[]> {
  if (!parcelIds.length) return [];
  const campaign = campaignOf(day, startMmdd);
  const list = await rows<{ id: string; name: string; reference: string | null; cultivation: string | null; year: number | null; irrigated: boolean | null; zones: string[] | null; status: string | null; dose: string | null; version: number | null }>(
    tx,
    sql`SELECT lp.id, lp.name, pr.reference, pr.cultivation, pr.year, ps.irrigated, z.zones, z.status, v.dose_efficient AS dose, v.version
        FROM land_parcels lp
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
    plan: r.dose !== null && r.version !== null ? { dose: Number(r.dose), version: r.version } : null,
  }));
}

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
export async function checkApplication(db: Database, farmId: string, req: FertilizationCheckRequest): Promise<FertilizationCheck> {
  const fertilizers = new Map((await listFertilizers(db, farmId)).map((f) => [f.id, f]));
  const settings = await getSettings(db, farmId);
  const day = req.startedAt.slice(0, 10);
  const fert = req.inputs.filter((i) => fertilizers.has(i.articleId));
  if (!fert.length) return { level: "ok", nitrogen: null, indicators: [] };
  return withFarm(db, farmId, async (tx) => {
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
        indicators.push({
          code: "fert_plan",
          level: "warning",
          message: `Dépassement du plan (version ${p.plan.version}) : ${so.total + Math.round(efficient)} kg N apportés pour ${p.plan.dose} kg prévus. Justifiez-le par une mesure de pilotage.`,
          parcelName: p.name,
        });
      } else if (efficient !== null) {
        indicators.push({ code: "fert_plan", level: "ok", message: `${so.total + Math.round(efficient)} kg N apportés sur ${p.plan.dose} kg prévus (reste ${Math.max(0, p.plan.dose - so.total - Math.round(efficient))} kg).`, parcelName: p.name });
      }
      if (so.count === 0 && efficient !== null && efficient > 50 && (isMaizeOrSorghum(p.crop) || (isStrawCereal(p.crop) && p.crop !== "barley_spring"))) {
        indicators.push({ code: "fert_first_split", level: "warning", message: `Premier apport de ${Math.round(efficient)} kg N : 50 kg au plus (PAR 7 Nouvelle-Aquitaine).`, parcelName: p.name });
      }
    }
    return {
      level: worst(indicators.map((x) => x.level)),
      nitrogen: { totalKgHa: Math.round(total * 10) / 10, efficientKgHa: efficient === null ? null : Math.round(efficient * 10) / 10 },
      indicators,
    };
  });
}

// --- Cahier d'enregistrement -------------------------------------------------------------------

/**
 * Cahier d'enregistrement d'une campagne (FR-FERT-19 à 22) : pour chaque
 * parcelle cultivée, l'interculture (travaux des résidus), la culture, le
 * semis, les apports (date, surface, produit, teneur, azote), les récoltes et
 * le rendement, les techniques culturales simplifiées.
 */
export async function fertilizationRecord(db: Database, farmId: string, campaign: number): Promise<FertilizationRecord> {
  const settings = await getSettings(db, farmId);
  const w = window(campaign, settings.campaignStartMmdd);
  const fertilizers = new Map((await listFertilizers(db, farmId)).map((f) => [f.id, f]));
  return withFarm(db, farmId, async (tx) => {
    const parcels = await rows<{ id: string; name: string; area_m2: string; soil_type: string | null; zone: string | null; reference: string | null; cultivation: string | null; species: string | null; dose: string | null; version: number | null }>(
      tx,
      sql`SELECT DISTINCT ON (lp.id) lp.id, lp.name,
                 (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = lp.id
                  ORDER BY (v.valid @> make_date(${campaign}, 6, 1)::timestamptz) DESC, upper(v.valid) DESC NULLS FIRST LIMIT 1) AS area_m2,
                 ps.soil_type, z.status AS zone, a.reference, coalesce(pr.cultivation, a.cultivation) AS cultivation, pr.species,
                 v.dose_efficient AS dose, v.version
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
      const applications: RecordApplication[] = inCampaign
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
            doseLabel: `${Number(e.quantity).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${(e.unit ?? "").replace(/_per_hectare$/, "")}${per ? "/ha" : " au total"}`,
            nTotalKgHa: "missing" in n ? null : n.totalKgHa,
            nEfficientKgHa: "missing" in n ? null : n.efficientKgHa,
            missing: "missing" in n ? (n.missing ?? null) : null,
          };
        })
        // Cahier de l'azote : les apports sans azote (potasse, chaux) n'y figurent pas.
        .filter((a) => a.nTotalKgHa === null || a.nTotalKgHa > 0);
      const plowed = mine.some((e) => PLOWING.includes(e.procedure));
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
        // Trois campagnes de recul ne sont pas toutes chargées : « null » quand on ne peut pas conclure.
        noPlowing: plowed ? false : null,
        applications,
        totalNKgHa: Math.round(applications.reduce((s, a) => s + (a.nEfficientKgHa ?? 0), 0)),
        plannedDose: num(p.dose),
        planVersion: p.version,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const all = out.flatMap((p) => p.applications);
    return { campaign, from: w.from, to: w.to, parcels: out, toComplete: all.filter((a) => a.missing).length, late: all.filter((a) => a.late).length };
  });
}
