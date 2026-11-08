# Fourmy — Matériels et entretien (exigences)

> Document produit par `/sc:brainstorm` le 2026-11-07. Il précise
> **FR-MAT** de [`requirements.md`](requirements.md) §4.5.
> Design : [`materiels-entretien-design.md`](materiels-entretien-design.md).
> Phase suivante : `/sc:implement`, lot par lot (I → J → K → L).
> Ce document décrit **uniquement les exigences**.

## 1. Origine

- **Données de départ** : base des deux tracteurs du pilote Pierre (CLAAS
  ARION 630 C n° A2001702, ARION 430 n° A2108967), construite à partir des
  notices constructeur et du catalogue de pièces CLAAS PartsDoc. Elle est
  rangée dans `ressources_fourmy/data_pierre/materiels/` :
  - fiches techniques sourcées page par page ;
  - fluides ;
  - plans d'entretien (≈ 60 opérations par tracteur) ;
  - environ 1 500 références de pièces lues, dont les pièces d'entretien
    reliées aux opérations ;
  - modèles de suivi `heures.csv` et `interventions.csv`.
- **Benchmark** : xFarm, Karnott et Sharemat
  (`data_pierre/materiels/benchmark_logiciels/SYNTHESE_xfarm_karnott_sharemat.md`).
  - **Sharemat** a le meilleur modèle d'échéances : profil de maintenance,
    puis type d'intervention périodique (jours, heures ou km), puis
    configuration par matériel.
  - **Karnott** calcule seul les heures, mais n'a pas de rappels par heures.
  - **xFarm** n'a qu'un journal d'entretien simple.
  - **Aucun** ne relie les pièces constructeur aux opérations d'entretien,
    ni ne tire son plan de la notice constructeur : c'est la différence de
    Fourmy.

## 2. Décisions (2026-11-07)

| Sujet | Décision |
|---|---|
| Usage | **Exploitation seule**. Pas de réservation, de répartition entre adhérents ni de facturation de travaux (contexte CUMA/ETA hors périmètre). |
| Où | **Fourmy web** (bureau) et **`zero-mobile`** (hangar, champ, hors-ligne). |
| Qui | **Toutes les personnes qui travaillent sur la ferme** (membres `owner` et `worker`). |
| Heures moteur | **Saisie manuelle toujours possible**, ou remontée automatique par une intégration activée. Première intégration : **Traccar** (déjà présent dans Fourmy). Karnott, télématique constructeur et autres viendront plus tard, par plugin. |
| Autonomie | Fourmy fonctionne sans service externe. Une intégration ne fait qu'ajouter des relevés. |
| Argent | Coûts et factures d'entretien relèvent de **Lyvre** (Fourmy ne connaît pas les prix, cf. `architecture.md`). Fourmy garde les quantités : pièces, fluides, temps. |

## 3. Exigences fonctionnelles

Identifiants dans la suite de `requirements.md`. Priorités : **M** (v1
obligatoire), **S** (v1 souhaitée), **L** (plus tard).

### 3.1 Fiche matériel
- **FR-MAT-4 (M)** Fiche d'identité :
  - marque, modèle, type, n° de série, année ;
  - catégorie (tracteur, outil, automoteur…) ;
  - agrégats (moteur, boîte, ponts, avec leurs numéros) ;
  - options montées (ex. relevage et prise de force avant), datées.
- **FR-MAT-5 (S)** Fiche technique : dimensions, masses, moteur, capacités,
  pneumatiques. Chaque valeur porte sa **source** (document, page) et peut
  avoir des alternatives (selon option ou version).
- **FR-MAT-6 (S)** Visuel du matériel et logo de la marque. Le logo est
  partagé par marque, pas copié pour chaque matériel.
- **FR-MAT-7 (S)** Documents rattachés : notice, catalogue, carte grise,
  assurance, contrôle technique. Un document joint est consultable sur
  mobile.
- **FR-MAT-8 (S)** Import d'une fiche complète depuis les fichiers de la base
  Arion (`machine.json`, `fiche_technique.json`, `entretien/*`,
  `pieces/*`), pour amorcer la ferme pilote.

### 3.2 Compteurs et relevés d'heures
- **FR-MAT-10 (M)** Relevé de compteur : matériel, date et heure, valeur
  (heures moteur), auteur, **origine**, note. Origines possibles : `manuel`,
  `intervention`, `traccar`, puis d'autres connecteurs.
