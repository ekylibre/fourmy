# Fourmy — Parcours GPS et attelages (exigences)

> Document produit par `/sc:brainstorm` le 2026-11-09. Il précise **FR-GPS**
> et **FR-INT** de [`requirements.md`](requirements.md) et complète
> [`interventions.md`](interventions.md) (modèle d'intervention) et
> [`materiels.md`](materiels.md) (fiche matériel, attelage 3D).
> Ce document décrit **uniquement les exigences**. Design :
> [`parcours-attelages-design.md`](parcours-attelages-design.md).

## 1. Origine et objectif

Quand une ferme a activé Traccar, ses tracteurs remontent des positions
(`positions`, attributs `isWorking`, `workingWidth`, `tool`, `field`).
Aujourd'hui, ces traces servent au rejeu (carte, plan 3D), aux heures
estimées et à la couverture, mais **on ne peut pas en tirer une
intervention** : il faut ressaisir parcelles, horaires, matériels et
personnes.

Objectifs :

1. **Voir les parcours** d'un matériel dans un onglet de sa fiche.
2. **Transformer** un ou plusieurs parcours en intervention pré-remplie :
   parcelles, début et fin, matériels, attelage.
3. **Modéliser l'attelage** dans l'intervention : déclarer soit des
   attelages (intervenants + matériels, chacun avec ses périodes), soit,
   comme aujourd'hui, des listes indépendantes de matériels, d'intervenants
   et de périodes.

## 2. Décisions validées (2026-11-09)

| Sujet | Décision |
|---|---|
| Parcours | **Session de travail** : suite continue de positions « au travail », coupée par un arrêt prolongé |
| Où vit l'attelage | **Dans l'intervention**, plus des **attelages types** de la ferme pour les reprendre en un clic |
| Périodes en mode attelage | **Propres à chaque attelage** ; les périodes de l'intervention sont leur réunion (comme les participations d'Ekylibre 5) |
| Conducteur pré-rempli | **Le conducteur habituel** du matériel (interventions récentes), modifiable ; vide sans historique |
| Seuils de découpage | **Réglables par ferme** (responsable), avec des valeurs par défaut |
| Contenu de la liste | **Sessions de travail et déplacements**, distingués |
| Outils sans boîtier | **Onglet Parcours aussi**, avec les parcours des matériels suivis auxquels l'outil était attelé |
| Plusieurs matériels dans une conversion | **Hors v1** |
| Attelage sans intervenant | **Accepté** (conducteur inconnu) |
| Reprise Ekylibre | **Attelages déduits** des interventions (participations, sinon matériels, intervenants et périodes) quand c'est sans ambiguïté |
| Registre phyto | L'**applicateur** est l'intervenant de l'attelage qui porte le pulvérisateur |

## 3. Vocabulaire

- **Parcours** : session de travail d'un matériel suivi, de la première à la
  dernière position « au travail », sans arrêt de plus de *N* minutes.
- **Attelage** : dans une intervention, un groupe de **0 à n intervenants**
  et de **1 à n matériels** (tracteur et outils) qui travaillent ensemble
  pendant **ses propres périodes**.
- **Déplacement** : session en mouvement mais pas « au travail » (route,
  transport, aller-retour à la parcelle).
- **Attelage type** : composition enregistrée par la ferme (nom, matériels,
  intervenants), sans période. Ex. « Arion 630 + charrue — Pierre ».
- **Mode libre** : le modèle actuel, avec matériels, intervenants et
  périodes au choix, sans lien entre eux.

## 4. Exigences fonctionnelles

### 4.1 Parcours d'un matériel (onglet « Parcours »)

- **FR-GPS-10 (M) Onglet.** La fiche d'un matériel montre un onglet
  **Parcours** (`?tab=tracks`) quand la ferme a une intégration Traccar
  active **et** que le matériel a des parcours : les siens (matériel suivi)
  ou, pour un outil sans boîtier, ceux des matériels suivis auxquels il
  était attelé (FR-GPS-17). Sinon l'onglet n'apparaît pas. Les positions déjà
  importées restent visibles si l'intégration est coupée.
