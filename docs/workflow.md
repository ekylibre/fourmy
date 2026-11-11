# Fourmy — Plan d'implémentation de la première tranche

> Produit par `/sc:workflow` le 2026-11-07, à partir de
> [`requirements.md`](requirements.md) et [`architecture.md`](architecture.md).
> **Stratégie : systématique** — contrats figés le jour 1, puis développement
> parallèle de 7 agents contre ces contrats (NFR-DEV-1/2).
>
> Ce document est un **plan**. Il ne contient pas de code. L'exécution pas à
> pas se fera ensuite (un agent par worktree, voir architecture §10).

## 1. Objectif de la tranche

Livrer en 7 jours, sur les fermes de **Pierre** (`phaurigot`, grandes
cultures + Traccar) et **Frédéric** (`entredeuxterres`, viticulture +
cuverie), les cinq blocs du périmètre (requirements §7) :

1. Migration Ekylibre → Fourmy depuis les exports.
2. Parcellaire versionné (grandes cultures + vigne), carte 2D + frise.
3. Traces Traccar de Pierre et leur rejeu.
4. Interventions, stocks et registre phyto (web + `zero-mobile`).
5. Plan 3D : relief IGN, bâtiments, parcellaire, **cuverie** de Frédéric.

**Critère de succès global** : les user stories US-1, US-2, US-3, US-4,
US-5 et US-9 passent la recette sur les deux fermes réelles.

## 2. Principe d'orchestration

```
Jour 1        Jours 2 → 5                         Jours 6 → 7
┌────────┐   ┌───────────────────────────────┐   ┌─────────────────┐
│Agent 0 │   │ A domaine   B migration        │   │ migration réelle│
│contrats│──▶│ C traccar   D api/sync         │──▶│ recette US-1..9 │
│db·ci   │   │ E web 2D    F 3D   G mobile     │   │ corrections     │
│mocks   │   │ (parallèles, PR continues)     │   │ démo            │
└────────┘   └───────────────────────────────┘   └─────────────────┘
```

- **Jour 1 bloquant** : tant que l'agent 0 n'a pas figé contrats + schéma +
  mocks + fixtures, personne d'autre ne démarre sur du réel. E, F et G
  travaillent ensuite sur **mocks** (MSW) et **fixtures** sans attendre l'API.
- **Un changement de contrat** après le jour 1 passe par l'agent 0 (ou
  « intégrateur ») uniquement, avec PR dédiée annoncée aux agents concernés.
- **Intégration continue** sur `main`, petites PR, CI obligatoire
  (typecheck + lint + tests + migrations) à chaque PR (NFR-DEV-3).

## 3. Jour 1 — Fondations (agent 0, seul)

Livrables, dans l'ordre. Tout le reste en dépend.

### 3.1 Monorepo et outillage
- [ ] `pnpm` + `turbo`, `tsconfig` de base, ESLint + Prettier, Vitest.
- [ ] Arborescence `apps/`, `packages/`, `services/`, `fixtures/`,
  `docker/` (architecture §3).
- [ ] `docker/compose.dev.yml` : image `timescale/timescaledb-ha`
  (PostGIS + Timescale), service `api`, service `web`.
- [ ] CI GitHub Actions : `typecheck`, `lint`, `test`, `migrate` sur chaque PR.

### 3.2 `packages/contracts` (Apache-2.0) — **le gel**
- [ ] Schémas **Zod** de toutes les entités de §4.3 (farms, campaigns,
  land_parcels(+version), productions, places(+version),
  containers(+version), equipments, tracker_bindings, positions, articles,
  lots, lot_lineage, stock_movements, interventions,
  intervention_parameters, audit_log, outbox_events, import_runs).
- [ ] Schémas **requête/réponse** de toutes les routes de §5.1
  (`@hono/zod-openapi`), erreurs `application/problem+json`, pagination
  curseur, `?at=` typé.
- [ ] Enveloppe **CloudEvents** et types des 8 événements de §5.2.
- [ ] Types du **protocole de synchro** (pull/push WatermelonDB, §5.3).
- [ ] OpenAPI généré → source du contrat du service Python `services/agro`.

### 3.3 `packages/db`
- [ ] Schéma **Drizzle** + migrations SQL des tables §4.3.
- [ ] **PostGIS** : colonnes `geometry`, index GiST ; contrainte d'exclusion
  `land_parcel_versions (land_parcel_id WITH =, valid WITH &&)`.
