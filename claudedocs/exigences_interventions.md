# Interventions : exigences (tests du 2026-11-08)

> Source : `claudedocs/modification_intervention.md` (retours de test sur la
> ferme de Pierre, `/f/a94afd36-…/interventions`) et décisions prises le
> 2026-11-08. Document d'exigences seulement : la conception technique
> (schéma, API, découpage) se fait ensuite (`/sc:design`, `/sc:workflow`).

## 1. Décisions prises

| Sujet | Décision |
|---|---|
| Ordre de livraison | **1. Écrans** (fiche, modification, vues, recherche, carte, icônes) → **2. Réglementation phyto + IFT** → **3. Météo** |
| Modifier une intervention réalisée | **Correction tracée** : contre-passer les anciens mouvements, passer les nouveaux, garder l'historique (qui, quand, avant/après) |
| Feu rouge réglementaire | **Alerte + motif** : enregistrement possible après confirmation et saisie d'un motif ; l'écart reste visible sur la fiche et au registre |
| Référentiel phyto | **Copie de Lexicon dans Fourmy** (produits, usages, risques), mise à jour à chaque version de Lexicon ; contrôles disponibles hors ligne |
| Colonnes du kanban | **Statut** |
| Météo sans intégration | **Open-Meteo par défaut** (gratuit, sans clé, historique) ; OpenWeather et meteoblue prennent la main si la ferme a saisi leur clé |
| IFT | **API du ministère** (ecoagri IFT v5) |
| Clé OpenWeather de Pierre | Dans son **export Ekylibre** (intégrations) : à reprendre en lecture seule, jamais affichée |
| Colonne « en cours » | **Calculée** : intervention planifiée dont la première période a commencé (pas de nouveau statut) |
| Portée de la recherche rapide | **La campagne** affichée |
| ZNT | **Contrôle de la distance réelle** aux cours d'eau et points d'eau proches de la parcelle (données de Lexicon) |
| Données spatiales | **Stockées autour de chaque ferme** (cours d'eau, points d'eau…) pour l'application et le mode déconnecté |
| Compte API IFT | **Ekylibre SAS** pour toutes les fermes ; sans identifiants dans l'environnement du serveur, l'IFT est indisponible |
| Mise à jour de Lexicon | **Automatique**, par son API |
| Correction d'une campagne close | Autorisée, **simple alerte** ; motif de correction facultatif |
| Saisie sur carte | Parcelles entières **et zones partielles dessinées** ; outils carto **mutualisés** (dessin, découpe, mesure, fusion, redimensionnement) pour les autres modules |
| Périmètre | **Web seulement** (pas de nouvelles vues dans `zero-mobile` pour l'instant) |

## 2. État actuel (constaté dans le code)

- Écran unique `InterventionsPage` (liste) + `InterventionForm` (création).
- API : `GET /interventions`, `POST /interventions` (planifier),
  `POST /:id/complete`, `POST /:id/cancel`. **Aucune modification possible.**
- Statuts : `planned | done | cancelled` (pas de statut « en cours »).
- Articles : champ `amm` déjà présent ; `lexicon_ref` prévu dans
  l'architecture mais pas de référentiel phyto réglementaire.
- Intégrations : un seul fournisseur (`traccar`), formulaire décrit par le
  fournisseur. Les nouvelles intégrations météo s'y ajoutent sans écran propre.
- Lexicon tourne en local : base (port 5555) et API osfarm (port 8888).

## 3. Exigences fonctionnelles

### Lot 1 : écrans des interventions

**INT-UI-1 Icônes (agric).** Chaque procédure, et chaque forme, a une icône
tirée du jeu d'icônes `ekylibre/agric`. Elles apparaissent dans la liste, le
kanban, le calendrier, la fiche et le choix de procédure du formulaire.
- *Critère* : les 37 procédures utilisées par les pilotes ont une icône ; une
  procédure sans icône prend celle de sa forme.

**INT-UI-2 Fiche (show).** Une page par intervention, avec une adresse
partageable. Elle montre : procédure, statut, périodes, parcelles (avec
mini-carte), intrants et doses (par ha et total), sorties et destination,
matériels, intervenants, motifs, notes, origine, trace GPS du jour si elle
existe, et l'historique des corrections. Plus tard : indicateurs phyto (lot 2)
et météo (lot 3).
- *Critère* : un clic sur une intervention (liste, kanban, calendrier, carte)
  ouvre sa fiche.

**INT-UI-3 Modification (edit).** Le formulaire de création sert aussi à
modifier.
- Intervention **planifiée** : modification directe.
- Intervention **réalisée** : correction tracée (§1). Les stocks et le registre
  reflètent la nouvelle version ; la fiche montre la version d'avant, l'auteur
  et la date de la correction.
- Intervention **annulée** : lecture seule.
- Corriger une intervention d'une **campagne close** reste possible, avec une
  simple alerte ; le motif de correction est facultatif.
- *Critères* : après correction d'une dose, le stock et le registre phyto
  montrent la nouvelle quantité ; l'historique montre l'ancienne. Une
  correction rejouée deux fois n'est appliquée qu'une fois (idempotente).

**INT-UI-4 Vues de l'index.** Trois vues, avec un sélecteur, sur une **frise
à la semaine** (du lundi au dimanche, semaine précédente/suivante, retour à
la semaine du jour) :
- **Liste** : tableau triable (date, procédure, parcelles, intrants, statut).
- **Kanban** : colonnes Planifiée, En cours, Réalisée, Annulée. « En cours »
  est calculée : intervention planifiée dont la première période a commencé.
  Glisser une carte de « planifiée » à
  « réalisée » ouvre la validation (dates réelles, quantités).
- **Calendrier** : semaine, interventions placées sur leurs périodes (une
  intervention sur plusieurs demi-journées apparaît sur chacune).
- *Critères* : la vue choisie est mémorisée ; changer de semaine garde la vue ;
  la date de la frise globale de l'application reste cohérente avec la semaine
  affichée.

**INT-UI-5 Recherche rapide (liste).** Un champ filtre la liste pendant la
frappe : procédure, parcelle, produit (nom ou n° AMM), matériel, intervenant,
notes.
- *Critère* : la recherche porte sur toute la **campagne** affichée (pas
  seulement la semaine) ; résultat en moins de 200 ms sur la campagne la plus
  chargée de Pierre.

**INT-UI-6 Saisie sur carte.** Un mode « carte » du formulaire : la carte du
parcellaire à la date de l'intervention, où l'on sélectionne plusieurs
parcelles (clic, et sélection par zone), et où l'on peut **dessiner une zone
partielle** dans une parcelle (surface réellement travaillée). La surface
totale s'affiche et alimente le calcul des doses par hectare.
- *Critères* : on bascule entre liste et carte sans perdre la sélection ; une
  parcelle qui n'existe pas à la date choisie n'est pas sélectionnable ; une
  zone dessinée est découpée sur sa parcelle et sa surface remplit
  `workedAreaM2` et `workingZone`.

**CARTO-1 Outils carto mutualisés.** Les fonctions de carte forment une boîte
à outils commune, réutilisable par les autres modules (parcellaire, plan 3D,
traces GPS…) et pas propre aux interventions : **dessin** (polygone, ligne,
point), **découpe**, **mesure** (distance, surface), **fusion**,
**redimensionnement** (déplacement de sommets), sélection multiple.
- *Critères* : mêmes outils et même comportement partout où une carte permet
  d'éditer ; surfaces calculées comme celles du parcellaire (mêmes résultats
  au m² près) ; testés indépendamment des écrans qui les utilisent.

