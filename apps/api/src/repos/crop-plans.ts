import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { cycleFromLexicon, REFS_VERSION, type CropCycle } from "@fourmy/certification-refs";
import {
  cropPlanSettings,
  type ActivityFamily,
  type ControlSection,
  type CropPlanChange,
  type CropPlanContext,
  type CropPlanDraft,
  type CropPlanDraftWrite,
  type CropPlanListItem,
  type CropPlanSettings,
  type CropPlanValidateWrite,
  type CropPlanValidation,
  type CropPlanVersionView,
  type CropPlanView,
  type CropPlanYearCrop,
} from "@fourmy/contracts";
import { legumeOf } from "./taxonomy.js";
import { checkCropPlan, cropPlanCheckInput, diffCropPlan, emptyDraft, operationBlockers, parcelKeyOf, resolveParcels, type ExistingCover, type ExistingProduction } from "@fourmy/domain";
import { Conflict, NotFound } from "../routes/helpers.js";
import { natureOf, pictureUrl } from "./activities.js";
import { getCertificationSettings } from "./certification-controls.js";

/**
 * Assolement prévisionnel, lot AS2a (claudedocs/conception_assolement.md §3,
 * §5, §6) : brouillon d'une campagne, contexte des contrôles, validation
 * (productions, découpes et fusions de parcelles, couverts d'interculture),
 * réouverture, versions.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const uuids = (ids: string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;
const HISTORY_YEARS = 5;

/** Rôle d'une production : celui fixé par l'assolement, sinon « dérobée » des imports. */
const ROLE = sql`coalesce(p.attrs->'cropPlan'->>'role', CASE WHEN p.attrs->>'secondary' = 'true' THEN 'secondary' ELSE 'main' END)`;

/** Code culture PAC d'une activité : saisi, sinon celui de sa production de référence (Lexicon). */
const activityCapCode = (year: SQL | number) => sql`coalesce(a.cap_code, (
  SELECT c.cap_code FROM lexicon_cap_codes c WHERE c.production = a.reference AND c.year <= ${year}
  ORDER BY c.year DESC, c.is_seed, c.cap_code LIMIT 1))`;


// --- Réglages -------------------------------------------------------------

async function settingsOf(tx: Tx): Promise<CropPlanSettings> {
  const [r] = await rows<{ crop_plan: unknown }>(tx, sql`SELECT crop_plan FROM farm_settings`);
  return cropPlanSettings.parse(r?.crop_plan ?? undefined);
}

export async function getCropPlanSettings(db: Database, farmId: string): Promise<CropPlanSettings> {
  return withFarm(db, farmId, settingsOf);
}