- **FR-GPS-11 (M) Découpage en sessions.**
  - Une position est « au travail » si `isWorking` est vrai. Si le boîtier
    ne fournit pas cet attribut, c'est un mouvement au-dessus d'un seuil de
    vitesse.
  - Un arrêt ou une absence de positions de plus de *N* minutes coupe la
    session. Valeur par défaut : 15 min ; réglable (FR-GPS-16).
  - Les sessions en mouvement mais pas au travail sont des **déplacements**,
    listés à part de façon visible (type « Travail » ou « Déplacement »).
  - Les sessions trop courtes (moins de *M* minutes ou de *D* mètres) ne
    sont pas listées.
  - Le découpage est **déterministe** : les mêmes positions donnent les
    mêmes parcours.
- **FR-GPS-12 (M) Contenu d'une ligne.**
  - date, début, fin et durée ;
  - parcelles travaillées **à la date**, avec la surface couverte dans
    chacune ;
  - surface couverte totale (largeur réelle de l'outil, comme la
    couverture actuelle) et distance ;
  - outil détecté (attribut `tool` de Traccar), s'il existe ;
  - état : **libre**, ou **rattaché** à une intervention (avec le lien
    vers sa fiche).
- **FR-GPS-13 (M) Filtres.** Période (30 derniers jours par défaut),
  type (travail, déplacement ; les deux par défaut), parcelle, état (libre
  ou rattaché). La liste est paginée et triée du plus
  récent au plus ancien.
- **FR-GPS-14 (S) Aperçu.** La sélection de parcours s'affiche sur une
  mini-carte avec les parcelles. Un lien ouvre le rejeu (carte ou plan 3D)
  sur leur période.
- **FR-GPS-15 (S) Positions tardives.** Des positions arrivées après coup
  (boîtier hors réseau) peuvent prolonger ou fusionner des parcours. Un
  parcours déjà rattaché garde son rattachement. Si son étendue change, la
  fiche de l'intervention signale l'écart (« la trace a changé depuis la
  saisie »).

- **FR-GPS-16 (M) Réglages de la ferme.** Le responsable règle, dans les
  paramètres de la ferme :
  - l'arrêt qui coupe une session (*N*, défaut 15 min) ;
  - la durée et la distance minimales d'un parcours (*M*, *D*) ;
  - le seuil de vitesse « en mouvement » quand `isWorking` manque ;
  - le seuil d'appartenance d'une parcelle (part de la parcelle ou surface
    minimale couverte).

  Un changement de réglage recalcule les parcours **libres**. Les parcours
  rattachés gardent l'étendue qu'ils avaient quand on les a rattachés.
- **FR-GPS-17 (M) Outils sans boîtier.** L'onglet d'un outil liste les
  parcours des matériels suivis pendant qu'il y était attelé. L'outil
  attelé est connu par :
  - l'attelage déclaré dans une intervention ;
  - sinon l'attribut `tool` de Traccar ;
  - sinon la déduction actuelle (`GET /tracks/hitches`).

  Chaque ligne précise le matériel tracteur. Créer l'intervention depuis
  l'onglet d'un outil pré-remplit le même attelage (tracteur et outil).

### 4.2 Transformer des parcours en intervention

- **FR-GPS-20 (M) Sélection.** On coche un ou plusieurs parcours **libres**
  du matériel, travail ou déplacement, puis « Créer l'intervention ». Un
  parcours déjà rattaché n'est pas sélectionnable. Un déplacement donne une
  période sans parcelle cible : il sert par exemple au transport, ou à
  compter le trajet dans le temps de travail de l'attelage.
