# Conception : rejeu 3D, outil relevé, bande travaillée, arbres et pylônes

*Conception du 2026-11-18, d'après `besoins_rejeu_3d_outils_paysage.md`
(décisions Q1, Q2, Q4, Q6 ; défauts retenus pour Q3, Q5 et Q7). Aucun code
n'est écrit à ce stade.*

## 1. Vue d'ensemble

```
                     API                                         Navigateur (FarmScene)
 positions ──► GET /tracks ─────────── samples + largeur + état ──► avatar tracteur
 (attrs working, widthM)      (+ sessions travail/transport)          outil articulé (nodeTransformations)
                                                                      bande travaillée (glTF + CustomShader)
 interventions ─► GET /tracks/hitches ─ outil, gabarit, procédé ─────┘
 equipment-3d ──► GLB de l'outil, en nœuds articulés ────────────────┘

 IGN Géoplateforme                       cache IGN de l'API (tuiles z14)
  WFS BD TOPO : haie, zone_de_vegetation, ─► couche « landscape » ─► GET /landscape3d ─► arbres instanciés
                ligne_electrique, pylone                                               pylônes + lignes
  WMS-R LiDAR HD MNH (GeoTIFF float32)  ──► couche « canopy » (lot R5) ──────────────► hauteurs, arbres isolés
```

Vérifié le 18/11 sur la zone de la séquence de test :
- le WFS BD TOPO sert les **haies** (lignes), les **zones de végétation** (avec
  leur nature), **2 lignes électriques** (225 et 400 kV, coordonnées 3D) et
  **15 pylônes**, qui ont une **`hauteur`** (51,1 m par exemple) ;
- le **MNH du LiDAR HD** se lit en GeoTIFF float32 par le WMS-R
  (`IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G`) ; sur une
  parcelle de test, les hauteurs vont de 0 à 15,3 m.

## 2. Lots

| Lot | Contenu | Dépend de |
|---|---|---|
| R0 | Données de la séquence de test (UF1201, intervention) | — |
| R1 | Outil articulé : posé, relevé, replié | R0 |
| R2 | Bande travaillée : largeur, recouvrements, couleur par travail | R0 |
| R3 | Arbres et haies de la BD TOPO | — |
| R4 | Pylônes et lignes électriques | R3 (même couche) |
| R5 | MNH du LiDAR HD : hauteurs réelles, arbres isolés | R3 |

R1, R2 et R3 peuvent avancer en parallèle. R1 et R2 suffisent pour la vidéo de
la page d'accueil.

## 3. R0 : données de la séquence de test

- **Créer le matériel « Amazone UF 1201 »** dans la ferme de Pierre :
  - genre `sprayer`, gabarit `mounted_sprayer`, largeur de travail 18 m ;
  - `external_ids.traccarTool` = « Arion UF1201 » : les parcours le résolvent
    alors (`tool_equipment_id`) au prochain calcul du worker.
- **Corriger l'intervention** rattachée au parcours du 05/10 (16:24 à 17:46) :
  - remplacer le broyage avec le Maschio Tigre 300 par une pulvérisation
    (procédé de forme `treatment`) avec l'UF1201 ;
  - ou détacher le parcours si le broyage a bien eu lieu à un autre moment.
- D'abord sur la base locale. Sur la production, seulement avec l'accord de
  Pierre (question en §10).

## 4. Contrats d'API

### 4.1 `GET /tracks` (`trackReplay`)

Ajouts **rétrocompatibles** :
- `samples` : un **5ᵉ élément facultatif**, `widthM: number | null`. C'est la
  largeur active à l'instant (`attrs.widthM` de la dernière position, comme
  `working`).
- `sessions` : `[{ kind: "work" | "transit", from, to }]`, d'après
  `track_sessions` sur la fenêtre. Ils servent à distinguer le **bout de champ**
  (pas au travail, mais pendant un parcours de travail) du **transport**.

La **simplification de la trace** (tolérance en mètres) doit garder les
échantillons où `working` ou `widthM` changent. C'est à vérifier dans
`repos/tracks.ts` et à ajouter s'il le faut. Sinon, la bande commence ou
s'arrête au mauvais endroit.

### 4.2 `GET /tracks/hitches` (`hitch`)

