# Déploiement

Fourmy se déploie avec `docker/compose.deploy.yml` sur n'importe quel hôte
Docker. Environnements prévus :

| Environnement | Où | Domaine |
|---|---|---|
| Dev / tests pilotes | Dokploy `seconde-nature.cloud`, serveur **KMV 8 – Hostinger**, projet « Fourmy », environnement « dev » | `dev.fourmy.org` |
| Production | Dokploy de l'infrastructure **Eyona** | à définir |

La configuration ne dépend pas du serveur : tout passe par des variables
d'environnement. Rejouer le même compose ailleurs suffit.

Le dépôt `ekylibre/fourmy` est **privé** (noms des pilotes et contours
réels de leurs parcelles dans la documentation et les fixtures) ; l'ouvrir
demandera d'abord de les retirer. Dokploy y accède par l'application GitHub
« Dokploy-ekylibre-org » et redéploie à chaque push sur `main`.

## Services

| Service | Image | Rôle |
|---|---|---|
| `db` | `timescale/timescaledb-ha:pg17` | PostgreSQL + PostGIS + TimescaleDB, volume `fourmy_pgdata` |
| `api` | `Dockerfile`, cible `api` | API Hono ; applique les migrations au démarrage |
| `worker` | même image, `node apps/api/dist/worker.js` | synchronise les intégrations des fermes (Traccar : chaque minute) |
| `web` | `Dockerfile`, cible `web` (nginx) | application React + relais `/api` → `api` |
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
| `FOURMY_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_FROM` | non | envoi du formulaire de contact de fourmy.org vers `FOURMY_CONTACT_TO` (contact@fourmy.org) ; sans eux, le formulaire répond « indisponible » |
| `SITE_IMAGE` | non | image du site, `ghcr.io/ekylibre/fourmy-site:main` par défaut (prod : une étiquette `sha-…` précise) |
| `EKYLIBRE_SOURCES_URL` | non | serveur des bases Ekylibre restaurées pour les imports depuis l'interface |

Aucun secret dans le dépôt : ils sont générés directement dans Dokploy.

## Premier démarrage

1. Créer le projet et un service **Compose** pointant sur le dépôt
   (`docker/compose.deploy.yml`), branche `main`.
2. Renseigner les variables ci-dessus, déployer.
3. Domaine sur le service `web`, port 80, HTTPS (Let's Encrypt). L'enregistrement
   DNS du domaine pointe vers le serveur.
4. Créer les comptes (mot de passe sur l'entrée standard, jamais en argument) :
   `printf '%s' "$MOT_DE_PASSE" | docker compose exec -T api node apps/api/dist/cli/create-user.js --email … --name …`
5. Rattacher chaque compte à sa ferme : page **Équipe** (responsable), ou au
   premier démarrage par l'administrateur en base.

## Fermes

Les fermes viennent des exports Ekylibre (lecture seule, jamais l'instance de
production) via `packages/migrator-ekylibre`. Les accès aux services externes
(Traccar…) ne sont **pas** des variables du serveur : chaque ferme les saisit
dans **Intégrations** (responsable). Ils y sont chiffrés avec
`FOURMY_SECRETS_KEY`, testés avant d'être enregistrés et jamais réaffichés.

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
- Les adresses intégrées au site viennent des variables GitHub
  `FOURMY_PUBLIC_APP_URL` et `FOURMY_PUBLIC_SITE_URL` (dev.fourmy.org et
  fourmy.org par défaut). La prod (Eyona) aura sa propre image ou ses propres
  variables.
- Un historique superficiel fait échouer la construction avec un message
  explicite : rien de faux n'est publié.

## Sauvegardes (à mettre en place)

Base : sauvegarde Dokploy du volume `fourmy_pgdata` ou `pg_dump` planifié
vers un stockage externe. Garder `FOURMY_SECRETS_KEY` et `BETTER_AUTH_SECRET`
avec les sauvegardes (coffre), sinon une restauration perd les intégrations.
