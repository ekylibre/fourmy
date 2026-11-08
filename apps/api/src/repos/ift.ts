import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { articleUnitBase } from "@fourmy/domain";
import type { IftResult } from "@fourmy/contracts";

/**
 * IFT des traitements (exigence IFT-1) : API IFT v5 du ministère de
 * l'Agriculture, ouverte sans compte. Un IFT par produit et par parcelle,
 * corrigé de la part de la parcelle réellement traitée ; le total de
 * l'intervention est la moyenne pondérée par les surfaces. Calculé par le
 * worker après la réalisation (ou à la demande depuis la fiche) ; une API
 * indisponible laisse l'IFT « en attente », recalculé plus tard.
 */

/** API de préproduction (recette), par défaut : locale, tests, dev.fourmy.org. */
export const IFT_API_PREPROD = "https://ecoagri-pprd.api.agriculture.gouv.fr/ift/v5/api";
/** API de production : à régler explicitement (`FOURMY_IFT_API_URL`) sur la seule production. */
export const IFT_API_PRODUCTION = "https://ecoagri.api.agriculture.gouv.fr/ift/v5/api";
export const IFT_API = process.env.FOURMY_IFT_API_URL || IFT_API_PREPROD;
const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];

const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

let culturesCache: { at: number; byLabel: Map<string, string> } | null = null;

/** Cultures de l'API IFT (code, libellé), mises en cache une journée. */
async function iftCultures(fetchImpl: typeof fetch): Promise<Map<string, string>> {
  if (culturesCache && Date.now() - culturesCache.at < 86_400_000) return culturesCache.byLabel;
  const res = await fetchImpl(`${IFT_API}/cultures/csv`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`API IFT : cultures indisponibles (${res.status})`);
  const byLabel = new Map<string, string>();
  for (const line of (await res.text()).split(/\r?\n/).slice(1)) {
    const [code, label] = line.split("\t");
    if (code && label) byLabel.set(normalize(label), code.trim());
  }
  culturesCache = { at: Date.now(), byLabel };
  return byLabel;
}

/** Type de traitement IFT d'après la nature du produit (E-Phy). */
export function treatmentType(natures: string[]): string {
  const n = natures.map(normalize);
  if (n.some((x) => x.startsWith("herbicide"))) return "T21";
  if (n.some((x) => x.startsWith("fongicide") || x.startsWith("bactericide"))) return "T23";
  if (n.some((x) => x.startsWith("insecticide") || x.startsWith("acaricide"))) return "T22";
  return "T24";
}

interface IftApiResult {
  ift?: number;
  segment?: { libelle?: string };
  doseReference?: number;
  avertissement?: { libelle?: string } | null;
}

