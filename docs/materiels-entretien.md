# Fourmy — Matériels et entretien (exigences)

> Document produit par `/sc:brainstorm` le 2026-11-07. Il précise
> **FR-MAT** de [`requirements.md`](requirements.md) §4.5.
> Phase suivante : `/sc:design` (modèle de données, API, écrans web et
> `zero-mobile`).
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

### 3.6 Hors périmètre
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
