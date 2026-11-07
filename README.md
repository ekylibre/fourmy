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
| [`docs/interventions.md`](docs/interventions.md) | Interventions et procédures simplifiées (proposition) : 6 formes, catalogue, modèle, correspondance Ekylibre, impacts Fourmy et zero-mobile |
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
| Agent G — mobile | ⏳ à faire |
| Jours 6-7 — migration réelle + recette | ⏳ à faire |

### À reprendre

1. Agent restant : **G** (adapter `zero-mobile` à la synchro Fourmy).
2. `apps/worker` : planifier la synchro Traccar (toutes les minutes).
3. Finitions agent 0 : better-auth (l'identité vient encore de `x-user-id` ;
   l'autorisation par ferme est, elle, en place) et documentation OpenAPI.
4. Export PDF du registre phyto (JSON et CSV disponibles).

### Démarrage local

```bash
corepack pnpm install
docker compose -f docker/compose.dev.yml up -d
export DATABASE_URL=postgres://fourmy:fourmy@localhost:5432/fourmy
corepack pnpm build && corepack pnpm migrate
corepack pnpm --filter @fourmy/db seed:dev   # utilisateur de dev, owner de toutes les fermes
corepack pnpm dev                              # API :3000, web :5173 (relaie /api)
```

Application web : http://localhost:5173 (identifiant prérempli = utilisateur
de `seed:dev`). Parcours de bout en bout : API + `vite preview` démarrés,
puis `DATABASE_URL=… corepack pnpm --filter @fourmy/web e2e`.

En attendant better-auth, l'API lit l'identité dans l'en-tête `x-user-id`
(affiché par `seed:dev`) et vérifie l'appartenance à la ferme (rôles `owner`
et `worker`).
