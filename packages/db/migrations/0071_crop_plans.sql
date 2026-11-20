-- Assolement prévisionnel, lot AS2a (claudedocs/conception_assolement.md §3).

-- Un assolement par ferme et par campagne (année de récolte) : brouillon
-- sauvegardé au fil de l'eau, appliqué seulement à la validation.
CREATE TABLE crop_plans (
  id              uuid PRIMARY KEY,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  year            int  NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  status          text NOT NULL CHECK (status IN ('draft', 'validated')),
  draft           jsonb,
  revision        int  NOT NULL DEFAULT 0,
  current_version int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  UNIQUE (farm_id, year),
  CHECK (status = 'validated' OR draft IS NOT NULL)
);

-- Versions validées, figées : brouillon appliqué, changements, constats.
CREATE TABLE crop_plan_versions (
  plan_id      uuid NOT NULL REFERENCES crop_plans(id) ON DELETE CASCADE,
  version      int  NOT NULL,
  farm_id      uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  validated_at timestamptz NOT NULL DEFAULT now(),
  validated_by uuid,
  reason       text CHECK (length(reason) <= 500),
  snapshot     jsonb NOT NULL,
  changes      jsonb NOT NULL,
  findings     jsonb NOT NULL,
  refs_version text NOT NULL,
  PRIMARY KEY (plan_id, version)
);

-- Filiation des parcelles découpées ou fusionnées (lot AS3).
CREATE TABLE land_parcel_lineage (
  child_id     uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  parent_id    uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  farm_id      uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('split', 'merge')),
  effective_at timestamptz NOT NULL,
  share        numeric NOT NULL CHECK (share > 0 AND share <= 1),
  plan_id      uuid REFERENCES crop_plans(id) ON DELETE SET NULL,
  PRIMARY KEY (child_id, parent_id)
);
CREATE INDEX land_parcel_lineage_parent ON land_parcel_lineage (parent_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crop_plans', 'crop_plan_versions', 'land_parcel_lineage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;

-- Réglages de l'assolement (critère BCAE 7 mis en avant, plaine du Rhin, délais de retour).
ALTER TABLE farm_settings ADD COLUMN crop_plan jsonb;

-- Code culture PAC d'une activité, quand la production de référence n'en donne pas
-- (ou en donne plusieurs) : catégorie BCAE 7 de l'assolement.
ALTER TABLE activities ADD COLUMN cap_code text CHECK (cap_code ~ '^[A-Z0-9]{3}$');