export async function putCropPlanSettings(db: Database, farmId: string, body: CropPlanSettings): Promise<CropPlanSettings> {
  return withFarm(db, farmId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO farm_settings (farm_id, crop_plan) VALUES (${farmId}, ${JSON.stringify(body)}::jsonb)
      ON CONFLICT (farm_id) DO UPDATE SET crop_plan = excluded.crop_plan, updated_at = now()`);
    return body;
  });
}

// --- Contexte des contrôles (§4.1) ------------------------------------------------

/** Parcellaire de la campagne : chaque parcelle dans sa dernière version qui recouvre l'année. */
type BaseParcelRow = { id: string; name: string; area_m2: number; shape: string; valid_from: string; last_stopped_on: string | null; carry: boolean; activities: string[] | null };

/**
 * Nom d'une parcelle reconduite : sans l'année ni la culture finales que les
 * reprises d'Ekylibre y ajoutent (« Braquet Maïs 2026 » → « Braquet »).
 */
export function carriedName(name: string, activityNames: string[]): string {
  let out = name.trim().replace(/\s+\d{4}$/, "");
  for (const a of [...activityNames].sort((x, y) => y.length - x.length)) {
    const suffix = ` ${a.trim()}`;
    if (a.trim() && out.toLowerCase().endsWith(suffix.toLowerCase())) {
      out = out.slice(0, -suffix.length);
      break;
    }
  }
  return out.trim() || name.trim();
}

/**
 * Parcellaire de départ de la campagne (§3.3) : les parcelles valides pendant
 * l'année, plus celles de l'an passé closes en décembre (fin de campagne) et
 * que rien ne remplace, proposées à la reconduction (lot AS5 : fermes
 * reprises d'Ekylibre, une parcelle par culture et par campagne). Deux
 * parcelles de l'an passé qui se recouvrent (90 %) : la plus grande seule.
 */
async function baseParcels(tx: Tx, year: number) {
  const list = await rows<BaseParcelRow>(
    tx,
    sql`WITH cur AS (
          SELECT lp.id, lp.name, v.area_m2, v.shape, (lower(v.valid) AT TIME ZONE 'Europe/Paris')::date::text AS valid_from, false AS carry
          FROM land_parcels lp
          JOIN LATERAL (
            SELECT v.area_m2, v.shape, v.valid FROM land_parcel_versions v
            WHERE v.land_parcel_id = lp.id AND v.valid && tstzrange(make_date(${year}, 1, 1)::timestamptz, make_date(${year + 1}, 1, 1)::timestamptz)
            ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1) v ON true),
        prev AS (
          SELECT lp.id, lp.name, v.area_m2, v.shape, (lower(v.valid) AT TIME ZONE 'Europe/Paris')::date::text AS valid_from, true AS carry
          FROM land_parcels lp
          JOIN LATERAL (
            SELECT v.area_m2, v.shape, v.valid FROM land_parcel_versions v WHERE v.land_parcel_id = lp.id
            ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1) v ON true
          WHERE upper(v.valid) > make_date(${year - 1}, 12, 1)::timestamptz AND upper(v.valid) <= make_date(${year}, 1, 2)::timestamptz
            AND NOT EXISTS (SELECT 1 FROM cur WHERE ST_Intersects(cur.shape, v.shape)
                            AND ST_Area(ST_Intersection(cur.shape, v.shape)::geography) >= 0.9 * least(ST_Area(cur.shape::geography), ST_Area(v.shape::geography)))),
        prev_kept AS (
          SELECT p.* FROM prev p
          WHERE NOT EXISTS (SELECT 1 FROM prev q WHERE q.id <> p.id AND (q.area_m2, q.id::text) > (p.area_m2, p.id::text) AND ST_Intersects(q.shape, p.shape)
                            AND ST_Area(ST_Intersection(q.shape, p.shape)::geography) >= 0.9 * ST_Area(p.shape::geography)))
        SELECT b.id, b.name, b.area_m2::float8 AS area_m2, ST_AsGeoJSON(b.shape) AS shape, b.valid_from, b.carry,
               (SELECT max(p.stopped_on)::text FROM productions p JOIN campaigns c ON c.id = p.campaign_id
                WHERE p.land_parcel_id = b.id AND c.year < ${year}) AS last_stopped_on,
               (SELECT array_agg(DISTINCT x) FROM (SELECT a.name AS x FROM productions p JOIN activities a ON a.id = p.activity_id WHERE p.land_parcel_id = b.id
                                                   UNION SELECT lx.label FROM productions p JOIN activities a ON a.id = p.activity_id
                                                   JOIN lexicon_productions lx ON lx.reference_name = a.reference WHERE p.land_parcel_id = b.id) n) AS activities
        FROM (SELECT * FROM cur UNION ALL SELECT * FROM prev_kept) b`,
  );
  const out = list.map((r) => (r.carry ? { ...r, source_name: r.name, name: carriedName(r.name, r.activities ?? []) } : { ...r, source_name: r.name }));
  // Deux parcelles reprises au même nom nettoyé (« Cazala Maïs », « Cazala Triticale ») : numérotées, la plus grande d'abord.
  const taken = new Set(out.filter((r) => !r.carry).map((r) => r.name));
  for (const r of [...out].filter((x) => x.carry).sort((a, b) => b.area_m2 - a.area_m2)) {
    let name = r.name;
    for (let n = 2; taken.has(name); n++) name = `${r.name} ${n}`;
    r.name = name;
    taken.add(name);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

async function contextActivities(tx: Tx, year: number): Promise<CropPlanContext["activities"]> {
  const list = await rows<{
    id: string;
    name: string;
    family: ActivityFamily;
    color: string | null;
    cap_code: string | null;
    species: string | null;
    life_years: number | null;
    usage: string | null;
    legume: boolean;
    picture: string | null;
    default_started_on: string | null;
    default_stopped_on: string | null;
  }>(
    tx,
    sql`SELECT a.id, a.name, a.family, a.color, ${activityCapCode(year)} AS cap_code,
               coalesce(a.cultivation, lx.specie) AS species, lx.life_years::float8 AS life_years, lx.usage,
               ${legumeOf(sql`coalesce(a.cultivation, lx.specie)`)} AS legume,
               fourmy_activity_picture(coalesce(a.cultivation, lx.specie), a.family, a.reference) AS picture,
               -- Dates types de Lexicon (2000/2001) ramenées à la campagne : la récolte tombe l'année de la campagne.
               (lx.started_on + make_interval(years => ${year} - extract(year FROM lx.stopped_on)::int))::date::text AS default_started_on,
               (lx.stopped_on + make_interval(years => ${year} - extract(year FROM lx.stopped_on)::int))::date::text AS default_stopped_on
        FROM activities a LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference
        ORDER BY a.suspended, a.family, a.name`,
  );
  return list
    .filter((a) => natureOf(a.family))
    .map((a) => ({
      id: a.id,
      name: a.name,
      family: a.family,
      color: a.color,
      capCode: a.cap_code,
      species: a.species,
      cycle: cycleFromLexicon(a.life_years, a.usage) as CropCycle,
      legume: a.legume,
      vegetable: a.usage === "vegetable",
      pictureUrl: pictureUrl(a.picture),
      defaultStartedOn: a.default_started_on,
      defaultStoppedOn: a.default_stopped_on,
    }));
}

/** Historique des parcelles (Y-5 à Y-1) : culture principale (en place au 1er juin), culture secondaire. */
async function history(tx: Tx, parcelIds: string[], year: number): Promise<CropPlanContext["history"]> {
  const out: CropPlanContext["history"] = {};
  if (!parcelIds.length) return out;
  const list = await rows<{
    land_parcel_id: string;
    year: number;
    cap_code: string | null;
    species: string | null;
    label: string | null;
    life_years: number | null;
    usage: string | null;
    cycle: CropCycle | null;
    legume: boolean;
    cover_legume: boolean;
    secondary: boolean;
  }>(
    tx,
    sql`SELECT DISTINCT ON (p.land_parcel_id, c.year) p.land_parcel_id, c.year,
               coalesce(p.attrs->>'capCode', ${activityCapCode(sql`c.year`)}) AS cap_code,
               coalesce(a.cultivation, lx.specie, p.cultivation) AS species, coalesce(a.name, lx.label, p.nature) AS label,
               lx.life_years::float8 AS life_years, lx.usage, p.cycle,
               ${legumeOf(sql`coalesce(a.cultivation, lx.specie, p.cultivation)`)} AS legume,
               EXISTS (SELECT 1 FROM cover_crops cc WHERE cc.land_parcel_id = p.land_parcel_id AND cc.campaign = c.year AND cc.family LIKE '%legumineuses%') AS cover_legume,
               -- Culture secondaire après la principale : dérobée de la campagne, ou couvert de la campagne suivante
               -- semé au plus tard le 15 novembre et en place jusqu'au 15 février (BCAE 7, §3 A).
               (EXISTS (SELECT 1 FROM productions p2 JOIN activities a2 ON a2.id = p2.activity_id
                        WHERE p2.land_parcel_id = p.land_parcel_id AND p2.campaign_id = p.campaign_id
                          AND coalesce(p2.attrs->'cropPlan'->>'role', CASE WHEN p2.attrs->>'secondary' = 'true' THEN 'secondary' ELSE 'main' END) = 'secondary')
                OR EXISTS (SELECT 1 FROM cover_crops cc WHERE cc.land_parcel_id = p.land_parcel_id AND cc.campaign = c.year + 1
                           AND cc.sown_on <= make_date(c.year, 11, 15) AND (cc.destroyed_on IS NULL OR cc.destroyed_on >= make_date(c.year + 1, 2, 15)))) AS secondary
        FROM productions p
        JOIN campaigns c ON c.id = p.campaign_id
        LEFT JOIN activities a ON a.id = p.activity_id
        LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference
        WHERE p.land_parcel_id = ANY(${uuids(parcelIds)}) AND c.year >= ${year - HISTORY_YEARS} AND c.year < ${year}
        ORDER BY p.land_parcel_id, c.year,
                 (${ROLE} = 'secondary'),
                 NOT (coalesce(p.started_on, '-infinity') <= make_date(c.year, 6, 1) AND coalesce(p.stopped_on, 'infinity') >= make_date(c.year, 6, 1)),
                 p.created_at`,
  );
  for (const r of list) {
    const cycle = r.cycle ?? cycleFromLexicon(r.life_years, r.usage);
    const crop: CropPlanYearCrop = {
      main: r.cap_code,
      secondary: r.secondary,
      species: r.species,
      label: r.label,
      legume: r.legume,
      coverLegume: r.cover_legume,
      vegetable: r.usage === "vegetable",
      perennial: cycle !== "annual",
    };
    (out[r.land_parcel_id] ??= {})[String(r.year)] = crop;
  }
  return out;
}

/**
 * Historique hérité (§4.6) : une parcelle née d'une découpe ou d'une fusion
 * reprend, pour les années d'avant sa création, l'historique de sa parcelle
 * d'origine (la plus grande part pour une fusion).
 */
async function inheritedHistory(tx: Tx, ids: string[], year: number, own: CropPlanContext["history"]): Promise<CropPlanContext["history"]> {
  if (!ids.length) return own;
  const links = await rows<{ child_id: string; parent_id: string }>(
    tx,
    sql`SELECT DISTINCT ON (child_id) child_id, parent_id FROM land_parcel_lineage
        WHERE child_id = ANY(${uuids(ids)}) ORDER BY child_id, share DESC`,
  );
  if (!links.length) return own;
  const parents = await history(tx, [...new Set(links.map((l) => l.parent_id))], year);
  const out = { ...own };
  for (const l of links) {
    const inherited = parents[l.parent_id] ?? {};
    out[l.child_id] = { ...inherited, ...(own[l.child_id] ?? {}) };
  }
  return out;
}

/**
 * Zonages des parcelles de la campagne (lot AS4) : part en aire de captage et
 * en site Natura 2000 (Lexicon), point d'eau le plus proche à moins de 50 m.
 */
async function parcelZones(tx: Tx, year: number): Promise<CropPlanContext["zones"]> {
  const list = await rows<{ id: string; catchments: { name: string; share: number }[] | null; natura: { name: string; nature: string; share: number }[] | null; water_name: string | null; water_m: number | null }>(
    tx,
    sql`SELECT lp.id,
               (SELECT json_agg(json_build_object('name', coalesce(w.name, w.basin, ''), 'share', ST_Area(ST_Intersection(w.shape, v.shape)::geography) / nullif(ST_Area(v.shape::geography), 0)))
                FROM lexicon_water_catchments w WHERE ST_Intersects(w.shape, v.shape)) AS catchments,
               (SELECT json_agg(json_build_object('name', coalesce(n.name, n.id), 'nature', n.nature, 'share', ST_Area(ST_Intersection(n.shape, v.shape)::geography) / nullif(ST_Area(v.shape::geography), 0)))
                FROM lexicon_natura2000 n WHERE ST_Intersects(n.shape, v.shape)) AS natura,
               w.name AS water_name, w.distance AS water_m
        FROM land_parcels lp
        JOIN LATERAL (
          SELECT v.shape FROM land_parcel_versions v
          WHERE v.land_parcel_id = lp.id AND v.valid && tstzrange(make_date(${year}, 1, 1)::timestamptz, make_date(${year + 1}, 1, 1)::timestamptz)
          ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1) v ON true
        LEFT JOIN LATERAL (
          SELECT wi.name, ST_Distance(wi.geom::geography, v.shape::geography)::float8 AS distance FROM water_items wi
          WHERE ST_DWithin(wi.geom::geography, v.shape::geography, 50) ORDER BY 2 LIMIT 1) w ON true`,
  );
  const out: CropPlanContext["zones"] = {};
  for (const r of list) {
    if (!r.catchments && !r.natura && r.water_m === null) continue;
    out[r.id] = {
      catchments: r.catchments ?? [],
      natura2000: r.natura ?? [],
      water: r.water_m === null ? null : { name: r.water_name, distanceM: r.water_m },
    };
  }
  return out;
}

/**
 * Historique par recoupement géographique (lot AS5) : pour une année sans
 * culture connue sur la parcelle (ni par filiation), la culture de la parcelle
 * de la ferme qui en recouvre au moins la moitié cette année-là. Les reprises
 * d'Ekylibre créent une parcelle par culture et par campagne : sans cela,
 * l'historique s'arrête à un an.
 */
async function geometricHistory(tx: Tx, ids: string[], year: number, known: CropPlanContext["history"]): Promise<CropPlanContext["history"]> {
  if (!ids.length) return known;
  const matches = await rows<{ id: string; year: number; other: string }>(
    tx,
    sql`WITH base AS (
          SELECT lp.id, v.shape, ST_Area(v.shape::geography) AS area FROM land_parcels lp
          JOIN LATERAL (SELECT v.shape FROM land_parcel_versions v WHERE v.land_parcel_id = lp.id ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1) v ON true
          WHERE lp.id = ANY(${uuids(ids)}))
        SELECT DISTINCT ON (b.id, c.year) b.id, c.year, p.land_parcel_id AS other
        FROM base b
        JOIN land_parcel_versions ov ON ov.land_parcel_id <> b.id AND ST_Intersects(ov.shape, b.shape)
        JOIN productions p ON p.land_parcel_id = ov.land_parcel_id
        JOIN campaigns c ON c.id = p.campaign_id AND c.year >= ${year - HISTORY_YEARS} AND c.year < ${year}
          AND ov.valid && tstzrange(make_date(c.year, 1, 1)::timestamptz, make_date(c.year + 1, 1, 1)::timestamptz)
        WHERE ST_Area(ST_Intersection(ov.shape, b.shape)::geography) >= 0.5 * b.area
        ORDER BY b.id, c.year, ST_Area(ST_Intersection(ov.shape, b.shape)::geography) DESC`,
  );
  const wanted = matches.filter((m) => !known[m.id]?.[String(m.year)]);
  if (!wanted.length) return known;
  const others = await history(tx, [...new Set(wanted.map((m) => m.other))], year);
  const out = { ...known };
  for (const m of wanted) {
    const crop = others[m.other]?.[String(m.year)];
    if (crop) out[m.id] = { ...(out[m.id] ?? {}), [String(m.year)]: crop };
  }
  return out;
}

async function loadContext(tx: Tx, year: number, abRotation: CropPlanContext["certification"]["abRotation"]): Promise<CropPlanContext> {
  const parcels = await baseParcels(tx, year);
  const ids = parcels.map((p) => p.id);
  const activities = await contextActivities(tx, year);
  const hist = await geometricHistory(tx, ids, year, await inheritedHistory(tx, ids, year, await history(tx, ids, year)));
  const previous = await rows<{ activity_id: string; m2: number }>(
      tx,
      sql`SELECT p.activity_id, sum(v.area_m2)::float8 AS m2
          FROM productions p JOIN campaigns c ON c.id = p.campaign_id
          JOIN LATERAL (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = p.land_parcel_id
                        AND v.valid && tstzrange(make_date(c.year, 1, 1)::timestamptz, make_date(c.year + 1, 1, 1)::timestamptz)
                        ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1) v ON true
          WHERE c.year = ${year - 1} AND p.activity_id IS NOT NULL AND ${ROLE} = 'main'
          GROUP BY p.activity_id`,
  );
  const certs = await rows<{ land_parcel_id: string; kind: string; started_on: string }>(
      tx,
      sql`SELECT land_parcel_id, kind, min(started_on)::text AS started_on FROM parcel_certifications
          WHERE kind IN ('organic', 'hve') AND started_on <= make_date(${year}, 12, 31) AND (stopped_on IS NULL OR stopped_on >= make_date(${year}, 1, 1))
          GROUP BY land_parcel_id, kind`,
  );
  const settings = await settingsOf(tx);
  const zones = await parcelZones(tx, year);
  return {
    year,
    parcels: parcels.map((p) => ({
      id: p.id,
      name: p.name,
      areaM2: p.area_m2,
      shape: JSON.parse(p.shape) as unknown,
      validFrom: p.valid_from,
      lastStoppedOn: p.last_stopped_on,
      ...(p.carry ? { carryOver: true, sourceName: p.source_name } : {}),
    })),
    activities,
    history: hist,
    previousByActivity: Object.fromEntries(previous.map((r) => [r.activity_id, r.m2])),
    zones,
    certification: {
      abParcels: Object.fromEntries(certs.filter((c) => c.kind === "organic").map((c) => [c.land_parcel_id, { conversionStart: c.started_on }])),
      hve: certs.some((c) => c.kind === "hve"),
      abRotation,
    },
    settings,
    refsVersion: REFS_VERSION,
  };
}

/** Réglages de la rotation AB (contrôle AB), lus hors de la transaction de l'assolement. */
async function abRotationOf(db: Database, farmId: string) {
  const s = await getCertificationSettings(db, farmId);
  return { years: s.rotationYears, sameSpeciesMax: s.rotationSameSpeciesMax };
}

export async function getCropPlanContext(db: Database, farmId: string, year: number): Promise<CropPlanContext> {
  const abRotation = await abRotationOf(db, farmId);
  return withFarm(db, farmId, (tx) => loadContext(tx, year, abRotation));
}

// --- Productions de la campagne -------------------------------------------------

async function campaignOf(tx: Tx, year: number) {
  const [c] = await rows<{ id: string }>(tx, sql`SELECT id FROM campaigns WHERE year = ${year} LIMIT 1`);
  return c ?? null;
}

/** Productions de la campagne rattachées à une activité (celles sans activité ne sont pas touchées). */
async function existingProductions(tx: Tx, year: number): Promise<ExistingProduction[]> {
  const list = await rows<{
    id: string;
    land_parcel_id: string;
    activity_id: string;
    role: "main" | "secondary";
    started_on: string | null;
    stopped_on: string | null;
    done: boolean;
  }>(
    tx,
    sql`SELECT p.id, p.land_parcel_id, p.activity_id, ${ROLE} AS role, p.started_on::text, p.stopped_on::text,
               EXISTS (SELECT 1 FROM interventions i
                       JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel'
                       WHERE i.status = 'done' AND t.ref_id = p.land_parcel_id
                         AND fourmy_production_at(p.land_parcel_id, (i.started_at AT TIME ZONE 'Europe/Paris')::date) = p.id) AS done
        FROM productions p JOIN campaigns c ON c.id = p.campaign_id
        WHERE c.year = ${year} AND p.activity_id IS NOT NULL
        ORDER BY p.created_at`,
  );
  return list.map((r) => ({
    id: r.id,
    landParcelId: r.land_parcel_id,
    activityId: r.activity_id,
    role: r.role,
    startedOn: r.started_on,
    stoppedOn: r.stopped_on,
    hasDoneInterventions: r.done,
  }));
}

/** Couverts d'interculture qui suivent la culture principale de la campagne (cahier : campagne suivante). */
async function existingCovers(tx: Tx, year: number): Promise<ExistingCover[]> {
  const list = await rows<{ id: string; land_parcel_id: string; kind: string; family: string | null; species: string; sown_on: string; destroyed_on: string | null }>(
    tx,
    sql`SELECT id, land_parcel_id, kind, family, species, sown_on::text, destroyed_on::text FROM cover_crops WHERE campaign = ${year + 1} ORDER BY sown_on`,
  );
  return list.map((c) => ({ id: c.id, landParcelId: c.land_parcel_id, kind: c.kind, family: c.family, species: c.species, sownOn: c.sown_on, destroyedOn: c.destroyed_on }));
}

/** État actuel de la campagne sous forme de brouillon (création, réouverture, assolement validé). */
async function liveDraft(tx: Tx, year: number): Promise<CropPlanDraft> {
  const prods = await existingProductions(tx, year);
  const covers = await existingCovers(tx, year);
  return {
    ...emptyDraft(year),
    covers: covers.map((c) => ({
      id: c.id,
      key: parcelKeyOf(c.landParcelId),
      kind: c.kind as CropPlanDraft["covers"][number]["kind"],
      family: c.family as CropPlanDraft["covers"][number]["family"],
      species: c.species,
      sownOn: c.sownOn,
      destroyedOn: c.destroyedOn,
      coverId: c.id,
    })),
    assignments: prods.map((p) => ({
      id: p.id,
      key: parcelKeyOf(p.landParcelId),
      role: p.role,
      activityId: p.activityId,
      startedOn: p.startedOn,
      stoppedOn: p.stoppedOn,
      productionId: p.id,
    })),
  };
}

// --- Assolement --------------------------------------------------------------

type PlanRow = {
  id: string;
  year: number;
  status: "draft" | "validated" | "current";
  draft: CropPlanDraft | null;
  revision: number;
  current_version: number | null;
  updated_at: string;
};

async function planRow(tx: Tx, year: number, lock = false) {
  const [p] = await rows<PlanRow>(
    tx,
    sql`SELECT id, year, status, draft, revision, current_version, updated_at::text FROM crop_plans WHERE year = ${year} ${lock ? sql`FOR UPDATE` : sql``}`,
  );
  return p ?? null;
}

async function view(tx: Tx, p: PlanRow): Promise<CropPlanView> {
  const versions = await rows<{ version: number; validated_at: string; validated_by: string | null; reason: string | null }>(
    tx,
    sql`SELECT version, validated_at::text, validated_by, reason FROM crop_plan_versions WHERE plan_id = ${p.id} ORDER BY version DESC`,
  );
  return {
    year: p.year,
    status: p.status,
    revision: p.revision,
    draft: p.status === "draft" && p.draft ? p.draft : await liveDraft(tx, p.year),
    currentVersion: p.current_version,
    versions: versions.map((v) => ({ version: v.version, validatedAt: v.validated_at, validatedBy: v.validated_by, reason: v.reason })),
    updatedAt: p.updated_at,
  };
}

/** Assolements, et campagnes qui ont déjà des cultures sans assolement (« current »). */
export async function listCropPlans(db: Database, farmId: string): Promise<CropPlanListItem[]> {
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<{ year: number; status: CropPlanListItem["status"]; current_version: number | null; updated_at: string }>(
      tx,
      sql`SELECT year, status, current_version, updated_at::text FROM crop_plans
          UNION ALL
          SELECT c.year, 'current', NULL, max(p.updated_at)::text FROM campaigns c JOIN productions p ON p.campaign_id = c.id
          WHERE p.activity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crop_plans cp WHERE cp.year = c.year)
          GROUP BY c.year
          ORDER BY year DESC`,
    );
    return list.map((p) => ({ year: p.year, status: p.status, currentVersion: p.current_version, updatedAt: p.updated_at }));
  });
}

export async function getCropPlan(db: Database, farmId: string, year: number): Promise<CropPlanView> {
  return withFarm(db, farmId, async (tx) => {
    const p = await planRow(tx, year);
    if (p) return view(tx, p);
    // Pas d'assolement, mais des cultures saisies ou importées : affichées telles quelles.
    const draft = await liveDraft(tx, year);
    if (!draft.assignments.length) throw new NotFound(`Pas d'assolement ${year}`);
    return { year, status: "current", revision: 0, draft, currentVersion: null, versions: [], updatedAt: new Date().toISOString() };
  });
}

