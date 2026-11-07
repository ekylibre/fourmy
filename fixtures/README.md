# fixtures/

Jeux de données **anonymisés** servant de référence commune aux agents et à
la CI (NFR-DEV-4).

- Les **exports bruts** d'Ekylibre ne sont **jamais** versionnés ici :
  `fixtures/raw/` est ignoré par git. Ils restent hors du dépôt
  (`~/Documents/ressources_fourmy/old_backup_ekylibre_v5`).
- Le jeu de **démonstration** typé (une petite ferme viti + une parcelle de
  grandes cultures) vit dans `@fourmy/mocks` (`packages/mocks/src/fixtures.ts`)
  et alimente les écrans avant l'API réelle.
- L'agent B produira ici les **fixtures anonymisées** dérivées des vrais
  exports (personnes, tiers et pièces jointes remplacés ; géométries et
  données agronomiques conservées).