- **FR-MAT-11 (M)** Saisie d'un relevé en quelques gestes sur mobile,
  **hors-ligne**, par tout membre de la ferme.
- **FR-MAT-12 (M)** Contrôle de cohérence : un relevé inférieur au précédent
  est refusé, sauf **correction** explicite et motivée (ex. compteur
  remplacé). La correction est tracée.
- **FR-MAT-13 (M)** **Intégration Traccar** : lire les heures moteur du
  boîtier rattaché au matériel (`tracker_bindings`) et créer des relevés
  d'origine `traccar`.
  - Si le boîtier ne remonte pas de compteur, déduire le temps de
    fonctionnement de ses données (contact, mouvement).
  - Le relevé est alors marqué **estimé**.
  - **v1** : c'est le cas de tous les boîtiers du pilote. Les estimations
    sont recalées sur le dernier relevé manuel.
- **FR-MAT-14 (M)** Une intégration est **désactivable sans perte** : les
  relevés déjà importés restent. La saisie manuelle reste prioritaire en cas
  d'écart, qui est signalé.
- **FR-MAT-15 (L)** Autres sources d'heures par plugin : Karnott,
  télématique constructeur (CLAAS TELEMATICS, John Deere Operations Center…),
  ISOBUS.

### 3.3 Plan d'entretien et échéances
- **FR-MAT-20 (M)** Plan d'entretien par matériel : liste d'opérations
  (vidange moteur, filtres, graissages, contrôles…). Chaque opération a :
  - une **périodicité** en heures et/ou en mois, au premier terme atteint
    (pas de km en v1) ;
  - un type (remplacement, contrôle, graissage, nettoyage, réglage) ;
  - un exécutant prévu (utilisateur ou atelier) ;
  - une source (notice, page) ;
  - une applicabilité (toujours, ou seulement si une option est montée).
- **FR-MAT-21 (M)** Visites initiales (ex. première révision à 50 h) et
  opérations ponctuelles.
- **FR-MAT-22 (M)** **Modèle de plan par défaut** pour chaque modèle de
  matériel (ex. « ARION 430 »). Il est appliqué à la création du matériel,
  puis ajustable par la ferme sans modifier le modèle. Inspiré des profils de
  maintenance de Sharemat.
- **FR-MAT-23 (M)** **Échéances calculées** pour chaque opération :
  - prochaine échéance = dernière réalisation + périodicité ;
  - état **à jour / bientôt / en retard** ;
  - seuil « bientôt » réglable, par défaut 50 h ou 1 mois ;
  - sans réalisation connue : départ à la mise en service ou à une date et
    un compteur de référence saisis.
- **FR-MAT-24 (M)** Tableau de bord de la ferme : les matériels et
  opérations **en retard ou à venir**, triés par urgence, sur web et mobile.
- **FR-MAT-25 (S)** **Notifications** aux membres choisis quand une
  opération passe à « bientôt » ou « en retard ».
- **FR-MAT-26 (S)** Fluides préconisés par organe : capacité, norme,
  viscosité, produit constructeur. Ils sont affichés avec l'opération
  correspondante.

### 3.4 Réalisation (journal d'entretien)
- **FR-MAT-30 (M)** Une opération d'entretien réalisée est une
  **intervention de forme `maintenance`** (cf. `interventions.md`). Elle
  porte :
  - matériel(s) cible(s) ;
  - date et période de travail ;
  - **relevé de compteur** ;
  - opérations du plan réalisées ;
  - pièces et fluides consommés (articles, quantités) ;
  - intervenants : membres de la ferme, ou nom d'un atelier externe (texte
    libre, sans fiche tiers) ;
  - notes et photos.
- **FR-MAT-31 (M)** L'enregistrement **remet à zéro** les échéances des
  opérations réalisées et crée le relevé de compteur (origine
  `intervention`).
- **FR-MAT-32 (M)** Saisie sur `zero-mobile` hors-ligne, synchronisation
  idempotente (comme les autres interventions). Depuis une échéance, la
  saisie est **pré-remplie** (opérations, pièces et fluides prévus).
- **FR-MAT-33 (M)** Pannes et réparations hors plan : même intervention
  `maintenance`, sans opération du plan, avec description du problème.
- **FR-MAT-34 (S)** Historique par matériel : interventions, relevés,
  pièces posées. Consultable à une date passée (FR-TIME-1).
