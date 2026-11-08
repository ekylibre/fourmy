-- Pictogrammes réglementaires des produits phyto (retours de test du
-- 08/11/2026, lot D) : mentions de danger (H…, EUH…) des produits E-Phy et
-- correspondance mention → pictogramme SGH (CLP), paquet Lexicon
-- `phytosanitary`.

CREATE TABLE phyto_risks (
  product_id  integer NOT NULL,
  code        text NOT NULL,       -- H319, H361d, EUH401 ; anciennes phrases R exclues
  phrase      text NOT NULL,
  PRIMARY KEY (product_id, code)
);

CREATE TABLE phyto_hazard_symbols (
  code    text PRIMARY KEY,        -- H200…
  symbol  text NOT NULL            -- SGH01…SGH09
);

GRANT SELECT ON phyto_risks, phyto_hazard_symbols TO fourmy_app;

-- Le paquet déjà chargé ne contient pas ces tables : il est rechargé à la
-- prochaine synchronisation (worker, ou fourmy-lexicon-sync).
DELETE FROM lexicon_packages WHERE name = 'phytosanitary';

-- Météo des interventions (lot D) : temps dominant et frise horaire. Les
-- météos enregistrées avant (sans `icon`), hors saisie à la main, sont
-- complétées par le worker depuis l'historique.
CREATE OR REPLACE FUNCTION fourmy_weather_pending(p_limit integer)
RETURNS TABLE (id uuid, farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.farm_id FROM interventions i
  WHERE i.status = 'done' AND i.stopped_at IS NOT NULL AND i.stopped_at < now()
    AND (i.weather IS NULL
         OR (NOT (i.weather ? 'icon') AND i.weather->>'source' <> 'manual' AND i.weather->>'kind' <> 'manual'))
    AND EXISTS (SELECT 1 FROM intervention_parameters t WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel')
  ORDER BY (i.weather IS NULL) DESC, i.stopped_at DESC
  LIMIT p_limit
$$;
