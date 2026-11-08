# Interventions : plan de réalisation

> Source : `claudedocs/exigences_interventions.md` (exigences validées le
> 2026-11-08). Plan seulement : la réalisation se fait avec `/sc:implement`,
> phase par phase. Le **lot 1 (écrans)** est détaillé ; les lots 2 (phyto,
> IFT) et 3 (météo) sont esquissés, à détailler quand le lot 1 est livré.

## État (2026-11-08)

**Lot 1 réalisé** : P0 `58b427e`, P1 `053c361`, P5 `1a1fbce`, P2 `64745c2`,
P3 `d5e21d8`, P4 `fa78ee9`, P6 `afd80cf`, P7 (finitions, captures du site,
chargement des fixtures). Essai complet en lecture seule sur les fermes de
Pierre (612 interventions, 2015–2026) et de Frédéric (151, 2020–2023) :
aucun nom non résolu, aucune erreur.

Constaté pendant l'essai, à décider :

- **Cible rattachée à la mauvaise parcelle (migration)** : pour une cible
  « Plant », la reprise prend la parcelle support de la production
  Ekylibre ; quand ce lien est faux dans Ekylibre, la zone de travail tombe
  sur une autre parcelle (ex. semis du 15/01/2021 chez Pierre : zone de
  2,38 ha entièrement sur Sarthou, rattachée à Monassut). 12 interventions
  chez Pierre, 2 chez Loubes, 0 chez Frédéric. Correctif possible : préférer
  la parcelle qui contient la zone de travail, puis remigrer.
- **Fixtures locales** : d'anciennes périodes restaient à côté des nouvelles
  après un rechargement (corrigé dans `loadFixture`, P7).

## 0. Point de départ (constaté dans le code)

| Existant | Où | Ce qu'on en fait |
|---|---|---|
| Contre-passation des mouvements d'une intervention réalisée | `packages/domain/src/interventions.ts` → `planCorrection` | base de la correction tracée : contre-passer, puis repasser avec les nouvelles données |
| Correction d'état avec audit avant/après | `packages/domain/src/corrections.ts` | modèle pour l'audit (le motif y est **obligatoire** ; pour les interventions il sera facultatif) |
| Lecture d'une intervention | `apps/api/src/repos/interventions.ts` → `readIntervention` | exposée par `GET /interventions/:id` |
| Routes : liste, planifier, valider, annuler | `apps/api/src/routes/interventions.ts` | ajout de lecture et de modification |
| `workedAreaM2`, `workingZone` | contrats + `intervention_parameters.working_zone` | remplis par la saisie sur carte |
| Surface des parcelles | PostGIS `ST_Area(…::geography)` | **référence** des surfaces : le client affiche un aperçu, le serveur recalcule |
| Campagnes | table `campaigns` (`starts_on`, `stops_on`), sans état « close » | « close » = `stops_on` dépassée |
| Carte | `maplibre-gl` 6.16 (`features/map/ParcelMap.tsx`) | sert de base aux outils carto |
| Frise | `components/Timeline.tsx` (une date) | la semaine se déduit de la date de la frise |
| Icônes | `ekylibre/agric`, licence **MIT** (police Fontello) | à intégrer dans le dépôt, avec la licence |

Aucune bibliothèque de dessin ni de géométrie côté web aujourd'hui.

## 1. Lot 1 : écrans des interventions

### Ordre et dépendances

```
P0 Socle API et contrats ──┬─> P2 Fiche + modification ──┬─> P3 Vues de l'index ──> P4 Recherche
                           │                             │
P1 Icônes agric ───────────┘ (utilisées par P2, P3)      └─> P6 Saisie sur carte ──> P7 Finitions
                                                              ▲
P5 Outils carto (CARTO-1) ────────────────────────────────────┘
```

P0, P1 et P5 sont indépendants et peuvent démarrer en parallèle. P5 est le
plus risqué (choix de bibliothèque, surfaces) : le commencer tôt.

