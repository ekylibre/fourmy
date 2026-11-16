# Cartes de modulation et agrirouter

Lot AD, réalisé le 2026-11-11.

- **FR-TWIN-6** : zonage intra-parcellaire d'après Sentinel-2, dose par zone, export ISO-XML et Shapefile.
- **Connexion agrirouter** : envoi des cartes aux consoles des machines. Elle remplace FR-TWIN-7 (import des TimeLogs ISOBUS), décision du 2026-11-11.

Le zonage s'appuie sur la télédétection ([`teledetection.md`](teledetection.md)) : le compte Copernicus de la ferme fournit les images.

## Ce que voit l'utilisateur

### Créer une carte de modulation

On crée une carte depuis deux endroits :
- la fiche parcelle, onglet **Végétation**, encadré « Cartes de modulation », bouton « Créer une carte de modulation » ;
- la page **Cartes → Modulation**, bouton « Nouvelle carte ».

Seul le responsable de la ferme peut créer une carte. Le zonage consomme des requêtes Copernicus de la ferme.

1. **Zonage.** Le responsable choisit :
   - la parcelle ;
   - l'indice (NDVI, NDRE ou NDMI) ;
   - une image ;
   - un nombre de zones, de 2 à 5.

   Les images proposées sont celles des 3 dernières années où 80 % au moins de la parcelle est sans nuage, de la plus récente à la plus ancienne. Chacune affiche l'indice moyen de la parcelle.

   « Calculer les zones » affiche :
   - la carte des zones sur l'orthophoto, de la plus faible (brique) à la plus forte (vert) ;
   - pour chaque zone, l'indice moyen, son étendue (minimum – maximum) et sa surface.

2. **Produit, doses et machine.** Le responsable saisit le nom de la carte et le produit, puis l'unité de dose : kg/ha, L/ha ou grains/ha.

   Il choisit ensuite la répartition :
   - **Compenser** : plus de produit sur les zones faibles, par exemple de l'azote de rattrapage ;
   - **Valoriser** : plus sur les zones fortes, par exemple la densité de semis sur les bons sols ;
   - **Uniforme** : même dose partout.

   Il saisit aussi :
   - la dose de base (zone moyenne) ;
   - l'écart entre zones, en % ;
   - les doses minimale et maximale de la machine ;
   - la largeur de travail.

   Les doses sont recalculées à chaque changement. On peut ensuite corriger chaque zone à la main. La quantité totale s'affiche en kg, L ou grains, avec la dose moyenne.

3. **Enregistrer la carte.**

### Depuis un apport du plan de fumure (lot AN)

Sur le plan de fumure d'une parcelle, chaque apport dont le produit a une teneur connue a un bouton « Moduler » (voir [`fertilisation.md`](fertilisation.md)). Il ouvre la création de carte déjà remplie :
- parcelle, produit et unité ;
- dose de produit déduite de l'azote de l'apport : % de la masse en kg/ha, kg/m³ en L/ha ;
- doses minimale et maximale de la machine à la moitié et à une fois et demie de cette dose ;
- image : celle qui précède de plus près la date prévue de l'apport, sinon la plus récente.

Un bandeau rappelle l'apport. La case « Garder la dose du plan en moyenne pondérée » (cochée) recale les doses des zones sur cette dose. Si les bornes de la machine empêchent d'y arriver, un avertissement le dit. La fiche de la carte rappelle l'apport et compare la dose prévue à la moyenne réelle ; le plan liste ses cartes.

### Fiche d'une carte

- La carte des zones, le tableau des zones et leurs doses. Le responsable peut corriger les doses.
- Les téléchargements, ouverts à tous les membres :
  - **ISO-XML (TaskData ISOBUS)** : archive avec le dossier `TASKDATA`, à copier dézippée sur une clé USB pour la console ;
  - **Shapefile** : archive avec `.shp`, `.shx`, `.dbf`, `.prj` et `.cpg`.
- **Envoyer par agrirouter** (responsable, ferme connectée) :
  - choix du format ;
  - choix des destinataires parmi ceux que les routes agrirouter permettent pour ce format ;
  - bouton « Envoyer ».
