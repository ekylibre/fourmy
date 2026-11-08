-- Plan d'entretien, lot J (docs/materiels-entretien-design.md §2.2).
--
-- Catalogue des modèles de matériel (plan par défaut, fluides, pièces) :
-- une ligne `farm_id` NULL est un modèle commun ; sinon, le modèle a été
-- importé par cette ferme et lui reste propre (notices et catalogues de
-- pièces du constructeur : droits de diffusion incertains).
--
-- Plan de la ferme : opérations copiées du modèle sur un matériel, puis
-- ajustables. Les échéances ne sont jamais stockées : le domaine les calcule
-- (plan, réalisations, relevés) à n'importe quelle date.

CREATE TABLE equipment_models (
  id                 uuid PRIMARY KEY,
  farm_id            uuid REFERENCES farms(id) ON DELETE CASCADE,
  slug               text NOT NULL,
  brand              text NOT NULL,
  model              text NOT NULL,
  manufacturer_type  text,
  sources            jsonb NOT NULL DEFAULT '[]',
  warning            text,
  imported_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX equipment_models_slug ON equipment_models (coalesce(farm_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

CREATE TABLE model_operations (
  id               uuid PRIMARY KEY,
  model_id         uuid NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
  code             text NOT NULL,
  manual_number    text,
  label            text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('inspection','cleaning','greasing','replacement','oil_change','adjustment','bleeding','visit')),
  every_hours      numeric CHECK (every_hours > 0),
  every_months     int CHECK (every_months > 0),
  first_hours      numeric CHECK (first_hours > 0),
  performer        text NOT NULL DEFAULT 'member' CHECK (performer IN ('member','workshop')),
  requires_option  text,
  condition        text,
  source           jsonb,
  parts            jsonb NOT NULL DEFAULT '[]',   -- [{ reference, referenceNorm, designation, quantity, family }]
  position         int NOT NULL DEFAULT 0,
  UNIQUE (model_id, code)
);

CREATE TABLE model_fluids (
  id              uuid PRIMARY KEY,
  model_id        uuid NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
  organ           text NOT NULL,
  fluid           text NOT NULL,
  standard        text,
  viscosity       text,
  capacity        text,            -- tel qu'écrit dans la notice (« 10 – 12,5 », « 2 x 0,6 »)
  capacity_max_l  numeric,         -- quantité à prévoir pour une vidange
  note            text,
  source          jsonb,
  UNIQUE (model_id, organ)
);

CREATE TABLE model_parts (
  id              uuid PRIMARY KEY,
  model_id        uuid NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
  reference       text NOT NULL,
  reference_norm  text NOT NULL,
  designation     text NOT NULL,
  family          text,
  quantity        numeric,
  catalog         jsonb,           -- { group, subgroup, plate, item, drawing }
  operations      text[] NOT NULL DEFAULT '{}',
  note            text,
  UNIQUE (model_id, reference_norm, family)
);

-- ---------------------------------------------------------------------------
-- Plan de la ferme
-- ---------------------------------------------------------------------------
ALTER TABLE equipments ADD COLUMN model_id uuid REFERENCES equipment_models(id) ON DELETE SET NULL;

CREATE TABLE equipment_operations (
  id                  uuid PRIMARY KEY,
  farm_id             uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  equipment_id        uuid NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  model_operation_id  uuid REFERENCES model_operations(id) ON DELETE SET NULL,
  code                text,
  label               text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('inspection','cleaning','greasing','replacement','oil_change','adjustment','bleeding','visit')),
  every_hours         numeric CHECK (every_hours > 0),
  every_months        int CHECK (every_months > 0),
  first_hours         numeric CHECK (first_hours > 0),
  performer           text NOT NULL DEFAULT 'member' CHECK (performer IN ('member','workshop')),
  requires_option     text,
  condition           text,
  source              jsonb,
  -- « Dernière fois connue » : amorce l'échéance sans intervention.
  baseline_at         timestamptz,
  baseline_hours      numeric CHECK (baseline_hours >= 0),
  -- Retirée du plan (ou non applicable : option absente d'usine).
  archived_at         timestamptz,
  archived_reason     text,
  position            int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (equipment_id, code)
);
CREATE INDEX equipment_operations_equipment ON equipment_operations (equipment_id, position);

CREATE TABLE equipment_operation_parts (
  id            uuid PRIMARY KEY,
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  operation_id  uuid NOT NULL REFERENCES equipment_operations(id) ON DELETE CASCADE,
  article_id    uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  quantity      numeric NOT NULL CHECK (quantity > 0),
  UNIQUE (operation_id, article_id)
);

-- Pièces d'entretien du matériel (référentiel, FR-MAT-40).
CREATE TABLE equipment_parts (
  id            uuid PRIMARY KEY,
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  equipment_id  uuid NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  article_id    uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  family        text,
  quantity      numeric,
  catalog       jsonb,
  note          text,
  UNIQUE (equipment_id, article_id)
);

CREATE TABLE equipment_fluids (
  id              uuid PRIMARY KEY,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  equipment_id    uuid NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  organ           text NOT NULL,
  fluid           text NOT NULL,
  standard        text,
  viscosity       text,
  capacity        text,
  capacity_max_l  numeric,
  article_id      uuid REFERENCES articles(id) ON DELETE SET NULL,
  note            text,
  source          jsonb,
  UNIQUE (equipment_id, organ)
);

-- Réglages de la ferme (entretien : seuils « bientôt »).
CREATE TABLE farm_settings (
  farm_id      uuid PRIMARY KEY REFERENCES farms(id) ON DELETE CASCADE,
  maintenance  jsonb NOT NULL DEFAULT '{"soonHours": 50, "soonMonths": 1}',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------
-- Modèles : communs (farm_id NULL, lecture seule) ou propres à la ferme.
ALTER TABLE equipment_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_models FORCE ROW LEVEL SECURITY;
CREATE POLICY model_read ON equipment_models FOR SELECT USING (farm_id IS NULL OR farm_id = current_farm_id());
CREATE POLICY model_write ON equipment_models FOR ALL USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_models TO fourmy_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['model_operations', 'model_fluids', 'model_parts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY model_read ON %I FOR SELECT USING (EXISTS (SELECT 1 FROM equipment_models m WHERE m.id = model_id AND (m.farm_id IS NULL OR m.farm_id = current_farm_id())))', t);
    EXECUTE format('CREATE POLICY model_write ON %I FOR ALL USING (EXISTS (SELECT 1 FROM equipment_models m WHERE m.id = model_id AND m.farm_id = current_farm_id())) WITH CHECK (EXISTS (SELECT 1 FROM equipment_models m WHERE m.id = model_id AND m.farm_id = current_farm_id()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['equipment_operations', 'equipment_operation_parts', 'equipment_parts', 'equipment_fluids', 'farm_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;
