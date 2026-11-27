-- Lot AM2 (claudedocs/conception_api_mcp.md §5) : périmètre d'activités d'un
-- accès restreint, appliqué par la RLS. `withFarm` pose `fourmy.activity_scope`
-- (liste d'uuid) pour un accès limité à des activités ; sans réglage, toutes les
-- conditions ci-dessous valent vrai et rien ne change.
--
-- Politiques RESTRICTIVE, en lecture seulement : elles s'ajoutent aux politiques
-- par ferme et ne peuvent que retirer des lignes. Les écritures d'un accès
-- restreint sont refusées plus haut (externalGuard) ; les caches écrits pendant
-- une lecture (trajets, indices) restent possibles.
--
-- Les fonctions d'aide sont SECURITY DEFINER : elles lisent sans RLS (sinon
-- interventions ↔ intervention_parameters bouclerait), bornent elles-mêmes la
-- ferme par current_farm_id() et ne renvoient que des identifiants visibles ou
-- une part. Les politiques les appellent en sous-requête non corrélée
-- (`id IN (SELECT …)`) : PostgreSQL calcule l'ensemble une fois par requête
-- (table de hachage) au lieu d'une fonction par ligne — sur la ferme de
-- l'exploitant testeur, le registre phyto passait sinon de 45 ms à 900 ms.

CREATE OR REPLACE FUNCTION current_activity_scope() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('fourmy.activity_scope', true), '')::uuid[]
$$;

-- Parcelles du périmètre : celles qui portent une production d'une activité du
-- périmètre, toutes campagnes confondues (conception §5.2, point validé le 27/11).
CREATE OR REPLACE FUNCTION fourmy_scope_parcels() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public ROWS 200 AS $$
  SELECT DISTINCT pr.land_parcel_id FROM productions pr
  WHERE pr.farm_id = current_farm_id() AND pr.activity_id = ANY (current_activity_scope())
$$;

