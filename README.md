# Fourmy

**Le jumeau numérique de la ferme.** Fourmy est la réécriture complète
d'Ekylibre : productions, parcellaire, interventions, stocks, planification,
capteurs, traces GPS et matériels, dans un modèle daté qui permet de revoir la
ferme à n'importe quelle date, en 2D comme en 3D.

- **Lyvre** garde l'argent et le droit (achats, ventes, facturation,
  comptabilité, juridique) ; Fourmy garde le physique.
- **Aiffel** (aiffel.org) interrogera Fourmy par MCP.
- Des **plugins** tiers, open source ou privés, étendent Fourmy.

Licence : AGPL-3.0. Site du projet : fourmy.org. Présentation : ekylibre.com.

## Documentation

| Document | Contenu |
|---|---|
| [`docs/requirements.md`](docs/requirements.md) | Exigences v1, user stories, fermes pilotes, première tranche de 7 jours |
| [`docs/architecture.md`](docs/architecture.md) | Choix d'architecture (ADR), modèle de données, API, 3D, plugins, organisation multi-agent |
| [`docs/site-public-exigences.md`](docs/site-public-exigences.md) | Site public fourmy.org : exigences validées (présentation, roadmap, changelog automatique, contact, page ekylibre.com, logo) |
| [`docs/deploiement.md`](docs/deploiement.md) | Déploiement Docker / Dokploy : services, variables, premier démarrage (dev puis production Eyona) |
| [`docs/interventions.md`](docs/interventions.md) | Interventions et procédures simplifiées (validé ; étapes 1 à 3 réalisées) : 6 formes, catalogue, modèle, correspondance Ekylibre, impacts Fourmy et zero-mobile |
| [`docs/workflow.md`](docs/workflow.md) | Plan d'implémentation de la première tranche : jour 1 des fondations, tâches des 7 agents, recette |
| [`docs/phyto.md`](docs/phyto.md) · [`docs/meteo.md`](docs/meteo.md) | Contrôle réglementaire des traitements (E-Phy, ZNT, IFT, mélanges), registre au format réglementaire 2027 ; météo des interventions, stations Weenat et Sencrop |
| [`docs/teledetection.md`](docs/teledetection.md) | NDVI des parcelles (Sentinel-2, Copernicus), courbe et comparaison aux années précédentes, images sur la carte et le plan 3D |
| [`docs/jumeau-3d.md`](docs/jumeau-3d.md) | Plan 3D du jumeau : rangs de végétation selon l'état observé, météo du jour (pluie, brume, sol mouillé, gelée) |
| [`docs/modele-croissance.md`](docs/modele-croissance.md) | Modèle de croissance : stades par degrés-jours, bilan hydrique, besoin d'irrigation, signalements |
| [`docs/modulation.md`](docs/modulation.md) | Cartes de modulation (zonage Sentinel-2, doses par zone, ISO-XML et Shapefile) et envoi aux machines par agrirouter |
| [`docs/activites.md`](docs/activites.md) · [`docs/parcelles.md`](docs/parcelles.md) · [`docs/carto.md`](docs/carto.md) | Activités et productions ; création de parcelles (PAC, cadastre) et fiche ; outils de cartographie |
| [`docs/materiels.md`](docs/materiels.md) | Matériels : fiche, compteur et relevés, plan d'entretien et échéances, interventions d'entretien, pièces à commander, alertes, avatar 3D (mode d'emploi et API) |
| [`docs/parcours-attelages.md`](docs/parcours-attelages.md) · [`docs/parcours-attelages-design.md`](docs/parcours-attelages-design.md) | Parcours GPS d'un matériel, intervention tirée des parcours, attelages dans l'intervention : exigences et design |
| [`docs/materiels-entretien.md`](docs/materiels-entretien.md) · [`docs/materiels-entretien-design.md`](docs/materiels-entretien-design.md) | Matériels et entretien : exigences (et bilan de réalisation), design (et écarts à la réalisation) |

## État du projet (2026-11-10)

| Étape | État |
|---|---|
| Exigences (`/sc:brainstorm`) | ✅ terminé |
| Architecture (`/sc:design`) | ✅ stack confirmée (TypeScript + service Python, React + Mantine), exports vérifiés |
| Plan d'implémentation (`/sc:workflow`) | ✅ rédigé (`docs/workflow.md`) |
| Jour 1 — fondations (agent 0) | ✅ gel terminé (contrats, db+RLS, API, CI, mocks, agro) |
| Agent A — domaine | ✅ logique pure + vue registre phyto |
| Agent B — migration Ekylibre | ✅ 3 fermes migrées, registre phyto identique, fixtures anonymisées |
| Agent D — API métier | ✅ autorisation par ferme, snapshot, cuves, stocks, interventions (US-2), registre phyto (JSON/CSV), synchro mobile, imports |
| Agent C — Traccar et traces | ✅ synchro réelle (7 592 positions), rejeu CZML, couverture validée contre Traccar (+1,5 %) |
| Agent E — interface web | ✅ React + Mantine (charte Lyvre) : tableau de bord, carte IGN + traces, interventions, stocks, cuverie, registre, imports ; parcours e2e en CI |
| Agent F — plan 3D | ✅ relief et photo IGN, bâtiments (hauteurs BD TOPO), cuverie placée et remplie selon la frise, rejeu 3D des traces, placement manuel des cuves |
| Interventions et procédures simplifiées (étape 1) | ✅ 6 formes, catalogue, périodes, personnes, motifs, annulation, habitudes de la ferme ; migrateur et formulaire web |
| Comptes better-auth (étape 2) | ✅ comptes locaux, sessions cookie + bearer (mobile), page Équipe (membres, personnes ↔ comptes) |
| Intégrations par ferme | ✅ module Intégrations (Traccar) : accès chiffrés par ferme, testés avant enregistrement, worker de synchro chaque minute |
| Déploiement | 🟡 Dokploy prêt (dev.fourmy.org, fourmy.org, www) ; premier déploiement au prochain push |
| Site public fourmy.org | ✅ présentation, fonctionnalités illustrées, roadmap, nouveautés automatiques, contact ; page Fourmy d'ekylibre.com sur une branche |
| zero-mobile (étape 3) | ✅ branche `fourmy-backend` : compte Fourmy, catalogue, formulaire générique par forme, push par intervention ; vérifié contre l'API — reste le passage sur appareil |
| Retours de test des pilotes (interventions, phyto, activités, parcelles) | ✅ lots A à H : saisie pleine page, contrôle réglementaire, précautions et mélanges, activités, certifications, parcelles depuis la carte (PAC, cadastre) |
| Matériels et entretien (lots I à M) | ✅ fiche et relevés d'heures, plan d'entretien et échéances, import de la base matériel, interventions d'entretien, heures estimées par Traccar, pièces à commander, alertes, avatar 3D et rejeu dans le plan 3D (`docs/materiels.md`) |
| Parcours GPS et attelages (lots N à R) | ✅ attelages dans l'intervention (mode libre conservé), parcours GPS par matériel, intervention tirée des parcours, attelages types, applicateur au registre phyto, reprise Ekylibre et synchro mobile (`docs/parcours-attelages.md` §8) |
| Retours de test du 10/11/2026 (lots S à X) | ✅ menus en sections, intégrations par thème, formulaire d'intervention réordonné, choix des colonnes des listes, widget Parcours GPS du tableau de bord, registre phyto au format réglementaire (OEPP, BBCH, SIRET), stations Weenat et Sencrop (`claudedocs/workflow_retours_10112026.md`) |
| Jours 6-7 — migration réelle + recette | ⏳ à faire |

### À reprendre

1. zero-mobile : build EAS et parcours sur appareil (carte, précache), note de
   version pour les pilotes, puis fusion de `fourmy-backend`.
2. Finitions agent 0 : documentation OpenAPI.
3. Export PDF du registre phyto (JSON et CSV disponibles).
4. Matériels : documents et photos (lot fichiers), rattachement des
   entretiens migrés au plan, relevé en fin de chantier dans le formulaire,
   attelage 3D d'après l'attribut `tool` de Traccar (bilan :
   `docs/materiels-entretien.md` §9).
5. Parcours et attelages : zero-mobile doit suivre le contrat des attelages
   (pull et push), lien des parcours vers le rejeu, relier les outils
   annoncés par les boîtiers (`external_ids.traccarTool`) ; bilan :
   `docs/parcours-attelages.md` §8.
6. Registre phyto : SIRET des fermes et culture des activités non
   reconnues à saisir chez les pilotes ; cas B à D de l'arrêté (espaces
   fermés, semences), prestation de service, délai de rentrée
   (`docs/phyto.md`, registre au format réglementaire).
