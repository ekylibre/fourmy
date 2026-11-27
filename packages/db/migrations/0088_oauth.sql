-- Lot AM5 (claudedocs/conception_api_mcp.md §7.1) : serveur d'autorisation
-- OAuth (plugins better-auth `jwt`, `mcp`/oauth-provider et `cimd`, 1.7.12).
--
-- SQL produit par `getMigrations` avec nos noms (essai AM0,
-- claudedocs/essai_api_mcp.md §1), relu. Comme les autres tables `auth_*`,
-- lues et écrites par better-auth avec le rôle de connexion, sans RLS. Les
-- jetons sont stockés hachés (option par défaut `storeTokens: "hashed"`).

-- Ferme choisie pendant une autorisation (étape postLogin, page /oauth/ferme) :
-- elle devient la référence du consentement, puis est effacée.
ALTER TABLE auth_sessions ADD COLUMN active_farm_id uuid REFERENCES farms (id) ON DELETE SET NULL;

-- Clés de signature des jetons d'accès (JWT EdDSA), clé privée chiffrée par le secret.
CREATE TABLE auth_jwks (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  public_key  text NOT NULL,
  private_key text NOT NULL,
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz,
  alg         text,
  crv         text
);

-- Applications : enregistrement dynamique, document CIMD ou déclaration (FOURMY_OAUTH_CLIENTS).
CREATE TABLE auth_oauth_clients (
  id                                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id                           text NOT NULL UNIQUE,
  client_secret                       text,
  client_discovery_id                 text,
  disabled                            boolean,
  skip_consent                        boolean,
  enable_end_session                  boolean,
  subject_type                        text,
  scopes                              jsonb,
  client_credentials_scopes           jsonb,
  user_id                             uuid REFERENCES users (id) ON DELETE CASCADE,
  created_at                          timestamptz,
  updated_at                          timestamptz,
  name                                text,
  uri                                 text,
  icon                                text,
  contacts                            jsonb,
  tos                                 text,
  policy                              text,
  software_id                         text,
  software_version                    text,
  software_statement                  text,
  redirect_uris                       jsonb NOT NULL,
  post_logout_redirect_uris           jsonb,
  backchannel_logout_uri              text,
  backchannel_logout_session_required boolean,
  token_endpoint_auth_method          text,
  application_type                    text,
  jwks                                text,
  jwks_uri                            text,
  grant_types                         jsonb,
  response_types                      jsonb,
  require_pkce                        boolean,
  dpop_bound_access_tokens            boolean,
  reference_id                        text,
  metadata                            jsonb
);
CREATE INDEX auth_oauth_clients_user_id_idx ON auth_oauth_clients (user_id);

-- Ressources protégées (RFC 8707) : /mcp et /api/v1.
CREATE TABLE auth_oauth_resources (
  id                                uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  identifier                        text NOT NULL UNIQUE,
  name                              text NOT NULL,
  access_token_ttl                  integer,
  refresh_token_ttl                 integer,
  signing_algorithm                 text,
  signing_key_id                    text,
  allowed_scopes                    jsonb,
  custom_claims                     jsonb,
  dpop_bound_access_tokens_required boolean,
  disabled                          boolean,
  created_at                        timestamptz,
  updated_at                        timestamptz,
  policy_version                    integer,
  metadata                          jsonb
);

CREATE TABLE auth_oauth_client_resources (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id   text NOT NULL REFERENCES auth_oauth_clients (client_id) ON DELETE CASCADE,
  resource_id text NOT NULL REFERENCES auth_oauth_resources (identifier) ON DELETE CASCADE,
  metadata    jsonb,
  created_at  timestamptz
);
CREATE INDEX auth_oauth_client_resources_client_id_idx ON auth_oauth_client_resources (client_id);
CREATE INDEX auth_oauth_client_resources_resource_id_idx ON auth_oauth_client_resources (resource_id);
CREATE UNIQUE INDEX auth_oauth_client_resources_client_id_resource_id_uidx ON auth_oauth_client_resources (client_id, resource_id);

CREATE TABLE auth_oauth_refresh_tokens (
  id                         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token                      text NOT NULL UNIQUE,
  client_id                  text NOT NULL REFERENCES auth_oauth_clients (client_id) ON DELETE CASCADE,
  session_id                 uuid REFERENCES auth_sessions (id) ON DELETE SET NULL,
  user_id                    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reference_id               text,
  authorization_code_id      text,
  resources                  jsonb,
  requested_user_info_claims jsonb,
  expires_at                 timestamptz NOT NULL,
  created_at                 timestamptz NOT NULL,
  revoked                    timestamptz,
  rotated_at                 timestamptz,
  rotation_replay_response   text,
  rotation_replay_expires_at timestamptz,
  auth_time                  timestamptz,
  confirmation               jsonb,
  scopes                     jsonb NOT NULL
);
CREATE INDEX auth_oauth_refresh_tokens_client_id_idx ON auth_oauth_refresh_tokens (client_id);
CREATE INDEX auth_oauth_refresh_tokens_session_id_idx ON auth_oauth_refresh_tokens (session_id);
CREATE INDEX auth_oauth_refresh_tokens_user_id_idx ON auth_oauth_refresh_tokens (user_id);
CREATE INDEX auth_oauth_refresh_tokens_authorization_code_id_idx ON auth_oauth_refresh_tokens (authorization_code_id);

CREATE TABLE auth_oauth_access_tokens (
  id                         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token                      text NOT NULL UNIQUE,
  client_id                  text NOT NULL REFERENCES auth_oauth_clients (client_id) ON DELETE CASCADE,
  session_id                 uuid REFERENCES auth_sessions (id) ON DELETE SET NULL,
  user_id                    uuid REFERENCES users (id) ON DELETE CASCADE,
  reference_id               text,
  authorization_code_id      text,
  resources                  jsonb,
  requested_user_info_claims jsonb,
  refresh_id                 uuid REFERENCES auth_oauth_refresh_tokens (id) ON DELETE CASCADE,
  expires_at                 timestamptz NOT NULL,
  created_at                 timestamptz NOT NULL,
  revoked                    timestamptz,
  confirmation               jsonb,
  scopes                     jsonb NOT NULL
);
CREATE INDEX auth_oauth_access_tokens_client_id_idx ON auth_oauth_access_tokens (client_id);
CREATE INDEX auth_oauth_access_tokens_session_id_idx ON auth_oauth_access_tokens (session_id);
CREATE INDEX auth_oauth_access_tokens_user_id_idx ON auth_oauth_access_tokens (user_id);
CREATE INDEX auth_oauth_access_tokens_authorization_code_id_idx ON auth_oauth_access_tokens (authorization_code_id);
CREATE INDEX auth_oauth_access_tokens_refresh_id_idx ON auth_oauth_access_tokens (refresh_id);

-- Consentements : un par application, utilisateur et ferme (reference_id = ferme).
CREATE TABLE auth_oauth_consents (
  id                         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id                  text NOT NULL REFERENCES auth_oauth_clients (client_id) ON DELETE CASCADE,
  user_id                    uuid REFERENCES users (id) ON DELETE CASCADE,
  reference_id               text,
  resources                  jsonb,
  requested_user_info_claims jsonb,
  scopes                     jsonb NOT NULL,
  created_at                 timestamptz NOT NULL,
  updated_at                 timestamptz NOT NULL
);
CREATE INDEX auth_oauth_consents_client_id_idx ON auth_oauth_consents (client_id);
CREATE INDEX auth_oauth_consents_user_id_idx ON auth_oauth_consents (user_id);

CREATE TABLE auth_oauth_client_assertions (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

