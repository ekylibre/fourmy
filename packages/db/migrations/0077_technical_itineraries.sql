-- Assolement, temps 2, lot IT1 (claudedocs/conception_assolement_itk.md §4.1) :
-- itinéraires techniques (ITK) de la ferme. Un ITK est un document (étapes,
-- dates relatives au semis ou à la récolte, intrants et doses, matériels,
-- débit), édité d'un bloc et protégé par une révision (concurrence optimiste),
-- comme le brouillon d'assolement.

CREATE TABLE technical_itineraries (
  id           uuid PRIMARY KEY,
  farm_id      uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  -- Activité proposée par défaut à l'affectation ; l'ITK survit à sa suppression.
  activity_id  uuid REFERENCES activities(id) ON DELETE SET NULL,
  -- Production de référence Lexicon (`winter_common_wheat`), comme les itinéraires Lexicon.
  production   text CHECK (length(production) <= 120),
  system       text NOT NULL DEFAULT 'conventional' CHECK (system IN ('conventional', 'organic')),
  cycle        text NOT NULL DEFAULT 'annual' CHECK (cycle IN ('annual', 'perennial')),
  -- manual : saisi ; history : proposé depuis les interventions passées (lot IT2) ; copy : dupliqué.
  origin       text NOT NULL CHECK (origin IN ('manual', 'history', 'copy')),
  source       jsonb,
  content      jsonb NOT NULL,
  notes        text CHECK (length(notes) <= 2000),
  revision     int NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  UNIQUE (farm_id, name)
);
CREATE INDEX technical_itineraries_activity ON technical_itineraries (farm_id, activity_id);

ALTER TABLE technical_itineraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_itineraries FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON technical_itineraries
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON technical_itineraries TO fourmy_app;
