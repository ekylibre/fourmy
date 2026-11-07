-- « Mes fermes » : la RLS masque les appartenances hors du contexte d'une
-- ferme. Plutôt que de contourner la RLS dans l'application, une fonction
-- dédiée, SECURITY DEFINER, ne renvoie que les fermes de l'utilisateur donné.
CREATE OR REPLACE FUNCTION fourmy_user_farms(p_user uuid)
RETURNS TABLE (farm_id uuid, name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.name, m.role
  FROM memberships m JOIN farms f ON f.id = m.farm_id
  WHERE m.user_id = p_user
  ORDER BY f.name
$$;
REVOKE ALL ON FUNCTION fourmy_user_farms(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_user_farms(uuid) TO fourmy_app;
