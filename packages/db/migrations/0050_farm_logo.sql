-- « Ma ferme », lot F3 (E8 bis) : logo de la ferme, imprimé sur les
-- documents. Mêmes fichiers que les logos des matériels et des marques
-- (equipment_assets : type vérifié sur les octets, SVG servi sous CSP).
ALTER TABLE farms ADD COLUMN logo_asset_id uuid REFERENCES equipment_assets(id) ON DELETE SET NULL;