### Lot 2 : réglementation phyto et IFT

**PHY-1 Référentiel.** Copie dans Fourmy des données phyto de Lexicon :
produits (AMM, état d'autorisation, dates de retrait), usages (culture,
cible, dose maximale, nombre d'applications), risques et délais (ZNT,
délai avant récolte, délai de ré-entrée). Mise à jour **automatique** par
l'API de Lexicon, avec la version utilisée affichée.

**GEO-1 Données spatiales autour de la ferme.** Fourmy stocke, autour de
chaque ferme, les données spatiales utiles à l'application : cours d'eau et
points d'eau (Lexicon) pour la ZNT, et à terme les autres couches de
proximité (bâtiments BD TOPO, relief…). Elles sont disponibles en mode
déconnecté.
- *Critères* : le contrôle de ZNT fonctionne sans réseau ; la zone couverte
  suit l'emprise du parcellaire (avec une marge) et se met à jour quand le
  parcellaire change ou quand Lexicon publie une nouvelle version.

**PHY-2 Import d'un article.** Deux chemins :
- créer un article depuis le référentiel (recherche par nom ou n° AMM) ;
- rattacher un article existant (venu de la migration) à son AMM et
  compléter ses données réglementaires.
- *Critère* : les phytos migrés des trois fermes qui ont un n° AMM se
  rattachent automatiquement ; les autres sont listés pour rattachement manuel.