/** Crée l'assolement : brouillon de départ = productions déjà saisies pour la campagne (imports, saisie). */
export async function createCropPlan(db: Database, farmId: string, year: number, userId: string): Promise<CropPlanView> {
  return withFarm(db, farmId, async (tx) => {
    if (await planRow(tx, year)) throw new Conflict(`L'assolement ${year} existe déjà.`);
    const draft = await liveDraft(tx, year);
    await tx.execute(sql`INSERT INTO crop_plans (id, farm_id, year, status, draft, updated_by)
                         VALUES (${crypto.randomUUID()}, ${farmId}, ${year}, 'draft', ${JSON.stringify(draft)}::jsonb, ${userId})`);
    return view(tx, (await planRow(tx, year))!);
  });
}

/** Erreur 409 qui rend l'assolement du serveur (deux onglets, deux responsables). */
export class StaleCropPlan extends Error {
  constructor(readonly current: CropPlanView) {
    super("L'assolement a été modifié entre-temps.");
  }
}

export async function saveCropPlanDraft(db: Database, farmId: string, year: number, body: CropPlanDraftWrite, userId: string): Promise<CropPlanView> {
  return withFarm(db, farmId, async (tx) => {
    const p = await planRow(tx, year, true);
    if (!p) throw new NotFound(`Pas d'assolement ${year}`);
    if (p.revision !== body.revision) throw new StaleCropPlan(await view(tx, p));
    if (body.draft.year !== year) throw new Conflict("Le brouillon ne porte pas sur cette campagne.");
    await tx.execute(sql`UPDATE crop_plans SET status = 'draft', draft = ${JSON.stringify(body.draft)}::jsonb, revision = revision + 1,
                         updated_at = now(), updated_by = ${userId} WHERE id = ${p.id}`);
    return view(tx, (await planRow(tx, year))!);
  });
}

