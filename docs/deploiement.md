# Déploiement

Fourmy se déploie avec `docker/compose.deploy.yml` sur n'importe quel hôte
Docker. Environnements prévus :

| Environnement | Où | Domaine |
|---|---|---|
| Dev / tests pilotes | Dokploy `seconde-nature.cloud`, serveur **KMV 8 – Hostinger**, projet « Fourmy », environnement « dev » | `dev.fourmy.org` |
| Production | Dokploy de l'infrastructure **Eyona** | à définir |

La configuration ne dépend pas du serveur : tout passe par des variables
d'environnement. Rejouer le même compose ailleurs suffit.

Le dépôt `ekylibre/fourmy` est **public** depuis novembre 2026 (la page
Installer de fourmy.org donne son `git clone`). Dokploy y accède par
l'application GitHub « Dokploy-ekylibre-org » et redéploie à chaque push sur
`main`.

## Services

| Service | Image | Rôle |
|---|---|---|
| `db` | `timescale/timescaledb-ha:pg17` | PostgreSQL + PostGIS + TimescaleDB, volume `fourmy_pgdata` |
| `api` | `Dockerfile`, cible `api` | API Hono ; applique les migrations au démarrage ; relaie les tuiles IGN (fonds de carte, relief et bâtiments de la 3D) et les garde dans le volume `fourmy_ign_cache` ; sert les fichiers reçus d'agrirouter (volume `fourmy_agrirouter_files`) |
| `worker` | même image, `node apps/api/dist/worker.js` | synchronise les intégrations des fermes (Traccar : chaque minute ; stations Weenat et Sencrop : chaque heure), les parcours GPS (toutes les 5 minutes), le référentiel phyto Lexicon (chaque jour), l'eau autour des fermes (BD TOPO, tous les 30 jours), l'IFT et la météo des interventions réalisées, les heures estimées des matériels depuis Traccar (toutes les 15 minutes) les alertes d'entretien par e-mail (au plus une fois par heure), le préchargement des tuiles IGN autour des fermes (volume `fourmy_ign_cache`, partagé avec `api`) et le quota de ce cache (chaque jour) ; écoute en permanence les événements agrirouter (un seul worker à la fois, verrou en base), range les fichiers reçus dans le volume `fourmy_agrirouter_files` et les confirme à agrirouter |
| `web` | `Dockerfile`, cible `web` (nginx) | application React + relais `/api` → `api` ; service worker `/sw.js` (copie hors ligne des fermes), servi sans cache ; relais `/version.json` → `site` (version affichée en pied de menu) |
| `site` | `ghcr.io/ekylibre/fourmy-site:main`, construite par la CI depuis `docker/site.Dockerfile` (nginx) | site public fourmy.org ; relaie seulement `/api/public/` (formulaire de contact) ; `www` → apex |

