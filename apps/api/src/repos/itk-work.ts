import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  itkWorkSettings,
  type ItkContent,
  type ItkEquipmentInfo,
  type ItkMachineryRateInfo,
  type ItkRoute,
  type ItkWorkContext,
} from "@fourmy/contracts";
import {
  MACHINERY_RATES_SOURCE,
  PROCEDURE_FAMILIES,
  cite,
  familyRatePerMeter,
  hectareRate,
  machineryRate,
  machineryRatesFor,
  suggestMachineryRate,
} from "@fourmy/certification-refs";
import { resolveAvatar, typeFromName } from "@fourmy/equipment-3d";
import { OSRM_URL, distanceM } from "../osrm.js";
import { BadRequest, NotFound } from "../routes/helpers.js";

/**
 * Temps de travaux de l'assolement (lot IT4, claudedocs/conception_assolement_itk.md
 * §8 et §15.3) : contexte chargé une fois par l'écran (ITK, matériels et leur
 * débit de référence, débits observés, trajets, réglages) ; le calcul se fait
 * dans le navigateur (`workload`).
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];


/** Débits observés retenus : chantiers à l'heure près, hors imports, au moins 3, entre 0,1 et 50 ha/h. */
const OBSERVED = { min: 0.1, max: 50, samples: 3, campaigns: 3 };
/** Repli sans OSRM : distance à vol d'oiseau × détour, à la vitesse moyenne d'un tracteur sur route. */
export const ROUTE_ESTIMATE = { detour: 1.3, speedKmh: 25 };

const rateInfo = (id: string): ItkMachineryRateInfo | null => {
  const r = machineryRate(id);
  return r ? { id: r.id, label: r.label, family: r.family, widthM: r.widthM, haH: hectareRate(r) } : null;
};

/** Matériels de la ferme : largeur résolue (comme l'avatar), rattachement au barème, proposition. */
async function equipmentsOf(tx: Tx): Promise<ItkEquipmentInfo[]> {
  const list = await rows<{ id: string; name: string; kind: string; equipment_type: string | null; technical: unknown; avatar: Record<string, unknown> | null; machinery_rate_id: string | null }>(
    tx,
    sql`SELECT id, name, kind, equipment_type, technical, avatar, machinery_rate_id FROM equipments WHERE coalesce(state, 'active') = 'active' ORDER BY name`,
  );
  return list.map((e) => {
    const saved = Object.fromEntries(Object.entries(e.avatar ?? {}).filter(([, v]) => v !== null && v !== undefined));
    const a = resolveAvatar({ kind: e.kind, type: e.equipment_type, name: e.name, technical: e.technical, saved });
    const widthM = a.params.workingWidthM > 0 ? a.params.workingWidthM : null;
    const type = e.equipment_type ?? typeFromName(e.name);
    const carrier = e.kind === "tractor" || type === "tractor";
    return {
      id: e.id,
      name: e.name,
      widthM: carrier ? null : widthM,
      machineryRateId: e.machinery_rate_id,
      suggestedRateId: carrier ? null : (suggestMachineryRate(type, widthM)?.id ?? null),
      carrier,
    };
  });
}

/** Médiane surface / durée par procédure et matériel, sur les dernières campagnes. */
async function observedRates(tx: Tx, year: number) {
  return rows<{ procedure: string; equipment_id: string; ha_h: number; samples: number }>(
    tx,
    sql`WITH chantiers AS (
          SELECT i.id, i.procedure,
                 (SELECT sum(extract(epoch FROM q.stopped_at - q.started_at)) FROM intervention_periods q WHERE q.intervention_id = i.id) / 3600.0 AS hours,
                 (SELECT sum(coalesce((t.attrs->>'workedAreaM2')::float8,
                                      (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = t.ref_id AND v.valid @> i.started_at LIMIT 1)))
                  FROM intervention_parameters t WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel') / 10000.0 AS ha
          FROM interventions i
          WHERE i.status = 'done' AND i.period_precision = 'time' AND i.origin <> 'import'
            AND i.started_at >= make_date(${year - OBSERVED.campaigns - 1}, 8, 1))
        SELECT c.procedure, p.ref_id AS equipment_id,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY c.ha / c.hours)::float8 AS ha_h, count(*)::int AS samples
        FROM chantiers c JOIN intervention_parameters p ON p.intervention_id = c.id AND p.role = 'tool' AND p.ref_type = 'equipment'
        WHERE c.hours > 0 AND c.ha > 0 AND c.ha / c.hours BETWEEN ${OBSERVED.min} AND ${OBSERVED.max}
        GROUP BY c.procedure, p.ref_id HAVING count(*) >= ${OBSERVED.samples}`,
  );
}

/** Site de départ : celui des réglages, sinon le siège ; localisé, sinon null. */
async function startSite(tx: Tx, siteId: string | null) {
  const [s] = await rows<{ id: string; name: string; lon: number; lat: number }>(
    tx,
    sql`SELECT id, name, ST_X(location)::float8 AS lon, ST_Y(location)::float8 AS lat FROM farm_sites
        WHERE location IS NOT NULL ${siteId ? sql`AND id = ${siteId}` : sql`AND is_headquarters`}
        ORDER BY position LIMIT 1`,
  );
  return s ?? null;
}