7. Stations météo : valider Weenat et Sencrop sur de vrais comptes
   (horodatage Weenat, unités du vent, jours par appel Sencrop ;
   `docs/meteo.md`).

### Démarrage local

```bash
corepack pnpm install
docker compose -f docker/compose.dev.yml up -d   # FOURMY_DB_PORT=5434 si un PostgreSQL local occupe 5432 (adapter DATABASE_URL)
export DATABASE_URL=postgres://fourmy:fourmy@localhost:5432/fourmy
corepack pnpm build && corepack pnpm migrate
corepack pnpm --filter @fourmy/api seed:dev  # compte dev@fourmy.local, owner de toutes les fermes + référentiel Lexicon
corepack pnpm dev                              # API :3000, web :5173 (relaie /api)
```

Le **référentiel Lexicon** (productions de référence et images des activités,
E-Phy, taxonomie) est copié dans la base : par le worker en production
(`corepack pnpm --filter @fourmy/api worker`), par `seed:dev` en local, ou à
la demande avec `corepack pnpm --filter @fourmy/lexicon sync`. Sans lui,
l'API l'annonce au démarrage : activités sans image, références refusées,
contrôle phyto faux.

Application web : http://localhost:5173 — connexion avec le compte affiché
par `seed:dev` (e-mail prérempli en développement). Parcours de bout en bout :
API + `vite preview` démarrés, puis `DATABASE_URL=… corepack pnpm --filter @fourmy/web e2e`.
Les navigateurs pilotables s'installent une fois :
`corepack pnpm --filter @fourmy/web exec playwright install chromium firefox`
(Firefox ne rejoue que le plan 3D).

