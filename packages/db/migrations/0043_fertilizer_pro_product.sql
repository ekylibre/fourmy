-- Fertilisation azotée, lot AO (docs/fertilisation-design.md §5.10) : ligne de
-- l'annexe 5 du référentiel régional (valeurs de référence et Keq) qui
-- correspond à un fertilisant organique de la ferme.
ALTER TABLE article_fertilizers ADD COLUMN pro_product text CHECK (length(pro_product) <= 120);