- L'historique des envois : date, format, destinataires, auteur, état (« Envoyé », « En attente, nouvel essai à … », « Partiel » ou « Refusé », avec le motif au survol).

« Envoyé » veut dire « accepté par agrirouter ». La console reçoit la carte à sa prochaine connexion. agrirouter ne renvoie pas d'accusé de livraison.

Si agrirouter ne répond pas, la carte passe « En attente » et part toute seule au retour de la connexion (pendant 24 h au plus). « Partiel » : agrirouter a refusé un envoi à plusieurs destinataires, certains l'ont peut-être reçu ; Fourmy ne le renvoie pas, pour ne pas doubler la carte.

### Connecter la ferme à agrirouter

Dans **Intégrations → Échanges avec les machines**, le responsable clique sur **Connecter à agrirouter**. Il se connecte à son compte agrirouter et autorise Fourmy, puis revient sur Fourmy.

La carte affiche ensuite :
- le compte agrirouter ;
- les destinataires joignables (machines ou logiciels) et leurs formats.

Les destinataires sont relus toutes les heures, ou sur demande avec « Actualiser les destinataires ».

La connexion peut aussi partir d'agrirouter : son catalogue renvoie vers `fourmy.org/agrirouter` (Deep URL de l'application), qui mène à `/agrirouter/start` dans Fourmy. L'utilisateur se connecte si besoin, choisit la ferme dont il est responsable, confirme, puis suit le même consentement.

Si l'autorisation est retirée ou le point de terminaison supprimé dans agrirouter, la synchro horaire le constate. L'intégration passe alors « Déconnectée le … », avec le motif, et propose « Reconnecter » ou « Retirer ».

« Déconnecter » supprime le point de terminaison de Fourmy dans agrirouter, puis retire l'autorisation. Si une autre ferme Fourmy est reliée au même compte agrirouter, agrirouter garde l'autorisation (409) : c'est normal. Si agrirouter ne répond pas, l'intégration est quand même retirée de Fourmy. Un message invite alors à retirer l'accès dans agrirouter (Paramètres → Connexions).

Pour qu'une console reçoive une carte, l'exploitant la relie à Fourmy dans agrirouter. Les routes entre une console (unité de communication virtuelle) et un logiciel aux capacités compatibles sont créées automatiquement. Entre deux logiciels, l'exploitant les crée lui-même dans l'interface d'agrirouter.

## Règles

### Image

La parcelle est prise dans sa version valide à la date de l'image.

L'image vient de la Process API de Copernicus (Sentinel Hub) :
- l'emprise est le rectangle de la parcelle en UTM, calé sur une grille de 10 m ;
- la géométrie de la parcelle sert de découpe ;
- l'image retenue est la moins nuageuse du jour.

L'évalscript (`indexRasterEvalscript`, méthode `s2-raster-v1`) renvoie un octet par pixel :
- 0 hors parcelle et sous les classes SCL exclues (nuage, ombre, neige…) ;
- sinon `1 + round((indice + 1) × 127)`, soit un pas d'indice de 0,008.

Le raster est gardé dans `parcel_index_rasters`, par version de parcelle, date et indice. Un nouveau zonage de la même image ne coûte donc aucune requête. Sur la ferme de Pierre (12,5 ha), la première image a pris 1,1 s, puis 18 ms depuis le cache.

### Zonage (`classifyZones`, `packages/domain`)

1. **Classes par quantiles** des pixels mesurés : les zones ont environ la même surface. La zone 1 a l'indice le plus faible.
2. **Lissage** : deux passes de filtre majoritaire 3 × 3 sur les pixels mesurés. Un pixel isolé rejoint la zone qui l'entoure.
3. **Pixels sans mesure** (nuage ou bord) : ils prennent la zone du pixel mesuré le plus proche.
4. **Contours** : les pixels de même zone sont regroupés en bandes, unis puis découpés par la parcelle (PostGIS), avant le retour en WGS84.

Une image est refusée si moins de 80 % de la parcelle est mesurée (`MODULATION_MIN_VALID_RATIO`).

Les statistiques d'une zone (moyenne, minimum, maximum) portent sur les seuls pixels mesurés, après lissage. Un pixel aberrant lissé dans une zone peut donc élargir son étendue.

