# Parcours GPS et attelages : plan de réalisation

> Sources :
> - exigences : `docs/parcours-attelages.md` (validées le 2026-11-09) ;
> - design : `docs/parcours-attelages-design.md`.
>
> Ce document est un plan seulement : la réalisation se fait avec
> `/sc:implement`, phase par phase. Une phase donne un commit (`feat:` ou
> `fix:`, avec une ligne `Public:` pour les agriculteurs).

## État (2026-11-09)

Phases réalisées, sur la branche `feat/parcours-attelages` :
- **N1** `bf6267f` :
  - migration 0022 (attelages, trigger de garde différé, index manquant
    sur `intervention_parameters`) ;
  - contrats `staffing` et `crews` ;
  - API, mobile et web restent en mode libre jusqu'à N3, N4 et R3.
- **O1** `a63be54` : `segmentSessions`, `settingsHash` (SHA-256 en
  TypeScript pur, car le domaine sert aussi au web et au mobile) et
  `trackSettings`.
- **N2** `c4cb4a2` : `crewRules`, `flattenCrews`, `mergePeriods`,
  `toCrews`, `toFree` (avec la liste des pertes) et `crewDurations` (pour
  `spanS` et `workDurationS` en N3). Deux périodes qui se touchent ne se
  chevauchent pas.
- **O2** : migration 0023 (`track_sessions`, `farm_settings.tracks`),
  `computeTrackSessions` (une transaction par boîtier) et tâche du worker
  toutes les 5 min. Choix :
  - les positions des plages figées sont retirées et chaque tronçon entre
    deux plages est découpé à part : un parcours libre ne chevauche jamais
    un parcours rattaché ;
  - la dérive se calcule sur ± 2 × `stopMin` autour de la plage figée ;
  - la part d'une parcelle est la surface couverte divisée par la surface
    de la parcelle ;
  - l'outil est résolu dans l'ordre de FR-GPS-17 : attelage déclaré, puis
    `tool` Traccar (`external_ids.traccarTool` ou nom identique, jamais
    par inclusion), puis seul outil d'une intervention libre sur la plage.
  Sur la base locale : 12 parcours pour les 3 boîtiers de Pierre (0,26 s,
  puis 0,09 s par passage incrémental). Le travail du 28/10 ne donne
  aucune parcelle : les parcelles en pente n'ont plus de version valide
  depuis 2023 (lacune du parcellaire, pas du calcul).
- **N3** : l'API écrit et lit les attelages.
  - Validation : `crewRules` (noms des matériels et personnes dans les
    messages), puis les règles existantes sur la forme aplatie, qui sert
    aussi aux compteurs, au contrôle phyto, aux stocks et aux bornes.
  - Écriture : id d'attelage du client conservé ; le `crew_id` des parcours
    rattachés est reposé après réécriture.
  - Lecture : `crews` par sous-requête dans la lecture commune (fiche,
    liste, synchro) ; forme aplatie, `spanS` et `workDurationS`.
  - Avertissement (non bloquant) quand un matériel ou une personne d'un
    attelage travaille au même moment dans une autre intervention.
  - Historique : `staffing` et `crews` comparés ; en attelages, matériels,
    intervenants et périodes de premier niveau ne sont pas répétés.
  - `hitches()` : outils du même attelage, sur ses périodes.
  - Annulation : les parcours rattachés redeviennent libres.
  - Synchro mobile toujours forcée en mode libre (R3).

Contrôle d'O1 sur l'Arion 430 le 28/10 (réglages par défaut) :
- déplacement 10:37-11:06, puis coupure de 2 h à midi ;
- déplacement 13:13-13:20 ;
- travail 13:21-14:59 (98 min, 6,6 km), qui correspond exactement aux
  positions `working` ;
- déplacement 14:59-15:21.

**Tranché (2026-11-09)** : le matin (10:37-11:06), le tracteur roule à
5 km/h avec l'outil « Tigre », mais `working` est faux. La règle est
conservée : seul le signal `working` du boîtier fait le travail, ce trajet
reste un déplacement. Pas de déduction depuis l'outil et la vitesse en v1.

**Traces de Pierre disponibles** (jeton mis à jour le 2026-11-09) : la
synchro a importé 7 592 positions, du 5 au 29 octobre 2026, sur les trois
boîtiers.