### P0 Socle API et contrats

Exigences : INT-UI-2, INT-UI-3, INT-UI-4 (données), INT-UI-5 (données).

1. **Contrats** (`@fourmy/contracts`)
   - `interventionUpdateWrite` : mêmes champs que la planification, plus un
     `reason` facultatif.
   - Entrée d'historique : auteur, date, motif, différences avant/après.
   - Statut affiché `in_progress` **calculé** (planifiée dont la première
     période a commencé) : une fonction pure `displayStatus(intervention, now)`,
     pas un nouveau statut en base.
2. **Domaine**
   - `planInterventionUpdate` : planifiée → mise à jour directe ; réalisée →
     `planCorrection` (contre-passation) + nouveaux mouvements, audit avec le
     détail avant/après ; annulée → refus.
   - Alerte (non bloquante) si la campagne de l'intervention est close.
   - Idempotence : une même correction rejouée n'est appliquée qu'une fois
     (identifiant client de la correction).
3. **API**
   - `GET /interventions/:id` (avec son historique de corrections).
   - `PUT /interventions/:id` : modification ou correction, réponse avec les
     alertes éventuelles.
   - `GET /interventions?campaign=…` : toutes les interventions d'une
     campagne (base de la semaine, du kanban et de la recherche). Volume
     constaté : quelques centaines par campagne au plus, le filtrage fin se
     fait côté client.
   - Les mouvements de stock et le registre phyto se recalculent comme
     aujourd'hui (somme des mouvements).

**Contrôle P0** : tests du domaine (planifiée, réalisée, annulée, campagne
close, correction rejouée) ; tests d'intégration API : après correction
d'une dose, le stock et le registre phyto montrent la nouvelle quantité,
l'historique l'ancienne. Isolation des fermes (RLS) vérifiée sur les deux
nouvelles routes.

### P1 Icônes agric (INT-UI-1)

1. Intégrer les icônes d'`ekylibre/agric` dans le dépôt, avec sa licence
   MIT ; de préférence en **SVG** (une icône = un fichier, chargée à la
   demande) plutôt que la police entière.
2. Ajouter `icon` à chaque procédure du catalogue (`@fourmy/contracts`) et
   une icône par forme (repli).
3. Composant `ProcedureIcon` (taille, libellé accessible).

**Contrôle P1** : test qui vérifie que chacune des 37 procédures utilisées
par les pilotes a une icône existante, et que les autres retombent sur
l'icône de leur forme.

### P2 Fiche et modification (INT-UI-2, INT-UI-3)

1. Routes web `/f/:farm/interventions/:id` (fiche) et
   `/f/:farm/interventions/:id/modifier`.
2. **Fiche** : procédure et icône, statut, périodes, parcelles avec
   mini-carte, intrants (dose par ha et total), sorties et destination,
   matériels, intervenants, motifs, notes, origine, trace GPS du jour si elle
   existe, historique des corrections.
3. **Modification** : `InterventionForm` en mode édition (pré-rempli).
   Réalisée → bandeau « correction tracée », motif facultatif, alerte si la
   campagne est close. Annulée → pas de bouton Modifier.
4. Toute intervention affichée ailleurs (liste, kanban, calendrier, carte)
   ouvre sa fiche.

**Contrôle P2** : e2e « ouvrir une intervention, corriger la dose, voir
l'historique et le nouveau stock ».

### P3 Vues de l'index (INT-UI-4)

1. **Semaine** : bandeau du lundi au dimanche, semaine précédente/suivante,
   « cette semaine » ; la semaine suit la date de la frise et la met à jour.
2. **Sélecteur de vue** Liste / Kanban / Calendrier, mémorisé dans l'adresse
   (`?vue=`) et, à défaut, dans le navigateur.