**PHY-3 Contrôles dans le formulaire.** Pour chaque phyto d'une intervention
de traitement, calculés en direct à partir de la culture de la parcelle à la
date, de la dose et de la surface :

| Indicateur | Feu rouge si… |
|---|---|
| Autorisation | produit retiré à la date, ou pas d'usage autorisé pour la culture |
| Dose maximale | dose par ha au-dessus de la dose maximale de l'usage |
| Nombre d'applications | maximum par campagne dépassé |
| ZNT | ZNT de l'usage comparée à la **distance réelle** entre la zone traitée et les cours d'eau et points d'eau proches (données de Lexicon) ; feu rouge si la zone traitée empiète sur la ZNT, avec la distance mesurée et l'élément d'eau concerné |
| DAR (délai avant récolte) | une récolte est saisie ou planifiée avant la fin du délai |
| Délai de ré-entrée | affiché ; date et heure de fin de ré-entrée calculées |

Logique métier de référence, à étudier en conception :
`ekylibre/app/services/phytosanitary/`,
`ekylibre/app/services/registered_phytosanitary_usage_dose_computation.rb`,
`ekylibre/app/controllers/form_objects/backend/`, et les projets
`cropivia/cropi-grow-guide` et `cropivia/cropivia_backend` (contrôle phyto
de la fraise).
- *Critères* : un feu rouge demande une confirmation et un motif (§1) ; le
  motif et l'indicateur sont enregistrés avec l'intervention et visibles sur la
  fiche et au registre ; les contrôles tournent sans réseau.