Ajouts à chaque attelage :
- `template` (gabarit `equipment-3d`, `mounted_sprayer` par exemple) ;
- `workingWidthM` (fiche, nom ou gabarit) ;
- `shape` : la forme du procédé de l'intervention (`work`, `treatment`,
  `fertilization`, `sowing`, `harvest`, `maintenance`), ou `null` pour un
  outil annoncé par le boîtier sans intervention ;
- `articulation` : les nœuds animables du GLB (§5.1), pour ne pas déduire le
  gabarit côté web.

### 4.3 `GET /landscape3d?west&south&east&north` (nouveau, R3 à R5)

```ts
{
  trees: [{ lon, lat, heightM, crownM, kind: "deciduous" | "conifer" | "hedge" | "orchard", source: "bdtopo" | "lidar" }],
  pylons: [{ id, lon, lat, heightM, voltageKv: number | null }],
  lines: [{ id, voltageKv: number | null, coords: [lon, lat][] }],
  attribution: string[],             // « IGN – BD TOPO », « IGN – LiDAR HD »
  truncated: boolean                 // plafond d'instances atteint
}
```

- Les instances d'arbres sont **calculées par l'API** (§7.2) : le navigateur
  ne reçoit que des points.
- Emprise limitée à 5 km × 5 km ; au-delà, réponse 400.
- Lecture ouverte à tout membre (comme `/plan3d`). Erreurs au format
  `problem+json` : 502 si l'IGN est indisponible et rien n'est en cache.

## 5. R1 : outil articulé

### 5.1 GLB en nœuds (`packages/equipment-3d`)

Aujourd'hui, `buildAvatarGlb` produit **un seul nœud** (`avatar`). Les parties
dessinées par `shape()` sont réparties dans des **groupes**, et chaque groupe
devient un nœud enfant, avec son pivot :