- **FR-MAT-35 (S)** Les consommations de pièces et fluides **sortent du
  stock** (FR-STK-1). Elles sont remontées à **Lyvre**, qui porte les coûts
  et les factures d'atelier.

### 3.5 Pièces
- **FR-MAT-40 (M)** Référentiel de pièces par matériel : référence
  constructeur, désignation, quantité, famille d'entretien (filtre à huile
  moteur, filtre à air primaire…), position dans le catalogue (groupe, planche,
  repère). Chaque pièce est un **article** (FR-STK-2), réutilisable entre
  matériels.
  - **v1** : ce sont des articles propres à la ferme (pilote : Pierre),
    sans ajout à Lexicon.
- **FR-MAT-41 (M)** Lien **opération ↔ pièces** : chaque opération du plan
  liste les références à prévoir.
- **FR-MAT-42 (S)** **Pièces à commander** pour les échéances d'une période
  (ex. 3 mois ou 200 h), regroupées par référence, avec le stock disponible.
- **FR-MAT-43 (L)** Références équivalentes (autres marques) et lien vers le
  catalogue constructeur.

### 3.6 Adaptation des interventions (brainstorm du 2026-11-08)

**État actuel** (relevé le 2026-11-08) :
- La forme `maintenance` existe, avec deux procédures :
  `equipment_maintenance` et `installation_maintenance`.
- La saisie se limite aux matériels entretenus (liste), aux périodes, aux
  intrants et aux intervenants. Le panneau de droite est celui du phyto.
- Un matériel n'a que nom, nature et état. Il n'a ni fiche ni écran à lui.
- Les articles n'ont pas de nature « pièce » ni « fluide ». Les
  interventions n'ont pas de photos.
- Pierre a **62 entretiens migrés d'Ekylibre** :
  - aucun n'a de note ni de relevé d'heures ;
  - certains n'ont pas de matériel cible ;
  - quelques-uns ont des pièces (socs de charrue Grégoire Besson).

Ce que l'intervention doit apprendre pour couvrir FR-MAT-30 à 35 :

- **FR-MAT-50 (M) Relevé par matériel ciblé.** Chaque matériel ciblé
  **équipé d'un compteur** porte son relevé (heures) à la date de
  l'intervention.
  - Le relevé est facultatif mais demandé.
  - Sans relevé, l'échéance repart de la **date seule**, ce qui est signalé.
  - Le relevé créé a l'origine `intervention`.
  - Il est contrôlé comme un relevé saisi : il doit rester entre le relevé
    précédent et le relevé suivant, même saisi après coup (FR-MAT-12).
- **FR-MAT-51 (M) Opérations du plan réalisées.** Pour chaque matériel
  ciblé, on coche les opérations du plan.
  - Pour un **contrôle**, on note un résultat : RAS ou anomalie, avec un
    texte.
  - Une anomalie peut ouvrir une réparation **planifiée** (FR-MAT-55).
- **FR-MAT-52 (M) Nature de l'entretien.** L'intervention est **préventive**
  (au moins une opération du plan) ou **curative** (panne, réparation).
  - Une intervention curative demande une **description du problème**.
  - La nature est déduite des opérations cochées, et reste modifiable.
- **FR-MAT-53 (M) Pièces et fluides en intrants.** Il faut deux nouvelles
  natures d'articles : **pièce** et **fluide** (huiles, graisses, AdBlue,
  liquide de refroidissement).
  - Unités : pièce, litre, kg.
  - Pré-remplissage depuis les opérations cochées : pièces liées
    (FR-MAT-41) et quantité de fluide préconisée (FR-MAT-26).
  - Un intrant est rattaché au matériel ciblé, quand l'intervention en vise
    plusieurs.
- **FR-MAT-54 (M) Intervenants.** Membres de la ferme et/ou **atelier
  externe** : un nom en texte libre, avec un n° de bon ou de facture
  facultatif pour le rapprochement dans Lyvre.
  - Les « outils » (matériels utilisés) sont masqués pour cette forme.
- **FR-MAT-55 (M) Planifier depuis une échéance.** Depuis une échéance, deux
  actions :
  - « Réaliser » ouvre la saisie **pré-remplie** (FR-MAT-32) ;
  - « Planifier » crée une intervention `planned`, pré-remplie de la même
    façon.
  - Seule une intervention `done` remet l'échéance à zéro.
  - Annuler, supprimer ou modifier une intervention `done` **recalcule**
    les échéances : elles sont calculées, jamais stockées (NFR-MAT-5).
