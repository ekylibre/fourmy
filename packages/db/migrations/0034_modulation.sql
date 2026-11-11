-- Cartes de modulation et agrirouter (lot AD, FR-TWIN-6, docs/modulation.md).

-- Raster d'un indice par version de parcelle et par date : pixels de 10 m en
-- UTM (un octet par pixel, voir @fourmy/sentinel indexRasterEvalscript), pour
-- zoner sans redemander l'image à Copernicus.
CREATE TABLE parcel_index_rasters (
  farm_id                 uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  land_parcel_version_id  uuid NOT NULL REFERENCES land_parcel_versions(id) ON DELETE CASCADE,
  acquired_on             date NOT NULL,
  vegetation_index        text NOT NULL CHECK (vegetation_index IN ('ndvi', 'ndre', 'ndmi')),
  method                  text NOT NULL,
  epsg                    int NOT NULL,
  -- Coin nord-ouest et taille du pixel (m), dimensions.
  x_min                   double precision NOT NULL,
  y_max                   double precision NOT NULL,
  resolution              double precision NOT NULL CHECK (resolution > 0),
  width                   int NOT NULL CHECK (width > 0),
  height                  int NOT NULL CHECK (height > 0),
  pixels                  bytea NOT NULL,
  fetched_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (land_parcel_version_id, acquired_on, vegetation_index)
);

CREATE TABLE prescriptions (
  id                uuid PRIMARY KEY,
  farm_id           uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  land_parcel_id    uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  acquired_on       date NOT NULL,
  vegetation_index  text NOT NULL CHECK (vegetation_index IN ('ndvi', 'ndre', 'ndmi')),
  zone_count        int NOT NULL CHECK (zone_count BETWEEN 2 AND 7),
  product           text NOT NULL CHECK (length(product) BETWEEN 1 AND 100),
  unit              text NOT NULL CHECK (unit IN ('kg_ha', 'l_ha', 'seeds_ha')),
  strategy          text NOT NULL CHECK (strategy IN ('compensate', 'boost', 'uniform')),
  base_rate         double precision NOT NULL CHECK (base_rate > 0),
  modulation_pct    double precision NOT NULL CHECK (modulation_pct BETWEEN 0 AND 100),
  min_rate          double precision NOT NULL CHECK (min_rate >= 0),
  max_rate          double precision NOT NULL CHECK (max_rate >= min_rate),
  width_m           double precision NOT NULL CHECK (width_m BETWEEN 1 AND 60),
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prescriptions_parcel ON prescriptions (farm_id, land_parcel_id);

CREATE TABLE prescription_zones (
  prescription_id  uuid NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  farm_id          uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  code             int NOT NULL CHECK (code BETWEEN 1 AND 7),
  mean_index       double precision NOT NULL,
  min_index        double precision NOT NULL,
  max_index        double precision NOT NULL,
  area_m2          double precision NOT NULL CHECK (area_m2 >= 0),
  rate             double precision NOT NULL CHECK (rate >= 0),
  shape            geometry(MultiPolygon, 4326) NOT NULL,
  PRIMARY KEY (prescription_id, code)
);

-- Envois aux machines (agrirouter). 'sent' : accepté par agrirouter pour
-- routage, pas forcément reçu par la machine.
CREATE TABLE prescription_sends (
  id               uuid PRIMARY KEY,
  prescription_id  uuid NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  farm_id          uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  channel          text NOT NULL CHECK (channel IN ('agrirouter')),
  format           text NOT NULL CHECK (format IN ('isoxml', 'shape')),
  recipients       jsonb NOT NULL,
  status           text NOT NULL CHECK (status IN ('sent', 'error')),
  error            text,
  sent_by          uuid,
  sent_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prescription_sends_prescription ON prescription_sends (prescription_id, sent_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parcel_index_rasters', 'prescriptions', 'prescription_zones', 'prescription_sends'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;

-- agrirouter : connexion par consentement ; le « secret » chiffré est
-- l'identifiant de la ferme dans agrirouter (tenant). Synchro toutes les heures
-- (destinataires joignables).
ALTER TABLE integrations DROP CONSTRAINT integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check
  CHECK (provider IN ('traccar', 'openweather', 'meteoblue', 'weenat', 'sencrop', 'copernicus', 'agrirouter'));

CREATE OR REPLACE FUNCTION fourmy_due_integrations(p_every interval)
RETURNS TABLE (id uuid, farm_id uuid, provider text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.farm_id, i.provider FROM integrations i
  WHERE i.enabled AND i.secret_ciphertext IS NOT NULL
    AND ((i.provider = 'traccar' AND (i.last_sync_at IS NULL OR i.last_sync_at < now() - p_every))
      OR (i.provider IN ('weenat', 'sencrop', 'agrirouter') AND (i.last_sync_at IS NULL OR i.last_sync_at < now() - greatest(p_every, interval '1 hour')))
      OR (i.provider = 'copernicus' AND (i.last_sync_at IS NULL OR i.last_sync_at < now() - greatest(p_every, interval '6 hours'))))
    AND (i.running_since IS NULL OR i.running_since < now() - interval '30 minutes')
  ORDER BY i.last_sync_at NULLS FIRST
$$;
