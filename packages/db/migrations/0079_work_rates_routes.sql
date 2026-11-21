-- Assolement, temps 2, lot IT4 (claudedocs/conception_assolement_itk.md §8 et §15.3) :
-- rattachement d'un matériel à une ligne du barème BCMA (référentiel
-- @fourmy/certification-refs, identifiant texte), et trajets siège ou site →
-- parcelle calculés par OSRM, gardés en cache.

ALTER TABLE equipments ADD COLUMN machinery_rate_id text CHECK (length(machinery_rate_id) <= 120);

CREATE TABLE parcel_routes (
  farm_id      uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  site_id      uuid NOT NULL REFERENCES farm_sites(id) ON DELETE CASCADE,
  -- land_parcel_id, ou empreinte de la forme pour un morceau du brouillon d'assolement.
  parcel_key   text NOT NULL CHECK (length(parcel_key) <= 120),
  -- Empreinte du point d'arrivée et de la position du site : une autre empreinte invalide la ligne.
  shape_hash   text NOT NULL,
  distance_m   integer NOT NULL CHECK (distance_m >= 0),
  duration_s   integer NOT NULL CHECK (duration_s >= 0),
  method       text NOT NULL CHECK (method IN ('osrm', 'estimate')),
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, site_id, parcel_key)
);
ALTER TABLE parcel_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcel_routes FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON parcel_routes
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON parcel_routes TO fourmy_app;
