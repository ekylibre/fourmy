-- Itinéraires techniques (claudedocs/conception_itineraires_techniques.md §10) :
-- interventions d'une parcelle. Aucun index ne couvrait les cibles ; la fiche
-- parcelle fait déjà cette recherche et en profite aussi.
CREATE INDEX IF NOT EXISTS intervention_parameters_target_ix
  ON intervention_parameters (ref_id) WHERE role = 'target';
