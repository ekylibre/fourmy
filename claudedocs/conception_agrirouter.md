# Intégration agrirouter : conception

Conception du 2026-11-16, d'après `claudedocs/besoins_agrirouter.md`
(exigences EX-AR-1 à 20, sans EX-AR-11 à 14 : machines virtuelles retirées le 16/11). Les sources sont la spécification G4 lue le
16/11 et le code au commit `81092a6`. Pas de code ici : les signatures sont
données pour fixer les contrats, l'implémentation suit par lots (§11).

## 1. Vue d'ensemble

```
                    agrirouter (production, API G4)
   ┌──────────────────────────────────────────────────────────────┐
   │ /token  /authorize  /endpoints  /messages  /confirmations     │
   │ GET /events (SSE, toute l'application)                        │
   │ GET /masterdata/events (SSE, Last-Event-ID)  /masterdata/...  │
   └───▲───────────▲──────────────▲───────────────▲──────────────┘
       │ envoi      │ consentement │ flux           │ parcelles
┌──────┴─────┐ ┌────┴──────┐ ┌─────┴────────────┐ ┌┴──────────────┐
│ API        │ │ Web       │ │ Worker           │ │ Site public   │
│ connexion, │ │ /agrirouter│ │ ┌─ écouteur ──┐  │ │ /agrirouter   │
│ envoi      │ │ /start,   │ │ │ /events     │  │ │ (Deep URL)    │
│ immédiat,  │ │ /callback,│ │ │ /masterdata │  │ └───────────────┘
│            │ │ boîte de  │ │ └─────┬───────┘  │
│            │ │ réception │ │ tâches (tick) :  │
└────┬───────┘ └───────────┘ │ file d'envoi,    │
     │                       │ boîte de récep., │
     │                       │ parcelles        │
     ▼                       └────────┬─────────┘
 PostgreSQL (RLS par ferme) ◄─────────┘
 agrirouter_endpoints · agrirouter_outbox · agrirouter_inbox
 agrirouter_md_bindings · agrirouter_streams · fichiers sur volume
```

Principes :
1. **L'écouteur ne fait qu'enregistrer.** Il range chaque événement dans la
   base et le fichier sur le disque, puis rend la main. Le traitement
   (lecture ISO-XML, proposition, confirmation) est fait par une tâche du
   worker, qu'on peut rejouer.
2. **On ne confirme qu'après traitement**, ou après avoir marqué un fichier
   « Illisible » (EX-AR-15, 19).
3. **Tout ce qui sort passe par une file** (`agrirouter_outbox`). L'API
   tente l'envoi tout de suite pour la réactivité ; en cas de coupure, le
   worker reprend (EX-AR-7).
4. **Fourmy reste la référence des parcelles** : AgmaSync en écriture, ses
   changements entrants sont lus mais jamais appliqués (décision 5).
5. **Aucun traitement inter-fermes hors RLS** : l'écouteur résout la ferme
   par une fonction `SECURITY DEFINER` qui ne renvoie que des identifiants,
   comme `fourmy_due_integrations`, puis travaille dans `withFarm`.

## 2. Points de terminaison

### Ferme (`cloud_software`)

| Champ | Valeur |
|---|---|
| Identifiant externe | `urn:fourmy.org:fourmy:farm-<farmId>` (EX-AR-1). L'ancien `urn:fourmy:farm:<id>` n'a jamais existé en réel : simple remplacement de `externalEndpointId`. |
| Nom | `Fourmy - <nom de la ferme>`, nettoyé pour le motif `^[\p{L}\p{N} _.,:@\-]+$` (le « · » est refusé), 200 caractères au plus |
| Capacités | `taskdata` SEND_RECEIVE, `shp` SEND, `time_log` RECEIVE, `device_description` RECEIVE |
| Abonnements | `taskdata`, `time_log`, `device_description` (pour recevoir aussi les messages publiés par les machines) |
| `allow_delete_by_user` | `true` : l'écouteur gère `ENDPOINT_DELETED` (§5) |
| `masterdata` | `{ capabilities: [farm, field, field_boundary], resolution_url }` si la synchro des parcelles est active (EX-AR-10) ; absent sinon |

