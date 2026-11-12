#!/bin/sh
# Recale les horodatages d'une intervention de la copie vidéo sur l'heure de la scène.
# usage : retime.sh <intervention_id> <horodatage ISO UTC, ex. 2026-04-16T05:12:00Z>
id=$1; at=$2
PGPASSWORD=fourmy psql -h localhost -p 5434 -U fourmy fourmy_video -Atc "
UPDATE interventions SET
  compliance = CASE WHEN compliance IS NULL THEN NULL ELSE regexp_replace(compliance::text, '\"checkedAt\": \"2026-11-1[0-9]T[^\"]*\"', '\"checkedAt\": \"$at\"', 'g')::jsonb END,
  nitrate_check = CASE WHEN nitrate_check IS NULL THEN NULL ELSE regexp_replace(nitrate_check::text, '\"checkedAt\": \"2026-11-1[0-9]T[^\"]*\"', '\"checkedAt\": \"$at\"', 'g')::jsonb END,
  ift = CASE WHEN ift IS NULL THEN NULL ELSE regexp_replace(ift::text, '\"computedAt\": \"2026-11-1[0-9]T[^\"]*\"', '\"computedAt\": \"$at\"', 'g')::jsonb END,
  created_at = LEAST(created_at, '$at'::timestamptz), updated_at = '$at'
WHERE id = '$id' RETURNING jsonb_path_query_array(compliance,'strict \$.**.checkedAt'), created_at"
# Historique : la création garde l'heure de création, les suivantes s'échelonnent d'une minute jusqu'à l'heure de la scène.
PGPASSWORD=fourmy psql -h localhost -p 5434 -U fourmy fourmy_video -Atc "
WITH r AS (SELECT id, row_number() OVER (ORDER BY at DESC) - 1 AS back, action FROM audit_log WHERE entity_id = '$id' AND at > '2026-11-01')
UPDATE audit_log a SET at = CASE WHEN r.action = 'planned' OR r.action = 'created'
  THEN (SELECT created_at FROM interventions WHERE id = '$id') ELSE '$at'::timestamptz - r.back * interval '1 minute' END
FROM r WHERE a.id = r.id RETURNING a.action, a.at"
