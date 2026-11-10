# Étude : vers un vrai jumeau numérique 3D de la ferme

*Brainstorm du 2026-11-10. Document d'exigences, pas de conception : les
choix d'architecture restent à faire (`/sc:design`). Étude satellite détaillée :
[`etude_copernicus.md`](etude_copernicus.md).*

## 1. Point de départ (ce que Fourmy fait déjà)

Plan 3D Cesium 1.146 sans Cesium ion (`apps/web/src/3d/FarmScene.ts`) :
- relief RGE ALTI servi par l'API (`CustomHeightmapTerrainProvider`, 65 × 65, plafonné au niveau 16 puis interpolé) ;
- orthophoto IGN en WMTS ;
- parcelles = polygones **plats** colorés par nature (vigne, grande culture, prairie) ;
- bâtiments = emprises extrudées (hauteur BD TOPO), voisins BD TOPO en contexte ;
- cuves = cylindres dont le liquide suit la frise ;
- avatars glTF des matériels ;
- rejeu GPS sur l'horloge Cesium, flotte à la dernière position.

**Ce qui manque pour parler de « jumeau »** : la végétation n'existe pas (ni
cultures, ni rangs, ni haies, ni arbres), l'état des cultures n'est pas
observé (aucune donnée satellite ni capteur), la météo et la saison ne se
voient pas, et rien n'est simulé ni prévu. Aujourd'hui, Fourmy est une
*maquette* : une représentation fidèle des objets, qui n'est pas encore
**synchronisée avec le réel**.

### Définition retenue (Luke, Hartikainen et al. 2025, d'après Pylianidis 2021)
Un jumeau de culture comprend au minimum trois composants :
- **supervision** (observations : satellite, capteurs, machines) ;
- **interface** (la 3D et la carte) ;
- **analyse** (modèle de culture recalé par les observations).

Le niveau « jumeau » est atteint quand l'état affiché vient des observations
et que l'analyse sait se projeter : prévoir et comparer des scénarios.

## 2. Ce qu'apportent les références

| Référence | Licence | Intérêt réel | À retenir |
|---|---|---|---|
| **harvest-hollow** (jeu de ferme Three.js, 371 tests) | MIT | ★★★ rendu | Cultures instanciées par **clé `culture:stade`**, vent et saisons en shader, sol procédural, LOD, météo lissée |
| **build-world** (vitrine Thrixel) | Apache-2.0 | ★★ méthode | **PRNG à graine** pour tout le procédural ; **QA visuelle** Playwright (imagediff, pixelstats) |
| **farm-twin** (SRUC, élevage laitier) | AGPL-3.0 | ★★ modèle de données | `Device → Sensor → Sample{ts, value, predicted}` et `Attachment{device, thing, start, end}` ; événements ICAR ADE |
| **AgriculturalDigitalTwinPlatform** (Saragosse) | MIT | ★ architecture | Lac landing/trusted/refined, validation pandera des imports, déclencheur sur seuil. Pile trop lourde (Temporal, Benthos, Mongo par jumeau) |
| **farmingpy / TwinYields** (Luke) | MIT (papier CC BY-NC-ND) | ★★★ analyse | Modèle de culture recalé par le **LAI** satellite (ensemble) ; **ISOBUS** prévu/réalisé ; réserve utile par **pédotransfert** |
| **FarmMaps** (WUR + Agrifirm) | propriétaire | ★★★ usage | Chaîne **indice → zonage → carte de doses → ISO-XML/Shapefile** ; WDVI, CI-red-edge ; apps branchées sur un socle commun ; Agrirouter |
| **NDVI_satellite** | aucune (tous droits réservés) | ★★ méthode | S2 L2A, masque SCL, 6 indices, tampon −10 m, stats zonales, grille intra-parcelle. Via GEE, à ne pas reprendre |
| **KAIROS** | aucune | ★ | Seul dépôt sur CDSE (Statistical API). Masque nuages faux, repli **silencieux** sur des NDVI aléatoires, **identifiants CDSE commités** dans `backend/.env.example` |
| **ndvi-vegetation-monitor** | aucune | ✗ | Données entièrement simulées |

Licences : les dépôts MIT et Apache sont compatibles AGPL (garder les notices).
Les trois dépôts NDVI n'ont **aucune licence** : on s'inspire des idées, on ne
copie pas le code. Aucun dépôt n'utilise CesiumJS : tout ce qui vient de
Three.js doit être transposé.

