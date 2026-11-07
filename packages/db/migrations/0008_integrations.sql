-- Intégrations par ferme (Traccar d'abord, d'autres ensuite) : paramètres en
-- clair, secret (jeton, mot de passe) chiffré par l'API (AES-256-GCM, clé hors
-- base : FOURMY_SECRETS_KEY). La base ne voit jamais un secret en clair.

CREATE TABLE integrations (
  id                 uuid PRIMARY KEY,
  farm_id            uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  provider           text NOT NULL CHECK (provider IN ('traccar')),
  settings           jsonb NOT NULL DEFAULT '{}',
  secret_ciphertext  text,
  -- Quatre derniers caractères du secret : le reconnaître sans le révéler.
  secret_hint        text,
  enabled            boolean NOT NULL DEFAULT true,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'error')),
  -- Verrou de synchro : posé à la prise en charge, levé à la fin.
  running_since      timestamptz,
  last_sync_at       timestamptz,
  last_error         text,
  last_report        jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Une intégration par fournisseur et par ferme.
  UNIQUE (farm_id, provider)
);
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON integrations
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON integrations TO fourmy_app;

-- Le worker parcourt toutes les fermes : il obtient seulement la liste des
-- intégrations à synchroniser (identifiants), puis travaille ferme par ferme
-- sous RLS. Aucun paramètre ni secret ne sort de cette fonction.
CREATE OR REPLACE FUNCTION fourmy_due_integrations(p_every interval)
RETURNS TABLE (id uuid, farm_id uuid, provider text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.farm_id, i.provider FROM integrations i
  WHERE i.enabled AND i.secret_ciphertext IS NOT NULL
    AND (i.last_sync_at IS NULL OR i.last_sync_at < now() - p_every)
    AND (i.running_since IS NULL OR i.running_since < now() - interval '30 minutes')
  ORDER BY i.last_sync_at NULLS FIRST
$$;
REVOKE ALL ON FUNCTION fourmy_due_integrations(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_due_integrations(interval) TO fourmy_app;