/** Calcule et enregistre l'IFT d'une intervention réalisée. */
export async function computeInterventionIft(db: Database, farmId: string, interventionId: string, fetchImpl: typeof fetch = fetch): Promise<IftResult> {
  const context = await withFarm(db, farmId, async (tx) => {
    const [i] = await rows<{ status: string; stopped_at: string | null }>(tx, sql`SELECT status, stopped_at FROM interventions WHERE id = ${interventionId}`);
    if (!i || i.status !== "done" || !i.stopped_at) return null;
    const inputs = await rows<{ article_id: string; quantity: number; unit: string | null; article_unit: string; amm: string | null; natures: string[] | null }>(
      tx,
      sql`SELECT a.id AS article_id, p.quantity::float8 AS quantity, p.unit, a.unit AS article_unit, nullif(btrim(a.amm), '') AS amm,
                 (SELECT pp.natures FROM phyto_products pp WHERE pp.amm = btrim(a.amm) ORDER BY (pp.state = 'authorized') DESC LIMIT 1) AS natures
          FROM intervention_parameters p JOIN articles a ON a.id = p.ref_id
          WHERE p.intervention_id = ${interventionId} AND p.role = 'input' AND a.kind = 'phyto'`,
    );
    const parcels = await rows<{ id: string; area: number | null; worked: number | null; zone_area: number | null; labels: string[] | null }>(
      tx,
      sql`SELECT t.ref_id AS id,
                 (SELECT area_m2::float8 FROM land_parcel_versions v WHERE v.land_parcel_id = t.ref_id AND v.valid @> ${i.stopped_at}::timestamptz LIMIT 1) AS area,
                 (t.attrs->>'workedAreaM2')::float8 AS worked,
                 CASE WHEN t.working_zone IS NULL THEN NULL ELSE ST_Area(t.working_zone::geography) END AS zone_area,
                 (WITH RECURSIVE l AS (
                    SELECT reference_name, parent, label, 0 AS depth FROM taxonomy
                    WHERE reference_name = (SELECT coalesce(p.cultivation, CASE p.nature WHEN 'vine' THEN 'vitis' END) FROM productions p JOIN campaigns c ON c.id = p.campaign_id
                                            WHERE p.land_parcel_id = t.ref_id AND ${i.stopped_at}::timestamptz::date BETWEEN c.starts_on AND c.stops_on
                                            ORDER BY coalesce(p.cultivation, CASE p.nature WHEN 'vine' THEN 'vitis' END) NULLS LAST LIMIT 1)
                    UNION ALL SELECT x.reference_name, x.parent, x.label, l.depth + 1 FROM taxonomy x JOIN l ON x.reference_name = l.parent WHERE l.depth < 30)
                  SELECT array_agg(label ORDER BY depth) FROM l) AS labels
          FROM intervention_parameters t
          WHERE t.intervention_id = ${interventionId} AND t.role = 'target' AND t.ref_type = 'land_parcel'`,
    );
    return { stoppedAt: i.stopped_at, inputs, parcels };
  });
  if (!context) return { status: "unavailable", total: null, lines: [], computedAt: null, error: "Intervention non réalisée.", retryAt: null };

  const campaign = new Date(context.stoppedAt).getFullYear();
  const lines: IftResult["lines"] = [];
  let error: string | null = null;
  let cultures: Map<string, string> | null = null;
  try {
    cultures = await iftCultures(fetchImpl);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (cultures) {
    for (const input of context.inputs) {
      for (const parcel of context.parcels) {
        const line = { articleId: input.article_id, parcelId: parcel.id, ift: null as number | null, segment: null as string | null, doseReference: null as number | null, warning: null as string | null };
        lines.push(line);
        const culture = (parcel.labels ?? []).map((l) => (l ? cultures!.get(normalize(l)) : undefined)).find(Boolean);
        const base = articleUnitBase(input.article_unit);
        if (!input.amm) {
          line.warning = "Produit sans n° AMM.";
          continue;
        }
        if (!culture) {
          line.warning = "Culture sans correspondance dans le référentiel IFT.";
          continue;
        }
        if (!base) {
          line.warning = `Unité « ${input.article_unit} » non convertible.`;
          continue;
        }
        const treated = parcel.worked ?? parcel.zone_area ?? parcel.area ?? 0;
        const perHa = input.unit?.endsWith("_per_hectare") ? input.quantity * base.factor : treated > 0 ? (input.quantity * base.factor) / (treated / 10_000) : null;
        if (perHa === null) {
          line.warning = "Surface traitée inconnue.";
          continue;
        }
        const params = new URLSearchParams({
          campagneIdMetier: String(campaign),
          numeroAmmIdMetier: input.amm,
          cultureIdMetier: culture,
          typeTraitementIdMetier: treatmentType(input.natures ?? []),
          uniteIdMetier: base.base === "L" ? "U3" : "U1",
          dose: String(Math.round(perHa * 10_000) / 10_000),
        });
        try {
          const res = await fetchImpl(`${IFT_API}/ift/traitement?${params}`, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) throw new Error(`API IFT : HTTP ${res.status}`);
          const r = (await res.json()) as IftApiResult;
          // Part de la parcelle réellement traitée (zone de travail partielle).
          const share = parcel.area && treated ? Math.min(treated / parcel.area, 1) : 1;
          line.ift = typeof r.ift === "number" ? Math.round(r.ift * share * 10_000) / 10_000 : null;
          line.segment = r.segment?.libelle ?? null;
          line.doseReference = typeof r.doseReference === "number" ? r.doseReference : null;
          line.warning = r.avertissement?.libelle ?? null;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          break;
        }
      }
      if (error) break;
    }
  }

  const now = new Date().toISOString();
  let result: IftResult;
  if (error) {
    result = { status: "pending", total: null, lines: [], computedAt: null, error, retryAt: new Date(Date.now() + 3_600_000).toISOString() };
  } else {
    // Total de l'intervention : somme par parcelle, moyenne pondérée par les surfaces.
    const byParcel = new Map<string, number>();
    for (const l of lines) if (l.ift !== null) byParcel.set(l.parcelId, (byParcel.get(l.parcelId) ?? 0) + l.ift);
    const areas = new Map(context.parcels.map((p) => [p.id, p.area ?? 0]));
    const area = [...byParcel.keys()].reduce((t, id) => t + (areas.get(id) ?? 0), 0);
    const total = area > 0 ? [...byParcel].reduce((t, [id, v]) => t + v * (areas.get(id) ?? 0), 0) / area : null;
    result = {
      status: lines.some((l) => l.ift !== null) ? "ok" : "unavailable",
      total: total === null ? null : Math.round(total * 1000) / 1000,
      lines,
      computedAt: now,
      error: lines.length && lines.every((l) => l.ift === null) ? (lines[0]!.warning ?? "IFT non calculable.") : null,
      retryAt: null,
    };
  }
  await withFarm(db, farmId, (tx) => tx.execute(sql`UPDATE interventions SET ift = ${JSON.stringify(result)}::jsonb WHERE id = ${interventionId}`));
  return result;
}

/** Interventions réalisées à calculer (toutes fermes), pour le worker. */
export async function pendingIft(db: Database, limit = 50): Promise<{ id: string; farm_id: string }[]> {
  return (await db.execute(sql`SELECT id, farm_id FROM fourmy_ift_pending(${limit})`)) as unknown as { id: string; farm_id: string }[];
}

/**
 * Bilan IFT d'une campagne : par parcelle (somme des traitements) et pour la
 * ferme (moyenne pondérée par les surfaces des parcelles de la campagne,
 * non traitées comprises), par segment (herbicides, hors herbicides…).
 */
export async function iftBalance(db: Database, farmId: string, year: number) {
  return withFarm(db, farmId, async (tx) => {
    const lines = await rows<{ intervention_id: string; parcel_id: string; ift: number | null; segment: string | null; status: string }>(
      tx,
      sql`SELECT i.id AS intervention_id, l->>'parcelId' AS parcel_id, (l->>'ift')::float8 AS ift, l->>'segment' AS segment, i.ift->>'status' AS status
          FROM interventions i LEFT JOIN LATERAL jsonb_array_elements(coalesce(i.ift->'lines', '[]'::jsonb)) l ON true
          WHERE i.status = 'done' AND extract(year FROM i.stopped_at) = ${year}
            AND EXISTS (SELECT 1 FROM intervention_parameters p JOIN articles a ON a.id = p.ref_id
                        WHERE p.intervention_id = i.id AND p.role = 'input' AND a.kind = 'phyto')`,
    );
    const parcels = await rows<{ id: string; name: string; area: number }>(
      tx,
      sql`SELECT lp.id, lp.name, v.area_m2::float8 AS area FROM land_parcels lp
          JOIN land_parcel_versions v ON v.land_parcel_id = lp.id AND v.valid @> ${`${year}-06-30T12:00:00Z`}::timestamptz`,
    );
    const pending = new Set(lines.filter((l) => l.status !== "ok").map((l) => l.intervention_id)).size;
    const perParcel = new Map<string, { total: number; segments: Record<string, number> }>();
    for (const l of lines) {
      if (l.ift === null || !l.parcel_id) continue;
      const p = perParcel.get(l.parcel_id) ?? { total: 0, segments: {} };
      p.total += l.ift;
      const seg = l.segment ?? "Autres";
      p.segments[seg] = (p.segments[seg] ?? 0) + l.ift;
      perParcel.set(l.parcel_id, p);
    }
    const area = parcels.reduce((t, p) => t + p.area, 0);
    const segments: Record<string, number> = {};
    let total = 0;
    for (const p of parcels) {
      const v = perParcel.get(p.id);
      if (!v) continue;
      total += (v.total * p.area) / (area || 1);
      for (const [s, x] of Object.entries(v.segments)) segments[s] = (segments[s] ?? 0) + (x * p.area) / (area || 1);
    }
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    return {
      campaign: year,
      total: r3(total),
      segments: Object.fromEntries(Object.entries(segments).map(([k, v]) => [k, r3(v)])),
      pendingInterventions: pending,
      parcels: parcels
        .map((p) => ({ id: p.id, name: p.name, areaM2: p.area, ift: r3(perParcel.get(p.id)?.total ?? 0), segments: Object.fromEntries(Object.entries(perParcel.get(p.id)?.segments ?? {}).map(([k, v]) => [k, r3(v)])) }))
        .sort((a, b) => b.ift - a.ift),
    };
  });
}