## 3. Méthodes à reprendre, transposées à Cesium

### 3.1 Végétation procédurale (harvest-hollow)
- **Modèle par (culture, stade)** : un glTF d'« amas » par culture et par stade,
  le stade étant déduit de la date de semis, du cycle (référentiel Ekylibre) et
  idéalement du LAI observé. Le changement de stade est calculé à l'avance
  (`nextVisualChangeAt`), sans interroger l'état en boucle.
- **Instanciation massive** : glTF `EXT_mesh_gpu_instancing` dans des **3D Tiles**
  générées côté serveur (py3dtiles, déjà prévu en §8 de l'architecture).
  Les positions suivent les **rangs** :
  - pour la vigne : l'orientation et l'inter-rang, ou la détection sur le LiDAR HD ;
  - pour les grandes cultures : la ligne AB ou la trace du semoir.
- **Casser l'effet tampon** : un quart de tour et une échelle de ±5 % tirés
  d'un hash de l'identifiant, donc **déterministes**.
- **Vent, saison, pluie** : `CustomShader` Cesium sur les tilesets.
  - `vertexMain` : balancement pondéré par un attribut `_SWAY` (hauteur²) et
    une phase qui dépend de la position monde, pour qu'une vague traverse le champ ;
  - `fragmentMain` : teinte d'automne réservée aux verts, givre sur les faces
    tournées vers le haut, assombrissement quand c'est mouillé ;
  - uniforms `u_time`, `u_season`, `u_wet`, alimentés par la **météo réelle**
    (service OWM existant), jamais par un aléa.
- **LOD** : trois bandes avec hystérésis de 10 %. En Cesium :
  `maximumScreenSpaceError`, la hiérarchie des 3D Tiles et
  `distanceDisplayCondition`. Profil mobile : pas d'ombres, DPR plafonné
  (NFR-PERF-2).

### 3.2 Sol et parcelles
- Aujourd'hui, les parcelles sont des aplats. Pistes :
  - **drapage d'un raster d'état** : NDVI, vraies couleurs du dernier passage
    propre, zonage. C'est un `ImageryLayer` borné à l'emprise de la ferme,
    dont les pixels hors parcelle sont transparents ;
  - **matériau Fabric** sur les `GroundPrimitive` : bruit et couleur
    d'indice. Un shader de sol complet comme celui de harvest-hollow
    (domain warp, flaques) supposerait Giro3D, déjà le repli de l'ADR-8.
- **LiDAR HD IGN**, la source la plus forte pour la vraisemblance :
  - le MNH 50 cm donne les haies, les arbres isolés et les rangs de vigne, en
    géométrie réelle ;
  - le nuage de points classé peut être servi en 3D Tiles (py3dtiles) ;
  - c'est aussi le prérequis de FR-VIZ-3 (« LiDAR HD ») et de FR-VIZ-4
    (pente, ombrage, courbes de niveau).

### 3.3 Ciel et lumière
- Pas de jour/nuit stylisé : l'horloge Cesium donne déjà le soleil réel.
  Ajouter :
  - `scene.shadowMap` ;
  - `scene.fog` et `skyAtmosphere` modulés par la météo observée ;
  - un `PostProcessStage` de pluie, dérivé de la frise.

### 3.4 Supervision : capteurs et machines
- **Capteurs** : `Device → Sensor{grandeur, unité} → Sample{ts, valeur, predicted}`
  et `Attachment{capteur, objet, début, fin}` (farm-twin), dans l'hypertable
  `measurements` déjà prévue, exposée en OGC SensorThings. Le drapeau
  `predicted` affiche mesure et prévision sur une même courbe.
- **ISOBUS** (farmingpy, FarmMaps) :
  - import des TimeLogs réalisés (`TASKDATA.XML` + `TLGxxxxx.bin`/`.xml`),
    pour remplir les interventions et les doses réelles géolocalisées ;
  - export de cartes de tâches ISO-XML ou Shapefile.
  - farmingpy dépend de .NET : un parseur natif reste à trouver ou à écrire.

### 3.5 Analyse : modèle de culture (Luke)
- **WOFOST/PCSE**, en pur Python, avec une variante limitée par l'azote : plus
  simple qu'APSIM (C# et .NET) pour le service `agro`.
- **Assimilation** : un ensemble de simulations (sol, azote initial incertains),
  dont on garde les membres compatibles avec le **LAI** Sentinel-2.
- Le LAI vient soit du processeur biophysique SNAP (poids publics), soit de
  Theia L2B BIOPHY.
- **Réserve utile** par pédotransfert (Rosetta en pur Python, EUPTFv2 en R)
  depuis les analyses de sol saisies.
- **Scénarios** : les interventions *planifiées* dans Fourmy deviennent les
  entrées de la simulation (date de semis, dose N), ce qui permet de comparer
  des « et si ».
- Retour vers la 3D : le stade, le LAI et le stress simulés pilotent la
  hauteur, la densité et la teinte de la végétation.

### 3.6 Qualité (build-world)
- Un PRNG à graine (xoshiro128**) pour tout le procédural.
- Des captures Playwright de vues Cesium **figées** (date, heure, caméra),
  comparées pixel à pixel en CI, plus des statistiques d'exposition.

## 4. À éviter
- La météo ou le jour/nuit pseudo-aléatoires (un jumeau reflète le réel).
- Le repli silencieux sur des valeurs fictives : toute donnée affichée porte
  sa **source**, sa **date d'acquisition** et sa **part de nuages** (KAIROS,
  ndvi-vegetation-monitor).