### Doses (`modulationRates`)

- La zone du milieu reçoit la dose de base. Les zones extrêmes reçoivent ± l'écart (en %), avec une progression linéaire entre les deux.
- Les doses sont bornées par les doses minimale et maximale de la machine.
- Elles sont arrondies au pas de l'unité : 1 kg/ha, 1 L/ha, 1 000 grains/ha.
- Les zones ayant la même surface, la dose moyenne reste la dose de base, hors bornes et arrondis.
- **Carte partie d'un apport du plan de fumure** (lot AN, `conserveMean`) : les doses sont décalées d'une même quantité, dans les bornes, pour que la moyenne pondérée par la surface des zones égale la dose de l'apport. L'écart entre zones voulu par la stratégie est gardé.
- Des doses saisies zone par zone remplacent le calcul.
- La quantité totale est la somme des doses × surfaces.

### ISO-XML (`taskData`, `packages/isoxml`)

Le fichier suit la norme ISO 11783-10, version 4.2. Les attributs ont été vérifiés dans le greffon ISOv4 d'AgGateway ADAPT, car le texte de la norme n'est pas public.

**Contenu de `TASKDATA.XML`**

| Élément | Contenu |
|---|---|
| `CTR` (client), `FRM` (ferme) | Nom de la ferme |
| `PFD` (parcelle) | Surface en m² ; contour en `PLN` type 1, anneaux `LSG` 1 (extérieur) et 2 (trous), points `PNT` type 2 |
| `PDT` | Produit |
| `VPN` | Présentation de l'unité |
| `TSK` | Tâche planifiée (statut 1), qui contient le `GRD` puis les `TZN` |

**Zones de traitement (TZN)**

- une TZN par zone, avec sa dose de consigne `PDV` ;
- TZN 0 « Hors parcelle » : dose 0, zone hors champ de la tâche (`J`) ;
- TZN n + 1 « Dose par défaut » : dose moyenne pondérée, pour la zone par défaut (`H`) et la perte de position (`I`).

**DDI de consigne**

| Unité | DDI | Unité ISO | Conversion de la dose |
|---|---|---|---|
| kg/ha | 6 (Setpoint Mass Per Area) | mg/m² | × 100 |
| L/ha | 1 (Setpoint Volume Per Area) | mm³/m², pas de 0,01 | × 10 000 |
| grains/ha | 11 (Setpoint Count Per Area) | /m², pas de 0,001 | × 0,1 |

**Grille de type 1**

- fichier `GRD00001.bin` dans le dossier `TASKDATA` ;
- un octet par maille, qui contient le code de la zone ;
- lignes du sud au nord, colonnes d'ouest en est, à partir du coin sud-ouest de l'emprise des zones ;
- maille carrée de la largeur de travail, en degrés ;
- chaque maille prend la zone qui contient son centre.

Une grille de plus de 250 000 mailles est refusée : il faut alors augmenter la largeur de travail.

### Shapefile (`shapefile`)

- Un polygone (multi) par zone, en WGS84.
- Anneaux extérieurs dans le sens horaire et trous dans le sens trigonométrique, comme le format l'exige.
- Attributs : `ZONE`, `DOSE`, `UNITE`, `PRODUIT`, `INDICE`, `SURF_HA`.
- `.dbf` en UTF-8, annoncé par le `.cpg`.

Les fichiers de la ferme de Pierre ont été relus par GDAL (`ogrinfo`) : 3 entités, géométries valides, trous conservés, surfaces exactes.

### agrirouter (`packages/agrirouter`, API G4)

Spécification : <https://agrirouter.com/api/openapi.yaml>, lue le 2026-11-11.

**Application Fourmy**

Elle est enregistrée une fois dans le portail développeur d'agrirouter, avec un client OAuth et une version de logiciel. Ses identifiants sont des variables du serveur, jamais des réglages de ferme (décision du 2026-11-11). Sans elles, la connexion est désactivée et l'interface le dit.

Pour les appels qui ne concernent pas une ferme, elle obtient un jeton `client_credentials` sur `/token`. Il n'y a pas de jeton de rafraîchissement : le jeton est redemandé une minute avant son expiration.

**Connexion d'une ferme**