- **FR-GPS-21 (M) Pré-remplissage.** Le formulaire pleine page existant
  s'ouvre en **mode attelage**, statut **réalisée** :
  - **Attelage** :
    - le matériel suivi ;
    - l'**outil** : celui de l'attribut `tool` (rapproché par
      `external_ids.traccarTool` ou par le nom), sinon l'outil le plus
      souvent attelé à ce matériel dans les interventions récentes ;
    - le **conducteur habituel** de ce matériel, sinon **aucun** (attelage
      sans intervenant, accepté).
  - **Périodes de l'attelage** : une par parcours. Deux parcours séparés de
    moins de *N* minutes sont fusionnés.
  - **Cibles** : les parcelles où les parcours ont réellement travaillé,
    au-delà d'un seuil (part de la parcelle ou surface minimale). Chaque
    cible porte sa **zone de travail** (couverture) et sa **surface
    traitée**. La dose par hectare s'applique donc à la surface réellement
    couverte, selon la règle actuelle (`interventions.md` §4.3).
  - **Procédure** : suggérée d'après l'outil et les habitudes de la ferme,
    sinon à choisir.
- **FR-GPS-22 (M) Rien n'est enregistré avant validation.** Tout reste
  modifiable : cibles, attelage, périodes, intrants. Les contrôles habituels
  s'appliquent (réglementaire, chevauchement des périodes…).
- **FR-GPS-23 (M) Rattachement.**
  - L'enregistrement lie les parcours à l'intervention. Un parcours n'est
    lié qu'à **une** intervention.
  - Supprimer une intervention planifiée, ou annuler une intervention
    réalisée, libère ses parcours.
  - La fiche de l'intervention liste ses parcours. La trace GPS de la fiche
    (déjà présente) s'appuie sur eux.
- **FR-GPS-24 (S) Ajouter à une intervention existante.** Depuis l'onglet,
  « Ajouter à une intervention » rattache des parcours libres à une
  intervention du même jour. Cela ajoute une période à l'attelage du
  matériel et les parcelles manquantes.
- **FR-GPS-25 (W) Plusieurs matériels — hors v1.** Sélectionner les
  parcours de plusieurs matériels (deux tracteurs sur le même chantier)
  pour une seule intervention à plusieurs attelages. En v1, on crée
  l'intervention depuis un matériel, puis on ajoute l'autre attelage à la
  main.

### 4.3 Modèle d'intervention : attelages ou mode libre

- **FR-ATT-1 (M) Deux modes, au choix par intervention.**
  - **Attelages** : 1 à n attelages. Chacun a ≥ 1 matériel, 0 à n
    intervenants (conducteur inconnu accepté) et ≥ 1 période.
  - **Libre** (actuel) : matériels, intervenants et périodes indépendants.
    Rien ne change pour ce mode.
- **FR-ATT-2 (M) Périodes.**
  - Dans un attelage, les périodes sont ordonnées et ne se chevauchent pas.
  - Deux attelages différents peuvent se chevaucher, par exemple deux
    tracteurs en même temps.
  - Les périodes de l'intervention, son début et sa fin **sont déduits** :
    réunion des périodes des attelages.
- **FR-ATT-3 (M) Cohérence.**
  - Un même matériel ou un même intervenant ne peut pas figurer dans deux
    attelages de la même intervention sur des périodes qui se chevauchent.
  - Entre interventions différentes : **avertissement**, sans blocage.
- **FR-ATT-4 (M) Passer d'un mode à l'autre.**
  - **Libre → attelages** : un attelage est créé avec tous les matériels,
    intervenants et périodes de l'intervention, puis on le découpe.
  - **Attelages → libre** : on garde la réunion des matériels, intervenants
    et périodes. On perd qui travaillait avec quoi et quand ; une
    confirmation est demandée.
- **FR-ATT-5 (M) Durées affichées.** La fiche, le calendrier et la liste
  montrent chaque attelage avec ses périodes. Deux durées distinctes :
  - **durée du chantier** : du premier début à la dernière fin ;
  - **temps de travail** : la somme des périodes de chaque attelage.
- **FR-ATT-6 (S) Attelages types.**
  - Le responsable gère une liste d'attelages types : nom, matériels,
    intervenants, en service ou non.
  - À la saisie, choisir un attelage type remplit l'attelage ; il ne reste
    que les périodes à saisir.
  - « Enregistrer comme attelage type » depuis un attelage saisi.
  - Modifier un attelage type ne modifie pas les interventions passées.
