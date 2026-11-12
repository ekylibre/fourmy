-- Équipe et personnes, lot P3 (docs/equipe-personnes-design.md §2.2, §4.3) :
-- invitation d'une personne à avoir un compte. Le jeton n'est jamais stocké,
-- seulement son SHA-256 ; valable 7 jours, à usage unique, révocable.

CREATE TABLE person_invitations (
  id            uuid PRIMARY KEY,
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  person_id     uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  email         text NOT NULL CHECK (length(email) <= 254),
  role          text NOT NULL CHECK (role IN ('owner', 'worker', 'reader')),
  token_hash    text NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  sent_by_email boolean NOT NULL DEFAULT false
);
-- Une seule invitation ouverte par personne.
CREATE UNIQUE INDEX person_invitations_open_uq ON person_invitations (person_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE person_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON person_invitations
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON person_invitations TO fourmy_app;

-- Lecture d'une invitation par son jeton, avant toute session ni ferme.
CREATE OR REPLACE FUNCTION fourmy_invitation(p_token_hash text)
RETURNS TABLE (farm_id uuid, farm_name text, first_name text, person_name text, email text, role text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.farm_id, f.name, p.first_name, p.name, i.email, i.role,
         CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted'
              WHEN i.revoked_at IS NOT NULL THEN 'revoked'
              WHEN i.expires_at <= now() THEN 'expired'
              ELSE 'open' END
  FROM person_invitations i
  JOIN farms f ON f.id = i.farm_id
  JOIN people p ON p.id = i.person_id
  WHERE i.token_hash = p_token_hash
$$;
REVOKE ALL ON FUNCTION fourmy_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_invitation(text) TO fourmy_app;

-- Acceptation : accès à la ferme, personne reliée au compte, invitation close.
-- Renvoie la ferme, ou une erreur lisible (P0001) si l'invitation n'est plus ouverte.
CREATE OR REPLACE FUNCTION fourmy_accept_invitation(p_token_hash text, p_user uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv person_invitations%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM person_invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR inv.accepted_at IS NOT NULL OR inv.revoked_at IS NOT NULL OR inv.expires_at <= now() THEN
    RAISE EXCEPTION 'Invitation expirée, révoquée ou déjà utilisée.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM people WHERE farm_id = inv.farm_id AND user_id = p_user AND id <> inv.person_id) THEN
    RAISE EXCEPTION 'Ce compte a déjà une autre fiche sur cette ferme.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO memberships (id, farm_id, user_id, role) VALUES (gen_random_uuid(), inv.farm_id, p_user, inv.role)
  ON CONFLICT (farm_id, user_id) DO NOTHING;
  UPDATE people SET user_id = p_user, updated_at = now() WHERE id = inv.person_id;
  UPDATE person_invitations SET accepted_at = now() WHERE id = inv.id;
  RETURN inv.farm_id;
END $$;
REVOKE ALL ON FUNCTION fourmy_accept_invitation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_accept_invitation(text, uuid) TO fourmy_app;
