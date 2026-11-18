-- Fiche d'une intervention (claudedocs/conception_vue_intervention.md §4.2) :
-- seuils des conditions de pulvérisation propres à la ferme (vent,
-- température, hygrométrie, pluie). NULL : valeurs par défaut du domaine.
ALTER TABLE farm_settings ADD COLUMN spraying jsonb;