- **FR-MAT-56 (M) Panneau de droite propre à l'entretien.** À la place des
  conditions de traitement et de la conformité phyto, il affiche pour le
  matériel choisi :
  - dernier relevé ;
  - échéances en retard et à venir, que l'on peut ajouter en un clic ;
  - pièces prévues avec leur stock ;
  - fluides préconisés.
- **FR-MAT-57 (M) Fiche d'intervention d'entretien.** La fiche affiche :
  - matériel(s) et relevé ;
  - opérations réalisées, avec leur source (notice, page) ;
  - résultat des contrôles ;
  - pièces et fluides ;
  - atelier ;
  - **prochaine échéance** de chaque opération après cette intervention.
- **FR-MAT-58 (S) Photos.** On joint des photos à l'intervention (panne,
  pièce usée, compteur). Elles sont consultables sur mobile.
  - D'abord pour l'entretien, puis pour toutes les formes.
- **FR-MAT-59 (S) Historique migré.** Les entretiens venus d'Ekylibre
  restent des interventions **curatives sans opération**.
  - L'exploitant peut ensuite les rattacher à des opérations du plan, pour
    amorcer les échéances.
  - Ceux qui n'ont pas de matériel sont signalés « matériel à préciser ».
- **FR-MAT-60 (S) Relevé en fin de chantier.** Toute intervention de champ
  qui utilise un matériel à compteur (outil `tools[]`, ex. le tracteur d'un
  labour) peut porter un relevé de fin de chantier, facultatif. C'est
  l'occasion la plus naturelle de relever les heures.
- **FR-MAT-61 (L) Heures estimées depuis les chantiers.** Sans Traccar, la
  durée des interventions de champ d'un matériel peut donner un relevé
  **estimé**, recalé sur le dernier relevé réel, comme pour Traccar.
- **FR-MAT-62 (S) Bâtiments et installations.** `installation_maintenance`
  vise un lieu (bâtiment) ou un contenant (cuve).
  - Mêmes champs, sans compteur.
  - Plan d'entretien possible plus tard (contrôle électrique, nettoyage des
    cuves).

### 3.7 Écrans matériels (prérequis)

- **FR-MAT-70 (M) Liste des matériels** : nature, état, dernier relevé et
  **badge d'échéances** (en retard, bientôt). Filtres par nature et par
  état.