| Nœud | Contenu | Pivot |
|---|---|---|
| `frame` | timon, châssis, roues, cuve d'un traîné : ne bouge pas | — |
| `lift` | organes de travail (dents, disques, rouleau, corps, rampe d'un porté) | rotule de l'attelage trois points (x = 0, z ≈ 0,6 m) |
| `boom_left`, `boom_right` | demi-rampes d'un pulvérisateur | articulation centrale de la rampe, de chaque côté |

- `Mesh` gagne une notion de groupe courant (`m.group("lift")`). Les fonctions
  de `tools.ts` l'appellent avant de dessiner les organes mobiles.
- Un gabarit sans groupe reste en un nœud `frame` : comportement actuel.
- **Empreinte du cache** des GLB : il faut y ajouter une version du
  générateur, sinon les anciens GLB d'un seul nœud resteraient servis.

| Gabarit | Bout de champ (relevé) | Transport (replié) |
|---|---|---|
| porté : `mounted_tool`, `sower`, `rotary_harrow`, `plough`, `roller`, `fertilizer_spreader` | `lift` monte de 0,5 m et bascule de 8° | idem |
| `mounted_sprayer` (UF1201) | `lift` monte de 0,3 m, rampe dépliée | `lift` à 0,5 m ; `boom_left` et `boom_right` repliés le long de l'outil (rotation de 90° autour de z, puis relevés) |
| `trailed_tool`, `disc_harrow` | `lift` monte de 0,3 m, roues au sol | idem |
| `trailed_sprayer` | rampe relevée de 0,3 m | rampe repliée le long de la cuve |
| `trailer`, `box` | aucun mouvement | aucun mouvement |

### 5.2 Animation (`FarmScene.setTrack`)

- **État de chaque échantillon** :
  - `work` si `working` est vrai ;
  - `headland` s'il n'est pas au travail mais dans un parcours `work` ;
  - `transport` sinon, ou si `working` est nul hors parcours.
- **Profil précalculé** : pour chaque nœud, `pose(t)` entre 0 (posé) et 1
  (relevé), et `fold(t)` entre 0 (déplié) et 1 (replié). Chaque passage d'un
  état à l'autre dure 1,5 s au rythme de la vraie trace, avec un lissage
  smoothstep.
- **Application** : par `ModelGraphics.nodeTransformations`, dans un
  `CallbackProperty` qui lit l'horloge Cesium. Aucune géométrie n'est recréée.
- Les modèles d'outil restent en `CLAMP_TO_GROUND` : seul le nœud `lift` monte.
- **Vitesse de lecture** : à ×60, 1,5 s de trace durent 25 ms à l'écran, donc
  le mouvement paraît instantané. La durée affichée a un plancher de 0,4 s,
  convertie en temps de trace selon `clock.multiplier`, pour que le relevage
  reste visible dans la vidéo.

## 6. R2 : bande travaillée

### 6.1 Géométrie

- **Calcul côté navigateur** (`apps/web/src/3d/swath.ts`, fonctions pures) :
  - pour chaque suite d'échantillons `work`, on calcule le centre de l'outil
    (reculé de `hitchOffsetM`, comme le modèle) puis ses bords gauche et
    droit, à ±largeur/2 perpendiculairement au cap ;
  - cela donne une **bande continue** (triangle strip) par suite de travail,
    coupée à chaque changement d'état ou de largeur ;
  - les points sont redécoupés tous les 5 m au plus, pour suivre le relief.
- **Relief** : `sampleTerrain` au niveau 15 **aux deux bords**, pas au centre.
  Sur 18 m de large, la pente en travers compte. La bande est posée à +0,15 m.
- **Largeur** (Q3), par ordre de priorité :
  1. `widthM` de l'échantillon ;
  2. `workingWidthM` de l'attelage ;
  3. `defaultWidthM` des réglages de parcours ;
  4. 3 m.
- **Plafond** : 200 000 sommets. Au-delà, les points sont espacés de 10 m.

### 6.2 Rendu

- **glTF généré dans le navigateur**, sur le modèle de `instancedBoxGlb`
  (`vegetation-glb.ts`), avec trois attributs par sommet :
  - `POSITION` ;
  - `_TIME` : les secondes depuis le début de la trace ;
  - `COLOR_0` : la couleur du type de travail.
- **Apparition au fil du rejeu** : un `CustomShader` Cesium (`translucencyMode`
  translucide) reçoit l'uniforme `u_now`, mis à jour à chaque image depuis
  l'horloge, et écarte (`discard`) les fragments dont `_TIME > u_now`. La
  géométrie est construite une seule fois.
- **Recouvrements** (Q4) : chaque bande a une opacité de 0,35, et le mélange
  translucide fonce les zones passées deux fois. Une même bande ne se
  recouvre pas, parce que ses joints sont partagés.
  - **À vérifier** : la transparence indépendante de l'ordre de Cesium (OIT)
    rend bien deux passages plus foncés qu'un, sous Chromium et Firefox.
  - **Repli** : une carte de comptage (grille de 1 m, nombre de passages par
    cellule) calculée une fois, qui donne la couleur de chaque sommet.
- **Couleur par travail** (Q4), d'après `shape` de l'attelage, sinon d'après
  le gabarit (un pulvérisateur sans intervention compte comme `treatment`).
  Palette à valider sur l'orthophoto :

| `shape` | Couleur | Exemple |
|---|---|---|
| `treatment` | `#7B2CBF` violet | pulvérisation |
| `fertilization` | `#2A9D8F` vert d'eau | épandage |
| `sowing` | `#E9C46A` blé | semis |
| `work` | `#E85D04` orange (couleur actuelle du travail) | travail du sol, broyage |
| `harvest` | `#B5651D` paille foncée | récolte |
| `maintenance` | `#6C757D` gris | entretien |

- La trace orange actuelle reste affichée par-dessus, en 2 px.
- La bande a son interrupteur dans la rubrique « Matériels suivis ».

## 7. R3 et R4 : paysage de la BD TOPO

### 7.1 Couche `landscape` du cache IGN

Sur le modèle de `buildings` (`apps/api/src/ign/store.ts`,
`packages/geo-ign`) :
- **Requêtes** : `packages/geo-ign/src/landscape.ts` interroge le WFS pour
  `haie`, `zone_de_vegetation`, `ligne_electrique` et `pylone`, page par page
  (500 objets par page, 20 pages au plus), avec les mêmes erreurs
  (`IgnHttpError`).
- **Cache** : tuiles Web Mercator **z14**, une tuile = le JSON réduit des
  quatre types. On garde la géométrie, `nature`, `hauteur`, `voltage` et
  `cleabs`.
- **Préchargement** : la couche `landscape` s'ajoute à `IGN_LAYER_ZOOMS`
  (`zone: [14, 14]`) et à l'estimation de taille (`IGN_TILE_BYTES`, environ
  30 ko). Elle est donc préchargée avec « Ma ferme ».