- **FR-ATT-7 (M) Usages en aval.** Quand une intervention est en mode
  attelage, les traitements qui utilisent aujourd'hui les périodes de
  l'intervention prennent **les périodes de l'attelage du matériel ou de la
  personne** :
  - heures d'usage et relevé de fin de chantier d'un matériel ;
  - attelage du rejeu 3D (`GET /tracks/hitches`) : l'attelage déclaré
    l'emporte sur la déduction actuelle ;
  - trace GPS de la fiche ;
  - calendrier ;
  - recherche par matériel ou intervenant.
- **FR-ATT-8 (M) Mobile (zero-mobile).** Le pull et le push transportent
  les attelages. Une version mobile qui ne les connaît pas reste acceptée :
  elle envoie le mode libre, et une intervention en mode attelage reste
  lisible pour elle sous forme aplatie, en lecture seule.
- **FR-ATT-9 (M) Existant.** Les interventions saisies dans Fourmy restent
  en mode libre. Aucune conversion automatique n'est faite.
- **FR-ATT-10 (M) Reprise Ekylibre.** Le migrateur déduit les attelages des
  interventions, dans cet ordre :
  1. **participations** d'Ekylibre 5 (`intervention_participations`, avec
     périodes par matériel ou par personne) : un attelage par matériel
     motorisé, avec ses outils, ses personnes et ses périodes ;
  2. sinon les **paramètres** : au plus un matériel motorisé (tracteur,
     automoteur), ou au plus un intervenant → **un attelage** qui regroupe
     tous les matériels et intervenants, avec les périodes de
     l'intervention ;
  3. sinon (plusieurs tracteurs **et** plusieurs intervenants, sans
     participations) : **mode libre**, compté au rapport (« attelage
     ambigu »).

  État des pilotes au 2026-11-09 :
  - Pierre : 429 interventions sur 591 ont plusieurs matériels et jamais
    plus d'un intervenant, donc la règle 2 suffit. Seules 5 interventions
    ont des participations.
  - Frédéric : aucune participation ; 14 interventions ont plusieurs
    intervenants, à examiner une par une.

  Rejouer la migration n'écrase pas un attelage corrigé dans Fourmy (même
  règle que les corrections préservées).
- **FR-ATT-11 (M) Traçabilité.** Créer, modifier ou changer de mode est
  tracé dans l'historique de l'intervention, comme aujourd'hui : avant →
  après, auteur, motif.

- **FR-ATT-12 (M) Registre phyto.** En mode attelage, l'**applicateur**
  d'un traitement est l'intervenant (ou les intervenants) de l'attelage qui
  porte le pulvérisateur, sur ses périodes. Cela vaut pour la fiche, le
  registre et les exports JSON et CSV. Attelage sans intervenant :
  applicateur « non renseigné », signalé comme manque au contrôle
  réglementaire. En mode libre : tous les intervenants, comme aujourd'hui.

## 5. Exigences non fonctionnelles

- **Performance** : liste des parcours sur 90 jours en moins de 2 s. Le
  calcul n'appelle jamais Traccar : il lit les positions déjà importées.
- **Stabilité** : un parcours rattaché a une identité stable, qui survit au
  recalcul et aux positions tardives (FR-GPS-15).
- **Sécurité** : isolation par ferme (RLS). La liste est visible par tout
  membre. Créer l'intervention suit les droits de saisie actuels (owner et
  worker). Les attelages types sont réservés au responsable.
- **Domaine** : le découpage en parcours, le pré-remplissage et les règles
  d'attelage sont des fonctions pures, testées (`@fourmy/domain`).
- **Compatibilité** : contrats et mobile rétrocompatibles (FR-ATT-8). Aucune
  régression du mode libre.

## 6. Histoires et critères d'acceptation

- **US-GPS-A** — *En tant qu'agriculteur, je vois ce qu'a fait mon tracteur
  hier sans rien saisir.*
  - Pierre, avec Traccar actif, ouvre la fiche de l'Arion 630, onglet
    Parcours.
  - Il voit ses sessions d'hier avec horaires, parcelles et hectares
    couverts.
  - Ces hectares sont cohérents avec la couverture actuelle (écart ≤ 2 %
    avec Traccar, comme validé le 07/11).
