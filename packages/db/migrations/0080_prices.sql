-- Assolement, temps 3, lot E1 (claudedocs/conception_assolement_eco.md §2.1) :
-- prix de la ferme, datés et sourcés. Changer un prix ajoute une ligne
-- (date d'effet) ; l'ancien reste, pour refaire un calcul passé avec les
-- prix de l'époque. Montants HT, en euros, par unité.

CREATE TABLE prices (
  id           uuid PRIMARY KEY,
  farm_id      uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('article', 'labour', 'equipment', 'service', 'product')),
  article_id   uuid REFERENCES articles(id) ON DELETE CASCADE,
  equipment_id uuid REFERENCES equipments(id) ON DELETE CASCADE,
  activity_id  uuid REFERENCES activities(id) ON DELETE CASCADE,
  -- Produit vendu d'une activité (« grain », « paille ») ; plusieurs produits par activité (FR-AS-32).
  product      text CHECK (length(btrim(product)) BETWEEN 1 AND 60),
  -- Prestation (ETA) par procédure.
  procedure    text CHECK (length(procedure) <= 80),
  unit         text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 40),
  amount       numeric NOT NULL CHECK (amount >= 0 AND amount < 100000000),
  valid_from   date NOT NULL,
  source       text NOT NULL CHECK (source IN ('farm', 'lexicon', 'bcma', 'agrifood', 'purchase')),
  source_ref   text CHECK (length(source_ref) <= 200),
  source_date  date,
  note         text CHECK (length(note) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  CHECK ((kind = 'article') = (article_id IS NOT NULL)),
  CHECK ((kind = 'equipment') = (equipment_id IS NOT NULL)),
  CHECK ((kind = 'product') = (activity_id IS NOT NULL AND product IS NOT NULL)),
  CHECK ((kind = 'service') = (procedure IS NOT NULL)),
  CHECK (kind <> 'labour' OR (article_id IS NULL AND equipment_id IS NULL AND activity_id IS NULL AND procedure IS NULL))
);
-- Prix en vigueur : dernière date d'effet par clé.
CREATE INDEX prices_key ON prices (farm_id, kind, coalesce(article_id, equipment_id, activity_id), product, procedure, valid_from DESC);

ALTER TABLE prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON prices USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON prices TO fourmy_app;