`resolution_url` : `https://<app>/f/<farmId>/integrations?tab=machines`,
affiché par agrirouter quand Fourmy lève `awaiting_user`.

Chaque `PUT` envoie la configuration complète, car il remplace tout.
Une seule fonction `farmEndpointConfig(farm, options)` la construit, pour
la connexion, la réactivation de la synchro et les mises à jour de nom.

### Machines virtuelles : retirées

Décision du 2026-11-16 : pas de point de terminaison
`virtual_communication_unit`. Fourmy ne parle pas aux machines, une machine
virtuelle ne ferait que recevoir ce qu'un autre logiciel lui adresse. Les
fichiers venus des machines arrivent par les routes et les abonnements du
point de terminaison de la ferme. À rouvrir si Fourmy envoie un jour des
TimeLogs tirés de Traccar au nom d'un matériel (nouvelle version, nouvelle
revue).

## 3. Modèle de données (migration 0054)

Toutes les tables ont `farm_id` et la RLS habituelle, sauf
`agrirouter_streams`, qui ne contient aucune donnée de ferme.

```sql
-- Points de terminaison créés par Fourmy (un par ferme ; la table garde
-- l'historique des reconnexions)
agrirouter_endpoints (
  id uuid PK, farm_id uuid NOT NULL,
  external_id text NOT NULL,
  endpoint_id uuid NULL,                              -- id agrirouter, après PUT
  tenant_hash text NOT NULL,                          -- HMAC-SHA256(tenant, FOURMY_SECRETS_KEY)
  config_hash text NULL,                              -- empreinte du dernier PUT
  state text CHECK (state IN ('active','deleted_remote','deleted')),
  created_at, updated_at, deleted_at,
  UNIQUE (farm_id, external_id)
)
-- Résolution sans RLS, identifiants seulement :
fourmy_agrirouter_by_endpoint(p_endpoint uuid) RETURNS (farm_id, id)
fourmy_agrirouter_by_tenant(p_hash text)       RETURNS SETOF farm_id

-- File d'envoi (EX-AR-7)
agrirouter_outbox (
  id uuid PK, farm_id,
  prescription_send_id uuid NULL REFERENCES prescription_sends,
  sender_endpoint uuid NOT NULL REFERENCES agrirouter_endpoints,
  message_type text, filename text NOT NULL,
  recipients uuid[] NOT NULL,
  file_sha256 text NOT NULL,                          -- fichier figé sur le volume
  state text CHECK (state IN ('queued','sending','sent','partial','failed')),
  attempts int, next_attempt_at timestamptz, locked_until timestamptz,
  last_error text, sent_at timestamptz, created_at
)

-- Boîte de réception (EX-AR-15 à 19)
agrirouter_inbox (
  id uuid PK, farm_id,
  endpoint_row uuid REFERENCES agrirouter_endpoints,
  equipment_id uuid NULL,                             -- matériel rapproché à la lecture
  message_ids text[] NOT NULL,                        -- 1 (MESSAGE) ou n (FILE)
  message_type text, filename text, size bigint,
  sender_endpoint_id uuid NULL, sender_name text NULL,
  sent_at, received_at,
  file_sha256 text NULL,                              -- NULL tant que non téléchargé
  state text CHECK (state IN ('received','proposed','validated','dismissed','unreadable','ignored')),
  parsed jsonb NULL,                                  -- résultat de lecture, proposition
  error text NULL,
  intervention_id uuid NULL, prescription_id uuid NULL,
  confirmed_at timestamptz NULL, locked_until timestamptz NULL,
  UNIQUE (farm_id, (message_ids[1]))                  -- idempotence des redélivraisons
)

-- AgmaSync : lien entre un objet Fourmy et l'objet agrirouter
agrirouter_md_bindings (
  farm_id, endpoint_row uuid,
  entity_type text CHECK (entity_type IN ('farm','field','field_boundary')),
  local_id text,                                      -- farm:<id>, field:<landParcelId>, boundary:<landParcelId>
  agrirouter_id text NULL, revision text NULL,
  content_hash text NULL,                             -- dernier contenu poussé
  deactivated_at timestamptz NULL,
  PRIMARY KEY (endpoint_row, entity_type, local_id)
)

-- Positions des flux SSE (pas de farm_id, pas de RLS)
agrirouter_streams (stream text PK, last_event_id text, updated_at)
```

