-- Rejeu 3D et paysage (claudedocs/conception_rejeu_3d_outils_paysage.md §7, §8) :
-- arbres, haies, lignes électriques et pylônes de la BD TOPO (GeoJSON réduit
-- par tuile Web Mercator de zoom 14), puis hauteur de la végétation du LiDAR
-- HD (grilles du schéma géographique), dans le cache disque des tuiles IGN.
ALTER TABLE ign_tiles DROP CONSTRAINT ign_tiles_layer_check;
ALTER TABLE ign_tiles ADD CONSTRAINT ign_tiles_layer_check CHECK (layer IN ('ortho', 'plan', 'elevation', 'buildings', 'landscape', 'canopy'));

-- Le paysage est préchargé par défaut, y compris pour les fermes qui ont gardé les couches par défaut.
ALTER TABLE farm_settings ALTER COLUMN ign
  SET DEFAULT '{"layers":["ortho","plan","elevation","buildings","landscape"],"detailMarginM":200,"autoRefresh":false}';
UPDATE farm_settings SET ign = jsonb_set(ign, '{layers}', '["ortho","plan","elevation","buildings","landscape"]')
WHERE ign->'layers' = '["ortho","plan","elevation","buildings"]'::jsonb;
