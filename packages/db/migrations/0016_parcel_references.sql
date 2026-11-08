-- Parcelles (retours de test du 08/11/2026, 15 h 32, lot H) : création depuis
-- la carte comme l'identificateur de parcelle de Lexicon, références PAC
-- (RPG) et cadastrales gardées dans Fourmy (disponibles hors connexion).

-- Codes culture de la PAC → libellé et production de référence (Lexicon,
-- paquet `productions`) : propose l'activité d'une parcelle PAC.
CREATE TABLE lexicon_cap_codes (
  cap_code    text NOT NULL,
  cap_label   text NOT NULL,
  production  text NOT NULL,
  is_seed     boolean NOT NULL DEFAULT false,
  year        integer NOT NULL,
  PRIMARY KEY (cap_code, production, year)
);
GRANT SELECT ON lexicon_cap_codes TO fourmy_app;

-- Références d'une parcelle : parcelles cadastrales qu'elle recoupe,
-- parcelles PAC (RPG) au même endroit, campagne par campagne.
CREATE TABLE parcel_references (
  id              uuid PRIMARY KEY,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  land_parcel_id  uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('cadastre', 'cap')),
  ref             text NOT NULL,               -- IDU cadastral, ou identifiant RPG
  year            integer NOT NULL DEFAULT 0,  -- campagne PAC ; 0 pour le cadastre
  label           text,                        -- « ZA 0001 Saint-Porchaire », « Tournesol »
  code            text,                        -- code culture PAC
  area_m2         double precision,            -- contenance, ou surface déclarée
  overlap_m2      double precision,            -- surface commune avec la parcelle
  attrs           jsonb,
  geom            geometry(MultiPolygon, 4326),
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (land_parcel_id, kind, ref, year)
);
CREATE INDEX parcel_references_parcel ON parcel_references (land_parcel_id, kind);
ALTER TABLE parcel_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcel_references FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON parcel_references
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON parcel_references TO fourmy_app;

-- Rechargé avec la table des codes PAC.
DELETE FROM lexicon_packages WHERE name = 'productions';
