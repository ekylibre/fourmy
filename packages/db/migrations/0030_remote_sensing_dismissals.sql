-- Interventions probablement manquantes (lot Z, docs/teledetection.md) : une
-- chute du NDVI sans intervention saisie est signalée ; l'exploitant peut
-- l'écarter (« ce n'est pas une récolte »). La chute est repérée par sa
-- parcelle et la date de sa première mesure au niveau du sol nu.

CREATE TABLE remote_sensing_dismissals (
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  land_parcel_id  uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  event_to        date NOT NULL,
  reason          text CHECK (reason IS NULL OR length(reason) <= 500),
  dismissed_by    uuid,
  dismissed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (land_parcel_id, event_to)
);
ALTER TABLE remote_sensing_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_sensing_dismissals FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON remote_sensing_dismissals
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON remote_sensing_dismissals TO fourmy_app;
