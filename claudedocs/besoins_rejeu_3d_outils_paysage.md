# Besoins : rejeu 3D, outil relevé, bande travaillée, arbres et pylônes

*Brainstorm du 2026-11-18. Document de besoins seulement : la conception
viendra ensuite (`/sc:design`). Les questions ouvertes sont en fin de document.*

## 1. Demande

Améliorer le plan 3D (rejeu d'une trace, `apps/web/src/3d/FarmScene.ts`) :
1. relever l'outil attelé derrière le tracteur quand il n'est pas « au travail » ;
2. colorer, derrière l'outil et sur toute sa largeur, la bande travaillée quand
   il est au travail ;
3. ajouter en 3D les arbres et les pylônes électriques, depuis l'IGN ou Lexicon.

Séquence de test : **Claas Arion 430, ferme de Pierre (`phaurigot`), 05/10/2026,
de 16 h 26 à 17 h 44**.

## 2. Ce qui existe aujourd'hui

- **Trace** : échantillons `[heure, lon, lat, working]`. `working` vient de
  l'attribut `working` des positions (boîtier). Le rejeu dessine la trace en
  orange (travail, 4 px) ou en gris (transport, 2 px), au fil de l'horloge.
- **Outils attelés** (`hitches`) : l'intervention saisie prime ; sinon, l'outil
  annoncé par le boîtier (`tool`, relié par `external_ids.traccarTool`). Le
  modèle 3D est généré (`packages/equipment-3d`), placé à `hitchOffsetM`
  derrière le tracteur selon le cap, **toujours posé au sol**
  (`CLAMP_TO_GROUND`), sans changement selon l'état de travail.
- **Largeur d'outil** : connue de trois façons, qui ne s'accordent pas toujours :
  - attribut `widthM` des positions (boîtier, ou agrirouter depuis AR5) ;
  - `workingWidthM` du modèle 3D (fiche technique, nom, ou gabarit par type) ;
  - `defaultWidthM` des réglages de parcours (calcul de surface couverte).
  La surface couverte d'un parcours (`track_sessions.coverage`) est déjà
  calculée en bandes de largeur d'outil, mais pas affichée en 3D.
- **Paysage** : relief et orthophoto IGN, bâtiments extrudés, végétation des
  parcelles (rangs). Aucun arbre ni pylône.

## 3. Ce que montre la séquence de test

| Élément | Valeur |
|---|---|
| Parcours | travail de 16:24:43 à 17:46:04, précédé d'un transport de 3 min |
| Positions | 997 positions, une toutes les 5 s environ, dont 553 « au travail » |
| Changements d'état | 25 (passages travail ↔ relevé, aux bouts de champ surtout) |
| Boîtier | `tool` = « Arion UF1201 », `widthM` = 18 m, avec `appliedHa` et `fieldHa` (compteurs d'une console de pulvérisation) |
| Intervention rattachée | **broyage de résidus** (`crop_residues_grinding`), outil **Maschio Tigre 300** (broyeur, 3 m) |
| Parcelles | 8 parcelles de maïs 2026 (Braquet, Castagnet, Cazala, Ecole, Lespourcy, Monassut, Monassut Chisné, Sarthou) |
| Surface couverte calculée | 9,3 ha (bandes de 18 m) |

**Incohérence à trancher (Q1)** : le boîtier décrit un pulvérisateur de 18 m,
l'intervention un broyeur de 3 m. Le rejeu affiche aujourd'hui le broyeur
(l'intervention prime), tandis que la surface couverte est calculée sur 18 m.

**Paysage autour du champ** (Lexicon, BD TOPO de l'IGN, emprise de la trace
élargie de 200 m) : 105 haies linéaires, 34 surfaces de haie, 23 bois,
9 forêts. **Aucun pylône** dans cette emprise (11 sur toute la zone de la
ferme), et **aucune ligne électrique** dans Lexicon.

## 4. Sources possibles pour les arbres et les pylônes

| Source | Contenu | Hauteur | Accès |
|---|---|---|---|
| Lexicon `hydrography` (BD TOPO, 15/09/2026) | haies (lignes), zones de végétation (haie, bois, forêt, verger, peupleraie…), pylônes (points) | non | base Lexicon, pas encore synchronisée dans Fourmy ; non servie par l'API Lexicon publique |
| IGN Géoplateforme, BD TOPO en WFS | mêmes objets, plus les **lignes électriques** (avec la tension) | pylônes : à vérifier ; végétation : non | même service que le relief et l'orthophoto (`IGN_GEOPLATEFORME_URL`) |
| IGN LiDAR HD, modèle numérique de hauteur (MNH) | hauteur réelle du couvert au mètre près ; permet d'y trouver les **arbres isolés** | oui | raster de la Géoplateforme, couverture nationale en cours (à vérifier sur Pierre) |

Aucune source vectorielle ne recense les **arbres isolés**. Seul le MNH du LiDAR
HD permet de les repérer et de leur donner une hauteur. Le jumeau 3D le prévoit
déjà pour les rangs de vigne (`docs/jumeau-3d.md`, « Limites et suite »).

## 5. Exigences fonctionnelles (proposées)

### FR-3D-TOOL-1 : outil relevé hors travail
- Quand l'échantillon courant n'est pas « au travail », l'outil attelé est
  dessiné **relevé** ; au travail, il est posé au sol.
- Le passage entre les deux positions est **animé** (environ 1 à 2 s), sans saut.
- L'état sans information (`working` = null) compte comme relevé.
- Le relevage dépend du type d'outil (Q2) :
  - outil porté : soulevé d'environ 0,4 à 0,6 m et basculé vers l'avant ;
  - outil traîné : reste sur ses roues, avec ses organes relevés ;
  - pulvérisateur : rampe repliée ou relevée.

### FR-3D-TOOL-2 : bande travaillée colorée
- Au travail, une bande de la **largeur de travail** est déposée au sol
  **derrière l'outil**, au fil du rejeu (comme la trace orange actuelle).
- Elle épouse le relief, reste au-dessus de l'orthophoto et sous les rangs de
  végétation, et sa couleur est semi-transparente.
- La bande s'interrompt quand l'outil est relevé (bouts de champ, transport).
- Les passages qui se recouvrent peuvent ressortir plus foncés, ce qui montre
  le double passage (Q4).
- La largeur vient d'une source unique et documentée (Q3).

### FR-3D-LAND-1 : arbres et haies en 3D
- Les haies, bois et arbres proches de la ferme sont dessinés en volume : des
  arbres instanciés, comme les rangs, pas un modèle par arbre. Ils sont posés
  sur le relief.
- La hauteur vient du MNH du LiDAR HD si on le retient, sinon d'une hauteur
  par nature (haie 4 m, bois 15 m…).
- Un interrupteur dans la barre des couches les affiche ou les masque.

### FR-3D-LAND-2 : pylônes et lignes électriques
- Les pylônes sont dessinés en 3D, à leur hauteur réelle si l'IGN la fournit,
  sinon à une hauteur par tension.
- Les lignes électriques sont tendues entre les pylônes (Q5).
- Ils partagent l'interrupteur des arbres ou ont le leur (Q6).

## 6. Exigences non fonctionnelles
- **Fluidité** : le rejeu reste fluide sur la séquence de test (82 min, ×60) ;
  la bande travaillée ne doit pas recréer de géométrie à chaque image.
- **Compatibilité** : aucun service Cesium ion ; pas de lignes drapées
  `clampToGround`, que Firefox fait planter avec certaines cartes graphiques
  (`FarmScene.ts`).
- **Données** : le paysage est mis en cache côté API, comme le relief et l'IGN.
  Une panne de la source ne bloque ni le rejeu ni la végétation.
- **Licence** : la BD TOPO et le LiDAR HD de l'IGN sont sous Licence Ouverte,
  à citer dans les crédits de la vue.
- **Vidéo** : le rendu doit tenir en vue « drone » et en vue rapprochée, pour la
  vidéo de la page d'accueil.

## 7. Critères d'acceptation (séquence de test)
1. À 16 h 26, l'outil est relevé pendant le transport. Il se pose au premier
   passage « au travail », puis se relève à chaque bout de champ, ce qui fait
   25 changements visibles.
2. À la fin du rejeu, la bande colorée couvre les passages de la séquence, ses
   bords sont nets, elle ne montre aucune bande sur le trajet routier et sa
   largeur correspond à la largeur retenue.
3. Les haies et bois de la BD TOPO autour des 8 parcelles apparaissent en 3D,
   sans arbre dans les parcelles cultivées.
4. Aucune erreur dans la console, sous Chromium et sous Firefox.
5. La performance, mesurée en images par seconde, reste du même ordre qu'avant
   ces ajouts.

## 8. Décisions du 2026-11-18

- **Q1, outil réel** : le **pulvérisateur UF1201** (le boîtier a raison). Il
  faut corriger l'intervention de broyage rattachée au parcours et rattacher
  l'UF1201 à son équipement, par `external_ids.traccarTool` ou une fiche à
  créer s'il n'existe pas (aucun matériel « UF » dans la ferme). La bande fait
  donc 18 m.
- **Q2, relevage** : **articulé par type**. Outil porté soulevé et basculé,
  rampe de pulvérisateur repliée ou relevée, organes de l'outil traîné relevés.
- **Q4, bande** : les **recouvrements** ressortent plus foncés, et la **couleur
  dépend du type de travail** (pulvérisation, broyage, semis…).
- **Q6, arbres** : d'abord la **BD TOPO** (haies, bois, forêts, avec une hauteur
  par nature), puis le **MNH du LiDAR HD** pour les hauteurs réelles et les
  arbres isolés.

## 9. Questions encore ouvertes (défaut proposé)

- **Q3, largeur** : défaut proposé, dans cet ordre : largeur du boîtier
  (`widthM`, réelle, et section par section si agrirouter la donne), puis la
  fiche de l'outil, puis les réglages de parcours.
- **Q5, lignes électriques** : défaut proposé : les afficher même sans pylône
  dans l'emprise, en les prenant au WFS de l'IGN (absentes de Lexicon).
- **Q7, accès aux données** : défaut proposé : WFS de la Géoplateforme à la
  demande, avec un cache dans l'API (comme le relief), pour les haies, la
  végétation, les pylônes et les lignes. La synchronisation de Lexicon reste
  possible plus tard.
- **Couleurs par type de travail** : la palette est à proposer lors de la
  conception.
