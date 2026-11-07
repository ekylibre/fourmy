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

## État du projet (2026-11-07)

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
| Jours 6-7 — migration réelle + recette | ⏳ à faire |

### À reprendre

1. zero-mobile : build EAS et parcours sur appareil (carte, précache), note de
   version pour les pilotes, puis fusion de `fourmy-backend`.
3. Finitions agent 0 : documentation OpenAPI.
4. Export PDF du registre phyto (JSON et CSV disponibles).

### Démarrage local

```bash
corepack pnpm install
docker compose -f docker/compose.dev.yml up -d
export DATABASE_URL=postgres://fourmy:fourmy@localhost:5432/fourmy
corepack pnpm build && corepack pnpm migrate
corepack pnpm --filter @fourmy/api seed:dev  # compte dev@fourmy.local, owner de toutes les fermes
corepack pnpm dev                              # API :3000, web :5173 (relaie /api)
```

Application web : http://localhost:5173 — connexion avec le compte affiché
par `seed:dev` (e-mail prérempli en développement). Parcours de bout en bout :
API + `vite preview` démarrés, puis `DATABASE_URL=… corepack pnpm --filter @fourmy/web e2e`.

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
