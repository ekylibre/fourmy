#!/usr/bin/env bash
# Restaure une sauvegarde de tenant Ekylibre (.zip, format_version 3) dans une
# base source JETABLE, puis la passe en lecture seule (ADR-12, FR-MIG-4/5).
#
#   restore-source.sh <archive.zip> [nom_base]
#
# Le zip contient manifest.yml + <tenant>.sql (dump texte) + files/.
# Le dump attend PostGIS dans un schéma `postgis` et le schéma du tenant.
# Variables : COMPOSE_FILE (défaut docker/compose.dev.yml), PGUSER (fourmy).
set -euo pipefail
ZIP="${1:?usage: restore-source.sh <archive.zip> [nom_base]}"
COMPOSE_FILE="${COMPOSE_FILE:-docker/compose.dev.yml}"
PGUSER="${PGUSER:-fourmy}"

TENANT="$(unzip -p "$ZIP" manifest.yml | sed -n 's/^tenant: *//p' | tr -d '\r')"
VERSION="$(unzip -p "$ZIP" manifest.yml | sed -n 's/^created_with: *//p' | tr -d '\r')"
DB="${2:-ekylibre_src_$(echo "$TENANT" | tr -c 'a-z0-9\n' '_')}"
CID="$(docker compose -f "$COMPOSE_FILE" ps -q db)"
psql_() { docker exec -i "$CID" psql -U "$PGUSER" -v ON_ERROR_STOP=1 -q "$@"; }

echo "→ tenant=$TENANT ($VERSION) → base $DB"
psql_ -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\""
psql_ -d "$DB" -c "CREATE SCHEMA postgis" -c "CREATE EXTENSION postgis SCHEMA postgis" \
              -c "CREATE SCHEMA \"$TENANT\""

ERR="$(mktemp)"
unzip -p "$ZIP" "$TENANT.sql" \
  | docker exec -i "$CID" psql -U "$PGUSER" -d "$DB" -q -v ON_ERROR_STOP=0 2>"$ERR" >/dev/null || true
NERR="$(grep -c ERROR "$ERR" || true)"
[ "$NERR" -gt 0 ] && { echo "⚠ $NERR erreurs de restauration :"; grep ERROR "$ERR" | sort | uniq -c | sort -rn | head; }
rm -f "$ERR"

# Lecture seule : toute transaction sur cette base refusera les écritures.
psql_ -d postgres -c "ALTER DATABASE \"$DB\" SET default_transaction_read_only = on"
psql_ -d postgres -c "COMMENT ON DATABASE \"$DB\" IS 'ekylibre tenant=$TENANT version=$VERSION'"
echo "✓ $DB prête (lecture seule), schéma \"$TENANT\""
