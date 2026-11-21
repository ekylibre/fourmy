# Assolement, temps 2 (itinéraires techniques) — plan de réalisation

*Plan du 21/11/2026, d'après [`besoins_assolement.md`](besoins_assolement.md) §5 (FR-AS-20 à 25, décisions A13 à A15) et [`conception_assolement_itk.md`](conception_assolement_itk.md), en particulier ses §13 (questions tranchées) et §15 (écarts après examen des données). Issue #114, avec #116. Exécution lot par lot avec `/sc:implement`.*

## 1. Règles communes

- **Une branche et une PR par lot**, partie de `main` : `feat/itk-it<n>-…`. On ne pousse et on n'ouvre de PR qu'après accord.
- **Avant chaque push** :

  ```
  NODE_OPTIONS=--no-experimental-webstorage DATABASE_URL=postgres://fourmy:fourmy@localhost:5434/fourmy FOURMY_LEXICON_PACKAGES_URL=off corepack pnpm turbo run typecheck lint test --continue
  ```

  On y ajoute l'e2e Playwright pour les lots qui touchent l'interface. Pas de prettier.
- **Migrations à la suite** : 0077 (IT1), 0078 (IT3), 0079 (IT4).
- **Données des testeurs** : les jeux de test sont anonymisés (« Le Champ », « ferme pilote »). Aucun nom de ferme ou de personne, aucun fichier réel dans le dépôt. Les ITK réels des deux fermes se créent dans leur base, pas dans le dépôt.
- **Barème BCMA** : accord du CEGARA et du BCMA obtenu le 21/11/2026. Le CSV extrait est versionné avec sa source ; les PDF ne le sont pas.
- **Chaque lot met à jour la section « Réalisé » de ce plan.** La documentation utilisateur s'écrit au fil des lots et se termine en IT6.

## 2. Enchaînement

```mermaid
flowchart LR
  IT1[IT1 Socle ITK\nmodèle, API, éditeur] --> IT2[IT2 ITK depuis l'historique\n+ premiers ITK des 2 fermes]
  IT1 --> IT3[IT3 ITK dans l'assolement\ninterventions prévues sur demande, #116]
  IT1 --> IT4[IT4 Temps de travaux\nBCMA, OSRM, pointes]
  IT1 --> IT5[IT5 Besoins en intrants\nstocks, plan de fumure]
  IT2 --> IT6[IT6 Récapitulatif, doc, recette]
  IT3 --> IT6
  IT4 --> IT6
  IT5 --> IT6
  IT6 --> IT7[IT7 option\nchantiers multi-parcelles]
  OSRM[Graphe OSRM aquitaine + pays-de-la-loire] -.-> IT4
```

- IT2, IT3, IT4 et IT5 peuvent avancer en parallèle après IT1. **Ordre conseillé** : IT2 d'abord, parce que les ITK réels des deux fermes servent à la recette des lots suivants. Ensuite IT3, IT4 et IT5.
- **Hors code** : chargement de la région Pays de la Loire dans OSRM sur le serveur au déploiement d'IT4 (validé le 21/11/2026).
- **Décisions du 21/11/2026** : recommandations du §13 de la conception validées ; accord BCMA / CEGARA obtenu ; Pays de la Loire validé ; regroupement multi-parcelles en option (IT7).

## 3. Lots

### IT1 — Socle : modèle, API et éditeur d'ITK (taille L)

**But** : créer, modifier, dupliquer et voir un ITK de la ferme, sans lien avec l'assolement.

- **Migration 0077** :
  - table `technical_itineraries` (conception §4.1), RLS `farm_isolation`, droits `fourmy_app` ;
  - `UNIQUE (farm_id, name)` ;
  - `CHECK` sur `system`, `cycle`, `origin`.
- **Contrat** `packages/contracts/src/technical-itinerary.ts` :
  - `stepAnchor` (semis, récolte, date avec `yearOffset`), `itineraryInput`, `itineraryStep` (avec `staffing.machineryRateId` et `evidence`, §15.4), `technicalItineraryContent` (`schema: 1`, sans `years`) ;
  - lecture, écriture, résumé de liste.
  - Validation :
    - procédure connue de `PROCEDURES` ;
    - unité compatible avec la nature de l'article ;
    - `share` entre 0 et 1, `repeat.count` entre 1 et 20 ;
    - identifiants d'étape uniques.
- **Domaine** `packages/domain/src/itk/` :
  - `schedule.ts` : `scheduleSteps(content, { sowingOn, harvestOn, year })`, qui rend les dates par étape et par passage. Une ancre manquante donne « à préciser ». Une date fixe avec `yearOffset = -1` tombe l'année précédente ;
  - `missing.ts` : articles, matériels et personnes disparus, à remplacer.
- **API** `apps/api/src/routes/technical-itineraries.ts` et `repos/technical-itineraries.ts` :
  - `GET` liste, `GET :id`, `POST`, `PUT :id` (révision, 409), `POST :id/copy` ;
  - `DELETE` désactive quand l'ITK est référencé et supprime sinon. Au lot IT1, « référencé » se limite aux brouillons, puis IT3 l'étend aux productions et interventions ;
  - lecture pour les membres, écriture pour le responsable.
- **Web** `apps/web/src/features/itk/` :
  - route `/f/:ferme/itineraries`, onglet « Itinéraires » de la page Activités, lien depuis la page d'une activité ;
  - catalogue : liste par activité, filtres actif / inactif, Créer, Dupliquer ;
  - éditeur :
    - tableau des étapes (insérer depuis la liste des procédures, dupliquer, réordonner, supprimer) ;
    - ancre « J±n du semis / de la récolte / date » ;
    - plage, passages, part, facultative ;
    - intrants (article de la ferme ou libellé libre, dose, unité) ;
    - matériels, personnes ou attelage type ;
    - débit saisi ;
  - **aperçu sur la frise TIKA** : `buildActivityItinerary` reçoit les étapes datées sur un semis et une récolte d'exemple (dates Lexicon de la production de référence), avec le statut `planned` ;
  - le résumé par hectare (heures, intrants) s'affiche « à venir » jusqu'à IT4 et IT5.

