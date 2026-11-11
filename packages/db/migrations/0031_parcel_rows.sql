-- Rangs des parcelles pour le plan 3D (lot AA, docs/jumeau-3d.md) : Ekylibre
-- ne stocke ni orientation ni inter-rang. Par défaut, le grand axe de la
-- parcelle et l'inter-rang de la culture ; l'exploitant peut les corriger.

CREATE TABLE parcel_rows (
  land_parcel_id  uuid PRIMARY KEY REFERENCES land_parcels(id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  -- Depuis le nord, sens horaire ; un rang n'a pas de sens : 0 ≤ orientation < 180.
  bearing_deg     double precision NOT NULL CHECK (bearing_deg >= 0 AND bearing_deg < 180),
  spacing_m       double precision NOT NULL CHECK (spacing_m >= 0.1 AND spacing_m <= 10),
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE parcel_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcel_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON parcel_rows
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON parcel_rows TO fourmy_app;
