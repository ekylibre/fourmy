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
  /** `opened` : en cours (la date de fin d'une pérenne n'est alors qu'une prévision). */
  state: string | null;
};
/** Productions + cépage/espèce de la culture (Plant) rattachée. */
export const productions = (s: Sql) =>
  s<ProductionRow[]>`
    SELECT ap.id, ap.activity_id, ap.campaign_id, ap.support_id,
           ap.started_on::text AS started_on, ap.stopped_on::text AS stopped_on,
           a.family, a.cultivation_variety, ap.state,
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

export type EquipmentRow = {
  id: number;
  name: string;
  variety: string | null;
  born_at: Date | null;
  dead_at: Date | null;
  /** Immatriculation, n° interne, ou identifiant Samsys (`SAMSYS_…`). */
  work_number: string | null;
  /** N° de série. */
  identification_number: string | null;
  /** Nombre de paramètres d'intervention qui l'utilisent. */
  uses: number;
  /** Type Ekylibre (`Equipment`, ou `Matter` saisi par erreur mais utilisé comme outil). */
  type: string;
};
export const equipments = (s: Sql) =>
  s<EquipmentRow[]>`
    SELECT p.id, p.name, p.variety, p.type, p.born_at, p.dead_at,
           nullif(btrim(p.work_number), '') AS work_number,
           nullif(btrim(p.identification_number), '') AS identification_number,
           (SELECT count(*)::int FROM intervention_parameters ip WHERE ip.product_id = p.id) AS uses
    FROM products p
    WHERE coalesce(p.variety, '') NOT IN ('tank', 'vat', 'silo', 'barrel', 'cask')
      AND (p.type = 'Equipment'
        -- Variante mal classée (ex. une rogneuse en « Matter ») mais employée comme outil.
        OR (p.type = 'Matter' AND EXISTS (SELECT 1 FROM intervention_parameters ip
              WHERE ip.product_id = p.id AND ip.type = 'InterventionTool')))
    ORDER BY p.id`;

/** Clé OpenWeatherMap de l'instance (en clair dans `identifiers`), si saisie. */
export async function openWeatherKey(s: Sql): Promise<string | null> {
  const exists = await s`SELECT to_regclass('identifiers') IS NOT NULL AS ok`;
  if (!exists[0]?.ok) return null;
  const rows = await s<{ value: string }[]>`
    SELECT btrim(value) AS value FROM identifiers
    WHERE nature = 'openweathermap_api_key' AND nullif(btrim(value), '') IS NOT NULL
    ORDER BY updated_at DESC LIMIT 1`;
  return rows[0]?.value ?? null;
}

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

/** Teneurs N, P, K des variantes (relevés Ekylibre) : composition des fertilisants. */
export type NutrientReadingRow = { variant_id: number; indicator_name: string; value: string; unit: string | null };
export const nutrientReadings = (s: Sql) =>
  s<NutrientReadingRow[]>`
    SELECT variant_id, indicator_name, measure_value_value::text AS value, measure_value_unit AS unit
    FROM product_nature_variant_readings
    WHERE indicator_name IN ('nitrogen_concentration', 'phosphorus_concentration', 'potassium_concentration')
      AND measure_value_value IS NOT NULL
    ORDER BY variant_id, indicator_name`;

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
export type ParticipationRow = {
  intervention_id: number;
  product_id: number;
  started_at: Date;
  stopped_at: Date;
};
/**
 * Participations d'Ekylibre 5 (FR-ATT-10) : les périodes propres à chaque
 * matériel ou personne d'une intervention. Vide si la version n'en a pas.
 */
export async function participations(s: Sql): Promise<ParticipationRow[]> {
  const [ok] = await s<{ ok: boolean }[]>`
    SELECT to_regclass('intervention_participations') IS NOT NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'intervention_working_periods'
        AND column_name = 'intervention_participation_id') AS ok`;
  if (!ok?.ok) return [];
  return s<ParticipationRow[]>`
    SELECT DISTINCT ip.intervention_id, ip.product_id, wp.started_at, wp.stopped_at
    FROM intervention_participations ip
    JOIN intervention_working_periods wp ON wp.intervention_participation_id = ip.id
    WHERE ip.intervention_id IS NOT NULL AND ip.product_id IS NOT NULL
      AND wp.started_at IS NOT NULL AND wp.stopped_at > wp.started_at
    ORDER BY ip.intervention_id, ip.product_id, wp.started_at`;
}

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

// ---------------------------------------------------------------------------
// Personnes (lot P4, docs/equipe-personnes-design.md §7)
// ---------------------------------------------------------------------------

/** Fiche « entité » d'un intervenant (Worker) ou d'un utilisateur Ekylibre. */
export type PersonRow = {
  entity_id: number;
  /** Les Workers de cette entité (une personne Fourmy chacun, comme avant). */
  worker_ids: number[] | null;
  user_id: number | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  born_at: Date | null;
  picture_file_name: string | null;
  user_email: string | null;
  administrator: boolean | null;
};
export const people = (s: Sql) =>
  s<PersonRow[]>`
    WITH w AS (
      SELECT person_id AS entity_id, array_agg(id ORDER BY id) AS worker_ids
      FROM products WHERE type = 'Worker' AND person_id IS NOT NULL GROUP BY person_id
    ), u AS (
      SELECT DISTINCT ON (person_id) person_id AS entity_id, id AS user_id, email, administrator
      FROM users WHERE person_id IS NOT NULL ORDER BY person_id, id
    )
    SELECT e.id AS entity_id, w.worker_ids, u.user_id, nullif(btrim(e.first_name), '') AS first_name,
           nullif(btrim(e.last_name), '') AS last_name, nullif(btrim(e.full_name), '') AS full_name,
           e.born_at, nullif(e.picture_file_name, '') AS picture_file_name, u.email AS user_email, u.administrator
    FROM entities e LEFT JOIN w ON w.entity_id = e.id LEFT JOIN u ON u.entity_id = e.id
    WHERE w.entity_id IS NOT NULL OR u.entity_id IS NOT NULL
    ORDER BY e.id`;

/** Adresses des personnes : email, portable, postale (non supprimées). */
export type AddressRow = {
  entity_id: number;
  canal: "email" | "mobile" | "mail";
  coordinate: string | null;
  by_default: boolean | null;
  lines: (string | null)[];
  mail_country: string | null;
  updated_at: Date | null;
};
export const personAddresses = (s: Sql) =>
  s<AddressRow[]>`
    SELECT a.entity_id, a.canal, nullif(btrim(a.coordinate), '') AS coordinate, a.by_default,
           ARRAY[a.mail_line_1, a.mail_line_2, a.mail_line_3, a.mail_line_4, a.mail_line_5, a.mail_line_6] AS lines,
           a.mail_country, a.updated_at
    FROM entity_addresses a
    WHERE a.deleted_at IS NULL AND a.canal IN ('email', 'mobile', 'mail')
      AND (a.entity_id IN (SELECT person_id FROM products WHERE type = 'Worker')
           OR a.entity_id IN (SELECT person_id FROM users))
    ORDER BY a.entity_id, a.canal, a.by_default DESC NULLS LAST, a.updated_at DESC NULLS LAST, a.id DESC`;

/** Contrats (Ekylibre 5) : dates et nature seulement, ni salaire ni durée. Vide sans la table. */
export type ContractRow = { entity_id: number; nature: string | null; started_at: Date | null; stopped_at: Date | null };
export async function personContracts(s: Sql): Promise<ContractRow[]> {
  const [ok] = await s<{ ok: boolean }[]>`SELECT to_regclass('worker_contracts') IS NOT NULL AS ok`;
  if (!ok?.ok) return [];
  return s<ContractRow[]>`
    SELECT entity_id, nature, started_at, stopped_at FROM worker_contracts
    WHERE entity_id IS NOT NULL ORDER BY entity_id, started_at DESC NULLS LAST, id DESC`;
}