-- Couples (intervention, parcelle ciblée) du périmètre : la parcelle porte, sur
-- la campagne qui couvre la date de l'intervention, une production du périmètre.
CREATE OR REPLACE FUNCTION fourmy_scope_targets() RETURNS TABLE (intervention_id uuid, parcel_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public ROWS 2000 AS $$
  SELECT DISTINCT ip.intervention_id, ip.ref_id
  FROM intervention_parameters ip
  JOIN interventions i ON i.id = ip.intervention_id AND i.farm_id = current_farm_id()
  JOIN productions pr ON pr.land_parcel_id = ip.ref_id AND pr.farm_id = current_farm_id()
                     AND pr.activity_id = ANY (current_activity_scope())
  JOIN campaigns c ON c.id = pr.campaign_id
  WHERE ip.role = 'target' AND ip.ref_type = 'land_parcel'
    AND coalesce(i.started_at, i.stopped_at, i.created_at)::date BETWEEN c.starts_on AND c.stops_on
$$;

-- Date d'effet d'une intervention, comme pour les listes (repos/interventions.ts).
CREATE OR REPLACE FUNCTION fourmy_intervention_day(p_intervention uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(i.started_at, i.stopped_at, i.created_at)::date
  FROM interventions i WHERE i.id = p_intervention AND i.farm_id = current_farm_id()
$$;

-- Parcelle ciblée dans le périmètre à une date : production d'une activité du
-- périmètre sur la campagne qui couvre cette date.
CREATE OR REPLACE FUNCTION fourmy_parcel_in_scope_on(p_parcel uuid, p_day date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_activity_scope() IS NULL OR EXISTS (
    SELECT 1 FROM productions pr JOIN campaigns c ON c.id = pr.campaign_id
    WHERE pr.land_parcel_id = p_parcel AND pr.farm_id = current_farm_id()
      AND pr.activity_id = ANY (current_activity_scope())
      AND p_day BETWEEN c.starts_on AND c.stops_on)
$$;

-- Part visible d'une intervention (B5) : surface des parcelles ciblées visibles
-- sur la surface de toutes ses parcelles ciblées (surface saisie, sinon zone
-- travaillée, sinon surface de la parcelle à la date). 1 sans périmètre ; à
-- défaut de surface, la part en nombre de parcelles. Ne renvoie rien d'autre.
CREATE OR REPLACE FUNCTION fourmy_intervention_scope_share(p_intervention uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Sans périmètre, rien n'est calculé (la branche ELSE n'est pas évaluée).
  SELECT CASE WHEN current_activity_scope() IS NULL THEN 1::numeric ELSE (
    WITH t AS (
      SELECT fourmy_parcel_in_scope_on(ip.ref_id, fourmy_intervention_day(p_intervention)) AS visible,
             coalesce((ip.attrs->>'workedAreaM2')::numeric,
                      CASE WHEN ip.working_zone IS NOT NULL THEN ST_Area(ip.working_zone::geography)::numeric END,
                      (SELECT v.area_m2 FROM land_parcel_versions v
                        WHERE v.land_parcel_id = ip.ref_id
                        ORDER BY (v.valid @> fourmy_intervention_day(p_intervention)::timestamptz) DESC, upper(v.valid) DESC NULLS FIRST
                        LIMIT 1)) AS area
      FROM intervention_parameters ip JOIN interventions i ON i.id = ip.intervention_id
      WHERE ip.intervention_id = p_intervention AND i.farm_id = current_farm_id()
        AND ip.role = 'target' AND ip.ref_type = 'land_parcel'
    )
    SELECT CASE
      WHEN count(*) = 0 THEN 0::numeric
      WHEN bool_and(area IS NOT NULL AND area > 0) THEN sum(area) FILTER (WHERE visible) / sum(area)
      ELSE count(*) FILTER (WHERE visible)::numeric / count(*)
    END
    FROM t
  ) END
$$;

-- Activités, productions, itinéraires techniques, prix d'une activité.
CREATE POLICY activity_scope ON activities AS RESTRICTIVE FOR SELECT TO fourmy_app
  USING (current_activity_scope() IS NULL OR id = ANY (current_activity_scope()));
CREATE POLICY activity_scope ON productions AS RESTRICTIVE FOR SELECT TO fourmy_app
  USING (current_activity_scope() IS NULL OR activity_id = ANY (current_activity_scope()));
CREATE POLICY activity_scope ON technical_itineraries AS RESTRICTIVE FOR SELECT TO fourmy_app
  USING (current_activity_scope() IS NULL OR activity_id = ANY (current_activity_scope()));
-- Prix sans activité (intrants, matériels, main-d'œuvre) : régis par le module seul (API-9).
CREATE POLICY activity_scope ON prices AS RESTRICTIVE FOR SELECT TO fourmy_app
  USING (current_activity_scope() IS NULL OR activity_id IS NULL OR activity_id = ANY (current_activity_scope()));

-- Parcelles et tout ce qui s'y rattache.
CREATE POLICY activity_scope ON land_parcels AS RESTRICTIVE FOR SELECT TO fourmy_app
  USING (current_activity_scope() IS NULL OR id IN (SELECT fourmy_scope_parcels()));
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['land_parcel_versions', 'cover_crops', 'parcel_certifications', 'parcel_nitrate_zones',
                           'parcel_references', 'parcel_rows', 'parcel_soils', 'prescriptions',
                           'remote_sensing_dismissals', 'soil_analyses'] LOOP
    EXECUTE format('CREATE POLICY activity_scope ON %I AS RESTRICTIVE FOR SELECT TO fourmy_app
                    USING (current_activity_scope() IS NULL OR land_parcel_id IN (SELECT fourmy_scope_parcels()))', t);
  END LOOP;
  -- Indices de télédétection : par la version de parcelle (elle-même filtrée).
  FOREACH t IN ARRAY ARRAY['parcel_indices', 'parcel_index_rasters', 'parcel_index_cursors'] LOOP
    EXECUTE format('CREATE POLICY activity_scope ON %I AS RESTRICTIVE FOR SELECT TO fourmy_app
                    USING (current_activity_scope() IS NULL OR EXISTS (SELECT 1 FROM land_parcel_versions v WHERE v.id = land_parcel_version_id))', t);
  END LOOP;
END $$;

-- Fumure : la parcelle, et la production quand le plan en a une.
CREATE POLICY activity_scope ON fertilization_plans AS RESTRICTIVE FOR SELECT TO fourmy_app
  USING (current_activity_scope() IS NULL OR (land_parcel_id IN (SELECT fourmy_scope_parcels())
         AND (production_id IS NULL OR EXISTS (SELECT 1 FROM productions p WHERE p.id = production_id))));
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fertilization_plan_versions', 'fertilization_plan_applications', 'steering_measurements'] LOOP
    EXECUTE format('CREATE POLICY activity_scope ON %I AS RESTRICTIVE FOR SELECT TO fourmy_app
                    USING (current_activity_scope() IS NULL OR EXISTS (SELECT 1 FROM fertilization_plans f WHERE f.id = plan_id))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['prescription_zones', 'prescription_sends'] LOOP
    EXECUTE format('CREATE POLICY activity_scope ON %I AS RESTRICTIVE FOR SELECT TO fourmy_app
                    USING (current_activity_scope() IS NULL OR EXISTS (SELECT 1 FROM prescriptions p WHERE p.id = prescription_id))', t);
  END LOOP;
END $$;

-- Interventions et leurs lignes.
-- Une intervention sans parcelle ciblée (entretien, travaux de cour) n'est pas dans le périmètre (Q2).
CREATE POLICY activity_scope ON interventions AS RESTRICTIVE FOR SELECT TO fourmy_app
  USING (current_activity_scope() IS NULL OR id IN (SELECT t.intervention_id FROM fourmy_scope_targets() t));
-- Lignes d'une intervention visible ; une cible parcelle seulement si elle est du périmètre à la date.
CREATE POLICY activity_scope ON intervention_parameters AS RESTRICTIVE FOR SELECT TO fourmy_app
  USING (current_activity_scope() IS NULL OR (
    intervention_id IN (SELECT t.intervention_id FROM fourmy_scope_targets() t)
    AND (role <> 'target' OR ref_type <> 'land_parcel'
         OR (intervention_id, ref_id) IN (SELECT t.intervention_id, t.parcel_id FROM fourmy_scope_targets() t))));
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['intervention_periods', 'intervention_crews', 'intervention_operations'] LOOP
    EXECUTE format('CREATE POLICY activity_scope ON %I AS RESTRICTIVE FOR SELECT TO fourmy_app
                    USING (current_activity_scope() IS NULL OR intervention_id IN (SELECT t.intervention_id FROM fourmy_scope_targets() t))', t);
  END LOOP;
  -- Relevés de compteur et traces : sans intervention, régis par leur module.
  FOREACH t IN ARRAY ARRAY['meter_readings', 'track_sessions'] LOOP
    EXECUTE format('CREATE POLICY activity_scope ON %I AS RESTRICTIVE FOR SELECT TO fourmy_app
                    USING (current_activity_scope() IS NULL OR intervention_id IS NULL
                           OR intervention_id IN (SELECT t.intervention_id FROM fourmy_scope_targets() t))', t);
  END LOOP;
END $$;

-- Assolement : brouillons et versions sont des instantanés de toutes les
-- activités, non filtrables. Sous périmètre, invisibles ; l'assolement se
-- reconstruit depuis les productions visibles (repos/crop-plans.ts, liveDraft).
-- Même chose pour la filiation des parcelles d'un assolement et le cache des trajets.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crop_plans', 'crop_plan_versions', 'land_parcel_lineage', 'parcel_routes'] LOOP
    EXECUTE format('CREATE POLICY activity_scope ON %I AS RESTRICTIVE FOR SELECT TO fourmy_app USING (current_activity_scope() IS NULL)', t);
  END LOOP;
END $$;

-- Index : productions d'une parcelle par campagne (fonctions ci-dessus).
CREATE INDEX IF NOT EXISTS productions_parcel_campaign ON productions (land_parcel_id, campaign_id);

-- Applicateurs d'un intrant (registre phyto, 0026) : appelée pour chaque ligne
-- du registre. En SECURITY INVOKER, chacun de ses appels réévaluait les
-- politiques du périmètre (1,9 s pour 73 lignes sur la ferme de l'exploitant
-- testeur). Elle lit désormais sans RLS, bornée à la ferme courante ; elle ne
-- renvoie que les intervenants d'une intervention déjà visible dans le registre.
CREATE OR REPLACE FUNCTION fourmy_input_applicators(p_intervention uuid, p_input uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  WITH me AS (
    SELECT i.id, i.staffing FROM interventions i WHERE i.id = p_intervention AND i.farm_id = current_farm_id()
  ),
  crews AS (
    SELECT c.id, c.rank FROM intervention_crews c
    JOIN me i ON i.id = c.intervention_id AND i.staffing = 'crews'
  ),
  by_input AS (
    SELECT c.id FROM crews c
    JOIN intervention_parameters t ON t.crew_id = c.id AND t.role = 'tool'
    JOIN intervention_parameters inp ON inp.id = p_input AND inp.intervention_id = p_intervention AND t.ref_id::text = inp.attrs->>'equipmentId'
    ORDER BY c.rank LIMIT 1
  ),
  sprayers AS (
    SELECT DISTINCT c.id FROM crews c
    JOIN intervention_parameters t ON t.crew_id = c.id AND t.role = 'tool'
    JOIN equipments e ON e.id = t.ref_id
    WHERE e.kind IN ('sprayer', 'self_propelled_sprayer') OR e.avatar->>'template' LIKE '%sprayer%'
  ),
  chosen AS (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM by_input) THEN (SELECT id FROM by_input)
      WHEN (SELECT count(*) FROM sprayers) = 1 THEN (SELECT id FROM sprayers)
      WHEN (SELECT count(*) FROM crews) = 1 THEN (SELECT id FROM crews)
    END AS crew_id
  )
  SELECT coalesce(array_agg(DISTINCT p.name ORDER BY p.name), '{}')
  FROM intervention_parameters d
  JOIN me ON me.id = d.intervention_id
  JOIN people p ON p.id = d.ref_id
  WHERE d.role = 'doer'
    AND ((SELECT crew_id FROM chosen) IS NULL OR d.crew_id = (SELECT crew_id FROM chosen))
$function$;
