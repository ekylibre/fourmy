-- Réglementation phytosanitaire (lot 2 : PHY-1 à PHY-4, GEO-1, IFT-1).
--
-- 1. Référentiel global copié des paquets Lexicon (`phytosanitary`,
--    `taxonomy`) : produits, usages, ensembles de cultures, taxonomie. Écrit
--    par la synchro (rôle propriétaire), lu par l'application (fourmy_app,
--    lecture seule). Données publiques : pas de RLS.
-- 2. Eau autour de chaque ferme (BD TOPO de l'IGN), sous RLS : la ZNT se
--    contrôle sur la distance réelle, et les données restent disponibles
--    sans appel externe au moment de la saisie.
-- 3. Culture des productions (taxonomie Lexicon) et résultat du contrôle et
--    de l'IFT sur chaque intervention.

CREATE TABLE lexicon_packages (
  name        text PRIMARY KEY,           -- phytosanitary, taxonomy
  version     text NOT NULL,              -- ex. 2026.11.07.1
  source      text NOT NULL,              -- adresse du serveur de paquets
  rows        integer NOT NULL,
  loaded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE phyto_products (
  id                    integer PRIMARY KEY,   -- identifiant E-Phy (Lexicon)
  amm                   text NOT NULL,          -- n° d'AMM (france_maaid)
  name                  text NOT NULL,
  other_names           text[] NOT NULL DEFAULT '{}',
  natures               text[] NOT NULL DEFAULT '{}',  -- Herbicide, Fongicide…
  active_compounds      text[] NOT NULL DEFAULT '{}',
  reentry_delay_hours   integer,                -- délai de ré-entrée au champ
  state                 text NOT NULL,          -- authorized | withdrawn | inherited
  started_on            date,
  stopped_on            date,
  firm                  text,
  product_type          text,                   -- PPP, PCP, ADJUVANT
  is_derogation         boolean NOT NULL DEFAULT false
);
CREATE INDEX phyto_products_amm ON phyto_products (amm);
CREATE INDEX phyto_products_name ON phyto_products (lower(name));

CREATE TABLE phyto_usages (
  id                          text PRIMARY KEY,
  product_id                  integer NOT NULL,
  phrase                      text NOT NULL,       -- libellé E-Phy de l'usage
  crop_label                  text,
  species                     text[] NOT NULL DEFAULT '{}',  -- taxonomie, ou ensemble « ephy_… »
  target_label                text,
  treatment_label             text,
  dose_quantity               numeric,
  dose_unit                   text,                -- liter_per_hectare, kilogram_per_hectare…
  dose_unit_label             text,                -- L/ha, kg/ha…
  pre_harvest_delay_days      integer,
  applications_count          integer,
  applications_frequency_days integer,
  untreated_buffer_aquatic    integer,             -- ZNT eau (m)
  untreated_buffer_arthropod  integer,
  untreated_buffer_plants     integer,
  usage_conditions            text,
  decision_date               date,
  state                       text NOT NULL,
  is_derogation               boolean NOT NULL DEFAULT false,
  derogation_started_on       date,
  derogation_stopped_on       date
);
CREATE INDEX phyto_usages_product ON phyto_usages (product_id);

CREATE TABLE phyto_cropsets (
  name        text PRIMARY KEY,                  -- ephy_wheat…
  label       text,
  crop_names  text[] NOT NULL DEFAULT '{}'       -- taxonomie
);

CREATE TABLE phyto_target_pfi (
  ephy_name   text PRIMARY KEY,
  pfi_id      integer,
  pfi_name    text
);

CREATE TABLE taxonomy (
  reference_name  text PRIMARY KEY,              -- zea_mays, vitis…
  parent          text,
  rank            text,
  label           text                           -- libellé français
);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON lexicon_packages, phyto_products, phyto_usages, phyto_cropsets,
  phyto_target_pfi, taxonomy FROM fourmy_app;
GRANT SELECT ON lexicon_packages, phyto_products, phyto_usages, phyto_cropsets, phyto_target_pfi, taxonomy TO fourmy_app;

-- Eau autour de la ferme (BD TOPO : tronçons et surfaces hydrographiques).
CREATE TABLE water_items (
  id          text NOT NULL,                     -- cleabs IGN
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('line', 'area')),
  nature      text,                              -- Ecoulement naturel, Réservoir-bassin…
  name        text,
  permanent   boolean,
  ditch       boolean NOT NULL DEFAULT false,
  geom        geometry(Geometry, 4326) NOT NULL,
  PRIMARY KEY (farm_id, id)
);
CREATE INDEX water_items_geom ON water_items USING gist (geom);
ALTER TABLE water_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_items FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON water_items
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON water_items TO fourmy_app;

-- Emprise couverte par la dernière synchro de l'eau, par ferme.
CREATE TABLE water_syncs (
  farm_id     uuid PRIMARY KEY REFERENCES farms(id) ON DELETE CASCADE,
  bounds      geometry(Polygon, 4326) NOT NULL,
  items       integer NOT NULL,
  synced_at   timestamptz NOT NULL DEFAULT now(),
  last_error  text
);
ALTER TABLE water_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_syncs FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON water_syncs
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON water_syncs TO fourmy_app;

-- Culture de la production (taxonomie Lexicon : zea_mays, vitis…), distincte
-- de la variété (`species` garde le libellé saisi dans Ekylibre).
ALTER TABLE productions ADD COLUMN cultivation text;

-- Contrôle réglementaire (feux, motif d'un passage outre) et IFT.
ALTER TABLE interventions ADD COLUMN compliance jsonb;
ALTER TABLE interventions ADD COLUMN ift jsonb;

-- Le worker cherche les traitements réalisés sans IFT dans toutes les fermes :
-- seulement des identifiants, le calcul se fait ensuite ferme par ferme.
CREATE OR REPLACE FUNCTION fourmy_ift_pending(p_limit integer)
RETURNS TABLE (id uuid, farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.farm_id FROM interventions i
  WHERE i.status = 'done'
    AND (i.ift IS NULL OR (i.ift->>'status' = 'pending' AND (i.ift->>'retryAt')::timestamptz < now()))
    AND EXISTS (SELECT 1 FROM intervention_parameters p JOIN articles a ON a.id = p.ref_id
                WHERE p.intervention_id = i.id AND p.role = 'input' AND a.kind = 'phyto')
  ORDER BY i.stopped_at DESC NULLS LAST
  LIMIT p_limit
$$;
REVOKE ALL ON FUNCTION fourmy_ift_pending(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_ift_pending(integer) TO fourmy_app;

-- Fermes dont l'eau n'a jamais été chargée ou date de plus de 30 jours.
CREATE OR REPLACE FUNCTION fourmy_water_due()
RETURNS TABLE (farm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id FROM farms f
  LEFT JOIN water_syncs s ON s.farm_id = f.id
  WHERE EXISTS (SELECT 1 FROM land_parcels lp WHERE lp.farm_id = f.id)
    AND (s.farm_id IS NULL OR s.synced_at < now() - interval '30 days')
$$;
REVOKE ALL ON FUNCTION fourmy_water_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fourmy_water_due() TO fourmy_app;
