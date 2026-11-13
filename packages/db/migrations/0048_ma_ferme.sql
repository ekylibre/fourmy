-- « Ma ferme », lot F1 (claudedocs/conception_ma_ferme.md §3.1 à §3.3) :
-- identité de l'exploitation sur `farms`, certifications de l'exploitation,
-- sites (le siège porte l'adresse de la ferme).

-- Identité : relation un-à-un avec la ferme, SIRET et PACAGE y sont déjà
-- (0027) et /settings/identity continue de les lire.
ALTER TABLE farms
  ADD COLUMN legal_name          text CHECK (length(legal_name) <= 200),
  ADD COLUMN legal_form          text CHECK (legal_form IN ('ei', 'earl', 'gaec', 'scea', 'sarl', 'sas', 'other')),
  ADD COLUMN vat_number          text CHECK (vat_number ~ '^FR[0-9A-HJ-NP-Z]{2}[0-9]{9}$'),
  ADD COLUMN naf_code            text CHECK (naf_code ~ '^[0-9]{2}\.[0-9]{2}[A-Z]$'),
  ADD COLUMN cvi                 text CHECK (cvi ~ '^[0-9A-Z]{10}$'),
  ADD COLUMN ede                 text CHECK (ede ~ '^[0-9]{8}$'),
  ADD COLUMN phone               text CHECK (length(phone) <= 30),
  ADD COLUMN email               text CHECK (length(email) <= 200),
  -- Responsable légal : une personne de l'équipe, ou un nom libre (la
  -- personne l'emporte si les deux sont remplis).
  ADD COLUMN legal_rep_person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  ADD COLUMN legal_rep_name      text CHECK (length(legal_rep_name) <= 120);

-- Certificats de l'exploitation (agrément phyto, bio, HVE) avec échéance.
-- Le périmètre par parcelle (quelles parcelles, depuis quand) reste dans
-- parcel_certifications (0015).
CREATE TABLE farm_certifications (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('phyto_approval', 'organic', 'hve')),
  body        text CHECK (length(body) <= 120),
  number      text CHECK (length(number) <= 60),
  level       text CHECK (level IN ('1', '2', '3')),
  expires_on  date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'hve' OR level IS NULL)
);
CREATE INDEX farm_certifications_farm ON farm_certifications (farm_id, expires_on);

-- Sites : le siège (un seul par ferme) porte l'adresse de la ferme ; chaque
-- site a un point et le rayon de sa zone IGN.
CREATE TABLE farm_sites (
  id              uuid PRIMARY KEY,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  is_headquarters boolean NOT NULL DEFAULT false,
  address_line1   text CHECK (length(address_line1) <= 200),
  address_line2   text CHECK (length(address_line2) <= 200),
  postal_code     text CHECK (postal_code ~ '^[0-9]{5}$'),
  city            text CHECK (length(city) <= 120),
  insee_code      text CHECK (insee_code ~ '^[0-9][0-9AB][0-9]{3}$'),
  location        geometry(Point, 4326),
  location_source text CHECK (location_source IN ('geocoded', 'manual')),
  geocode_score   real CHECK (geocode_score BETWEEN 0 AND 1),
  geocode_type    text CHECK (geocode_type IN ('housenumber', 'street', 'locality', 'municipality')),
  radius_m        integer NOT NULL DEFAULT 10000 CHECK (radius_m BETWEEN 1000 AND 30000),
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((location IS NULL) = (location_source IS NULL)),
  CHECK (location_source = 'geocoded' OR (geocode_score IS NULL AND geocode_type IS NULL))
);
CREATE UNIQUE INDEX farm_sites_one_hq ON farm_sites (farm_id) WHERE is_headquarters;
CREATE INDEX farm_sites_farm ON farm_sites (farm_id, position);
CREATE INDEX farm_sites_location ON farm_sites USING gist (location);

-- Le siège ne se supprime pas (E20), sauf avec la ferme elle-même : pendant
-- la cascade, la ligne de la ferme n'est déjà plus visible.
CREATE FUNCTION fourmy_farm_site_keep_hq() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_headquarters AND EXISTS (SELECT 1 FROM farms WHERE id = OLD.farm_id) THEN
    RAISE EXCEPTION 'Le siège ne se supprime pas : déplacez-le.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER farm_sites_keep_hq BEFORE DELETE ON farm_sites
  FOR EACH ROW EXECUTE FUNCTION fourmy_farm_site_keep_hq();

-- Toute ferme a son siège, quel que soit le chemin de création (import
-- Ekylibre, tests, scripts). La RLS de farm_sites demande le contexte de la
-- ferme : on le pose le temps de l'insertion, puis on remet l'ancien.
CREATE FUNCTION fourmy_farm_create_hq() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous text := current_setting('fourmy.farm_id', true);
BEGIN
  PERFORM set_config('fourmy.farm_id', NEW.id::text, true);
  INSERT INTO farm_sites (id, farm_id, name, is_headquarters) VALUES (gen_random_uuid(), NEW.id, 'Siège', true);
  PERFORM set_config('fourmy.farm_id', coalesce(previous, ''), true);
  RETURN NEW;
END $$;
CREATE TRIGGER farms_create_hq AFTER INSERT ON farms
  FOR EACH ROW EXECUTE FUNCTION fourmy_farm_create_hq();

INSERT INTO farm_sites (id, farm_id, name, is_headquarters)
SELECT gen_random_uuid(), f.id, 'Siège', true FROM farms f
WHERE NOT EXISTS (SELECT 1 FROM farm_sites s WHERE s.farm_id = f.id AND s.is_headquarters);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['farm_certifications', 'farm_sites'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;
