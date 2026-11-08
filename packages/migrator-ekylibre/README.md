# @fourmy/migrator-ekylibre

Migration d'une instance Ekylibre (4.37 ou 5.0) vers Fourmy, depuis une
**sauvegarde de tenant** — jamais depuis une instance en production
(ADR-12, FR-MIG-4/5).

```bash
# 1. Restaurer l'export dans une base source jetable, en lecture seule
packages/migrator-ekylibre/scripts/restore-source.sh <tenant>.zip

# 2. Migrer vers Fourmy (DATABASE_URL = base Fourmy migrée)
node packages/migrator-ekylibre/dist/cli.js \
  --source postgres://fourmy:fourmy@localhost:5432/ekylibre_src_<tenant>
```

## Garanties

- **Lecture seule** côté source : la base est créée avec
  `default_transaction_read_only = on` et lue en transaction `read only`.
- **Idempotente** : identifiants UUID v5 dérivés de `(instance, table, id)`,
  écritures `ON CONFLICT DO UPDATE`. Rejouer met à jour, ne duplique pas.
- **Sous RLS** : écriture avec le rôle `fourmy_app` dans le contexte de la ferme.
- **Rapport** (`import_runs.report`) : volumes, **rejets** (avec motif),
  **avertissements** (données suspectes conservées telles quelles) et **écart
  du registre phyto** Ekylibre ↔ Fourmy par année (critère de US-5).

## Correspondances notables

| Ekylibre | Fourmy |
|---|---|
| `LandParcel` + `initial_shape` | `land_parcels` + version (géométrie nettoyée `ST_MakeValid`) |
| `activity_productions` annuelles | une production par campagne |
| `activity_productions` pérennes (vigne, sans campagne) | une production par campagne couverte par `[started_on, stopped_on]` |
| `Building`, `BuildingDivision` | `places` (plus grand polygone comme emprise) |
| produits `variety = tank…` + `nominal_storable_net_volume` | `containers` (capacité en litres) |
| cible `Plant` | parcelle support de sa production — sauf si la zone de travail tombe à plus de 50 % sur une autre parcelle à la date : celle-ci fait foi (avertissement au rapport) |
| cible `LandParcel` avec zone de travail | même règle : la parcelle qui contient la zone fait foi |
| intrant : variante avec n° AMM non vide | article `phyto` (un AMM vide = engrais) |
| `quantity_population` | mouvement de stock (quantité absolue) ; la dose saisie va au registre |
| `wine_incoming_harvest_storages` | lots de vendange + mouvements d'entrée en cuve (US-9) |
| personnes (`Worker`) | non migrées (données personnelles) ; rôle `doer` conservé sans référence |