Changements de l'existant :
- `integrations.status` gagne `disconnected` (EX-AR-3). La ligne reste,
  sans secret, avec `settings.disconnectedAt` et
  `settings.disconnectReason` (`revoked`, `endpoint_deleted`) : la carte
  affiche « Déconnectée le … » et « Reconnecter ».
- `prescription_sends.status` gagne `queued` et `partial` ; nouvelle colonne
  `outbox_id`.
- `integrations.settings` de la ferme gagne `masterdata: { enabled, state,
  awaitingUser, routedTypes }`.

**Fichiers** : volume `fourmy_agrirouter_files`, monté dans l'API et le
worker comme `fourmy_ign_cache`, rangé par empreinte
(`<sha256[0:2]>/<sha256>`). Les fichiers sortants sont figés à la mise en
file, et un renvoi envoie les mêmes octets. Purge : fichiers sortants
envoyés depuis 90 jours ; fichiers reçus, jamais (traçabilité).

## 4. Connexion

### Depuis Fourmy (existant, retouché)

Inchangé jusqu'au retour. À `complete` :
1. `putEndpoint(farmEndpointConfig(...))` avec le nouvel identifiant
   externe ;
2. insertion dans `agrirouter_endpoints` (`tenant_hash`) ;
3. si la synchro des parcelles est active (par défaut), elle démarre quand
   l'utilisateur choisit les types dans agrirouter (`ROUTE_CHANGED`, §8).

**Filet de sécurité `AUTHORIZATION_ADDED`** : l'événement porte le `state`.
Si l'utilisateur a fermé l'onglet avant le retour, l'écouteur retrouve la
ferme par l'empreinte du `state` (déjà gardée dans `settings.pendingState`)
et termine la connexion lui-même. Pour cela, `fourmy_agrirouter_by_state`
renvoie la ferme d'un `pendingState`, sans RLS, et `completeAgrirouterConnect`
devient appelable par le worker.

### Depuis agrirouter (Deep URL, EX-AR-4)

```
fourmy.org/agrirouter  ──lien──►  <app>/agrirouter/start
   (Astro, une phrase,                │ RequireAuth → /login?next=/agrirouter/start
    bouton « Continuer               ▼
    vers Fourmy »)          liste des fermes dont l'utilisateur est responsable
                             0 → « Vous n'êtes responsable d'aucune ferme… »
                             1 → écran de confirmation directement
                             n → choix de la ferme, puis confirmation
                                      │ « Connecter la ferme X à agrirouter ? »
                                      ▼
                    POST /f/:farmId/integrations/agrirouter/connect → /authorize
                    (même parcours que depuis Fourmy)
```

- `apps/site/src/pages/agrirouter.astro` : lien vers
  `${APP_URL}/agrirouter/start`. Ce n'est pas une redirection automatique :
  la page reste lisible pour la revue et pour le Solution Finder.
- `RequireAuth` passe désormais `?next=<chemin courant>` à `/login`. Ce
  changement profite à toute l'application. `LoginPage` sait déjà le lire.
- Ferme déjà connectée : l'écran l'indique, avec un lien vers ses
  intégrations.

### Déconnexion depuis Fourmy

`disconnect` :
1. supprime le point de terminaison de la ferme ;
2. appelle `DELETE /authorizations`.

**Nouveau** : une réponse 409 (une autre ferme Fourmy est encore reliée au
même compte agrirouter) est normale. L'autorisation reste pour l'autre
ferme. Les lignes `agrirouter_endpoints` passent à `deleted`.

## 5. Écouteur d'événements (worker)

### Processus

- **Tâche asynchrone permanente dans le worker**, à côté de la boucle
  `tick()`. Ce n'est pas un nouveau service Dokploy.
