# Semences — plan de réalisation

*Plan du 20/11/2026, d'après [`besoins_semences.md`](besoins_semences.md) et [`conception_semences.md`](conception_semences.md). Exécution lot par lot avec `/sc:implement`.*

## 1. Règles communes

- **Une branche et une PR par lot**, partie de `main` : `feat/seeds-se<n>-…`. On ne pousse et on n'ouvre de PR qu'après accord.
- **Avant chaque push** :

  ```
  NODE_OPTIONS=--no-experimental-webstorage DATABASE_URL=postgres://fourmy:fourmy@localhost:5434/fourmy FOURMY_LEXICON_PACKAGES_URL=off corepack pnpm turbo run typecheck lint test --continue
  ```

  On y ajoute l'e2e Playwright pour les lots qui touchent l'interface. Pas de prettier.
- **Migrations numérotées à la suite** : 0075, puis 0076 si besoin.
- **Données de testeurs** : jeux anonymisés (« ferme pilote ») ; aucun fichier réel ni identifiant dans le dépôt.
- **Chaque lot met à jour la section « Réalisé » de ce plan.** La documentation utilisateur (`docs/semences.md`) arrive au lot SE8, enrichie au fil des lots.

## 2. Enchaînement

```mermaid
flowchart LR
  SE1[SE1 Socle] --> SE2[SE2 Référentiels]
  SE1 --> SE3[SE3 Page et fiche]
  SE2 --> SE4[SE4 Catalogue GNIS, rattachement]
  SE3 --> SE4
  SE3 --> SE5[SE5 Conversions des semis]
  SE5 --> SE6[SE6 Mélanges et couverts]
  SE5 --> SE7[SE7 Utilisation par campagne]
  SE4 --> SE8[SE8 Recette et doc]
  SE6 --> SE8
  SE7 --> SE8
```

- SE2 et SE3 peuvent avancer en parallèle après SE1, de même que SE6 et SE7 après SE5.
- **Licence des repères de PMG** : accord du 20/11/2026 pour reprendre les repères d'Arvalis et de Terres Inovia, avec leur source. Le module des repères est rempli en SE2.

## 3. Lots

### SE1 — Socle : données et domaine (taille M)

**But** : le modèle et les règles de calcul, sans interface.

- Migration 0075 :
  - tables `article_seeds` et `seed_mixture_components`, avec RLS sur le modèle d'`article_fertilizers` et contraintes CHECK ;
  - colonnes `cover_crops.sowing_intervention_id` et `cover_crops.components`.
- Contrat `packages/contracts/src/seeds.ts` :
  - fiche, composant, PMG d'un lot (`lots.attrs.seed`) ;
  - `seedConversion` et `mixture` des attributs d'un intrant ;
  - repères (`SeedFlag`).
- Domaine `packages/domain/src/seeds/` :
  - `units.ts` : `parseSeedUnit`, `convertSeedQuantity`, `seedUnitChoices`, `seedEquivalents` ;
  - `tgw.ts` : `resolveTgw`, `tgwWarning` ;
  - `flags.ts` : `seedFlags`, `looksLikeMixture`.
- `toStockQuantity` accepte `seed` et `grain_per_square_meter`. Ce n'est pas encore branché sur les interventions.

**Tests** :
- les 10 libellés d'unité observés ;
- l'exemple maïs (9 grains/m² → 90 000 grains/ha → 1,8 dose/ha → 27 kg/ha) ;
- refus sans PMG ;
- ordre lot → article → repère ;
- seuil de 30 % ;
- repères ;
- RLS des deux tables (intégration).

**Fini quand** : migration appliquée sur la base locale ; turbo vert.

### SE2 — Référentiels (taille S)

**But** : le catalogue GNIS et les repères dans la base.

