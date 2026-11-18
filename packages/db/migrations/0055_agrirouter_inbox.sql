-- agrirouter, lot AR2 (claudedocs/conception_agrirouter.md §3, §5) : boîte de
-- réception et résolution des événements du flux /events, qui arrivent pour
-- toute l'application, toutes fermes confondues.

-- Fichiers reçus d'agrirouter : un par message (MESSAGE_RECEIVED) ou par
-- fichier découpé (FILE_RECEIVED, plusieurs messages). Le contenu est sur le
-- volume des fichiers agrirouter, rangé par empreinte. La lecture (ISO-XML,
-- EFDI) et la proposition d'intervention viennent aux lots AR4 et AR5.
CREATE TABLE agrirouter_inbox (
  id                  uuid PRIMARY KEY,
  farm_id             uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  -- Point de terminaison agrirouter destinataire (celui de la ferme).
  endpoint_id         text NOT NULL,
  -- Messages agrirouter à confirmer ensemble ; le premier sert de clé contre les redélivraisons.
  message_ids         text[] NOT NULL CHECK (cardinality(message_ids) > 0),
  message_type        text NOT NULL,
  filename            text,
  size                bigint NOT NULL,
  sender_endpoint_id  text,
  sender_name         text,
  teamset_context_id  text,
  sent_at             timestamptz,
  received_at         timestamptz NOT NULL DEFAULT now(),
  file_sha256         text NOT NULL,
  state               text NOT NULL DEFAULT 'received'
                      CHECK (state IN ('received', 'proposed', 'validated', 'dismissed', 'unreadable', 'ignored')),
  parsed              jsonb,
  error               text,
  -- Confirmation à agrirouter : retentée tant qu'elle n'a pas réussi.
  confirmed_at        timestamptz,
  confirm_attempts    integer NOT NULL DEFAULT 0,
  confirm_error       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agrirouter_inbox_message ON agrirouter_inbox (farm_id, (message_ids[1]));
CREATE INDEX agrirouter_inbox_received ON agrirouter_inbox (farm_id, received_at DESC);
CREATE INDEX agrirouter_inbox_unconfirmed ON agrirouter_inbox (farm_id) WHERE confirmed_at IS NULL;
ALTER TABLE agrirouter_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE agrirouter_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON agrirouter_inbox
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON agrirouter_inbox TO fourmy_app;

-- Résolution sans RLS, identifiants seulement (comme fourmy_due_integrations) :
-- l'écouteur retrouve la ferme, puis travaille dans withFarm.

-- Ferme d'un point de terminaison agrirouter (destinataire d'un message).
CREATE FUNCTION fourmy_agrirouter_farm_by_endpoint(p_endpoint text)
RETURNS TABLE (farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.farm_id FROM integrations i
  WHERE i.provider = 'agrirouter' AND i.settings->>'endpointId' = p_endpoint
$$;
REVOKE ALL ON FUNCTION fourmy_agrirouter_farm_by_endpoint(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_agrirouter_farm_by_endpoint(text) TO fourmy_app;

-- Ferme d'un identifiant externe (ENDPOINT_DELETED).
CREATE FUNCTION fourmy_agrirouter_farm_by_external(p_external text)
RETURNS TABLE (farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.farm_id FROM integrations i
  WHERE i.provider = 'agrirouter' AND i.settings->>'externalId' = p_external
$$;
REVOKE ALL ON FUNCTION fourmy_agrirouter_farm_by_external(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_agrirouter_farm_by_external(text) TO fourmy_app;

-- Fermes reliées à un compte agrirouter (AUTHORIZATION_REVOKED,
-- ENDPOINTS_LIST_CHANGED) : par l'empreinte HMAC du tenant, le tenant
-- lui-même restant chiffré.
CREATE FUNCTION fourmy_agrirouter_farms_by_tenant(p_hash text)
RETURNS TABLE (farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.farm_id FROM integrations i
  WHERE i.provider = 'agrirouter' AND i.settings->>'tenantHash' = p_hash
$$;
REVOKE ALL ON FUNCTION fourmy_agrirouter_farms_by_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_agrirouter_farms_by_tenant(text) TO fourmy_app;

-- Ferme d'un consentement en cours (AUTHORIZATION_ADDED, par l'empreinte de l'état).
CREATE FUNCTION fourmy_agrirouter_farm_by_state(p_hash text)
RETURNS TABLE (farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.farm_id FROM integrations i
  WHERE i.provider = 'agrirouter' AND i.settings->>'pendingState' = p_hash
$$;
REVOKE ALL ON FUNCTION fourmy_agrirouter_farm_by_state(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_agrirouter_farm_by_state(text) TO fourmy_app;

-- Fermes dont des fichiers reçus attendent leur confirmation (worker).
CREATE FUNCTION fourmy_agrirouter_unconfirmed_farms()
RETURNS TABLE (farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT b.farm_id FROM agrirouter_inbox b WHERE b.confirmed_at IS NULL
$$;
REVOKE ALL ON FUNCTION fourmy_agrirouter_unconfirmed_farms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_agrirouter_unconfirmed_farms() TO fourmy_app;