- **Durée de vie** : celle des bâtiments.

### 7.2 Arbres instanciés (`landscape3d`, API)

**Sources et règles par nature :**

| Source BD TOPO | Placement | Hauteur (R3) | Type |
|---|---|---|---|
| `haie` (ligne) | un arbre tous les 4 m le long de la ligne, décalé de ±0,5 m au hasard | 6 m ± 30 % | `hedge` |
| `zone_de_vegetation` « Haie » | idem, le long du contour | 6 m | `hedge` |
| « Bois », « Forêt fermée de feuillus », « Forêt ouverte » | grille de 7 m décalée à l'intérieur (plafonnée) ; seule une bordure de 30 m est dense, le centre est éclairci | 15 m ± 25 % | `deciduous` |
| « Forêt fermée de conifères », « … mixte » | idem | 18 m | `conifer` (ou moitié-moitié si mixte) |
| « Peupleraie » | grille de 7 m alignée | 22 m | `deciduous` |
| « Verger » | grille de 5 m | 4 m | `orchard` |
| « Lande ligneuse » | grille de 5 m, une cellule sur trois | 2 m | `hedge` |
| « Vigne » | rien : les rangs de vigne existent déjà | — | — |

**Règles communes :**
- **Hasard reproductible** : graine = `cleabs` + index, pour que deux appels
  donnent les mêmes arbres.
- **Exclusions** :
  - aucun arbre dans une **parcelle cultivée** de la ferme à la date du jour
    (versions valides), ni sur l'emprise d'un bâtiment ;
  - les arbres de haie qui tombent dans une parcelle sont reportés sur son
    bord, ou retirés.
- **Plafond** : 60 000 arbres par réponse (`truncated: true` s'il est atteint).
  Les bois loin de la ferme sont éclaircis en premier.

### 7.3 Rendu des arbres (navigateur)

- **Un glTF instancié par type** (`EXT_mesh_gpu_instancing`, même principe que
  les rangs), avec un modèle unitaire en peu de polygones :
  - feuillu : tronc (prisme hexagonal) et houppier (icosaèdre aplati) ;
  - conifère : tronc et cône ;
  - haie : houppier bas et large.
- Chaque instance a sa translation, posée sur le relief (`sampleTerrain`
  niveau 15, par lots), son lacet au hasard et son échelle (hauteur, couronne).
- **Saison** : de novembre à mars, les feuillus et les haies ont un houppier
  clairsemé et brun-gris (`Model.color`) ; les conifères ne changent pas. La
  date est celle de la frise ou du rejeu.
- **Distance d'affichage** : on cache les arbres au-delà de 3 km de la caméra
  (`distanceDisplayCondition` au niveau du modèle).
- **Interrupteur** « Arbres et haies » dans la barre des couches.

### 7.4 Pylônes et lignes (R4)

- **Pylône** :
  - glTF généré : treillis simplifié (4 montants, entretoises, 2 ou 3 consoles
    selon la tension), à l'échelle de `hauteur`, sinon 30 m (63 à 90 kV),
    45 m (225 kV) ou 55 m (400 kV) ;
  - orienté selon la bissectrice des deux portées voisines de la ligne la
    plus proche.
- **Lignes** :
  - les coordonnées 3D de l'IGN sont en **altitudes NGF**. Le relief de
    Fourmy l'est probablement aussi, puisque `geo-ign` n'applique aucune
    correction du géoïde, mais ce n'est pas vérifié : on ne s'en sert donc pas
    directement ; chaque sommet
    est recalé en **hauteur relative** (sol + hauteur du pylône le plus proche
    à moins de 30 m, sinon sol + hauteur par tension) ;
  - les conducteurs sont dessinés entre deux sommets avec une **flèche** en
    parabole (3 % de la portée) ;
  - trois conducteurs par terne, écartés de la largeur des consoles, dans une
    `PolylineCollection`. Pas de lignes drapées.
- **Une ligne sans pylône dans l'emprise** (cas de la séquence) est quand
  même dessinée (Q5), à la hauteur par tension.
- **Interrupteur** « Lignes électriques » dans la barre des couches.

## 8. R5 : MNH du LiDAR HD

- **Couche `canopy`** du cache IGN : tuiles géographiques z15 du MNH
  (GeoTIFF float32 du WMS-R, 65 × 65 échantillons comme le relief), stockées
  comme `elevation`.
- **Hauteur réelle** : `landscape3d` lit le MNH au pied de chaque arbre de la
  BD TOPO. Une hauteur inférieure à 1,5 m supprime l'arbre (arraché ou
  absent) ; sinon elle remplace la hauteur par nature.