1. `POST /integrations/agrirouter/connect` :
   - crée un état `<ferme>.<jeton aléatoire>` ;
   - garde son empreinte SHA-256 pendant 30 minutes ;
   - renvoie l'adresse du consentement (`/api/authorize`, portée `endpoints:manage`).
2. agrirouter revient sur la page web `/agrirouter/callback` (`AGRIROUTER_REDIRECT_URI`) avec `state` et `tenant_id`, ou `error`. La page appelle alors `POST /integrations/agrirouter/complete`.
3. L'API vérifie :
   - que l'état est celui émis pour cette ferme et qu'il n'a pas expiré ;
   - que `GET /tenants` contient ce tenant avec ce même état.

   L'état ne sert qu'une fois.
4. L'API crée le point de terminaison de Fourmy dans la ferme agrirouter (lot AR1 du 16/11, `farmEndpointConfig`) :
   - `PUT /endpoints/urn:fourmy.org:fourmy:farm-<ferme>`, de type `cloud_software`, nommé « Fourmy - <ferme> » ;
   - capacités, sous-ensemble de la version 1 déclarée dans le portail : `iso:11783:-10:taskdata:zip` en envoi et réception, `shp:shape:zip` en envoi, `iso:11783:-10:time_log:protobuf` et `iso:11783:-10:device_description:protobuf` en réception ;
   - abonnements : TaskData, TimeLog et Device Description (ce que publient les machines) ;
   - `allow_delete_by_user: true`.

   Les fichiers reçus sont rangés et confirmés (lot AR2, ci-dessous) ; leur lecture vient aux lots AR4 et AR5.
5. Le tenant est chiffré comme secret de l'intégration. Le point de terminaison et le nom du compte sont gardés dans les réglages.

**Destinataires**

La synchro horaire vérifie d'abord que la connexion tient : le tenant doit figurer dans `GET /tenants` (sinon autorisation retirée), et le point de terminaison de Fourmy dans la liste (sinon supprimé ; ce contrôle attend 10 min après la connexion, le temps qu'agrirouter le propage). Sinon, l'intégration passe `disconnected`, sans secret, avec `settings.disconnectedAt` et `settings.disconnectReason` (`revoked`, `endpoint_deleted`).

`GET /tenants/{tenant}/endpoints` renvoie les routes du point de terminaison de Fourmy (`routed_endpoints.can_send_to`). Seuls les destinataires ayant une route pour l'un des deux formats sont gardés. La synchro (toutes les heures) range la liste dans le rapport de l'intégration.

**Envoi**

`POST /messages` :
- le corps est le zip brut ;
- l'enveloppe est en en-têtes : `x-agrirouter-message-type`, `x-agrirouter-direct-recipients`, `x-agrirouter-endpoint-id`, `x-agrirouter-tenant-id`, `x-agrirouter-sent-timestamp`, `x-agrirouter-filename`, `x-agrirouter-is-publish: false` ;
- agrirouter découpe lui-même les gros fichiers (256 Mo au plus).

Avant l'envoi, l'API relit les destinataires en direct (ceux de la dernière synchro si agrirouter ne répond pas). Elle refuse un destinataire sans route ou qui n'accepte pas le format.

**File d'envoi (lot AR3)** : l'envoi est d'abord mis en file (`agrirouter_outbox`, migration 0056), fichier figé sur le volume `fourmy_agrirouter_files`, puis tenté aussitôt par l'API. Règle de reprise d'agrirouter (`sendFailure`) :

| Réponse | Issue |
|---|---|
| 200 | « Envoyé » ; jamais renvoyé (agrirouter ne dédoublonne pas) |
| pas de réponse, jeton refusé ou indisponible, 401, 408, 429, 5xx | « En attente » ; repris par le worker après 1, 2, 5, 15, 30, 60 min, puis toutes les heures, avec les mêmes octets ; abandonné au bout de 24 h |
| 400 sur plusieurs destinataires | « Partiel », non renvoyé |
| autre 4xx | « Refusé » |

Dans chaque appel, le client réessaie déjà trois fois sur 429 et 5xx (1, 2, 4 s). Un envoi pris en charge par un processus mort est repris après 2 min. Une ferme déconnectée pendant l'attente fait échouer l'envoi.