type Fetch = typeof fetch;

/** Durées et distances du site vers chaque point (service `table` d'OSRM, profil tracteur) ; null en cas d'échec. */
export async function osrmTable(origin: [number, number], points: [number, number][], base = OSRM_URL, fetchFn: Fetch = fetch): Promise<{ durationS: number; distanceM: number }[] | null> {
  if (!base || !points.length) return null;
  const out: { durationS: number; distanceM: number }[] = [];
  for (let k = 0; k < points.length; k += 90) {
    const chunk = points.slice(k, k + 90);
    const coords = [origin, ...chunk].map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(";");
    try {
      const res = await fetchFn(`${base}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { code: string; durations?: (number | null)[][]; distances?: (number | null)[][] };
      if (body.code !== "Ok" || !body.durations || !body.distances) return null;
      chunk.forEach((_, i) => {
        const d = body.durations![0]![i + 1];
        const m = body.distances![0]![i + 1];
        out.push(d === null || d === undefined || m === null || m === undefined ? { durationS: -1, distanceM: -1 } : { durationS: Math.round(d), distanceM: Math.round(m) });
      });
    } catch {
      return null;
    }
  }
  return out;
}

const estimate = (origin: [number, number], p: [number, number]): ItkRoute => {
  const d = distanceM(origin, p) * ROUTE_ESTIMATE.detour;
  return { distanceM: Math.round(d), durationS: Math.round((d / 1000 / ROUTE_ESTIMATE.speedKmh) * 3600), method: "estimate" };
};

/**
 * Trajets du site vers les parcelles valides pendant la campagne (point
 * intérieur de la forme) : cache `parcel_routes` (empreinte du point et du
 * site), sinon OSRM, sinon estimation à vol d'oiseau.
 */
async function routesOf(tx: Tx, farmId: string, year: number, site: { id: string; lon: number; lat: number } | null): Promise<Record<string, ItkRoute>> {
  if (!site) return {};
  const parcels = await rows<{ id: string; lon: number; lat: number }>(
    tx,
    sql`SELECT DISTINCT ON (v.land_parcel_id) v.land_parcel_id AS id, ST_X(ST_PointOnSurface(v.shape))::float8 AS lon, ST_Y(ST_PointOnSurface(v.shape))::float8 AS lat
        FROM land_parcel_versions v
        WHERE v.valid && tstzrange(make_date(${year - 1}, 8, 1)::timestamptz, make_date(${year}, 12, 31)::timestamptz)
        ORDER BY v.land_parcel_id, lower(v.valid) DESC`,
  );
  const origin: [number, number] = [site.lon, site.lat];
  const hashOf = (p: { lon: number; lat: number }) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}|${site.lon.toFixed(5)},${site.lat.toFixed(5)}`;
  const cached = new Map(
    (await rows<{ parcel_key: string; shape_hash: string; distance_m: number; duration_s: number; method: ItkRoute["method"] }>(
      tx,
      sql`SELECT parcel_key, shape_hash, distance_m, duration_s, method FROM parcel_routes WHERE site_id = ${site.id}`,
    )).map((r) => [r.parcel_key, r]),
  );
  const out: Record<string, ItkRoute> = {};
  const missing: typeof parcels = [];
  for (const p of parcels) {
    const c = cached.get(p.id);
    // Une estimation en cache est recalculée quand OSRM est disponible.
    if (c && c.shape_hash === hashOf(p) && (c.method === "osrm" || !OSRM_URL)) out[`p:${p.id}`] = { distanceM: c.distance_m, durationS: c.duration_s, method: c.method };
    else missing.push(p);
  }
  if (missing.length) {
    const table = await osrmTable(origin, missing.map((p) => [p.lon, p.lat]));
    for (const [i, p] of missing.entries()) {
      const t = table?.[i];
      const route: ItkRoute = t && t.durationS >= 0 ? { distanceM: t.distanceM, durationS: t.durationS, method: "osrm" } : estimate(origin, [p.lon, p.lat]);
      out[`p:${p.id}`] = route;
      await tx.execute(sql`
        INSERT INTO parcel_routes (farm_id, site_id, parcel_key, shape_hash, distance_m, duration_s, method)
        VALUES (${farmId}, ${site.id}, ${p.id}, ${hashOf(p)}, ${route.distanceM}, ${route.durationS}, ${route.method})
        ON CONFLICT (farm_id, site_id, parcel_key) DO UPDATE SET shape_hash = excluded.shape_hash, distance_m = excluded.distance_m,
          duration_s = excluded.duration_s, method = excluded.method, computed_at = now()`);
    }
  }
  return out;
}

export async function itkWorkContext(db: Database, farmId: string, year: number, opts: { routes?: boolean } = {}): Promise<ItkWorkContext> {
  return withFarm(db, farmId, async (tx) => {
    const [settingsRow] = await rows<{ work: unknown }>(tx, sql`SELECT crop_plan->'work' AS work FROM farm_settings`);
    const settings = itkWorkSettings.parse(settingsRow?.work ?? {});
    const itks = await rows<{ id: string; name: string; revision: number; activity_id: string | null; content: ItkContent }>(
      tx,
      sql`SELECT id, name, revision, activity_id, content FROM technical_itineraries ORDER BY name`,
    );
    const equipments = await equipmentsOf(tx);
    const people = await rows<{ id: string; name: string }>(
      tx,
      sql`SELECT id, coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), name) AS name FROM people WHERE active ORDER BY name`,
    );
    const crewTemplates: ItkWorkContext["crewTemplates"] = {};
    for (const m of await rows<{ template_id: string; equipment_id: string | null; person_id: string | null }>(
      tx,
      sql`SELECT m.template_id, m.equipment_id, m.person_id FROM crew_template_members m JOIN crew_templates t ON t.id = m.template_id WHERE t.active ORDER BY m.rank`,
    )) {
      const c = (crewTemplates[m.template_id] ??= { equipmentIds: [], personIds: [] });
      if (m.equipment_id) c.equipmentIds.push(m.equipment_id);
      if (m.person_id) c.personIds.push(m.person_id);
    }
    // Lignes du barème citées : matériels rattachés ou proposés, étapes des ITK.
    const ids = new Set<string>();
    for (const e of equipments) for (const id of [e.machineryRateId, e.suggestedRateId]) if (id) ids.add(id);
    for (const t of itks) for (const s of t.content.steps) if (s.staffing.machineryRateId) ids.add(s.staffing.machineryRateId);
    const machineryRates = Object.fromEntries([...ids].map((id) => [id, rateInfo(id)]).filter((x): x is [string, ItkMachineryRateInfo] => !!x[1]));
    const familyPerMeter = Object.fromEntries(
      Object.entries(PROCEDURE_FAMILIES)
        .map(([procedure, families]) => [procedure, familyRatePerMeter(families[0]!)] as const)
        .filter((x): x is readonly [string, number] => x[1] !== null),
    );
    const site = await startSite(tx, settings.defaultSiteId);
    return {
      year,
      itineraries: Object.fromEntries(itks.map((t) => [t.id, { id: t.id, name: t.name, revision: t.revision, activityId: t.activity_id, content: t.content }])),
      equipments,
      people,
      crewTemplates,
      observed: (await observedRates(tx, year)).map((o) => ({ procedure: o.procedure, equipmentId: o.equipment_id, haH: Math.round(o.ha_h * 100) / 100, samples: o.samples })),
      machineryRates,
      familyPerMeter,
      // Sans trajets pour l'éditeur d'ITK (heures par hectare) : pas de calcul ni d'écriture.
      routes: opts.routes === false ? {} : await routesOf(tx, farmId, year, site),
      site: site ? { id: site.id, name: site.name } : null,
      settings,
      rateSource: cite(MACHINERY_RATES_SOURCE),
    };
  });
}

/** Lignes du barème pour un choix (procédure, recherche), limitées. */
export function searchMachineryRates(procedure: string | null, q: string, limit = 200): ItkMachineryRateInfo[] {
  const words = q
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return machineryRatesFor(procedure)
    .filter((r) => words.every((w) => plain(`${r.family} ${r.label}`).includes(w)))
    .slice(0, limit)
    .map((r) => ({ id: r.id, label: r.label, family: r.family, widthM: r.widthM, haH: hectareRate(r) }));
}

/** Rattache (ou détache) un matériel à une ligne du barème. */
export async function setMachineryRate(db: Database, farmId: string, equipmentId: string, machineryRateId: string | null): Promise<{ machineryRateId: string | null; rate: ItkMachineryRateInfo | null }> {
  if (machineryRateId && !machineryRate(machineryRateId)) throw new BadRequest("Ligne du barème inconnue.");
  return withFarm(db, farmId, async (tx) => {
    const updated = await rows<{ id: string }>(tx, sql`UPDATE equipments SET machinery_rate_id = ${machineryRateId}, updated_at = now() WHERE id = ${equipmentId} RETURNING id`);
    if (!updated.length) throw new NotFound("Matériel introuvable.");
    return { machineryRateId, rate: machineryRateId ? rateInfo(machineryRateId) : null };
  });
}

/** Matériels de la ferme avec leur rattachement au barème et la proposition (fiche, réglages). */
export async function equipmentRates(db: Database, farmId: string): Promise<(ItkEquipmentInfo & { rate: ItkMachineryRateInfo | null; suggested: ItkMachineryRateInfo | null })[]> {
  return withFarm(db, farmId, async (tx) =>
    (await equipmentsOf(tx)).map((e) => ({ ...e, rate: e.machineryRateId ? rateInfo(e.machineryRateId) : null, suggested: e.suggestedRateId ? rateInfo(e.suggestedRateId) : null })),
  );
}


