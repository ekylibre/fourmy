-- Télédétection par parcelle (docs/teledetection-design.md §4) : intégration
-- Copernicus (CDSE) par ferme, acquisitions Sentinel-2 vues sur l'emprise des
-- parcelles, images rendues (PNG) et indices de végétation par version de
-- parcelle et par date d'acquisition.

ALTER TABLE integrations DROP CONSTRAINT integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check
  CHECK (provider IN ('traccar', 'openweather', 'meteoblue', 'weenat', 'sencrop', 'copernicus'));

-- Acquisitions vues sur l'emprise de la ferme, exploitables ou non.
CREATE TABLE satellite_scenes (
  farm_id      uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  source       text NOT NULL DEFAULT 'sentinel-2-l2a',
  acquired_on  date NOT NULL,
  -- Part des pixels des parcelles sans nuage (0..1).
  valid_ratio  numeric NOT NULL CHECK (valid_ratio >= 0 AND valid_ratio <= 1),
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, source, acquired_on)
);

-- Images rendues pour les acquisitions exploitables (NDVI colorié, couleurs naturelles).
CREATE TABLE satellite_images (
  farm_id      uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  acquired_on  date NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('ndvi', 'rgb')),
  west         double precision NOT NULL,
  south        double precision NOT NULL,
  east         double precision NOT NULL,
  north        double precision NOT NULL,
  width        int NOT NULL CHECK (width > 0),
  height       int NOT NULL CHECK (height > 0),
  png          bytea NOT NULL,
  etag         text NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, acquired_on, kind)
);

-- Indices par version de parcelle, par date et par indice.
CREATE TABLE parcel_indices (
  farm_id                 uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  land_parcel_version_id  uuid NOT NULL REFERENCES land_parcel_versions(id) ON DELETE CASCADE,
  acquired_on             date NOT NULL,
  vegetation_index        text NOT NULL CHECK (vegetation_index IN ('ndvi', 'ndre', 'ndmi')),
  mean                    double precision,
  std                     double precision,
  p10                     double precision,
  p50                     double precision,
  p90                     double precision,
  -- Pixels valides (sampleCount − noDataCount) et pixels de la parcelle après retrait de 10 m.
  valid_px                int NOT NULL CHECK (valid_px >= 0),
  parcel_px               int NOT NULL CHECK (parcel_px >= 0),
  source                  text NOT NULL DEFAULT 'cdse-sh-statistical',
  method                  text NOT NULL,
  fetched_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (land_parcel_version_id, acquired_on, vegetation_index)
);
CREATE INDEX parcel_indices_farm_on ON parcel_indices (farm_id, acquired_on);

-- Période déjà interrogée par version de parcelle : depuis fetched_from,
-- jusqu'à la dernière date exploitable obtenue (fetched_until ; la veille de
-- fetched_from s'il n'y en a aucune). Une géométrie modifiée repart de zéro ;
-- un historique plus ancien se complète par l'avant.
CREATE TABLE parcel_index_cursors (
  land_parcel_version_id  uuid PRIMARY KEY REFERENCES land_parcel_versions(id) ON DELETE CASCADE,
  farm_id                 uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  fetched_from            date NOT NULL,
  fetched_until           date NOT NULL CHECK (fetched_until >= fetched_from - 1),
  geometry_hash           text NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Consommation CDSE par ferme et par mois (budget de requêtes).
CREATE TABLE remote_sensing_usage (
  farm_id   uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  month     date NOT NULL CHECK (extract(day FROM month) = 1),
  requests  int NOT NULL DEFAULT 0,
  pu        double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (farm_id, month)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['satellite_scenes', 'satellite_images', 'parcel_indices', 'parcel_index_cursors', 'remote_sensing_usage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;

-- Synchronisation périodique : Traccar au rythme du worker, stations météo
-- toutes les heures, Copernicus toutes les 6 heures (une acquisition L2A est
-- publiée quelques heures à un jour après le passage).
CREATE OR REPLACE FUNCTION fourmy_due_integrations(p_every interval)
RETURNS TABLE (id uuid, farm_id uuid, provider text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.farm_id, i.provider FROM integrations i
  WHERE i.enabled AND i.secret_ciphertext IS NOT NULL
    AND ((i.provider = 'traccar' AND (i.last_sync_at IS NULL OR i.last_sync_at < now() - p_every))
      OR (i.provider IN ('weenat', 'sencrop') AND (i.last_sync_at IS NULL OR i.last_sync_at < now() - greatest(p_every, interval '1 hour')))
      OR (i.provider = 'copernicus' AND (i.last_sync_at IS NULL OR i.last_sync_at < now() - greatest(p_every, interval '6 hours'))))
    AND (i.running_since IS NULL OR i.running_since < now() - interval '30 minutes')
  ORDER BY i.last_sync_at NULLS FIRST
$$;
