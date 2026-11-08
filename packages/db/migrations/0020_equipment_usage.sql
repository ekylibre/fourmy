-- Lot L (docs/materiels-entretien-design.md §2.4, §9) : heures de
-- fonctionnement estimées par jour (Traccar sans compteur), alertes
-- d'entretien envoyées (une seule fois par échéance et par état).
-- Couper l'intégration ne supprime rien : les jours déjà calculés restent.

CREATE TABLE equipment_usage_days (
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  equipment_id  uuid NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  day           date NOT NULL,
  hours         numeric NOT NULL CHECK (hours BETWEEN 0 AND 24),
  source        text NOT NULL DEFAULT 'traccar' CHECK (source IN ('traccar')),
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (equipment_id, source, day)
);

CREATE TABLE maintenance_alerts (
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  operation_id  uuid NOT NULL REFERENCES equipment_operations(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('soon', 'overdue')),
  -- Échéance visée (« h:4500 », « d:2027-03-01 ») : une nouvelle échéance réalerte.
  due_key       text NOT NULL,
  notified_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, status, due_key)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['equipment_usage_days', 'maintenance_alerts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;

-- Worker : fermes à parcourir (SECURITY DEFINER, comme fourmy_water_due).
-- Traccar actif → heures estimées ; membres à prévenir → alertes d'entretien.
CREATE FUNCTION fourmy_traccar_farms()
RETURNS TABLE (farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.farm_id FROM integrations i WHERE i.provider = 'traccar' AND i.enabled
$$;
REVOKE ALL ON FUNCTION fourmy_traccar_farms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_traccar_farms() TO fourmy_app;

CREATE FUNCTION fourmy_alert_farms()
RETURNS TABLE (farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.farm_id FROM farm_settings s WHERE jsonb_array_length(coalesce(s.maintenance->'notify', '[]')) > 0
$$;
REVOKE ALL ON FUNCTION fourmy_alert_farms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_alert_farms() TO fourmy_app;