/** Rouvre un assolement validé : le brouillon repart de l'état actuel des productions. */
export async function reopenCropPlan(db: Database, farmId: string, year: number, userId: string): Promise<CropPlanView> {
  return withFarm(db, farmId, async (tx) => {
    const p = await planRow(tx, year, true);
    if (!p) throw new NotFound(`Pas d'assolement ${year}`);
    if (p.status === "draft") return view(tx, p);
    const draft = await liveDraft(tx, year);
    await tx.execute(sql`UPDATE crop_plans SET status = 'draft', draft = ${JSON.stringify(draft)}::jsonb, revision = revision + 1,
                         updated_at = now(), updated_by = ${userId} WHERE id = ${p.id}`);
    return view(tx, (await planRow(tx, year))!);
  });
}

/** Abandonne le brouillon : retour à la dernière version, ou suppression d'un assolement jamais validé. */
export async function discardCropPlanDraft(db: Database, farmId: string, year: number, userId: string): Promise<CropPlanView | null> {
  return withFarm(db, farmId, async (tx) => {
    const p = await planRow(tx, year, true);
    if (!p) throw new NotFound(`Pas d'assolement ${year}`);
    if (p.current_version === null) {
      await tx.execute(sql`DELETE FROM crop_plans WHERE id = ${p.id}`);
      return null;
    }
    await tx.execute(sql`UPDATE crop_plans SET status = 'validated', draft = NULL, revision = revision + 1,
                         updated_at = now(), updated_by = ${userId} WHERE id = ${p.id}`);
    return view(tx, (await planRow(tx, year))!);
  });
}

