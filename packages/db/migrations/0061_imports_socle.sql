-- Imports DAPLOS, Geofolia, TelePAC, lot IM1 (claudedocs/conception_import_onboarding.md
-- §5.8, §6.1) : fichiers déposés, suivi des imports toutes sources,
-- provenance des entités importées, référentiel AgroEDI (Lexicon).

-- Fichiers déposés : en base (même choix que les photos), purgés à expiration
-- par le worker. Le contenu n'est jamais renvoyé par l'API.
CREATE TABLE import_files (
  id           uuid PRIMARY KEY,
  farm_id      uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  format       text NOT NULL CHECK (format IN ('daplos', 'geofolia', 'telepac')),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  size         integer NOT NULL CHECK (size > 0 AND size <= 52428800),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes        bytea NOT NULL,
  uploaded_by  uuid NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '30 days',
  UNIQUE (farm_id, sha256)
);
CREATE INDEX import_files_expires ON import_files (expires_at);

-- Suivi : la reprise Ekylibre (running → completed | failed) et les imports
-- de fichiers (analyzed → running → completed | failed ; discarded ;
-- reverting → reverted).
ALTER TABLE import_runs DROP CONSTRAINT import_runs_status_check;
ALTER TABLE import_runs ADD CONSTRAINT import_runs_status_check
  CHECK (status IN ('analyzed', 'running', 'completed', 'failed', 'discarded', 'reverting', 'reverted'));
ALTER TABLE import_runs
  ADD COLUMN file_id    uuid REFERENCES import_files(id) ON DELETE SET NULL,
  ADD COLUMN format     text CHECK (format IN ('daplos', 'geofolia', 'telepac')),
  ADD COLUMN preview    jsonb,
  ADD COLUMN decisions  jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN created_by uuid;
CREATE INDEX import_runs_farm_started ON import_runs (farm_id, started_at DESC);

-- Provenance : clé source → entité Fourmy. Ce qu'un import crée ou relie y
-- laisse une ligne ; un réimport retrouve l'entité au lieu de la recréer, une
-- annulation retire ce que le run a créé (created).
CREATE TABLE import_links (
  farm_id    uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  namespace  text NOT NULL CHECK (namespace ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  key        text NOT NULL CHECK (length(key) BETWEEN 1 AND 255),
  entity     text NOT NULL,
  entity_id  uuid NOT NULL,
  run_id     uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  created    boolean NOT NULL,
  linked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, namespace, key, entity)
);
CREATE INDEX import_links_entity ON import_links (entity, entity_id);
CREATE INDEX import_links_run ON import_links (run_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['import_files', 'import_links'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;

-- Référentiel : code AgroEDI et saison des productions Lexicon (paquet
-- public « productions »), pour résoudre les cultures DAPLOS et Geofolia.
ALTER TABLE lexicon_productions ADD COLUMN agroedi_crop_code text, ADD COLUMN season text;
CREATE INDEX lexicon_productions_agroedi ON lexicon_productions (agroedi_crop_code);

-- Dictionnaire AgroEDI (paquet Lexicon « agroedi », réservé aux adhérents,
-- chargé avec une clé) : libellés par table, et cultures simples ou
-- combinées → production de référence. Un même code peut figurer deux fois
-- dans une table (libellés voisins) : la clé est l'identifiant AgroEDI.
CREATE TABLE lexicon_agroedi_codes (
  table_id        integer NOT NULL,
  reference_id    integer NOT NULL,
  code            text NOT NULL,
  label           text NOT NULL,
  ekylibre_scope  text,
  ekylibre_value  text,
  PRIMARY KEY (table_id, reference_id)
);
CREATE INDEX lexicon_agroedi_codes_code ON lexicon_agroedi_codes (table_id, code);
CREATE TABLE lexicon_agroedi_crops (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  production  text
);
GRANT SELECT ON lexicon_agroedi_codes, lexicon_agroedi_crops TO fourmy_app;
