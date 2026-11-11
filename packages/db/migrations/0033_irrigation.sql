-- Irrigation (lot AC, docs/modele-croissance.md) : dose d'eau apportée (mm sur
-- la surface ciblée) et matériel d'irrigation des interventions d'irrigation
-- (`watering`, `plant_watering`, `vine_watering`). Le modèle de croissance
-- ajoute les doses réalisées au bilan hydrique des parcelles ciblées.
--   { "depthMm": 30, "method": "reel" | "pivot" | "sprinkler" | "drip" | "other" | null }

ALTER TABLE interventions ADD COLUMN irrigation jsonb;
ALTER TABLE interventions ADD CONSTRAINT interventions_irrigation_depth
  CHECK (irrigation IS NULL OR ((irrigation->>'depthMm')::numeric > 0 AND (irrigation->>'depthMm')::numeric <= 100));
