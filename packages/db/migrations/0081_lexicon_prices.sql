-- Assolement, temps 3, lot E2 (claudedocs/conception_assolement_eco.md §2.2) :
-- références Lexicon pour les rendements et les prix de vente par défaut.
-- Référentiel commun (pas de farm_id, pas de RLS), rechargé par la synchro.

-- Rendements Agreste par département et campagne (jeu `productions`, accès libre).
CREATE TABLE lexicon_production_yields (
  department  text NOT NULL,
  specie      text NOT NULL,
  production  text NOT NULL,
  yield_value numeric NOT NULL,
  yield_unit  text NOT NULL,
  campaign    int NOT NULL,
  PRIMARY KEY (department, production, campaign)
);

-- Prix des productions (jeu `productions`) : prix payé au producteur (France
-- « 0 » ou département), cours MATIF, prix départ… par mois.
CREATE TABLE lexicon_production_prices (
  id          bigserial PRIMARY KEY,
  zone        text NOT NULL,
  started_on  date NOT NULL,
  nature      text,
  specie      text NOT NULL,
  output      text NOT NULL,
  price       numeric NOT NULL,
  unit        text NOT NULL,
  production  text,
  campaign    int,
  organic     boolean,
  label       text
);
CREATE INDEX lexicon_production_prices_specie ON lexicon_production_prices (specie, zone, started_on DESC);

-- Prix de marché européens, relevés français (jeu `eu_market_prices`, copie de l'API agrifood).
CREATE TABLE lexicon_market_prices (
  id           text PRIMARY KEY,
  specie       text,
  product_code text NOT NULL,
  label        text NOT NULL,
  stage        text,
  unit         text NOT NULL,
  price        numeric NOT NULL,
  started_on   date NOT NULL,
  ended_on     date
);
CREATE INDEX lexicon_market_prices_specie ON lexicon_market_prices (specie, started_on DESC);

GRANT SELECT ON lexicon_production_yields, lexicon_production_prices, lexicon_market_prices TO fourmy_app;