- [ ] **Timescale** : hypertable `positions`, politique de compression 30 j.
- [ ] **RLS** par `farm_id` sur chaque table (ADR-4) + rôle applicatif.
- [ ] Seeds minimaux (1 ferme de démo, 1 user owner).

### 3.4 `apps/api` — squelette
- [ ] Serveur **Hono**, montage OpenAPI, middleware d'auth **better-auth**,
  contexte `farmId` + RLS par requête, `problem+json` global.
- [ ] Toutes les routes de §5.1 **déclarées et typées**, réponses `501` en
  attendant leur implémentation par les agents D/C/F.

### 3.5 Pour débloquer E, F, G
- [ ] **Mocks MSW** générés depuis l'OpenAPI (réponses d'exemple par route).
- [ ] **`fixtures/`** : jeux anonymisés dérivés des vrais exports
  (voir agent B §4.2) — a minima parcellaire + bâtiments + cuves +
  quelques interventions + un échantillon de positions, pour que la 3D et
  le web aient de la matière dès le jour 2.

### 3.6 `services/agro` — squelette (pas de méthode métier)
- [ ] FastAPI + `uv`, un endpoint `GET /health`, client généré depuis
  l'OpenAPI des contrats. Les méthodes (bilans azotés, etc.) viennent après
  la tranche (ADR-1).

**DoD jour 1** : `pnpm -w typecheck && pnpm -w test && docker compose up`
démarrent ; une requête authentifiée sur `/snapshot` renvoie 501 ; les mocks
et au moins un lot de fixtures sont committés.

## 4. Jours 2 → 5 — Agents parallèles

Chaque section : **objectif · dépend de · tâches · routes/tables possédées ·
DoD · US couvertes**.

### Agent A — Domaine (`packages/domain`, vues SQL)
- **Objectif** : la logique métier pure (temps, stocks, interventions,
  registres), testable sans base ni réseau.
- **Dépend de** : 0 (contrats, db).
- **Tâches**
  - [ ] Versionnement d'état : clore `valid` courant + ouvrir la nouvelle
    version dans une transaction (§4.4).
  - [ ] Réalisation d'intervention : intervention + paramètres + mouvements
    de stock (intrants négatifs, sorties positives) + audit + outbox, une
    transaction.
  - [ ] Correction par contre-passation (jamais de mutation de mouvement).
  - [ ] Calcul de stock (somme des mouvements à une date) et **contenu d'une
    cuve** (somme par lot + composition via `lot_lineage`).
  - [ ] **Vue SQL registre phyto** (interventions `done` × paramètres `input`
    × articles `phyto` × cibles) — calculé, jamais saisi.
  - [ ] Génération des événements outbox (CloudEvents).
- **DoD** : tests unitaires de chaque règle sur cas limites (chevauchement de
  versions interdit, contre-passation, cuve multi-lots).
- **US** : socle de US-2, US-5, US-9.

### Agent B — Migration (`packages/migrator-ekylibre`, jobs, `fixtures/`)
- **Objectif** : rejouer un export Ekylibre vers Fourmy via les services de
  domaine, avec rapport.
- **Dépend de** : 0, A.
- **Tâches**
  - [ ] Restauration du dump texte du `.zip` dans une base
    `ekylibre_src` jetable, **rôle lecture seule** (ADR-12 ; `psql`, pas
    `pg_restore`).
  - [ ] Détection de version via `manifest.yml` (**4.37** et **5.0** à gérer),
    signalement des colonnes absentes.
  - [ ] Extracteurs SQL par domaine, dans l'ordre : campagnes → parcellaire
    (`land_parcels`, `cap_islets`, supports, CVI vigne) → bâtiments et cuves
    (`products` variété bâtiment/cuve, `initial_shape`) → matériels →
    articles (rattachés à Lexicon) → stocks initiaux → interventions +
    paramètres → mouvements.
  - [ ] **UUID v5 déterministes** `(instance, table, id)` → rejeu
    idempotent.
  - [ ] **Rapport** `import_runs.report` : volumes par entité, lignes
    rejetées + raison, **écart du registre phyto** Ekylibre↔Fourmy sur une
    campagne de référence (critère de US-5).
  - [ ] **Fixtures anonymisées** : pipeline qui remplace personnes/tiers/
    pièces jointes, conserve géométries et données agronomiques → `fixtures/`.
- **DoD** : migration des 3 exports sans exception non gérée ; rapport lisible ;
  écart phyto mesuré ; fixtures committées et utilisées par la CI.
- **US** : US-5, et alimente US-1..4/9.

