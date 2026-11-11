-- Fertilisation azotée, lot AJ (docs/fertilisation-design.md §5.5) :
-- repousses comme couverture des sols, mesures de pilotage.

-- Couverture des sols : couvert semé, ou repousses de céréales ou de colza
-- (guide du PAR 7 Nouvelle-Aquitaine, tableau 11). Les repousses n'ont pas
-- de famille de la table MrCi.
ALTER TABLE cover_crops ADD COLUMN kind text NOT NULL DEFAULT 'sown' CHECK (kind IN ('sown', 'regrowth_cereal', 'regrowth_rapeseed'));
ALTER TABLE cover_crops ALTER COLUMN family DROP NOT NULL;
ALTER TABLE cover_crops ADD CONSTRAINT cover_crops_family_kind CHECK ((kind = 'sown') = (family IS NOT NULL));

-- Pilotage en cours de saison (FR-FERT-17) : mesure, outil, dose conseillée
-- pour l'apport de pilotage. Une mesure justifie un dépassement du plan.
CREATE TABLE steering_measurements (
  id              uuid PRIMARY KEY,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  plan_id         uuid NOT NULL REFERENCES fertilization_plans(id) ON DELETE CASCADE,
  measured_on     date NOT NULL,
  stage           text CHECK (length(stage) <= 80),
  tool            text NOT NULL CHECK (length(tool) BETWEEN 1 AND 120),
  value           text CHECK (length(value) <= 120),
  -- Dose conseillée pour l'apport de pilotage (kg N efficace/ha).
  advised_kg_n_ha numeric NOT NULL CHECK (advised_kg_n_ha >= 0 AND advised_kg_n_ha <= 300),
  notes           text CHECK (length(notes) <= 1000),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX steering_measurements_plan ON steering_measurements (plan_id, measured_on);
ALTER TABLE steering_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE steering_measurements FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON steering_measurements USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON steering_measurements TO fourmy_app;

-- Justificatif d'une mesure de pilotage (bulletin, capture de l'outil).
ALTER TABLE regulatory_documents DROP CONSTRAINT regulatory_documents_owner_type_check;
ALTER TABLE regulatory_documents ADD CONSTRAINT regulatory_documents_owner_type_check
  CHECK (owner_type IN ('plan', 'soil_analysis', 'water_source', 'product_analysis', 'cover_crop', 'steering'));