**PHY-4 Fiche et parcelle.** La fiche de l'intervention montre les
indicateurs. La parcelle montre ses délais en cours (ré-entrée interdite
jusqu'à…, récolte possible à partir du…).

**IFT-1 Calcul.** L'IFT de chaque traitement, et le cumul par parcelle,
culture et campagne, sont obtenus auprès de l'API IFT v5 du ministère
(`ecoagri.api.agriculture.gouv.fr/ift/v5`, recette sur
`ecoagri-pprd…`). Affichés sur la fiche, au registre et dans un bilan de
campagne.
Un seul compte, celui d'**Ekylibre SAS**, pour toutes les fermes : ses
identifiants sont des variables d'environnement du serveur. Sans elles, l'IFT
est indisponible et l'interface l'indique.
- *Critères* : un traitement saisi hors ligne reçoit son IFT au retour de la
  connexion ; une API indisponible n'empêche pas d'enregistrer (IFT « en
  attente », recalculé ensuite).

### Lot 3 : météo

**MET-1 Intégrations.** Trois fournisseurs dans la page Intégrations, avec
saisie de la clé chiffrée comme pour Traccar :
- **Open-Meteo** : sans clé, actif par défaut ;
- **OpenWeather** : clé de la ferme (référence : `open_weather_map_client.rb`
  d'Ekylibre) ; pour Pierre, la clé est reprise de son export Ekylibre ;
- **meteoblue** : clé, package agro.
- *Critère* : la clé est testée avant enregistrement et jamais réaffichée.

**MET-2 Météo enregistrée dans l'intervention.** À la saisie, la météo est
pré-remplie pour la position des parcelles et la date et l'heure de
l'intervention : **température, hygrométrie, vitesse du vent, pluviométrie**.
Les valeurs restent modifiables ; la source est enregistrée (fournisseur ou
« saisie »).
- *Critères* : une intervention passée reçoit les valeurs historiques ; une
  intervention planifiée reçoit la prévision, puis les valeurs observées quand
  elle est validée.

**MET-3 Widget « conditions de pulvérisation ».** Sur le tableau de bord et
dans le formulaire de traitement : créneaux des prochains jours favorables ou
non, selon le vent, la pluie, la température et l'hygrométrie. Seuils
repris de `weather_spraying_cells_controller.rb` d'Ekylibre.
- *Critère* : chaque créneau défavorable indique la raison (vent > seuil,
  pluie annoncée…).

## 4. Exigences non fonctionnelles

- **Périmètre web** : toutes ces exigences concernent l'application web ;
  `zero-mobile` n'est pas modifié pour l'instant.
- **Hors ligne** : les règles de correction et les contrôles phyto sont des
  fonctions pures partagées (domaine), réutilisables plus tard par le mobile ;
  les données de Lexicon et les données spatiales autour de la ferme sont
  stockées localement. La météo et l'IFT se complètent au retour du réseau.
- **Traçabilité** : aucune correction n'efface ; registre phyto et stocks
  toujours recalculés depuis les événements.
- **Sécurité** : clés météo et identifiants de l'API du ministère chiffrés
  par ferme (`FOURMY_SECRETS_KEY`), jamais renvoyés au client ; aucune clé
  dans le dépôt ; la clé de Pierre n'est lue que dans l'export (jamais
  l'instance Ekylibre de production).
- **Performance** : vues et recherche fluides sur plusieurs milliers
  d'interventions (ferme de Pierre, 2015–2026).
- **Licences** : vérifier la licence du jeu d'icônes `agric` et les
  conditions d'usage des API météo (attribution Open-Meteo, quotas).
- **Tests** : parcours e2e pour la fiche, la correction tracée, chaque vue et
  la saisie sur carte ; tests du domaine pour chaque feu rouge, avec des cas
  tirés des fermes pilotes.

## 5. Récits utilisateur

- *Pierre* : je retrouve en deux secondes le dernier traitement d'un produit
  sur une parcelle, et je corrige la dose si je me suis trompé, sans perdre la
  trace de l'erreur.
- *Frédéric* : je vois ma semaine de travaux de vigne au calendrier, et je
  fais passer une intervention planifiée en réalisée en la glissant.
- *Tout pilote* : en saisissant un traitement, je vois tout de suite si le
  produit est autorisé sur ma culture, si la dose dépasse le maximum, et quand
  je pourrai rentrer dans la parcelle et récolter.
- *Tout pilote* : la météo du traitement est déjà remplie, et je sais si les
  conditions des prochains jours permettent de pulvériser.
- *Tout pilote* : je connais mon IFT de campagne sans le calculer à la main.

## 6. Questions ouvertes

Toutes les questions du premier tour sont tranchées (§1). Restent, pour la
conception :

1. **Lexicon** : l'API osfarm (port 8888 en local) expose-t-elle bien les
   usages, les risques et les cours d'eau et points d'eau, ou faut-il lire sa
   base ? À vérifier avant `/sc:design`.
2. **Compte API IFT** : sans objet. L'API IFT du ministère est ouverte et
   sans compte (`docs/phyto.md`) ; c'est elle qui est utilisée.
