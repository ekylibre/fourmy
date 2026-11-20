-- Contrôle HVE, lot CT3c (item 7.1, enregistrement de l'irrigation) : par
-- parcelle irriguée, variété tolérante à la sécheresse et autres pratiques
-- économes en eau. Les données de chaque apport (origine de l'eau, facteur
-- déclenchant, matériel mobile) sont dans interventions.irrigation (jsonb).
ALTER TABLE productions
  ADD COLUMN drought_tolerant boolean,
  ADD COLUMN water_saving text CHECK (char_length(water_saving) <= 200);
