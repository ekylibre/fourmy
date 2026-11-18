# Besoins : refonte de la fiche d'une intervention

*Brainstorm du 2026-11-18. Document de besoins : la conception suit
(`/sc:design`). Page concernée : `apps/web/src/features/interventions/InterventionPage.tsx`.
Cas d'essai : la pulvérisation du 05/10/2026 (Arion 430 + Amazone UF1201,
Barbarian ST à 1,5 l/ha, 6 parcelles).*

## 1. Objectif

La fiche d'une intervention doit répondre, dans l'ordre où l'exploitant se
pose les questions :
1. **Dans quelles conditions ?** Météo, et pour une pulvérisation : les
   conditions étaient-elles bonnes ?
2. **Où, et sur quelle part ?** Parcelles, hectares travaillés, part de chaque
   parcelle.
3. **Avec quoi, et qui ?** Attelages, matériels, intervenants, parcours GPS.
4. **Quels produits, et à quelle dose ?** Intrants, avec un feu par ligne pour
   une pulvérisation.
5. **Est-ce conforme ?** Contrôle réglementaire et IFT, avec un feu chacun.

L'historique sert rarement : il ne doit plus occuper l'écran.

## 2. État actuel (constaté)

- **Colonne gauche** : périodes ou attelages, parcours GPS (pavé séparé),
  parcelles, entretien, irrigation, intrants et sorties, météo (en
  avant-dernier), moyens.