// --- Validation (§6) -----------------------------------------------------------

/**
 * Aperçu (dryRun) ou application du brouillon : productions créées,
 * modifiées, supprimées, puis version figée. Découpes et fusions ne sont
 * pas encore appliquées (lot AS3) : bloquant.
 */
export async function validateCropPlan(
  db: Database,
  farmId: string,
  year: number,
  body: CropPlanValidateWrite,
  opts: { dryRun: boolean; userId: string },
): Promise<CropPlanValidation> {
  const abRotation = await abRotationOf(db, farmId);
  return withFarm(db, farmId, async (tx) => {
    const p = await planRow(tx, year, !opts.dryRun);
    if (!p) throw new NotFound(`Pas d'assolement ${year}`);
    if (p.revision !== body.revision) throw new StaleCropPlan(await view(tx, p));
    if (p.status !== "draft" || !p.draft) throw new Conflict("L'assolement est déjà validé : rouvrez-le pour le modifier.");
    const draft = p.draft;

    const context = await loadContext(tx, year, abRotation);
    const { sections } = checkCropPlan(cropPlanCheckInput(context, draft));
    const resolved = resolveParcels(context.parcels, draft);
    const campaign = await campaignOf(tx, year);
    const existing = campaign ? await existingProductions(tx, year) : [];
    const carryOver = new Map(context.parcels.filter((p) => p.carryOver).map((p) => [p.id, { name: p.name, sourceName: p.sourceName ?? p.name }]));
    const { changes, blockers } = diffCropPlan(draft, resolved, existing, { campaignExists: !!campaign, carryOver }, await existingCovers(tx, year));
    const activityIds = new Set(context.activities.map((a) => a.id));
    const unknownActivities = draft.assignments.filter((a) => !activityIds.has(a.activityId));
    if (unknownActivities.length) {
      blockers.push({ code: "unknown-parcel", message: `${unknownActivities.length} culture(s) prévue(s) avec une activité inconnue ou sans parcelles.`, keys: unknownActivities.map((a) => a.key) });
    }
    blockers.push(...operationBlockers(draft, resolved, context), ...(await serverOperationBlockers(tx, draft, context)));

    if (opts.dryRun || blockers.length) return { dryRun: opts.dryRun, changes, blockers, sections, version: null };

    const applied = await applyChanges(tx, farmId, year, changes, draft, p.id);
    const version = (p.current_version ?? 0) + 1;
    await tx.execute(sql`INSERT INTO crop_plan_versions (plan_id, version, farm_id, validated_by, reason, snapshot, changes, findings, refs_version)
                         VALUES (${p.id}, ${version}, ${farmId}, ${opts.userId}, ${body.reason ?? null}, ${JSON.stringify(applied)}::jsonb,
                                 ${JSON.stringify(changes)}::jsonb, ${JSON.stringify(sections)}::jsonb, ${context.refsVersion})`);
    await tx.execute(sql`UPDATE crop_plans SET status = 'validated', draft = NULL, revision = revision + 1, current_version = ${version},
                         updated_at = now(), updated_by = ${opts.userId} WHERE id = ${p.id}`);
    return { dryRun: false, changes, blockers, sections, version };
  });
}

