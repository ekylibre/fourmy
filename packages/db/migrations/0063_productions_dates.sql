-- Productions datées (lot IM2, claudedocs/conception_import_onboarding.md §5.2) :
-- une parcelle peut porter plusieurs cultures la même campagne (culture
-- principale, puis dérobée). La culture contrôlée à une date (usages E-Phy,
-- IFT, registre, fertilisation) est celle qui est en place ce jour-là, et non
-- plus « une » production de la campagne prise au hasard.

ALTER TABLE productions
  ADD COLUMN started_on date,
  ADD COLUMN stopped_on date,
  ADD CONSTRAINT productions_dates CHECK (stopped_on IS NULL OR started_on IS NULL OR stopped_on >= started_on);

-- La production d'une parcelle à une date, dans l'ordre :
--   1. une production datée en place ce jour-là (début ≤ jour ≤ fin) ;
--   2. une production non datée de la campagne du jour ;
--   3. une production datée de la campagne du jour, même hors de ses dates
--      (avant le semis, après la récolte : comportement d'avant).
-- À rang égal : celle qui a une activité, puis la plus récemment semée.
-- Les productions déclarées (historique importé) ne comptent pas.
CREATE FUNCTION fourmy_production_at(parcel uuid, day date) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT p.id
  FROM productions p JOIN campaigns c ON c.id = p.campaign_id
  WHERE p.land_parcel_id = parcel AND NOT p.declared
    AND ((p.started_on IS NOT NULL AND day BETWEEN p.started_on AND coalesce(p.stopped_on, 'infinity'::date))
         OR day BETWEEN c.starts_on AND c.stops_on)
  ORDER BY (p.started_on IS NOT NULL AND day BETWEEN p.started_on AND coalesce(p.stopped_on, 'infinity'::date)) DESC,
           (p.started_on IS NULL) DESC,
           (p.activity_id IS NULL),
           p.started_on DESC NULLS LAST,
           p.id
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION fourmy_production_at(uuid, date) TO fourmy_app;