3. **Liste** : tableau triable (date, procédure, parcelles, intrants, statut).
4. **Kanban** : colonnes Planifiée, En cours (calculée), Réalisée, Annulée.
   Glisser vers « Réalisée » ouvre la validation existante ; vers
   « Annulée » demande confirmation. Glisser-déposer accessible au clavier.
5. **Calendrier** : grille de la semaine ; chaque période d'une intervention
   apparaît à son créneau (une intervention sur plusieurs demi-journées
   apparaît plusieurs fois).

**Contrôle P3** : e2e par vue ; la vue est conservée au changement de
semaine ; une intervention viticole sur plusieurs périodes (ferme de test
viticole) apparaît sur chacune au calendrier.

### P4 Recherche rapide (INT-UI-5)

Champ de recherche en vue Liste, sur toute la campagne affichée :
procédure, parcelle, produit (nom, n° AMM), matériel, intervenant, notes.
Insensible aux accents et à la casse. Filtrage côté client sur les données
de la campagne (P0).

**Contrôle P4** : test unitaire de la normalisation ; mesure sur la campagne
la plus chargée de Pierre (objectif < 200 ms).

### P5 Outils carto mutualisés (CARTO-1)

Le seul vrai choix technique du lot : à valider au début de la phase.

1. **Bibliothèques (proposition)** : `terra-draw` (dessin et édition sur
   MapLibre : polygone, ligne, point, sélection, déplacement de sommets) et
   `@turf/*` (découpe, fusion, mesure). Versions publiées depuis au moins
   deux semaines.
2. **Découpage** :
   - `packages/carto` (nouveau) : opérations géométriques **pures**
     (découper, fusionner, intersecter avec une parcelle, mesurer), sans
     dépendance à la carte ; testables et réutilisables (y compris plus tard
     par le mobile).
   - `apps/web/src/carto/` : la barre d'outils et l'adaptateur MapLibre
     (modes dessin, découpe, mesure, fusion, redimensionnement, sélection
     multiple).
3. **Surfaces** : le client affiche un aperçu (`@turf/area`) ; le serveur
   recalcule avec PostGIS (référence du parcellaire). Mesurer l'écart sur les
   parcelles des pilotes, et arrondir l'affichage pour qu'aperçu et valeur
   enregistrée ne se contredisent pas.

**Contrôle P5** : tests de `packages/carto` (découpe d'une parcelle par une
ligne, fusion de deux parcelles voisines, zone qui déborde de sa parcelle,
géométries invalides) ; comparaison aperçu/PostGIS sur les parcelles de
Pierre et de Frédéric ; page de démonstration des outils pour l'essai à la
main.

### P6 Saisie sur carte (INT-UI-6)

1. Bascule Liste / Carte dans le formulaire, sélection partagée entre les
   deux.
2. Carte du parcellaire **à la date de l'intervention** ; parcelles absentes
   à cette date non sélectionnables.
3. Sélection multiple (clic, rectangle) ; dessin d'une **zone partielle**,
   découpée sur sa parcelle (P5), qui remplit `workingZone` et
   `workedAreaM2`.
4. Surface totale affichée ; elle alimente les doses par hectare.

**Contrôle P6** : e2e « choisir trois parcelles sur la carte, dessiner une
zone partielle dans l'une, vérifier la surface et la dose totale
calculée ».

### P7 Finitions du lot 1

- `docs/interventions.md` : fiche, correction tracée, vues, saisie sur carte.
- Captures du site public à refaire (`e2e/captures.spec.ts`, intervention).
- Commits avec la ligne `Public:` pour les nouveautés visibles.
- Essai complet sur les fermes réelles en local (Pierre, Frédéric), puis
  poussée vers dev.fourmy.org.

### Points de contrôle du lot 1

| Après | On vérifie | Avec qui |
|---|---|---|
| P0 | règles de correction (tests verts) | — |
| P5 étape 1 | choix des bibliothèques | toi, avant d'aller plus loin |
| P2 | fiche et correction sur la ferme de Pierre en local | toi |
| P3 + P4 | vues et recherche sur les fermes réelles | toi |
| P6 | saisie sur carte sur les fermes réelles | toi, puis poussée sur dev |

