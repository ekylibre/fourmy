-- Lot P (docs/parcours-attelages-design.md §5) : supprimer une intervention
-- libère ses parcours GPS. La clé étrangère `ON DELETE SET NULL` ne remet que
-- `intervention_id` à NULL, ce que refuse le CHECK
-- `(intervention_id IS NULL) = (linked_extent IS NULL)` : on libère le
-- parcours entier avant la suppression (et donc aussi quand une ferme est
-- supprimée en cascade).

CREATE FUNCTION fourmy_release_track_sessions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE track_sessions
     SET intervention_id = NULL, crew_id = NULL, linked_extent = NULL, drift = NULL
   WHERE intervention_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER interventions_release_track_sessions
  BEFORE DELETE ON interventions
  FOR EACH ROW EXECUTE FUNCTION fourmy_release_track_sessions();