- Le lissage d'affichage qui altère les valeurs (bicubique, focal_mean) :
  séparer la mesure de son rendu.
- Les indices composites à poids arbitraires (« CVI ») et les modèles ML
  entraînés sur données synthétiques.
- Google Earth Engine (usage commercial payant, authentification interactive),
  le SaaS Thrixel, la pile IAAA (Temporal, Benthos, Mongo).
- Les astuces propres à Three.js (BatchedMesh, LightBallast), sauf bascule
  vers Giro3D.

## 5. Bibliothèques et sources de données repérées

| Domaine | Candidats |
|---|---|
| 3D Tiles, glTF | py3dtiles, glTF-Transform (Node), trimesh (Python), extension `EXT_mesh_gpu_instancing`, `CustomShader` Cesium |
| Raster et satellite | rasterio, rioxarray, xarray, odc-stac, pystac-client, sentinelhub-py, openeo, exactextract, TiTiler |
| Séries temporelles | Savitzky-Golay (scipy), lissage de Whittaker |
| Modèles agronomiques | PCSE/WOFOST, APSIM NG (via farmingpy), pyfao56 (ETo, irrigation), Rosetta (`rosetta-soil`), EUPTFv2 |
| Machines | ISO 11783-10 (ISOXML), Agrirouter |
| Données FR | IGN : LiDAR HD (MNT, MNS, MNH, nuage), BD ORTHO **IRC** 20 cm, BD TOPO, RGE ALTI ; RPG (assolement des voisins) ; GEODES/Theia : S2 L2A MAJA, L3A, L2B BIOPHY |
| Données UE | Copernicus : S2 L2A, S1 GRD, CLMS HR-VPP (phénologie 10 m), Copernicus DEM |
| Standards | OGC SensorThings, ICAR ADE (élevage), STAC, 3D Tiles 1.1 |

## 6. Exigences proposées (à valider)

Priorités MoSCoW, numérotation provisoire à la suite de FR-VIZ.

### Fonctionnelles
- **FR-TWIN-1 (M)** Chaque parcelle affiche son **état observé** à la date de la
  frise : indice de végétation (NDVI par défaut, puis NDRE et NDMI), avec la
  date d'acquisition et la part de nuages. Si aucune donnée n'est exploitable,
  l'affichage le dit : jamais de valeur inventée.
- **FR-TWIN-2 (M)** Série temporelle de l'indice par parcelle (courbe brute et
  lissée), et comparaison avec la médiane des années précédentes (anomalie).
- **FR-TWIN-3 (S)** Rendu de la végétation en 3D : cultures et vigne
  instanciées selon la culture et le stade, rangs orientés, haies et arbres
  issus du LiDAR HD.
- **FR-TWIN-4 (S)** La saison, la pluie et le vent observés se voient sur la
  scène, à la date de la frise.
- **FR-TWIN-5 (S)** Couches satellite drapées sur le relief et sur la carte 2D :
  vraies couleurs du dernier passage propre, carte d'indice intra-parcellaire.
- **FR-TWIN-6 (S)** Zonage intra-parcellaire, puis **carte de modulation**
  exportable en ISO-XML et en Shapefile (paramètres machine : largeur, doses
  minimale et maximale).
- **FR-TWIN-7 (C)** Import des TimeLogs ISOBUS pour renseigner les
  interventions réalisées et les doses réelles.