**Tests** :
- domaine : `scheduleSteps` (J-30 du semis, J+3 de la récolte, 15/02 avec 3 passages tous les 30 jours, 20/09 de l'année précédente, ancre manquante) ; refus du contenu (procédure inconnue, unité incompatible, `share` 1,2) ;
- API : création, 409 sur une révision périmée, copie, suppression ou désactivation, droits d'un membre non responsable ;
- web : l'éditeur ajoute, duplique et réordonne une étape, et la frise se met à jour ;
- e2e : créer « Blé tendre — Le Champ » à 5 étapes et le voir sur la frise.

**Point de contrôle** : un ITK saisi à la main s'enregistre, se relit et se duplique, et la frise montre ses étapes.

### IT2 — ITK depuis l'historique et premiers ITK des deux fermes (taille M)

**But** : « Créer l'ITK depuis 2026 », puis les ITK réels de l'exploitant testeur (Maïs) et de la GAEC (blé, orges, maïs fourrage, colza, féverole, lin, prairies, luzerne).

- **Domaine** `itk/derive.ts` : `deriveItinerary(input)` (conception §5 et §15.2) :
  - ancre du semis = `started_on`, sinon première intervention de forme `sowing` de la production ; production sans ancre écartée et comptée ;
  - surface travaillée = `workedAreaM2`, sinon surface de la parcelle ciblée à la date ;
  - regroupement par procédure, par écart (7 jours, 15 pour la récolte, comme `groupMarks`) ; décalage médian, plage interquartile, part, facultative sous 50 % ;
  - doses médianes à l'hectare, converties avec `seeds/units` et `quantities` ; intrants non convertibles gardés tels quels et signalés ;
  - matériels et personnes les plus fréquents ; sinon `people: 1`, « à compléter » ;
  - débit observé seulement pour les interventions à l'heure près, hors `import`, avec matériel, entre 0,1 et 50 ha/h, s'il y en a au moins 3 ;
  - `evidence` par étape (« 9 parcelles sur 11, 2026, du 12/10 au 20/10 »).
- **API** : `POST /technical-itineraries/derive { activityId, campaigns[] }`. Il rend le contenu proposé et des statistiques (productions retenues et écartées) et n'écrit rien. Les campagnes possibles sont celles où l'activité a des interventions réalisées.
- **Web** :
  - bouton « Créer depuis l'historique » (catalogue et page d'une activité) : choix de l'activité et des campagnes, la proposition s'ouvre dans l'éditeur, les preuves de chaque étape sont en info-bulle et un bandeau indique ce qui est à compléter ;
  - « Enregistrer » crée l'ITK avec `origin = 'history'` et `source`.
- **Donnée, hors dépôt** : sur la base de développement, puis sur dev.fourmy.org après déploiement :
  - créer les ITK de l'exploitant testeur (Maïs 2024 à 2026) et de la GAEC (une activité par ITK, campagnes 2025 et 2026) ;
  - noter ce qui manque (travail du sol de la GAEC, matériels) dans la section « Réalisé » ;
  - faire relire les ITK par les deux exploitants : l'issue #112 s'élargit, sinon on ouvre une nouvelle issue.

**Tests** :
- domaine, sur un jeu anonymisé construit à partir des deux profils observés :
  - historique à l'heure avec matériels, sans date de semis : ancre sur le semis, débit observé ;
  - import au jour près sans matériel : aucun débit observé, « à compléter » ;
  - étape faite sur 4 parcelles sur 10 : facultative ;
  - dose en grains/m² ramenée en kg/ha ;
- API : `derive` n'écrit rien ; activité d'une autre ferme refusée.

**Point de contrôle** : sur la base de développement, « Créer depuis 2025 et 2026 » donne pour le Maïs de l'exploitant testeur un ITK de 5 à 9 étapes, avec un semis tout-en-un daté et des débits observés là où les périodes existent. Pour le blé de la GAEC, on obtient 4 ou 5 étapes sans matériel, avec des doses.

### IT3 — ITK dans l'assolement et interventions prévues sur demande (taille L)

**But** : choisir l'ITK à l'affectation, puis préparer les interventions prévues d'une campagne, avec #116.

- **Migration 0078** :
  - `interventions.itinerary_ref jsonb` ;
  - index unique partiel (production, étape, passage) hors annulées ;
  - origine `itinerary` ajoutée à `interventions_origin_check`.
- **Assolement** :
  - `Assignment.itineraryId` est utilisé dans le panneau Affecter : sélecteur avec les ITK de l'activité, puis ceux de la même production de référence ; défaut = celui de l'activité au dernier assolement validé ; choix « Aucun » et « Créer depuis l'historique… » ;
  - résumé de l'ITK sous le formulaire (étapes datées par `scheduleSteps` sur les dates de l'affectation) ;
  - `diffPlan` et la validation copient `itineraryId` dans `productions.attrs.itineraryId` (`ProdFields`).
- **Domaine** `itk/propose.ts` et `itk/reconcile.ts` (conception §7) :
  - `proposeInterventions(productions, itineraries, context)` : une intervention par production, étape et passage ; surface = `share` × surface ; quantités = dose × surface ; attelage type copié ; `hash` de ce qui est écrit ;
  - `reconcile(proposals, existing)` : les 5 cas du tableau du §7.
- **API** `routes/planned-interventions.ts` :
  - `POST /planned-interventions/:year/preview { productionIds? }` rend l'aperçu et `previewHash`. Il passe les contrôles phyto et nitrates existants sur les interventions proposées, à titre d'information ;
  - `POST /planned-interventions/:year { previewHash, accepted[], dateEdits }`, en une transaction. Il crée, met à jour, ou annule (`cancelled`), et rend 409 si l'aperçu a changé. Il réutilise l'écriture des interventions prévues existante (même validation que la saisie web).