- **FR-MAT-71 (M) Fiche matériel en onglets**, sur le modèle de la fiche
  parcelle :
  - Général (identité, agrégats, options) ;
  - Technique ;
  - Entretien (plan et échéances) ;
  - Relevés ;
  - Historique (interventions d'entretien et de champ) ;
  - Pièces ;
  - Documents.
- **FR-MAT-72 (M) Compteur par matériel** : présence et unité (heures en
  v1).
  - Par défaut, tracteurs et automoteurs ont un compteur, les outils
    traînés n'en ont pas.
  - Modifiable sur la fiche.
- **FR-MAT-73 (M) Accès** depuis le menu principal (« Matériels ») et depuis
  le tableau de bord de la ferme (FR-MAT-24).

### 3.8 Logo 2D et avatar 3D (demande du 2026-11-08)

- **FR-MAT-80 (M) Logo 2D par matériel.** On attache une image à un
  matériel : logo, pictogramme ou photo détourée. Formats PNG, SVG ou JPEG.
  - **Repli** : sans image propre, on affiche le **logo de la marque**,
    partagé par marque (FR-MAT-6), puis un pictogramme selon la nature.
  - **Usages** :
    - liste et fiche des matériels ;
    - formulaires d'intervention ;
    - marqueur du matériel sur la carte 2D ;
    - étiquette au-dessus de l'avatar 3D.
- **FR-MAT-81 (M) Avatar 3D généré.** Fourmy **génère** un modèle 3D
  (glTF) de chaque matériel à partir de :
  - sa **nature** : tracteur, automoteur, outil traîné, outil porté,
    pulvérisateur, remorque… ;
  - ses **dimensions** : celles de la fiche technique (longueur,
    empattement, largeurs, hauteur, pneumatiques), sinon des valeurs par
    défaut de la nature ;
  - sa **couleur** : celle de la marque ou une couleur choisie ;
  - son **logo 2D**, posé sur les flancs.

  L'avatar est à l'échelle réelle, sans prétendre reproduire le dessin du
  constructeur. Il est regénéré quand ses paramètres changent.
- **FR-MAT-82 (S) Réglage de l'avatar.** Sur la fiche matériel, on voit
  l'aperçu 3D et on ajuste les paramètres : gabarit, dimensions, couleurs,
  largeur de travail d'un outil. Chaque valeur indique d'où elle vient
  (fiche technique, défaut, saisie).
- **FR-MAT-83 (S) Modèle 3D importé.** On peut remplacer l'avatar généré
  par un fichier glTF/GLB fourni, avec une taille et un nombre de triangles
  limités.
- **FR-MAT-84 (M) Avatar dans la vue 3D avec Traccar.** Au rejeu d'une
  trace, le matériel est représenté par son avatar, et non plus par un
  point.
  - L'avatar est orienté selon le cap.
  - Il est posé sur le relief et à l'échelle.
  - Il garde une taille minimale à l'écran quand on dézoome.
- **FR-MAT-85 (S) Attelage.** Si un outil est connu à cet instant, son
  avatar est attelé derrière le tracteur, à la largeur de travail.
  - L'outil est connu par l'attribut `tool` de Traccar ou par les
    matériels de l'intervention en cours.
- **FR-MAT-86 (S) Tous les matériels à la date.** La vue 3D peut afficher
  la dernière position connue de chaque matériel suivi, à la date de
  l'horloge, avec son avatar. C'est la ferme rejouée dans le temps.

### 3.9 Hors périmètre
- Réservation de matériel, planning partagé entre exploitations,
  répartition des heures entre adhérents, facturation de travaux.
- Valorisation, prix et coûts des pièces (Lyvre).
- Contrôle réglementaire des pulvérisateurs : à traiter plus tard, comme
  une opération périodique avec document joint.

## 4. Exigences non fonctionnelles
- **NFR-MAT-1** Tout fonctionne **sans intégration** : saisie manuelle
  seule.
- **NFR-MAT-2** Mobile **hors-ligne** pour les relevés, les échéances
  (dernière synchro) et les interventions d'entretien.
- **NFR-MAT-3** Toute valeur technique et toute opération du plan restent
  **sourcées** (document, page).
- **NFR-MAT-4** Droits :
  - tout membre (`owner`, `worker`) consulte, saisit des relevés et
    enregistre des interventions d'entretien ;
  - seul `owner` modifie le plan d'entretien, la fiche et les
    intégrations ;
  - les corrections de compteur sont tracées (FR-TIME-3).
- **NFR-MAT-5** Calcul des échéances déterministe et reproductible à une
  date donnée (rejouer la ferme dans le temps).
- **NFR-MAT-6** Identifiants externes conservés sur la fiche : n° de
  série, identifiant Traccar, futurs identifiants Karnott ou constructeur.

## 5. Récits utilisateurs et critères d'acceptation

**US-MAT-1 — Voir ce qui est à faire.** Je suis membre de la ferme de Pierre
et j'ouvre l'entretien.
- Je vois l'ARION 430 et l'ARION 630 C avec leurs opérations en retard ou à
  venir.
- Chaque opération affiche son échéance en heures et en date, et les
  références de pièces CLAAS.
- Cela fonctionne avec seulement des relevés saisis à la main.

**US-MAT-2 — Saisir les heures au hangar.** Sur `zero-mobile`, sans réseau,
je choisis le tracteur et saisis 4 321 h.
- Le relevé est enregistré avec l'origine `manuel` et synchronisé au retour
  du réseau, sans doublon.
- Une valeur inférieure à la précédente est refusée, sauf correction
  motivée.

**US-MAT-3 — Faire la vidange.** Depuis l'échéance « vidange moteur » de
l'ARION 430, je lance la saisie.
- Elle est pré-remplie avec le filtre à huile (référence CLAAS) et la
  quantité d'huile.
- J'ajuste, j'indique les heures et je valide.
- L'échéance repart de ce compteur, le relevé `intervention` est créé et
  les consommations sortent du stock.

**US-MAT-4 — Heures remontées par Traccar.** Le boîtier Traccar du 630 C est
rattaché.
- Des relevés `traccar` (ou `traccar` estimé) apparaissent sans saisie et
  font avancer les échéances.
- Si je désactive l'intégration, aucun relevé ni intervention ne
  disparaît.

**US-MAT-5 — Préparer la commande.** Je demande les pièces pour les 200
prochaines heures.
- J'obtiens la liste des références CLAAS, les quantités et ce que j'ai déjà
  en stock.

**US-MAT-6 — Amorcer la ferme pilote.** J'importe la base Arion.
- Les deux tracteurs ont leur fiche, leur plan (avec sources), leurs pièces
  d'entretien et leurs fluides.
- Les opérations non applicables (option absente d'usine) sont marquées
  comme telles.

**US-MAT-7 — Panne au champ.** Le relevage avant de l'ARION 630 C fuit.
- Je saisis une intervention d'entretien **curative**, avec la description
  « fuite vérin relevage AV », le nom de l'atelier et les heures du
  compteur.
- Aucune opération du plan n'est cochée, donc aucune échéance ne bouge.
- Le relevé d'heures est bien enregistré.

**US-MAT-8 — Contrôle avec anomalie.** Pendant la révision des 500 h, le
contrôle des freins révèle une usure.
- Je coche le contrôle avec le résultat « anomalie » et un texte.
- Fourmy propose de **planifier** une réparation, pré-remplie avec le
  matériel et la description.

**US-MAT-9 — Corriger après coup.** Je supprime une vidange saisie par
erreur.
- L'échéance « vidange moteur » revient à la réalisation précédente.
- Le relevé d'origine `intervention` créé par cette vidange disparaît avec
  elle.

**US-MAT-10 — Heures en fin de labour.** Je saisis un labour avec l'ARION 630
C et j'indique 4 352 h en fin de chantier.
- Le relevé est créé et les échéances avancent.
- Le labour n'est pas modifié pour autant.

## 6. Arbitrages (2026-11-07)
1. **Traccar** : les boîtiers du pilote **ne remontent pas encore** de
   compteur d'heures.
   - En v1, les relevés `traccar` sont donc **estimés** à partir du temps de
     fonctionnement (contact, mouvement) et recalés sur le dernier relevé
     manuel (FR-MAT-13).
   - La lecture d'un vrai compteur (`hours`) sera ajoutée quand les boîtiers
     le fourniront.
2. **Modèle de plan** : il existe un **modèle par défaut** par modèle de
   matériel (ex. « ARION 430 »).
   - Il est appliqué à la création du matériel, puis ajustable par la
     ferme (FR-MAT-22 passe en **M**).
   - Le plan ajusté appartient à la ferme ; le modèle par défaut n'est pas
     modifié.
3. **Pièces** : les références CLAAS sont des **articles propres à la ferme
   de Pierre** pour l'instant, sans ajout à Lexicon. Un référentiel commun
   des pièces pourra venir plus tard.
4. **Atelier externe** : un **simple nom** (texte) sur l'intervention, pas
   de fiche tiers.
5. **Kilomètres** : **pas de périodicité en km en v1**, seulement heures et
   mois.

## 7. Questions restantes (pour le design)
1. **Fréquence des relevés Traccar estimés** : un relevé par synchro, ou un
   par jour d'activité ?
2. **Source des modèles par défaut** : qui les fournit et les met à jour ?
   - Au départ, ils viennent de la base Arion ; les autres modèles de
     matériel seraient à construire.
   - Il faut choisir le support : un fichier dans le dépôt ou un catalogue
     dans la base.

## 8. Arbitrages du 2026-11-08
1. **Procédures** : une seule procédure, `equipment_maintenance`. Sa
   **nature** (préventif ou curatif) est déduite des opérations cochées et
   reste modifiable (FR-MAT-52).
2. **Heures estimées depuis les chantiers** (FR-MAT-61) : plus tard. En v1,
   les relevés viennent :
   - de la saisie manuelle ;
   - de la fin de chantier (FR-MAT-60, qui reste en **S**) ;
   - de Traccar.
3. **Photos** (FR-MAT-58) : plus tard, avec les documents des matériels
   (FR-MAT-7).
4. **Découpage** en quatre lots, dans l'ordre I → J → K → L :
   - **I** : écrans matériels, compteur et relevés (FR-MAT-4, 10 à 12, 70
     à 73) ;
   - **J** : plan, échéances et import de la base Arion (FR-MAT-8, 20 à 24,
     40 et 41) ;
   - **K** : intervention d'entretien adaptée (FR-MAT-30 à 33 et 50 à 57) ;
   - **L** : Traccar (FR-MAT-13 et 14), pièces à commander (FR-MAT-42) et
     notifications (FR-MAT-25).