### Agent C — Traccar et traces (`packages/connector-traccar`, `/tracks*`)
- **Objectif** : ingérer les positions de Pierre et servir des traces pour
  le rejeu.
- **Dépend de** : 0.
- **Tâches**
  - [ ] Client Traccar `traccar.osfarm.org` : **Bearer** (jeton
    `TRACCAR_TOKEN_PHAURIGOT`) **et repli HTTP Basic** (c'est ce qu'utilisait
    Ekylibre). Identifiants hors dépôt.
  - [ ] Mapping `devices` → `tracker_bindings` (boîtiers id 1, 3, 5), import
    historique puis fenêtre glissante par minute, déduplication
    `(binding_id, time)` → hypertable `positions`.
  - [ ] `GET /tracks?equipment=&from=&to=&format=czml|json` : simplification
    serveur (Douglas-Peucker par zoom), **CZML** pour l'horloge Cesium.
  - [ ] `GET /tracks/coverage` : durée et surface par parcelle traversée
    (jointure spatiale positions × `land_parcel_versions`).
  - [ ] Événement `tracker.positions_ingested`.
- **DoD** : rejeu d'une journée réelle du Claas Arion 430 (id 3, ~7,5 k
  points sur sept-oct) ; couverture par parcelle cohérente.
- **US** : US-1, US-3.

### Agent D — API métier et synchro (`apps/api` hors squelette, `/sync`)
- **Objectif** : implémenter les routes métier et la synchro mobile.
- **Dépend de** : 0, A.
- **Tâches**
  - [ ] `GET /snapshot?at=` : état consolidé (parcelles, productions,
    bâtiments, cuves + contenu, matériels) — cache par jour.
  - [ ] `land-parcels`, `places`, `containers` (+ `PATCH /placement`),
    `containers/:id/contents`, `stock`, `interventions` (+ `complete`),
    `registers/phyto` (`csv|pdf`) — adossées aux services de l'agent A.
  - [ ] **Synchro** `GET /sync/pull` / `POST /sync/push` : upsert idempotent
    par `client_id` (UUID v7), 409 → re-pull (§5.3).
  - [ ] `POST /imports/ekylibre` / `GET /imports/:id` (admin) pilotant
    l'agent B.
- **DoD** : contrat OpenAPI respecté (tests de contrat), snapshot à deux
  dates différentes cohérent, round-trip de synchro idempotent.
- **US** : US-2, US-3, US-9, support US-4.

### Agent E — Web 2D et écrans (`apps/web` hors `3d/`, `packages/ui-lyvre`)
- **Objectif** : l'application React, hors 3D.
- **Dépend de** : 0 (contrats + mocks MSW) — démarre sans l'API réelle.
- **Tâches**
  - [ ] Base **React 19 + Vite + Mantine 9**, TanStack Query, React Router ;
    **`ui-lyvre`** = thème Mantine repris de Lyvre (polices, couleurs,
    conventions).
  - [ ] Client API typé depuis `@fourmy/sdk`/contrats, auth better-auth.
  - [ ] Écrans : connexion · tableau de bord ferme · **carte 2D MapLibre**
    (parcellaire, interventions, registre) · interventions (liste, saisie,
    réalisation) · stocks · cuverie (liste) · **registre phyto** · suivi de
    migration (admin).
  - [ ] **Frise temporelle** partagée (composant), pilote `?at=` / snapshot.
- **DoD** : tous les écrans fonctionnent sur mocks puis sur API réelle ;
  tests composant (Vitest) + un parcours Playwright (connexion → carte →
  intervention).
- **US** : US-2, US-5 (visualisation), cadre de US-1/3/4.

### Agent F — 3D, relief, cuverie (`apps/web/src/3d/`, `packages/geo-ign`, `/terrain`)
- **Objectif** : le plan 3D et son rejeu.
- **Dépend de** : 0 (contrats + fixtures géométriques).
- **Tâches**
  - [ ] `packages/geo-ign` : téléchargement **RGE ALTI** de l'emprise (+2 km)
    → GeoTIFF ; `GET /terrain/heightmap/:z/:x/:y` pour
    `CustomHeightmapTerrainProvider` de Cesium (ADR-9).
  - [ ] **Bâtiments** : emprises/hauteurs **BD TOPO** (WFS) rapprochées des
    bâtiments Ekylibre par recouvrement, extrudées (ADR-10).
  - [ ] **Cuves** : placement automatique en grille dans l'emprise du
    bâtiment, cylindre dimensionné sur la capacité ; mode « placer les
    cuves » (`PATCH /containers/:id/placement`) ; remplissage (couleur +
    hauteur) suivant l'horloge via `contents?at=`.
  - [ ] **Frise Cesium** pilote l'app : changement de date → `snapshot?at=` ;
    traces GPS = entités CZML animées sur la même horloge.
  - [ ] Spike **jour 2** sur le volume/format RGE ALTI (voir risques).
