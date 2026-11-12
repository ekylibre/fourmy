# Télédétection des parcelles

Lot Y, réalisé le 2026-11-10 : FR-TWIN-1, FR-TWIN-2 et FR-TWIN-5
([`requirements.md`](requirements.md) §4.9 bis). Conception et écarts :
[`teledetection-design.md`](teledetection-design.md) ; décision : ADR-16.

## Ce que voit l'utilisateur

- **Fiche parcelle, onglet « Végétation »** :
  - NDVI des 12 mois qui précèdent la date de la frise ;
  - mesures exploitables (points) et passages nuageux écartés (en gris) ;
  - bande p10–p90 (hétérogénéité) et courbe lissée (Whittaker, λ = 50) ;
  - **médiane des années précédentes** aux mêmes dates ;
  - interventions de la parcelle en repères verticaux.
- **Carte 2D et plan 3D, encadré « Satellite »** (`?sat=` dans l'URL,
  partagé par les deux vues), quatre choix :
  - *Aucun* ;
  - *NDVI* : image colorée ;
  - *Couleurs* : couleurs naturelles ;
  - *Par parcelle* : chaque parcelle colorée selon son dernier NDVI.
- **Image affichée** : la dernière acquisition exploitable à la date de la
  frise, avec un badge « Sentinel-2 du … (il y a n j) », orange au-delà de
  20 jours. En 3D, elle est drapée sur le relief, au-dessus de l'orthophoto
  IGN.
- **Parcelle sélectionnée sur la carte** : NDVI moyen, p10–p90, date et âge
  de la mesure.
- **Mention légale** « Contient des données Copernicus Sentinel modifiées
  [années] » sous chaque couche et chaque graphique.

## Règles

| Règle | Valeur | Où |
|---|---|---|
| Classes SCL exclues (pas de donnée, saturé, ombre, nuages, cirrus, neige) | 0, 1, 3, 8, 9, 10, 11 | evalscripts `s2-idx-v1` |
| Bords de parcelle non mesurés (pixels mêlés aux voisins) | retrait de 10 m | `ST_Buffer(…, -10)` en UTM |
| Date exploitable pour une parcelle | ≥ 80 % de ses pixels valides | `USABLE_VALID_RATIO` |
| Parcelle trop petite pour Sentinel-2 | < 30 pixels de 10 m après retrait | `MIN_PARCEL_PIXELS` |
| Valeur ancienne | > 20 jours | `STALE_AFTER_DAYS` |
| Acquisition retenue pour les images | ≥ 30 % des parcelles visibles | `SCENE_MIN_VALID_RATIO` |
| Palette NDVI (image, légende, parcelles) | rouge → vert, domaine 0 à 0,9 | `NDVI_PALETTE` |
| Échelle NDRE | palette du NDVI étirée, domaine 0 à 0,8 | `INDEX_SCALES.ndre` |
| Échelle NDMI | brun → bleu-vert, domaine −0,4 à 0,6 | `INDEX_SCALES.ndmi` |

- **Pas de valeur inventée** : une date nuageuse est conservée avec ses
  pixels valides et marquée non exploitable. Un échec de Copernicus n'écrit
  rien.
- **Indices** : NDVI, NDRE et NDMI sont stockés et affichables (choix
  ajouté le 2026-11-11, voir « Choix de l'indice » ci-dessous).
- **Piège de l'API Statistical** : `sampleCount` compte le rectangle
  englobant. La part valide se rapporte donc à la surface de la parcelle,
  jamais à `sampleCount`.

## Mise en service

1. **Créer le client OAuth** : sur
   https://shapps.dataspace.copernicus.eu/dashboard, *User settings → OAuth
   clients → Create*. Ne pas cocher « SPA ». Le secret ne s'affiche qu'une
   fois.
2. **Le saisir dans Fourmy** : *Intégrations → Télédétection → Copernicus*,
   avec l'identifiant client, le secret (chiffré, jamais réaffiché) et
   éventuellement un budget mensuel de requêtes (3 000 par défaut ; le compte
   gratuit en permet 10 000).
3. **Vérification à l'enregistrement** : le test obtient un jeton et compte
   les acquisitions des 30 derniers jours sur les parcelles ; l'écran
   l'affiche (« Connexion réussie : 14 acquisition(s) Sentinel-2… la
   dernière le 10/11/2026 »). Champ secret laissé vide : le secret
   enregistré est repris (indice des 4 derniers caractères). Le nombre
   d'images exploitables n'est pas encore donné par ce test.
4. **Premier passage du worker** : il charge l'historique depuis le
   1er janvier de l'année précédente, puis vérifie toutes les 6 heures.