| Matériel | Jours | Constat |
|---|---|---|
| Arion 430 | 05/10 (1 002 positions au travail sur 2 886), 06/10, 07/10, 26/10, 28/10 (853 sur 1 577), 29/10 | journées de travail réelles : jeu de recette du lot O |
| Arion 630 | 08/10 (96 positions, à l'arrêt) | peu exploitable |
| Zetor 10145 | 08/10 (20 positions, à l'arrêt) | peu exploitable |

Points qui touchent le design :
- **Journées sans `working`** : le 06/10 et le 26/10, l'Arion 430 roule
  (environ 6 km/h en moyenne) sans aucune position au travail. Ces journées
  ne donneront que des déplacements, sauf réglage de vitesse. C'est un cas
  de test d'O1.
- **Valeurs de l'attribut `tool`** : `Tigre`, `Arion UF1201`,
  `Z10145 UF1201`, `Remorque MC18R`. Aucune n'est égale au nom d'un
  matériel. Le rapprochement par nom ne suffit donc pas :
  - il faut renseigner `external_ids.traccarTool` (Tigre → Maschio Tigre
    300, UF1201 → Amazone UF1201) ;
  - ou faire un rapprochement par inclusion du nom ou du modèle (« Tigre »
    est contenu dans « Maschio Tigre 300 »).
  Tranché (2026-11-09) : lien à la main par `external_ids.traccarTool`
  sur le matériel ; le rapprochement par inclusion n'est qu'une
  suggestion proposée à l'utilisateur, jamais appliquée seule. La
  remorque MC18R n'existe pas dans les matériels migrés.
- **Pas de synchro continue en local** : le worker n'est pas lancé, et
  l'API compilée tourne seule. Lancer le worker
  (`corepack pnpm --filter @fourmy/api worker`) pour recevoir les nouvelles
  positions.

## 0. Point de départ (constaté dans le code)

| Existant | Où | Ce qu'on en fait |
|---|---|---|
| Écriture du corps d'une intervention | `apps/api/src/repos/interventions.ts` → `writeBody` (DELETE puis INSERT des paramètres et périodes) | ajouter les attelages (`crew_id`) sans changer le reste |
| Validation | `validate` → `validateIntervention` (`packages/domain/src/intervention-rules.ts`) | + `crewRules`, règles existantes sur `flattenCrews` |
| Annulation | `cancelIntervention` (`repos/interventions.ts:753`) | + libération des parcours |
| Contrat du corps | `packages/contracts/src/entities/interventions.ts` (`interventionBody`) | + `staffing`, `crews`, `trackSessionIds` |
| Synchro mobile | `packages/contracts/src/sync.ts`, `repos/sync.ts` | `staffing` et `crews` facultatifs ; update aplati refusé |
| Couverture par parcelle | `repos/tracks.ts` → `trackCoverage` (CTE PostGIS) | à extraire en requête par session |
| Heures de fonctionnement | `packages/domain/src/meter.ts` → `operatingHoursByDay` | modèle de lecture des positions (`working`, `speed`) ; inchangé |
| Attelage du rejeu 3D | `repos/avatar.ts` → `hitches()` | attelage déclaré d'abord |
| Réglages de la ferme | table `farm_settings` (0018), `PUT /settings/maintenance` | + colonne `tracks`, même schéma d'API |
| Worker | `apps/api/src/worker.ts` (ticks : Lexicon, eau, IFT, météo, usage, alertes) | + `trackSessionsTick` |
| Registre phyto | vue `phyto_register` (0003), `repos/registers.ts` | + `applicators` |
| Migrateur | `packages/migrator-ekylibre/src/{extract,migrate}.ts` | + participations, règles 1 à 3 |
| Formulaire | `apps/web/src/features/interventions/InterventionForm.tsx`, `periods.ts` | + sélecteur de mode, cartes d'attelage |
| Fiche matériel | `apps/web/src/features/equipments/EquipmentSheetPage.tsx` (onglets `?tab=`) | + onglet `tracks` |
| Fixtures | `fixtures/pilote-*.json` | régénérées au lot R |

Prochaine migration : `0022`. Le design prévoit une seule migration
`0022_tracks_crews.sql` ; elle est **découpée par lot** (0022 attelages,
0023 parcours, 0024 attelages types, 0025 applicateurs) pour que chaque lot
se livre seul.

## 1. Ordre et dépendances

```
N1 ─ N2 ─ N3 ─ N4 ─┬─ Q1 ─ Q2
                   ├─ R1 (applicateurs) ─ R2 (migrateur) ─ R3 (mobile, fixtures)
O1 ─ O2 ─ O3 ─ O4 ─┴─ P1 ─ P2 ─ P3
```

- **N** (attelages) et **O** (parcours) sont indépendants : on peut les
  mener en parallèle (deux agents, deux branches), puis les fusionner avant
  P.
- Ordre recommandé à un seul agent : N1 → N4, O1 → O4, P1 → P3, Q, R.

## 2. Lot N : attelages dans l'intervention

### N1 Modèle et contrats
- Migration `0022_crews.sql` :
  - `interventions.staffing` ;
  - table `intervention_crews` (RLS par l'intervention) ;
  - colonne `crew_id` sur `intervention_parameters` et
    `intervention_periods`, avec index partiels ;
  - trigger de garde (invariants du design §2.1).
- Contrats :
  - `staffing`, `interventionCrew` ;
  - `crews` dans `interventionBody` et à la lecture ;
  - `workDurationS` et `spanS`.
- **Contrôle** : `pnpm migrate` sur une base vierge et sur la base locale
  (fermes migrées) ; typecheck.

### N2 Domaine
- `crewRules`, `flattenCrews`, `toCrews`, `toFree`, `mergePeriods` (dans
  `intervention-rules.ts` ou un nouveau `crews.ts`).
- Tests (`packages/domain/test/crews.test.ts`) :
  - attelage sans matériel → erreur ;
  - attelage sans intervenant → accepté ;
  - chevauchement dans un attelage → erreur ; entre deux attelages → permis ;
  - même tracteur dans deux attelages qui se chevauchent → erreur ;
  - `flattenCrews` fusionne les périodes ;
  - aller-retour `toCrews` / `toFree` ;
  - `toFree` signale la perte d'information.

### N3 API
- `validate` : `crewRules`, puis `validateIntervention(flattenCrews(body))`.
- `writeBody` : insérer les attelages (id client conservé), puis les `tool`,
  `doer` et périodes avec leur `crew_id`. `interventions.started_at` et
  `stopped_at` = bornes de toutes les périodes.
- `readIntervention` et la liste : `crews` + forme aplatie (repo
  `crewsOf(ids)`, une requête pour toute la liste).
- Avertissement de chevauchement avec **d'autres** interventions (matériel
  ou personne), renvoyé dans `warnings`.
- `hitches()` : outils du même attelage, sur les périodes de l'attelage ;
  sinon la déduction actuelle.
- Tests (`apps/api/test/crews.integration.test.ts`) :
  - créer, lire, modifier, réaliser et annuler en mode `crews` ;
  - changer de mode ;
  - l'audit montre les attelages ;
  - `hitches()` avec deux attelages ;
  - non-régression : la suite `interventions*.integration.test.ts` passe
    inchangée.

### N4 Web
- `InterventionForm.tsx` :
  - sélecteur « Attelages | Libre » ;
  - composant `CrewCard` (matériels, intervenants, éditeur de périodes
    existant) ; ajouter, dupliquer, supprimer un attelage ;
  - synthèse « chantier · temps de travail » ;
  - passage en libre : fenêtre de confirmation.
- Fiche d'intervention : un bloc par attelage. La trace GPS de chaque
  matériel suit les périodes de son attelage.
- Calendrier (`views.tsx` et `week.ts`) : une barre par attelage et par
  période.
- e2e (`apps/web/e2e/crews.spec.ts`) : saisir le cas US-ATT-A (deux
  attelages, 8 h-10 h et 9 h-12 h). La fiche affiche « 8 h-12 h · 5 h ».
- **Point de contrôle N** :
  - toutes les suites passent ;
  - une intervention migrée (mode libre) s'affiche et se modifie comme
    avant.

## 3. Lot O : parcours

### O1 Découpage (domaine)
- `segmentSessions(positions, settings)` dans `packages/domain/src/tracks.ts`
  (design §4.1) et `settingsHash(settings)`.
- Jeu de test : positions synthétiques (travail, demi-tours, route, pause
  de 20 min, trou de transmission, boîtier sans `isWorking`). Quand le
  jeton le permet, ajouter une journée réelle anonymisée de Pierre
  (coordonnées translatées).
- Tests :
  - les demi-tours sont absorbés ;
  - une pause de 20 min coupe la session ;
  - 14 min ne la coupent pas avec `stopMin` = 15 ;
  - les déplacements sont séparés ;
  - les sessions trop courtes sont filtrées ;
  - le résultat est déterministe ;
  - `tool_hint` est la valeur majoritaire.

### O2 Stockage et worker
- Migration `0023_track_sessions.sql` : `track_sessions` (design §2.3) et
  `farm_settings.tracks` (§2.4).
- `apps/api/src/repos/track-sessions.ts` :
  - `computeTrackSessions(db, farmId)` : fenêtre, exclusion des plages
    figées, segmentation, géométrie par session, remplacement des
    sessions libres, dérive, outil résolu ;
  - requête SQL `sessionGeometry` extraite de `trackCoverage`.
- `worker.ts` : `trackSessionsTick` toutes les 5 min (fermes de
  `fourmy_traccar_farms()`).
- Tests (`apps/api/test/track-sessions.integration.test.ts`, positions
  insérées) :
  - calcul initial, puis incrémental ;
  - une position tardive dans une session libre → recalculée ;
  - une position tardive dans une session rattachée → `drift`, la session
    reste ;
  - un changement de réglages ne recalcule que les sessions libres ;
  - la surface couverte reste cohérente avec `trackCoverage`, à 1 % près.

### O3 API
- `GET /equipments/:id/track-sessions` (filtres, curseur) :
  - matériel suivi : ses sessions ;
  - outil : les sessions dont `tool_equipment_id` est cet outil, ou dont
    l'attelage rattaché le contient, avec la colonne « Tracteur ».
- `GET /track-sessions/:id` (trace simplifiée, couverture).
- `GET` et `PUT /settings/tracks` (owner), et
  `POST /track-sessions/recompute`.
- Tests :
  - droits (membre en lecture, owner pour les réglages) ;
  - pagination ;
  - onglet d'un outil ;
  - **performance** : 90 jours, 3 matériels (positions générées) → liste
    en moins de 2 s.

### O4 Web
- `features/equipments/TrackSessionsTab.tsx` :
  - onglet visible si au moins une session ;
  - filtres, tableau, mini-carte (carte MapLibre existante), badge « trace
    modifiée » ;
  - colonne « Tracteur » sur un outil.
- Réglages : section « Parcours GPS » à côté de l'entretien (6 champs,
  « Recalculer »).
- e2e : l'onglet sur un tracteur de fixture avec positions ; les filtres.
- **Point de contrôle O**, sur les vraies traces de Pierre si le jeton est
  réglé :
  - la journée du 07/11 donne des sessions plausibles ;
  - la surface couverte de la journée reste à moins de 2 % de Traccar
    (critère US-GPS-A).

## 4. Lot P : parcours → intervention

### P1 Brouillon
- `draftFromSessions` (domaine, design §4.3), avec des tests :
  - une session ;
  - deux sessions proches fusionnées ;
  - un déplacement seul (sans cible) ;
  - seuil de parcelle ;
  - outil et conducteur absents → indices (`hints`).
- `POST /track-sessions/draft` :
  - résolution de l'outil (attribut `tool`, puis l'habitude) ;
  - conducteur habituel du matériel (12 derniers mois) ;
  - procédures suggérées d'après l'outil (`GET /procedures`, sens
    inverse) ;
  - union des couvertures en `workingZone`.
