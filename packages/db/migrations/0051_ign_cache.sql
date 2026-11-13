-- « Ma ferme », lot F4 (claudedocs/conception_ma_ferme.md §3.5, §3.6) : cache
-- des tuiles IGN sur le serveur et préchargement autour des sites.

-- Couches à précharger, marge de détail autour des parcelles (zoom 17-18),
-- relance automatique quand un site bouge (E12).
ALTER TABLE farm_settings
  ADD COLUMN ign jsonb NOT NULL DEFAULT '{"layers":["ortho","plan"],"detailMarginM":200,"autoRefresh":false}';

CREATE TABLE ign_cache_jobs (
  id             uuid PRIMARY KEY,
  farm_id        uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  status         text NOT NULL CHECK (status IN ('pending', 'running', 'done', 'partial', 'failed', 'cancelled')),
  layers         text[] NOT NULL,
  requested_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  tile_count     integer NOT NULL CHECK (tile_count >= 0),
  estimate_bytes bigint NOT NULL CHECK (estimate_bytes >= 0),
  -- { ortho: { done, total, failed, fetched }, … }
  progress       jsonb NOT NULL DEFAULT '{}',
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  locked_until   timestamptz
);
-- Une seule tâche active par ferme (la relance automatique s'appuie dessus).
CREATE UNIQUE INDEX ign_cache_jobs_one_active ON ign_cache_jobs (farm_id) WHERE status IN ('pending', 'running');
CREATE INDEX ign_cache_jobs_farm ON ign_cache_jobs (farm_id, created_at DESC);

ALTER TABLE ign_cache_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ign_cache_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON ign_cache_jobs USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON ign_cache_jobs TO fourmy_app;

-- Index des fichiers du cache disque, commun à toutes les fermes : les
-- données IGN sont publiques et deux fermes voisines partagent leurs tuiles.
-- Pas de farm_id, donc pas de RLS.
CREATE TABLE ign_tiles (
  layer        text NOT NULL CHECK (layer IN ('ortho', 'plan')),
  z            smallint NOT NULL CHECK (z BETWEEN 0 AND 19),
  x            integer NOT NULL,
  y            integer NOT NULL,
  bytes        integer NOT NULL,
  sha1         text NOT NULL,
  ign_etag     text,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  -- Quota LRU : mis à jour au plus une fois par jour et par tuile.
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (layer, z, x, y)
);
CREATE INDEX ign_tiles_lru ON ign_tiles (last_read_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON ign_tiles TO fourmy_app;

-- Worker : prend la plus ancienne tâche en attente (ou une tâche dont le
-- worker est mort, verrou expiré), toutes fermes confondues.
CREATE FUNCTION fourmy_ign_claim_job(lock_for interval)
RETURNS TABLE (id uuid, farm_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE ign_cache_jobs j
     SET status = 'running', started_at = coalesce(j.started_at, now()), locked_until = now() + lock_for
   WHERE j.id = (
     SELECT c.id FROM ign_cache_jobs c
      WHERE c.status = 'pending' OR (c.status = 'running' AND c.locked_until < now())
      ORDER BY c.created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED)
  RETURNING j.id, j.farm_id
$$;
REVOKE ALL ON FUNCTION fourmy_ign_claim_job(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_ign_claim_job(interval) TO fourmy_app;

-- Worker : fermes dont le plan protège des tuiles de la purge (préchargement
-- déjà lancé au moins une fois).
CREATE FUNCTION fourmy_ign_cached_farms()
RETURNS TABLE (farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT j.farm_id FROM ign_cache_jobs j WHERE j.status IN ('done', 'partial', 'running', 'pending')
$$;
REVOKE ALL ON FUNCTION fourmy_ign_cached_farms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_ign_cached_farms() TO fourmy_app;
