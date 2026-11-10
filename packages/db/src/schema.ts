import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  jsonb,
  date,
  customType,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * Schéma Drizzle — sert au typage des requêtes applicatives.
 * La DDL faisant foi (PostGIS, contraintes d'exclusion, hypertable, RLS)
 * est dans `migrations/*.sql`. On modélise ici la géométrie et `tstzrange`
 * comme types opaques, le domaine passant par GeoJSON et `{lower, upper}`.
 */
const geometry = customType<{ data: unknown; driverData: string }>({
  dataType: () => "geometry",
});
const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => "tstzrange",
});

const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const farms = pgTable("farms", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  ...audit,
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  ...audit,
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(),
});

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  year: integer("year").notNull(),
  startsOn: date("starts_on").notNull(),
  stopsOn: date("stops_on").notNull(),
  ...audit,
});

export const landParcels = pgTable("land_parcels", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  name: text("name").notNull(),
  ...audit,
});

export const landParcelVersions = pgTable("land_parcel_versions", {
  id: uuid("id").primaryKey(),
  landParcelId: uuid("land_parcel_id").notNull(),
  shape: geometry("shape").notNull(),
  areaM2: numeric("area_m2").notNull(),
  pacIslet: text("pac_islet"),
  viti: jsonb("viti"),
  valid: tstzrange("valid").notNull(),
});

export const productions = pgTable("productions", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  landParcelId: uuid("land_parcel_id").notNull(),
  nature: text("nature").notNull(),
  species: text("species"),
  /** Culture (taxonomie Lexicon : zea_mays, vitis…) ; `species` garde la variété saisie. */
  cultivation: text("cultivation"),
  /** Activité de la ferme (migration 0011). */
  activityId: uuid("activity_id"),
  ...audit,
});

/** Activités de la ferme (Maïs, Jachère, Vignes AOP…), production de référence Lexicon. */
export const activities = pgTable("activities", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  name: text("name").notNull(),
  family: text("family").notNull(),
  reference: text("reference"),
  cultivation: text("cultivation"),
  color: text("color"),
  suspended: boolean("suspended").notNull().default(false),
  deduced: boolean("deduced").notNull().default(false),
  ...audit,
});

export const places = pgTable("places", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  name: text("name").notNull(),
  ...audit,
});

export const placeVersions = pgTable("place_versions", {
  id: uuid("id").primaryKey(),
  placeId: uuid("place_id").notNull(),
  kind: text("kind").notNull(),
  footprint: geometry("footprint"),
  heightM: numeric("height_m"),
  source: text("source").notNull(),
  valid: tstzrange("valid").notNull(),
});

export const containers = pgTable("containers", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  placeId: uuid("place_id").notNull(),
  name: text("name").notNull(),
  ...audit,
});

export const containerVersions = pgTable("container_versions", {
  id: uuid("id").primaryKey(),
  containerId: uuid("container_id").notNull(),
  kind: text("kind").notNull(),
  capacityL: numeric("capacity_l").notNull(),
  shape3d: jsonb("shape3d"),
  placement: text("placement").notNull(),
  valid: tstzrange("valid").notNull(),
});

export const equipments = pgTable("equipments", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  state: text("state"),
  ...audit,
});

export const trackerBindings = pgTable("tracker_bindings", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  equipmentId: uuid("equipment_id").notNull(),
  source: text("source").notNull().default("traccar"),
  deviceId: text("device_id").notNull(),
  valid: tstzrange("valid").notNull(),
});

export const positions = pgTable(
  "positions",
  {
    farmId: uuid("farm_id").notNull(),
    bindingId: uuid("binding_id").notNull(),
    time: timestamp("time", { withTimezone: true }).notNull(),
    point: geometry("point").notNull(),
    speed: numeric("speed"),
    heading: numeric("heading"),
    attrs: jsonb("attrs"),
  },
  (t) => [primaryKey({ columns: [t.bindingId, t.time] })],
);