- Refus (409) : session déjà rattachée ; sessions de plusieurs matériels.

### P2 Rattachement
- Corps d'intervention : `trackSessionIds`. Le rattachement se fait dans la
  transaction d'écriture (design §5), avec `crew_id` = l'attelage du
  matériel.
- Libération : à l'annulation (`cancelIntervention`) et à la suppression
  (`ON DELETE SET NULL`).
- `POST /interventions/:id/track-sessions` (FR-GPS-24) : ajoute une
  période à l'attelage du matériel (ou crée l'attelage) et les parcelles
  manquantes.
- Fiche d'intervention : liste des parcours rattachés, avec leur dérive.
- Tests :
  - double rattachement → 409 ;
  - annuler libère ;
  - ajouter à une intervention existante ;
  - modifier l'intervention ne détache pas ses parcours.

### P3 Web
- Onglet Parcours :
  - cases à cocher ;
  - « Créer l'intervention » ouvre `…/interventions/new` avec le
    brouillon (`navigate(…, { state })`), en mode attelages ;
  - « Ajouter à une intervention » ouvre une fenêtre avec les
    interventions du jour.
- Formulaire : bandeau « N parcours GPS seront rattachés » et indices du
  brouillon.
- e2e, parcours US-GPS-B : cocher deux sessions, créer, choisir la
  procédure, enregistrer. Les sessions passent à « rattaché » et la fiche
  les liste.
