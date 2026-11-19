#!/usr/bin/env bash
# Exporte une ferme d'une base Fourmy en un fichier SQL à charger dans une autre
# base Fourmy au même niveau de migrations (ex. poste de dev → dev.fourmy.org).
#
#   docker/exporter-ferme.sh <farm_id> [DATABASE_URL] > ferme.sql
#
# Chargement (superutilisateur, base cible sans cette ferme) :
#   psql -v ON_ERROR_STOP=1 -U fourmy -d fourmy < ferme.sql
# Tout passe en une transaction : une erreur (ferme déjà présente, migrations
# différentes) n'écrit rien. Les contraintes et déclencheurs sont suspendus le
# temps du chargement (session_replication_role = replica), car la ferme et ses
# personnes se référencent mutuellement.
#
# Ne sont PAS transférés :
#   - comptes, sessions et adhésions (memberships) : les comptes se créent sur la
#     cible, puis « Ma ferme » → Équipe ; les fiches personnes perdent leur lien
#     de compte (people.user_id) ;
#   - intégrations : leurs accès sont chiffrés avec FOURMY_SECRETS_KEY de la
#     source, illisibles ailleurs ; à ressaisir dans « Intégrations » ;
#   - journal d'audit, événements sortants, invitations, files agrirouter et
#     préchargement IGN : propres à l'instance source ;
#   - fichiers déposés pour un import (import_files) : les imports et leur
#     provenance (import_runs, import_links) sont copiés, pour qu'un fichier
#     réimporté sur la cible ne crée pas de doublons, mais sans leur fichier.
# Le fichier contient des données personnelles : ne pas le committer, le
# supprimer après chargement.
set -euo pipefail

FARM="${1:?usage: $0 <farm_id> [DATABASE_URL]}"
DB="${2:-${DATABASE_URL:-postgres://fourmy:fourmy@localhost:5434/fourmy}}"
[[ "$FARM" =~ ^[0-9a-f-]{36}$ ]] || { echo "farm_id invalide : $FARM" >&2; exit 1; }

q() { psql "$DB" -X -At -v ON_ERROR_STOP=1 -c "$1"; }

# Tables propres à l'instance, jamais copiées.
EXCLUDED="memberships integrations audit_log outbox_events import_files person_invitations agrirouter_inbox agrirouter_outbox ign_cache_jobs"

# Tables sans farm_id, rattachées à une table de la ferme.
declare -A CHILD=(
  [land_parcel_versions]="land_parcel_id in (select id from land_parcels where farm_id = '$FARM')"
  [place_versions]="place_id in (select id from places where farm_id = '$FARM')"
  [container_versions]="container_id in (select id from containers where farm_id = '$FARM')"
  [lot_lineage]="child_lot_id in (select id from lots where farm_id = '$FARM')"
  [intervention_crews]="intervention_id in (select id from interventions where farm_id = '$FARM')"
  [intervention_parameters]="intervention_id in (select id from interventions where farm_id = '$FARM')"
  [intervention_periods]="intervention_id in (select id from interventions where farm_id = '$FARM')"
  [crew_template_members]="template_id in (select id from crew_templates where farm_id = '$FARM')"
  [model_operations]="model_id in (select id from equipment_models where farm_id = '$FARM')"
  [model_parts]="model_id in (select id from equipment_models where farm_id = '$FARM')"
  [model_fluids]="model_id in (select id from equipment_models where farm_id = '$FARM')"
)

[[ "$(q "select count(*) from farms where id = '$FARM'")" == 1 ]] || { echo "ferme introuvable : $FARM" >&2; exit 1; }

cols() { q "select string_agg(quote_ident(attname), ', ' order by attnum) from pg_attribute where attrelid = 'public.$1'::regclass and attnum > 0 and not attisdropped and attgenerated = ''"; }

copy() { # table, condition, [colonnes sélectionnées]
  local t=$1 where=$2 c sel n
  c=$(cols "$t"); sel=${3:-$c}
  n=$(q "select count(*) from public.$t where $where")
  [[ $n == 0 ]] && return
  echo "-- $t : $n"
  echo "COPY public.$t ($c) FROM stdin;"
  psql "$DB" -X -v ON_ERROR_STOP=1 -c "COPY (select $sel from public.$t where $where) TO STDOUT"
  echo '\.'
  echo
}

echo "-- Ferme $FARM ($(q "select name from farms where id = '$FARM'")), exportée le $(date -Iseconds)"
echo "-- Migrations source : $(q "select count(*) || ' / ' || md5(string_agg(name, ',' order by name)) from _migrations")"
echo "BEGIN;"
# La cible doit avoir exactement les mêmes migrations.
echo "DO \$\$ BEGIN IF (select md5(string_agg(name, ',' order by name)) from _migrations) <> '$(q "select md5(string_agg(name, ',' order by name)) from _migrations")' THEN RAISE EXCEPTION 'migrations différentes de la source'; END IF; END \$\$;"
echo "SET session_replication_role = replica;"
echo

copy farms "id = '$FARM'"
for t in $(q "select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'farm_id' where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1"); do
  [[ " $EXCLUDED " == *" $t "* ]] && continue
  if [[ $t == people ]]; then
    # Sans lien de compte : les comptes n'existent pas sur la cible.
    copy people "farm_id = '$FARM'" "$(cols people | sed 's/\buser_id\b/null::uuid as user_id/')"
  elif [[ $t == import_runs ]]; then
    # Les fichiers ne sont pas copiés.
    copy import_runs "farm_id = '$FARM'" "$(cols import_runs | sed 's/\bfile_id\b/null::uuid as file_id/')"
  else
    copy "$t" "farm_id = '$FARM'"
  fi
done
for t in "${!CHILD[@]}"; do copy "$t" "${CHILD[$t]}"; done

echo "SET session_replication_role = origin;"
echo "COMMIT;"
