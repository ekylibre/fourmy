-- Contrôle AB, lot CT2 : teneur en cuivre métal d'un produit cuprique, saisie
-- quand le catalogue E-Phy ne permet pas de la déduire (sulfate de cuivre,
-- sulfate tribasique, teneur absente). Elle prime sur la teneur déduite.
ALTER TABLE articles
  ADD COLUMN copper_metal_g numeric CHECK (copper_metal_g > 0 AND copper_metal_g <= 1000),
  ADD COLUMN copper_metal_per text CHECK (copper_metal_per IN ('kg', 'L')),
  ADD CONSTRAINT articles_copper_metal_pair CHECK ((copper_metal_g IS NULL) = (copper_metal_per IS NULL));
