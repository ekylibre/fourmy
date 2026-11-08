-- Météo des interventions (lot 3 : MET-1 à MET-3).
--
-- Fournisseurs météo à clé (OpenWeather, meteoblue) dans les intégrations de
-- la ferme ; Open-Meteo, sans clé, est le fournisseur par défaut et n'a pas
-- besoin d'intégration. Ils sont interrogés à la demande (saisie, widget) :
-- le worker ne synchronise périodiquement que Traccar.

ALTER TABLE integrations DROP CONSTRAINT integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check
  CHECK (provider IN ('traccar', 'openweather', 'meteoblue'));

CREATE OR REPLACE FUNCTION fourmy_due_integrations(p_every interval)
RETURNS TABLE (id uuid, farm_id uuid, provider text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.farm_id, i.provider FROM integrations i
  WHERE i.enabled AND i.secret_ciphertext IS NOT NULL AND i.provider = 'traccar'
    AND (i.last_sync_at IS NULL OR i.last_sync_at < now() - p_every)
    AND (i.running_since IS NULL OR i.running_since < now() - interval '30 minutes')
  ORDER BY i.last_sync_at NULLS FIRST
$$;

-- Météo pendant l'intervention : pré-remplie (fournisseur, observée ou
-- prévue), modifiable (« manual »).
ALTER TABLE interventions ADD COLUMN weather jsonb;

-- Interventions réalisées sans météo (reprises d'Ekylibre comprises) : le
-- worker les complète depuis l'historique d'Open-Meteo, par lots.
CREATE OR REPLACE FUNCTION fourmy_weather_pending(p_limit integer)
RETURNS TABLE (id uuid, farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.farm_id FROM interventions i
  WHERE i.status = 'done' AND i.weather IS NULL AND i.stopped_at IS NOT NULL AND i.stopped_at < now()
    AND EXISTS (SELECT 1 FROM intervention_parameters t WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel')
  ORDER BY i.stopped_at DESC
  LIMIT p_limit
$$;
REVOKE ALL ON FUNCTION fourmy_weather_pending(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_weather_pending(integer) TO fourmy_app;