**Écoute des événements (lot AR2)**

Le worker écoute en permanence `GET /events` (Server-Sent Events), pour toutes les fermes à la fois. Un seul worker écoute : il tient un verrou consultatif PostgreSQL sur une connexion dédiée, libéré s'il s'arrête. Le flux coupé est rouvert avec une attente croissante (1 s à 60 s).

| Événement | Effet |
|---|---|
| `MESSAGE_RECEIVED`, `FILE_RECEIVED` | ferme retrouvée par le point de terminaison destinataire ; contenu (intégré en base64 ou téléchargé depuis `payload_uri`) rangé par empreinte sur le volume `fourmy_agrirouter_files` ; ligne dans `agrirouter_inbox`, une seule fois même en cas de redélivraison. Destinataire inconnu de Fourmy : confirmé sans être gardé. |
| `ENDPOINT_DELETED` | la ferme dont c'est encore le point de terminaison passe « Déconnectée » |
| `AUTHORIZATION_REVOKED` | toutes les fermes reliées à ce compte agrirouter passent « Déconnectée » |
| `AUTHORIZATION_ADDED` | si le navigateur n'est pas revenu, la connexion se termine d'après l'état du consentement. Le retour tardif du navigateur reste sans erreur. |
| `ENDPOINTS_LIST_CHANGED` | destinataires recalculés à partir de la liste reçue, sans attendre la synchro horaire |

La ferme d'un événement est retrouvée sans lever l'isolation : fonctions `fourmy_agrirouter_*` (migration 0055), qui ne renvoient que des identifiants. Le compte agrirouter (tenant) reste chiffré ; les réglages en gardent une empreinte HMAC (`tenantHash`).

**Confirmation** : à chaque tour, le worker confirme (`POST /confirmations`) les fichiers rangés, par compte agrirouter et par lots de 100 ; un échec est retenté au tour suivant (20 fois au plus, motif gardé). Un fichier est considéré traité dès qu'il est rangé : sa lecture se fera depuis le volume.

**Boîte de réception** : `Intégrations → Fichiers reçus d'agrirouter` (`/f/:ferme/agrirouter/inbox`, responsable) : date, type, fichier, état, confirmation, téléchargement.

## API

| Route | Rôle |
|---|---|
| `GET /land-parcels/:id/modulation-dates?index=` | Images assez dégagées de la parcelle (3 ans) |
| `POST /prescriptions/zoning` | Zonage d'une image, sans enregistrer (responsable) |
| `GET /prescriptions?parcel=` · `GET /prescriptions/:id` | Cartes et fiche (zones, envois) |
| `POST /prescriptions` · `PUT /prescriptions/:id/rates` · `DELETE /prescriptions/:id` | Enregistrement, doses corrigées, suppression (responsable) |
| `GET /prescriptions/:id/files/isoxml` · `…/files/shape` | Archives zip |
| `GET /prescriptions/recipients` | Destinataires agrirouter, lus en direct |
| `POST /prescriptions/:id/send` | Envoi par agrirouter (responsable), tracé |
| `POST /integrations/agrirouter/connect` · `…/complete` | Consentement agrirouter (responsable) |
| `GET /agrirouter/inbox` · `GET /agrirouter/inbox/:id/file` | Fichiers reçus d'agrirouter et leur contenu (responsable) |

## Code

| Où | Quoi |
|---|---|
| `packages/contracts/src/modulation.ts` | Types, unités, stratégies, formats, schémas d'écriture |
| `packages/domain/src/modulation.ts` | Quantiles, zonage, lissage, doses |
| `packages/sentinel` | `indexRaster`, évalscript du raster, décodeur PNG |
| `packages/isoxml` | TaskData ISO 11783-10, Shapefile, zip, sans dépendance |
| `packages/agrirouter` | Client G4 : consentement, jeton, tenants, points de terminaison, envoi |
| `apps/api/src/repos/prescriptions.ts` | Raster en cache, contours PostGIS, cartes, fichiers, envoi |
| `apps/api/src/integrations/agrirouter.ts` | Configuration du serveur, connexion, destinataires |
| `packages/db/migrations/0034_modulation.sql` | `parcel_index_rasters`, `prescriptions`, `prescription_zones`, `prescription_sends`, fournisseur `agrirouter` |
| `apps/web/src/features/modulation/` | Création, fiche, liste, encadré de la fiche parcelle |
| `apps/web/src/features/integrations/` | Carte agrirouter, page de retour du consentement |