- **Arbres isolés** : maxima locaux du MNH supérieurs à 3 m (fenêtre de
  5 × 5 m), hors zones de végétation et hors bâtiments, mais **acceptés dans
  les parcelles**, où un arbre isolé existe vraiment.
  - Le **maïs** sur pied mesure jusqu'à 2,5 à 3 m dans le MNH : le seuil est
    relevé à 4 m dans une parcelle de maïs ou de tournesol.
- **Date du LiDAR** à afficher dans les crédits. La couverture nationale n'est
  pas complète : sans MNH, on reste sur les règles R3 sans erreur.
- Option pour plus tard : orientation des rangs de vigne par le MNH, prévue
  dans `docs/jumeau-3d.md`.

## 9. Tests

| Lot | Domaine et unitaires | Intégration API | Navigateur |
|---|---|---|---|
| R1 | `equipment-3d` : nœuds et pivots par gabarit, GLB d'un nœud inchangé pour `trailer` ; profil `pose` et `fold` (passages, plancher de 0,4 s) | `hitches` renvoie `template`, `shape`, `workingWidthM` | séquence de test : 25 passages, rampe repliée sur la route |
| R2 | `swath.ts` : bords à ±largeur/2, coupures, priorité des largeurs, plafond | `tracks` : `widthM`, `sessions`, simplification qui garde les changements d'état | fin du rejeu : bande sur les 8 parcelles, aucune sur la route ; recouvrements plus foncés |
| R3 | placement par nature, graine reproductible, exclusion des parcelles, plafond | `landscape3d` avec un WFS simulé ; cache et IGN indisponible (502, puis cache) | haies autour des parcelles de la séquence, aucun arbre dans le maïs |
| R4 | hauteur par tension, recalage relatif, flèche | pylônes et lignes du WFS simulé | les 2 lignes RTE de la zone |
| R5 | maxima locaux, seuils maïs | MNH simulé, MNH absent | comparaison avec l'orthophoto |

- **Vérification visuelle** : Chromium et Firefox, avec un relevé des images
  par seconde avant et après, et des captures aux mêmes instants (16:30,
  17:00, 17:40).
- **Fixtures** : réponses WFS réduites de la zone de test (sans nom ni
  coordonnées personnelles), et un MNH de 64 × 64 échantillons.

## 10. Risques et questions

- **Transparence de Cesium (R2)** : si l'OIT ne fonce pas les recouvrements
  comme prévu, on passe à la carte de comptage (§6.2), plus sûre, mais
  recalculée quand la largeur change.
- **Simplification de la trace** : c'est le principal risque pour une bande
  juste aux bouts de champ (§4.1).
- **Volume des bois** : la grille de 7 m dans un grand massif dépasse vite le
  plafond, d'où l'éclaircissement du centre et la distance d'affichage.
