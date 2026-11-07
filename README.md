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

## État du projet (2026-11-07)

| Étape | État |
|---|---|
| Exigences (`/sc:brainstorm`) | ✅ terminé |
| Architecture (`/sc:design`) | ✅ stack confirmée (TypeScript + service Python, React + Mantine), exports vérifiés |
| Plan d'implémentation (`/sc:workflow`) | ⏳ à faire |
| Développement de la première tranche (7 jours, multi-agent) | ⏳ à faire |

### À reprendre

1. Obtenir un **jeton Traccar** qui voit les boîtiers de Pierre (le jeton
   actuel reçoit 401 sur `/api/devices`).
2. Lancer `/sc:workflow` pour le plan détaillé de chaque agent.