- **FR-TWIN-8 (C)** Modèle de culture recalé par le LAI satellite : prévision
  de rendement, stress hydrique et azoté, scénarios « et si » sur les
  interventions planifiées.
- **FR-TWIN-9 (C)** Capteurs de terrain (sondes, stations) rattachés à une
  parcelle ou à un objet sur une période, leurs mesures étant visibles en 2D
  et en 3D.

### Non fonctionnelles
- **NFR-TWIN-1** Traçabilité : chaque valeur affichée porte sa source, sa date
  et sa qualité. Mesure et prévision sont distinguées.
- **NFR-TWIN-2** Aucun secret de fournisseur (jeton, identifiant d'instance)
  n'atteint le navigateur. Les quotas sont maîtrisés côté serveur.
- **NFR-TWIN-3** Performance :
  - la scène 3D d'une ferme de 300 ha avec végétation reste fluide sur un
    portable courant (objectif à chiffrer, par exemple 30 i/s) ;
  - le mobile reste en MapLibre (NFR-PERF-2).
- **NFR-TWIN-4** Le rendu procédural est déterministe et testé par captures
  en CI.
- **NFR-TWIN-5** Souveraineté : sources ouvertes et européennes d'abord. Le
  fournisseur satellite est remplaçable.

### Récits utilisateurs
- **US-T1 Viticulteur** : « Sur le plan 3D au 15 juin, je vois mes rangs de
  vigne et, en survolant une parcelle, son NDVI du dernier passage propre
  comparé à l'an dernier. »
  - Critère : la date d'acquisition et la part de nuages sont affichées.
  - Critère : la parcelle est grisée s'il n'y a pas de donnée exploitable.
- **US-T2 Céréalier** : « Je vois les zones faibles d'une parcelle de blé et
  j'exporte une carte de doses d'azote pour ma console ISOBUS. »
  - Critère : le fichier ISO-XML s'importe sur la console (à tester sur une
    marque).
- **US-T3 Exploitant** : « Quand je fais défiler la frise sur l'année, les
  cultures poussent, jaunissent puis disparaissent à la récolte, selon mes
  interventions. »
- **US-T4 Conseiller** : « Je reçois une alerte quand le NDVI d'une parcelle
  décroche de plus de X par rapport à sa médiane pluriannuelle. »

## 7. Décisions (2026-11-10)
- **Supervision d'abord** : le premier lot est FR-TWIN-1, FR-TWIN-2 et
  FR-TWIN-5 (données Copernicus par parcelle). Le rendu de la végétation
  (FR-TWIN-3 et 4) vient ensuite, piloté par ces données.
- **Un compte CDSE par exploitant**, saisi dans les Intégrations de sa ferme
  (voir l'étude Copernicus).
- **Test sur la ferme de Pierre** (`phaurigot`) : 11 parcelles en 2026, 37 ha,
  maïs et triticale, en Pyrénées-Atlantiques (UTM 30N).

## 8. Questions ouvertes
1. ~~Priorité supervision ou rendu~~ : tranché, la supervision d'abord.
2. **Filières cibles** : la vigne domine les fermes pilotes. À 10 m, Sentinel-2
   mélange les rangs, l'enherbement et le sol. Faut-il prévoir dès le départ
   l'ortho IRC IGN, le drone ou le LiDAR pour l'échelle du rang ?
3. **Modèle SaaS ou auto-hébergé** : un compte CDSE par exploitant, ou un
   compte Fourmy commun ? Voir les quotas et les CGU dans l'étude Copernicus.
4. **Moteur 3D** : la végétation instanciée et les shaders de vent restent
   faisables en Cesium (3D Tiles et CustomShader). Un shader de sol riche
   relancerait la question de Giro3D. Faut-il garder Cesium seul ?
5. **ISOBUS** : quelles consoles ou marques chez les pilotes ? Ont-elles des
   fichiers TASKDATA réels pour tester ?
6. **Modèle de culture** : ambition à court terme (stade phénologique simple
   par degrés-jours) ou WOFOST complet avec assimilation ?
7. **Capteurs** : y a-t-il des sondes ou stations chez les pilotes, et sous
   quel protocole (LoRaWAN, API constructeur) ?

**Étape suivante** : `/sc:design` sur le lot retenu (proposition : FR-TWIN-1,
FR-TWIN-2 et FR-TWIN-5 avec Copernicus), puis `/sc:workflow`.
