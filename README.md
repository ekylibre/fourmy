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
| [`docs/workflow.md`](docs/workflow.md) | Plan d'implémentation de la première tranche : jour 1 des fondations, tâches des 7 agents, recette |

## État du projet (2026-11-07)

| Étape | État |
|---|---|
| Exigences (`/sc:brainstorm`) | ✅ terminé |
| Architecture (`/sc:design`) | ✅ stack confirmée (TypeScript + service Python, React + Mantine), exports vérifiés |
| Plan d'implémentation (`/sc:workflow`) | ✅ rédigé (`docs/workflow.md`) |
| Jour 1 — fondations (agent 0) | ✅ gel terminé (contrats, db+RLS, API, CI, mocks, agro) |
| Jours 2-5 — agents A→G (domaine, migration, Traccar, API, web, 3D, mobile) | ⏳ à faire |
| Jours 6-7 — migration réelle + recette | ⏳ à faire |

### À reprendre

1. Lancer les **agents A→G** (domaine, migration Ekylibre, Traccar, API
   métier/synchro, web React, 3D/cuverie, mobile) contre les contrats gelés.
2. Finitions agent 0 : better-auth réel (aujourd'hui stub) et montage
   `@hono/zod-openapi` complet.

### Démarrage local

```bash
corepack pnpm install
docker compose -f docker/compose.dev.yml up -d
DATABASE_URL=postgres://fourmy:fourmy@localhost:5432/fourmy corepack pnpm migrate
corepack pnpm dev
```
