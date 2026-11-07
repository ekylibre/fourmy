-- Comptes locaux (better-auth, ADR-14) : remplace l'identité de développement
-- (en-tête x-user-id). Les tables d'authentification sont globales (pas de
-- ferme) et réservées au service d'authentification : le rôle applicatif
-- fourmy_app (requêtes sous RLS) n'y a pas accès.

ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN image text;

CREATE TABLE auth_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_ix ON auth_sessions (user_id);

-- Un compte = un moyen de connexion (mot de passe local, plus tard OIDC).
CREATE TABLE auth_accounts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id                text NOT NULL,
  provider_id               text NOT NULL,
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  password                  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX auth_accounts_user_ix ON auth_accounts (user_id);

CREATE TABLE auth_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier  text NOT NULL,
  value       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verifications_identifier_ix ON auth_verifications (identifier);

-- Les privilèges par défaut (0001) donneraient accès à fourmy_app : on retire.
REVOKE ALL ON auth_sessions, auth_accounts, auth_verifications FROM fourmy_app;

-- Une personne de la ferme est rattachée à au plus un compte par ferme.
CREATE UNIQUE INDEX people_user_ix ON people (farm_id, user_id) WHERE user_id IS NOT NULL;