- **US-GPS-B** — *Je transforme mes parcours en intervention en moins d'une
  minute.*
  - Il coche les deux parcours de la matinée, puis « Créer l'intervention ».
  - Le formulaire arrive avec :
    - un attelage Arion 630 + l'outil détecté + lui-même ;
    - deux périodes ;
    - les deux parcelles, avec leur surface couverte.
  - Il choisit la procédure et enregistre. Les parcours passent à
    « rattaché ».
- **US-ATT-A** — *Je décris fidèlement un chantier à deux tracteurs.*
  - Frédéric saisit un traitement avec deux attelages :
    - MF 140 + pulvérisateur — lui-même, 8 h-10 h ;
    - McCormick + gyrobroyeur — un salarié, 9 h-12 h.
  - L'intervention dure de 8 h à 12 h ; le temps de travail fait 5 h.
  - Les heures d'usage du MF 140 ne comptent que 2 h.
- **US-ATT-B** — *Je garde la saisie simple quand l'attelage ne compte pas.*
  - Une taille manuelle s'enregistre en mode libre, exactement comme
    aujourd'hui.
- **US-ATT-C** — *Je réutilise mes attelages habituels.*
  - Le responsable enregistre « Arion 630 + charrue — Pierre ».
  - À la saisie suivante, un clic remplit l'attelage.

## 7. Questions tranchées (2026-11-09)

1. Seuils de découpage : **réglables par ferme** (FR-GPS-16).
2. Liste : **travail et déplacements** (FR-GPS-11, 13, 20).
3. Outils sans boîtier : **onglet Parcours** (FR-GPS-17).
4. Plusieurs matériels dans une conversion : **hors v1** (FR-GPS-25).
5. Attelage sans intervenant : **accepté** (FR-ATT-1).
6. Reprise Ekylibre : **attelages déduits des interventions** (FR-ATT-10).
7. Registre phyto : **applicateur = intervenant de l'attelage du
   pulvérisateur** (FR-ATT-12).
8. Données de test : Traccar est configuré pour Pierre en local. **Mais**
   la synchronisation du 2026-11-09 à 17:54 s'est terminée sans erreur avec
   **aucun boîtier** (`devices: []`), donc aucune position. Le jeton
   enregistré ne voit pas les appareils de Pierre (boîtiers 1, 3 et 5). À
   corriger avant la recette : vérifier les droits du compte Traccar sur
   ces appareils, ou utiliser le bon jeton.

## 8. Bilan de réalisation (2026-11-10)

Réalisé en six lots, sur la branche `feat/parcours-attelages`. Plan et
détails : `claudedocs/workflow_parcours_attelages.md`.

| Lot | Contenu | Migration |
|---|---|---|
| N | Attelages dans l'intervention : modèle, règles, API, saisie web | 0022 |
| O | Parcours : découpage, worker, API, onglet Parcours, réglages | 0023 |
| P | Parcours → intervention (création, ajout, rattachement) | 0024 |
| Q | Attelages types | 0025 |
| R | Applicateur du registre phyto, reprise Ekylibre, synchro mobile | 0026 |

Légende : ✅ fait, 🟡 en partie, ⏳ à faire.

