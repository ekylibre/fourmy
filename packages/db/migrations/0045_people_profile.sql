-- Équipe et personnes, lot P1 (docs/equipe-personnes-design.md §2) : la
-- personne porte l'identité, la photo et le Certiphyto ; ses données
-- personnelles sont à part (person_private), lues seulement par le
-- responsable et par la personne elle-même ; rôle « Lecture seule ».

ALTER TABLE people
  ADD COLUMN first_name text CHECK (length(first_name) <= 80),
  ADD COLUMN last_name text CHECK (length(last_name) <= 80),
  ADD COLUMN certiphyto_category text CHECK (certiphyto_category IN
    ('decideur_entreprise', 'decideur_prestation', 'operateur', 'conseil', 'vente')),
  ADD COLUMN certiphyto_number text CHECK (length(certiphyto_number) <= 40),
  ADD COLUMN certiphyto_valid_until date,
  ADD COLUMN external_ids jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Photo : octets en base, comme les logos des matériels.
CREATE TABLE person_photos (
  id         uuid PRIMARY KEY,
  farm_id    uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg')),
  bytes      bytea NOT NULL,
  size       integer NOT NULL CHECK (size > 0 AND size <= 2097152),
  sha256     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE people ADD COLUMN photo_id uuid REFERENCES person_photos(id) ON DELETE SET NULL;

-- Données personnelles : jamais lues par les requêtes qui lisent `people`.
CREATE TABLE person_private (
  person_id           uuid PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  farm_id             uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  email               text CHECK (length(email) <= 254),
  mobile              text CHECK (mobile ~ '^[0-9 +().-]{4,30}$'),
  address_line1       text CHECK (length(address_line1) <= 120),
  address_line2       text CHECK (length(address_line2) <= 120),
  postal_code         text CHECK (length(postal_code) <= 12),
  city                text CHECK (length(city) <= 80),
  country             text CHECK (country ~ '^[A-Z]{2}$'),
  birth_date          date,
  contract_type       text CHECK (contract_type IN
    ('farmer', 'permanent', 'fixed_term', 'seasonal', 'apprentice', 'volunteer', 'contractor')),
  contract_started_on date,
  contract_ended_on   date,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (contract_started_on IS NULL OR contract_ended_on IS NULL OR contract_started_on <= contract_ended_on)
);

ALTER TABLE person_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON person_photos
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON person_photos TO fourmy_app;

ALTER TABLE person_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_private FORCE ROW LEVEL SECURITY;
CREATE POLICY farm_isolation ON person_private
  USING (farm_id = current_farm_id()) WITH CHECK (farm_id = current_farm_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON person_private TO fourmy_app;

-- Rôle « Lecture seule » (conseiller, technicien, comptable).
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'worker', 'reader'));

-- Un compte, une personne par ferme : les doublons gardent la plus ancienne.
UPDATE people p SET user_id = NULL, updated_at = now()
WHERE p.user_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM people o
  WHERE o.farm_id = p.farm_id AND o.user_id = p.user_id
    AND (o.created_at, o.id) < (p.created_at, p.id));
CREATE UNIQUE INDEX people_farm_user_uq ON people (farm_id, user_id) WHERE user_id IS NOT NULL;

-- Tout membre a une personne : on crée celles qui manquent.
INSERT INTO people (id, farm_id, name, user_id, active)
SELECT gen_random_uuid(), m.farm_id,
       coalesce(nullif(btrim(u.name), ''), split_part(u.email, '@', 1)), m.user_id, true
FROM memberships m JOIN users u ON u.id = m.user_id
WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.farm_id = m.farm_id AND p.user_id = m.user_id);