### Site public, version et nouveautés

- `apps/site` (Astro) : fourmy.org — `corepack pnpm --filter @fourmy/site dev`.
- **Version et nouveautés automatiques** (`packages/release`) : calculées depuis
  les commits conventionnels à chaque construction (`feat` → version mineure,
  `fix` → correctif ; `docs`, `chore`… ne comptent pas). Le titre du commit
  devient l'entrée publique, sans sa portée ; le corps n'est jamais publié.
  Pour l'écrire pour les agriculteurs, ajouter au message une ligne
  `Public: <texte>` — ou `Public: non` pour ne pas l'afficher. Un nom de
  pilote ou une adresse e-mail dans une entrée publique fait échouer la
  construction (`packages/release/denylist.txt`). Aperçu :
  `node packages/release/dist/cli.js`.
- **Captures** des fonctionnalités (API et application démarrées) :
  `CAPTURES=1 DATABASE_URL=… corepack pnpm --filter @fourmy/web exec playwright test e2e/captures.spec.ts`.
- **Logo** : `packages/ui-lyvre/brand/` (générateur `generate.py`).

### Comptes

Comptes locaux **better-auth** (e-mail + mot de passe) : cookie de session
pour le web, jeton signé `Authorization: Bearer` (en-tête `set-auth-token` à
la connexion) pour le mobile. L'inscription libre est fermée : l'administrateur
crée les comptes, le responsable de la ferme les y ajoute (page **Équipe**) et
rattache chaque personne (intervenant) à son compte.

```bash
# mot de passe lu sur l'entrée standard (jamais en argument)
corepack pnpm --filter @fourmy/api user:create --email salarie@ferme.fr --name "Camille"
```

En production : `BETTER_AUTH_SECRET` (obligatoire), `BETTER_AUTH_URL`,
`FOURMY_TRUSTED_ORIGINS` (voir `.env.example`).
