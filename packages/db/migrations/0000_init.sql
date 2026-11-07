-- Fourmy — schéma initial de la première tranche.
-- Modèle « états versionnés + journaux + séries » (architecture §4).
-- Authoritative : c'est ce fichier qui est appliqué ; le schéma Drizzle
-- (src/schema.ts) sert au typage des requêtes.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;      -- pour la contrainte d'exclusion
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;        -- gen_random_uuid (secours)

-- Rôle applicatif : soumis à la RLS (jamais superuser, jamais BYPASSRLS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fourmy_app') THEN
    CREATE ROLE fourmy_app NOLOGIN;
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- Cœur : fermes, utilisateurs, appartenances
-- ---------------------------------------------------------------------------
CREATE TABLE farms (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          uuid PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id        uuid PRIMARY KEY,
  farm_id   uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('owner','worker')),
  UNIQUE (farm_id, user_id)
);

CREATE TABLE campaigns (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  year        int  NOT NULL,
  starts_on   date NOT NULL,
  stops_on    date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Parcellaire : identité + versions (états versionnés)
-- ---------------------------------------------------------------------------
CREATE TABLE land_parcels (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE land_parcel_versions (
  id               uuid PRIMARY KEY,
  land_parcel_id   uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  shape            geometry(MultiPolygon, 4326) NOT NULL,
  area_m2          numeric NOT NULL,
  pac_islet        text,
  viti             jsonb,
  valid            tstzrange NOT NULL,
  -- Jamais deux versions d'une même parcelle qui se chevauchent dans le temps.
  EXCLUDE USING gist (land_parcel_id WITH =, valid WITH &&)
);
CREATE INDEX land_parcel_versions_shape_gix ON land_parcel_versions USING gist (shape);
CREATE INDEX land_parcel_versions_valid_gix ON land_parcel_versions USING gist (valid);

CREATE TABLE productions (
  id              uuid PRIMARY KEY,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  land_parcel_id  uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  nature          text NOT NULL CHECK (nature IN ('field_crop','vine','grassland')),
  species         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Bâtiments, cuves, matériels
-- ---------------------------------------------------------------------------
CREATE TABLE places (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE place_versions (
  id          uuid PRIMARY KEY,
  place_id    uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('building','room','storage')),
  footprint   geometry(Polygon, 4326),
  height_m    numeric,
  source      text NOT NULL CHECK (source IN ('ign','ekylibre','manual')),
  valid       tstzrange NOT NULL,
  EXCLUDE USING gist (place_id WITH =, valid WITH &&)
);
CREATE INDEX place_versions_footprint_gix ON place_versions USING gist (footprint);

CREATE TABLE containers (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  place_id    uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE container_versions (
  id            uuid PRIMARY KEY,
  container_id  uuid NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('tank','silo','barrel')),
  capacity_l    numeric NOT NULL,
  shape3d       jsonb,
  placement     text NOT NULL CHECK (placement IN ('auto','manual')),
  valid         tstzrange NOT NULL,
  EXCLUDE USING gist (container_id WITH =, valid WITH &&)
);

CREATE TABLE equipments (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL,
  state       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tracker_bindings (
  id            uuid PRIMARY KEY,
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  equipment_id  uuid NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  source        text NOT NULL DEFAULT 'traccar' CHECK (source = 'traccar'),
  device_id     text NOT NULL,
  valid         tstzrange NOT NULL,
  EXCLUDE USING gist (equipment_id WITH =, valid WITH &&)
);

-- ---------------------------------------------------------------------------
-- Positions GPS (série temporelle, hypertable Timescale)
-- ---------------------------------------------------------------------------
CREATE TABLE positions (
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  binding_id  uuid NOT NULL REFERENCES tracker_bindings(id) ON DELETE CASCADE,
  time        timestamptz NOT NULL,
  point       geometry(Point, 4326) NOT NULL,
  speed       numeric,
  heading     numeric,
  attrs       jsonb,
  PRIMARY KEY (binding_id, time)
);
SELECT create_hypertable('positions', 'time', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX positions_point_gix ON positions USING gist (point);
-- La RLS doit être posée AVANT la compression (TimescaleDB refuse ALTER TABLE
-- ... ENABLE RLS sur une hypertable au columnstore actif).
-- Isolation par ferme (ADR-4) : priorité à la sécurité.
-- NB : sur timescaledb-ha pg17, compression (columnstore) et RLS sont
-- mutuellement exclusives sur une hypertable. On garde la RLS et on reporte
-- la compression (optimisation, architecture §11) : à réintroduire via une
-- isolation applicative de `positions` ou une version de Timescale qui lève
-- la restriction.
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions FORCE  ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Articles, lots, stocks (journal immuable)
-- ---------------------------------------------------------------------------
CREATE TABLE articles (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  lexicon_ref text,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('phyto','fertilizer','seed','harvest','wine','other')),
  unit        text NOT NULL,
  amm         text,
  custom      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lots (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  article_id  uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  code        text NOT NULL,
  attrs       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lot_lineage (
  id            uuid PRIMARY KEY,
  child_lot_id  uuid NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  parent_lot_id uuid NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  share         numeric NOT NULL CHECK (share >= 0 AND share <= 1)
);

CREATE TABLE interventions (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  procedure   text NOT NULL,
  status      text NOT NULL CHECK (status IN ('planned','done')),
  started_at  timestamptz,
  stopped_at  timestamptz,
  origin      text NOT NULL CHECK (origin IN ('web','mobile','migration','plugin')),
  client_id   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, client_id)   -- idempotence de la synchro mobile
);

CREATE TABLE intervention_parameters (
  id               uuid PRIMARY KEY,
  intervention_id  uuid NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('target','input','output','tool','doer')),
  ref_type         text NOT NULL,
  ref_id           uuid,
  quantity         numeric,
  unit             text,
  working_zone     geometry(Geometry, 4326)
);

CREATE TABLE stock_movements (
  id               uuid PRIMARY KEY,
  farm_id          uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  lot_id           uuid NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  place_id         uuid REFERENCES places(id),
  container_id     uuid REFERENCES containers(id),
  quantity         numeric NOT NULL,
  unit             text NOT NULL,
  occurred_at      timestamptz NOT NULL,
  cause            text NOT NULL CHECK (cause IN ('migration','intervention','purchase','sale','adjustment','transfer')),
  intervention_id  uuid REFERENCES interventions(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (place_id IS NOT NULL OR container_id IS NOT NULL)
);
CREATE INDEX stock_movements_lot_time_ix ON stock_movements (lot_id, occurred_at);
CREATE INDEX stock_movements_container_time_ix ON stock_movements (container_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Audit, outbox, imports
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  actor       text NOT NULL,
  origin      text NOT NULL,
  entity      text NOT NULL,
  entity_id   uuid NOT NULL,
  action      text NOT NULL,
  diff        jsonb NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id            uuid PRIMARY KEY,
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX outbox_unpublished_ix ON outbox_events (occurred_at) WHERE published_at IS NULL;

CREATE TABLE import_runs (
  id           uuid PRIMARY KEY,
  farm_id      uuid REFERENCES farms(id) ON DELETE SET NULL,
  source       text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL CHECK (status IN ('running','completed','failed')),
  report       jsonb
);
