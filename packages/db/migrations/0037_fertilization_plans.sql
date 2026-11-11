-- Plans prévisionnels de fumure, lot AG (docs/fertilisation-design.md §4.2) :
-- un plan par parcelle et par campagne ; brouillon modifiable, puis versions
-- établies immuables (instantané des données, des termes et du référentiel).

CREATE TABLE fertilization_plans (
  id               uuid PRIMARY KEY,
  farm_id          uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  campaign         int NOT NULL CHECK (campaign BETWEEN 2000 AND 2100),
  land_parcel_id   uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  production_id    uuid REFERENCES productions(id) ON DELETE SET NULL,
  kind             text NOT NULL DEFAULT 'main' CHECK (kind IN ('main', 'cover_exported')),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'established', 'revised')),
  -- Saisies du brouillon (objectif, pailles, irrigation prévue, surcharges, apports…), pas les résultats.
  draft            jsonb NOT NULL DEFAULT '{}',
  current_version  int,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, campaign, land_parcel_id, kind)
);

CREATE TABLE fertilization_plan_versions (
  plan_id          uuid NOT NULL REFERENCES fertilization_plans(id) ON DELETE CASCADE,
  version          int NOT NULL CHECK (version >= 1),
  farm_id          uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  established_at   timestamptz NOT NULL DEFAULT now(),
  established_by   uuid NOT NULL,
  reason           text,
  referential      text NOT NULL,
  method           text NOT NULL,
  -- Dose venue d'un outil ou d'un conseiller : { doseKgNHa, tool, advisor, computedOn }.
  external         jsonb,
  -- Entrées, termes (valeur, origine, source), résultat du calcul de Fourmy.
  snapshot         jsonb NOT NULL,
  dose_efficient   numeric,
  dose_total       numeric,
  PRIMARY KEY (plan_id, version),
  CHECK (version = 1 OR reason IS NOT NULL)
);

CREATE TABLE fertilization_plan_applications (
  plan_id                uuid NOT NULL,
  version                int NOT NULL,
  rank                   int NOT NULL CHECK (rank >= 1),
  farm_id                uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  stage                  text NOT NULL,
  planned_on             date,
  article_id             uuid REFERENCES articles(id) ON DELETE SET NULL,
  n_efficient            numeric NOT NULL CHECK (n_efficient >= 0),
  n_total                numeric NOT NULL CHECK (n_total >= 0),
  reserved_for_steering  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (plan_id, version, rank),
  FOREIGN KEY (plan_id, version) REFERENCES fertilization_plan_versions (plan_id, version) ON DELETE CASCADE
);

-- Une version établie ne se modifie pas.
CREATE FUNCTION fourmy_plan_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Une version établie de plan de fumure ne se modifie pas : établissez une révision.';
END $$;
CREATE TRIGGER fertilization_plan_versions_immutable BEFORE UPDATE ON fertilization_plan_versions
  FOR EACH ROW EXECUTE FUNCTION fourmy_plan_version_immutable();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fertilization_plans', 'fertilization_plan_versions', 'fertilization_plan_applications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;