Sont exposés **`web`** (dev.fourmy.org, l'application) et **`site`**
(fourmy.org et www.fourmy.org) — domaines et HTTPS par Dokploy/Traefik. Le web et
l'API partagent la même origine : cookies de session sans CORS.

## Variables (Dokploy → Environment)

| Variable | Obligatoire | Contenu |
|---|---|---|
| `PUBLIC_URL` | oui | `https://dev.fourmy.org` — URL publique (sessions, origine web de confiance) |
| `POSTGRES_PASSWORD` | oui | mot de passe de la base (`openssl rand -hex 24`) |
| `BETTER_AUTH_SECRET` | oui | signe les sessions (`openssl rand -base64 48`) ; le changer déconnecte tout le monde |
| `FOURMY_SECRETS_KEY` | oui | chiffre les secrets d'intégration (`openssl rand -base64 32`) ; **la perdre rend les jetons illisibles** (à ressaisir) — la sauvegarder hors du serveur |
| `FOURMY_MOBILE_ORIGINS` | non | `zeromobile://` par défaut (application mobile) |
| `FOURMY_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_FROM` | non | envoi du formulaire de contact de fourmy.org vers `FOURMY_CONTACT_TO` (contact@fourmy.org), et des alertes d'entretien aux membres choisis (page Entretien) ; sans eux, le formulaire répond « indisponible » et les alertes attendent (rien n'est marqué envoyé) |
| `SITE_IMAGE` | non | image du site, `ghcr.io/ekylibre/fourmy-site:main` par défaut (prod : une étiquette `sha-…` précise) |
| `FOURMY_LEXICON_PACKAGES_URL` | non | serveur des paquets Lexicon (référentiel phyto, taxonomie, productions de référence et images des activités), `https://lexicon-packages.osfarm.org` par défaut ; `off` pour ne pas synchroniser (`docs/phyto.md`) |
| `FOURMY_LEXICON_API_KEY` | non | clé d'adhérent OSFarm (`lex_…`, portée `bundle:fourmy`) : le worker synchronise alors le bundle `https://lexicon.osfarm.org/bundles/fourmy`, qui ajoute le dictionnaire AgroEDI (libellés et cultures des imports DAPLOS et Geofolia, [`imports.md`](imports.md)) ; sans elle, dépôt public, imports moins précis. Une clé par instance |
| — | — | Météo : Open-Meteo sans clé par défaut ; les clés OpenWeather et meteoblue se saisissent par ferme dans **Intégrations** (`docs/meteo.md`), pas en variable du serveur |
| `FOURMY_IFT_API_URL` | **en production** | API IFT du ministère (ouverte, sans compte). Par défaut la **préproduction** `https://ecoagri-pprd.api.agriculture.gouv.fr/ift/v5/api` (local, dev.fourmy.org) ; la production règle `https://ecoagri.api.agriculture.gouv.fr/ift/v5/api` |
| `AGRIROUTER_CLIENT_ID`, `AGRIROUTER_CLIENT_SECRET`, `AGRIROUTER_APPLICATION_ID`, `AGRIROUTER_SOFTWARE_VERSION_ID` | non | application Fourmy enregistrée chez agrirouter (cartes de modulation vers les machines, [`modulation.md`](modulation.md)) ; sans elles, la connexion agrirouter est désactivée. `AGRIROUTER_REDIRECT_URI` vaut `${PUBLIC_URL}/agrirouter/callback` par défaut et doit être déclarée telle quelle dans le client OAuth ; `AGRIROUTER_ENVIRONMENT` : `production` (défaut) ou `qa` |
| `FOURMY_OSRM_URL` | non | service OSRM auto-hébergé (profil tracteur) qui recale les déplacements du rejeu 3D sur la route ([`routage-osrm.md`](routage-osrm.md)) ; sans lui, la trace reste brute |
| `EKYLIBRE_SOURCES_URL` | non | serveur des bases Ekylibre restaurées pour les imports depuis l'interface |
| `FOURMY_IGN_CACHE_MAX_GB` | non | quota du cache des tuiles IGN, 20 Go par défaut (worker) ; au-delà, les tuiles les moins lues hors des zones des fermes sont supprimées d'abord |
| `FOURMY_IGN_PRELOAD_CONCURRENCY` | non | requêtes simultanées vers l'IGN pendant un préchargement, 8 par défaut (worker) |

Aucun secret dans le dépôt : ils sont générés directement dans Dokploy.

## Premier démarrage

1. Créer le projet et un service **Compose** pointant sur le dépôt
   (`docker/compose.deploy.yml`), branche `main`.
