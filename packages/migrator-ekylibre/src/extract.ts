import type { Sql } from "postgres";

/**
 * Extracteurs SQL par domaine (lecture seule sur la base source Ekylibre).
 * Les géométries sont nettoyées côté source (`ST_MakeValid`, extraction des
 * polygones) et ramenées en GeoJSON. Compatible Ekylibre 4.37 et 5.0 :
 * toutes les colonnes lues existent dans les deux versions.
 */

export interface Source {
  sql: Sql;
  tenant: string;
}

/** Ouvre une transaction en lecture seule, avec le schéma du tenant. */
export async function read<T>(src: Source, fn: (sql: Sql) => Promise<T>): Promise<T> {
  return src.sql.begin("read only", async (tx) => {
    await tx.unsafe(`SET LOCAL search_path = "${src.tenant.replace(/"/g, "")}", postgis`);
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}

export type Campaign = { id: number; name: string; harvest_year: number };
export const campaigns = (s: Sql) =>
  s<Campaign[]>`SELECT id, name, harvest_year FROM campaigns WHERE harvest_year IS NOT NULL ORDER BY harvest_year`;

/** Polygones nettoyés en MultiPolygon GeoJSON (NULL si vide). */
const multiPolygon = (col: string) =>
  `CASE WHEN ${col} IS NULL OR ST_IsEmpty(${col}) THEN NULL
        ELSE ST_AsGeoJSON(ST_Multi(ST_CollectionExtract(ST_MakeValid(${col}), 3)))::json END`;

export type LandParcelRow = {
  id: number;
  name: string;
  work_number: string | null;
  born_at: Date | null;
  dead_at: Date | null;
  shape: unknown | null;
};
export const landParcels = (s: Sql) =>
  s.unsafe<LandParcelRow[]>(`
    SELECT id, name, work_number, born_at, dead_at, ${multiPolygon("initial_shape")} AS shape
    FROM products WHERE type = 'LandParcel' ORDER BY id`);

export type ActivityRow = {
  id: number;
  name: string;
  family: string;
  reference_name: string | null;
  cultivation_variety: string | null;
  suspended: boolean;
};
/** Activités (Maïs, Jachère, Vignes AOP…) : famille, production de référence, variété cultivée. */
export const activities = (s: Sql) =>
  s<ActivityRow[]>`
    SELECT id, name, family, nullif(reference_name, '') AS reference_name,
           nullif(cultivation_variety, '') AS cultivation_variety, coalesce(suspended, false) AS suspended
    FROM activities ORDER BY id`;

export type ProductionRow = {
  id: number;
  activity_id: number;
  campaign_id: number | null;
  support_id: number | null;
  started_on: string | null;
  stopped_on: string | null;
  family: string | null;
  cultivation_variety: string | null;
  plant_variety: string | null;
};
/** Productions + cépage/espèce de la culture (Plant) rattachée. */
export const productions = (s: Sql) =>
  s<ProductionRow[]>`
    SELECT ap.id, ap.activity_id, ap.campaign_id, ap.support_id,
           ap.started_on::text AS started_on, ap.stopped_on::text AS stopped_on,
           a.family, a.cultivation_variety,
           (SELECT coalesce(nullif(p.specie_variety->>'specie_variety_name', ''), p.variety) FROM products p
             WHERE p.type = 'Plant' AND p.activity_production_id = ap.id
             ORDER BY p.id LIMIT 1) AS plant_variety
    FROM activity_productions ap
    JOIN activities a ON a.id = ap.activity_id
    ORDER BY ap.id`;

export type PlaceRow = {
  id: number;
  type: string;
  name: string;
  born_at: Date | null;
  dead_at: Date | null;
  footprint: unknown | null;
};
/** Bâtiments et divisions : on garde le plus grand polygone comme emprise. */
export const places = (s: Sql) =>
  s.unsafe<PlaceRow[]>(`
    SELECT p.id, p.type, p.name, p.born_at, p.dead_at,
      (SELECT ST_AsGeoJSON(d.geom)::json
         FROM ST_Dump(ST_CollectionExtract(ST_MakeValid(p.initial_shape), 3)) d
        ORDER BY ST_Area(d.geom) DESC LIMIT 1) AS footprint
    FROM products p WHERE p.type IN ('Building', 'BuildingDivision') ORDER BY p.id`);

export type ContainerRow = {
  id: number;
  name: string;
  variant_name: string | null;
  variety: string | null;
  container_id: number | null;
  born_at: Date | null;
  dead_at: Date | null;
  capacity_value: string | null;
  capacity_unit: string | null;
};
/** Contenants (cuves, silos, barriques) et leur capacité nominale. */
export const containers = (s: Sql) =>
  s<ContainerRow[]>`
    SELECT p.id, p.name, v.name AS variant_name, p.variety,
           coalesce(p.initial_container_id, p.default_storage_id) AS container_id,
           p.born_at, p.dead_at,
           r.measure_value_value AS capacity_value, r.measure_value_unit AS capacity_unit
    FROM products p
    LEFT JOIN product_nature_variants v ON v.id = p.variant_id
    LEFT JOIN product_nature_variant_readings r
      ON r.variant_id = p.variant_id AND r.indicator_name = 'nominal_storable_net_volume'
    WHERE p.variety IN ('tank', 'vat', 'silo', 'barrel', 'cask')
    ORDER BY p.id`;

export type EquipmentRow = { id: number; name: string; variety: string | null; dead_at: Date | null };
export const equipments = (s: Sql) =>
  s<EquipmentRow[]>`
    SELECT id, name, variety, dead_at FROM products
    WHERE type = 'Equipment' AND coalesce(variety, '') NOT IN ('tank', 'vat', 'silo', 'barrel', 'cask')
    ORDER BY id`;

export type MatterRow = {
  id: number;
  name: string;
  variant_id: number;
  variant_name: string;
  variety: string | null;
  unit_name: string | null;
  france_maaid: string | null;
  reference_name: string | null;
  storage_id: number | null;
};
/** Lots (produits Matter) utilisés en intrant ou en sortie, avec leur variante (article). */
export const matters = (s: Sql) =>
  s<MatterRow[]>`
    SELECT DISTINCT p.id, p.name, v.id AS variant_id, v.name AS variant_name, v.variety,
           v.unit_name, v.france_maaid, v.reference_name, p.default_storage_id AS storage_id
    FROM intervention_parameters ip
    JOIN products p ON p.id = ip.product_id AND p.type = 'Matter'
    JOIN product_nature_variants v ON v.id = p.variant_id
    WHERE ip.type IN ('InterventionInput', 'InterventionOutput')
    ORDER BY p.id`;

export type InterventionRow = {
  id: number;
  procedure_name: string;
  state: string | null;
  number: string | null;
  started_at: Date | null;
  stopped_at: Date | null;
};
export const interventions = (s: Sql) =>
  s<InterventionRow[]>`
    SELECT id, procedure_name, state, number, started_at, stopped_at
    FROM interventions ORDER BY id`;

export type ParameterRow = {
  id: number;
  intervention_id: number;
  type: string;
  reference_name: string | null;
  product_id: number | null;
  product_type: string | null;
  /** Nom du produit (personne pour un intervenant « Worker »). */
  product_name: string | null;
  plant_support_id: number | null;
  quantity_value: string | null;
  quantity_unit_name: string | null;
  quantity_population: string | null;
  working_zone: unknown | null;
};
/** Paramètres ; pour une cible « Plant », la parcelle support de sa production. */
export const parameters = (s: Sql) =>
  s.unsafe<ParameterRow[]>(`
    SELECT ip.id, ip.intervention_id, ip.type, ip.reference_name, ip.product_id,
           p.type AS product_type, p.name AS product_name,
           ap.support_id AS plant_support_id,
           ip.quantity_value, ip.quantity_unit_name, ip.quantity_population,
           CASE WHEN ip.working_zone IS NULL OR ST_IsEmpty(ip.working_zone) THEN NULL
                ELSE ST_AsGeoJSON(ST_MakeValid(ip.working_zone))::json END AS working_zone
    FROM intervention_parameters ip
    LEFT JOIN products p ON p.id = ip.product_id
    LEFT JOIN activity_productions ap ON p.type = 'Plant' AND ap.id = p.activity_production_id
    ORDER BY ip.intervention_id, ip.id`);

export type WorkingPeriodRow = {
  id: number;
  intervention_id: number;
  started_at: Date;
  stopped_at: Date;
};
/** Périodes de travail rattachées à l'intervention (pas aux participations individuelles). */
export const workingPeriods = (s: Sql) =>
  s<WorkingPeriodRow[]>`
    SELECT id, intervention_id, started_at, stopped_at
    FROM intervention_working_periods
    WHERE intervention_id IS NOT NULL AND started_at IS NOT NULL AND stopped_at > started_at
    ORDER BY intervention_id, started_at, id`;

export type HarvestRow = {
  id: number;
  number: string;
  received_at: Date;
  harvest_year: number | null;
  storage_id: number;
  storage_exists: boolean;
  storage_line_id: number;
  quantity_value: string;
  quantity_unit: string;
  varieties: string[] | null;
};
/**
 * Réceptions de vendange → remplissage des cuves (US-9). Tables présentes en
 * 4.37 ; absentes ou vides selon les instances (on tolère leur absence).
 */
export async function harvests(s: Sql): Promise<HarvestRow[]> {
  const exists = await s`SELECT to_regclass('wine_incoming_harvest_storages') IS NOT NULL AS ok`;
  if (!exists[0]?.ok) return [];
  return s<HarvestRow[]>`
    SELECT h.id, h.number, h.received_at, c.harvest_year,
           st.storage_id, EXISTS (SELECT 1 FROM products sp WHERE sp.id = st.storage_id) AS storage_exists,
           st.id AS storage_line_id, st.quantity_value, st.quantity_unit,
           (SELECT array_agg(DISTINCT coalesce(nullif(p.specie_variety->>'specie_variety_name', ''), p.variety))
              FROM wine_incoming_harvest_plants hp JOIN products p ON p.id = hp.plant_id
             WHERE hp.wine_incoming_harvest_id = h.id) AS varieties
    FROM wine_incoming_harvests h
    JOIN wine_incoming_harvest_storages st ON st.wine_incoming_harvest_id = h.id
    LEFT JOIN campaigns c ON c.id = h.campaign_id
    ORDER BY h.received_at, st.id`;
}

/**
 * Référence du registre phyto côté Ekylibre : triplets (intervention réalisée,
 * intrant avec AMM, parcelle cible), par année de campagne. Sert au calcul de
 * l'écart Ekylibre ↔ Fourmy (critère de US-5).
 */
export const phytoReference = (s: Sql) =>
  s<{ year: number; rows: string }[]>`
    SELECT extract(year FROM i.stopped_at)::int AS year, count(*) AS rows
    FROM interventions i
    JOIN intervention_parameters inp ON inp.intervention_id = i.id AND inp.type = 'InterventionInput'
    JOIN product_nature_variants v ON v.id = inp.variant_id AND nullif(btrim(v.france_maaid), '') IS NOT NULL
    JOIN intervention_parameters tgt ON tgt.intervention_id = i.id AND tgt.type = 'InterventionTarget'
    JOIN products tp ON tp.id = tgt.product_id AND tp.type IN ('LandParcel', 'Plant')
    WHERE i.state IN ('done', 'validated') AND i.stopped_at IS NOT NULL
    GROUP BY 1 ORDER BY 1`;
