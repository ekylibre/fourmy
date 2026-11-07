# @fourmy/connector-traccar

Synchronise les positions GPS d'un serveur Traccar vers Fourmy
(docs/architecture.md §6.2, US-1 / US-3).

```bash
TRACCAR_URL=https://traccar.osfarm.org TRACCAR_TOKEN=… DATABASE_URL=… \
  node packages/connector-traccar/dist/cli.js --farm <uuid> --since 2026-01-01T00:00:00Z
```

- **Authentification** : jeton (`TRACCAR_TOKEN`) ou, en repli, HTTP Basic
  (`TRACCAR_BASIC_USER` / `TRACCAR_BASIC_PASSWORD`). Jamais dans le dépôt.
- **Rattachement** : chaque boîtier est relié au matériel de même nom
  (casse, accents et ponctuation ignorés) ; un nom absent ou ambigu est signalé.
- **Reprise** : chaque synchro repart après la dernière position connue ; sans
  doublon sur `(rattachement, instant)`. `--full` repart de `--since` et met à
  jour les positions dont les attributs ont changé.
- **Attributs agricoles** conservés (`positions.attrs`) : `working`
  (`isWorking`), `widthM` (`workingWidth`), `tool`, `fieldHa`, `appliedHa`.
  Vitesse convertie des **nœuds** en km/h.

## Particularités du serveur osfarm (constatées le 2026-11-07)

- `isWorking` arrive en **chaîne** (`"True"` / `"False"`), pas en booléen JSON.
- Nombres au **format français** (`"2,8 m"`, `"15,56 ha"`).
- `appliedArea` est un compteur **cumulé sur la journée**, pas par parcelle.

## Validation sur données réelles (Claas Arion 430, 5 octobre 2026)

| | Fourmy | Traccar |
|---|---|---|
| Surface travaillée du jour | 16,03 ha | 15,79 ha (`appliedArea`), écart +1,5 % |
| Points au travail | 1 002 / 2 886 | 1 002 / 2 886 |
| Trace pour le rejeu (tolérance 2 m) | 542 échantillons | 2 886 points |

## À faire

- Planification : la synchro est un appel ponctuel, idempotent et reprenable ;
  la boucle « toutes les minutes » ira dans `apps/worker` (pas encore créé).
