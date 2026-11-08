-- Avatar 3D des matériels, lot M (docs/materiels-entretien-design.md §10) :
-- seulement ce que l'utilisateur a saisi (gabarit, dimensions, couleurs) ;
-- le reste se déduit (fiche technique, défaut du gabarit). Un modèle GLB
-- importé remplace l'avatar généré.
ALTER TABLE equipments
  ADD COLUMN avatar jsonb,
  ADD COLUMN model_asset_id uuid REFERENCES equipment_assets(id) ON DELETE SET NULL;