- **Colonne droite** : carte, contrôle réglementaire, nitrates, IFT,
  historique (déplié, long : 50 entrées sur l'UF1201).
- **Parcelles** : surface de la parcelle seule, avec la mention « (surface
  travaillée) » quand une zone existe, mais sans la surface travaillée ni la
  part de la parcelle.
- **Contrôle réglementaire** : un badge de niveau global, déjà en couleur
  (`LEVELS` : lichen, ardoise, paille, brique). **IFT** : un nombre, sans feu.
- **Aucun lien** vers le rejeu 3D de l'intervention.

## 3. Exigences fonctionnelles

### FR-IV-1 : ordre des pavés
- **Colonne gauche, de haut en bas** :
  1. Météo (et conditions de pulvérisation) ;
  2. Parcelles ;
  3. Moyens (attelages, matériels, intervenants, parcours GPS) ;
  4. Intrants et sorties ;
  5. puis, s'il y en a : entretien, irrigation.
- **Colonne droite** : carte, contrôle réglementaire, nitrates, IFT, puis
  l'historique replié.
- Sur mobile, une seule colonne dans l'ordre : météo, parcelles, carte,
  moyens, intrants, conformité, IFT, historique.

### FR-IV-2 : météo et conditions de pulvérisation
- Le pavé Météo garde son contenu actuel : temps dominant, température,
  hygrométrie, vent, pluie et courbe horaire.
- **Pour une pulvérisation** (procédés de forme `treatment` : `spraying`,
  `spraying_on_cultivation`, `generic_spraying`…), on ajoute un bandeau
  « Conditions de pulvérisation » :
  - un **feu global** (le plus défavorable des critères) ;
  - un feu par critère, avec la valeur relevée et le seuil :

| Critère | Vert | Orange | Rouge | Source |
|---|---|---|---|---|
| Vent moyen et rafales | ≤ 15 km/h | 15 à 19 km/h | > 19 km/h (au-delà de 3 Beaufort, l'arrêté du 4 mai 2017 interdit de traiter) | moyenne et maximum horaires |
| Température | 8 à 25 °C | 25 à 28 °C, ou 5 à 8 °C | > 28 °C ou < 5 °C | maximum et minimum sur la période |
| Hygrométrie | ≥ 60 % | 40 à 60 % | < 40 % | moyenne |
| Pluie pendant l'intervention | 0 mm | ≤ 0,5 mm | > 0,5 mm | cumul horaire |

  - les seuils sont à valider (Q1) ;
  - sans donnée pour un critère, le feu est gris (« non renseigné »), jamais
    vert par défaut ;
  - la règle réglementaire (vent) se distingue des bonnes pratiques
    (température, hygrométrie) dans la formulation.
- **Cas d'essai** : vent de 11,2 km/h (rafales 11,4) vert, 24,9 °C vert,
  hygrométrie de 56,5 % orange, pas de pluie vert. Feu global orange,
  « Hygrométrie un peu basse (56 %) ».

### FR-IV-3 : parcelles et part travaillée
Une colonne par information :
- parcelle ;
- activité et certifications (badges actuels) ;
- **hectares travaillés** pendant l'intervention ;
- **surface de la parcelle** ;
- **part travaillée**, en % (travaillé / surface), avec une barre de
  progression fine dans la cellule.

Règles :
- **Surface travaillée** : la zone travaillée de la cible (`workingZone`,
  tirée du GPS ou dessinée), sinon la parcelle entière (100 %, marqué
  « parcelle entière ») ;
- **ligne de total** : hectares travaillés au total, surface totale des
  parcelles, part globale ;
- **cas d'essai** (zones enregistrées) : Cazala Maïs 2026 : 0,63 ha sur 1,62 ha (39 %), …,
  6 parcelles, 9,0 ha travaillés sur 25,3 ha (36 %).

### FR-IV-4 : moyens, attelages et parcours GPS dans un même pavé
- **Pavé « Moyens »** :
  - en mode attelages : chaque attelage, avec ses matériels, ses
    intervenants, ses périodes et ses durées (contenu actuel) ;
  - sinon : périodes, matériels et intervenants ;
  - puis les motifs, le stade BBCH et les notes.
- **Parcours GPS rattachés** : sous-partie du même pavé, présente seulement
  s'il y en a, avec le tableau actuel.
- Plus de pavé « Périodes » séparé : les périodes vivent dans les moyens.

### FR-IV-5 : intrants avec feu de dose (pulvérisation)
- Pour une pulvérisation, chaque ligne d'intrant phytosanitaire porte un feu,
  tiré du contrôle enregistré (`compliance.checks`, ligne de l'article) :

| Indicateur `dose` | Feu |
|---|---|
| `ok` | vert, « dose conforme » |
| `warning` | orange |
| `danger` | rouge, dose au-dessus du maximum autorisé |
| usage (cible) non choisi | orange, « À vérifier : cible à préciser » (Q2) |

- **Infobulle ou ligne secondaire** : la dose appliquée face à la dose
  autorisée de l'usage retenu (« 1,5 l/ha, maximum 3 l/ha »).
- **Cas d'essai** : aucun usage n'est choisi (4 usages possibles, de 3 à
  8 l/ha), le feu est donc orange, avec le lien « Préciser la cible » vers la
  modification.
- Hors pulvérisation, pas de feu (fertilisation : la ligne « azote apporté »
  actuelle reste).

### FR-IV-6 : bouton « Revoir en 3D »
- **Emplacement** : en haut à droite, avec les actions de l'intervention ;
  bouton secondaire (pas le style de « Modifier »), icône 3D.
- **Destination** : `/f/:ferme/3d-plan` avec les paramètres :
  - `at` : jour de l'intervention ;
  - `equipment` : le matériel suivi de l'intervention ; avec plusieurs
    attelages, le premier qui a un parcours GPS (Q4) ;
  - `t` : début de l'intervention ;
  - `replay=1` : le rejeu se charge et se place au début.
- **Visibilité** : seulement si un matériel de l'intervention a des positions
  ce jour-là ; sinon le bouton n'apparaît pas.
- **Côté plan 3D** : lire ces paramètres (aujourd'hui absents), choisir le
  matériel, charger le rejeu et placer l'horloge sur `t`.

### FR-IV-7 : feux du contrôle réglementaire et de l'IFT
- **Contrôle réglementaire** :
  - un feu en tête du pavé (niveau global : vert, gris, orange, rouge, selon
    `LEVELS`), à la place du simple badge ;
  - un feu par indicateur (autorisation, bio, dose, nombre d'applications,
    ZNT, DAR, délai de rentrée, applicateur).
- **IFT** : un feu à côté du total. Règle proposée (Q3) :
  - vert : IFT de chaque ligne ≤ 1 (dose au plus égale à la dose de
    référence) ;
  - orange : une ligne entre 1 et 1,2 ;
  - rouge : une ligne au-dessus de 1,2 ;
  - gris : non calculé.
- **Lecture** : chaque feu montre une **couleur, une icône et un mot**
  (« Conforme », « À vérifier »…). La couleur seule ne suffit pas
  (daltonisme, impression en noir et blanc).

### FR-IV-8 : historique replié
- Pavé replié par défaut, titre « Historique (N modifications) ».
- Il s'ouvre au clic ; l'ouverture n'est pas mémorisée.
- Une fois ouvert, il montre les 10 dernières modifications, puis un bouton
  « Afficher tout ».

## 4. Exigences non fonctionnelles

- **Système visuel Lyvre**, pas de nouvelle identité : lichen (conforme),
  paille (à vérifier), brique (non conforme, rare), ardoise (information),
  gris (non renseigné) ; chiffres en `lv-num` (chiffres tabulaires).
- **Un seul composant de feu** (`TrafficLight`, couleur, icône, libellé), le
  même partout : conditions, intrants, contrôle, IFT. Les feux existants du
  formulaire de saisie doivent avoir le même aspect.
- **Hiérarchie** : la seule audace visuelle est le **bandeau de conditions de
  pulvérisation**. C'est la première chose qu'on lit sur une pulvérisation.
  Le reste reste sobre : pavés actuels, sans ombre ni couleur de fond
  supplémentaire.
- **Accessibilité** : les feux ont un nom accessible (« Vent : conforme,
  11 km/h ») ; l'historique se replie au clavier ; le contraste respecte
  l'AA.
- **Données** : aucun appel en plus pour l'essentiel. Météo, zones, contrôle
  et IFT sont déjà dans l'intervention. Le bouton 3D a besoin de savoir s'il
  existe des positions (parcours rattachés : déjà chargés).
- **Tests** : la page existante a des tests (`intervention-sheet.test.tsx`) ;
  il faut tester l'ordre, les feux par seuil et l'historique replié.

## 5. Plan visuel (proposé)

```
┌ Pulvérisation ─────────────────────────────── [Revoir en 3D] [Modifier] [Annuler] ┐
│ Réalisée · Saisie web                                                             │
├────────────────────────────────────────────┬─────────────────────────────────────┤
│ MÉTÉO                                       │ ┌ carte ───────────────────────┐   │
│ ┌ Conditions de pulvérisation  ● À vérifier ┐│ │ zones, ZNT, trace GPS        │   │
│ │ ● Vent 11 km/h   ● Temp. 25 °C            ││ └──────────────────────────────┘   │
│ │ ● Hygro. 56 %    ● Pluie 0 mm             ││ Contrôle réglementaire  ● À noter  │
│ └───────────────────────────────────────────┘│   ● Autorisation ● Dose (cible ?) │
│ Brume · 25 °C · courbe horaire               │ IFT (non calculé)       ● Gris     │
│ PARCELLES                 9,0 ha sur 25,3 ha │ ▸ Historique (50 modifications)    │
│ Cazala    Maïs  0,63 ha / 1,62 ha  ▬▬░░ 39 % │                                    │
│ …                                            │                                    │
│ MOYENS                                       │                                    │
│ Attelage Arion 430 + UF1201 · 16:24–17:46    │                                    │
│ Parcours GPS rattachés (1)                   │                                    │
│ INTRANTS                                     │                                    │
│ ● Barbarian ST   1,5 l/ha   13,5 l           │                                    │
└──────────────────────────────────────────────┴────────────────────────────────────┘
```

- **Alignement** : texte à gauche, chiffres à droite (colonnes numériques).
- **Titres** : en casse de phrase. Les capitales du schéma ne servent qu'à le
  rendre lisible ici.
- **Bandeau des conditions** : fond très légèrement teinté de la couleur du
  feu global et bordure gauche de 3 px. C'est le seul pavé teinté de la page.

## 6. Critères d'acceptation (cas d'essai)

1. Météo en premier à gauche, avec le bandeau des conditions de
   pulvérisation : global orange, hygrométrie orange, les trois autres
   critères verts.
2. Parcelles : 6 lignes avec les hectares travaillés, la surface et la part
   (Cazala Maïs 2026 : 39 %, …), et une ligne de total.
3. Moyens : l'attelage Arion 430 + UF1201, puis « Parcours GPS rattachés
   (1) » dans le même pavé.
4. Intrants : Barbarian ST avec un feu orange « À vérifier : cible à
   préciser ».
5. « Revoir en 3D » ouvre le plan 3D au 05/10, rejeu de l'Arion 430 chargé et
   placé à 16:24.
6. Contrôle réglementaire et IFT ont chacun un feu, avec une icône et un mot.
7. L'historique est replié et affiche son nombre de modifications.

## 7. Décisions du 2026-11-18

- **Q1, seuils** : les valeurs du § FR-IV-2 sont **les valeurs par défaut,
  réglables par ferme**. Le responsable les modifie dans les préférences de
  la ferme (« Ma ferme », onglet Préférences, bloc « Conditions de
  pulvérisation »), avec un bouton pour revenir aux valeurs par défaut. Le
  seuil réglementaire du vent (19 km/h) reste affiché comme tel, même si la
  ferme le resserre.
- **Q2, cible non choisie** : feu **orange**, « À vérifier : cible à
  préciser », avec un lien vers la modification. Le cas d'essai (Barbarian ST)
  est donc orange.
- **Q3, feu IFT** : d'après la **dose de référence** : IFT de chaque ligne
  ≤ 1 vert, entre 1 et 1,2 orange, au-delà de 1,2 rouge, non calculé gris.
- **Q4, plusieurs attelages** : « Revoir en 3D » prend **le premier**
  attelage qui a un parcours GPS.
