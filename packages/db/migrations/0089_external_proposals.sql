-- Lot AM8 (claudedocs/conception_api_mcp.md §8) : propositions des accès
-- externes. Un accès en écriture ne fait que proposer (B6, B10) ; seul le
-- responsable de la ferme accepte (B9), et seule l'acceptation écrit
-- l'intervention, le registre et les stocks (API-23a).

CREATE TABLE external_proposals (
  id            uuid PRIMARY KEY,
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  -- NULL : invité restreint en session, ou accès révoqué depuis.
  access_id     uuid REFERENCES farm_accesses(id) ON DELETE SET NULL,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Nom de l'accès au dépôt (« Assistant Claude »), gardé si l'accès disparaît.
  access_name   text,
  channel       text NOT NULL CHECK (channel IN ('api', 'mcp', 'web')),
  kind          text NOT NULL CHECK (kind IN ('intervention')),
  -- Même contrat que POST /interventions (interventionPlanWrite).
  payload       jsonb NOT NULL,
  message       text CHECK (length(message) <= 2000),
  -- Contrôles à blanc au dépôt : phyto (feux, ZNT), nitrates, HVE et AB.
  checks        jsonb,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  decided_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decision_note text CHECK (length(decision_note) <= 2000),
  -- Intervention créée à l'acceptation ; « corrigée » si le contenu a changé.
  result_id     uuid REFERENCES interventions(id) ON DELETE SET NULL,
  corrected     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
CREATE INDEX external_proposals_farm ON external_proposals (farm_id, created_at DESC);
CREATE INDEX external_proposals_pending ON external_proposals (farm_id) WHERE status = 'pending';
CREATE UNIQUE INDEX external_proposals_result ON external_proposals (result_id) WHERE result_id IS NOT NULL;
ALTER TABLE external_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON external_proposals
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON external_proposals TO fourmy_app;

-- Origine d'une intervention tirée d'une proposition : `api` ou `mcp` (API-23).
ALTER TABLE interventions DROP CONSTRAINT interventions_origin_check;
ALTER TABLE interventions ADD CONSTRAINT interventions_origin_check
  CHECK (origin IN ('web', 'mobile', 'migration', 'plugin', 'import', 'api', 'mcp'));

-- Journal (API-27) : objets écrits par l'appel (propositions déposées).
ALTER TABLE access_log ADD COLUMN written jsonb;
