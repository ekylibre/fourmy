-- Activités (retours de test du 08/11/2026, lot C) : comme dans Ekylibre,
-- une activité de la ferme (Maïs, Jachère, Vignes AOP…) a une famille, une
-- production de référence Lexicon et une variété cultivée ; chaque
-- production (parcelle × campagne) lui est rattachée. L'activité désigne la
-- culture contrôlée (usages E-Phy), la culture IFT et l'image affichée.

-- ---------------------------------------------------------------------------
-- Référentiel Lexicon (paquets `productions` et `agricultural_pictures`)
-- ---------------------------------------------------------------------------
CREATE TABLE lexicon_productions (
  reference_name  text PRIMARY KEY,
  family          text NOT NULL,           -- plant_farming, vine_farming…
  specie          text,                    -- variété cultivée (taxonomie)
  usage           text,                    -- grain, fodder, fruit…
  label           text NOT NULL,           -- français
  label_en        text,
  color           text,
  life_years      numeric,                 -- pérenne : durée de vie
  support_unit    text
);

-- Production de référence → culture de l'API IFT, par campagne.
CREATE TABLE lexicon_production_ift (
  production   text NOT NULL,
  ift_culture  text NOT NULL,
  ift_label    text NOT NULL,
  crop_group   text,
  campaign     integer NOT NULL
);
CREATE INDEX lexicon_production_ift_production ON lexicon_production_ift (production, campaign);

-- Images agricoles d'Ekylibre : familles d'activité, variétés (nom latin).
CREATE TABLE lexicon_pictures (
  domain     text NOT NULL,                -- activity_families, varieties
  name       text NOT NULL,
  extension  text NOT NULL,
  picture    bytea NOT NULL,
  PRIMARY KEY (domain, name)
);

GRANT SELECT ON lexicon_productions, lexicon_production_ift, lexicon_pictures TO fourmy_app;

-- ---------------------------------------------------------------------------
-- Activités de la ferme
-- ---------------------------------------------------------------------------
CREATE TABLE activities (
  id           uuid PRIMARY KEY,
  farm_id      uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name         text NOT NULL,
  family       text NOT NULL CHECK (family IN (
                 'plant_farming', 'vine_farming', 'animal_farming', 'plant_nursery',
                 'processing', 'wine_making', 'administering', 'tool_maintaining', 'service_delivering')),
  reference    text,                       -- lexicon_productions.reference_name
  cultivation  text,                       -- variété cultivée (taxonomie), sinon celle de la référence
  color        text,
  suspended    boolean NOT NULL DEFAULT false,
  -- Déduite des productions (pas saisie ni reprise) : une reprise la remplace.
  deduced      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, name)
);
CREATE INDEX activities_farm ON activities (farm_id);
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON activities
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON activities TO fourmy_app;

ALTER TABLE productions ADD COLUMN activity_id uuid REFERENCES activities(id) ON DELETE SET NULL;
CREATE INDEX productions_activity ON productions (activity_id);

-- Productions sans activité (fermes de test, fixtures, saisies antérieures) :
-- une activité par (nature, culture), nommée d'après la culture. Une reprise
-- d'Ekylibre crée, elle, les activités de la ferme d'origine.
CREATE FUNCTION fourmy_ensure_activities(p_farm uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n integer := 0;
  r record;
  a uuid;
BEGIN
  -- Sous RLS (rôle applicatif) : la ferme traitée.
  PERFORM set_config('fourmy.farm_id', p_farm::text, true);
  FOR r IN
    SELECT p.nature, p.cultivation,
           coalesce(
             (SELECT t.label FROM taxonomy t WHERE t.reference_name = p.cultivation),
             CASE p.nature WHEN 'vine' THEN 'Vigne' WHEN 'grassland' THEN 'Prairie' ELSE 'Grandes cultures' END
           ) AS name
    FROM productions p
    WHERE p.farm_id = p_farm AND p.activity_id IS NULL
    GROUP BY p.nature, p.cultivation
  LOOP
    SELECT id INTO a FROM activities WHERE farm_id = p_farm AND name = r.name;
    IF a IS NULL THEN
      a := gen_random_uuid();
      INSERT INTO activities (id, farm_id, name, family, reference, cultivation, deduced)
      VALUES (a, p_farm, r.name,
              CASE r.nature WHEN 'vine' THEN 'vine_farming' ELSE 'plant_farming' END,
              CASE r.nature WHEN 'vine' THEN 'vine' END,
              coalesce(r.cultivation, CASE r.nature WHEN 'vine' THEN 'vitis' END), true);
      n := n + 1;
    END IF;
    UPDATE productions SET activity_id = a
    WHERE farm_id = p_farm AND activity_id IS NULL AND nature = r.nature AND cultivation IS NOT DISTINCT FROM r.cultivation;
    a := NULL;
  END LOOP;
  RETURN n;
END $$;

SELECT fourmy_ensure_activities(id) FROM farms;

-- Image d'une activité : la variété cultivée ou son ancêtre le plus proche
-- (taxonomie), sinon la famille d'activité. Renvoie « domaine/nom ».
CREATE FUNCTION fourmy_activity_picture(p_cultivation text, p_family text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (WITH RECURSIVE l AS (
        SELECT p_cultivation AS name, 0 AS depth WHERE p_cultivation IS NOT NULL
        UNION ALL
        SELECT t.parent, l.depth + 1 FROM taxonomy t JOIN l ON t.reference_name = l.name
        WHERE t.parent IS NOT NULL AND l.depth < 30)
     SELECT 'varieties/' || pic.name FROM l
     JOIN lexicon_pictures pic ON pic.domain = 'varieties' AND pic.name IN (l.name, regexp_replace(l.name, '^x_', ''))
     ORDER BY l.depth LIMIT 1),
    (SELECT 'activity_families/' || name FROM lexicon_pictures WHERE domain = 'activity_families' AND name = p_family));
$$;
GRANT EXECUTE ON FUNCTION fourmy_activity_picture(text, text) TO fourmy_app;
