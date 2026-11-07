-- Correctif du registre phyto : la jointure sur `productions` prenait toutes
-- les productions de la parcelle (toutes campagnes) et dupliquait les lignes.
-- On ne retient que la production de la campagne de l'intervention.
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
  inp.unit
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
