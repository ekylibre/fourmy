-- Modèle de croissance (lot AB, docs/modele-croissance.md).
--
-- daily_weather : météo journalière Open-Meteo au centre de la ferme, en
-- cache. L'archive (ERA5) est définitive ; les jours de l'API de prévision
-- (7 jours passés, 16 à venir) sont remplacés à chaque rafraîchissement, et
-- par l'archive quand elle les couvre.
CREATE TABLE daily_weather (
  farm_id      uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  day          date NOT NULL,
  tmin_c       double precision,
  tmax_c       double precision,
  rain_mm      double precision,
  et0_mm       double precision,
  source       text NOT NULL CHECK (source IN ('archive', 'forecast')),
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, day)
);
ALTER TABLE daily_weather ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_weather FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON daily_weather
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON daily_weather TO fourmy_app;

-- parcel_soils : réserve utile et irrigation saisies par l'exploitant
-- (sinon 100 mm, en sec).
CREATE TABLE parcel_soils (
  land_parcel_id  uuid PRIMARY KEY REFERENCES land_parcels(id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  taw_mm          double precision NOT NULL CHECK (taw_mm >= 10 AND taw_mm <= 400),
  irrigated       boolean NOT NULL DEFAULT false,
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE parcel_soils ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcel_soils FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON parcel_soils
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON parcel_soils TO fourmy_app;
