# fixtures/

Jeux de données **anonymisés** servant de référence commune aux agents et à
la CI (NFR-DEV-4).

| Fichier | Origine | Contenu |
|---|---|---|
| `pilote-grandes-cultures.json` | export Ekylibre 5.0 (ferme pilote grandes cultures) | 12 campagnes, 162 parcelles, 588 interventions (603 périodes de travail), 610 mouvements de stock |
| `pilote-viticulture.json` | export Ekylibre 4.37 (ferme pilote viticole) | 9 parcelles de vigne, chai, 9 cuves, réceptions de vendange |

## Anonymisation

- Noms de ferme, parcelles, bâtiments, matériels et codes de lots remplacés.
- **Tous les identifiants remappés** (UUID v5 propres à la fixture), sans lien
  avec les identifiants dérivés des instances d'origine.
- Personnes : seuls les intervenants sont migrés, par leur nom, remplacé
  ici par « Personne N ».
- **Conservés** (décision du 2026-11-07) : géométries (alignées au
  micro-degré), données agronomiques, noms commerciaux des intrants, dates.

## Usage

- Chargement : `loadFixture(sql, fixture)` de `@fourmy/db` (idempotent, suivi
  d'un `ANALYZE`).
- Chaque fichier embarque ses **valeurs attendues** (`meta.expected` :
  volumes, lignes du registre phyto par année). La CI les vérifie sous RLS
  (`packages/db/test/fixtures.integration.test.ts`).
- Régénération depuis une ferme migrée :
  `node packages/migrator-ekylibre/dist/export-fixture.js --farm <uuid> --label <libellé> --out fixtures/<fichier>.json`

Les **exports bruts** ne sont jamais versionnés (`fixtures/raw/` est ignoré) ;
ils restent hors du dépôt. Le petit jeu de démonstration typé des mocks vit
dans `@fourmy/mocks`.
