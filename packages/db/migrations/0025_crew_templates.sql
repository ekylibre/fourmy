-- Attelages types, lot Q (docs/parcours-attelages-design.md §2.2, FR-ATT-6) :
-- compositions habituelles de la ferme (matériels, intervenants) reprises en
-- un clic à la saisie. L'intervention copie la composition et ne garde
-- `template_id` qu'à titre d'information : modifier ou supprimer un attelage
-- type ne change pas le passé.

CREATE TABLE crew_templates (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, name)
);
ALTER TABLE crew_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON crew_templates
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON crew_templates TO fourmy_app;

-- Membres : un matériel ou un intervenant ; `rank` garde l'ordre saisi
-- (tracteur avant outil). Un matériel ou une personne supprimés sortent du modèle.
CREATE TABLE crew_template_members (
  template_id   uuid NOT NULL REFERENCES crew_templates(id) ON DELETE CASCADE,
  rank          int  NOT NULL CHECK (rank >= 0),
  equipment_id  uuid REFERENCES equipments(id) ON DELETE CASCADE,
  person_id     uuid REFERENCES people(id) ON DELETE CASCADE,
  CHECK ((equipment_id IS NULL) <> (person_id IS NULL)),
  PRIMARY KEY (template_id, rank)
);
CREATE UNIQUE INDEX crew_template_members_equipment_ux ON crew_template_members (template_id, equipment_id) WHERE equipment_id IS NOT NULL;
CREATE UNIQUE INDEX crew_template_members_person_ux ON crew_template_members (template_id, person_id) WHERE person_id IS NOT NULL;
CREATE INDEX crew_template_members_equipment_ix ON crew_template_members (equipment_id) WHERE equipment_id IS NOT NULL;
CREATE INDEX crew_template_members_person_ix ON crew_template_members (person_id) WHERE person_id IS NOT NULL;
ALTER TABLE crew_template_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_template_members FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON crew_template_members
  USING (EXISTS (SELECT 1 FROM crew_templates t WHERE t.id = template_id AND t.farm_id = current_farm_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON crew_template_members TO fourmy_app;

-- L'origine d'un attelage saisi (0022 l'avait laissée sans clé étrangère).
UPDATE intervention_crews c SET template_id = NULL
  WHERE template_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crew_templates t WHERE t.id = c.template_id);
ALTER TABLE intervention_crews
  ADD CONSTRAINT intervention_crews_template_fk FOREIGN KEY (template_id) REFERENCES crew_templates(id) ON DELETE SET NULL;
CREATE INDEX intervention_crews_template_ix ON intervention_crews (template_id) WHERE template_id IS NOT NULL;
