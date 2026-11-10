-- Parcours GPS, lot O (docs/parcours-attelages-design.md §2.3, §2.4) : les
-- sessions de travail et de déplacement de chaque boîtier, calculées par le
-- worker (segmentSessions) et stockées pour trois raisons : identité stable
-- d'un parcours rattaché à une intervention (FR-GPS-15), recalcul des seuls
-- parcours libres quand la ferme change ses réglages (FR-GPS-16), liste
-- rapide sur 90 jours.
--  - libre    : intervention_id IS NULL, supprimé et recréé à volonté ;
--  - rattaché : figé, le worker n'en modifie que `drift`.

CREATE TABLE track_sessions (
  id                 uuid PRIMARY KEY,           -- uuidv5(binding_id, started_at, kind)
  farm_id            uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  equipment_id       uuid NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,  -- matériel suivi
  binding_id         uuid NOT NULL REFERENCES tracker_bindings(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('work', 'transit')),
  started_at         timestamptz NOT NULL,
  stopped_at         timestamptz NOT NULL CHECK (stopped_at > started_at),
  position_count     int  NOT NULL,
  distance_m         numeric NOT NULL,
  covered_area_m2    numeric,                    -- travail seulement
  coverage           geometry(MultiPolygon, 4326),  -- bandes de largeur d'outil, simplifiées
  parcels            jsonb NOT NULL DEFAULT '[]',   -- [{ landParcelId, name, areaM2, share }] à la date
  tool_hint          text,                       -- attribut Traccar `tool` dominant
  tool_equipment_id  uuid REFERENCES equipments(id) ON DELETE SET NULL,  -- outil résolu
  intervention_id    uuid REFERENCES interventions(id) ON DELETE SET NULL,
  crew_id            uuid REFERENCES intervention_crews(id) ON DELETE SET NULL,
  linked_extent      tstzrange,                  -- étendue figée au rattachement
  drift              jsonb,                      -- { startedAt, stoppedAt } recalculés s'ils diffèrent
  settings_hash      text NOT NULL,              -- réglages utilisés (sha256 du JSON trié)
  computed_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((intervention_id IS NULL) = (linked_extent IS NULL)),
  EXCLUDE USING gist (binding_id WITH =, tstzrange(started_at, stopped_at) WITH &&)
);
CREATE INDEX track_sessions_list_ix ON track_sessions (equipment_id, started_at DESC);
CREATE INDEX track_sessions_tool_ix ON track_sessions (tool_equipment_id, started_at DESC) WHERE tool_equipment_id IS NOT NULL;
CREATE INDEX track_sessions_intervention_ix ON track_sessions (intervention_id) WHERE intervention_id IS NOT NULL;

ALTER TABLE track_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON track_sessions
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON track_sessions TO fourmy_app;

-- Réglages du découpage, par ferme (FR-GPS-16) ; mêmes valeurs que DEFAULT_TRACK_SETTINGS.
ALTER TABLE farm_settings ADD COLUMN tracks jsonb NOT NULL DEFAULT
  '{"stopMin": 15, "minDurationMin": 3, "minDistanceM": 200, "movingKmh": 2, "parcelMinShare": 0.05, "parcelMinAreaM2": 500}';
