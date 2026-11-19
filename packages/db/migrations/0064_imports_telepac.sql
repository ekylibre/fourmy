-- Imports, lot IM3 (claudedocs/conception_import_onboarding.md §5.5, §6.2) :
-- îlots PAC rattachés aux parcelles, éléments du paysage déclarés à la PAC
-- (surfaces non agricoles et zones de densification des haies).

-- Îlots PAC : une référence « cap_islet » par parcelle qu'un îlot recouvre.
ALTER TABLE parcel_references DROP CONSTRAINT parcel_references_kind_check;
ALTER TABLE parcel_references ADD CONSTRAINT parcel_references_kind_check
  CHECK (kind IN ('cadastre', 'cap', 'cap_islet'));

-- Éléments du paysage déclarés par la ferme (haies, arbres, mares, ZDH…),
-- distincts de la couche BD TOPO de l'IGN (cache partagé).
CREATE TABLE farm_landscape_features (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  source      text NOT NULL CHECK (source IN ('telepac', 'manual')),
  campaign    int CHECK (campaign BETWEEN 2000 AND 2100),
  ref         text,
  kind        text NOT NULL CHECK (kind IN ('hedge', 'tree_row', 'tree', 'grove', 'woodland', 'pond', 'ditch', 'stone_wall', 'hedge_densification', 'other')),
  -- Code TelePAC d'origine (V1, V4, B3…, « ZDH »).
  cap_type    text,
  width_m     double precision CHECK (width_m IS NULL OR width_m >= 0),
  area_m2     double precision CHECK (area_m2 IS NULL OR area_m2 >= 0),
  geom        geometry(Geometry, 4326) NOT NULL,
  attrs       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, source, campaign, ref)
);
CREATE INDEX farm_landscape_features_geom ON farm_landscape_features USING gist (geom);
ALTER TABLE farm_landscape_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm_landscape_features FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON farm_landscape_features USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON farm_landscape_features TO fourmy_app;