5. **Historique plus ancien** : `POST /remote-sensing/history` avec `{ from }`
   renvoie une estimation (requêtes, PU), puis avec `confirm: true` lance le
   chargement. Il n'y a pas encore de bouton dans l'interface.

## Choix de l'indice (NDVI, NDRE, NDMI)

Ajouté le 2026-11-11. Le NDVI reste l'indice par défaut.

| Indice | Bandes Sentinel-2 | Ce qu'il dit à l'agriculteur |
|---|---|---|
| NDVI | B08 / B04 | Couvert vert : quantité de feuillage. Sature quand le couvert est dense. |
| NDRE | B8A / B05 (red edge) | Chlorophylle : reste sensible quand le NDVI sature ; suit l'état azoté d'un couvert dense. |
| NDMI | B08 / B11 (infrarouge moyen) | Eau dans les feuilles : baisse quand la culture manque d'eau ou sèche ; négatif sur sol nu ou couvert sec. |

- **Où** :
  - onglet *Végétation* de la fiche parcelle : courbe, légende et aide de
    l'indice choisi ;
  - encadré *Satellite* de la carte et du plan 3D, couche *Par parcelle* :
    les parcelles prennent la couleur de l'indice choisi.
- **Ce qui reste au NDVI** :
  - l'image drapée (seule l'image NDVI est rendue par Copernicus ; une image
    par indice doublerait les PU et le stockage) ;
  - les récoltes probables (lot Z), dont les seuils portent sur le NDVI :
    leurs zones ne sont tracées que sur sa courbe, le bandeau reste affiché ;
  - la végétation du plan 3D (lot AA).
- **Mémorisation** : l'indice choisi est dans l'URL (`?idx=ndre`), partagé
  par la carte, le plan 3D et la fiche, comme la couche satellite (`?sat=`).
- **Domaines** : fixés d'après les valeurs mesurées chez Pierre en 2025-2026
  (p2 à p98) : NDVI 0,14 à 0,87, NDRE 0,09 à 0,71, NDMI −0,31 à 0,44. Axe
  des courbes au pas de 0,2 (NDMI de −0,4 à 0,6).
- **Ferme de Pierre, maïs 2026** : NDMI vers −0,1 au printemps (sol nu),
  0,4 à 0,45 fin juin et début juillet, sous 0 dès la mi-août (maïs qui
  sèche), −0,35 en octobre.
- **Vérification visuelle** faite le 2026-11-11 sur la ferme de Pierre
  (onglet Végétation pour les trois indices, carte en NDMI par parcelle) :
  aucune erreur de console.

## Coût mesuré (ferme de Pierre, 11 parcelles, 37 ha)

- **Activation** : historique du 1er janvier 2025 au 10 novembre 2026.
  - 325 acquisitions, dont environ 150 exploitables ;
  - 9 084 valeurs et 36 images ;
  - environ 50 requêtes et environ 190 PU, en 2 minutes.
- **Ensuite** : environ 120 requêtes de catalogue par mois, plus une requête
  par parcelle à chaque date exploitable nouvelle et deux images par date.
  On reste loin du quota (§6 de la conception).
- **Statistiques par parcelle** : environ 0,04 PU par date.
- **Test de nuages de la ferme** : fait à 60 m. Copernicus facture le
  rectangle englobant, que des parcelles dispersées agrandissent.

## Code

