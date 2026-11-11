-- Fertilisation azotée, lot AE (docs/fertilisation-design.md §4.1) :
-- composition des fertilisants et analyses de produits organiques.

CREATE TABLE article_fertilizers (
  article_id       uuid PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  farm_id          uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  -- Teneurs : % de la masse (minéraux) ou kg par t ou m³ de produit brut (organiques).
  basis            text NOT NULL CHECK (basis IN ('mass_percent', 'kg_per_t', 'kg_per_m3')),
  n_total          numeric NOT NULL CHECK (n_total >= 0 AND n_total <= 1000),
  n_mineral_share  numeric CHECK (n_mineral_share >= 0 AND n_mineral_share <= 1),
  p2o5             numeric CHECK (p2o5 >= 0),
  k2o              numeric CHECK (k2o >= 0),
  so3              numeric CHECK (so3 >= 0),
  density          numeric CHECK (density > 0 AND density <= 3),
  nitrate_type     text CHECK (nitrate_type IN ('0', 'Ia', 'Ib', 'II', 'III')),
  foliar           boolean NOT NULL DEFAULT false,
  -- proposed : Fourmy (nom, Lexicon) ; migrated : Ekylibre ; confirmed : saisie ; analysis : analyse.
  origin           text NOT NULL CHECK (origin IN ('proposed', 'migrated', 'confirmed', 'analysis')),
  source           text,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX article_fertilizers_farm ON article_fertilizers (farm_id);

-- Analyses de produits organiques (FR-FERT-7) : valables 5 ans.
CREATE TABLE product_analyses (
  id           uuid PRIMARY KEY,
  farm_id      uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  article_id   uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  sampled_on   date NOT NULL,
  basis        text NOT NULL CHECK (basis IN ('kg_per_t', 'kg_per_m3')),
  dry_matter   numeric CHECK (dry_matter >= 0 AND dry_matter <= 100),
  n_total      numeric NOT NULL CHECK (n_total >= 0),
  n_nh4        numeric CHECK (n_nh4 >= 0),
  c_n          numeric CHECK (c_n >= 0),
  lab          text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_analyses_article ON product_analyses (article_id, sampled_on DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['article_fertilizers', 'product_analyses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;