- **Une seule instance** : verrou consultatif PostgreSQL
  `pg_try_advisory_lock(hashtext('fourmy:agrirouter:events'))`, pris sur une
  connexion dédiée hors transaction. Sans le verrou, la tâche réessaie toutes
  les 60 s. Un worker arrêté libère le verrou avec sa connexion.
- **Deux flux**, deux tâches, deux verrous : `/events` et
  `/masterdata/events`.
- **Lecture SSE** : `fetch` en flux et un analyseur de lignes `event:`,
  `data:`, `id:` dans `packages/agrirouter` (`client.events(types, signal)` →
  `AsyncIterable<AgrirouterEvent>`). Aucune dépendance nouvelle.
- **Reconnexion** : attente croissante de 1 s à 60 s. Le jeton est renouvelé
  sur 401.
- **Sans configuration** (`agrirouterConfig()` nul) : les tâches ne
  démarrent pas.

### Traitement de `/events`

| Événement | Action de l'écouteur |
|---|---|
| `MESSAGE_RECEIVED` | ferme et ligne par `receiving_endpoint_id` ; fichier pris de `payload` (base64) ou téléchargé depuis `payload_uri`, puis rangé sur le volume ; `INSERT … ON CONFLICT DO NOTHING` dans `agrirouter_inbox`, `state='received'`. **Pas de confirmation.** |
| `FILE_RECEIVED` | idem, avec `message_ids` (tous à confirmer ensemble) |
| `ENDPOINT_DELETED` | par `external_id` : la ferme passe en `disconnected` (`endpoint_deleted`) |
| `AUTHORIZATION_REVOKED` | toutes les fermes du tenant (`fourmy_agrirouter_by_tenant`) passent en `disconnected` (`revoked`), leurs points de terminaison en `deleted_remote` |
| `AUTHORIZATION_ADDED` | filet de sécurité de la connexion (§4) |
| `ENDPOINTS_LIST_CHANGED` | les destinataires de chaque ferme du tenant sont recalculés à partir de la liste fournie, sans attendre la synchro horaire |

Destinataire inconnu (point de terminaison supprimé dans Fourmy entre-temps) :
le message est confirmé sans être stocké, et journalisé.

**Redélivraison** : `/events` n'a pas de `Last-Event-ID`. La spécification
dit seulement que la livraison est « au moins une fois ». On suppose
qu'agrirouter renvoie les messages non confirmés à la reconnexion,
l'idempotence par `message_ids[1]` absorbe les doublons. **À vérifier au
premier essai avec l'IO-Tool** (§12, question B) : si ce n'est pas le cas,
un message reçu pendant une coupure de Fourmy serait perdu, et il faudra
demander à agrirouter comment relire le flux.

## 6. File d'envoi (EX-AR-6, 7)

```
POST /prescriptions/:id/send
  ├─ contrôle des destinataires (en direct, comme aujourd'hui)
  ├─ fichier construit, figé sur le volume (sha256)
  ├─ prescription_sends (status='queued') + agrirouter_outbox (state='queued')
  ├─ tentative immédiate (dans la requête, 20 s au plus)
  │    ├─ 200       → sent ; prescription_sends.status='sent'
  │    ├─ 429 / 5xx / pas de réponse / agrirouter injoignable
  │    │            → reste queued, next_attempt_at, la réponse dit « En attente »
  │    ├─ 400 à plusieurs destinataires → partial (livraison peut-être partielle)
  │    └─ autre 4xx → failed, avec le motif
  └─ réponse : état de l'envoi
Worker, tâche « outbox » à chaque tick :
  réclame les lignes dues (FOR UPDATE SKIP LOCKED, locked_until),
  même règle de réponse ; attente 1, 2, 5, 15, 30, 60 min, puis toutes les heures ;
  échec définitif après 24 h → failed (« agrirouter injoignable depuis 24 h »).
```

- **Jamais de renvoi après une réponse 200.** L'état `sending` est écrit
  avant l'appel. Une ligne restée `sending` (worker tué pendant l'appel)
  repart en `queued` à l'expiration de `locked_until`. C'est le cas « sans
  réponse », que la documentation autorise à réessayer.