| Où | Quoi |
|---|---|
| `packages/sentinel` | Client CDSE : jeton OAuth en cache, catalogue, Statistical et Process API, réessais sur 401, 429 et 5xx, plafond de PU par minute, budget avant chaque requête. Evalscripts versionnés |
| `packages/domain/src/remote-sensing.ts` | Zone UTM, lissage de Whittaker (Cholesky en bande), référence multi-annuelle, statut d'une parcelle, taille d'image |
| `packages/contracts/src/remote-sensing.ts` | Types, seuils, palettes et échelles des indices (`INDEX_SCALES`, `indexColor`), mention Copernicus |
| `packages/db/migrations/0030_remote_sensing_dismissals.sql` | Signalements écartés (lot Z) |
| `apps/web/src/features/remote-sensing/CoverLossAlerts.tsx` | Widget du tableau de bord, bandeau, saisie pré-remplie (lot Z) |
| `packages/db/migrations/0029_remote_sensing.sql` | `satellite_scenes`, `satellite_images`, `parcel_indices`, `parcel_index_cursors`, `remote_sensing_usage` (RLS), synchro `copernicus` toutes les 6 h |
| `apps/api/src/repos/remote-sensing.ts` | Synchro (curseur par version de parcelle) et lectures |
| `apps/api/src/routes/remote-sensing.ts` | Routes (§7 de la conception) |
| `apps/web/src/features/remote-sensing/` | Onglet Végétation (`@mantine/charts`, chargé avec l'onglet), encadré Satellite, choix de l'indice (`IndexPicker`, `useVegetationIndex`), légende |
| `apps/web/src/3d/FarmScene.ts` | `setSatellite` (image drapée), `setParcelStyle` (teinte de l'indice choisi) |

## Tests

- `packages/sentinel/test` : requêtes et réponses du client, sans réseau.
- `packages/domain/test/remote-sensing.test.ts` : règles, lissage, référence.
- `apps/api/test/remote-sensing.integration.test.ts` : synchro avec un faux
  client (économie de requêtes, parcelle trop petite, géométrie modifiée),
  lectures, image et ETag, isolation entre fermes.
- `apps/web/test/vegetation.test.tsx` : onglet Végétation (graphique,
  parcelle trop petite, intégration absente), choix de l'indice (série
  rechargée, carte par parcelle et URL), échelles et valeurs négatives.
- **Données de démonstration** (`@fourmy/mocks`) : saison synthétique
  (aucune image), NDRE et NDMI déduits du NDVI, pour développer sans compte
  Copernicus.

## Récoltes probables non saisies (lot Z)

Réalisé le 2026-11-10 (FR-TWIN-10). Le satellite signale qu'une parcelle a
perdu son couvert alors qu'aucune intervention ne l'explique.

- **Chute du couvert** (`coverLossEvents`, domaine) :
  - une mesure exploitable de NDVI ≥ 0,5, puis une mesure ≤ 0,3 au plus
    45 jours après ;
  - **confirmée** si la mesure suivante (dans les 30 jours) reste sous 0,4 ;
  - **écartée** si elle remonte (simple creux : ombre, nuage résiduel).
- **Explication** : une intervention **réalisée** qui retire le couvert, sur
  la parcelle, de 7 jours avant le dernier passage couvert à **30 jours
  après** le premier passage en sol nu.
  - Interventions retenues (`COVER_REMOVING_PROCEDURES`) : récoltes hors
    vigne, labours, broyages, fauche.
  - Pourquoi 30 jours : un maïs grain sèche sur pied et descend à 0,3 deux à
    quatre semaines avant la récolte. Chez Pierre en 2025, les récoltes du
    04/09 et du 16/09 venaient 13 à 18 jours après la chute ; avec 7 jours
    de tolérance seulement, elles donnaient deux fausses alertes.
- **Délai** : on n'alerte qu'une fois ces 30 jours écoulés (la récolte peut
  encore venir).
- **Exclusions** :
  - les vignes : la chute des feuilles fait baisser le NDVI chaque automne ;
  - les chutes écartées par l'exploitant (`remote_sensing_dismissals`).
- **Écrans** :
  - **widget « À vérifier : récoltes probables non saisies »** du tableau de
    bord, sur les 12 mois précédant la date de la frise ;
  - bandeau et zone colorée sur la courbe de l'onglet Végétation
    (`?tab=vegetation`).
- **Actions** :
  - **« Saisir la récolte »** ouvre une intervention réalisée pré-remplie
    (`?procedure=harvesting&status=done&parcels=…&at=<date du sol nu>`) ;
  - **« Ce n'est pas une récolte »** écarte le signalement.
- **API** : `GET /remote-sensing/anomalies?from=&to=` et
  `POST /remote-sensing/anomalies/dismiss` (`{ parcelId, to, reason? }`).
- **Ferme de Pierre** :
  - 2025 : 0 signalement (récoltes saisies) ;
  - 2026 : 8 signalements, tous les maïs, sol nu entre le 02/08 et le 18/09
    et aucune récolte saisie.
- **Pas de détection** : la récolte d'une céréale suivie d'une repousse
  (le NDVI ne descend pas sous 0,3, comme le triticale de Pierre).

## Limites connues

- **Vigne** : un pixel de 10 m mélange les rangs, l'enherbement et le sol.
  Lire des tendances, pas des valeurs absolues.
- **Vérification manuelle** : l'encadré Satellite de la carte et du plan 3D
  n'a pas encore été vérifié à l'écran sur la ferme de Pierre. Les images et
  les valeurs l'ont été côté API.
- **Signalements** (lot Z) : récoltes et destructions du couvert seulement.
  Un semis non saisi (levée sans semis) ou une confirmation par le NDMI ou
  Sentinel-1 (maïs sec sur pied ou champ récolté) restent à faire.
