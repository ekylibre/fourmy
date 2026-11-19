-- Assistant de premier démarrage, lot IM6 (claudedocs/conception_import_onboarding.md §6.2, §9) :
-- droit de créer une ferme (compte « à embarquer »), état de l'assistant par ferme.

-- Nombre de fermes que le compte peut encore créer lui-même (0 : aucune ;
-- `user:create --onboarding` en donne une). Décrémenté à la création.
ALTER TABLE users ADD COLUMN farm_creation_quota int NOT NULL DEFAULT 0 CHECK (farm_creation_quota >= 0);

-- État de l'assistant : { step, completedAt } ; NULL pour une ferme créée autrement.
ALTER TABLE farm_settings ADD COLUMN onboarding jsonb;

-- « Mes fermes » donne aussi l'état de l'assistant (reprise après connexion).
DROP FUNCTION fourmy_user_farms(uuid);
CREATE FUNCTION fourmy_user_farms(p_user uuid)
RETURNS TABLE (farm_id uuid, name text, role text, onboarding jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.name, m.role, s.onboarding
  FROM memberships m JOIN farms f ON f.id = m.farm_id
  LEFT JOIN farm_settings s ON s.farm_id = f.id
  WHERE m.user_id = p_user
  ORDER BY f.name
$$;
REVOKE ALL ON FUNCTION fourmy_user_farms(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_user_farms(uuid) TO fourmy_app;
