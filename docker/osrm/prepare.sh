#!/bin/sh
# Prépare les données OSRM (profil tracteur) dans le volume Docker `fourmy_osrm`.
# Usage : docker/osrm/prepare.sh [région Geofabrik, ex. europe/france/aquitaine]
# Relancer pour mettre la carte à jour ; le service `osrm` relit les fichiers au démarrage.
set -eu
REGION="${1:-europe/france/aquitaine}"
NAME="$(basename "$REGION")"
HERE="$(cd "$(dirname "$0")" && pwd)"
IMAGE="${OSRM_IMAGE:-osrm/osrm-backend:v5.25.0}"
docker volume create fourmy_osrm >/dev/null
docker run --rm -v fourmy_osrm:/data alpine:3.20 sh -c \
  "cd /data && wget -q -O map.osm.pbf https://download.geofabrik.de/${REGION}-latest.osm.pbf && echo '${NAME}' > region"
docker run --rm -v fourmy_osrm:/data -v "$HERE/tractor.lua:/opt/tractor.lua:ro" "$IMAGE" \
  osrm-extract -p /opt/tractor.lua /data/map.osm.pbf
docker run --rm -v fourmy_osrm:/data "$IMAGE" osrm-partition /data/map.osrm
docker run --rm -v fourmy_osrm:/data "$IMAGE" osrm-customize /data/map.osrm
echo "OSRM prêt (${NAME}) : docker compose -f docker/compose.dev.yml up -d osrm"
