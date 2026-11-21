#!/bin/sh
# Prépare les données OSRM (profil tracteur) dans le volume Docker `fourmy_osrm`.
# Usage : docker/osrm/prepare.sh [région Geofabrik…]
#   docker/osrm/prepare.sh                                        # europe/france/aquitaine
#   docker/osrm/prepare.sh europe/france/aquitaine europe/france/pays-de-la-loire
# Plusieurs régions sont fusionnées (osmium merge) en un seul graphe : un seul
# service pour toutes les fermes (lot IT4, temps de travaux de l'assolement).
# Relancer pour mettre la carte à jour ; le service `osrm` relit les fichiers au démarrage.
# Adresses Geofabrik : <région>/<nom>/<nom>-latest.osm.pbf (l'ancienne forme <région>-latest
# redirige vers un chemin introuvable depuis novembre 2026).
set -eu
[ $# -eq 0 ] && set -- europe/france/aquitaine
HERE="$(cd "$(dirname "$0")" && pwd)"
IMAGE="${OSRM_IMAGE:-osrm/osrm-backend:v5.25.0}"
NAMES=""
for REGION in "$@"; do NAMES="${NAMES:+$NAMES }$(basename "$REGION")"; done
docker volume create fourmy_osrm >/dev/null
docker run --rm -v fourmy_osrm:/data alpine:3.20 sh -c "cd /data && rm -f region-*.osm.pbf"
i=0
for REGION in "$@"; do
  i=$((i + 1))
  docker run --rm -v fourmy_osrm:/data alpine:3.20 sh -c \
    "cd /data && wget -q -O region-$i.osm.pbf https://download.geofabrik.de/${REGION}/$(basename "$REGION")-latest.osm.pbf"
done
if [ "$i" -eq 1 ]; then
  docker run --rm -v fourmy_osrm:/data alpine:3.20 sh -c "cd /data && mv region-1.osm.pbf map.osm.pbf"
else
  # Fusion des extraits (osmium-tool de Debian).
  docker run --rm -v fourmy_osrm:/data debian:bookworm-slim sh -c \
    "apt-get update -qq && apt-get install -y -qq osmium-tool >/dev/null && cd /data && osmium merge region-*.osm.pbf -o map.osm.pbf --overwrite && rm -f region-*.osm.pbf"
fi
docker run --rm -v fourmy_osrm:/data alpine:3.20 sh -c "echo '${NAMES}' > /data/region"
docker run --rm -v fourmy_osrm:/data -v "$HERE/tractor.lua:/opt/tractor.lua:ro" "$IMAGE" \
  osrm-extract -p /opt/tractor.lua /data/map.osm.pbf
docker run --rm -v fourmy_osrm:/data "$IMAGE" osrm-partition /data/map.osrm
docker run --rm -v fourmy_osrm:/data "$IMAGE" osrm-customize /data/map.osrm
echo "OSRM prêt (${NAMES}) : docker compose -f docker/compose.dev.yml up -d osrm"