**Variables du serveur** (API et worker, voir `.env.example`) :
- `AGRIROUTER_CLIENT_ID`, `AGRIROUTER_CLIENT_SECRET` ;
- `AGRIROUTER_APPLICATION_ID`, `AGRIROUTER_SOFTWARE_VERSION_ID` ;
- `AGRIROUTER_REDIRECT_URI` ;
- `AGRIROUTER_ENVIRONMENT` (`production` ou `qa`) ;
- facultatives : `AGRIROUTER_API_URL`, `AGRIROUTER_AUTHORIZE_URL`.

## Tests

- `packages/domain/test/modulation.test.ts` : quantiles, bandes d'un gradient, lissage d'un pixel aberrant, nuage comblé, raster vide, trois stratégies, bornes et arrondis, quantité.
- `packages/isoxml/test/files.test.ts` :
  - zip relu avec ses CRC ;
  - Shapefile : orientation des anneaux, index, DBF tronqué en UTF-8 ;
  - TaskData : tâche, zones, hors champ et défaut, grille, contour sans point répété, conversions des DDI.
- `packages/agrirouter/test/client.test.ts` :
  - adresse de consentement ;
  - jeton réutilisé ;
  - corps du `PUT /endpoints` ;
  - en-têtes de `POST /messages` et réessai sur 429 ;
  - erreur relayée sans le secret.
- `packages/sentinel/test/client.test.ts` : PNG décodé (filtres), requête du raster calée sur l'emprise.
- `apps/api/test/modulation.integration.test.ts`, avec un raster synthétique en cache et un faux agrirouter :
  - dates proposées ;
  - zonage d'un gradient en 3 zones de surfaces voisines ;
  - refus sans Copernicus ;
  - droits du responsable ;
  - doses bornées, corrigées ;
  - exports (grille ouest → est, Shapefile) ;
  - agrirouter non configuré ;
  - consentement (état inconnu, état d'un autre consentement, état réutilisé) ;
  - point de terminaison et destinataires ;
  - envoi (format refusé, destinataire sans route, en-têtes) et refus tracé ;
  - déconnexion.
- `apps/web/test/modulation.test.tsx` :
  - création (doses calculées puis corrigées, quantité totale) ;
  - fiche (liens de téléchargement, destinataires filtrés par format, envoi) ;
  - ferme non connectée ;
  - carte agrirouter non configurée puis connectée ;
  - page de retour (réussite et refus).

## Limites et suite

- **Application enregistrée le 2026-11-16** (portail agrirouter, production) : « Fourmy », marque Ekylibre, Deep URL `https://fourmy.org/agrirouter`, client OAuth de dev.fourmy.org. La version 1 attend la validation pour les tests (« Testing approved ») : aucune connexion réelle n'est possible avant. La suite (réception, file d'envoi, parcelles, revue) est conçue dans `claudedocs/conception_agrirouter.md`.
- **On développe sur la production**, avec l'IO-Tool comme correspondant : l'environnement QA est réservé à l'équipe agrirouter.
- **Fichiers non essayés sur une console réelle.** Les points à confirmer au premier essai :
  - l'ordre des mailles de la grille ;
  - l'ordre des enfants de `TSK` ;
  - le type de point du contour.
- **Lecture des fichiers reçus**, non faite : tâches ISO-XML réalisées, TimeLogs, Device Descriptions (lots AR4 et AR5 de `claudedocs/conception_agrirouter.md`). Ils sont déjà rangés et confirmés (lot AR2).
- **Zonage sur une seule image.** Un zonage pluriannuel (médiane de plusieurs dates ou de plusieurs saisons) serait plus stable pour les cartes de sol ou de semis.
- **Pas de lien** entre une carte et l'intervention qui l'applique. Les doses moyennes et la quantité ne pré-remplissent pas encore la saisie.
- Le lien avec le plan de fumure existe dans l'autre sens : voir ci-dessous.
