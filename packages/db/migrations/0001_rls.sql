-- Row Level Security par ferme (ADR-4).
-- L'API pose `SET LOCAL fourmy.farm_id = '<uuid>'` par requête ; chaque
-- politique filtre sur ce réglage. Le rôle fourmy_app n'est jamais BYPASSRLS.

-- Droits de base sur le schéma public.
GRANT USAGE ON SCHEMA public TO fourmy_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fourmy_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fourmy_app;

-- Helper : farm_id courant (NULL si non posé → aucune ligne visible).
CREATE OR REPLACE FUNCTION current_farm_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('fourmy.farm_id', true), '')::uuid
$$;

-- Tables directement porteuses de farm_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'farms','memberships','campaigns','land_parcels','productions',
    'places','containers','equipments','tracker_bindings',
    'articles','lots','interventions','stock_movements',
    'audit_log','outbox_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    IF t = 'farms' THEN
      EXECUTE format(
        'CREATE POLICY farm_isolation ON %I USING (id = current_farm_id());', t);
    ELSE
      EXECUTE format(
        'CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) '
        || 'WITH CHECK (farm_id = current_farm_id());', t);
    END IF;
  END LOOP;
END$$;

-- Tables « version » et filles : isolées via leur parent porteur de farm_id.
CREATE POLICY farm_isolation ON land_parcel_versions
  USING (EXISTS (SELECT 1 FROM land_parcels p
                 WHERE p.id = land_parcel_id AND p.farm_id = current_farm_id()));
CREATE POLICY farm_isolation ON place_versions
  USING (EXISTS (SELECT 1 FROM places p
                 WHERE p.id = place_id AND p.farm_id = current_farm_id()));
CREATE POLICY farm_isolation ON container_versions
  USING (EXISTS (SELECT 1 FROM containers c
                 WHERE c.id = container_id AND c.farm_id = current_farm_id()));
CREATE POLICY farm_isolation ON intervention_parameters
  USING (EXISTS (SELECT 1 FROM interventions i
                 WHERE i.id = intervention_id AND i.farm_id = current_farm_id()));
CREATE POLICY farm_isolation ON lot_lineage
  USING (EXISTS (SELECT 1 FROM lots l
                 WHERE l.id = child_lot_id AND l.farm_id = current_farm_id()));

-- positions : RLS déjà activée en 0000 (avant compression) ; policy seule ici.
CREATE POLICY farm_isolation ON positions
  USING (farm_id = current_farm_id())
  WITH CHECK (farm_id = current_farm_id());

ALTER TABLE land_parcel_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE land_parcel_versions    FORCE  ROW LEVEL SECURITY;
ALTER TABLE place_versions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_versions          FORCE  ROW LEVEL SECURITY;
ALTER TABLE container_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE container_versions      FORCE  ROW LEVEL SECURITY;
ALTER TABLE intervention_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE intervention_parameters FORCE  ROW LEVEL SECURITY;
ALTER TABLE lot_lineage             ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_lineage             FORCE  ROW LEVEL SECURITY;
