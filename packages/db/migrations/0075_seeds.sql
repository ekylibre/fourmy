-- Semences, lot SE1 (claudedocs/conception_semences.md §2) : fiche d'une
-- semence (espèce, variété GNIS, conditionnement, PMG), espèces d'un mélange,
-- et lien entre un couvert et le semis qui l'a implanté.

-- Fiche d'une semence : extension 1-1 de l'article, comme article_fertilizers.
-- L'unité de stock reste articles.unit.
CREATE TABLE article_seeds (
  article_id       uuid PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  farm_id          uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  -- Taxon Lexicon (triticum_aestivum) ; NULL pour un mélange ou une espèce inconnue.
  species          text,
  variety_name     text CHECK (length(variety_name) <= 120),
  -- Code GNIS (catalogue SEMAE) ; gardé même absent du catalogue.
  gnis_code        text CHECK (length(gnis_code) BETWEEN 1 AND 20),
  category         text CHECK (category IN ('certified', 'farm')),
  is_mixture       boolean NOT NULL DEFAULT false,
  -- Nombre de grains d'une dose (sac de 50 000 grains de maïs).
  grains_per_dose  integer CHECK (grains_per_dose > 0),
  -- Poids d'un sac vendu au poids, en kg (information).
  bag_kg           numeric CHECK (bag_kg > 0),
  -- PMG par défaut de l'article, en grammes ; un lot peut porter le sien (lots.attrs.seed).
  tgw_g            numeric CHECK (tgw_g > 0 AND tgw_g < 2000),
  -- label : étiquette ; measured : mesuré à la ferme ; reference : repère de l'espèce ; imported : fichier.
  tgw_origin       text CHECK (tgw_origin IN ('label', 'measured', 'reference', 'imported')),
  tgw_on           date,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((tgw_g IS NULL) = (tgw_origin IS NULL)),
  -- Un mélange n'a pas d'espèce unique ni de PMG (FR-SE-15).
  CHECK (NOT is_mixture OR (species IS NULL AND tgw_g IS NULL))
);
CREATE INDEX article_seeds_farm ON article_seeds (farm_id);
CREATE INDEX article_seeds_species ON article_seeds (farm_id, species);

-- Espèces d'un mélange, sans proportion : la dose de chaque espèce se saisit au semis (S7).
CREATE TABLE seed_mixture_components (
  id            uuid PRIMARY KEY,
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  article_id    uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  species       text,
  label         text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  variety_name  text CHECK (length(variety_name) <= 120),
  gnis_code     text CHECK (length(gnis_code) BETWEEN 1 AND 20),
  position      smallint NOT NULL CHECK (position >= 0),
  UNIQUE (article_id, label)
);
CREATE INDEX seed_mixture_components_article ON seed_mixture_components (article_id, position);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['article_seeds', 'seed_mixture_components'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;

-- Couvert implanté par un semis (FR-SE-16) : espèces semées et leur dose en kg/ha.
ALTER TABLE cover_crops
  ADD COLUMN sowing_intervention_id uuid REFERENCES interventions(id) ON DELETE SET NULL,
  ADD COLUMN components jsonb CHECK (components IS NULL OR jsonb_typeof(components) = 'array');
