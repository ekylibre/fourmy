# Fourmy — Exigences v1 (issu du brainstorming)

> Document produit par `/sc:brainstorm` le 2026-11-06. Phase suivante :
> `/sc:design` (fait : [`architecture.md`](architecture.md)) puis
> `/sc:workflow` (plan d'implémentation).
> Ce document décrit **uniquement les exigences**. Les pistes techniques de
> l'annexe ont été arbitrées dans `architecture.md`.

## 1. Vision

Fourmy est la réécriture complète d'Ekylibre sous la forme d'un **jumeau
numérique de la ferme** : une représentation vivante et datée de tout ce qui
est physique sur l'exploitation (quoi, où, quand, combien, dans quel état).

- **Objectif** : interopérabilité et consolidation de toutes les informations
  métier de la ferme.
- **Frontière** : Fourmy gère le physique ; **Lyvre** gère l'argent et le droit
  (achats, ventes, facturation, comptabilité, juridique).
- **Écosystème** : Fourmy est interconnecté à Lyvre, à **Aiffel**
  (assistant IA des opérations de la ferme, aiffel.org) et à des solutions
  tierces via des plugins.
- **Licence** : AGPL-3.0, dépôt `ekylibre/fourmy`. Le nom et le logo
  « Ekylibre » restent réservés à l'entreprise ekylibre.com.

## 2. Utilisateurs cibles

| Profil | Usage principal | Support |
|---|---|---|
| **Exploitant** | Pilote la ferme, planifie, consulte l'historique, produit les registres réglementaires | Web (bureau) + mobile |
| **Salarié de terrain** | Saisit les interventions réalisées, consulte les consignes, au champ et souvent sans réseau | Mobile hors-ligne |

**Filières couvertes dès la v1** : grandes cultures, élevage, viticulture.

Hors cible v1 : conseillers, coopératives et négoces comme utilisateurs directs
(ils restent des cibles d'échange de données).

## 3. Périmètre

### Dans Fourmy
Productions, parcellaire, interventions, stocks (quantités), planification,
capteurs, traces GPS, matériels, bâtiments, animaux.

### Hors Fourmy (dans Lyvre)
Achats, ventes, facturation, comptabilité, juridique, valorisation financière.

### Mobile
**`zero-mobile`** (Expo, WatermelonDB, MapLibre) devient **l'application
mobile officielle de Fourmy**. Elle est aujourd'hui branchée sur l'API v2
d'Ekylibre et ne gère que la pulvérisation : elle est à ré-adapter à l'API de
Fourmy.

### Présence web
- **fourmy.org** (domaine acquis) : page du projet open source
  (documentation, contribution, plugins).
- **ekylibre.com** : présentation commerciale de Fourmy et de l'offre SaaS
  (site dans le dépôt local `ekylibre-sas`).

## 4. Exigences fonctionnelles

Identifiants : `FR-<domaine>-<n>`. Priorité : **M** (v1 obligatoire),
**S** (v1 souhaitée), **L** (plus tard).

### 4.1 Modèle temporel (transversal)
- **FR-TIME-1 (M)** Toute donnée physique est datée : on peut reconstituer
  l'état de la ferme à une date donnée (parcellaire, stocks, matériels,
  animaux).
- **FR-TIME-2 (M)** Le parcellaire évolue par campagne (découpages, îlots
  PAC) sans perte de l'historique.
- **FR-TIME-3 (S)** Toute modification est tracée (qui, quand, d'où :
  web, mobile, plugin, Aiffel).

### 4.2 Parcellaire et productions
- **FR-PARC-1 (M)** Gérer îlots, parcelles et zones cultivables avec leur
  géométrie, par campagne.
- **FR-PARC-2 (M)** Rattacher une production (culture, atelier d'élevage,
  vigne) à une parcelle et une campagne.
- **FR-PARC-3 (M)** Importer et exporter le parcellaire PAC (Telepac).
- **FR-PARC-4 (M)** Spécificités viticulture : cépage, porte-greffe, rangs,
  densité, année de plantation (repris de `ekylibre-viti`).

### 4.2 bis Viticulture et registres viticoles (v1)
- **FR-VITI-1 (M)** Interventions viticoles (taille, travaux en vert,
  vendanges) avec rendement par parcelle et par cépage.
- **FR-VITI-2 (M)** Cuverie : contenants, volumes, mouvements (entrées de
  vendange, soutirages, assemblages, sorties), dans le temps.
- **FR-VITI-3 (M)** Données de la **déclaration de récolte** produites à
  partir des vendanges.
- **FR-VITI-4 (S)** Registre de cave et données pour la DRM (déclaration
  récapitulative mensuelle). Le volet fiscal et douanier reste à arbitrer
  avec Lyvre.

### 4.2 ter Élevage — niveaux proposés
| Niveau | Contenu | Priorité |
|---|---|---|
| **N1 — Lots** | Troupeaux et lots avec effectifs dans le temps, mouvements agrégés (entrées, sorties, transferts), pâturage sur parcelle, alimentation et traitements par lot, consommations de stocks | **M** (retenu) |
| **N2 — Animal individuel** | Identification (n° national), naissances, morts, achats et ventes, filiation, carnet sanitaire, **registre d'élevage** (traitements vétérinaires et délais d'attente), pesées | **S** |
| **N3 — Échanges et production** | Notifications EDE / BDNI, données de production (lait, pesées connectées, robots de traite) via plugins | **L** |

