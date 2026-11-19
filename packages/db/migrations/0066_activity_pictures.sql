-- Images des activités (retour du 19/11/2026) : une production de référence
-- sans espèce précise (Prairie, Bande tampon : « plante » ; Mélange de
-- légumineuses : « fabacées ») n'a pas d'image de variété. Plutôt que
-- l'image de la famille d'activité : les graminées pour les prairies et
-- bandes enherbées, le trèfle pour les légumineuses en mélange. Les jachères
-- gardent l'image de la famille.
CREATE FUNCTION fourmy_activity_picture(p_cultivation text, p_family text, p_reference text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    -- La variété cultivée ou son ancêtre le plus proche (taxonomie).
    (WITH RECURSIVE l AS (
        SELECT p_cultivation AS name, 0 AS depth WHERE p_cultivation IS NOT NULL
        UNION ALL
        SELECT t.parent, l.depth + 1 FROM taxonomy t JOIN l ON t.reference_name = l.name
        WHERE t.parent IS NOT NULL AND l.depth < 30)
     SELECT 'varieties/' || pic.name FROM l
     JOIN lexicon_pictures pic ON pic.domain = 'varieties' AND pic.name IN (l.name, regexp_replace(l.name, '^x_', ''))
     ORDER BY l.depth LIMIT 1),
    -- Production sans espèce précise : graminées ou trèfle, si Lexicon a l'image.
    (SELECT 'varieties/' || pic.name FROM lexicon_pictures pic
     WHERE pic.domain = 'varieties' AND pic.name = CASE
       WHEN p_reference IN ('meadow', 'border', 'border_field', 'fodder_specie', 'fodder_species_mix', 'cereal_mix') THEN 'poaceae'
       WHEN p_reference IN ('leguminous_mix', 'proteaginous', 'proteaginous_mix') THEN 'trifolium'
     END),
    (SELECT 'activity_families/' || name FROM lexicon_pictures WHERE domain = 'activity_families' AND name = p_family));
$$;
GRANT EXECUTE ON FUNCTION fourmy_activity_picture(text, text, text) TO fourmy_app;

-- L'ancienne signature reste (même résultat, sans production de référence).
CREATE OR REPLACE FUNCTION fourmy_activity_picture(p_cultivation text, p_family text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT fourmy_activity_picture(p_cultivation, p_family, NULL) $$;
