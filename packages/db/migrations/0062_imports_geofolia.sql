-- Imports, lot IM2 (claudedocs/conception_import_onboarding.md §6.2, §6.3) :
-- interventions importées (origine, sans effet de stock, dates sans heure,
-- technique de semis), productions déclarées et attributs venus de la source,
-- composition des fertilisants importée.

-- Origine « import » ; une intervention importée ne bouge pas les stocks
-- (l'historique d'une autre application les rendrait négatifs) ; ses périodes
-- peuvent n'être connues qu'au jour près.
ALTER TABLE interventions DROP CONSTRAINT interventions_origin_check;
ALTER TABLE interventions ADD CONSTRAINT interventions_origin_check
  CHECK (origin IN ('web', 'mobile', 'migration', 'plugin', 'import'));
ALTER TABLE interventions
  ADD COLUMN affects_stock     boolean NOT NULL DEFAULT true,
  ADD COLUMN period_precision  text NOT NULL DEFAULT 'time' CHECK (period_precision IN ('time', 'day')),
  -- Technique de semis : { technique: direct | precision | conventional | planting | broadcast }.
  ADD COLUMN sowing            jsonb CHECK (sowing IS NULL OR sowing->>'technique' IN ('direct', 'precision', 'conventional', 'planting', 'broadcast'));

-- Production déclarée (culture d'une campagne passée, sans intervention) et
-- attributs de la source : rendement objectif et réalisé, destination,
-- résidus, sol, conseils de fumure, surfaces épandables, codes de culture.
ALTER TABLE productions
  ADD COLUMN declared  boolean NOT NULL DEFAULT false,
  ADD COLUMN attrs     jsonb;

-- Composition d'un fertilisant lue dans le fichier importé.
ALTER TABLE article_fertilizers DROP CONSTRAINT article_fertilizers_origin_check;
ALTER TABLE article_fertilizers ADD CONSTRAINT article_fertilizers_origin_check
  CHECK (origin IN ('proposed', 'migrated', 'confirmed', 'analysis', 'imported'));
