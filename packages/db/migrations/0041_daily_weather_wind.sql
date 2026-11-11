-- Fertilisation azotée, lot AL (docs/fertilisation-design.md §5.7) : vent
-- maximal du jour (grille d'efficacité des apports d'azote minéral du COMIFER).
-- Les journées déjà en cache n'ont pas de vent : la dernière année d'archive
-- est rechargée une fois (with_wind faux), les plus anciennes restent sans vent.
ALTER TABLE daily_weather ADD COLUMN wind_max_kmh double precision;
ALTER TABLE daily_weather ADD COLUMN with_wind boolean NOT NULL DEFAULT false;
