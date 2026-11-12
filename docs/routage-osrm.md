# Routage tracteur (OSRM)

Mis en place le 2026-11-12, à la suite des retours sur le rejeu 3D : entre
deux positions GPS (une toutes les 5 minutes sur la route), la trace
coupait à travers champs et maisons.

## Ce que fait le service

- **Recalage des déplacements sur la route** (rejeu du plan 3D) : les
  plages hors travail de la trace passent par le service `match` d'OSRM, qui
  retrouve les routes et chemins empruntés. Chaque sommet de la route
  retrouvée reçoit un instant proportionnel à la distance parcourue entre
  deux positions GPS d'origine. Les plages au travail (dans les parcelles)
  restent telles que reçues.
- La barre de rejeu affiche « Trajets recalés sur la route : 13/18 ». Un
  trajet non recalé (pas de route proche, signal coupé) garde ses points
  bruts.
- **Itinéraires** : le même service sait calculer distance et durée d'un
  trajet (siège → parcelle, parcelle → parcelle). Ce n'est pas encore exposé
  dans Fourmy (voir *Suite*).

## Hébergement

OSRM est **auto-hébergé** (décision du 2026-11-12) : les traces des fermes ne
partent chez aucun tiers.

- Image `osrm/osrm-backend:v5.25.0`, algorithme MLD.
- Carte OpenStreetMap de Geofabrik, par région (`europe/france/aquitaine` par
  défaut, 300 Mo).
- Prétraitement : environ 2 Go de RAM au pic et quelques minutes. Le
  service tourne ensuite avec quelques centaines de Mo.
- **Profil tracteur** (`docker/osrm/tractor.lua`), dérivé du profil voiture :
  - chemins (`highway=track`) et accès `agricultural` / `forestry` permis ;
  - autoroutes exclues ;
  - 40 km/h au plus ;
  - gabarit d'un tracteur avec outil.

```sh
docker/osrm/prepare.sh                         # Aquitaine, dans le volume fourmy_osrm
docker/osrm/prepare.sh europe/france/midi-pyrenees   # autre région
docker compose -f docker/compose.dev.yml --profile osrm up -d osrm   # port 5000
FOURMY_OSRM_URL=http://localhost:5000          # côté API
```

Relancer `prepare.sh` met la carte à jour ; redémarrer ensuite le service.
Plusieurs régions : télécharger un extrait plus large (`europe/france`,
4 Go, ~12 Go de RAM au prétraitement) ou fusionner les extraits avec
`osmium merge` avant l'extraction.

## API

| Route | Rôle |
|---|---|
| `GET /tracks?equipment=…&from=…&to=…&road=1` | Trace du rejeu, déplacements recalés ; `road: { runs, snapped }` (absent sans `road=1`, ou sans `FOURMY_OSRM_URL`) |

Sans `FOURMY_OSRM_URL`, ou si OSRM ne répond pas en 8 s, la trace reste
brute : le recalage n'embellit que le rejeu et ne bloque jamais rien.

## Tests

- `apps/api/test/osrm.test.ts` :
  - instants interpolés le long de la route ;
  - seuls les déplacements sont recalés (faux service OSRM) ;
  - repli sur la trace brute, service absent ou en erreur.
- Vérifié le 2026-11-12 sur la journée du 05/10/2026 de l'Arion 430 de
  Pierre : 13 trajets recalés sur 18, en 0,2 s, posés sur les routes de
  l'orthophoto IGN.

## Suite

- Recalage aussi sur la carte 2D des parcours.
- Durée et distance des trajets siège ↔ parcelles, pour le temps de
  déplacement des chantiers et le choix de l'ordre des parcelles.
- Service OSRM en production : volume préparé sur le serveur, puis
  `FOURMY_OSRM_URL=http://osrm:5000` (à ajouter au compose de déploiement).