- **DoD** : plan 3D d'une ferme avec relief, bâtiments et cuves ; rejeu d'une
  trace et remplissage de cuve suivant la frise ; repli relief plat documenté.
- **US** : US-4, US-9, et rejeu de US-1/3.

### Agent G — Mobile (`zero-mobile`, dépôt séparé)
- **Objectif** : adapter l'app mobile existante à Fourmy.
- **Dépend de** : 0 (`@fourmy/sdk` + protocole de synchro).
- **Tâches**
  - [ ] Remplacer le connecteur API v2 d'Ekylibre par `@fourmy/sdk` +
    synchro WatermelonDB (ADR-13), `client_id` UUID v7.
  - [ ] Remplacer le formulaire de pulvérisation codé en dur par le
    **catalogue de procédures** (interventions génériques).
  - [ ] Conserver carte MapLibre et cache hors-ligne existants.
- **DoD** : saisie d'une intervention hors-ligne → synchro → visible sur le
  web ; round-trip idempotent (pas de doublon après re-push).
- **US** : US-2 (volet terrain).

## 5. Jours 6 → 7 — Intégration et recette

- [ ] **Migration réelle** des deux fermes (`phaurigot`, `entredeuxterres`)
  depuis les exports bruts (hors dépôt), rapports relus.
- [ ] **Recette des user stories** sur données réelles :
  - US-1 rejeu d'une trace de Pierre + couverture par parcelle ;
  - US-2 intervention saisie sur mobile → web → registre phyto ;
  - US-3 snapshot de la ferme à deux dates ;
  - US-4 plan 3D de l'exploitation ;
  - US-5 écart phyto Ekylibre↔Fourmy sous le seuil ;
  - US-9 cuverie de Frédéric dans le plan 3D, remplissage suivant la frise.
- [ ] Corrections, puis **démonstration**.

## 6. Portes de qualité (à chaque PR)

| Porte | Vérifie |
|---|---|
| `typecheck` | types partagés contrats ↔ implémentations |
| `lint` | style, règles de dépendance (`domain` sans base ni réseau) |
| `test` | unitaires du module + tests de contrat API |
| `migrate` | migrations appliquées sur base neuve |
| intégration | tests sur `fixtures/` anonymisées |
| propriété | aucune modification hors des dossiers de l'agent |
| revue | PR relue par l'intégrateur (agent 0) |

## 7. Chemin critique et points de synchronisation

- **Bloquant global** : agent 0 (jour 1). Aucun parallélisme avant le gel.
- **A précède B et D** : les services de domaine sont la seule voie d'écriture.
- **B alimente la recette** : sans migration, pas de données réelles jours 6-7.
- **F est le plus risqué** (relief IGN, placement cuves) : spike jour 2,
  repli documenté, à surveiller en premier.
- **Contrats = contrat social** : tout changement après J1 passe par l'agent 0.

## 8. Risques (rappel, détail en architecture §11)

| Risque | Parade | Porté par |
|---|---|---|
| Volume/format RGE ALTI | Spike J2, repli WMS/relief plat | F |
| Cuves/bâtiments sans géométrie | BD TOPO + placement auto + éditeur | F, B |
| Hétérogénéité Ekylibre (4.37 vs 5.0) | Rapport de rejets dès J3, mapping itératif | B |
| Conflits de contrats entre agents | Gel J1, propriété stricte, intégrateur unique | 0 |
| Volume de positions Traccar | Simplification serveur, compression, fenêtres bornées | C |
| Jeton Traccar restreint | Repli Basic auth, jeton dédié déjà obtenu | C |

## 9. Hors de cette tranche (rappel)

Synchro Lyvre, MCP/Aiffel, système de plugins, élevage N1, PAC, fertilisation
(réalisée depuis, lots AE à AQ : [`fertilisation.md`](fertilisation.md)),
capteurs, planification, déclaration de récolte, registre de cave, et les
méthodes du service Python `services/agro`. Points d'entrée prévus en
architecture §8.

---

**Étape suivante** : exécution agent par agent (worktrees), en commençant par
l'agent 0. À lancer avec `/sc:implement` (ou l'orchestration multi-agent),
une fois ce plan validé.
