-- Point 142 (suite du lot E2, claudedocs/conception_assolement_eco.md §2.2) :
-- prix de référence des intrants, jeux Lexicon réservés aux adhérents du
-- bundle « fourmy » : engrais (`fertilizers`), produits phyto
-- (`phytosanitary_prices`), semences (`seeds`) — relevés Cereapro et Germineo,
-- réutilisation avec attribution. Référentiel commun : pas de farm_id, pas de RLS.

-- Engrais du catalogue (rattachement par la variante Lexicon ou la composition).
CREATE TABLE lexicon_fertilizer_refs (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  kind       text NOT NULL,
  nitrogen   numeric,
  phosphorus numeric,
  potassium  numeric,
  sulfur     numeric,
  variant    text
);
CREATE INDEX lexicon_fertilizer_refs_variant ON lexicon_fertilizer_refs (variant);

-- Espèces de semences (rattachement par le taxon).
CREATE TABLE lexicon_seed_species (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  latin_name text,
  category   text,
  taxon      text
);
CREATE INDEX lexicon_seed_species_taxon ON lexicon_seed_species (taxon);

-- Prix mensuels de référence : engrais par conditionnement (€/t), phyto par AMM (€/L, €/kg), semences par espèce (€/kg, conventionnel ou bio).
CREATE TABLE lexicon_input_prices (
  id           text PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('fertilizer', 'phyto', 'seed')),
  ref          text NOT NULL,
  packaging    text,
  organic      boolean,
  month        date NOT NULL,
  price        numeric NOT NULL CHECK (price > 0),
  unit         text NOT NULL,
  merchant     text NOT NULL,
  observations int
);
CREATE INDEX lexicon_input_prices_ref ON lexicon_input_prices (kind, ref, month DESC);

GRANT SELECT ON lexicon_fertilizer_refs, lexicon_seed_species, lexicon_input_prices TO fourmy_app;
