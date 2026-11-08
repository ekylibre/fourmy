-- Retours de test du 08/11/2026 (15 h 32), colonnes E-Phy supplémentaires :
-- - IFT : type de traitement par défaut de la cible PFI (comme Ekylibre,
--   `pfi_client_api.rb`) ;
-- - précautions d'emploi et mélanges : protection de l'opérateur, mentions
--   restrictives, catégories de mélange (arrêté du 7 avril 2010 modifié) ;
-- - agriculture biologique : mention « utilisable en AB », biocontrôle.
ALTER TABLE phyto_target_pfi ADD COLUMN default_treatment_type text;
ALTER TABLE phyto_products
  ADD COLUMN mix_codes integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN organic boolean NOT NULL DEFAULT false,
  ADD COLUMN biocontrol boolean NOT NULL DEFAULT false,
  ADD COLUMN operator_protection text,
  ADD COLUMN restricted_mentions text;

-- Rechargé à la prochaine synchronisation avec ces colonnes.
DELETE FROM lexicon_packages WHERE name = 'phytosanitary';
