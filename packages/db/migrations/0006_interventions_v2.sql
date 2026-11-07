-- Interventions simplifiées (docs/interventions.md) : personnes, périodes de
-- travail, motifs de traitement, notes, statut « annulée », attributs de
-- paramètres (surface traitée, zone, lieu de prélèvement / destination).

-- Personnes de la ferme (intervenants), avec ou sans compte Fourmy.
CREATE TABLE people (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name        text NOT NULL,
  role        text,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX people_farm_ix ON people (farm_id, name);
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE people FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON people
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());

-- Périodes de travail (plusieurs demi-journées, fréquent en viticulture).
CREATE TABLE intervention_periods (
  id               uuid PRIMARY KEY,
  intervention_id  uuid NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
  started_at       timestamptz NOT NULL,
  stopped_at       timestamptz NOT NULL,
  CHECK (stopped_at > started_at)
);
CREATE INDEX intervention_periods_ix ON intervention_periods (intervention_id, started_at);
ALTER TABLE intervention_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE intervention_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON intervention_periods
  USING (EXISTS (SELECT 1 FROM interventions i WHERE i.id = intervention_id AND i.farm_id = current_farm_id()));

-- Une période par intervention existante qui a un début et une fin.
INSERT INTO intervention_periods (id, intervention_id, started_at, stopped_at)
SELECT gen_random_uuid(), id, started_at, stopped_at FROM interventions
WHERE started_at IS NOT NULL AND stopped_at IS NOT NULL AND stopped_at > started_at;

-- Motifs de traitement (liste fermée côté contrats), notes, statut annulé.
ALTER TABLE interventions ADD COLUMN purposes text[] NOT NULL DEFAULT '{}';
ALTER TABLE interventions ADD COLUMN notes text;
ALTER TABLE interventions DROP CONSTRAINT interventions_status_check;
ALTER TABLE interventions ADD CONSTRAINT interventions_status_check CHECK (status IN ('planned', 'done', 'cancelled'));

-- Attributs de paramètres : surface traitée, lieu de prélèvement, destination, lot.
ALTER TABLE intervention_parameters ADD COLUMN attrs jsonb;

GRANT SELECT, INSERT, UPDATE, DELETE ON people, intervention_periods TO fourmy_app;
