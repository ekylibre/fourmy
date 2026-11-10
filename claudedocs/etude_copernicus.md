# Étude : récupérer les données Copernicus (CDSE) pour une ferme

*2026-11-10.*

**Légende** :
- **[V]** vérifié dans la documentation officielle CDSE le 2026-11-10 ;
- **[M]** connu et cohérent avec la documentation, mais non relu ;
- **[S]** estimation à confirmer, de préférence avec le compte de
  l'utilisateur.

Contexte jumeau 3D : [`etude_jumeau_3d.md`](etude_jumeau_3d.md).

## 1. Conclusion

**Oui, c'est faisable et gratuit à l'échelle d'une ferme.** La contrainte réelle
n'est pas le calcul (Processing Units, PU), mais le **nombre de requêtes**
(10 000 par mois) et les **CGU pour un usage SaaS**.

Architecture la plus simple :
1. **Statistical API** pour les séries d'indices par parcelle, stockées dans
   PostGIS.
2. **Process API** pour une image par ferme et par passage propre, stockée en
   COG.
3. **TiTiler** derrière l'API Fourmy pour servir ces COG à Cesium et MapLibre.

On n'appelle jamais le WMTS Sentinel Hub depuis le navigateur.

## 2. Les APIs

### Authentification
- **Jeton [V]** : OAuth2 `client_credentials` sur Keycloak
  `https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token`.
- **Client OAuth [V]** : à créer sur https://shapps.dataspace.copernicus.eu/dashboard,
  rubrique *User settings → OAuth clients*. Ne pas cocher « SPA » : il est
  réservé au navigateur. Le secret n'est affiché qu'une fois.
- **Réutilisation du jeton [V]** : le garder jusqu'à `exp`, car l'endpoint de
  jeton est limité (429). Le même client sert pour openEO (mode
  « expérimental » ; pour un projet, demander un *service account*).

### Tableau des APIs

