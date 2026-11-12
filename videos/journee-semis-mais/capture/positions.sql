-- Semis mis en scène sur Lespourcy (copie fourmy_video) : passages de 4,5 m en aller-retour
-- le long du grand axe, un point toutes les 2 s (≈ 7 km/h), à partir de 9 h 15 (heure de Paris).
BEGIN;
DELETE FROM positions WHERE binding_id = 'b21c9151-f1ba-4d83-a414-44e4b3e8b8b1'
  AND time >= '2026-04-16 05:00Z' AND time < '2026-04-16 12:00Z';
WITH shape AS (
  SELECT ST_Transform(v.shape, 2154) AS g FROM land_parcel_versions v
  WHERE v.land_parcel_id = '3a7cb748-4cbc-58b0-b7b7-2dac6d5afd0a' AND v.valid @> '2026-04-16'::timestamptz
), env AS (
  SELECT g, ST_Centroid(g) AS c, ST_ExteriorRing(ST_OrientedEnvelope(g)) AS r FROM shape
), axis AS (  -- angle du grand côté de l'enveloppe orientée
  SELECT g, c, CASE WHEN ST_Distance(ST_PointN(r,1), ST_PointN(r,2)) >= ST_Distance(ST_PointN(r,2), ST_PointN(r,3))
         THEN ST_Azimuth(ST_PointN(r,1), ST_PointN(r,2)) ELSE ST_Azimuth(ST_PointN(r,2), ST_PointN(r,3)) END AS az FROM env
), rot AS (  -- parcelle tournée : passages horizontaux
  SELECT c, az, ST_Rotate(g, az - pi()/2, c) AS rg FROM axis
), passes AS (
  SELECT k, ST_Intersection(rg, ST_SetSRID(ST_MakeLine(ST_MakePoint(ST_XMin(rg)-10, ST_YMin(rg)+2.25+k*4.5), ST_MakePoint(ST_XMax(rg)+10, ST_YMin(rg)+2.25+k*4.5)), 2154)) AS seg, c, az
  FROM rot, generate_series(0, floor((ST_YMax(rg)-ST_YMin(rg)-2.25)/4.5)::int) k
), pieces AS (  -- morceaux d'un passage, dans le sens du passage (alterné)
  SELECT p.k, d.path[1] AS n, CASE WHEN p.k % 2 = 0 THEN d.geom ELSE ST_Reverse(d.geom) END AS l, p.c, p.az
  FROM passes p, ST_Dump(ST_CollectionExtract(p.seg, 2)) d
), ordered AS (
  SELECT k, l, c, az, row_number() OVER (ORDER BY k, CASE WHEN k % 2 = 0 THEN ST_XMin(l) ELSE -ST_XMax(l) END) AS o FROM pieces
), pts AS (
  SELECT o, d.path[1] AS j, ST_Rotate(d.geom, -(az - pi()/2), c) AS p
  FROM ordered, ST_DumpPoints(ST_Segmentize(l, 3.9)) d
), seq AS (
  SELECT p, row_number() OVER (ORDER BY o, j) - 1 AS i FROM pts
)
INSERT INTO positions (farm_id, binding_id, time, point, speed, heading, attrs)
SELECT 'a94afd36-5aea-520f-b55f-60457f8a31e8', 'b21c9151-f1ba-4d83-a414-44e4b3e8b8b1',
       '2026-04-16 07:15:02Z'::timestamptz + i * interval '2 seconds', ST_Transform(p, 4326), 7, NULL,
       '{"tool": "Monosem NG+3", "widthM": 4.5, "working": true}'
FROM seq;
WITH p AS (SELECT time, point::geography g, lag(point::geography) OVER (ORDER BY time) l FROM positions
           WHERE binding_id = 'b21c9151-f1ba-4d83-a414-44e4b3e8b8b1' AND time::date = '2026-04-16')
SELECT count(*) AS points, round(sum(ST_Distance(g,l))) AS metres, round(max(ST_Distance(g,l))) AS saut_max, max(time) AS fin FROM p;
COMMIT;