- **#116 (découpe)** :
  - à la validation d'une découpe, les interventions générées non modifiées de la production d'origine sont annulées, et la fenêtre propose « Préparer les interventions prévues » sur les morceaux ;
  - les interventions prévues manuelles se reportent sur un morceau (`intervention.retarget`, existant) ou se répartissent sur chaque morceau au prorata (nouveau changement `intervention.split` dans `diffPlan` et la validation) ;
  - l'annulation d'une découpe validée applique la règle du temps 1 : les interventions prévues des morceaux reviennent sur la parcelle rouverte, et les générées sont annulées.
- **Web** :
  - bouton « Préparer les interventions prévues 2027 » sur l'assolement validé (Récapitulatif) et sur la page d'une activité ;
  - aperçu groupé par production : cases à cocher (étapes facultatives décochées), dates modifiables, états (à créer, à mettre à jour, à retirer, conservée « modifiée à la main » ou « réalisée ») et constats phyto ou nitrates ;
  - le compte rendu renvoie au calendrier.

**Tests** :
- domaine : `reconcile` sur les 5 cas ; deux générations successives sans changement ne produisent rien de nouveau ; étape retirée de l'ITK → intervention à retirer ; intervention modifiée → conservée ;
- API : aperçu puis confirmation ; 409 sur un aperçu périmé ; intervention réalisée jamais touchée ; découpe avec une intervention générée (annulée) et une manuelle (reportée ou répartie) ; annulation d'une découpe ; droits ;
- e2e : affecter un ITK dans l'assolement 2027, valider, préparer les interventions prévues, les voir dans le calendrier et sur la frise de la parcelle.

**Point de contrôle** : relancer « Préparer » deux fois de suite ne crée rien de plus. Une intervention prévue déplacée à la main reste à sa date.

### IT4 — Temps de travaux : barème BCMA, trajets OSRM, pointes (taille L)

**But** : heures au champ et sur la route, kilomètres et pointes de travail de l'assolement, calculés sur le brouillon.