export const articles = pgTable("articles", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  lexiconRef: text("lexicon_ref"),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  unit: text("unit").notNull(),
  amm: text("amm"),
  custom: jsonb("custom"),
  ...audit,
});

export const lots = pgTable("lots", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  articleId: uuid("article_id").notNull(),
  code: text("code").notNull(),
  attrs: jsonb("attrs"),
  ...audit,
});

export const lotLineage = pgTable("lot_lineage", {
  id: uuid("id").primaryKey(),
  childLotId: uuid("child_lot_id").notNull(),
  parentLotId: uuid("parent_lot_id").notNull(),
  share: numeric("share").notNull(),
});

export const interventions = pgTable("interventions", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  procedure: text("procedure").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  origin: text("origin").notNull(),
  clientId: text("client_id"),
  /** 'free' : matériels, intervenants et périodes indépendants ; 'crews' : par attelage (0022). */
  staffing: text("staffing").notNull().default("free"),
  purposes: text("purposes").array().notNull().default([]),
  notes: text("notes"),
  /** Contrôle réglementaire phyto à l'enregistrement (feux, motif d'un passage outre). */
  compliance: jsonb("compliance"),
  /** IFT des traitements (API IFT du ministère), calculé après réalisation. */
  ift: jsonb("ift"),
  /** Météo pendant l'intervention (pré-remplie, modifiable). */
  weather: jsonb("weather"),
  ...audit,
});