- `packages/lexicon/src/load.ts` : paquet `seed_varieties` (`ifPublished`), table `lexicon_seed_varieties` (migration 0075 ou 0076), index sur `lower(variety_name)` et `species`.
- Fonction utilitaire `isLegume(species)` sur `taxonomy` (ancêtre `fabaceae`), dans le repo, avec un cache.
- `certification-refs/src/agronomy/thousand-grain-weight.ts` : structure `{ species, typicalG, minG, maxG, source, url }`, vide ou limitée aux sources vérifiées ; `REFS_VERSION` relevée.

**Tests** : chargement avec des fixtures réduites (`packages/lexicon/test`), `isLegume` (trèfle, vesce, féverole oui ; avoine non).

**Fini quand** : `lexicon:sync` local charge les 21 592 variétés, et « Thermidor » se trouve en SQL.

### SE3 — Page Semences et fiche (taille L)

**But** : FR-SE-1 à 9 ; consulter et compléter ses semences.

- API `routes/seeds.ts` et `repos/seeds.ts` :
  - `GET /seeds` : stock à la date, nombre d'interventions de la campagne, PMG retenu, repères ;
  - `GET` et `PUT /articles/:id/seed`, avec la garde sur l'unité canonique (facteur 1 seulement) ;
  - `PUT /lots/:id/seed`.
- Web :
  - entrée de menu et route `seeds` ;
  - `SeedsPage` : colonnes choisies, filtres, badges « Compléter » ;
  - `SeedSheet` en tiroir : identité, conditionnement, PMG avec repère et écart, lots, interventions par campagne ; lecture seule hors responsable.
- Le statut bio et le traitement se modifient sur la fiche ; un lien mène à l'onglet Semences du contrôle AB.

**Tests** :
- API : liste, fiche, écriture réservée au responsable, PMG de lot, refus d'un changement d'unité non neutre ;
- web : liste, filtres, tiroir ;
- e2e : ouvrir la page et compléter un PMG.

**Fini quand** : sur la ferme pilote locale, les semences s'affichent avec leurs repères et un PMG saisi apparaît dans la liste.

### SE4 — Catalogue GNIS et rattachement (taille M)

**But** : FR-SE-10 à 12, 28 et 29.

- API :
  - `GET /seeds/catalog?q=` : 20 résultats avec espèce, repère de PMG, unité proposée, attribution SEMAE ;
  - `POST /seeds` (catalogue ou saisie libre) ;
  - `GET /seeds/:id/suggestions`.
- Web : `AddSeedModal` (recherche, saisie libre), action « Rattacher » depuis les repères.
- `import-apply.ts` : fiche créée pour chaque semence importée (code GNIS → catalogue → espèce ; `custom.species` → taxonomie ; « Mélange » → `is_mixture`).
- CLI `seeds:attach --farm <id> [--dry-run]` : applique les rattachements sûrs (code GNIS trouvé au catalogue).

**Tests** :
- API : recherche, création, suggestions ;
- import Geofolia et DAPLOS (fixtures existantes) : fiches créées avec l'espèce ;
- CLI en `--dry-run`.

**Fini quand** : « Thermidor » s'ajoute depuis le catalogue, et `seeds:attach` rattache les semences de la ferme pilote (aperçu, puis application).

### SE5 — Conversions des semis (taille L)

**But** : FR-SE-17 à 23 ; saisir un semis dans l'unité du métier.

- `repos/interventions.ts` :
  - validation des unités de semence (422 avec motif) ;
  - lot choisi **avant** la conversion ;
  - `resolveTgw` sur le lot, puis `toStockQuantity` avec `seed` ;
  - écriture de `attrs.seedConversion`.
- Interventions importées : conversion calculée seulement à l'affichage.
- Web :
  - `InterventionForm` : unités de `seedUnitChoices`, ligne d'équivalence pendant la frappe ;
  - `SeedLine` sur la fiche d'intervention, avec « estimée » quand le PMG vient du repère.
- Synchronisation : champ `seed` sur les articles semence (`repos/sync.ts`).

