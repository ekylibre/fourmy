import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
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
