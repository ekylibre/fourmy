-- Semences, lot SE2 (claudedocs/conception_semences.md §2.6) : catalogue
-- officiel des variétés (SEMAE, base variétés GNIS), copié du jeu Lexicon
-- `seed_varieties`, pour ajouter une semence par sa variété et rattacher les
-- codes GNIS des imports.
CREATE TABLE lexicon_seed_varieties (
  gnis_code      text PRIMARY KEY,
  -- Taxon Lexicon (triticum_aestivum), comme taxonomy.reference_name.
  species        text NOT NULL,
  species_label  text,
  variety_name   text NOT NULL,
  registered_on  date,
  -- Variété et espèce en minuscules sans accents : recherche par ILIKE.
  search         text NOT NULL
);
CREATE INDEX lexicon_seed_varieties_species ON lexicon_seed_varieties (species);
CREATE INDEX lexicon_seed_varieties_search ON lexicon_seed_varieties (search text_pattern_ops);

GRANT SELECT ON lexicon_seed_varieties TO fourmy_app;
