-- Certifications et cahiers des charges des parcelles (retours de test du
-- 08/11/2026, 15 h 32) : AB (et conversion), HVE 1 à 3, AOP/AOC, IGP, Label
-- Rouge, STG, GLOBALG.A.P., Rainforest Alliance, autre ; chacune avec son
-- début et sa fin. Une parcelle AB à la date d'un traitement n'admet que des
-- produits utilisables en agriculture biologique (E-Phy).

CREATE TABLE parcel_certifications (
  id              uuid PRIMARY KEY,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  land_parcel_id  uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN (
                    'organic', 'hve', 'aop', 'igp', 'label_rouge', 'stg', 'globalgap', 'rainforest', 'other')),
  -- AB : « conversion » ou « certified » ; HVE : « 1 », « 2 », « 3 » ; sinon libre.
  level           text,
  -- Nom du signe ou du cahier des charges (« AOC Bordeaux », « IGP Pays d'Oc »…).
  label           text,
  -- Organisme certificateur, n° de certificat.
  certifier       text,
  reference       text,
  started_on      date NOT NULL,
  stopped_on      date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (stopped_on IS NULL OR stopped_on >= started_on)
);
CREATE INDEX parcel_certifications_parcel ON parcel_certifications (land_parcel_id, started_on);
ALTER TABLE parcel_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcel_certifications FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON parcel_certifications
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON parcel_certifications TO fourmy_app;
