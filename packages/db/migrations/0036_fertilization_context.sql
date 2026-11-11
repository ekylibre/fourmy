-- Fertilisation azotée, lot AF (docs/fertilisation-design.md §4.3, 4.4) :
-- sol régional et point d'eau des parcelles, analyses de sol, points d'eau
-- d'irrigation, paramètres de la ferme, zonage nitrates des parcelles.

-- Points d'eau d'irrigation : origine (surface 25 mg/L, souterraine 40 mg/L
-- par défaut en Nouvelle-Aquitaine) et teneur mesurée en nitrates.
CREATE TABLE water_sources (
  id            uuid PRIMARY KEY,
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  origin        text NOT NULL CHECK (origin IN ('surface', 'groundwater')),
  nitrate_mg_l  numeric CHECK (nitrate_mg_l >= 0 AND nitrate_mg_l <= 500),
  measured_on   date,
  method        text CHECK (method IN ('lab', 'strip')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE parcel_soils
  ADD COLUMN soil_type text,
  ADD COLUMN soil_type_region text,
  ADD COLUMN rooting_depth_cm int CHECK (rooting_depth_cm BETWEEN 10 AND 300),
  ADD COLUMN water_source_id uuid REFERENCES water_sources(id) ON DELETE SET NULL;
-- La réserve utile reste obligatoire pour le modèle de croissance (lot AB) ;
-- une fiche sol peut désormais ne porter que le type de sol.
ALTER TABLE parcel_soils ALTER COLUMN taw_mm DROP NOT NULL;

-- Analyses de sol : reliquats (horizons NO3, NH4) et analyses de terre.
CREATE TABLE soil_analyses (
  id              uuid PRIMARY KEY,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  land_parcel_id  uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  sampled_on      date NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('rsh', 'post_harvest', 'soil')),
  -- Reliquat : [{ fromCm, toCm, no3KgHa, nh4KgHa }] (kg N/ha par horizon).
  horizons        jsonb,
  -- Analyse de terre : { organicMatterPct, carbonGKg, nTotalGKg, clayGKg, caco3GKg, ph, cecMeq, stonesPct }.
  soil_values     jsonb,
  lab             text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'soil' OR horizons IS NOT NULL)
);
CREATE INDEX soil_analyses_parcel ON soil_analyses (land_parcel_id, sampled_on DESC);

-- Paramètres de la ferme : région du référentiel, début de campagne.
CREATE TABLE fertilization_settings (
  farm_id              uuid PRIMARY KEY REFERENCES farms(id) ON DELETE CASCADE,
  region               text NOT NULL DEFAULT 'nouvelle-aquitaine' CHECK (region IN ('nouvelle-aquitaine')),
  campaign_start_mmdd  text NOT NULL DEFAULT '09-01' CHECK (campaign_start_mmdd ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Zonage nitrates par parcelle : calculé d'après la commune, puis confirmé.
CREATE TABLE parcel_nitrate_zones (
  land_parcel_id  uuid PRIMARY KEY REFERENCES land_parcels(id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  insee           text,
  commune         text,
  status          text NOT NULL CHECK (status IN ('in', 'partial', 'out', 'unknown')),
  -- Zones particulières du calendrier : 'zar', 'ouest', 'montagne'…
  zones           text[] NOT NULL DEFAULT '{}',
  referential     text NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  confirmed_by    uuid,
  confirmed_at    timestamptz,
  note            text
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['water_sources', 'soil_analyses', 'fertilization_settings', 'parcel_nitrate_zones'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;
