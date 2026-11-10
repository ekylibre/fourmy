-- Stations météo de l'agriculteur, lot W (retours du 10/11/2026) : Weenat et
-- Sencrop. Les stations du compte sont recopiées, leurs mesures horaires
-- stockées (une ligne par station et par heure) ; la météo d'une
-- intervention passée prend d'abord la station la plus proche.

ALTER TABLE integrations DROP CONSTRAINT integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check
  CHECK (provider IN ('traccar', 'openweather', 'meteoblue', 'weenat', 'sencrop'));

CREATE TABLE weather_stations (
  id              uuid PRIMARY KEY,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('weenat', 'sencrop')),
  external_id     text NOT NULL,
  name            text NOT NULL,
  location        geometry(Point, 4326),
  active          boolean NOT NULL DEFAULT true,
  last_measure_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, provider, external_id)
);
CREATE INDEX weather_stations_location ON weather_stations USING gist (location);
ALTER TABLE weather_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_stations FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON weather_stations
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON weather_stations TO fourmy_app;

CREATE TABLE weather_measures (
  station_id         uuid NOT NULL REFERENCES weather_stations(id) ON DELETE CASCADE,
  farm_id            uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  at                 timestamptz NOT NULL,
  temperature_c      numeric,
  temperature_min_c  numeric,
  temperature_max_c  numeric,
  humidity_pct       numeric,
  wind_kmh           numeric,
  gust_kmh           numeric,
  wind_direction_deg numeric,
  precipitation_mm   numeric,
  leaf_wetness_min   numeric,
  raw                jsonb,
  PRIMARY KEY (station_id, at)
);
CREATE INDEX weather_measures_farm_at ON weather_measures (farm_id, at);
ALTER TABLE weather_measures ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_measures FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON weather_measures
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON weather_measures TO fourmy_app;

-- Synchronisation périodique : Traccar au rythme du worker, stations météo
-- toutes les heures (mesures horaires).
CREATE OR REPLACE FUNCTION fourmy_due_integrations(p_every interval)
RETURNS TABLE (id uuid, farm_id uuid, provider text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.farm_id, i.provider FROM integrations i
  WHERE i.enabled AND i.secret_ciphertext IS NOT NULL
    AND ((i.provider = 'traccar' AND (i.last_sync_at IS NULL OR i.last_sync_at < now() - p_every))
      OR (i.provider IN ('weenat', 'sencrop') AND (i.last_sync_at IS NULL OR i.last_sync_at < now() - greatest(p_every, interval '1 hour'))))
    AND (i.running_since IS NULL OR i.running_since < now() - interval '30 minutes')
  ORDER BY i.last_sync_at NULLS FIRST
$$;
