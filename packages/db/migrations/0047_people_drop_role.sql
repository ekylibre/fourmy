-- Équipe et personnes, lot P5 (docs/equipe-personnes-design.md §2.2) : le rôle
-- libre des personnes (« tractoriste »…) n'est plus saisi ni affiché depuis
-- le lot P1 ; le rôle sur la ferme est celui du compte (memberships).
ALTER TABLE people DROP COLUMN role;
