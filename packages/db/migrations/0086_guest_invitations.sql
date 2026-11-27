-- Lot AM3 (claudedocs/conception_api_mcp.md §3.2 et §9) : invitation d'un
-- membre restreint. L'acceptation recopie les droits de l'invitation dans
-- l'appartenance ; « Mes fermes » les renvoie au web (navigation filtrée).

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
  INSERT INTO memberships (id, farm_id, user_id, role, access_grant)
  VALUES (gen_random_uuid(), inv.farm_id, p_user, inv.role, inv.access_grant)
  ON CONFLICT (farm_id, user_id) DO NOTHING;
  UPDATE people SET user_id = p_user, updated_at = now() WHERE id = inv.person_id;
  UPDATE person_invitations SET accepted_at = now() WHERE id = inv.id;
  RETURN inv.farm_id;
END $$;
REVOKE ALL ON FUNCTION fourmy_accept_invitation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_accept_invitation(text, uuid) TO fourmy_app;

DROP FUNCTION fourmy_user_farms(uuid);
CREATE FUNCTION fourmy_user_farms(p_user uuid)
RETURNS TABLE (farm_id uuid, name text, role text, onboarding jsonb, access_grant jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.name, m.role, s.onboarding, m.access_grant
  FROM memberships m JOIN farms f ON f.id = m.farm_id
  LEFT JOIN farm_settings s ON s.farm_id = f.id
  WHERE m.user_id = p_user
  ORDER BY f.name
$$;
REVOKE ALL ON FUNCTION fourmy_user_farms(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_user_farms(uuid) TO fourmy_app;