Décision : N1 en v1, hors des 7 jours. N2 ensuite, car le registre d'élevage est
obligatoire mais demande l'identification individuelle pour les bovins.

### 4.3 Interventions
- **FR-INT-1 (M)** Planifier puis réaliser une intervention, avec ses
  intrants, ses sorties, ses outils (matériels), ses intervenants, ses cibles
  et sa période de travail (concept des procédures d'Ekylibre, simplifié).
- **FR-INT-2 (M)** Saisie depuis le mobile hors-ligne, synchronisation
  idempotente.
- **FR-INT-3 (M)** Une intervention réalisée met à jour les stocks
  (consommations, récoltes) et alimente les registres réglementaires.
- **FR-INT-4 (S)** Pré-remplir une intervention à partir d'une trace GPS
  de matériel (parcelle, durée, surface travaillée).
- **FR-INT-5 (M)** Les types d'interventions sont extensibles par plugin.

### 4.4 Stocks et articles
- **FR-STK-1 (M)** Suivre les quantités par article, lot et lieu de stockage,
  dans le temps.
- **FR-STK-2 (M)** Référentiel des articles : base issue de **Lexicon**,
  personnalisable dans Fourmy (articles propres à la ferme, alias, unités).
- **FR-STK-3 (M)** Un achat ou une vente saisi dans Lyvre crée le mouvement
  de stock correspondant dans Fourmy, et inversement les consommations sont
  remontées à Lyvre pour le calcul des coûts. Fourmy est maître des
  **quantités**, Lyvre de la **valeur**.
- **FR-STK-4 (S)** Traçabilité des lots, de l'intrant à la récolte.

### 4.5 Matériels et bâtiments
- **FR-MAT-1 (M)** Inventaire des matériels avec leur état dans le temps.
- **FR-MAT-2 (M)** Rattacher un traceur GPS à un matériel.
- **FR-MAT-3 (S)** Bâtiments géolocalisés, avec un modèle 3D optionnel.
- **FR-MAT-4 à FR-MAT-86** : fiche matériel, relevés d'heures (manuels ou
  estimés par Traccar), plan d'entretien à échéances, interventions
  d'entretien, pièces, logo 2D et avatar 3D.
  - Exigences : [`materiels-entretien.md`](materiels-entretien.md), du
    2026-11-07 et du 2026-11-08.
  - Réalisé le 2026-11-08 (lots I à M) : voir [`materiels.md`](materiels.md)
    et le bilan au §9 des exigences.

