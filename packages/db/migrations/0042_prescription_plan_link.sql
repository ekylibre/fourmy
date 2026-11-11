-- Fertilisation azotée, lot AN (docs/fertilisation-design.md §5.9) : carte de
-- modulation partie d'un apport du plan de fumure (FR-FERT-18). La moyenne
-- pondérée des doses de la carte est ramenée à la dose de l'apport.
ALTER TABLE prescriptions ADD COLUMN fertilization_plan_id uuid REFERENCES fertilization_plans(id) ON DELETE SET NULL;
-- Apport du plan : stade tel qu'il était au moment de la carte, et dose de produit visée.
ALTER TABLE prescriptions ADD COLUMN plan_stage text CHECK (length(plan_stage) <= 120);
ALTER TABLE prescriptions ADD COLUMN target_rate double precision CHECK (target_rate > 0);
CREATE INDEX prescriptions_plan ON prescriptions (fertilization_plan_id) WHERE fertilization_plan_id IS NOT NULL;