- **Ferme déconnectée** pendant l'attente : la ligne passe en `failed`
  (« Ferme déconnectée d'agrirouter »).
- **Historique** : il affiche « En attente » (et la prochaine tentative),
  « Envoyé », « Partiel » et « Refusé ».
- **Nom de fichier** : toujours fourni,
  `fourmy-<parcelle>-<date>.zip`.
- **Réponse 400 sur un envoi partiel** : rien n'est renvoyé
  automatiquement. Le motif est affiché, avec les destinataires concernés.

## 7. Machines virtuelles

Retirées le 2026-11-16 (§2). La numérotation des sections est gardée.

## 8. Synchro des parcelles (AgmaSync, EX-AR-8 à 10)

### Ce que la spécification impose, même dans un seul sens

- L'utilisateur choisit dans agrirouter les types (exploitation, parcelles,
  contours) pour le point de terminaison de Fourmy. Fourmy l'apprend par
  `ROUTE_CHANGED` sur `/masterdata/events`.
- **Chargement initial**, piloté par agrirouter :
  1. `LOADING_FROM_AGRIROUTER` : agrirouter envoie ce qu'il connaît déjà
     (frames `MASTERDATA_CHANGED`) ;
  2. `RECONCILING` : Fourmy rapproche, puis passe le point de terminaison en
     `LOADING_TO_AGRIROUTER` en fournissant les `id_mappings` ;
  3. Fourmy pousse ce qu'agrirouter n'avait pas, puis passe en `COMPLETED`.
- Toute écriture d'un objet existant porte la révision dont elle part
  (`x-agrirouter-base-revision`). Une révision dépassée est refusée par 412,
  avec la révision courante.
- `RESET_MASTERDATA_SYNC` efface tout : Fourmy oublie ses liens dans ce
  tenant.

### Choix de Fourmy

- **Rapprochement minimal** : on ne lie un objet canonique qu'à un objet
  Fourmy de même `referenceId`, c'est-à-dire déjà poussé par Fourmy (cas
  d'un rechargement). On ne rapproche ni par nom ni par géométrie. Les objets
  d'autres logiciels restent à eux. Fourmy pousse les siens à côté, sans les
  fusionner (décision 5).
- **Conflit** (un `id_mapping` rejeté) : `awaiting_user` est levé, et la
  carte agrirouter de la page Intégrations l'affiche avec le lien vers
  agrirouter (EX-AR-9). Le chargement continue avec le reste.
- **Fourmy gagne** : sur 412, on reprend la révision courante et on réécrit
  le contenu Fourmy, une seule fois. Les `MASTERDATA_CHANGED` venus d'autres
  logiciels hors chargement initial sont lus et ignorés. On garde seulement
  la nouvelle révision s'il s'agit d'un objet lié, pour la prochaine
  écriture.
- **Périmètre** : les parcelles ayant une version valide aujourd'hui
  (`land_parcel_versions.valid @> now()`). Une parcelle qui n'en a plus est
  désactivée (`POST …/deactivation`). La question de la campagne suivante
  reste ouverte (§12, question C).
- **Correspondance** :
  - `farm:<farmId>` → `FarmContent` : nom, adresse du site siège ;
  - `field:<landParcelId>` → `FieldContent` : nom, `arableArea` (ha),
    `_agmasync_farmRef` ;
  - `boundary:<landParcelId>` → `FieldBoundaryContent` : `boundary`
    (MultiPolygon de la version courante), `_agmasync_fieldRef`.
  - Le format exact des références et de la géométrie est à confirmer sur
    les schémas au moment du lot.
