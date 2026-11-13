-- « Ma ferme », lot F4 bis (claudedocs/conception_ma_ferme.md §5.3) : le
-- relief (grilles du schéma géographique de Cesium) et les bâtiments BD TOPO
-- (GeoJSON par tuile Web Mercator de zoom 14) passent aussi par le cache
-- disque. L'hydrographie est déjà gardée en base (water_syncs, 30 jours).
ALTER TABLE ign_tiles DROP CONSTRAINT ign_tiles_layer_check;
ALTER TABLE ign_tiles ADD CONSTRAINT ign_tiles_layer_check CHECK (layer IN ('ortho', 'plan', 'elevation', 'buildings'));

-- Nouvelles couches préchargées par défaut, y compris pour les fermes qui
-- n'ont pas touché au réglage.
ALTER TABLE farm_settings ALTER COLUMN ign
  SET DEFAULT '{"layers":["ortho","plan","elevation","buildings"],"detailMarginM":200,"autoRefresh":false}';
UPDATE farm_settings SET ign = jsonb_set(ign, '{layers}', '["ortho","plan","elevation","buildings"]')
WHERE ign->'layers' = '["ortho","plan"]'::jsonb;