**Tests** :
- intégration :
  - maïs semé en grains/m², stock en doses ;
  - kg/ha vers un stock en milliers ;
  - refus sans PMG ;
  - PMG du lot prioritaire ;
  - conversion figée après une correction du PMG ;
  - non-régression des stocks d'engrais et de phyto (tests existants) ;
- web : choix d'unités, ligne d'équivalence ;
- e2e : semis en grains/m² et densité lue sur la fiche.

**Fini quand** : la fiche de l'intervention de la capture (maïs de la ferme pilote) affiche grains/m² et kg/ha, et le stock baisse dans l'unité de l'article.

### SE6 — Mélanges et couverts (taille M)

**But** : FR-SE-13 à 16, S7.

- API : `PUT /articles/:id/seed/components` ; validation d'un intrant mélange (`attrs.mixture`, somme égale à la quantité, à 0,01 près) ; doses du dernier semis proposées.
- Couverts :
  - à la validation d'un semis réalisé, rattachement au couvert existant de la parcelle (`sowing_intervention_id`, `components`) ;
  - action « Reprendre le semis du … » dans la page des couverts ;
  - la liste d'espèces alimente la fertilisation, la HVE et la BCAE 7 (légumineuses, nombre d'espèces).
- Web : `MixtureEditor` (fiche) ; saisie des doses par espèce dans `InterventionForm` ; détail sur `SeedLine`.

**Tests** :
- intégration :
  - mélange de quatre espèces (8 + 4 + 2 + 1 = 15 kg/ha) ;
  - 422 si la somme diffère ;
  - couvert rattaché avec ses quatre espèces ;
  - légumineuse repérée ;
- web : éditeur et saisie.

**Fini quand** : le mélange de couvert de la ferme pilote est décrit, semé avec ses doses, et le couvert de la parcelle en reprend les espèces.

### SE7 — Utilisation par campagne (taille S)

**But** : FR-SE-24 à 27.

- API : `GET /seeds/usage?campaign=&by=article|species&format=csv` ; réalisé et prévu distingués ; valeurs estimées marquées ; « non convertible » sans blocage.
- Web : onglet **Utilisation** (`UsagePanel`), regroupement par espèce, export CSV.

**Tests** : intégration (moyenne pondérée par la surface, écart minimum-maximum, CSV) ; web.

**Fini quand** : la campagne 2026 de la ferme pilote donne, par semence, quantité, surface et densité moyenne.

### SE8 — Recette et documentation (taille S)

- `docs/semences.md` (guide utilisateur) ; lien dans `README.md` ; `claudedocs/points_ouverts.md` mis à jour avec les questions encore ouvertes (faculté germinative, réécriture des unités, prix Germineo, semences de ferme, licence des repères).
- Essai local sur une ferme reprise d'Ekylibre et sur la ferme d'imports Geofolia ; retours notés hors dépôt.
- Issues GitHub pour les questions ouvertes et pour l'adaptation de l'application mobile (champ `seed`).

## 4. Points de contrôle

| Après | Vérification |
|---|---|
| SE1 | migration rejouable de zéro (`db:reset`) ; RLS testée |
| SE3 | aucune régression de l'état des stocks ni du contrôle AB |
| SE5 | tous les tests de stock existants verts ; conversions figées vérifiées en base |
| SE6 | cahier de fertilisation et contrôles HVE et BCAE 7 inchangés pour un couvert sans mélange |
| SE8 | recette sur deux fermes locales ; doc relue |

## 5. Risques

| Risque | Parade |
|---|---|
| Ordre lot / conversion modifié dans le calcul du stock (SE5) | lot séparé, tests de non-régression d'abord, revue attentive |
| Repères de PMG sans licence | module livré vide ; conversions refusées avec un message qui dit quoi faire |
| Paquet `seed_varieties` non publié sur l'instance | `ifPublished` : la recherche est masquée, la saisie libre reste possible |
| Mobile pas encore à jour | l'API accepte toujours l'unité de l'article ; issue dédiée |