### 4.6 Traces GPS
- **FR-GPS-1 (M)** Ingérer les traces des matériels depuis **Traccar**
  (client pilote).
- **FR-GPS-2 (M)** Afficher et rejouer les traces sur la carte, filtrées par
  matériel, période et parcelle.
- **FR-GPS-3 (L)** Ingérer les données des consoles de tracteurs
  (ISO-XML / ISOBUS, ADAPT).

### 4.7 Capteurs
- **FR-CAP-1 (S)** Ingérer les mesures des stations et capteurs (Weenat et
  Sencrop, d'après les plugins existants).
- **FR-CAP-2 (S)** Rattacher un capteur à une parcelle ou un bâtiment, et
  afficher ses séries dans le temps.

### 4.8 Planification
- **FR-PLAN-1 (S)** Planifier les interventions d'une campagne, avec charge
  de travail et disponibilité des matériels et des personnes (repris de
  `ekylibre-planning`).

### 4.9 Visualisation du jumeau (carte et 3D)
- **FR-VIZ-1 (M)** Carte 2D de travail quotidien : parcellaire, productions,
  interventions, traces GPS, capteurs, en couches activables.
- **FR-VIZ-2 (M)** **Rejouer la ferme dans le temps** : une frise permet de
  voir l'état de la ferme et le déplacement des matériels à n'importe quelle
  date.
- **FR-VIZ-3 (M)** **Vue 3D** avec relief réel (LiDAR HD, RGE ALTI de l'IGN)
  et bâtiments.
- **FR-VIZ-4 (S)** Outils de relief inspirés de CutSheetRX (Senter Farms) :
  ombrage, pente, courbes de niveau, profil altimétrique tracé à la main,
  lecture de l'altitude au survol.
- **FR-VIZ-5 (S)** Suivre un matériel en direct sur la carte.
- **FR-VIZ-6 (M)** Les plugins peuvent ajouter une couche cartographique.

### 4.9 bis Jumeau observé : télédétection
Études : `claudedocs/etude_jumeau_3d.md` et `claudedocs/etude_copernicus.md` ;
conception : [`teledetection-design.md`](teledetection-design.md).
- **FR-TWIN-1 (M)** Chaque parcelle affiche son **état observé** à la date de
  la frise : NDVI Sentinel-2, avec la date d'acquisition et la part de
  pixels valides. Si aucune donnée n'est exploitable, l'interface le dit
  (pas de mesure, ancienne, parcelle trop petite) et n'invente jamais de
  valeur. *Réalisé (lot Y) ; NDRE et NDMI au choix depuis le 2026-11-11.*
- **FR-TWIN-2 (M)** Série temporelle de l'indice par parcelle, brute et
  lissée, comparée aux années précédentes, avec les interventions en
  repères. *Réalisé (lot Y).*
- **FR-TWIN-5 (S)** Images satellite (NDVI, couleurs naturelles) drapées sur
  la carte 2D et sur le relief du plan 3D. *Réalisé (lot Y).*
- **FR-TWIN-10 (S)** Signaler une **intervention probablement manquante** :
  le satellite voit le couvert d'une parcelle disparaître sans récolte,
  broyage, fauche ni labour saisi. L'exploitant saisit l'intervention
  pré-remplie ou écarte le signalement. *Réalisé (lot Z,
  [`teledetection.md`](teledetection.md)).*
- **FR-TWIN-3 (S)** **Végétation 3D** : les rangs de chaque parcelle dans le
  plan 3D, hauteur et couleur selon l'état observé (NDVI) et les
  interventions ; orientation des rangs automatique, corrigeable. *Réalisé
  (lot AA, [`jumeau-3d.md`](jumeau-3d.md)).*
- **FR-TWIN-4 (S)** **Météo visible** : ciel, brume, pluie ou neige, sol
  mouillé et gelée d'après la météo du jour de la frise. *Réalisé (lot AA).*
- **FR-TWIN-8 (S)** **Modèle de culture** : stade phénologique de chaque
  parcelle semée, dates prévues des stades, réserve en eau du sol et stress
  hydrique (ou besoin d'irrigation), d'après le semis saisi et la météo.
  *Réalisé (lot AB) en version simple : degrés-jours et bilan FAO-56, maïs et
  céréales à paille ([`modele-croissance.md`](modele-croissance.md)).
  WOFOST et l'assimilation du LAI restent à faire.* Les irrigations saisies
  (procédure « Irrigation », dose en mm) entrent dans le bilan hydrique.
  *Réalisé (lot AC).*
- **FR-TWIN-6 (S)** **Carte de modulation** : zonage intra-parcellaire
  d'après une image Sentinel-2 (2 à 5 zones de même surface), dose par zone
  (compenser, valoriser, uniforme ; bornes et largeur de la machine), export
  ISO-XML (TaskData, grille de type 1) et Shapefile. *Réalisé (lot AD,
  [`modulation.md`](modulation.md)).*
- **FR-TWIN-7 (C)** Import des TimeLogs ISOBUS : **remplacé** le 2026-11-11
  par la **connexion à agrirouter** (consentement OAuth de la ferme, envoi
  des cartes de modulation aux consoles reliées). *Réalisé (lot AD).* La
  réception (TimeLogs, doses appliquées) passera aussi par agrirouter.
- **FR-TWIN-9** (capteurs) : voir l'étude, lot ultérieur.

### 4.10 Réglementaire
- **FR-REG-1 (M)** **Registre phytosanitaire** produit à partir des
  interventions.
- **FR-REG-2 (M)** **PAC** : parcellaire et assolement déclaratifs.
- **FR-REG-3 (M)** **Fertilisation** : plan prévisionnel et cahier
  d'enregistrement, notamment en zone vulnérable nitrates.
  Exigences détaillées (2026-11-11) :
  [`fertilisation-exigences.md`](fertilisation-exigences.md). *Réalisé (lots AE
  à AK, [`fertilisation-design.md`](fertilisation-design.md)) pour la
  Nouvelle-Aquitaine : composition des fertilisants, zonage, référentiel
  régional, plan prévisionnel de fumure calculé et versionné, cahier
  d'enregistrement, contrôles à la saisie, interdiction d'épandage bloquante
  avec motif, conditions d'épandage, couverture des sols, couverts
  d'interculture, plafond APLSH, pilotage, justificatifs joints, tableau de
  bord, éditions.*
- **FR-REG-4 (S)** Indicateurs HVE (repris de `ekylibre-hve`).

### 4.11 Migration depuis Ekylibre
- **FR-MIG-1 (M)** Importer une instance Ekylibre existante : parcellaire
  historique, productions, interventions, stocks, matériels, animaux.
- **FR-MIG-2 (M)** Validation sur l'instance du client pilote
  (`haurigot.ekylibre-dev.com`), y compris ses données Traccar. Le pilote est
  **testeur de Fourmy** ; son instance Ekylibre reste en production.
- **FR-MIG-4 (M)** La migration est **en lecture seule** côté Ekylibre :
  aucune écriture, aucune modification de l'instance source. Elle peut être
  rejouée autant de fois que nécessaire.
- **FR-MIG-3 (S)** Rapport de migration : volume importé, rejets et écarts.

### 4.12 Plugins
- **FR-PLG-1 (M)** Des **tiers** (éditeurs, constructeurs, coopératives)
  peuvent publier des plugins sans recompiler Fourmy.
- **FR-PLG-2 (M)** Un plugin peut réagir aux événements de la ferme, ajouter
  des types d'interventions, des couches cartographiques, des panneaux d'UI
  et des connecteurs de données.
- **FR-PLG-3 (M)** Chaque plugin déclare ses permissions (lecture des stocks,
  écriture d'interventions…), et l'exploitant les accepte à l'installation.
- **FR-PLG-4 (M)** Les plugins peuvent être **open source ou privés**
  (propriétaires), malgré la licence AGPL du cœur. Le mécanisme (exception de
  licence, frontière API, ou les deux) est à arbitrer en design et doit être
  validé juridiquement, puis documenté pour les auteurs de plugins.
- **FR-PLG-5 (M)** Les plugins Ekylibre existants sont **référencés** comme
  cibles de réécriture dans le nouveau système, sans compatibilité :
  `ekylibre-weenat`, `ekylibre-sencrop`, `ekylibre-traccar`,
  `ekylibre-viti`, `ekylibre-hve`, `ekylibre-planning`.

### 4.13 Interopérabilité
- **FR-API-1 (M)** API publique documentée couvrant tout le jumeau.
- **FR-API-2 (M)** **Serveur MCP** natif pour qu'Aiffel (et d'autres agents)
  lisent et écrivent dans le jumeau, dans le respect des permissions.
- **FR-API-3 (M)** Synchronisation bidirectionnelle avec Lyvre (articles,
  mouvements de stock, consommations et temps pour les coûts).
- **FR-API-4 (S)** Standards visés : NGSI-LD / FIWARE AgriFood, OGC
  SensorThings, ISO-XML / ADAPT, eDAPLOS. Les nomenclatures viennent de
  Lexicon.

### 4.14 Comptes et distribution
- **FR-ACC-1 (M)** Deux modes de distribution : **SaaS** intégré à
  l'offre commune (Lyvre, Aiffel et autres services : SSO, paiement…) et
  **version open source auto-hébergeable**.
- **FR-ACC-2 (M)** En SaaS, authentification par le **SSO commun** ; en
  auto-hébergé, authentification autonome.
- **FR-ACC-3 (M)** Rôles minimum : exploitant (tout) et salarié (saisie et
  consultation).
- **FR-ACC-4 (S)** Multi-exploitation : un utilisateur peut accéder à
  plusieurs fermes.

## 5. Exigences non fonctionnelles

- **NFR-UX-1** L'UI et l'UX sont la **priorité n°1** de la refonte
  (principal irritant d'Ekylibre). L'interface utilise le design system
  **Lyvre** pour un air de famille avec l'écosystème.
- **NFR-UX-2** Vocabulaire métier français, i18n prévue dès le départ.
- **NFR-MOD-1** Modularité : le cœur est réduit au minimum, les filières et
  les intégrations sont des modules ou des plugins.
- **NFR-DEBT-1** Réduire la dette technique : tests automatisés, pas de code
  sans couverture sur le cœur, dépendances maintenues.
- **NFR-OFF-1** Mobile entièrement utilisable hors-ligne, synchro
  idempotente et sans perte.
- **NFR-PERF-1** Affichage fluide de plusieurs millions de points GPS et
  rejeu temporel sans blocage sur un poste de bureau courant.
- **NFR-PERF-2** Une version allégée de la carte (sans la 3D) reste
  utilisable sur mobile et tablette.
- **NFR-SEC-1** Plugins tiers isolés : un plugin ne peut accéder qu'aux
  données autorisées par ses permissions.
- **NFR-SEC-2** RGPD : données de la ferme exportables et supprimables.
- **NFR-OSS-1** L'auto-hébergement s'installe simplement (une procédure
  documentée, sans dépendance au SaaS).

## 6. User stories et critères d'acceptation

**US-1 — Rejouer une journée de travail (exploitant)**
En tant qu'exploitant, je veux rejouer le déplacement de mes tracteurs sur
une journée, pour vérifier ce qui a été fait sur chaque parcelle.
- Je choisis une date et un ou plusieurs matériels.
- La carte rejoue les traces Traccar à vitesse réglable, sur le parcellaire
  en vigueur à cette date.
- Je vois pour chaque parcelle traversée la durée de présence et la surface
  couverte.

**US-2 — Saisir un traitement au champ (salarié)**
En tant que salarié, je veux saisir un traitement phyto depuis mon téléphone,
sans réseau, pour qu'il apparaisse dans le registre.
- La saisie fonctionne en mode avion.
- À la synchronisation, l'intervention apparaît dans Fourmy une seule fois,
  même en cas de renvoi.
- Le stock de produit baisse et la ligne apparaît dans le registre phyto.

**US-3 — Voir la ferme au 15 mars (exploitant)**
En tant qu'exploitant, je veux voir l'état de ma ferme à une date passée.
- Je déplace la frise sur une date : parcellaire, cultures, stocks et
  matériels affichent leur état à cette date.

**US-4 — Vue 3D de l'exploitation (exploitant)**
- Le relief IGN et les bâtiments sont affichés en 3D.
- Je peux tracer un profil altimétrique et lire la pente d'une parcelle.

**US-5 — Migrer depuis Ekylibre (exploitant pilote)**
- L'import de l'instance du client pilote se termine avec un rapport.
- Les registres phyto de Fourmy et d'Ekylibre sont identiques sur une
  campagne de référence.

**US-6 — Installer un plugin tiers (exploitant)**
- J'installe un plugin capteur, je vois les permissions demandées, je les
  accepte.
- Les mesures apparaissent rattachées à mes parcelles, et le plugin ne peut
  lire rien d'autre que ce que j'ai autorisé.

**US-7 — Interroger la ferme via Aiffel (exploitant)**
- Aiffel répond à « qu'est-ce qui a été traité sur la parcelle X cette
  semaine ? » en interrogeant Fourmy par MCP.

**US-8 — Achat dans Lyvre (exploitant)**
- Une facture d'achat d'engrais saisie dans Lyvre crée l'entrée de stock
  dans Fourmy, sans double saisie.

## 7. Première tranche et contraintes de livraison

**Contrainte** : 7 jours, avec un développement **multi-agent** (plusieurs
agents de code en parallèle). Conséquences, qui sont des exigences :

- **NFR-DEV-1** Le dépôt est découpé en modules aux frontières nettes
  (parcellaire, interventions, stocks, GPS, carte, migration, mobile), pour
  que des agents travaillent en parallèle sans conflit.
- **NFR-DEV-2** Les contrats (modèle de domaine, API, événements) sont
  écrits et figés **avant** l'implémentation parallèle.
- **NFR-DEV-3** Chaque module a ses tests automatisés et une CI qui bloque
  les régressions, pour vérifier le travail des agents.
- **NFR-DEV-4** Un jeu de données de test anonymisé, issu de l'instance du
  pilote, sert de référence commune à tous les agents.

**Risque** : la v1 complète (sections 4.1 à 4.14) ne tient pas en 7 jours.
Les 7 jours visent la **première tranche** ci-dessous ; le reste suit.

### Fermes pilotes et sources de données

| Ferme | Rôle | Données |
|---|---|---|
| **Pierre** (`haurigot.ekylibre-dev.com`) | Pilote grandes cultures et traces GPS | **Export de l'instance** Ekylibre + **API Traccar** (accès fourni par l'équipe) |
| **Frédéric** (`entredeuxterres`) | Pilote viticulture et cuverie | **Export de l'instance** Ekylibre (9 cuves, réceptions de vendange) |
| `ferme-des-loubes` | Jeu de test supplémentaire (vigne et grandes cultures) | **Export de l'instance** Ekylibre, migration seulement |

- **FR-MIG-5 (M)** La migration part d'un **export d'instance** Ekylibre,
  jamais d'une connexion à l'instance en production.
- **FR-GPS-4 (M)** L'ingestion Traccar passe par l'**API Traccar** (accès en
  lecture). Les identifiants restent hors du dépôt.

### Contenu de la première tranche (7 jours)

1. **Migration** Ekylibre → Fourmy depuis les exports des deux fermes
   (parcellaire, productions, interventions, stocks, matériels, cuverie).
2. **Parcellaire versionné**, y compris le parcellaire viticole, avec carte
   2D et frise temporelle.
3. **Traces Traccar** de Pierre et leur rejeu (US-1, US-3).
4. **Interventions, stocks et registre phyto** (US-2, avec `zero-mobile`
   ré-adapté).
5. **Plan 3D de la ferme** avec le relief IGN, les bâtiments, le
   parcellaire et la **cuverie** de Frédéric : les cuves sont placées dans
   les bâtiments, avec leur volume et leur contenu à la date de la frise
   (US-4, US-9).

**Hors des 7 jours** : synchro Lyvre, MCP / Aiffel, système de plugins,
élevage N1, PAC, fertilisation, capteurs, planification, déclaration de
récolte et registre de cave.

**US-9 — Voir sa cuverie dans le plan 3D (vigneron)**
- Les cuves apparaissent dans leurs bâtiments, sur le plan 3D de la ferme.
- Au clic sur une cuve : volume, contenu (cépages, millésime) et derniers
  mouvements.
- En déplaçant la frise, le remplissage des cuves suit l'historique des
  mouvements.

## 8. Questions ouvertes

### Tranchées le 2026-11-06
- Plugins : open source **et** privés autorisés (FR-PLG-4).
- Viticulture : registres viticoles en v1 (§4.2 bis).
- Pilote : testeur de Fourmy, instance Ekylibre intouchée (FR-MIG-4).
- Mobile : `zero-mobile` est l'app officielle.
- Délai : 7 jours, multi-agent (§7).
- Web : fourmy.org (projet open source), ekylibre.com (présentation).

- Élevage : **N1 (lots)** en v1 ; N2 et N3 plus tard.
- Synchro Lyvre : après les 7 jours.
- Viticulture dans les 7 jours : parcellaire et cuverie dans le plan 3D,
  avec la ferme de Frédéric.
- Données pilotes : exports d'instances Ekylibre + API Traccar.

### Restantes
- ~~Q1 — Format des exports~~ : sauvegarde de tenant Ekylibre (zip avec
  dump SQL texte, un schéma par ferme). Vérifié le 2026-11-07
  (architecture §6.1).
- ~~Q2 — Géométrie des bâtiments et des cuves~~ : vérifié le 2026-11-07,
  les bâtiments ont une emprise 2D, les cuves n'ont aucune géométrie.
  ADR-10 s'applique (BD TOPO + placement automatique des cuves).
- ~~Q3 — Anonymisation~~ (2026-11-07) : les agents travaillent sur des
  **fixtures anonymisées** produites au jour 1 (personnes, tiers et pièces
  jointes remplacés ; géométries et données agronomiques conservées). Les
  exports bruts ne servent qu'à la recette des jours 6 et 7, hors du dépôt.
- ~~Q4 — Marque~~ (2026-11-07) : dépôt INPI reporté, hors du périmètre
  actuel.
- ~~Q5 — Jeton Traccar~~ (2026-11-07) : jeton dédié du compte de Pierre créé côté Traccar, `/api/devices` et `/api/positions` accessibles (3 boîtiers).

## Annexe — Propositions techniques issues du cadrage (non tranchées)

À arbitrer dans `/sc:design` :
- Backend TypeScript (Hono ou NestJS, Drizzle) ; alternative Rails 8.
- PostgreSQL + PostGIS + TimescaleDB ; bus NATS JetStream.
- Ingestion terrain : MQTT (EMQX), ChirpStack (LoRaWAN), parseur ISO-XML / ADAPT.
- Service Python pour les modèles agronomiques et le ML.
- Front Vue 3 ; carte MapLibre + deck.gl ; 3D CesiumJS.
- Plugins : WASM (Extism) côté serveur, Web Components côté front, manifeste
  de permissions.