export const interventionPeriods = pgTable("intervention_periods", {
  id: uuid("id").primaryKey(),
  interventionId: uuid("intervention_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }).notNull(),
  /** Attelage de la période (mode 'crews'), sinon NULL. */
  crewId: uuid("crew_id"),
});

/** Attelages d'une intervention (0022) : matériels, intervenants et périodes y sont rattachés. */
export const interventionCrews = pgTable("intervention_crews", {
  id: uuid("id").primaryKey(),
  interventionId: uuid("intervention_id").notNull(),
  rank: integer("rank").notNull(),
  label: text("label"),
  templateId: uuid("template_id"),
});

/** Attelages types de la ferme (0025, FR-ATT-6) : composition reprise en un clic à la saisie. */
export const crewTemplates = pgTable("crew_templates", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  name: text("name").notNull(),
  active: boolean("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/** Membres d'un attelage type : un matériel ou un intervenant, dans l'ordre saisi. */
export const crewTemplateMembers = pgTable("crew_template_members", {
  templateId: uuid("template_id").notNull(),
  rank: integer("rank").notNull(),
  equipmentId: uuid("equipment_id"),
  personId: uuid("person_id"),
});

/** Parcours GPS calculés par le worker (0023) : libres, ou figés une fois rattachés. */
export const trackSessions = pgTable("track_sessions", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  equipmentId: uuid("equipment_id").notNull(),
  bindingId: uuid("binding_id").notNull(),
  kind: text("kind").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }).notNull(),
  positionCount: integer("position_count").notNull(),
  distanceM: numeric("distance_m").notNull(),
  coveredAreaM2: numeric("covered_area_m2"),
  coverage: geometry("coverage"),
  parcels: jsonb("parcels").notNull().default([]),
  toolHint: text("tool_hint"),
  toolEquipmentId: uuid("tool_equipment_id"),
  interventionId: uuid("intervention_id"),
  crewId: uuid("crew_id"),
  linkedExtent: tstzrange("linked_extent"),
  drift: jsonb("drift"),
  settingsHash: text("settings_hash").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const people = pgTable("people", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  name: text("name").notNull(),
  role: text("role"),
  userId: uuid("user_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const interventionParameters = pgTable("intervention_parameters", {
  id: uuid("id").primaryKey(),
  interventionId: uuid("intervention_id").notNull(),
  role: text("role").notNull(),
  refType: text("ref_type").notNull(),
  refId: uuid("ref_id"),
  quantity: numeric("quantity"),
  unit: text("unit"),
  workingZone: geometry("working_zone"),
  attrs: jsonb("attrs"),
  /** Attelage du matériel ou de l'intervenant (mode 'crews'), sinon NULL. */
  crewId: uuid("crew_id"),
});

export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  lotId: uuid("lot_id").notNull(),
  placeId: uuid("place_id"),
  containerId: uuid("container_id"),
  quantity: numeric("quantity").notNull(),
  unit: text("unit").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  cause: text("cause").notNull(),
  interventionId: uuid("intervention_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  actor: text("actor").notNull(),
  origin: text("origin").notNull(),
  entity: text("entity").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  diff: jsonb("diff").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const importRuns = pgTable("import_runs", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id"),
  source: text("source").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(),
  report: jsonb("report"),
});

// --- Réglementation phytosanitaire (migration 0009) ---------------------------

/** Référentiel copié des paquets Lexicon (global, lecture seule pour l'application). */
export const lexiconPackages = pgTable("lexicon_packages", {
  name: text("name").primaryKey(),
  version: text("version").notNull(),
  source: text("source").notNull(),
  rows: integer("rows").notNull(),
  loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull(),
});

export const phytoProducts = pgTable("phyto_products", {
  id: integer("id").primaryKey(),
  amm: text("amm").notNull(),
  name: text("name").notNull(),
  otherNames: text("other_names").array().notNull(),
  natures: text("natures").array().notNull(),
  activeCompounds: text("active_compounds").array().notNull(),
  reentryDelayHours: integer("reentry_delay_hours"),
  state: text("state").notNull(),
  startedOn: date("started_on"),
  stoppedOn: date("stopped_on"),
  firm: text("firm"),
  productType: text("product_type"),
  isDerogation: boolean("is_derogation").notNull(),
});

export const phytoUsages = pgTable("phyto_usages", {
  id: text("id").primaryKey(),
  productId: integer("product_id").notNull(),
  phrase: text("phrase").notNull(),
  cropLabel: text("crop_label"),
  species: text("species").array().notNull(),
  targetLabel: text("target_label"),
  treatmentLabel: text("treatment_label"),
  doseQuantity: numeric("dose_quantity"),
  doseUnit: text("dose_unit"),
  doseUnitLabel: text("dose_unit_label"),
  preHarvestDelayDays: integer("pre_harvest_delay_days"),
  applicationsCount: integer("applications_count"),
  applicationsFrequencyDays: integer("applications_frequency_days"),
  untreatedBufferAquatic: integer("untreated_buffer_aquatic"),
  untreatedBufferArthropod: integer("untreated_buffer_arthropod"),
  untreatedBufferPlants: integer("untreated_buffer_plants"),
  usageConditions: text("usage_conditions"),
  decisionDate: date("decision_date"),
  state: text("state").notNull(),
  isDerogation: boolean("is_derogation").notNull(),
  derogationStartedOn: date("derogation_started_on"),
  derogationStoppedOn: date("derogation_stopped_on"),
});

export const phytoCropsets = pgTable("phyto_cropsets", {
  name: text("name").primaryKey(),
  label: text("label"),
  cropNames: text("crop_names").array().notNull(),
});

export const taxonomy = pgTable("taxonomy", {
  referenceName: text("reference_name").primaryKey(),
  parent: text("parent"),
  rank: text("rank"),
  label: text("label"),
});

/** Eau autour de la ferme (BD TOPO), sous RLS. */
export const waterItems = pgTable(
  "water_items",
  {
    id: text("id").notNull(),
    farmId: uuid("farm_id").notNull(),
    kind: text("kind").notNull(),
    nature: text("nature"),
    name: text("name"),
    permanent: boolean("permanent"),
    ditch: boolean("ditch").notNull(),
    geom: geometry("geom").notNull(),
  },
  (t) => [primaryKey({ columns: [t.farmId, t.id] })],
);
