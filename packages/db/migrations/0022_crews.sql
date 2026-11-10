-- Attelages dans l'intervention, lot N (docs/parcours-attelages-design.md §2.1) :
-- une intervention se déclare soit en mode libre (matériels, intervenants et
-- périodes indépendants, comme avant), soit en attelages (1..n matériels,
-- 0..n intervenants, ≥ 1 période propre à chaque attelage). Les lignes
-- existantes (`intervention_parameters` tool/doer, `intervention_periods`)
-- portent simplement l'attelage : ce qui lisait l'intervention à plat reste juste.

ALTER TABLE interventions
  ADD COLUMN staffing text NOT NULL DEFAULT 'free' CHECK (staffing IN ('free', 'crews'));

CREATE TABLE intervention_crews (
  id               uuid PRIMARY KEY,
  intervention_id  uuid NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
  rank             int  NOT NULL CHECK (rank >= 0),
  label            text,
  -- Attelage type d'origine (lot Q) : information seulement, la composition est copiée.
  template_id      uuid,
  UNIQUE (intervention_id, rank) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE intervention_crews ENABLE ROW LEVEL SECURITY;
ALTER TABLE intervention_crews FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON intervention_crews
  USING (EXISTS (SELECT 1 FROM interventions i WHERE i.id = intervention_id AND i.farm_id = current_farm_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON intervention_crews TO fourmy_app;

ALTER TABLE intervention_parameters ADD COLUMN crew_id uuid REFERENCES intervention_crews(id) ON DELETE CASCADE;
ALTER TABLE intervention_periods    ADD COLUMN crew_id uuid REFERENCES intervention_crews(id) ON DELETE CASCADE;
-- Manquait depuis 0000 : toute lecture d'une intervention (et la garde ci-dessous) en a besoin.
CREATE INDEX intervention_parameters_intervention_ix ON intervention_parameters (intervention_id, role);
CREATE INDEX intervention_parameters_crew_ix ON intervention_parameters (crew_id) WHERE crew_id IS NOT NULL;
CREATE INDEX intervention_periods_crew_ix    ON intervention_periods (crew_id)    WHERE crew_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Garde des invariants, vérifiée en fin de transaction (l'écriture d'une
-- intervention supprime puis réinsère ses lignes) :
--  - libre : aucune ligne rattachée à un attelage, aucun attelage ;
--  - attelages : chaque matériel, intervenant et période est dans un attelage
--    de la même intervention ; chaque attelage a ≥ 1 matériel et ≥ 1 période ;
--    ses périodes ne se chevauchent pas (deux attelages, eux, le peuvent) ;
--  - cibles, intrants et sorties ne sont jamais rattachés à un attelage.
-- Le domaine (crewRules) refuse ces cas avec un message lisible ; ce trigger
-- protège la base de tout autre écrivain (migrateur, plugin, synchro).
-- ---------------------------------------------------------------------------
CREATE FUNCTION fourmy_check_intervention_crews(p_intervention uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_staffing text;
  v_bad text;
BEGIN
  SELECT staffing INTO v_staffing FROM interventions WHERE id = p_intervention;
  IF NOT FOUND THEN RETURN; END IF;  -- intervention supprimée

  IF EXISTS (SELECT 1 FROM intervention_parameters
             WHERE intervention_id = p_intervention AND crew_id IS NOT NULL AND role NOT IN ('tool', 'doer')) THEN
    RAISE EXCEPTION 'Intervention %: seuls matériels et intervenants appartiennent à un attelage', p_intervention;
  END IF;

  IF v_staffing = 'free' THEN
    IF EXISTS (SELECT 1 FROM intervention_crews WHERE intervention_id = p_intervention)
       OR EXISTS (SELECT 1 FROM intervention_parameters WHERE intervention_id = p_intervention AND crew_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM intervention_periods WHERE intervention_id = p_intervention AND crew_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Intervention % en mode libre : aucun attelage attendu', p_intervention;
    END IF;
    RETURN;
  END IF;

  -- Mode attelages.
  IF NOT EXISTS (SELECT 1 FROM intervention_crews WHERE intervention_id = p_intervention) THEN
    RAISE EXCEPTION 'Intervention % en attelages : au moins un attelage', p_intervention;
  END IF;
  IF EXISTS (SELECT 1 FROM intervention_parameters ip
             LEFT JOIN intervention_crews c ON c.id = ip.crew_id
             WHERE ip.intervention_id = p_intervention AND ip.role IN ('tool', 'doer')
               AND (c.id IS NULL OR c.intervention_id <> p_intervention))
     OR EXISTS (SELECT 1 FROM intervention_periods w
                LEFT JOIN intervention_crews c ON c.id = w.crew_id
                WHERE w.intervention_id = p_intervention AND (c.id IS NULL OR c.intervention_id <> p_intervention)) THEN
    RAISE EXCEPTION 'Intervention % en attelages : matériels, intervenants et périodes appartiennent à un attelage de l''intervention', p_intervention;
  END IF;
  SELECT coalesce(c.label, 'attelage ' || (c.rank + 1)) INTO v_bad FROM intervention_crews c
  WHERE c.intervention_id = p_intervention
    AND (NOT EXISTS (SELECT 1 FROM intervention_parameters ip WHERE ip.crew_id = c.id AND ip.role = 'tool')
      OR NOT EXISTS (SELECT 1 FROM intervention_periods w WHERE w.crew_id = c.id))
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Intervention % : % sans matériel ou sans période', p_intervention, v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM intervention_periods a JOIN intervention_periods b
               ON a.crew_id = b.crew_id AND a.id < b.id
              AND tstzrange(a.started_at, a.stopped_at) && tstzrange(b.started_at, b.stopped_at)
             WHERE a.intervention_id = p_intervention) THEN
    RAISE EXCEPTION 'Intervention % : périodes qui se chevauchent dans un même attelage', p_intervention;
  END IF;
END $$;

CREATE FUNCTION fourmy_check_crews_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'interventions' THEN
    PERFORM fourmy_check_intervention_crews(coalesce(NEW.id, OLD.id));
  ELSE
    IF TG_OP <> 'INSERT' THEN PERFORM fourmy_check_intervention_crews(OLD.intervention_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM fourmy_check_intervention_crews(NEW.intervention_id); END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER intervention_staffing_check AFTER INSERT OR UPDATE OF staffing ON interventions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fourmy_check_crews_trigger();
CREATE CONSTRAINT TRIGGER intervention_crews_check AFTER INSERT OR UPDATE OR DELETE ON intervention_crews
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fourmy_check_crews_trigger();
CREATE CONSTRAINT TRIGGER intervention_parameters_crew_check AFTER INSERT OR UPDATE OF crew_id, role OR DELETE ON intervention_parameters
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fourmy_check_crews_trigger();
CREATE CONSTRAINT TRIGGER intervention_periods_crew_check AFTER INSERT OR UPDATE OR DELETE ON intervention_periods
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fourmy_check_crews_trigger();