- **Régime permanent** : tâche « parcelles » du worker toutes les 5 min,
  pour chaque ferme `COMPLETED`.
  - Elle calcule `content_hash` de chaque objet.
  - Elle pousse ce qui a changé, crée ce qui manque et désactive ce qui a
    disparu.
  - Elle n'a besoin ni de déclencheur ni d'`outbox_events` (qui ne sont pas
    consommés aujourd'hui) : le hachage suffit à quelques centaines de
    parcelles.
- **Activer ou couper (EX-AR-10)** : l'interrupteur de la carte refait le
  `PUT` de la ferme, avec ou sans le bloc `masterdata`. Couper ne supprime
  rien chez agrirouter.
- **Position du flux** : `agrirouter_streams('masterdata')`, écrite après
  l'application de chaque frame.

## 9. Lecture des fichiers reçus (EX-AR-16 à 19)

Tâche « inbox » du worker, à chaque tick. Elle réclame les lignes
`received` et lit le fichier selon son type :

| Type | Lecture | Résultat |
|---|---|---|
| `taskdata:zip` | `parseTaskData(zip)` (nouveau, `packages/isoxml`) : `TSK`, `TIM`, `PFD`/`PLN`, `PDT`, `DLV`, `DVC`, et `TLG` (XML + binaire) | une proposition par tâche réalisée (§9.1) |
| `time_log:protobuf` | décodage EFDI (§9.2) → positions et valeurs | positions du matériel, donc un parcours |
| `device_description:protobuf` | décodage EFDI → `DVC`, `DET`, `DPD` | propositions sur la fiche du matériel (§9.3) |

Ensuite :
- état `proposed`, `unreadable` (avec le motif) ou `ignored` (tâche non
  réalisée, Device Description identique) ;
- **confirmation** : `POST /confirmations` de tous les `message_ids` du
  fichier, puis `confirmed_at`. En cas d'échec, la confirmation est retentée
  au tick suivant, sans relire le fichier.

### 9.1 Tâche ISO-XML réalisée → proposition d'intervention

- **Pas de nouveau statut d'intervention.** Comme pour les parcours, la
  proposition est un brouillon calculé et rangé dans `inbox.parsed` : date
  de début et de fin, parcelle, matériel, produits, doses, surface.
- **« Créer l'intervention »** ouvre le formulaire pré-rempli, en
  réutilisant le chemin du brouillon des parcours (`draftFromSessions` et le
  formulaire). L'enregistrement lie l'intervention (`inbox.intervention_id`,
  `state='validated'`).
- **« Écarter »** passe la ligne à `dismissed`.
- **Parcelle** :
  - contour `PFD`/`PLN` de la tâche, s'il existe ;
  - sinon positions du `TLG` ;
  - puis intersection avec `land_parcel_versions` à la date de la tâche,
    même requête que `track-sessions.ts`.
- **Doses** : totaux des `DLV` par produit (`PDT`), selon les DDI de
  quantité appliquée et de surface. La table des DDI retenus est fixée au
  lot AR4.
- **Matériel** : `DVC` rapproché par numéro de série
  (`equipments.serial_number`), puis par nom. Sans correspondance, la
  proposition est faite sans matériel.
- **Rapprochement avec une carte de Fourmy** : à l'envoi, la tâche porte la
  désignation `Fourmy <id court de la carte>` (attribut `TSK@B`). Elle est
  aussi gardée dans `prescription_sends.task_ref`. Une tâche revenue avec
  cette désignation remplit `inbox.prescription_id` et le formulaire
  rattache la carte (point ouvert 46, en partie).

### 9.2 TimeLog EFDI

- **Définitions protobuf** EFDI publiées par DKE. On ajoute `protobufjs`
  à `packages/agrirouter` ; les `.proto` sont copiés dans le dépôt, avec leur
  licence (§12, question D).
- **Les positions entrent dans le pipeline des parcours** : nouvelle source
  `agrirouter` à côté de `traccar` (`tracker_bindings.source`), rattachée
  au matériel rapproché. Les sessions, la couverture, les
  parcelles et le brouillon d'intervention sont alors ceux qui existent
  déjà.
- **Valeurs de dose** et état de travail : utilisés s'ils sont présents
  (DDI à fixer avec 9.1).
- **TimeLog reçu sur le point de terminaison de la ferme** : la machine est
  rapprochée par le `teamset_context_id` et la Device Description
  correspondante. Sans correspondance, le fichier est proposé sans matériel.

### 9.3 Device Description

On compare la largeur de travail (`avatar.workingWidthM`) et le nombre de
sections à la fiche. Il n'y a pas de colonne « sections » aujourd'hui : on
l'ajoute dans `equipments.technical`. Une valeur différente donne une
proposition « Mettre à jour » sur la fiche ; aucune donnée saisie n'est
écrasée.

## 10. Interface web

- **Intégrations → carte agrirouter** :
  - états « Connectée » et « Déconnectée le … (révoquée dans agrirouter) »
    avec « Reconnecter » ;
  - destinataires ;
  - interrupteur « Synchroniser les parcelles » et état du chargement
    (« En attente du choix dans agrirouter », « Chargement », « À
    résoudre dans agrirouter », « À jour ») ;
  - lien « Boîte de réception (n) ».
- **Boîte de réception** (`/f/:farmId/agrirouter/inbox`, responsable) :
  liste avec date, expéditeur, matériel, type et état. Actions « Créer
  l'intervention », « Écarter », « Télécharger le fichier ».
- **Fiche du matériel** : propositions de la Device Description.
- **Carte de modulation** : historique avec « En attente », « Partiel » et
  la prochaine tentative.
- **Tableau de bord** : rien de neuf. Un compteur de fichiers à traiter
  pourra suivre.

## 11. Découpage en lots

| Lot | Contenu | Exigences | Permet |
|---|---|---|---|
| **AR1** Conformité et Deep URL ✅ 16/11 | identifiant externe, nom, capacités et abonnements complets, `allow_delete_by_user`, 409 de la révocation, état `disconnected`, page `fourmy.org/agrirouter`, `/agrirouter/start`, `RequireAuth` avec `next` | 1 à 5 | **premier essai réel** : connexion des deux façons, envoi à l'IO-Tool |
| **AR2** Écouteur et boîte de réception brute ✅ 16/11 | migration 0054, volume, `client.events()`, verrou consultatif, événements de connexion, réception rangée et confirmée sans lecture, page de la boîte de réception | 3, 15, 16, 19 | révocation et suppression vues ; fichiers de l'IO-Tool reçus, compteur à 0 |
| **AR3** File d'envoi ✅ 16/11 | `agrirouter_outbox`, tentative immédiate puis reprise, états, historique | 6, 7 | test de coupure de la revue |
| **AR4** TaskData reçue ✅ 16/11 | `parseTaskData`, proposition, rapprochement de la carte envoyée (`TSK@B`) | 17 | retour des tâches réalisées |
| **AR5** EFDI ✅ 16/11 | protobuf, TimeLog → positions → parcours, Device Description → fiche | 17, 18 | télémétrie des machines |
| **AR7** Parcelles | second flux, chargement initial, liens, tâche « parcelles » | 8 à 10 | parcelles sur les consoles |
| **AR8** Revue | deux fermes de démonstration, testeurs DKE invités, déroulé écrit, `docs/modulation.md` et nouveau `docs/agrirouter.md` | 20 | demande de revue |

AR6 (machines virtuelles) est retiré le 16/11 ; les numéros sont gardés.

**AR1, réalisé le 16/11** : en plus de la conception, la synchro horaire
constate déjà une autorisation retirée (`GET /tenants`) ou un point de
terminaison supprimé, sans attendre l'écouteur d'AR2. Ce contrôle attend 10 min
après la connexion, le temps qu'agrirouter propage le point de terminaison.
Le site redirige désormais en relatif (`absolute_redirect off`) :
`fourmy.org/agrirouter` menait à `http://…/agrirouter/`.

**AR2, réalisé le 16/11**, avec deux écarts à la conception :
- pas de table `agrirouter_endpoints` : sans machines virtuelles, la ferme
  n'a qu'un point de terminaison, déjà dans `integrations.settings`
  (`endpointId`, `externalId`, et la nouvelle empreinte `tenantHash`). Les
  fonctions de résolution lisent ces réglages ;
- pas de table `agrirouter_streams` : `/events` n'a pas de `Last-Event-ID`.
  Elle viendra avec le flux des parcelles (AR7).

Un fichier est confirmé dès qu'il est rangé sur le volume, sans attendre sa
lecture (AR4, AR5), qui se fera depuis le volume. La question B (redélivraison
après une coupure) reste à vérifier avec l'IO-Tool.

**AR3, réalisé le 16/11.** Écarts et précisions :
- un jeton refusé (identifiants révoqués, scénario de coupure de la revue)
  et un 401 mettent aussi l'envoi en attente ;
- si agrirouter ne répond pas au moment de l'envoi, les destinataires sont
  contrôlés d'après la dernière synchro, pour pouvoir mettre en file ;
- la purge des fichiers envoyés (90 jours) n'est pas faite.

**AR4, réalisé le 16/11.** Écarts et précisions :
- pas d'accès à l'IO-Tool (compte à demander au support) : le lecteur est
  essayé sur un TaskData réel public (console Topcon, `isoxml-js`, Apache
  2.0) et sur des tâches synthétiques. Les doses et la surface (DDI 2, 7, 12,
  116) restent à confirmer sur de vrais fichiers ;
- lecteur écrit pour Fourmy (zip, XML réduit, TLG binaire), sans dépendance ;
- la carte d'origine est reconnue par la fin de la désignation de la tâche
  (` F<8 caractères>`), sans colonne `task_ref` ;
- heures sans fuseau lues à l'heure de Paris (pas de fuseau par ferme) ;
- les produits et doses ne sont pas mis dans les intrants : ils s'affichent
  dans le bandeau, à saisir ;
- un fichier à plusieurs tâches passe « Validé » dès qu'une intervention en
  est tirée.

**AR5, réalisé le 16/11.** Écarts et précisions :
- définitions EFDI : `efdi.proto` de `DKE-Data/agrirouter-tmt-protobuf-definitions`
  (Apache 2.0, question D tranchée). Décodeur écrit pour Fourmy, sans
  `protobufjs` ; seuls les champs utiles sont lus ;
- essayé sur des messages fabriqués par l'encodeur de Fourmy : cohérent
  avec `efdi.proto`, à confirmer sur des messages réels (IO-Tool) ;
- le matériel d'un journal vient de la description de machine du même
  attelage (`teamset_context_id`), attendue une heure ; sinon « Sans suite » ;
- un matériel déjà suivi par Traccar n'est pas doublé (un seul rattachement
  de boîtier à la fois par matériel) ;