/** Applique les changements ; rend le brouillon avec les productions créées (instantané de la version). */
/**
 * Vérifications des découpes et fusions qui demandent la base : formes
 * (validité, recouvrement de la parcelle d'origine), interventions de la
 * parcelle d'origine après la date d'effet, fusion de surfaces AB et non AB.
 */
async function serverOperationBlockers(tx: Tx, draft: CropPlanDraft, context: CropPlanContext) {
  const out: CropPlanValidation["blockers"] = [];
  const base = new Set(context.parcels.map((p) => p.id));
  const shapes = new Map<string, string>(); // morceaux du brouillon (n:) → GeoJSON
  for (const op of draft.operations) {
    const sources = (op.kind === "split" ? [op.source] : op.sources).filter((k) => k.startsWith("p:") && base.has(k.slice(2))).map((k) => k.slice(2));
    const pieces = op.kind === "split" ? op.pieces : [op.result];
    const names = pieces.map((p) => p.name).join(", ");
    const piecesJson = JSON.stringify(pieces.map((p) => p.shape));
    for (const piece of pieces) shapes.set(piece.key, JSON.stringify(piece.shape));
    // Sources du brouillon (morceaux découpés puis fusionnés) : formes prises dans le brouillon.
    const draftSources = (op.kind === "split" ? [op.source] : op.sources).filter((k) => k.startsWith("n:")).map((k) => shapes.get(k)).filter((x): x is string => !!x);
    const draftJson = JSON.stringify(draftSources.map((d) => JSON.parse(d) as unknown));
    const [geo] = await rows<{ invalid: number; overlap: number; gap: number }>(
      tx,
      sql`WITH raw AS (SELECT n, ST_SetSRID(ST_GeomFromGeoJSON(g::text), 4326) AS g FROM jsonb_array_elements(${piecesJson}::jsonb) WITH ORDINALITY AS x(g, n)),
               pieces AS (SELECT n, ST_MakeValid(g) AS g, ST_IsValid(g) AS ok FROM raw),
               src AS (SELECT ST_Union(g) AS g FROM (
                         SELECT v.shape AS g FROM land_parcel_versions v
                         WHERE v.land_parcel_id = ANY(${uuids(sources)}) AND v.valid @> (${op.effectiveOn}::date - 1)::timestamptz
                         UNION ALL
                         SELECT ST_SetSRID(ST_GeomFromGeoJSON(d::text), 4326) FROM jsonb_array_elements(${draftJson}::jsonb) d) s),
               u AS (SELECT ST_Union(g) AS g FROM pieces)
          SELECT (SELECT count(*) FROM pieces WHERE NOT ok)::int AS invalid,
                 coalesce((SELECT sum(ST_Area(ST_Intersection(a.g, b.g)::geography)) FROM pieces a JOIN pieces b ON a.n < b.n AND ST_Intersects(a.g, b.g)), 0)::float8 AS overlap,
                 coalesce(ST_Area(ST_SymDifference((SELECT g FROM src), (SELECT g FROM u))::geography), 0)::float8 AS gap`,
    );
    if (geo && (geo.invalid > 0 || geo.overlap > 1 || geo.gap > 1)) {
      out.push({ code: "geometry", message: `${names} : les nouvelles parcelles ne recouvrent pas exactement la surface d'origine (écart ${Math.round(geo.gap)} m², chevauchement ${Math.round(geo.overlap)} m²${geo.invalid ? ", contour invalide" : ""}).`, keys: pieces.map((p) => p.key) });
    }
    if (!sources.length) continue;
    const ivs = await rows<{ status: string; n: number }>(
      tx,
      sql`SELECT i.status, count(DISTINCT i.id)::int AS n FROM interventions i
          JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel'
          WHERE t.ref_id = ANY(${uuids(sources)}) AND i.status IN ('done', 'planned') AND i.started_at >= ${op.effectiveOn}::date::timestamptz
          GROUP BY i.status`,
    );
    const srcKeys = sources.map((id) => `p:${id}`);
    const done = ivs.find((r) => r.status === "done")?.n ?? 0;
    const planned = ivs.find((r) => r.status === "planned")?.n ?? 0;
    if (done) out.push({ code: "effective-date", message: `${names} : ${done} intervention(s) réalisée(s) sur la parcelle d'origine après le ${op.effectiveOn} ; choisissez une date d'effet plus tardive.`, keys: srcKeys });
    if (planned) out.push({ code: "planned-interventions", message: `${names} : ${planned} intervention(s) prévue(s) sur la parcelle d'origine après le ${op.effectiveOn} : reportez-les sur les nouvelles parcelles ou annulez-les avant de valider.`, keys: srcKeys });
    if (op.kind === "merge") {
      const ab = sources.filter((id) => context.certification.abParcels[id]);
      if (ab.length && ab.length !== op.sources.length) {
        out.push({ code: "certification", message: `${op.result.name} : réunit des surfaces certifiées AB et non certifiées ; fusion refusée.`, keys: op.sources });
      }
    }
  }
  return out;
}

