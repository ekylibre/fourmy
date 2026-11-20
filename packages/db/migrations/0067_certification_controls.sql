-- Contrôles HVE et Agriculture biologique, lot CT1 (claudedocs/conception_controle_hve_ab.md §4).
-- Données des règles des lots CT2 à CT5 et suivi des calculs ; aucune règle ici.

-- Productions : cycle (annuel, semi-pérenne, pérenne ; vide = déduit de
-- lexicon_productions.life_years), date de plantation, mode de culture.
ALTER TABLE productions
  ADD COLUMN cycle text CHECK (cycle IN ('annual', 'semi_perennial', 'perennial')),
  ADD COLUMN planted_on date,
  ADD COLUMN cultivation_mode text NOT NULL DEFAULT 'open_field'
    CHECK (cultivation_mode IN ('open_field', 'shelter', 'heated_shelter', 'soilless', 'pot', 'container'));

-- Articles : statut bio (semences, plants, intrants) et semence traitée.
ALTER TABLE articles
  ADD COLUMN organic_status text CHECK (organic_status IN ('organic', 'conversion', 'conventional')),
  ADD COLUMN seed_treated boolean;

-- Fertilisants : catégories de l'annexe II du règlement (UE) 2021/1165, origine d'un effluent.
ALTER TABLE article_fertilizers
  ADD COLUMN ab_categories text[],
  ADD COLUMN effluent_origin text CHECK (effluent_origin IN ('organic', 'conventional', 'industrial', 'unknown'));

-- Interventions : constats de certification de la saisie (comme compliance et
-- nitrate_check) et justification d'un traitement (AB, annexe II partie I 1.10.2).
ALTER TABLE interventions
  ADD COLUMN certification_check jsonb,
  ADD COLUMN justification text CHECK (length(justification) <= 2000);

-- Éléments du paysage : type d'IAE HVE validé par l'exploitant, mitoyenneté.
ALTER TABLE farm_landscape_features
  ADD COLUMN hve_type text,
  ADD COLUMN hve_validated_at timestamptz,
  ADD COLUMN hve_shared boolean NOT NULL DEFAULT false;

-- Réglages des contrôles : période HVE, méthode, rotation AB, notification Agence Bio.
ALTER TABLE farm_settings ADD COLUMN certification jsonb;

-- Questionnaire HVE annuel (items déclaratifs) ; pièces jointes dans regulatory_documents.
CREATE TABLE hve_questionnaires (
  farm_id    uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  campaign   int  NOT NULL CHECK (campaign BETWEEN 2000 AND 2100),
  answers    jsonb NOT NULL DEFAULT '{}',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, campaign)
);

-- Dérogations semences AB accordées par l'organisme certificateur.
CREATE TABLE seed_derogations (
  id          uuid PRIMARY KEY,
  farm_id     uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  species     text NOT NULL CHECK (length(species) BETWEEN 1 AND 120),
  variety     text CHECK (length(variety) <= 120),
  article_id  uuid REFERENCES articles(id) ON DELETE SET NULL,
  granted_on  date NOT NULL,
  season      int  NOT NULL CHECK (season BETWEEN 2000 AND 2100),
  quantity    numeric CHECK (quantity IS NULL OR quantity > 0),
  unit        text,
  reference   text CHECK (length(reference) <= 120),
  certifier   text CHECK (length(certifier) <= 120),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seed_derogations_farm ON seed_derogations (farm_id, season);

-- Calculs de contrôle d'une campagne : résultat, version des référentiels,
-- empreinte des données lues (recalcul si elles changent), export.
CREATE TABLE certification_runs (
  id            uuid PRIMARY KEY,
  farm_id       uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('hve', 'ab')),
  campaign      int  NOT NULL CHECK (campaign BETWEEN 2000 AND 2100),
  computed_at   timestamptz NOT NULL DEFAULT now(),
  refs_version  text NOT NULL,
  data_hash     text NOT NULL,
  result        jsonb NOT NULL,
  exported_at   timestamptz,
  exported_by   uuid,
  export_sha256 text
);
CREATE INDEX certification_runs_farm ON certification_runs (farm_id, kind, campaign, computed_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hve_questionnaires', 'seed_derogations', 'certification_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY farm_isolation ON %I USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fourmy_app', t);
  END LOOP;
END $$;

-- Pièces du questionnaire HVE (ruches, test bêche…).
ALTER TABLE regulatory_documents DROP CONSTRAINT regulatory_documents_owner_type_check;
ALTER TABLE regulatory_documents ADD CONSTRAINT regulatory_documents_owner_type_check
  CHECK (owner_type IN ('plan', 'soil_analysis', 'water_source', 'product_analysis', 'cover_crop', 'steering', 'hve_questionnaire'));