| Exigences | État | Remarques |
|---|---|---|
| FR-GPS-10, 12, 13 | ✅ | Onglet visible s'il existe un parcours sur 400 jours ; colonnes, filtres (période, type, parcelle, état), pagination. |
| FR-GPS-11 | ✅ | Seul le signal `working` du boîtier compte comme travail (arbitrage du 2026-11-09). Une journée sans `working` ne donne que des déplacements. |
| FR-GPS-14 | 🟡 | Mini-carte de la sélection (trace, couverture, parcelles) ✅. Le lien vers le rejeu sur la période reste à faire. |
| FR-GPS-15 | ✅ | Parcours rattaché figé ; la dérive recalculée s'affiche (« trace modifiée ») sur l'onglet et la fiche. |
| FR-GPS-16 | ✅ | Réglages par ferme sur la page Entretien ; seuls les parcours libres sont recalculés. |
| FR-GPS-17 | ✅ | Outil résolu : attelage déclaré, puis `tool` Traccar relié à la main (`external_ids.traccarTool`), puis seul outil d'une intervention libre. Un nom approchant n'est qu'un indice. |
| FR-GPS-20 à 23 | ✅ | Sélection, brouillon (attelage, conducteur habituel, périodes fusionnées, parcelles et zones, procédures suggérées, indices), rien n'est enregistré avant validation, rattachement à l'enregistrement (409 si déjà pris). |
| FR-GPS-24 | ✅ | Ajout à une intervention du même jour, correction tracée si elle est réalisée. |
| FR-GPS-25 | ⏳ | Plusieurs matériels suivis dans une même sélection : hors v1. |
| FR-ATT-1 à 5 | ✅ | Modes libre et attelages, périodes par attelage, cohérence (`crewRules` et garde SQL), passage d'un mode à l'autre avec la liste des pertes, durées « chantier » et « temps de travail ». |
| FR-ATT-6 | ✅ | Matériels › Attelages types ; reprise en un clic, « Enregistrer comme attelage type ». |
| FR-ATT-7 | 🟡 | Rejeu 3D, trace de la fiche, calendrier et recherche suivent les attelages ✅. Les heures d'usage viennent des positions Traccar (non concernées). Relevé de fin de chantier : pas encore dans le formulaire (FR-MAT-60). |
| FR-ATT-8 | 🟡 | API ✅ : le pull transporte `staffing`, `crews` et la forme aplatie ; le push accepte les attelages ; une version sans attelages qui réalise une intervention à attelages est refusée dans `failed`. zero-mobile (branche `fourmy-backend`) doit suivre ce contrat : hors de ce dépôt. |
| FR-ATT-9 | ✅ | Aucune conversion automatique des interventions saisies dans Fourmy. |
| FR-ATT-10 | ✅ | Voir ci-dessous. |
| FR-ATT-11 | ✅ | Mode et attelages comparés dans l'historique (avant → après). |
| FR-ATT-12 | ✅ | `applicatorsOf` et sa réplique SQL, testées sur les mêmes cas ; colonne Applicateur à l'écran, en JSON et en CSV ; feu orange « applicateur non renseigné ». Aucun matériel migré n'a une nature de pulvérisateur : en pratique, la règle de l'attelage unique s'applique. |

**Reprise Ekylibre (FR-ATT-10), rejouée le 2026-11-10 sur les deux bases
locales** : registre phyto identique, année par année.

| | Grandes cultures (Ekylibre 5.0) | Viticulture (Ekylibre 4.37) |
|---|---|---|
| Interventions | 588 | 151 |
| En attelages (règle 2) | 436 | 67 |
| En attelages (règle 1, participations) | 1 | 0 |
| Ambiguës (laissées libres) | 0 | 0 |
| Libres, sans matériel | 151 | 84 |

L'estimation de 586 attelages comptait les interventions sans matériel ;
un attelage a au moins un matériel, elles restent en mode libre. Sur les
5 interventions avec participations, 4 ne concernent que des personnes et
relèvent de la règle 2. Une intervention corrigée dans Fourmy n'est plus du
tout réécrite par une nouvelle reprise. Les fixtures anonymisées portent les
attelages (437 et 67).

**Points de contrôle sur les traces réelles** : parcours et couverture
concordent (+1,5 % au plus) ; un brouillon de journée sort en 32 ms. Les
outils annoncés par les boîtiers (« Arion UF1201 », « Tigre ») restent à
relier aux matériels par `external_ids.traccarTool`.

**Depuis** (retours du 10/11/2026) : le tableau de bord résume les parcours
du jour ou de la semaine par matériel et signale les parcours de travail
libres, avec un lien vers l'onglet Parcours filtré (`docs/materiels.md`).

**Reste à faire** : lien vers le rejeu (FR-GPS-14), plusieurs matériels par
sélection (FR-GPS-25), zero-mobile, relevé de fin de chantier, sémantique du
compteur `appliedArea` des boîtiers à confirmer.