- **Point de contrôle P** : US-GPS-B en moins d'une minute sur une journée
  réelle de Pierre.

## 5. Lot Q : attelages types

### Q1 Modèle et API
- Migration `0024_crew_templates.sql` (design §2.2).
- `GET` et `POST /crew-templates`, `PUT` et `DELETE /crew-templates/:id`
  (owner pour l'écriture), avec leurs tests.

### Q2 Web
- Matériels › Attelages types : liste et formulaire.
- Formulaire d'intervention :
  - choisir un attelage type remplit la carte (`templateId` conservé) ;
  - « Enregistrer comme attelage type » (owner).
- e2e US-ATT-C.

## 6. Lot R : réglementaire, reprise, mobile

### R1 Applicateurs (FR-ATT-12)
- Domaine : `applicatorsOf` (design §4.4) et ses tests.
- Migration `0025_phyto_applicators.sql` :
  - fonction `fourmy_input_applicators` ;
  - vue `phyto_register` + `applicators` ;
  - un test SQL et un test TS sur les mêmes cas.
- Registre (JSON, CSV, écran) : colonne Applicateur.
- Contrôle réglementaire : « applicateur non renseigné » (orange) quand
  l'attelage du pulvérisateur n'a pas d'intervenant.
- **Contrôle** : l'écart du registre phyto au migrateur reste nul (même
  nombre de lignes).