- **Production** : faut-il appliquer R0 (matériel UF1201, correction de
  l'intervention) aussi sur fourmy.org, ou seulement en local pour la vidéo ?
- **Palette par travail** : à valider à l'écran sur l'orthophoto d'automne.

## 11. Réalisation du 2026-11-18 (R0 à R5)

Tout est livré sur la branche `feat/rejeu-3d`, vérifié sur la séquence de test
(Arion 430, 05/10/2026). Écarts par rapport à la conception et constats :

- **R0** : l'Amazone UF1201 existait déjà. L'intervention du 05/10 est passée
  en pulvérisation (`spraying`) avec l'UF1201 et du Barbarian ST à 1,5 l/ha,
  par l'API, sur la base locale seulement.
- **R1** :
  - l'outil s'affiche aussi sur les trajets qui encadrent l'intervention
    (`hitchSpan` : trajet qui touche l'attelage à moins de 5 min), sinon la
    rampe repliée ne se voit jamais sur la route ;
  - la rampe repliée est une demi-rampe réduite à 12 % de sa longueur, pas
    un pliage section par section.
- **R2** :
  - la simplification de la trace se fait par tronçon d'état constant
    (travail, largeur), ce qui garde les bascules à leur place (test
    d'intégration) ;
  - la bande est placée dans le **repère est/nord/haut exact de Cesium**.
    L'approximation sphérique de `localFrame` la décalait de plusieurs
    mètres à 2 km de l'origine ; c'était visible sur la séquence, parce que
    le matin l'Arion travaillait un autre champ ;
  - la trace orange passe à 2 px ; les recouvrements foncent bien avec la
    transparence de Cesium (vérifié sous Chromium), le repli par carte de
    comptage n'a pas servi.
- **R3, R4** :
  - **débit de l'IGN** : quatre tuiles en parallèle provoquaient des 429. Les
    tuiles sont donc lues une par une, avec deux reprises après un 429, et
    une tuile en échec n'empêche pas les autres (`missingTiles`) ;
  - **emprise** : `bbox` (zone du rejeu, plus 400 m), sinon les abords de la
    ferme. Sur toute la ferme de Pierre, les haies seules dépassaient le
    plafond de 60 000 arbres ; le plafond garde maintenant les plus proches
    du centre ;
  - **arbres en tableau compact** (`[lon, lat, h, couronne, type]`) :
    737 ko au lieu de 2,2 Mo pour 23 500 arbres ;
  - **grille des bois** bornée à l'emprise, avec un hasard propre à chaque
    cellule : les mêmes arbres quelle que soit l'emprise, et un calcul qui
    passe de 16 s à 0,9 s ;
  - **rendu** : un modèle par type d'arbre et par carré de 400 m, masqué
    au-delà de 3 km. Sur la séquence, 49,8 images/s avec le paysage contre
    50,6 sans (13 avant le découpage).
- **R5** :
  - le MNH est lu en BIL float32 par tuile Web Mercator de zoom 14
    (768 × 768, soit environ 2,2 m), couche `canopy` du cache IGN. Elle
    n'est pas préchargée par défaut (2,4 Mo par tuile) mais se coche dans
    « Ma ferme » ;
  - `canopy=0` retire le LiDAR ;
  - sur la zone de la séquence, 5 tuiles, 2 617 arbres de la BD TOPO
    retirés (plus bas que 1,5 m) et 1 742 arbres isolés ajoutés ; hauteur
    médiane de 16,4 m au lieu de 11,8 m.
- **Migration 0059** : couches `landscape` et `canopy` du cache IGN ;
  `landscape` s'ajoute aux couches préchargées par défaut.
- **Développement** : la scène est exposée en `globalThis.fourmyScene` (mode
  développement seulement), pour les vérifications visuelles et les
  captures de la vidéo.

**Reste ouvert**
- Appliquer R0 sur fourmy.org (avec l'accord de Pierre).
- Le premier chargement du paysage est lent : environ 40 s pour une
  vingtaine de tuiles WFS, et autant pour le LiDAR. Il est immédiat ensuite
  (cache disque). Le préchargement « Ma ferme » couvre `landscape`.

### Retours du 2026-11-18 (après essai)

- **Rampes repliées** : chaque demi-rampe a maintenant trois tronçons, des
  nœuds chaînés `boom_left`, `boom_left_2` et `boom_left_3` (version 3 du
  générateur). Sur la route, elles se replient en accordéon le long de la
  cuve : le premier tronçon vers l'avant, le deuxième vers l'arrière, le
  troisième vers l'avant, chacun décalé de 18 cm vers l'extérieur. Cela vaut
  pour le pulvérisateur porté et le pulvérisateur traîné. La pose des nœuds
  est commune au rejeu et à la fiche (`apps/web/src/3d/tool-nodes.ts`).
- **Fiche du matériel, onglet 3D** : pour un outil généré articulé, un
  sélecteur « Travail / Route » (« Route (rampe repliée) » pour un
  pulvérisateur). Le cadrage suit le mode.
- **Préchargement IGN** : une tuile de paysage à la fois et deux tuiles
  LiDAR à la fois ; après un 429, le délai demandé par l'IGN est respecté.
  Huit en parallèle faisaient échouer le paysage.
- **Paysage** : le plan 3D demande toujours les abords de la ferme (et plus
  la zone du rejeu), et le résultat est gardé en mémoire selon les parcelles
  en place, pas selon la date. Charger un rejeu recalculait tout, ce qui
  figeait l'API et la vue plusieurs secondes.