| API | Endpoint | Usage pour Fourmy |
|---|---|---|
| **Statistical API** | `https://sh.dataspace.copernicus.eu/api/v1/statistics` (nouveau chemin `/statistics/v1` [V]) | ★★★ Stats zonales par parcelle et par intervalle (mean, stDev, percentiles, sampleCount, noDataCount) |
| **Process API** | `…/api/v1/process` (→ `/process/v1`) | ★★★ Image calculée par evalscript sur l'emprise de la ferme : GeoTIFF FLOAT32 ou PNG |
| **Catalog** | `…/api/v1/catalog/1.0.0/search` (→ `/catalog/v1`) | ★★ Dates disponibles et nuages sur l'emprise |
| **OGC WMS/WMTS** | `https://sh.dataspace.copernicus.eu/ogc/wmts/<INSTANCE_ID>` | ★ Affichage direct, mais **l'identifiant d'instance tient lieu d'authentification [V]** et chaque tuile compte une requête |
| **STAC** | `https://stac.dataspace.copernicus.eu/v1/` (l'ancien est déprécié depuis le 2025-11-17 [V]) | ★★ Recherche ; assets S2 en JP2, pas en COG [S] |
| **S3 eodata** | `https://eodata.dataspace.copernicus.eu`, clés sur `eodata-s3keysmanager.dataspace.copernicus.eu` [V] | ★ Lecture brute, sans quota de PU (12 To par 30 j) |
| **openEO** | `https://openeo.dataspace.copernicus.eu` | ★★ Batch : composites, Sentinel-1 prétraité, UDF, phénologie |
| **Batch / Batch Statistical** | `/batch/v2`, `/statistics/batch/v1` | ✗ Au moins 100 PU par requête : surdimensionné |
| OData, OpenSearch, On-Demand | — | ✗ Produits SAFE entiers (~1 Go) ; OpenSearch en fin de vie ; commandes OData supprimées le 2026-05-27 [V] |

Le Browser (`S2_L2A_CDAS`) n'est qu'une interface au-dessus de la collection
Sentinel Hub `sentinel-2-l2a`. `demSource3D=MAPZEN` ne concerne que son propre
relief d'affichage : ce n'est pas une donnée à intégrer.

## 3. Quotas du compte gratuit [V]

Source : https://documentation.dataspace.copernicus.eu/Quotas.html

- **Sentinel Hub** :
  - 10 000 requêtes et 10 000 PU par mois ;
  - 300 requêtes et 300 PU par minute.
- **openEO** :
  - 10 000 crédits par mois (« hausse temporaire ») ;
  - 2 traitements simultanés ;
  - environ 6 à 7 crédits par requête synchrone.
- **S3** : 4 connexions, 20 Mo/s, 12 To par 30 jours.

**Calcul des PU [V]** :
- 1 PU = 512 × 512 px × 3 bandes × 1 date ;
- `dataMask` n'est pas compté ;
- une sortie FLOAT32 compte double ;
- minimum de 0,01 PU par requête Statistical, 0,005 PU par requête Process ;
- seules les réponses 2xx sont décomptées.

### Ordres de grandeur pour une ferme

**Mesuré le 2026-11-10 (ferme de Pierre)** : le minimum de 0,01 PU s'applique
**à chaque date** (chaque intervalle agrégé), et non à chaque requête :

| Paramètre | Valeur |
|---|---|
| Coût par date | 0,01 PU × 2 (6 bandes : B04, B05, B08, B8A, B11, SCL) × 2 (sortie FLOAT32) = **0,04 PU** |
| Coût par parcelle sur 13 mois (128 dates) | **5,12 PU** (en-tête `x-processingunits-spent`) |
| Historique complet des 11 parcelles | **56 PU, en 11 requêtes et 22 s** |

| Usage | Requêtes | PU par an |
|---|---|---|
| Ferme de Pierre, 11 parcelles, NDVI, NDRE et NDMI, mise à jour hebdomadaire | ~50 par mois | ~55 (mesuré) |
| 200 parcelles, NDVI seul (3 bandes, FLOAT32), ~120 dates par an | ~870 par mois | ~480 [calculé] |
| 200 parcelles, 3 indices | ~870 par mois | ~960 [calculé] ; une sortie UINT16 mise à l'échelle diviserait par deux |
| Image NDVI 10 m de 300 ha à chaque passage | 70 à 140 par an | 50 à 100 [S] |
| **WMTS direct dans Cesium** | **des centaines par session** | faible, mais **le quota de requêtes saute** |

→ Même à 200 parcelles, on reste sous 10 % du quota de PU, et une ferme
seule n'en consomme qu'environ 0,05 %. La première estimation sous-évaluait
les PU d'un facteur 5 à 10, mais le quota reste très large. Le facteur
limitant demeure le **nombre de requêtes** : une requête par parcelle, le
mode multi-géométries n'existant qu'en Batch, à au moins 100 PU.

## 4. Licence et CGU
- **Données Sentinel [M]** : libres, y compris en **usage commercial** et en
  redistribution, avec la mention « Contains modified Copernicus Sentinel data
  [année] » (règlement délégué UE 1159/2013).
- **Portail et quotas gratuits [V]** :
  - « usage non commercial » ;
  - interdiction de contourner les quotas avec plusieurs comptes ;
  - pour des volumes commerciaux, la FAQ renvoie aux fournisseurs de
    l'écosystème (Sentinel Hub commercial / Planet, CREODIAS).
- **Conséquence [S]** :
  - en auto-hébergement AGPL, chaque exploitant saisit **son propre client
    CDSE** dans Fourmy (page Intégrations) ;
  - un SaaS Fourmy sur un compte commun suppose de **demander confirmation au
    help center CDSE**, ou de basculer sur STAC + COG (sans quota de PU) ou
    sur une offre commerciale.

## 5. Données utiles

| Donnée | Intérêt ferme |
|---|---|
| **Sentinel-2 L2A** | Bandes 10 m : B02, B03, B04, B08. Bandes 20 m : B05 à B07 (red-edge), B8A, B11, B12 (SWIR). Revisite 2 à 5 j en France. **SCL** : exclure 0, 1, 3, 8, 9, 10 et 11 |
| **Sentinel-1 GRD** (VV/VH, 10 m) | Voit à travers les nuages : croissance (RVI ≈ 4·VH/(VV+VH)), détection de labour et de récolte. Coût ×2 à ×2,5 en PU pour orthorectification et RTC [V] |
| **CLMS HR-VPP** | Phénologie 10 m (début et fin de saison, pic). Accès CDSE à vérifier [S] |
| **Copernicus DEM** | Inutile : le RGE ALTI et le LiDAR HD de l'IGN sont meilleurs |
| **S2 global mosaics** | Fond trimestriel sans nuages |
| Sentinel-3 et 5P | Trop grossiers, hors sujet |

**Indices (evalscript V3)** :
- NDVI = (B08−B04)/(B08+B04) ;
- **NDRE** = (B8A−B05)/(B8A+B05), pour l'azote et les couverts denses ;
- **NDMI** = (B08−B11)/(B08+B11), pour l'eau de la végétation ;
- NDWI = (B03−B08)/(B03+B08), pour l'eau libre ;
- EVI ;
- **SAVI** (L = 0,5), utile pour la vigne enherbée ;
- WDVI et CI-red-edge (FarmMaps) ;
- **LAI, fAPAR, FCOVER** : processeur biophysique SNAP (evalscripts publics
  `sentinel-hub/custom-scripts` [M]) ou Theia **L2B BIOPHY** (GEODES [V]).

Attention : depuis la baseline 04.00, les réflectances ont un offset de −1000.
Sentinel Hub le corrige ; en lecture STAC ou S3 brute, il faut l'appliquer [M].

## 6. Exemples

### Statistiques NDVI par parcelle (Statistical API)
La géométrie vient de PostGIS : `ST_Transform(ST_Buffer(geom::geography, -10)::geometry, 32631)`,
la zone UTM dépendant de la région. En UTM, `resx` est en mètres ; en WGS84, il
serait en degrés.

```json
{
  "input": {
    "bounds": { "geometry": { "type": "Polygon", "coordinates": [[[500100,4800100],[500400,4800100],[500400,4800350],[500100,4800350],[500100,4800100]]] },
                "properties": { "crs": "http://www.opengis.net/def/crs/EPSG/0/32631" } },
    "data": [{ "type": "sentinel-2-l2a", "dataFilter": { "maxCloudCoverage": 80 } }]
  },
  "aggregation": {
    "timeRange": { "from": "2026-03-01T00:00:00Z", "to": "2026-10-31T23:59:59Z" },
    "aggregationInterval": { "of": "P5D" },
    "resx": 10, "resy": 10,
    "evalscript": "//VERSION=3\nfunction setup(){return{input:[{bands:['B04','B08','SCL','dataMask']}],output:[{id:'ndvi',bands:1,sampleType:'FLOAT32'},{id:'dataMask',bands:1}]}}\nfunction evaluatePixel(s){const ok=s.dataMask===1&&![0,1,3,8,9,10,11].includes(s.SCL);return{ndvi:[(s.B08-s.B04)/(s.B08+s.B04)],dataMask:[ok?1:0]}}"
  },
  "calculations": { "default": { "statistics": { "default": { "percentiles": { "k": [10, 50, 90] } } } } }
}
```

- **Attention, vérifié sur la ferme de Pierre** : `sampleCount` compte les
  pixels du **rectangle englobant**, pas ceux du polygone. La part valide
  s'écrit donc `(sampleCount − noDataCount) / (surface de la parcelle / 100 m²)`.
  Rapportée à `sampleCount`, elle plafonne entre 0,4 et 0,8 même par ciel
  clair et fait rejeter à tort toutes les dates des parcelles non
  rectangulaires. Seuil retenu : au moins 80 % des pixels de la parcelle
  valides.
- **Piège vu dans KAIROS** : il comptait les nuages sans les exclure du
  `dataMask`, ce qui polluait la moyenne.

### openEO (séries ou composites en batch)
```python
import openeo
c = openeo.connect("openeo.dataspace.copernicus.eu").authenticate_oidc_client_credentials(client_id=CID, client_secret=SECRET)
s2 = c.load_collection("SENTINEL2_L2A", spatial_extent=bbox, temporal_extent=["2026-03-01", "2026-10-31"], bands=["B04", "B08", "SCL"])
ndvi = s2.ndvi(red="B04", nir="B08").mask(~((s2.band("SCL") == 4) | (s2.band("SCL") == 5)))
ndvi.aggregate_spatial(geometries=parcelles_geojson, reducer="mean").execute_batch("ndvi.csv", out_format="CSV")
```

### Sans quota : STAC + COG (Earth Search, sans compte)
```python
from pystac_client import Client
from odc.stac import load
items = Client.open("https://earth-search.aws.element84.com/v1").search(
    collections=["sentinel-2-c1-l2a"], bbox=bbox, datetime="2026-03/2026-10",
    query={"eo:cloud_cover": {"lt": 60}}).item_collection()
ds = load(items, bands=["red", "nir", "scl"], crs="EPSG:32631", resolution=10, bbox=bbox, chunks={})
```

## 7. Intégration dans Fourmy (options, pas encore une conception)

- **Où** : dans le service `services/agro`, qui est sans état et prévu pour
  les rasters (ADR-1). Il reçoit les parcelles, rend des statistiques ou des
  COG, et l'API TypeScript stocke et sert.
- **Bibliothèques** : `sentinelhub-py`, qui gère le jeton et les réessais 429
  (`SHConfig.sh_base_url="https://sh.dataspace.copernicus.eu"`, `sh_token_url` =
  Keycloak) ; `openeo` ; `pystac-client` et `odc-stac` ; `rasterio` et
  `rioxarray` ; `exactextract` ; **TiTiler** (FastAPI).
- **Affichage** :
  - Cesium : `UrlTemplateImageryProvider` sur une route de l'API Fourmy, avec
    `rectangle` = emprise de la ferme ;
  - MapLibre : source `raster` ;
  - une date passée est immuable, donc le cache est permanent.
- **Stockage** : une table en ajout seul
  `(parcelle, date d'acquisition, indice, mean, p10, p50, p90, valid_ratio, source, baseline)`.
- **Fournisseur abstrait** : Sentinel Hub CDSE d'abord, puis STAC + COG
  (Earth Search, CDSE S3, GEODES) en secours ou pour le SaaS.
- **Mention légale** : « Contains modified Copernicus Sentinel data » sur les
  couches et les exports.

## 8. Alternatives et compléments

| Source | Pour | Contre |
|---|---|---|
| **AWS Earth Search** (`sentinel-2-c1-l2a`) | COG publics sans compte ni quota ; offset déjà harmonisé | Pas de calcul côté serveur ; pas de S1 en COG [S] |
| **GEODES (CNES, ex-Theia)** | S2 L2A **MAJA** (meilleur masque nuages en France), **L3A** mensuel sans nuages, **L2B BIOPHY** (LAI) | Latence et production 2026 à vérifier [S] |
| **IGN BD ORTHO IRC** 20 cm (WMTS Géoplateforme) | Infrarouge à l'échelle du rang ; déjà compatible Cesium | Une prise de vue tous les ~3 ans |
| **IGN LiDAR HD** | Haies, arbres, rangs, drainage | Statique |
| Planetary Computer | S2, S1 RTC, Landsat | Pérennité incertaine |
| Google Earth Engine | Puissant | Payant en usage commercial : écarté |

## 9. Risques
- **Nuages** : en ordre de grandeur, 30 à 50 % des passages seulement sont
  exploitables, moins en hiver [S]. Parades :
  - SCL et `valid_ratio` ;
  - lissage de Whittaker ou Savitzky-Golay ;
  - Sentinel-1 en complément ;
  - L3A.
- **10 m contre les rangs de vigne** : pixels mixtes ; les petites parcelles
  n'ont plus que quelques pixels après le tampon de −10 m. Lire des tendances
  relatives (intra-parcelle, inter-annuelle) et compter sur l'IRC IGN ou le
  drone pour le rang.
- **Décalage géométrique** de 5 à 10 m [S], d'où le tampon négatif.
- **Retraitements** (Collection 1, baselines) : stocker la source et la
  baseline.
- **Plateforme mouvante** [V] :
  - nouveaux chemins Sentinel Hub depuis le 2026-03-17 ;
  - STAC déplacé en 11/2025 ;
  - commandes OData supprimées le 2026-05-27 ;
  - facturation openEO revue en 03/2026.

  → URLs en configuration, tests de fumée hebdomadaires, veille sur
  https://dataspace.copernicus.eu/news.
- **Sécurité** : le secret OAuth et l'identifiant d'instance restent côté
  serveur et chiffrés en base, comme les autres clés d'intégration. À noter
  au passage : le mémo « clés OWM en clair » montre que ce point reste à
  traiter.

## 10. Décisions (2026-11-10)
- **Un compte CDSE par exploitant**, saisi dans les Intégrations de la ferme
  et chiffré comme les autres intégrations. Fourmy ne mutualise pas de quota.
- **Test sur la ferme de Pierre** (`phaurigot`) plutôt que sur la ferme pilote
  viticole :
  - 11 parcelles valides en 2026, soit 37,4 ha (de 0,16 à 12,5 ha) ;
  - maïs et triticale, des grandes parcelles bien adaptées aux pixels de 10 m ;
  - Pyrénées-Atlantiques (lon −0,19°, lat 43,38°), donc **UTM 30N (EPSG:32630)**
    et non 31N ;
  - après le retrait de 10 m en bordure, Cazala Triticale ne garde que
    0,03 ha (environ 3 pixels) et Sedzère Jardin 0,12 ha : ce sont les cas
    limites à observer.

## 11. Résultats du test (2026-11-10)

**Le script fonctionne** : jeton OAuth, Statistical API, 11 requêtes, 56 PU,
22 s.

**Disponibilité des images** :
- 128 passages en 13 mois, soit un tous les 3 jours, grâce au recouvrement des
  orbites ;
- **60 % des couples parcelle × date sont exploitables** (846 sur 1 408) ;
- en pratique, une image propre tous les 5 jours environ ;
- creux : décembre et janvier (2 ou 3 images utiles par mois) et mai (3 sur 9).

**NDVI médian mensuel (dates exploitables)** :

| Parcelle | Pixels | 10 | 11 | 12 | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Monassut Maïs (12,5 ha) | 1 110 | .20 | .22 | .21 | .24 | .21 | .17 | .15 | .26 | .73 | .67 | .31 | .20 | .20 |
| Lespourcy Maïs (semé le 16/04) | 652 | .19 | .23 | .23 | .27 | .29 | .22 | .19 | .26 | .73 | .79 | .49 | .27 | .21 |
| Castagnet Maïs | 328 | .23 | .22 | .22 | .22 | .21 | .17 | .15 | .30 | .58 | .42 | .21 | .19 | .20 |
| Sarthou Maïs | 162 | .22 | .27 | .26 | .29 | .29 | .28 | .20 | .39 | .85 | .75 | .33 | .21 | .22 |
| Sedzère Aougas Triticale | 38 | .56 | .67 | .76 | .81 | .88 | .90 | .90 | .85 | .66 | .58 | .59 | .47 | .72 |
| Cazala Triticale (0,16 ha) | **3** | .70 | .59 | .67 | .69 | .73 | .76 | .82 | .81 | .72 | .64 | .55 | .53 | .62 |

**Croisement avec les interventions saisies** :
- **Semis du maïs, cohérents** : déclarés du 7 au 16 avril, le NDVI décolle
  fin mai. Monassut monte de 0,21 le 21/05 à 0,79 le 26/06. Lespourcy, semé
  le dernier, reste vert le plus longtemps.
- **Triticale, cohérent** : semé le 30/10/2025, pic de 0,90 en mars-avril,
  baisse à partir de juin.
- **Récolte 2026 du maïs absente des saisies** : le NDVI rejoint le sol nu
  (0,19) le 29/08 et y reste. Aucune récolte 2026 n'est saisie, alors que
  celles de 2025 le sont (4 et 16/09/2025), et un hersage est saisi le 05/10.
  - Le NDVI seul ne distingue pas un maïs grain desséché sur pied d'un champ
    récolté : NDMI, SWIR ou Sentinel-1 permettraient de trancher.
  - C'est quand même **le premier cas d'usage concret** : signaler une
    intervention probablement manquante.
- **Maïs** : pic fin juin, puis déclin dès mi-juillet, plus tôt qu'attendu
  pour un maïs grain en Béarn. Ensilage, ou stress hydrique de l'été 2026 ?
  **À demander à Pierre.**
- **Hétérogénéité intra-parcellaire** au pic : l'écart p90 − p10 vaut 0,24
  sur Monassut, contre 0,13 sur Monassut Chisné. Monassut est la candidate
  naturelle pour un zonage.

**Limites constatées** :
- Cazala Triticale ne garde que **3 pixels** après le retrait de 10 m, et
  Sedzère Jardin 12. Leurs valeurs restent hautes en été (au-dessus de 0,5),
  ce qui signe une contamination par les bords (haies, prairie).
- **Règle proposée** : en dessous d'environ 30 pixels valides, afficher
  « parcelle trop petite pour Sentinel-2 » plutôt qu'une valeur.

**Fichiers** (scratchpad de session, non versionnés) : script
`spike_stats.py`, parcelles `parcelles_pierre_utm30.geojson` et résultats
`ndvi_pierre.csv`.

## 12. Protocole du test (spike d'une demi-journée)
1. Créer un client OAuth (sans SPA) et obtenir un jeton.
2. Lancer la requête Statistical sur les 11 parcelles de Pierre (NDVI, NDRE,
   NDMI ; intervalle P1D, donc une ligne par acquisition), d'octobre 2025 à
   aujourd'hui pour couvrir le triticale d'hiver et le maïs.
3. Relever, dans le tableau de bord, les PU et les requêtes réellement
   consommés.
4. Comparer avec Earth Search (même parcelle, même date) pour valider le
   masque et l'offset.
5. Demander au help center CDSE ce qui est permis pour un SaaS multi-clients.

## 13. Questions ouvertes
1. ~~Compte par exploitant ou commun~~ : tranché, un compte par exploitant.
2. Quels indices en premier : NDVI seul, ou NDVI, NDRE et NDMI dès le départ ?
3. Quelle profondeur d'historique importer à l'activation (1 an, 3 ans pour
   les anomalies, depuis 2017) ?
4. Fréquence de mise à jour : à chaque passage (détection par le Catalog) ou
   hebdomadaire ?
5. Sentinel-1 dès le MVP, ou plus tard ?

## Sources
- https://documentation.dataspace.copernicus.eu/Quotas.html
- https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/ProcessingUnit.html
- https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html
- https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Statistical.html
- https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/OGC/WMTS.html
- https://documentation.dataspace.copernicus.eu/APIs/STAC.html
- https://documentation.dataspace.copernicus.eu/APIs/S3.html
- https://documentation.dataspace.copernicus.eu/APIs/openEO/openEO.html
- https://documentation.dataspace.copernicus.eu/APIs/openEO/credit_usage.html
- https://dataspace.copernicus.eu/node/10 (CGU)
- https://dataspace.copernicus.eu/node/3090 (nouveaux chemins Sentinel Hub)
