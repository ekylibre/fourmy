-- Interventions d'entretien, lot K (docs/materiels-entretien-design.md §2.3) :
-- nature (préventif / curatif), problème constaté, atelier externe, et
-- opérations du plan réalisées par matériel. Le relevé de compteur de chaque
-- matériel est un `meter_readings` d'origine « intervention » (lot I).
-- Seules les interventions réalisées font avancer les échéances.

ALTER TABLE interventions ADD COLUMN maintenance jsonb;

CREATE TABLE intervention_operations (
  id               uuid PRIMARY KEY,
  farm_id          uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  intervention_id  uuid NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
  equipment_id     uuid NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  operation_id     uuid NOT NULL REFERENCES equipment_operations(id) ON DELETE CASCADE,
  -- 'done' : réalisée ; contrôle : 'ok' (RAS) ou 'anomaly'.
  result           text NOT NULL DEFAULT 'done' CHECK (result IN ('done', 'ok', 'anomaly')),
  note             text,
  UNIQUE (intervention_id, operation_id)
);
CREATE INDEX intervention_operations_operation ON intervention_operations (operation_id);

ALTER TABLE intervention_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE intervention_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON intervention_operations
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON intervention_operations TO fourmy_app;
