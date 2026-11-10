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

- **Pas de valeur inventée** : une date nuageuse est conservée avec ses
  pixels valides et marquée non exploitable. Un échec de Copernicus n'écrit
  rien.
- **Indices stockés** : NDVI, NDRE et NDMI. L'interface n'affiche que le NDVI
  pour l'instant (décision du 2026-11-10).
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
   les acquisitions des 30 derniers jours sur les parcelles.
4. **Premier passage du worker** : il charge l'historique depuis le
   1er janvier de l'année précédente, puis vérifie toutes les 6 heures.
5. **Historique plus ancien** : `POST /remote-sensing/history` avec `{ from }`
   renvoie une estimation (requêtes, PU), puis avec `confirm: true` lance le
   chargement. Il n'y a pas encore de bouton dans l'interface.

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
| `packages/contracts/src/remote-sensing.ts` | Types, seuils, palette, mention Copernicus |
| `packages/db/migrations/0030_remote_sensing_dismissals.sql` | Signalements écartés (lot Z) |
| `apps/web/src/features/remote-sensing/CoverLossAlerts.tsx` | Widget du tableau de bord, bandeau, saisie pré-remplie (lot Z) |
| `packages/db/migrations/0029_remote_sensing.sql` | `satellite_scenes`, `satellite_images`, `parcel_indices`, `parcel_index_cursors`, `remote_sensing_usage` (RLS), synchro `copernicus` toutes les 6 h |
| `apps/api/src/repos/remote-sensing.ts` | Synchro (curseur par version de parcelle) et lectures |
| `apps/api/src/routes/remote-sensing.ts` | Routes (§7 de la conception) |
| `apps/web/src/features/remote-sensing/` | Onglet Végétation (`@mantine/charts`, chargé avec l'onglet), encadré Satellite, légende |
| `apps/web/src/3d/FarmScene.ts` | `setSatellite` (image drapée), `setParcelStyle` (teinte NDVI) |

## Tests

- `packages/sentinel/test` : requêtes et réponses du client, sans réseau.
- `packages/domain/test/remote-sensing.test.ts` : règles, lissage, référence.
- `apps/api/test/remote-sensing.integration.test.ts` : synchro avec un faux
  client (économie de requêtes, parcelle trop petite, géométrie modifiée),
  lectures, image et ETag, isolation entre fermes.
- `apps/web/test/vegetation.test.tsx` : onglet Végétation (graphique,
  parcelle trop petite, intégration absente).
- **Données de démonstration** (`@fourmy/mocks`) : saison synthétique
  (aucune image), pour développer sans compte Copernicus.

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
