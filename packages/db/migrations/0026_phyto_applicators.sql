-- Applicateur du registre phytosanitaire, lot R1 (docs/parcours-attelages.md
-- FR-ATT-12, design §2.5 et §4.4). Réplique SQL d'`applicatorsOf`
-- (@fourmy/domain), testée sur les mêmes cas :
--  1. mode libre : tous les intervenants ;
--  2. attelages : celui qui contient le matériel saisi sur l'intrant ;
--  3. sinon l'unique attelage qui porte un pulvérisateur ;
--  4. sinon l'attelage s'il n'y en a qu'un ;
--  5. sinon tous les intervenants (applicateur ambigu).
-- Un attelage retenu sans intervenant donne '{}' : applicateur non renseigné.
-- Rend les noms des personnes, triés.

CREATE FUNCTION fourmy_input_applicators(p_intervention uuid, p_input uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH crews AS (
    SELECT c.id, c.rank FROM intervention_crews c
    JOIN interventions i ON i.id = c.intervention_id AND i.staffing = 'crews'
    WHERE c.intervention_id = p_intervention
  ),
  by_input AS (
    SELECT c.id FROM crews c
    JOIN intervention_parameters t ON t.crew_id = c.id AND t.role = 'tool'
    JOIN intervention_parameters inp ON inp.id = p_input AND t.ref_id::text = inp.attrs->>'equipmentId'
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
  JOIN people p ON p.id = d.ref_id
  WHERE d.intervention_id = p_intervention AND d.role = 'doer'
    AND ((SELECT crew_id FROM chosen) IS NULL OR d.crew_id = (SELECT crew_id FROM chosen))
$$;

-- Registre : même définition que 0003, plus la colonne `applicators` (en fin,
-- pour que CREATE OR REPLACE l'accepte).
CREATE OR REPLACE VIEW phyto_register AS
SELECT
  i.farm_id,
  i.id                        AS intervention_id,
  i.stopped_at                AS done_at,
  lp.name                     AS parcel_name,
  lpv.area_m2,
  prod.species                AS crop,
  a.name                      AS product_name,
  a.amm,
  inp.quantity,
  inp.unit,
  fourmy_input_applicators(i.id, inp.id) AS applicators
FROM interventions i
JOIN intervention_parameters tgt
  ON tgt.intervention_id = i.id AND tgt.role = 'target' AND tgt.ref_type = 'land_parcel'
JOIN land_parcels lp
  ON lp.id = tgt.ref_id
JOIN land_parcel_versions lpv
  ON lpv.land_parcel_id = lp.id
 AND lpv.valid @> coalesce(i.stopped_at, now())
JOIN intervention_parameters inp
  ON inp.intervention_id = i.id AND inp.role = 'input' AND inp.ref_type = 'article'
JOIN articles a
  ON a.id = inp.ref_id AND a.kind = 'phyto'
LEFT JOIN LATERAL (
  SELECT p.species FROM productions p
  JOIN campaigns c ON c.id = p.campaign_id
  WHERE p.land_parcel_id = lp.id
    AND c.year = extract(year FROM coalesce(i.stopped_at, now()))::int
  ORDER BY p.id LIMIT 1
) prod ON true
WHERE i.status = 'done';

ALTER VIEW phyto_register SET (security_invoker = true);