- la largeur de travail se reporte sur l'avatar de la fiche ; le nombre de
  sections est seulement affiché (pas de champ « sections » sur la fiche) ;
- les journaux sans matériel reconnu ne donnent pas de proposition
  d'intervention isolée : le flux de télémétrie passe par les parcours.

Ordre : AR1, puis AR2 et AR3 (indépendants), puis AR4 et AR5, puis AR7
(le plus incertain), puis AR8. La revue ne peut avoir lieu qu'après AR7,
puisque toutes les capacités sont déclarées.

**Tests** : le faux agrirouter de `modulation.integration.test.ts` devient
un module partagé (`apps/api/test/support/fake-agrirouter.ts`).
- Il gagne un flux SSE scriptable (frames, coupure, redélivraison),
  `/confirmations`, `/masterdata/*` avec révisions et 412, et les erreurs 409
  et 429.
- Les tests d'intégration suivent les critères d'acceptation 1 à 10 du
  document de besoins.
- `parseTaskData` est testé sur des TaskData réelles. Échantillons à
  demander à l'IO-Tool et à des consoles connues (§12, question E).

## 12. Questions à trancher

- ~~**A. Utilité des machines virtuelles.**~~ Tranchée le 2026-11-16 :
  retirées du périmètre (§2).
- **B. Redélivraison de `/events`** après une coupure : à vérifier avec
  l'IO-Tool dès AR2, sinon à demander au support.
- **C. Campagne poussée** (question 3 des besoins) : parcelles valides
  aujourd'hui seulement, ou aussi celles de la campagne suivante ?
- **D. Définitions protobuf EFDI** : dépôt et licence à confirmer avant AR5.
- **E. Échantillons TaskData et TimeLog réels** pour les tests : l'IO-Tool en
  fournit-il ? Sinon, demander à la ferme pilote une exportation de sa
  console.
- **F. Rétention des fichiers reçus** : garder tout (proposé) ou purger
  après validation ?