/** Applique une découpe ou une fusion : versions d'origine closes, nouvelles parcelles, filiation, certifications. */
async function applyOperation(tx: Tx, farmId: string, planId: string, sources: string[], pieces: { key: string; name: string; shape: unknown }[], effectiveOn: string, kind: "split" | "merge", keyMap: Map<string, string>) {
  const ids = sources.map((k) => keyMap.get(k) ?? k.slice(2));
  const eff = sql`${effectiveOn}::date::timestamptz`;
  const [ref] = await rows<{ pac_islet: string | null; viti: unknown; area: number }>(
    tx,
    sql`SELECT (array_agg(v.pac_islet))[1] AS pac_islet, (array_agg(v.viti))[1] AS viti, sum(v.area_m2)::float8 AS area
        FROM land_parcel_versions v WHERE v.land_parcel_id = ANY(${uuids(ids)}) AND v.valid @> ${eff}`,
  );
  await tx.execute(sql`UPDATE land_parcel_versions SET valid = tstzrange(lower(valid), ${eff})
                       WHERE land_parcel_id = ANY(${uuids(ids)}) AND valid @> ${eff}`);
  await tx.execute(sql`UPDATE land_parcels SET updated_at = now() WHERE id = ANY(${uuids(ids)})`);
  for (const piece of pieces) {
    const id = crypto.randomUUID();
    keyMap.set(piece.key, id);
    const geo = JSON.stringify(piece.shape);
    await tx.execute(sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${piece.name})`);
    await tx.execute(sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, pac_islet, viti, valid)
      SELECT ${crypto.randomUUID()}, ${id}, g, ST_Area(g::geography), ${ref?.pac_islet ?? null}, ${ref?.viti ? JSON.stringify(ref.viti) : null}::jsonb, tstzrange(${eff}, NULL)
      FROM (SELECT ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326))) AS g) x`);
    // Filiation : part de la surface du morceau venue de chaque parcelle d'origine.
    await tx.execute(sql`INSERT INTO land_parcel_lineage (child_id, parent_id, farm_id, kind, effective_at, share, plan_id)
      SELECT ${id}, v.land_parcel_id, ${farmId}, ${kind}, ${eff},
             greatest(least(ST_Area(ST_Intersection(v.shape, c.shape)::geography) / nullif(ST_Area(c.shape::geography), 0), 1), 0.000001), ${planId}
      FROM land_parcel_versions v, land_parcel_versions c
      WHERE v.land_parcel_id = ANY(${uuids(ids)}) AND upper(v.valid) = ${eff}
        AND c.land_parcel_id = ${id} AND ST_Intersects(v.shape, c.shape)`);
    // Certifications de la parcelle d'origine encore en cours à la date d'effet.
    await tx.execute(sql`INSERT INTO parcel_certifications (id, farm_id, land_parcel_id, kind, level, label, certifier, reference, started_on, stopped_on)
      SELECT DISTINCT ON (kind) gen_random_uuid(), farm_id, ${id}, kind, level, label, certifier, reference, started_on, stopped_on
      FROM parcel_certifications
      WHERE land_parcel_id = ANY(${uuids(ids)}) AND (stopped_on IS NULL OR stopped_on >= ${effectiveOn}::date)
      ORDER BY kind, started_on`);
  }
}

