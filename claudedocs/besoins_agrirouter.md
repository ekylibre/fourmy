# Intégration agrirouter : expression des besoins

Brainstorm du 2026-11-16, à la reprise du chantier : le compte développeur
agrirouter est obtenu. Document de **besoins**. L'architecture (worker SSE,
tables, découpage en lots) est à concevoir ensuite (`/sc:design`), puis à
planifier (`/sc:workflow`).

Sources lues le 2026-11-16 :
- spécification G4 : <https://agrirouter.com/api/openapi.yaml> (elle a gagné
  depuis le 11/11 `DELETE /authorizations`, `/compatible-applications` et
  toute la partie *Masterdata* / AgmaSync) ;
- documentation développeur : *Setup Application*, *Environments*,
  *Your First Endpoint*, *Cloud Software*, *Implementation Review*
  (<https://agrirouter.com/en/docs>).

## 1. Constat

### Ce qui existe (lot AD du 11/11, `docs/modulation.md`)

- **Client G4** (`packages/agrirouter`) : jeton `client_credentials`,
  adresse de consentement, tenants, points de terminaison, envoi, suppression
  du point de terminaison puis de l'autorisation. Il est conforme à la
  spécification du jour (type `cloud_software`, `DELETE /authorizations`
  après la suppression des points de terminaison).
- **Connexion d'une ferme** (responsable) : consentement, retour sur
  `/agrirouter/callback`, contrôle de l'état, création du point de
  terminaison `urn:fourmy:farm:<ferme>`, nommé « Fourmy <ferme> ».
- **Capacités** : envoi de `iso:11783:-10:taskdata:zip` et `shp:shape:zip`,
  aucun abonnement, aucune réception.
- **Envoi des cartes de modulation** aux destinataires routés, avec
  historique (« Envoyé » / « Refusé »). Un échec est affiché, rien n'est mis
  en file.
- **Testé contre une simulation seulement.** Variables du serveur prêtes
  (`AGRIROUTER_*`), vides partout.

### Ce que la documentation officielle change

1. **Production dès le développement.** QA est réservée à l'équipe
   agrirouter. On développe et on teste sur la production, avec l'IO-Tool
   comme correspondant. L'adresse de consentement QA « supposée » du 11/11 ne
   sert plus.
2. **Une version doit être au moins « Testing approved »** avant de pouvoir
   créer un point de terminaison. La soumission de la version à l'équipe
   agrirouter est donc sur le chemin critique, avant même le premier essai.
3. **Deep URL obligatoire** : l'adresse où arrive un agriculteur qui lance la
   connexion depuis agrirouter (Solution Finder). La revue exige un écran de
   confirmation avant de l'envoyer au consentement.
4. **Revue d'implémentation** (gratuite, en direct) : elle vérifie, en plus
   de l'envoi, le refus du consentement, la révocation et la suppression
   faites côté agrirouter, deux comptes Fourmy sur un même compte
   agrirouter, la coupure du connecteur et la reprise, le nom et l'identifiant
   externe des points de terminaison.
5. **Mise en ligne** : il faut un contrat signé avec l'opérateur. Il n'est pas
   nécessaire pour la revue, mais il est à lancer en parallèle.

## 2. Décisions (2026-11-16)

1. **Périmètre de la première version déclarée** : tout, en une seule revue.
   - Envoi des cartes (existant).
   - Synchro des parcelles (AgmaSync).
   - Réception des données des machines.
2. **Marque** : application « Fourmy », marque « Ekylibre ».
3. **Deep URL** : `https://fourmy.org/agrirouter`, une page du site public
   qui renvoie vers l'application. Elle ne bouge pas quand l'adresse de
   production sera décidée (#3).
4. **Un seul client OAuth pour commencer** : dev.fourmy.org, adresse de
   retour `https://dev.fourmy.org/agrirouter/callback`. Le client de
   production sera créé avec l'adresse de production.
5. **Parcelles** : Fourmy est la référence. Il pousse exploitation, parcelles
   et contours vers agrirouter. Ce qui arrive d'agrirouter n'est pas repris.
6. ~~**VCU** : au choix, matériel par matériel.~~ **Révisée le 2026-11-16 :
   pas de machine virtuelle.** Fourmy ne parle pas aux machines : une
   machine virtuelle ne ferait que recevoir ce qu'un autre logiciel lui
   adresse. À rouvrir si Fourmy envoie un jour des TimeLogs tirés de Traccar
   au nom d'un matériel (capacité d'envoi à déclarer dans une nouvelle
   version, nouvelle revue).
7. **Réception** : les données reçues d'une machine **proposent** une
   intervention réalisée (comme les parcours GPS), que l'utilisateur valide.

## 3. Création de l'application dans le portail (à faire maintenant)

À saisir dans *Developer > Applications > Create application* :

| Champ | Valeur |
|---|---|
| Application name | Fourmy |
| Brand | Ekylibre |
| Application type | Default application type |
| Support URL | `https://fourmy.org/contact` |
| Deep URL | `https://fourmy.org/agrirouter` (page à créer, voir EX-AR-4) |
| Logo | `packages/ui-lyvre/brand/fourmy-symbol.svg` (exporter en PNG carré si le portail refuse le SVG) |

**Version 1** (*Software versions > Create version*) :
- description de la version : « Fourmy envoie aux machines les cartes de
  modulation (ISO-XML, Shapefile) et les parcelles de la ferme ; il reçoit
  les tâches réalisées et les TimeLogs pour proposer les interventions
  réalisées. »
- capacités :

  | Type de message | Envoi | Réception |
  |---|---|---|
  | `iso:11783:-10:taskdata:zip` | ✅ | ✅ |
  | `shp:shape:zip` | ✅ | — |
  | `iso:11783:-10:time_log:protobuf` (EFDI TimeLog) | — | ✅ |
  | `iso:11783:-10:device_description:protobuf` (EFDI) | — | ✅ |

  `gps:info` est déprécié : on ne le déclare pas. Le portail dira si les
  parcelles (AgmaSync) se déclarent comme une capacité de la version ou
  seulement dans le point de terminaison (`masterdata`). **À vérifier en
  créant la version.**
- **Soumettre la version pour revue** dès qu'elle est remplie, sans attendre
  le code, pour obtenir « Testing approved ».

**Client OAuth** (*Technical details > Auth clients*) : nom
« dev.fourmy.org », adresse de retour
`https://dev.fourmy.org/agrirouter/callback`. Le secret n'est affiché
qu'une fois : télécharger le *credentials package* JSON tout de suite, mettre
les valeurs dans Dokploy, puis supprimer le fichier local.

**Variables de dev.fourmy.org** (API et worker) :
`AGRIROUTER_CLIENT_ID`, `AGRIROUTER_CLIENT_SECRET`,
`AGRIROUTER_APPLICATION_ID`, `AGRIROUTER_SOFTWARE_VERSION_ID`,
`AGRIROUTER_REDIRECT_URI`, `AGRIROUTER_ENVIRONMENT=production`.

En parallèle : écrire à support@agrirouter.com pour le contrat (formule de
participation) et pour annoncer la revue.

## 4. Exigences fonctionnelles

### Connexion et déconnexion

- **EX-AR-1 · Point de terminaison conforme à la revue.**
  - Identifiant externe au format recommandé :
    `urn:fourmy.org:fourmy:farm-<ferme>`. L'ancien format
    `urn:fourmy:farm:<ferme>` n'a jamais servi en réel, donc aucune reprise
    n'est nécessaire.
  - Nom reconnaissable par l'agriculteur : nom de la ferme, par exemple
    « Fourmy · GAEC du Moulin ».
  - Capacités et abonnements complets à chaque `PUT`, car le `PUT`
    remplace tout.
  - `allow_delete_by_user` : à fixer à la conception, avec la gestion de
    `ENDPOINT_DELETED` (EX-AR-3).
- **EX-AR-2 · Plusieurs fermes Fourmy dans un même compte agrirouter**
  (combinaison B→X de la revue) : chaque ferme a son propre point de
  terminaison. Une ferme Fourmy reliée à deux comptes agrirouter (A→Y,
  facultatif) est hors périmètre.
- **EX-AR-3 · Refléter ce qui se passe côté agrirouter.**
  - Révocation de l'autorisation (`AUTHORIZATION_REVOKED`) ou suppression du
    point de terminaison (`ENDPOINT_DELETED`) : l'intégration passe à
    « Déconnectée » dans Fourmy, avec la date et un bouton « Reconnecter ».
  - Une nouvelle connexion après une déconnexion recrée un point de
    terminaison neuf.
- **EX-AR-4 · Connexion lancée depuis agrirouter (Deep URL).**
  - `fourmy.org/agrirouter` explique en une phrase ce que fait la connexion,
    puis renvoie vers l'application.
  - L'application demande de se connecter si besoin, puis de choisir la
    ferme si l'utilisateur est responsable de plusieurs fermes.
  - Un écran de confirmation s'affiche : « Connecter la ferme X à
    agrirouter ? ». Ensuite, le parcours reprend le consentement habituel.
  - Un utilisateur qui n'est responsable d'aucune ferme voit un message
    clair.
- **EX-AR-5 · Refus du consentement** : il est déjà géré. La revue le
  vérifie, donc l'essai réel doit le couvrir.

### Envoi

- **EX-AR-6 · Envoi des cartes** (existant), à compléter :
  - un nom de fichier est toujours fourni ;
  - un envoi part toujours du point de terminaison de la ferme.
- **EX-AR-7 · Coupure du connecteur.** Pendant une coupure (agrirouter
  injoignable, identifiants révoqués), un envoi est **mis en file**, avec
  l'état « En attente » visible dans l'historique. Il part au retour de la
  connexion.
  - Il n'est jamais renvoyé après une réponse 200, car agrirouter ne
    dédoublonne pas.
  - Une réponse 400 sur un envoi à plusieurs destinataires est traitée comme
    une livraison possiblement partielle.

### Parcelles (AgmaSync)

- **EX-AR-8 · Pousser l'exploitation, les parcelles et leurs contours** vers
  agrirouter, pour la campagne en cours.
  - À la connexion : chargement initial.
  - Ensuite : à chaque création, modification ou fin de parcelle.
  - Une parcelle qui disparaît est désactivée, pas supprimée.
- **EX-AR-9 · Rien n'est repris d'agrirouter.**
  - Si le chargement initial signale un conflit (`awaiting_user`), Fourmy
    l'affiche sur la carte agrirouter de la page Intégrations, avec un lien
    pour le résoudre côté agrirouter.
  - Les changements faits ailleurs sont ignorés, sans erreur.
- **EX-AR-10 · Le responsable choisit d'activer ou non la synchro des
  parcelles** sur la carte agrirouter. Elle est activée par défaut à la
  connexion.

### Machines (VCU) : hors périmètre

EX-AR-11 à 14 (une machine virtuelle par matériel) sont **retirés** le
2026-11-16 (décision 6 révisée). Leurs numéros ne sont pas réattribués.

### Réception

- **EX-AR-15 · Écoute permanente.** Le worker garde ouvert le flux
  d'événements, télécharge les fichiers reçus et **confirme** chaque message
  une fois traité.
  - Un message non traité n'est pas confirmé.
  - Après une coupure, le flux reprend sans perte et sans doublon.
- **EX-AR-16 · Boîte de réception** dans Fourmy (responsable) : liste des
  fichiers reçus avec date, expéditeur, matériel, type et état (« Proposé »,
  « Validé », « Écarté », « Illisible »).
- **EX-AR-17 · Tâche ISO-XML réalisée ou TimeLog → proposition
  d'intervention**, sur le modèle des parcours GPS :
  - parcelle trouvée d'après la géométrie ;
  - dates de début et de fin ;
  - matériel ;
  - produits et doses réellement appliquées quand le fichier les porte ;
  - surface travaillée.

  L'utilisateur valide, corrige ou écarte. Une tâche envoyée par Fourmy
  (carte de modulation) et revenue réalisée est rapprochée de la carte
  d'origine.
- **EX-AR-18 · Device Description** : elle complète la fiche du matériel
  (largeur de travail, sections) sans écraser une donnée déjà saisie, et
  propose la correction si elle diffère.
- **EX-AR-19 · Un fichier illisible** est gardé, marqué « Illisible » avec le
  motif, et confirmé quand même, pour ne pas bloquer le flux.

### Revue

- **EX-AR-20 · Préparer la revue.**
  - Deux comptes Fourmy de démonstration (deux fermes de test, pas la ferme
    pilote), reliés à agrirouter.
  - Un IO-Tool relié dans l'un des comptes agrirouter.
  - `admin@dke-data.com` et `admin+1@dke-data.com` invités comme testeurs.
  - Un déroulé écrit, scénario par scénario, qui suit la liste de contrôle de
    la revue.

## 5. Exigences non fonctionnelles

- **Secrets** : identifiants de l'application dans les variables du serveur
  (décision du 11/11) ; tenant chiffré par ferme. Le *credentials package* ne
  reste jamais sur le disque ni dans Git.
- **Isolation** : chaque message reçu est rangé dans la seule ferme dont le
  point de terminaison est destinataire (RLS).
- **Robustesse** : attente croissante sur 429 et 5xx, aucun renvoi après une
  réponse 200, file d'envoi persistante qui survit au redémarrage du worker.
- **Un seul écouteur** du flux d'événements, même si plusieurs workers
  tournent.
- **Traçabilité** : chaque envoi, réception, confirmation et changement
  d'état de connexion est journalisé, sans contenu de fichier.
- **Tests** : la simulation actuelle est étendue (flux d'événements,
  AgmaSync). Un essai réel est fait sur la production avec l'IO-Tool
  avant la revue.

## 6. Critères d'acceptation (essai réel, avant la revue)

1. La version 1 est « Testing approved » et le client OAuth de
   dev.fourmy.org est configuré.
2. Connexion lancée depuis Fourmy : le point de terminaison apparaît dans
   agrirouter avec le nom de la ferme, le logo et la marque Ekylibre. En cas
   de refus, un message s'affiche dans Fourmy.
3. Connexion lancée depuis `fourmy.org/agrirouter` : l'écran de
   confirmation s'affiche, puis le même résultat qu'au point 2.
4. Deux fermes Fourmy de test sont reliées au même compte agrirouter, chacune
   avec son point de terminaison.
5. Une carte de modulation est envoyée à l'IO-Tool et elle arrive. Avec des
   identifiants révoqués, elle passe « En attente », puis arrive après leur
   rétablissement.
6. Les parcelles de la ferme de test apparaissent dans agrirouter.
7. ~~Machines virtuelles~~ : hors périmètre (décision 6 révisée).
8. Une tâche ISO-XML réalisée et un TimeLog envoyés depuis l'IO-Tool arrivent
   dans la boîte de réception. Ils proposent une intervention, et le compteur
   du point de terminaison revient à 0 dans agrirouter.
9. Pendant une coupure, les messages restent non confirmés (compteur non
   nul). Ils sont traités et confirmés au retour de la connexion.
10. Une révocation et une suppression faites côté agrirouter font passer la
    ferme à « Déconnectée ». Une reconnexion crée un point de terminaison
    neuf.

## 7. Questions ouvertes

1. **AgmaSync dans la version** : le catalogue des capacités du portail
   (vu le 16/11) n'a pas d'entrée pour les parcelles. Elles passent donc
   sans doute par le seul champ `masterdata` du point de terminaison. À
   confirmer avec support@agrirouter.com, en même temps que la demande de
   revue.
2. **`allow_delete_by_user`** : autoriser l'agriculteur à supprimer le point
   de terminaison et les machines depuis agrirouter (Fourmy suit alors
   `ENDPOINT_DELETED`), ou renvoyer vers Fourmy par `connections_uri` ?
3. **Campagne poussée** : seulement les parcelles de la campagne en cours, ou
   aussi la suivante dès qu'elle existe (semis d'automne) ?
4. **Lecture des TimeLogs EFDI** (protobuf) : quelle bibliothèque, ou un
   décodeur écrit pour Fourmy ? Les données utiles sont à cadrer au design
   (DDI de dose, surface, état de travail).
5. **Contrat** : quelle formule de participation, et qui signe pour
   Ekylibre ?
6. **Comptes de démonstration pour la revue** : deux fermes fictives sur
   dev.fourmy.org. Peut-on les montrer à d'autres partenaires, comme le
   propose agrirouter ?
7. **Page `fourmy.org/agrirouter`** : la publier dès maintenant, ou au
   moment de la mise en ligne publique ? La revue l'exige dès la session.

## 8. Effets sur les points ouverts

- **Point 55 / #20** (agrirouter en conditions réelles) : il devient ce
  chantier.
- **Point 57** (réception agrirouter, P3) : il entre dans le périmètre.
- **Point 46** (lier une carte de modulation à l'intervention qui
  l'applique) : il est couvert en partie par EX-AR-17.
- `docs/modulation.md` « Limites et suite » : la phrase sur l'adresse QA
  supposée est à retirer, puisque le développement se fait sur la
  production.
