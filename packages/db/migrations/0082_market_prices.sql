-- Assolement, temps 3, lot E3 (claudedocs/conception_assolement_eco.md §2.3) :
-- cache des prix de marché de l'API agrifood de la Commission européenne
-- (céréales, relevés français, €/t par semaine), rempli par le worker.
-- Référentiel commun : pas de farm_id, pas de RLS.

CREATE TABLE market_prices (
  id            text PRIMARY KEY,           -- code_pays_marché_début (BLTPAN_FR_Rouen_2026-04-13)
  product_code  text NOT NULL,
  specie        text,
  product_label text NOT NULL,
  market        text NOT NULL,
  stage         text,
  unit          text NOT NULL,
  price         numeric NOT NULL CHECK (price > 0),
  started_on    date NOT NULL,
  ended_on      date,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_prices_specie ON market_prices (specie, started_on DESC);

-- Dernier appel de chaque source (agrifood) : réussite, échec et message, pour réessayer et l'afficher.
CREATE TABLE market_price_fetches (
  source        text PRIMARY KEY,
  attempted_at  timestamptz NOT NULL,
  succeeded_at  timestamptz,
  rows          int NOT NULL DEFAULT 0,
  error         text CHECK (length(error) <= 500)
);

GRANT SELECT ON market_prices, market_price_fetches TO fourmy_app;
