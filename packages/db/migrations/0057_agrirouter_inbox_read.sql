-- agrirouter, lot AR4 (claudedocs/conception_agrirouter.md §9) : lecture des
-- TaskData reçus. Le worker trouve les fermes qui ont des fichiers à lire,
-- puis travaille ferme par ferme (RLS).
CREATE FUNCTION fourmy_agrirouter_unread_farms(p_types text[])
RETURNS TABLE (farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT b.farm_id FROM agrirouter_inbox b
  WHERE b.state = 'received' AND b.message_type = ANY(p_types)
$$;
REVOKE ALL ON FUNCTION fourmy_agrirouter_unread_farms(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_agrirouter_unread_farms(text[]) TO fourmy_app;

CREATE INDEX agrirouter_inbox_unread ON agrirouter_inbox (farm_id, received_at) WHERE state = 'received';
