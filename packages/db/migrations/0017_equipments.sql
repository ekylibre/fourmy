-- Matériels, lot I (docs/materiels-entretien-design.md §2.1) : fiche
-- d'identité, compteur, options montées datées, relevés de compteur, marques
-- de la ferme (logo et couleur partagés), fichiers (logo 2D). Les natures
-- d'articles « pièce » et « fluide » arrivent dès ce lot.

-- ---------------------------------------------------------------------------
-- Fichiers (logos, plus tard modèles 3D) : en base, propres à la ferme.
-- ---------------------------------------------------------------------------
CREATE TABLE equipment_assets (
  id            uuid PRIMARY KEY,
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('logo', 'logo_raster', 'model')),
  media_type    text NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/svg+xml', 'model/gltf-binary')),
  bytes         bytea NOT NULL,
  size          int NOT NULL CHECK (size > 0 AND size <= 5242880),
  sha256        text NOT NULL,
  -- Version raster (PNG) d'un logo SVG, produite par le navigateur : texture 3D.
  raster_id     uuid REFERENCES equipment_assets(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Marques de la ferme : un logo et une couleur partagés par leurs matériels.
CREATE TABLE farm_brands (
  id             uuid PRIMARY KEY,
  farm_id        uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name           text NOT NULL,
  name_norm      text NOT NULL,
  color          text CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_asset_id  uuid REFERENCES equipment_assets(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, name_norm)
);

-- ---------------------------------------------------------------------------
-- Fiche matériel
-- ---------------------------------------------------------------------------
ALTER TABLE equipments
  ADD COLUMN brand             text,
  ADD COLUMN brand_id          uuid REFERENCES farm_brands(id) ON DELETE SET NULL,
  ADD COLUMN model             text,
  ADD COLUMN serial_number     text,
  ADD COLUMN manufacturer_type text,
  ADD COLUMN year              int CHECK (year BETWEEN 1900 AND 2100),
  -- NULL : pas de compteur ; 'hours' : compteur d'heures moteur.
  ADD COLUMN meter_unit        text CHECK (meter_unit IN ('hours')),
  ADD COLUMN commissioned_at   timestamptz,
  -- Facultatives (NULL = vide) : les fixtures sont rechargées par json_populate_recordset.
  ADD COLUMN aggregates        jsonb DEFAULT '[]',
  ADD COLUMN technical         jsonb,
  ADD COLUMN external_ids      jsonb DEFAULT '{}',
  ADD COLUMN logo_asset_id     uuid REFERENCES equipment_assets(id) ON DELETE SET NULL,
  ADD COLUMN notes             text;

-- Tracteurs et automoteurs ont un compteur d'heures ; les outils, non.
UPDATE equipments SET meter_unit = 'hours' WHERE kind IN ('tractor', 'self_propelled_equipment');

-- Options montées, datées (relevage avant, prise de force avant…).
CREATE TABLE equipment_options (
  id            uuid PRIMARY KEY,
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  equipment_id  uuid NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  code          text NOT NULL,
  label         text NOT NULL,
  valid         tstzrange NOT NULL,
  source        jsonb,
  EXCLUDE USING gist (equipment_id WITH =, code WITH =, valid WITH &&)
);

-- ---------------------------------------------------------------------------
-- Relevés de compteur (FR-MAT-10 à 12)
-- ---------------------------------------------------------------------------
CREATE TABLE meter_readings (
  id                 uuid PRIMARY KEY,
  farm_id            uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  equipment_id       uuid NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  read_at            timestamptz NOT NULL,
  value              numeric NOT NULL CHECK (value >= 0),
  origin             text NOT NULL CHECK (origin IN ('manual', 'intervention', 'reference', 'traccar')),
  -- 'fix' : corrige une saisie fausse ; 'replacement' : compteur remplacé.
  correction         text CHECK (correction IN ('fix', 'replacement')),
  correction_reason  text,
  intervention_id    uuid REFERENCES interventions(id) ON DELETE CASCADE,
  client_id          text,
  author             text,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, client_id),
  CHECK ((correction IS NULL) = (correction_reason IS NULL)),
  CHECK ((origin = 'intervention') = (intervention_id IS NOT NULL))
);
CREATE INDEX meter_readings_equipment_time ON meter_readings (equipment_id, read_at);

-- Pièces et fluides (huiles, graisses, AdBlue…) : natures d'articles.
ALTER TABLE articles DROP CONSTRAINT articles_kind_check;
ALTER TABLE articles ADD CONSTRAINT articles_kind_check
  CHECK (kind IN ('phyto', 'fertilizer', 'seed', 'harvest', 'wine', 'part', 'fluid', 'other'));

-- ---------------------------------------------------------------------------
-- Isolation par ferme
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['equipment_assets', 'farm_brands', 'equipment_options', 'meter_readings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;
