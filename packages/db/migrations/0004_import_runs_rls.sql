-- import_runs n'était pas cloisonné : on y applique la RLS par ferme.
-- Le migrateur écrit avec un rôle propriétaire (hors RLS) ; l'API lit ses
-- imports via fourmy_app dans le contexte de la ferme.
ALTER TABLE import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON import_runs
  USING (farm_id = current_farm_id())
  WITH CHECK (farm_id = current_farm_id());
