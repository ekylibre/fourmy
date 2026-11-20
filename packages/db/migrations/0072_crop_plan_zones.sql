-- Assolement, lot AS4 (claudedocs/conception_assolement.md §4.5, §8) :
-- zonages copiés de Lexicon pour les contrôles réglementaires de l'assolement.

-- Aires d'alimentation de captage (agences de l'eau ; Lexicon protected_water_zones).
CREATE TABLE lexicon_water_catchments (
  id         text PRIMARY KEY,
  basin      text,
  name       text,
  updated_on date,
  shape      geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX lexicon_water_catchments_shape ON lexicon_water_catchments USING gist (shape);

-- Sites Natura 2000 : SIC (directive Habitats) et ZPS (directive Oiseaux) ; Lexicon protected_natural_zones.
CREATE TABLE lexicon_natura2000 (
  id     text PRIMARY KEY,
  name   text,
  nature text NOT NULL,
  shape  geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX lexicon_natura2000_shape ON lexicon_natura2000 USING gist (shape);

GRANT SELECT ON lexicon_water_catchments, lexicon_natura2000 TO fourmy_app;