### R2 Migrateur (FR-ATT-10)
- `extract.ts` : `participations(s)`.
- `migrate.ts` : règles 1 à 3, identifiants déterministes, intervention
  `corrected` non réécrite, `counts.crews` et `counts.crews_ambiguous`,
  avertissements.
- Rejouer sur les deux bases sources locales :
  - Pierre : environ 586 interventions avec attelage, 0 ambiguë attendue ;
  - Frédéric : au plus 14 ambiguës, à lister au rapport ;
  - test d'intégration du migrateur : idempotence, registre identique.

### R3 Mobile et fixtures
- `repos/sync.ts` :
  - pull : `body_json` avec `staffing` et `crews` ;
  - push : `staffing` et `crews` acceptés ; un update sans `staffing` sur
    une intervention en mode `crews` va dans `failed` (FR-ATT-8) ;
  - tests de `sync.integration.test.ts`.
- Note pour zero-mobile (branche `fourmy-backend`) : contrat à suivre, hors
  de ce dépôt.
- Fixtures régénérées (`fourmy-export-fixture`) et e2e repassés.
- Documentation :
  - `docs/interventions.md` (modèle §4.1) ;
  - `docs/materiels.md` (onglet Parcours, attelage 3D) ;
  - `docs/parcours-attelages.md` : bilan par exigence, comme
    `materiels-entretien.md` §9 ;
  - README (état du projet).

## 7. Points de contrôle communs (à chaque phase)

- `corepack pnpm build && corepack pnpm lint && corepack pnpm typecheck`.
- Tests :
  - `corepack pnpm test` (avec `DATABASE_URL` sur 5434) ;
  - test du migrateur sur les deux sources (`MIGRATOR_SOURCE_URL`) dès que
    le lot touche les interventions.
- Les e2e du lot, avec l'API et `vite preview` démarrés.
- Aucune régression du mode libre : la suite actuelle passe sans
  modification de ses attentes.
- Commit conventionnel, sans nom de pilote dans la ligne `Public:`
  (`packages/release/denylist.txt`).

## 8. Risques et parades

| Risque | Où | Parade |
|---|---|---|
| `writeBody` réécrit tout à chaque modification : les id d'attelage changent et `track_sessions.crew_id` casse | N3, P2 | id d'attelage envoyés par le client et conservés ; sinon, après réécriture, `crew_id` recalculé d'après le matériel |
| Requêtes qui lisent `intervention_periods` et supposent qu'elles ne se chevauchent pas (météo, IFT, calendrier) | N3 | recenser par `grep intervention_periods` ; passer par `mergePeriods` où l'unicité compte |
| Volume de positions (≈ 4,7 M sur 90 jours) | O2 | fenêtre incrémentale ; géométrie par session ; mesure en O3 |
| Pas de vraies traces avant le jeton | O, P | positions synthétiques ; recette réelle reportée aux points de contrôle O et P |
| Applicateur SQL et TS qui divergent | R1 | mêmes cas de test des deux côtés |
| zero-mobile en retard sur le contrat | R3 | refus explicite (`failed`) plutôt qu'un aplatissement silencieux |

## 9. Estimation (indicative)

| Lot | Phases | Charge |
|---|---|---|
| N | 4 | ≈ 1,5 j |
| O | 4 | ≈ 1,5 j |
| P | 3 | ≈ 1 j |
| Q | 2 | ≈ 0,5 j |
| R | 3 | ≈ 1 j |
