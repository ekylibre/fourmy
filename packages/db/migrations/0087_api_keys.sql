-- Lot AM4 (claudedocs/conception_api_mcp.md §4 et §6.2) : clés d'API, accès
-- externes d'une ferme, journal des appels.

-- Clés du plugin better-auth `api-key` (1.7.12) : SQL produit par
-- `getMigrations` avec nos noms (essai AM0, claudedocs/essai_api_mcp.md §1),
-- relu. Seul le haché de la clé est stocké (`key`), avec ses premiers
-- caractères pour l'affichage (`start`). Comme les autres tables `auth_*`,
-- lue par better-auth avec le rôle de connexion, sans RLS.
CREATE TABLE auth_api_keys (
  id                     uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id              text NOT NULL,
  name                   text,
  start                  text,
  reference_id           text NOT NULL,
  prefix                 text,
  key                    text NOT NULL,
  refill_interval        integer,
  refill_amount          integer,
  last_refill_at         timestamptz,
  enabled                boolean,
  rate_limit_enabled     boolean,
  rate_limit_time_window integer,
  rate_limit_max         integer,
  request_count          integer,
  remaining              integer,
  last_request           timestamptz,
  expires_at             timestamptz,
  created_at             timestamptz NOT NULL,
  updated_at             timestamptz NOT NULL,
  permissions            text,
  metadata               text
);
CREATE INDEX auth_api_keys_config_id_idx ON auth_api_keys (config_id);
CREATE INDEX auth_api_keys_reference_id_idx ON auth_api_keys (reference_id);
CREATE INDEX auth_api_keys_key_idx ON auth_api_keys (key);

-- Un accès externe à une ferme : clé d'API (lot AM4) ou consentement OAuth
-- (lot AM5). Ses droits ne dépassent jamais ceux de son auteur, recalculés à
-- chaque requête (API-4).
CREATE TABLE farm_accesses (
  id              uuid PRIMARY KEY,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('api_key', 'oauth')),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id      uuid REFERENCES auth_api_keys(id) ON DELETE SET NULL,
  -- Début de la clé, pour l'afficher (`fmy_ab`) : la table des clés n'est pas lisible du rôle applicatif.
  key_start       text,
  oauth_client_id text,
  access_grant    jsonb NOT NULL,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX farm_accesses_api_key ON farm_accesses (api_key_id) WHERE api_key_id IS NOT NULL;
CREATE UNIQUE INDEX farm_accesses_oauth ON farm_accesses (farm_id, oauth_client_id, user_id) WHERE kind = 'oauth' AND revoked_at IS NULL;
CREATE INDEX farm_accesses_farm ON farm_accesses (farm_id, created_at DESC);
ALTER TABLE farm_accesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm_accesses FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON farm_accesses
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON farm_accesses TO fourmy_app;

-- Journal des appels externes (API-27), purgé à 90 jours par le worker (Q6).
CREATE TABLE access_log (
  id          bigserial PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  access_id   uuid REFERENCES farm_accesses(id) ON DELETE CASCADE, -- NULL : invité restreint en session
  user_id     uuid NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  channel     text NOT NULL CHECK (channel IN ('rest', 'mcp')),
  operation   text NOT NULL CHECK (length(operation) <= 200),
  status      int NOT NULL,
  duration_ms int
);
CREATE INDEX access_log_farm_at ON access_log (farm_id, at DESC);
CREATE INDEX access_log_access_at ON access_log (access_id, at DESC) WHERE access_id IS NOT NULL;
ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_log FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON access_log
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, DELETE ON access_log TO fourmy_app;
GRANT USAGE ON SEQUENCE access_log_id_seq TO fourmy_app;
