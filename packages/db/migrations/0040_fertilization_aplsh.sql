-- Fertilisation azotée, lot AK (docs/fertilisation-design.md §5.6) :
-- azote potentiellement libéré jusqu'en sortie d'hiver (APLSH).

-- Référence APLSH d'un fertilisant organique : dénomination du COMIFER
-- (tables 13 à 17) ou C/N (tables 7 à 12, avec la part d'azote minéral).
ALTER TABLE article_fertilizers ADD COLUMN aplsh_product text CHECK (length(aplsh_product) <= 120);
ALTER TABLE article_fertilizers ADD COLUMN c_n numeric CHECK (c_n > 0 AND c_n <= 200);

-- Zone climatique des références APLSH ; par défaut, d'après le département.
ALTER TABLE fertilization_settings ADD COLUMN aplsh_zone text
  CHECK (aplsh_zone IN ('bassin_sud_ouest', 'oceanique_altere', 'oceanique_degrade', 'semi_continental', 'montagne'));
