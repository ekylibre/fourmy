-- agrirouter, lot AR5 (claudedocs/conception_agrirouter.md §9.2, §9.3) :
-- journaux EFDI des machines versés dans les parcours GPS, comme ceux de
-- Traccar (source « agrirouter » d'un rattachement de boîtier) ; état
-- « versé aux parcours » d'un fichier reçu.
ALTER TABLE tracker_bindings DROP CONSTRAINT tracker_bindings_source_check;
ALTER TABLE tracker_bindings ADD CONSTRAINT tracker_bindings_source_check CHECK (source IN ('traccar', 'agrirouter'));

ALTER TABLE agrirouter_inbox DROP CONSTRAINT agrirouter_inbox_state_check;
ALTER TABLE agrirouter_inbox ADD CONSTRAINT agrirouter_inbox_state_check
  CHECK (state IN ('received', 'proposed', 'validated', 'dismissed', 'unreadable', 'ignored', 'merged'));

-- Description de machine d'un journal : même contexte d'attelage (teamset).
CREATE INDEX agrirouter_inbox_teamset ON agrirouter_inbox (farm_id, teamset_context_id, received_at DESC)
  WHERE teamset_context_id IS NOT NULL;