2. Renseigner les variables ci-dessus, déployer.
3. Domaine sur le service `web`, port 80, HTTPS (Let's Encrypt). L'enregistrement
   DNS du domaine pointe vers le serveur.
4. Créer les comptes (mot de passe sur l'entrée standard, jamais en argument) :
   `printf '%s' "$MOT_DE_PASSE" | docker compose exec -T api node apps/api/dist/cli/create-user.js --email … --name …`
5. Rattacher chaque compte à sa ferme : « Ma ferme », onglet **Équipe**
   (responsable), ou au premier démarrage par l'administrateur en base.

## Fermes

Les fermes viennent des exports Ekylibre (lecture seule, jamais l'instance de
production) via `packages/migrator-ekylibre`. Les accès aux services externes
(Traccar…) ne sont **pas** des variables du serveur : chaque ferme les saisit
dans **Intégrations** (responsable). Ils y sont chiffrés avec
`FOURMY_SECRETS_KEY`, testés avant d'être enregistrés et jamais réaffichés.

### Copier une ferme d'une base à une autre

Pour faire tester sur dev.fourmy.org une ferme préparée sur un poste,
`docker/exporter-ferme.sh` l'exporte en un fichier SQL. Les deux bases doivent
avoir les mêmes migrations, et le fichier vérifie ce point lui-même. Les
référentiels (Lexicon, E-Phy, BBCH, taxonomie) ne sont pas copiés : chaque
instance les a déjà.

```sh
docker/exporter-ferme.sh <farm_id> postgres://…/fourmy > ferme.sql
ssh <serveur> 'docker exec -i <conteneur db> sh -c "psql -X -v ON_ERROR_STOP=1 -U \$POSTGRES_USER -d \$POSTGRES_DB"' < ferme.sql
```

Le chargement se fait en une seule transaction : une ferme déjà présente ou
des migrations différentes n'écrivent rien. Ne sont pas copiés :
- les comptes et les adhésions : créer le compte du responsable (§ Premier
  démarrage), le rattacher, puis inviter les autres depuis « Ma ferme » →
  Équipe ;
- les intégrations, dont les accès sont chiffrés avec la clé de la source :
  les ressaisir dans « Intégrations » ;
- le journal d'audit, les événements sortants et les files agrirouter ;
- les fichiers déposés pour un import ([`imports.md`](imports.md)) : les
  imports et leur provenance sont copiés, pour qu'un fichier réimporté sur la
  cible ne crée pas de doublons, mais sans le fichier lui-même.

Le fichier contient des données personnelles. Il ne se commite pas, et il
faut le supprimer après le chargement.

## Vérification

Essai complet de `compose.deploy.yml` en local, en mode production
(2026-11-07) : migrations au démarrage, santé de l'API, application servie
par nginx, connexion à travers le relais (cookie `HttpOnly`), origine
étrangère refusée, inscription fermée, adresse Traccar non HTTPS refusée,
worker actif.

## Site public : version et nouveautés

La version et les nouveautés publiques sont calculées depuis l'historique Git
(`packages/release`). Dokploy clone le dépôt **sans historique** (vérifié au
premier déploiement, 2026-11-07) : l'image du site est donc construite par la
CI (job `site-image` de `.github/workflows/ci.yml`, sur `main`, après des tests
verts), publiée sur `ghcr.io/ekylibre/fourmy-site` (`main` et `sha-…`),
puis tirée par Dokploy (`pull_policy: always`).

- Le paquet GHCR est **public** : il ne contient que le site statique et sa
  configuration nginx, déjà publics. Aucun identifiant côté Dokploy.
- Après publication, la CI relance Dokploy via le secret GitHub
  `DOKPLOY_DEPLOY_WEBHOOK` (webhook du service Compose). Sans ce secret, le
  déploiement est à relancer à la main.
- **Version dans l'application** : l'image `web` est construite par Dokploy,
  sans historique. Elle lit donc la version sur le site : son nginx relaie
  `/version.json` vers le service `site` du même compose (nom résolu à la
  demande, par le DNS de Docker). Sans le site, nginx démarre quand même et
  l'application affiche « Version de développement ». Contrôle :
  `https://dev.fourmy.org/version.json` doit donner le même numéro que
  `https://fourmy.org/version.json` (0.113.0 vérifié le 2026-11-13).
- Les adresses intégrées au site viennent des variables GitHub
  `FOURMY_PUBLIC_APP_URL` et `FOURMY_PUBLIC_SITE_URL` (dev.fourmy.org et
  fourmy.org par défaut). La prod (Eyona) aura sa propre image ou ses propres
  variables.
- Un historique superficiel fait échouer la construction avec un message
  explicite : rien de faux n'est publié.

## Sauvegardes (à mettre en place)

Le volume `fourmy_ign_cache` n'a pas besoin de sauvegarde : il se reremplit
depuis l'IGN (un préchargement relancé retélécharge les fichiers absents).
Après sa perte, vider `ign_tiles` (`TRUNCATE ign_tiles`) pour que l'état
« en cache » affiché aux fermes redevienne juste.

Le volume `fourmy_agrirouter_files` **doit être sauvegardé** avec la base :
un fichier reçu est confirmé à agrirouter, qui ne le renvoie plus.

Base : sauvegarde Dokploy du volume `fourmy_pgdata` ou `pg_dump` planifié
vers un stockage externe. Garder `FOURMY_SECRETS_KEY` et `BETTER_AUTH_SECRET`
avec les sauvegardes (coffre), sinon une restauration perd les intégrations.
