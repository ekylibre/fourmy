-- Fertilisation azotée, lot AI (docs/fertilisation-design.md §5.4) :
-- contrôle nitrates enregistré avec l'intervention, couverts d'interculture,
-- justificatifs.

-- Résultat du contrôle nitrates à l'enregistrement (calendrier, plan,
-- premier apport) et motif d'un passage outre : { level, indicators, reason, checkedAt }.
ALTER TABLE interventions ADD COLUMN nitrate_check jsonb;

-- Couvert d'interculture qui précède la culture principale d'une campagne
-- (cahier d'enregistrement, MrCi et Ri du plan de fumure).
CREATE TABLE cover_crops (
  id               uuid PRIMARY KEY,
  farm_id          uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  land_parcel_id   uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  -- Campagne de la culture principale qui suit le couvert.
  campaign         int NOT NULL CHECK (campaign BETWEEN 2000 AND 2100),
  family           text NOT NULL CHECK (family IN ('cruciferes', 'graminees_seigle_avoine', 'graminees_ray_grass', 'legumineuses',
                                                   'hydrophyllacees', 'melange_graminees_legumineuses', 'melange_cruciferes_legumineuses')),
  species          text NOT NULL CHECK (length(species) BETWEEN 1 AND 200),
  sown_on          date NOT NULL,
  destroyed_on     date CHECK (destroyed_on IS NULL OR destroyed_on >= sown_on),
  -- CIE (exporté : récolté, fauché, pâturé) ou CINE (non exporté).
  exported         boolean NOT NULL DEFAULT false,
  biomass          text CHECK (biomass IN ('le_1', '1_3', 'ge_3')),
  destruction_mode text CHECK (destruction_mode IN ('mechanical', 'chemical', 'frost', 'harvest', 'grazing')),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (land_parcel_id, campaign)
);

-- Justificatifs tenus à disposition de l'administration (5 campagnes au moins) :
-- sortie d'un outil de calcul, analyse de laboratoire, mesure d'eau…
CREATE TABLE regulatory_documents (
  id            uuid PRIMARY KEY,
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  owner_type    text NOT NULL CHECK (owner_type IN ('plan', 'soil_analysis', 'water_source', 'product_analysis', 'cover_crop')),
  owner_id      uuid NOT NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  content_type  text NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size          int NOT NULL CHECK (size > 0 AND size <= 10485760),
  bytes         bytea NOT NULL,
  uploaded_by   uuid,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX regulatory_documents_owner ON regulatory_documents (farm_id, owner_type, owner_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cover_crops', 'regulatory_documents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;