## 6. Réalisé

### SE1 — Socle (20/11/2026)

- Migration `0075_seeds.sql` :
  - `article_seeds` (fiche 1-1, contraintes : PMG avec son origine, un mélange sans espèce ni PMG, PMG < 2 000 g) ;
  - `seed_mixture_components` (UNIQUE `article_id`, `label`) ;
  - RLS des deux tables, comme `article_fertilizers` ;
  - `cover_crops.sowing_intervention_id` et `cover_crops.components` (tableau).
- Code GNIS : 1 à 20 caractères, sans format imposé, pour garder un code absent du catalogue (FR-SE-28).
- Contrat `packages/contracts/src/seeds.ts` : fiche, composants (sans doublon), PMG d'un lot, conversion figée, dose d'une espèce, espèces d'un couvert, repères et libellés.
- Domaine `packages/domain/src/seeds/` :
  - `units.ts` : `parseSeedUnit` (10 libellés observés, codes canoniques, « Sac/Dose de N grains »), `convertSeedQuantity`, `seedConversionGap` (motif du refus), `seedRate` (`_per_hectare`, `_per_square_meter`), `seedUnitChoices`, `seedEquivalents` ;
  - `tgw.ts` : `resolveTgw` (lot → article → repère, « estimé »), `tgwWarning` (30 %) ;
  - `flags.ts` : `seedFlags`, `looksLikeMixture`.
- `toStockQuantity` accepte `seed` : grains, doses et masse convertis, grains/m² × surface, messages « PMG inconnu » et « grains par dose inconnu ». Sans `seed`, la règle d'avant est inchangée. Ce n'est pas encore branché sur les interventions (SE5).
- Une unité « unity » d'une semence vaut un grain ; « 1000 grains » vaut mille grains, « Sac de N grains » une dose de N.
- Tests :
  - domaine : 14 (`packages/domain/test/seeds.test.ts`) ;
  - contrat : 4 (`packages/contracts/test/seeds.test.ts`) ;
  - intégration : 4 (`apps/api/test/seeds.integration.test.ts`), dont RLS entre deux fermes, contraintes, cascade et couvert ;
  - turbo : 82 tâches vertes.

### SE2 — Référentiels (20/11/2026)

- Migration `0076_lexicon_seed_varieties.sql` : table `lexicon_seed_varieties` (code GNIS, taxon, espèce, variété, date d'inscription, clé `search` en minuscules sans accents, index `text_pattern_ops`).
- `packages/lexicon/src/load.ts` : paquet `seed_varieties` (`ifPublished`) ; une ligne sans variété est écartée. Chargé en local : 21 592 variétés ; « thermidor » trouvé en 2 ms.
- `apps/api/src/repos/taxonomy.ts` : `legumeOf` (fragment SQL, déplacé de l'assolement) et `legumeSpecies`, avec repli sur le genre pour les 16 espèces du catalogue absentes de la taxonomie.
- `certification-refs/src/agronomy/thousand-grain-weight.ts` : 14 repères (Arvalis : blé tendre, blé dur, orge, maïs, sorgho ; Terres Inovia : lin, colza, pois, féverole, soja, lentille, pois chiche, lupin, chanvre), chacun avec sa page, sa citation et l'indication « valeur écrite » ou « milieu de la plage » ; alias du catalogue (`lupinus`, `sorghum`) ; pas de repli sur l'espèce parente (maïs doux, pop-corn). `REFS_VERSION` 2026-11-20.12.
- Sans repère publié sur ces deux sites : avoine, triticale, seigle, épeautre, tournesol, espèces de couverts. Leur PMG se saisit.
- Tests : chargement du catalogue (fixtures, accents), légumineuses et recherche (intégration), repères (sources, plages, alias) ; turbo : 82 tâches vertes.