- **Référentiel BCMA** (conception §15.3) :
  - **migration 0079** : table `ref_machinery_rates` (id, famille, libellé, `width_m`, unité, `performance_per_h`, prix d'achat, utilisation annuelle, coûts fixe et variable, édition, source) ; colonne `equipments.machinery_rate_id` ;
  - script d'extraction `packages/certification-refs/scripts/extract-bcma.ts` (lancé à la main) : il lit le texte `pdftotext -layout` des guides « Coût des façons culturales 2024 » (grandes cultures, puis viti-arbo), recolle les libellés sur deux lignes, lit la largeur dans le libellé et écrit `packages/certification-refs/data/bcma-2024.csv`. Un rapport donne le nombre de lignes lues et non lues (cible : 825 lues sur 846) ; les lignes non lues sont reprises à la main ;
  - le CSV est **versionné** (accord du 21/11/2026) et chargé dans `ref_machinery_rates` par la migration ou au démarrage, comme les autres référentiels ; la source (« BCMA, guide CEGARA Coût des façons culturales 2024 ») est affichée avec chaque débit ou coût qui en vient ;
  - noter l'accord (date, interlocuteurs, périmètre) dans `claudedocs/accord_BCMA.md`, sans données personnelles ;
  - **rattachement d'un matériel** : proposition automatique (nature du matériel → famille du barème, largeur la plus proche) sur la fiche du matériel, puis confirmation ; liste des matériels sans rattachement dans le récapitulatif des travaux.
- **Domaine** `itk/work-rate.ts` et `itk/workload.ts` :
  - `resolveWorkRate(step, ctx)` : saisi > observé (règles d'IT2) > barème (performance × largeur réelle / largeur de la ligne) > largeur × vitesse déduite du barème pour la famille × rendement de chantier > inconnu ; la source est rendue avec la valeur ;
  - `workload(input)` :
    - heures au champ (surface × part × passages / débit) ;
    - allers-retours = `ceil(heures / workdayHours)` × 2 trajets ;
    - heures et km par personne, matériel et procédure ;
    - semaines ISO avec étalement sur la plage, comparées à la capacité (`weeklyHoursPerPerson`) ;
    - inconnus comptés.
- **Trajets** :
  - table `parcel_routes` (migration 0079), dépôt `repos/routing.ts` ;
  - service OSRM `table` en un appel par ferme pour les parcelles sans cache valide ; repli à vol d'oiseau × 1,3 à 25 km/h (`estimate`) ;
  - départ = site des réglages, sinon le siège ;
  - `POST /crop-plans/:year/routes` pour les morceaux du brouillon.
- **OSRM** : `docker/osrm/prepare.sh` accepte plusieurs régions et les fusionne (`osmium merge`) ; il faut charger `aquitaine` et `pays-de-la-loire` en local, puis sur le serveur au déploiement, sur accord ; `docs/routage-osrm.md` est mis à jour.
- **Réglages de l'assolement** : `workdayHours` (8), `weeklyHoursPerPerson` (45), `workRateEfficiency` (0,7), `defaultSiteId`.
- **API** : `GET /crop-plans/:year/itk-context` renvoie les ITK référencés, les débits observés, les rattachements BCMA, les largeurs, les trajets, les réglages, puis les stocks et les plans de fumure en IT5.
- **Web** :
  - section « Travaux » du Récapitulatif : heures champ et route, km par personne et matériel, graphique Recharts des heures par semaine avec la ligne de capacité, et inconnus listés ;
  - résumé par hectare dans l'éditeur d'ITK (IT1) avec la source de chaque débit ;
  - débit saisi repris en un clic de la valeur observée ou du barème.

**Tests** :
- script BCMA sur la fixture : libellé sur deux lignes, largeur lue (« 4 m », « 3.5 m », « rampe 24 m »), ligne non lue rapportée ;
- domaine : ordre des sources du débit ; mise à l'échelle de la largeur ; allers-retours (3,5 h → 1 jour, 12 h → 2 jours) ; étalement sur une plage de ± 7 jours ; capacité dépassée ; inconnus ;
- API : cache des trajets (deuxième appel sans OSRM), repli sans OSRM (`FOURMY_OSRM_URL` vide), empreinte modifiée qui invalide le cache ;
- e2e : assolement 2027 avec ITK, onglet Travaux, heures et graphique affichés.

**Point de contrôle** : pour le Maïs de l'exploitant testeur, les heures prévues à l'hectare sont du même ordre que les heures réalisées en 2026, à ± 30 %. Pour la GAEC, chaque débit vient du barème ou est saisi, et aucun n'est « observé ».

### IT5 — Besoins en intrants (taille M)

**But** : quantités à prévoir par article, comparées aux stocks.

- **Domaine** `itk/needs.ts` : `inputNeeds(input)` (conception §9) :
  - quantité = dose × surface × part × passages ; étapes facultatives à part ;
  - conversion vers l'unité du stock (`seeds/units`, `quantities`) ; non convertibles comptés ;
  - regroupement par article, intrants génériques regroupés par libellé et unité ;
  - stock disponible (`computeStock`) moins les interventions prévues hors assolement de la campagne : à acheter, ou couvert ;
  - **plan de fumure établi prioritaire** sur les étapes de fertilisation minérale de l'ITK pour sa production (source affichée).
- **API** : `itk-context` ajoute les stocks par article et les apports prévus des plans de fumure établis de la campagne.
- **Web** : section « Intrants » du Récapitulatif (semences, engrais, phyto, autres), avec besoin, stock, à acheter et source ; lien vers la fiche de l'article ; inconnus listés.

**Tests** :
- domaine : maïs à 9 grains/m² sur 10 ha → kg puis doses ; engrais avec et sans plan de fumure ; intrant générique ; non convertible ; stock déjà réservé par une intervention prévue ;
- API : contexte avec stocks et plans de fumure ;
- web : tableau et sources.

**Point de contrôle** : les besoins en semences de l'assolement 2027 se recoupent avec ceux de « Utilisation des semences » (SE7) une fois les interventions prévues générées.

### IT6 — Récapitulatif, documentation et recette (taille S)

**But** : boucler le temps 2.

- Récapitulatif par activité et pour l'assolement : heures, km et intrants, avec l'écart à la campagne précédente (réalisé) quand il existe.
- Documentation :
  - nouveau `docs/itineraires-techniques.md` (ITK, création depuis l'historique, débits et leurs sources, barème BCMA, interventions prévues) ;
  - mise à jour de `docs/assolement.md`, de `docs/routage-osrm.md` et de l'aide en ligne.
- Mettre à jour `points_ouverts.md` : la ligne 124 est faite. Ouvrir les issues des suites : ITK pluriannuels, partage entre fermes.
- e2e de bout en bout : ITK depuis l'historique → assolement 2027 → travaux et intrants → validation → interventions prévues → calendrier.
- **Recette** avec l'exploitant testeur sur dev.fourmy.org (après déploiement, sur accord), retours dans `docs/assolement/retour_test.md` (hors dépôt).

### IT7 — Option : chantiers multi-parcelles (taille M, après IT6)

**But** : regrouper en une intervention prévue les parcelles d'une même étape à la même date, au choix dans l'aperçu (case « Regrouper par chantier »).

- Migration : table `intervention_itinerary_links (intervention_id, production_id, step_id, occurrence)`, unique sur (production, étape, passage) hors annulées ; reprise des `itinerary_ref` existants ; l'index partiel d'IT3 est retiré.
- `proposeInterventions` regroupe par (ITK, étape, passage, date) ; `reconcile` travaille par lien. Une intervention regroupée partiellement réalisée ou modifiée garde ses liens et n'est pas recomposée.
- #116 : une découpe retire la production d'origine du chantier, sans toucher aux autres parcelles.
- Temps de travaux : un aller-retour par chantier et par journée, avec un trajet de parcelle à parcelle (OSRM `table`).

**Tests** : regroupement et dégroupement ; idempotence ; chantier partiellement réalisé ; découpe d'une parcelle d'un chantier.

## 4. Points de contrôle

| Après | Vérification |
|---|---|
| IT1 | ITK saisi, relu, dupliqué ; frise juste ; 409 sur une révision périmée |
| IT2 | ITK des deux fermes créés depuis l'historique et relus ; ce qui manque est noté |
| IT3 | génération idempotente ; rien d'écrasé ; #116 couvert |
| IT4 | heures prévues proches du réalisé chez l'exploitant testeur ; sources des débits visibles ; OSRM et repli |
| IT5 | besoins cohérents avec SE7 ; plan de fumure prioritaire |
| IT6 | e2e complet vert ; documentation ; recette |

## 5. Risques

| Risque | Parade |
|---|---|
| Barème BCMA daté (édition 2024) | Édition gardée sur chaque ligne ; script d'extraction rejouable sur l'édition suivante. |
| ITK de la GAEC incomplets (pas de travail du sol, pas de matériel) | Éditeur rapide (insérer, dupliquer), type de matériel du barème sans matériel de la ferme, relecture par l'exploitant. |
| Durées des interventions reprises d'Ekylibre peu fiables | Débit observé seulement à l'heure près, au moins 3 chantiers, valeurs aberrantes écartées. La comparaison au réalisé (point de contrôle IT4) se fait à ± 30 %. |
| Graphe OSRM multirégion trop lourd pour le serveur | Mesurer la mémoire au prétraitement d'IT4. En repli : un service par région, ou l'estimation à vol d'oiseau. |
| Interventions prévues en grand nombre (300 parcelles × 10 étapes) | Aperçu paginé par production et écriture par lots dans une transaction. Mesure en IT3 sur la ferme pilote. |
| Contrôles phyto lents sur des centaines d'interventions proposées | Contrôle par couple (produit, culture) mis en cache dans l'aperçu. |

## 6. Réalisé

### IT1 — Socle : modèle, API et éditeur d'ITK (21/11/2026)

- **Migration 0077** : table `technical_itineraries` (RLS, `UNIQUE (farm_id, name)`, index par activité).
- **Contrat** `packages/contracts/src/technical-itinerary.ts` : `itkAnchor`, `itkInput`, `itkStep` (avec `staffing.machineryRateId` et `evidence`), `itkContent`, `itkWrite`, `ItkSummary`, `ItkDetail`, `ItkMissing`, `ITK_DOSE_UNITS`, `itkUnitAllowed`, `itkProcedureAllowed`.
- **Domaine** `packages/domain/src/itk/` : `scheduleSteps`, `anchorDate`, `anchorLabel` ; `itkMissing`, `itkReferences` ; `itkPreview` (frise TIKA).
- **API** `routes/technical-itineraries.ts`, `repos/technical-itineraries.ts` : liste (filtre activité, actif), fiche (éléments à remplacer, dates d'exemple), création idempotente, modification avec révision (409 + version du serveur), copie, suppression ou désactivation.
- **Web** `features/itk/` : catalogue `/f/:ferme/itineraries` (accès depuis Activités et depuis l'itinéraire d'une activité), éditeur `/f/:ferme/itineraries/:id` (tableau des étapes, fenêtre d'étape, trier par date, dupliquer, 409 : recharger ou écraser), aperçu TIKA sur des dates d'exemple modifiables.
- **Tests** : domaine `itk.test.ts` (7), API `technical-itineraries.integration.test.ts` (6), web `itk-editor.test.tsx`, e2e `itk.spec.ts`.

**Écarts avec la conception** :
- Préfixe `Itk` pour les types : `ItineraryStep` et `TechnicalItinerary` désignent déjà la frise TIKA (`contracts/itinerary.ts`).
- Procédures acceptées : catalogue Fourmy **et** codes repris d'Ekylibre ayant un libellé officiel (`PROCEDURE_LABELS`), pour que les ITK proposés depuis l'historique (IT2) gardent les procédures reprises ; l'entretien du matériel est refusé. Un intrant doit être d'une nature acceptée par la procédure.
- Références : un article, matériel, intervenant ou attelage type doit être de la ferme, sauf s'il figurait déjà dans la version enregistrée (supprimé depuis : gardé, « à remplacer »).
- Suppression : « utilisé » = cité par un brouillon d'assolement, une version validée ou une production (`attrs.itineraryId`) ; l'ITK est alors désactivé, sinon supprimé. La réponse dit lequel (`{ deleted }`).
- Dates d'exemple de l'aperçu : dates types Lexicon de la production de l'ITK, sinon de celle de l'activité, ramenées à l'an prochain ; à défaut 15/10 → 10/07.
- `ItineraryView` accepte `onIntervention` (clic sur une étape de l'aperçu) et `hint`.
- Purposes (motifs de traitement) : gardés dans le document, pas encore saisissables dans la fenêtre d'étape (IT3, avec les contrôles phyto de la génération).

### IT2 — ITK depuis l'historique (21/11/2026)

- **Domaine** `packages/domain/src/itk/derive.ts` : `assignInterventions` (une intervention va à la production de sa parcelle qui court du lendemain de la récolte précédente à la veille de la suivante), `deriveItinerary`, `doseOf` (dose à l'hectare : unités `_per_hectare`, `grain_per_square_meter`, libellés repris « Kilogramme », « Mille grains »…, grammes, hectolitres, millions de grains).
- **Contrat** : `itkDeriveRequest`, `ItkDeriveResult`, `ItkDeriveStats`, `ItkHistoryCampaign` ; `itkEvidence.observedRateHaH` et `observedSamples`.
- **API** : `GET /technical-itineraries/history?activityId=` (campagnes avec interventions réalisées), `POST /technical-itineraries/derive` (proposition, aucune écriture ; lecture pour tous les membres).
- **Web** : « Depuis l'historique » dans le catalogue et « Créer un itinéraire depuis l'historique » sur l'itinéraire d'une activité (`?derive=1`) : campagnes (les deux dernières cochées), proposition relue avec ses preuves, création (`origin = history`). Débit observé affiché dans l'éditeur et repris en un clic dans la fenêtre d'étape.
- **Tests** : domaine `itk-derive.test.ts` (10), API (proposition sans écriture, création, activité d'une autre ferme), web `itk-derive.test.tsx`.

**Données (base de développement, hors dépôt)** : 16 ITK créés depuis l'historique.
- Exploitant testeur : Maïs (2024 à 2026, 24 productions, 270 interventions, 17 étapes, débits observés : labour 1,5 ha/h, hersage 2,6 ha/h, semis tout-en-un 1,1 ha/h), Avoine (3 étapes), Triticale (1 étape) ; la Jachère n'a aucune intervention datable.
- GAEC : 13 activités (blé, orges, maïs fourrage, avoine noire, féverole, lin, carotte, épinard, prairies, luzerne, bande enherbée). Toutes les étapes sont « à compléter » (aucun matériel dans l'import) et aucun débit n'est observé, comme prévu (§15.2). Les doses viennent bien de Geofolia.
- À faire : relecture par les deux exploitants (issue #112 élargie), puis création sur dev.fourmy.org après déploiement.

**Écarts avec la conception** :
- **Cultures en place depuis plus d'une campagne** (semées avant le 1er juillet de l'année précédente : prairies permanentes) : étapes à **dates fixes** (jour/mois, année de récolte ou précédente), conformément au §13.4. Sinon le décalage au semis dépasse les bornes du contrat (constaté sur les prairies de la GAEC).
- Une récolte antérieure au semis (culture précédente restée dans la fenêtre) n'entre pas dans l'itinéraire.
- Une intervention dont le décalage sort des bornes d'une ancre (dates de production incohérentes) est ignorée.
- Procédure répétée en plus de 4 groupes (irrigation, apports fractionnés) : une seule étape à passages répétés (nombre et intervalle médians). Ses intrants ne sont gardés que s'ils servent à au moins la moitié des passages ; ils sont donc souvent vides et à compléter à la main.
- Une production sans date de semis ni de récolte (ni intervention de semis ou de récolte) est écartée et comptée (« Jachère »).

### IT3 — ITK dans l'assolement, interventions prévues sur demande, #116 (21/11/2026)

- **Assolement** : sélecteur « Itinéraire technique » dans le panneau Affecter (ITK de l'activité, puis ceux d'une activité de même espèce ; proposé d'office quand l'activité n'en a qu'un). `itineraryId` passe à `productions.attrs.itineraryId` à la validation (`cropPlanProductionFields.itineraryId`, `diffCropPlan`), et revient dans le brouillon à la réouverture.
- **Migration 0078** : `interventions.itinerary_ref` (contrôle des clés), index unique partiel (ferme, production, étape, passage) hors annulées, index par campagne.
- **Domaine** `itk/planned.ts` : `proposeInterventions`, `plannedSignature` (FNV-1a sur procédure, jour, cibles, intrants, matériels, intervenants), `reconcilePlanned` (create, update, remove, same, modified, done, undated).
- **API** `routes/planned-interventions.ts`, `repos/planned-interventions.ts` : `POST /planned-interventions/:year/preview` (membres), `POST /planned-interventions/:year` (responsable ; `previewHash`, `accepted`, `dateEdits` ; 409 si l'aperçu a changé). Écriture par `planInTx` (validation et contrôles de la saisie), une intervention par point de sauvegarde : un refus est rapporté sans annuler le reste. Verrou consultatif par ferme et campagne.
- **#116** : à la validation d'une découpe, les interventions prévues générées de la parcelle d'origine après la date d'effet sont annulées (`intervention.cancel`) ; celles saisies à la main sont reportées sur un morceau (`intervention.retarget`) ou réparties sur chaque morceau au prorata (`intervention.split` : copie de l'intervention, de ses paramètres et de ses périodes, quantités totales au prorata, doses à l'hectare gardées), au choix dans la fenêtre de validation (`plannedMoves`, `plannedToMove`).
- **Web** : « Préparer les interventions prévues » sur l'assolement validé (fenêtre d'aperçu, cases, dates, refus rapportés) ; choix du report dans la fenêtre de validation ; libellés des nouveaux changements.
- **Tests** : domaine `itk-planned.test.ts` (5) ; API `planned-interventions.integration.test.ts` (5 : ITK passé à la production, création, relance sans effet, modifiée gardée, ITK modifié, 409, réalisée intouchée, droits, découpe) ; web `itk-planned.test.tsx`.

**Écarts avec la conception** :
- **Origine** : les interventions générées gardent l'origine de l'écriture (`web`) ; c'est `itinerary_ref` qui les distingue. Ajouter `itinerary` à l'énumération des origines aurait touché la synchronisation mobile.
- **Mise à jour** = annulation de l'ancienne puis création d'une nouvelle (nouvel identifiant), plutôt qu'une réécriture en place.
- **Date modifiée dans l'aperçu** : l'empreinte enregistrée est celle de la proposition ; l'intervention compte donc comme « modifiée à la main » et n'est plus déplacée par une génération suivante.
- **Dates manquantes** : à défaut des dates de la production, les dates types Lexicon de l'activité ; sinon « à préciser ».
- **Intrants génériques** (sans article) : notés dans les notes de l'intervention (« Intrants à préciser : … »).
- **ITK par défaut** à l'affectation : celui de l'activité s'il est seul, plutôt que « celui du dernier assolement validé ».
- **Point d'entrée** : l'assolement validé seulement (pas encore la page d'une activité).
- **#116, reste ouvert** : l'annulation d'une découpe déjà validée (règle du temps 1, §6) n'est pas faite ; une intervention en attelages ou à plusieurs parcelles ne se répartit pas (un seul morceau).
- **e2e** : reporté au lot IT6 (parcours complet ITK → assolement → interventions prévues → calendrier).

### IT4 — Temps de travaux : barème BCMA, trajets, pointes (21/11/2026)

- **Barème BCMA 2024** (accord du 21/11/2026, `claudedocs/accord_BCMA.md`) : `packages/certification-refs/scripts/extract-bcma.ts` lit le texte `pdftotext -layout` des deux guides « Coût des façons culturales ». Il recolle les libellés coupés sur deux ou trois lignes, recolle les en-têtes de famille coupés, retire le symbole de la colonne « Variation » (police à usage privé) et lit la largeur dans le libellé. **1 082 matériels** (873 grandes cultures, 209 viti-arbo) ; seules les lignes d'exemple du guide restent non lues. Sorties : `data/bcma-2024.csv` et `src/work/bcma-2024.ts` (généré).
- **Référentiel** `src/work/machinery-rates.ts` : `MachineryRate`, source citée, `machineryRate`, `hectareRate`, `PROCEDURE_FAMILIES` (procédure → familles du barème), `machineryRatesFor`, `familyRatePerMeter`, `EQUIPMENT_TYPE_FAMILIES`, `suggestMachineryRate`.
- **Migration 0079** : `equipments.machinery_rate_id`, table `parcel_routes` (cache des trajets).
- **Domaine** `itk/workload.ts` : `resolveWorkRate` (saisi > observé (même procédure et même matériel, ou repris de l'historique) > barème du matériel mis à l'échelle de sa largeur, ou type du barème de l'étape > largeur × débit par mètre de la famille > inconnu), `workload` (heures au champ, journées de chantier, un aller-retour par journée, km, cumuls par matériel, personne, procédure et activité, semaines ISO avec étalement sur la plage, capacité, inconnus comptés), `itkPerHectare`, `isoWeek`.
- **API** : `GET /crop-plans/:year/itk-context` (`?routes=0` pour l'éditeur d'ITK), `GET /machinery-rates?procedure=&q=`, `GET /equipments-rates`, `PUT /equipments/:id/machinery-rate`. Le navigateur ne charge jamais le barème complet (380 Ko) : seules les lignes citées sont envoyées. Débits observés en SQL : médiane surface / durée par procédure et matériel, à l'heure près, hors imports, au moins 3 chantiers, entre 0,1 et 50 ha/h, 4 dernières campagnes.
- **Trajets** : point intérieur de chaque parcelle valide pendant la campagne, service `table` d'OSRM par paquets de 90, cache par empreinte (point et site) ; repli à vol d'oiseau × 1,3 à 25 km/h, recalculé dès qu'OSRM répond. Départ : site des réglages, sinon le siège.
- **Web** :
  - onglet **Travaux** de l'assolement (totaux, débits par source, inconnus, graphique des heures de main-d'œuvre par semaine avec la capacité, cumuls par personne, matériel, activité et intervention) ;
  - colonne Débit de l'éditeur d'ITK : valeur et source, total d'heures par hectare ;
  - « Type de matériel (barème BCMA) » dans une étape sans matériel de la ferme ;
  - panneau **Débit de chantier** sur la fiche d'un matériel (ligne rattachée, proposition à retenir, recherche) ;
  - réglages : journée de travail et heures par personne et par semaine.
- **OSRM** : `docker/osrm/prepare.sh` accepte plusieurs régions et les fusionne (osmium de Debian). Les adresses Geofabrik ont changé (`<région>/<nom>/<nom>-latest.osm.pbf`) : l'ancienne forme redirigeait vers un 404, le script est corrigé.
- **Tests** : référentiel `machinery-rates.test.ts` (4) ; domaine `itk-workload.test.ts` (4) ; API `itk-work.integration.test.ts` (3 : contexte, barème et rattachement, OSRM `table` simulé) ; web (colonne Débit de l'éditeur).

**Données des fermes de test (base de développement)** : débits observés chez l'exploitant testeur, par exemple :
- labour avec la charrue 1,19 ha/h (19 chantiers) ;
- hersage 2,24 ha/h ;
- semis tout-en-un 1,19 ha/h ;
- pulvérisation 4,04 ha/h.

Les propositions de rattachement suivent le nom du matériel (« Pulvériseur 3,2 m 28 disques » pour le déchaumeur à disques). Graphe OSRM Aquitaine et Pays de la Loire préparé en local (pic de 1,7 Go de mémoire) : **tous les trajets passent par la route**.
- Exploitant testeur : 22 parcelles, aller médian 1,1 km (2 min), au plus 8,6 km.
- GAEC : 41 parcelles, aller médian 4,2 km (9 min), au plus 10,8 km.

Sur le serveur : même commande au déploiement, sur accord.

**Écarts avec la conception** :
- **Référentiel en module TypeScript** (`@fourmy/certification-refs`, comme les autres référentiels, principe C6) plutôt qu'en table `ref_machinery_rates`. `equipments.machinery_rate_id` porte l'identifiant texte de la ligne.
- **Pas de « rendement de chantier »** dans les réglages : la performance du barème est déjà une performance réelle de chantier. Le repli « largeur × vitesse » devient « largeur × débit par mètre de la famille du barème ».
- **Morceaux d'une découpe** : trajet de leur parcelle d'origine principale (pas de calcul par forme du brouillon, pas de `POST /crop-plans/:year/routes`).
- **Capacité** : personnes actives de la ferme × heures par semaine (au moins une personne).
- **Personnes non nommées** : une personne par passage par défaut (`people`), comptée en « main-d'œuvre non nommée ».

### IT5 — Besoins en intrants (21/11/2026)

- **Domaine** `itk/needs.ts` :
  - `inputNeeds` : dose × surface × part × passages, étapes « si besoin » à part ;
  - `doseToStock` : semences par `seedRate` et `convertSeedQuantity` (grains/m², milliers, doses, PMG) ; engrais et phyto par `convertQuantity` (densité) ;
  - `nitrogenToStock` : apport d'azote du plan → produit, d'après la teneur (% de masse, kg/t, kg/m³) ;
  - intrants génériques regroupés par libellé et unité ;
  - dose inconvertible gardée dans l'unité de la dose (grains/m² ramenés en grains), signalée, jamais comptée pour zéro ;
  - à acheter = besoin − (stock − réservé).
- **Plan de fumure** : un plan établi ou révisé de la campagne (version en cours) remplace les intrants engrais des étapes de fertilisation minérale de l'ITK de sa parcelle ; la fertilisation organique reste celle de l'ITK ; un apport sans engrais choisi est compté en kg N, à part.
- **API** `GET /crop-plans/:year/inputs-context` (`repos/itk-inputs.ts`) :
  - articles cités par les ITK, les plans et les interventions prévues (unité, densité, PMG, grains par dose, teneur en azote) ;
  - stock à la date du jour (somme des mouvements) ;
  - réservé : interventions prévues saisies à la main sur la campagne (du 1er août précédent au 31 décembre), converties par `toStockQuantity`. Celles des ITK sont déjà dans les besoins ;
  - apports des plans de fumure établis, par parcelle.
- **Web** : onglet **Intrants** de l'assolement (par nature : besoin, si besoin, stock, réservé, à acheter, source ; doses non converties signalées).
- **Tests** : domaine `itk-needs.test.ts` (5) ; API `itk-inputs.integration.test.ts`.

**Écarts avec la conception** :
- Les besoins portent sur **toutes les occurrences** d'une étape, datées ou non : une date manquante n'enlève pas l'intrant.
- Un **morceau de découpe** du brouillon n'a pas de plan de fumure (le plan suit la parcelle d'origine) : son azote vient de l'ITK.
- **Recoupement avec « Utilisation des semences » (SE7)** : à faire à la recette (IT6), une fois des interventions prévues générées sur une ferme de test.

### IT6 — Récapitulatif, documentation et recette (21/11/2026)

- **Récapitulatif par activité** : l'onglet Travaux compare les heures prévues de chaque activité aux heures réalisées de la campagne précédente (`previousHoursByActivity` du contexte). Ce sont les interventions réalisées à l'heure près, rattachées à l'activité de la production de leur parcelle à leur date (`fourmy_production_at`). Les heures restent sur une seule ligne dans les colonnes étroites.
- **Recoupement avec « Utilisation des semences » (SE7)**, point de contrôle d'IT5 : test `itk-recette.integration.test.ts`. Le besoin de l'onglet Intrants (250 grains/m² × 20 ha × PMG 45 g = 2 250 kg) est égal aux semences prévues de SE7 une fois les deux interventions générées.
- **e2e de bout en bout** `e2e/itk-journey.spec.ts` (ferme pilote viticole, campagne 2033, tout est effacé à la fin) :
  1. ITK à dates fixes ;
  2. « Préparer l'assolement », ITK proposé d'office à l'affectation ;
  3. onglet Travaux (débits saisis, graphique des semaines) et onglet Intrants ;
  4. validation ;
  5. « Préparer les interventions prévues » : 4 par parcelle créées.

  Il passe avec `crop-plan.spec.ts` et `itk.spec.ts`.
- **Documentation** :
  - `docs/itineraires-techniques.md` : ITK, création depuis l'historique, aperçu, débit de chantier et ses sources, barème BCMA ;
  - `docs/assolement.md` : itinéraire à l'affectation, interventions prévues, découpe, Travaux, Intrants, réglages ;
  - `docs/routage-osrm.md` : trajets, plusieurs régions ;
  - `points_ouverts.md` : point 124 fait, 126 réduit à l'annulation d'une découpe validée, suites 135 à 141.
- **Recette avec l'exploitant testeur** : à faire sur dev.fourmy.org après le déploiement des lots IT (PR #135 à #141), avec l'OSRM du serveur (point 137) et les ITK recréés depuis l'historique (point 135).

**Constats de la recette locale** :
- Capacité des pointes : 48 personnes actives sur la ferme pilote (reprise Ekylibre) ; la capacité est donc surestimée (point 138).
- Sans siège localisé, les trajets ne sont pas comptés, et c'est signalé.

### Recette dans Chrome et corrections (21/11/2026)

Recette des écrans du temps 2 sur les deux fermes de test, base de développement, dans Chrome.

**Défauts corrigés** :
- **Interventions prévues refusées** (16 sur 91 chez l'exploitant testeur) : la génération envoyait l'unité de la dose (`kilogram`, `liter`), mais les articles repris d'Ekylibre ont un libellé (« Kilogramme », « Litre ») et la saisie d'un phyto exige l'unité de l'article. Correction : la dose est écrite dans l'unité de l'article quand elle s'y convertit (`convertQuantity`, densité) ; les semences gardent la leur. L'empreinte est calculée sur ce qui est écrit, normalisé comme à la relecture. Après correction, les 16 sont créées et les 75 déjà créées restent « à jour ».
- **Barème BCMA : lignes décalées d'une colonne** quand un libellé coupé finit par un nombre (« coupe à 7,5 m à 9 », « 120 x 160 »), soit une quinzaine de lignes (presses, moissonneuses, désileuse). Correction : les colonnes sont découpées sur deux espaces ou plus, et les 7 nombres sont les 7 dernières cellules numériques. CSV et module régénérés (toujours 1 082 matériels) ; tests : aucun prix d'achat < 200 €, aucun débit à l'hectare > 50 ha/h.
- **Type de matériel du barème choisi dans une étape** : compté seulement après enregistrement et rechargement. Correction : la ligne choisie est ajoutée au contexte de l'éditeur, et le contexte du temps de travaux est invalidé à l'enregistrement d'un ITK.
- **« Type choisi »** à la réouverture : remplacé par le nom de la ligne (contexte et choix courant).

**Défauts du temps 1 corrigés** :
- **Conflit à « Valider… »** juste après un geste : la validation attend la sauvegarde en cours, et la révision est mise à jour sans attendre le rendu.
- **« Sans culture » perdu une fois validé** : les parcelles sans culture de la dernière version validée sont reprises dans le brouillon (assolement validé, réouverture), tant qu'elles n'ont pas de culture principale.

**Ergonomie** :
- Fenêtre d'étape : la liste des procédures ne s'ouvre plus d'elle-même sur une étape existante.
- Onglet Intrants : 4 colonnes (intrant et source ; besoin et « si besoin » ; disponible = stock − réservé, avec le détail ; à acheter), retour à la ligne des unités, défilement dans le panneau ; stocks négatifs en orange avec un avertissement (comptés pour zéro).
- Onglet Travaux : message et liens vers les itinéraires dont des étapes n'ont pas de débit ; pas de graphique vide.
- Aperçu de validation : l'itinéraire de chaque culture ; un changement d'itinéraire est distingué d'un changement de dates.

**Analyse : maïs de l'exploitant testeur, 167 h prévues contre 274 h réalisées en 2026.** Deux saisies reprises d'Ekylibre couvraient plusieurs jours d'un seul tenant, nuits comprises : un hersage de 98,5 h et un semis de 83 h. Les périodes de plus de 24 h sont maintenant écartées du réalisé et leur nombre est affiché. Le réalisé 2026 devient 92,9 h (2 périodes écartées, récoltes de l'ETA sans durée). Il est cohérent avec les 167 h prévues, qui comptent aussi la route, la récolte et la fertilisation.

**Reste** : 414 km de route pour 36 ha, conséquence de la règle « un aller-retour par journée et par parcelle » (limite connue, liée au point 136, chantiers multi-parcelles).
