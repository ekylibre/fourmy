-- « Ma ferme », lot F2 (claudedocs/conception_ma_ferme.md §3.5) : préférences
-- d'affichage de la ferme. Fond de carte par défaut (E9) : orthophotos, le
-- fond que la plupart des cartes ouvraient déjà. Unité des surfaces (E21
-- bis) : affichage seulement, le stockage reste en m².
ALTER TABLE farm_settings
  ADD COLUMN display jsonb NOT NULL DEFAULT '{"basemap":"ortho","areaUnit":"ha"}';
