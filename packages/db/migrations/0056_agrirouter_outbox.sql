-- agrirouter, lot AR3 (claudedocs/conception_agrirouter.md §6) : file d'envoi.
-- Un envoi est d'abord mis en file, fichier figé sur le volume ; l'API le
-- tente aussitôt, le worker reprend ce qui n'a pas pu partir (agrirouter
-- injoignable, identifiants refusés, 429, 5xx). Jamais de renvoi après un 200.

ALTER TABLE prescription_sends DROP CONSTRAINT prescription_sends_status_check;
ALTER TABLE prescription_sends ADD CONSTRAINT prescription_sends_status_check
  CHECK (status IN ('queued', 'sent', 'partial', 'error'));
-- Prochaine tentative d'un envoi en attente (affichée dans l'historique).
ALTER TABLE prescription_sends ADD COLUMN next_attempt_at timestamptz;

CREATE TABLE agrirouter_outbox (
  id                    uuid PRIMARY KEY,
  farm_id               uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  -- Envoi d'une carte de modulation : le supprimer (avec la carte) retire l'envoi de la file.
  prescription_send_id  uuid REFERENCES prescription_sends(id) ON DELETE CASCADE,
  message_type          text NOT NULL,
  filename              text NOT NULL,
  recipients            text[] NOT NULL CHECK (cardinality(recipients) > 0),
  -- Fichier figé sur le volume des fichiers agrirouter : un renvoi envoie les mêmes octets.
  file_sha256           text NOT NULL,
  state                 text NOT NULL DEFAULT 'queued'
                        CHECK (state IN ('queued', 'sending', 'sent', 'partial', 'failed')),
  attempts              integer NOT NULL DEFAULT 0,
  next_attempt_at       timestamptz NOT NULL DEFAULT now(),
  -- Pris en charge par l'API ou un worker jusqu'à cette date (un worker mort libère la ligne).
  locked_until          timestamptz,
  last_error            text,
  sent_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agrirouter_outbox_due ON agrirouter_outbox (next_attempt_at) WHERE state IN ('queued', 'sending');
ALTER TABLE agrirouter_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE agrirouter_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON agrirouter_outbox
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON agrirouter_outbox TO fourmy_app;

-- Worker : prend un envoi dû (ou abandonné par un processus mort), toutes
-- fermes confondues (ou celle de `p_farm`), et le verrouille ; identifiants seulement.
CREATE FUNCTION fourmy_agrirouter_claim_outbox(lock_for interval, p_farm uuid DEFAULT NULL)
RETURNS TABLE (id uuid, farm_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE agrirouter_outbox o
     SET state = 'sending', locked_until = now() + lock_for, attempts = o.attempts + 1
   WHERE o.id = (
     SELECT c.id FROM agrirouter_outbox c
      WHERE ((c.state = 'queued' AND c.next_attempt_at <= now())
          OR (c.state = 'sending' AND c.locked_until < now()))
        AND (p_farm IS NULL OR c.farm_id = p_farm)
      ORDER BY c.next_attempt_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED)
  RETURNING o.id, o.farm_id
$$;
REVOKE ALL ON FUNCTION fourmy_agrirouter_claim_outbox(interval, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_agrirouter_claim_outbox(interval, uuid) TO fourmy_app;
