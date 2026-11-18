# Jumeau 3D : végétation et météo du plan 3D

Lot AA, réalisé le 2026-11-10 : FR-TWIN-3 (végétation) et FR-TWIN-4 (météo
visible) ([`requirements.md`](requirements.md) §4.9 bis). Étude d'origine :
`claudedocs/etude_jumeau_3d.md` ; données d'entrée : la télédétection
([`teledetection.md`](teledetection.md)).

**Décisions du 2026-11-10** :
- rangs instanciés (et non un couvert extrudé ou des plantes une à une) ;
- orientation des rangs automatique, corrigeable dans la fiche parcelle ;
- météo en version simple dès ce lot.

## Ce que voit l'utilisateur

- **Mise en page du plan 3D** (retours du 2026-11-12) :
  - la vue occupe toute la hauteur ;
  - la **barre de rejeu** reste posée en bas de la vue : matériel, lecture,
    vitesse, heure, caméra, barre de temps pour se placer à un instant,
    outils attelés avec leurs horaires, trajets recalés sur la route
    ([`routage-osrm.md`](routage-osrm.md)) ;
  - les couches et réglages sont une **barre d'icônes** verticale en haut à
    droite de la vue : végétation et météo, image satellite, matériels
    suivis, cuverie, bâtiments (responsable, s'il en manque la hauteur).
    Chaque icône ouvre sa rubrique dans une petite fenêtre à côté, une seule
    à la fois, fermée par un clic ailleurs ou Échap. Un point vert signale
    une couche active ;
  - bouton **plein écran** (Échap pour sortir).
- **Plan 3D, encadré « Jumeau : végétation et météo »** :
  - *Rangs de végétation (état observé)* : chaque parcelle porte ses rangs
    en 3D, posés sur le relief IGN et inclinés avec la pente. Leur hauteur,
    leur largeur et leur couleur suivent la date de la frise.
  - Décompte des parcelles par phase (« 7 en végétation · 2 en maturation… »).
  - *Météo du jour* : ciel et lumière, brume, pluie ou neige animées, sol
    mouillé (orthophoto assombrie), végétation givrée par gelée. Libellé
    « Pluie, 6,9 mm, 19 à 25 °C · sol mouillé ».
- **Fiche parcelle, onglet Général, encadré « Rangs (plan 3D) »** :
  - orientation et inter-rang, avec leur origine (automatique ou saisie) ;
  - le responsable de la ferme peut les modifier ou revenir à l'automatique.

## Rejeu des matériels et paysage (lots R0 à R5, 2026-11-18)

Conception : `claudedocs/conception_rejeu_3d_outils_paysage.md`.

- **Outil articulé** : l'avatar généré d'un outil a des nœuds `lift` et, pour
  un pulvérisateur, `boom_left` et `boom_right` (`packages/equipment-3d`,
  version 2 du générateur). Au rejeu, l'outil est posé au travail, relevé en
  bout de champ (pas au travail, pendant un parcours de travail) et replié en
  transport. Les rampes de pulvérisateur ont trois tronçons par côté,
  repliés en accordéon le long de la cuve. Le relevage est animé et dure au
  moins 0,4 s à l'écran (`replay.ts`, `tool-nodes.ts`). La fiche du matériel
  (onglet 3D) montre les deux positions : « Travail » et « Route ».
- **Bande travaillée** : derrière l'outil, de la largeur du boîtier (sinon de
  la fiche de l'outil, sinon 3 m), colorée par forme de procédé
  (pulvérisation violette, semis blé, fertilisation vert d'eau, travail du
  sol orange…). Elle apparaît au fil du rejeu (CustomShader) ; un double
  passage ressort plus foncé. Interrupteur dans « Matériels suivis ».
- **Paysage** (`GET /landscape3d?at=…&bbox=…`) :
  - **arbres** : haies, bois, forêts, vergers et peupleraies de la BD TOPO,
    avec une hauteur par nature puis la hauteur réelle du LiDAR HD, plus les
    arbres isolés repérés dans le LiDAR ; aucun dans les parcelles cultivées
    ni dans les bâtiments ; feuillus dégarnis de novembre à mars ;
  - **pylônes et câbles** : pylônes en treillis à leur hauteur IGN, orientés
    selon la ligne ; câbles avec leur flèche ;
  - **interrupteurs** dans « Végétation et météo ».

## Règles

**Phases du couvert** (`canopyAt`, domaine), d'après la courbe NDVI lissée des
240 derniers jours (mesures exploitables) et les interventions réalisées qui
retirent le couvert :

| Phase | Condition | Rendu |
|---|---|---|
| en végétation | NDVI au plus haut du cycle | hauteur = hauteur adulte × croissance^1,5 ; croissance = (NDVI − 0,25) / 0,5 ; couleur de la palette NDVI |
| en maturation | NDVI qui redescend après un pic ≥ 0,5 | hauteur atteinte gardée (maïs qui sèche sur pied), feuillage clairsemé, couleur vers la paille |
| récolté | récolte, broyage, fauche ou labour saisi après le pic, **ou** NDVI < 0,25 après le pic | chaumes de 12 cm, paille |
| sol nu | croissance < 5 % | rien |
| en repos | vigne sans feuilles (NDVI < 0,33, ou l'hiver sans mesure) | ceps et cordon en bois |
| pas de mesure récente | dernière mesure à plus de 20 jours | rien (pas de végétation inventée) |

- **Pourquoi la puissance 1,5** : le NDVI sature dès que le sol est couvert.
  Avec une relation linéaire, le maïs de Pierre aurait mesuré 1,2 m fin mai.
  Hauteurs obtenues : environ 0,7 m fin mai, environ 1,9 m fin juin, 2,5 m au
  pic.
- **Pourquoi le seuil de 0,25 pour « récolté »** : en 2025, le maïs sec sur
  pied restait vers 0,27 à 0,30, et le sol nu après récolte est mesuré vers
  0,19 à 0,23.

**Profils par culture** (`cropProfile`) :
- hauteur adulte et inter-rang réel : maïs 2,5 m et 0,75 m ; triticale 1,2 m
  et 0,15 m ; colza, tournesol, betterave, soja, céréales, prairie ;
- vigne : structure de 0,9 m, feuillage jusqu'à 1,8 m, inter-rang 2 m ;
- l'espèce vient de `productions.cultivation`, sinon de `species`. Les
  cépages ont la nature `vine`.

**Rangs**
- **Orientation automatique** : grand axe du rectangle orienté minimal de la
  parcelle (`ST_OrientedEnvelope` en UTM).
- **Inter-rang** : celui de la culture, ou la valeur saisie
  (`parcel_rows`, migration 0031).
- **Inter-rang dessiné** : au moins 1 m hors vigne (des céréales semées à
  15 cm forment un couvert continu).
- **Découpage** (`rowPieces`, domaine) : droites parallèles découpées par le
  contour (trous compris), raccourcies de 1 m aux bouts, tronçonnées à 15 m
  au plus.
- **Plafond** : 30 000 tronçons par parcelle ; au-delà, les rangs dessinés
  sont espacés.

**Météo** (`dayWeather`, API ; `weatherLook`, web)
- **Source** : le temps du jour au centre de la ferme, par le premier
  fournisseur actif, sinon Open-Meteo (observé, ou prévu si le jour est à
  venir).
- **Résumé** :
  - temps dominant de 6 h à 20 h ;
  - pluie du jour et des 48 h ;
  - températures extrêmes et rafale maximale.
- **Ambiance** :
  - « couvert » avec 4 mm ou plus se montre pluvieux ;
  - sol mouillé à partir de 3 mm sur 48 h ;
  - gelée si le minimum est à 0 °C ou moins.
- **Panne** : une panne météo ne bloque pas la végétation (`weather: null`).

## Rendu (Cesium, sans Cesium ion)

- **Modèle par parcelle** :
  - un glTF généré **dans le navigateur** (`instancedBoxGlb`) : un pavé
    unitaire répété par `EXT_mesh_gpu_instancing`, chaque tronçon ayant sa
    translation, son lacet et son tangage, et son échelle ;
  - chargé par `Model.fromGltfAsync` (URL de blob, `upAxis: Z`,
    `forwardAxis: X`) et teinté par `Model.color`.
- **Altitudes** : relief IGN échantillonné aux deux bouts de chaque tronçon
  (`sampleTerrain`, niveau 15).
- **Pluie et neige** : un `PostProcessStage` (GLSL), avec des traits ou des
  flocons animés.
- **Ciel, brume et sol** : ciel et atmosphère par `brightnessShift` et
  `saturationShift`, brume par `scene.fog.density`, sol mouillé par la
  luminosité et le contraste de l'orthophoto.
- **Vérification visuelle** :
  - faite le 2026-11-10 sur la ferme de Pierre avec Chromium et WebGL
    logiciel (SwiftShader), aux 02/07, 10/08, 01/09 et 17/07 (pluie) ;
  - aucune erreur de console, le shader de pluie compile ;
  - environ 20 000 tronçons pour 37 ha.

## API

| Route | Rôle |
|---|---|
| `GET /vegetation3d?at=AAAA-MM-JJ` | `{ at, parcels: [{ parcelId, species, nature, rows, canopy }], weather }` |
| `PUT /land-parcels/:id/rows` | `{ bearingDeg, spacingM }` (responsable) ; l'orientation est ramenée à [0 ; 180[ |
| `DELETE /land-parcels/:id/rows` | Retour à l'automatique (responsable) |

## Tests

- `packages/domain/test/vegetation3d.test.ts` :
  - rangs : rectangle, trou, tronçonnage, orientation, plafond ;
  - repère local ;
  - phases sur la saison du maïs de Pierre, et vigne.
- `apps/api/test/vegetation3d.integration.test.ts` :
  - phases ;
  - rangs automatiques sur le grand axe, puis saisis (refusés à un ouvrier)
    et remis à l'automatique ;
  - météo résumée (Open-Meteo simulé) ou absente.
- `apps/web/test/jumeau3d.test.tsx` :
  - glTF généré (en-tête, accessoires, quaternions, pente) ;
  - apparence par phase ;
  - ambiance météo ;
  - réglage des rangs dans la fiche.

## Limites et suite

- **Rangs de vigne** : orientation estimée sur le grand axe, souvent juste
  mais pas toujours. Prochaine étape : les détecter dans le MNH du LiDAR HD
  de l'IGN.
- **Rendu des plantes** : des rangs pleins (pavés). Pas encore de
  balancement au vent ni de plantes individuelles, qui demanderaient des
  3D Tiles côté serveur.
- **Cultures sans espèce connue** (fermes pilotes sans `cultivation`) :
  profil par défaut, hauteur adulte de 1 m.
- **Éclairage** : la lumière ne suit pas l'heure ; l'horloge Cesium sert au
  rejeu des traces.