async function applyChanges(tx: Tx, farmId: string, year: number, changes: CropPlanChange[], draft: CropPlanDraft, planId: string): Promise<CropPlanDraft> {
  const keyMap = new Map<string, string>();
  // Reconduction (lot AS5) : une parcelle par parcelle de l'an passé gardée, au nom nettoyé,
  // valide à partir de la fin de l'ancienne ; filiation « carry ».
  for (const c of changes) {
    if (c.kind !== "parcel.carry") continue;
    const parentId = c.key.slice(2);
    const id = crypto.randomUUID();
    keyMap.set(c.key, id);
    await tx.execute(sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${c.name})`);
    await tx.execute(sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, pac_islet, viti, valid)
      SELECT ${crypto.randomUUID()}, ${id}, v.shape, v.area_m2, v.pac_islet, v.viti, tstzrange(upper(v.valid), NULL)
      FROM land_parcel_versions v WHERE v.land_parcel_id = ${parentId} ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1`);
    await tx.execute(sql`INSERT INTO land_parcel_lineage (child_id, parent_id, farm_id, kind, effective_at, share, plan_id)
      SELECT ${id}, ${parentId}, ${farmId}, 'carry', lower(valid), 1, ${planId} FROM land_parcel_versions WHERE land_parcel_id = ${id}`);
    await tx.execute(sql`INSERT INTO parcel_certifications (id, farm_id, land_parcel_id, kind, level, label, certifier, reference, started_on, stopped_on)
      SELECT gen_random_uuid(), farm_id, ${id}, kind, level, label, certifier, reference, started_on, stopped_on
      FROM parcel_certifications WHERE land_parcel_id = ${parentId} AND (stopped_on IS NULL OR stopped_on >= make_date(${year}, 1, 1))`);
  }
  // Découpes et fusions ensuite : les productions des morceaux en dépendent.
  for (const op of draft.operations) {
    if (op.kind === "split") await applyOperation(tx, farmId, planId, [op.source], op.pieces, op.effectiveOn, "split", keyMap);
    else await applyOperation(tx, farmId, planId, op.sources, [op.result], op.effectiveOn, "merge", keyMap);
  }
  let campaign = await campaignOf(tx, year);
  if (!campaign) {
    campaign = { id: crypto.randomUUID() };
    await tx.execute(sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on)
                         VALUES (${campaign.id}, ${farmId}, ${year}, make_date(${year}, 1, 1), make_date(${year}, 12, 31))`);
  }
  const created = new Map<string, string>();
  const parcelId = (key: string) => keyMap.get(key) ?? key.slice(2);
  const fields = (f: { activityId: string; role: string; startedOn: string | null; stoppedOn: string | null }) => sql`
    activity_id = ${f.activityId},
    nature = (SELECT CASE a.family WHEN 'vine_farming' THEN 'vine' WHEN 'animal_farming' THEN 'grassland' ELSE 'field_crop' END FROM activities a WHERE a.id = ${f.activityId}),
    cultivation = (SELECT coalesce(a.cultivation, lx.specie) FROM activities a LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference WHERE a.id = ${f.activityId}),
    started_on = ${f.startedOn}::date, stopped_on = ${f.stoppedOn}::date,
    attrs = coalesce(attrs, '{}'::jsonb) || jsonb_build_object('cropPlan', jsonb_build_object('role', ${f.role}::text)),
    updated_at = now()`;
  for (const c of changes) {
    if (c.kind === "production.delete") {
      await tx.execute(sql`DELETE FROM productions WHERE id = ${c.productionId}`);
    } else if (c.kind === "production.update") {
      await tx.execute(sql`UPDATE productions SET ${fields(c.after)} WHERE id = ${c.productionId}`);
    } else if (c.kind === "production.create") {
      const id = crypto.randomUUID();
      created.set(c.assignmentId, id);
      await tx.execute(sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id)
                           VALUES (${id}, ${farmId}, ${campaign.id}, ${parcelId(c.key)}, 'field_crop', ${c.after.activityId})`);
      await tx.execute(sql`UPDATE productions SET ${fields(c.after)} WHERE id = ${id}`);
    }
  }
  // Couverts d'interculture : cahier de fertilisation, campagne de la culture qui suit.
  const coverOf = new Map(draft.covers.map((c) => [c.id, c]));
  const coverByCoverId = new Map(draft.covers.filter((c) => c.coverId).map((c) => [c.coverId!, c]));
  const createdCovers = new Map<string, string>();
  for (const c of changes) {
    if (c.kind === "cover.delete") {
      await tx.execute(sql`DELETE FROM cover_crops WHERE id = ${c.coverId}`);
    } else if (c.kind === "cover.update" || c.kind === "cover.create") {
      const cv = c.kind === "cover.update" ? coverByCoverId.get(c.coverId)! : coverOf.get(c.coverKey)!;
      const id = c.kind === "cover.update" ? c.coverId : crypto.randomUUID();
      if (c.kind === "cover.create") createdCovers.set(cv.id, id);
      // Un couvert par parcelle et par campagne : celui du brouillon remplace l'éventuel existant.
      await tx.execute(sql`
        INSERT INTO cover_crops (id, farm_id, land_parcel_id, campaign, kind, family, species, sown_on, destroyed_on)
        VALUES (${id}, ${farmId}, ${parcelId(c.key)}, ${year + 1}, ${cv.kind}, ${cv.family}, ${cv.species}, ${cv.sownOn}::date, ${cv.destroyedOn}::date)
        ON CONFLICT (land_parcel_id, campaign) DO UPDATE SET kind = excluded.kind, family = excluded.family, species = excluded.species,
          sown_on = excluded.sown_on, destroyed_on = excluded.destroyed_on, updated_at = now()`);
    }
  }

  // Instantané : clés définitives des nouvelles parcelles, productions créées.
  const real = (key: string) => (keyMap.has(key) ? (`p:${keyMap.get(key)}` as const) : (key as `p:${string}`));
  return {
    ...draft,
    assignments: draft.assignments.map((a) => ({ ...a, key: real(a.key), ...(created.has(a.id) ? { productionId: created.get(a.id)! } : {}) })),
    covers: draft.covers.map((c) => ({ ...c, key: real(c.key), ...(createdCovers.has(c.id) ? { coverId: createdCovers.get(c.id)! } : {}) })),
    fallow: draft.fallow.map((f) => ({ ...f, key: real(f.key) })),
  };
}

export async function getCropPlanVersion(db: Database, farmId: string, year: number, version: number): Promise<CropPlanVersionView> {
  return withFarm(db, farmId, async (tx) => {
    const [v] = await rows<{
      version: number;
      validated_at: string;
      validated_by: string | null;
      reason: string | null;
      snapshot: CropPlanDraft;
      changes: CropPlanChange[];
      findings: ControlSection[];
      refs_version: string;
    }>(
      tx,
      sql`SELECT v.version, v.validated_at::text, v.validated_by, v.reason, v.snapshot, v.changes, v.findings, v.refs_version
          FROM crop_plan_versions v JOIN crop_plans p ON p.id = v.plan_id WHERE p.year = ${year} AND v.version = ${version}`,
    );
    if (!v) throw new NotFound("Version introuvable");
    return {
      version: v.version,
      validatedAt: v.validated_at,
      validatedBy: v.validated_by,
      reason: v.reason,
      snapshot: v.snapshot,
      changes: v.changes,
      findings: v.findings,
      refsVersion: v.refs_version,
    };
  });
}