À chaque phase : `pnpm turbo run build lint typecheck test`, e2e concernés.

## 2. Lot 2 : réglementation phyto et IFT (esquisse)

| Étape | Contenu | Dépend de |
|---|---|---|
| L2.0 Repérage Lexicon | Vérifier ce que l'API osfarm (port 8888) expose : produits, usages, risques, cours d'eau, points d'eau ; à défaut, lecture de la base | — |
| L2.1 Référentiel (PHY-1) | Tables phyto dans Fourmy, synchronisation automatique par le worker depuis l'API Lexicon, version affichée | L2.0 |
| L2.2 Données spatiales (GEO-1) | Cours d'eau et points d'eau autour de chaque ferme (emprise du parcellaire + marge), stockés et disponibles hors connexion | L2.0 |
| L2.3 Articles (PHY-2) | Créer un article depuis le référentiel ; rattachement automatique des phytos migrés par AMM, liste des autres | L2.1 |
| L2.4 Contrôles (PHY-3) | Fonctions pures du domaine : autorisation, dose maximale, nombre d'applications, ZNT (distance réelle, L2.2 et zone de P6), DAR, ré-entrée ; logique tirée d'Ekylibre (`app/services/phytosanitary`, `registered_phytosanitary_usage_dose_computation.rb`) et de cropivia | L2.1, L2.2, P6 |
| L2.5 Formulaire et fiche (PHY-3, PHY-4) | Feux dans le formulaire, confirmation + motif sur feu rouge, affichage sur la fiche, la parcelle et le registre | L2.4, P2 |
| L2.6 IFT (IFT-1) | Client de l'API IFT v5 ; identifiants Ekylibre SAS en variables du serveur, IFT indisponible sans elles ; IFT « en attente » si l'API ne répond pas ; bilan de campagne | compte api.agriculture.gouv.fr |

**Prérequis à lancer dès maintenant** : création du compte Ekylibre SAS sur
api.agriculture.gouv.fr (recette puis production).

## 3. Lot 3 : météo (esquisse)

| Étape | Contenu | Dépend de |
|---|---|---|
| L3.1 Intégrations (MET-1) | Fournisseurs `open_meteo` (sans clé, actif par défaut), `openweather`, `meteoblue` dans le catalogue d'intégrations existant ; clé testée, chiffrée, jamais réaffichée | — |
| L3.2 Clé de Pierre | Reprise de la clé OpenWeather depuis son export Ekylibre (lecture seule, jamais affichée), saisie dans ses Intégrations | L3.1 |
| L3.3 Météo de l'intervention (MET-2) | Température, hygrométrie, vent, pluie pré-remplis selon la position des parcelles et l'heure ; historique pour le passé, prévision pour le planifié, observé à la validation ; source enregistrée | L3.1, P2 |
| L3.4 Conditions de pulvérisation (MET-3) | Créneaux favorables ou non avec la raison, seuils d'Ekylibre (`weather_spraying_cells_controller.rb`) ; tableau de bord et formulaire de traitement | L3.1 |

## 4. Risques

| Risque | Parade |
|---|---|
| Bibliothèque de dessin mal adaptée à MapLibre 6 | essai en début de P5, point de contrôle avec toi avant de construire dessus |
| Écart de surface entre aperçu client et PostGIS | le serveur fait foi ; écart mesuré en P5, affichage arrondi |
| Correction d'une intervention ancienne qui fait passer un stock en négatif | même règle qu'à la validation aujourd'hui, appliquée à la nouvelle version |
| Lexicon n'expose pas tout par son API | L2.0 avant tout développement du lot 2 |
| Compte IFT tardif | le lot 2 se livre sans IFT (indisponible, affiché comme tel) |
