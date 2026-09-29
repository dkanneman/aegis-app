#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: build_production_shaped_migrations.sh <repository-root> <output-directory> <baseline|release>

Builds the reviewed production-shaped migration set from canonical repository
migrations. The baseline mode excludes the pending appointment, OAuth security,
and recurring-chore migrations. Release mode includes those pending migrations.
EOF
}

if [[ $# -ne 3 ]]; then
  usage >&2
  exit 64
fi
repository_root=$1
output_directory=$2
mode=$3
source_directory="$repository_root/supabase/migrations"

if [[ "$mode" != "baseline" && "$mode" != "release" ]]; then
  usage >&2
  exit 64
fi

if [[ ! -d "$source_directory" ]]; then
  echo "Canonical migration directory not found: $source_directory" >&2
  exit 66
fi

mkdir -p "$output_directory"
if find "$output_directory" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  echo "Output directory must be empty: $output_directory" >&2
  exit 73
fi

pending_versions=(
  20260916120000
  20260916150000
  20260917211929
  20260928230029
  20260929002346
  20260929173234
  20260929191406
  20260929225018
)

is_pending_version() {
  local candidate=$1
  local pending
  for pending in "${pending_versions[@]}"; do
    if [[ "$candidate" == "$pending" ]]; then
      return 0
    fi
  done
  return 1
}

for source_path in "$source_directory"/*.sql; do
  source_name=$(basename "$source_path")
  version=${source_name%%_*}

  case "$version" in
    # These unfinished Gmail migrations are outside the appointment candidate.
    20260915195726|20260915205000|20260915213000|20260915215500|\
    20260915221000|20260915223000|20260915230000|20260915233000|\
    20260915234500|20260915235000|20260916000500|20260916003000)
      continue
      ;;
    # Sandbox-only migration; production uses the separate fail-closed writer.
    20260916143000)
      continue
      ;;
  esac

  if [[ "$mode" == "baseline" ]] && is_pending_version "$version"; then
    continue
  fi

  case "$version" in
    20260915164500)
      destination_name=20260915203426_harden_appointment_intake_and_bridge.sql
      ;;
    20260915175808)
      destination_name=20260915203431_prioritize_daily_plan_tasks.sql
      ;;
    *)
      destination_name=$source_name
      ;;
  esac

  cp "$source_path" "$output_directory/$destination_name"
done

if [[ -e "$output_directory/20260915164500_harden_appointment_intake_and_bridge.sql" \
   || -e "$output_directory/20260915175808_prioritize_daily_plan_tasks.sql" \
   || -e "$output_directory/20260916143000_fail_closed_aegis_sandbox_delivery.sql" ]]; then
  echo "Production-shaped migration set contains a forbidden local-only version." >&2
  exit 65
fi

for mapped in \
  20260915203426_harden_appointment_intake_and_bridge.sql \
  20260915203431_prioritize_daily_plan_tasks.sql; do
  if [[ ! -f "$output_directory/$mapped" ]]; then
    echo "Required production-ledger mapping is missing: $mapped" >&2
    exit 65
  fi
done

if [[ "$mode" == "release" ]]; then
  for pending in "${pending_versions[@]}"; do
    if ! find "$output_directory" -maxdepth 1 -type f -name "${pending}_*.sql" -print -quit | grep -q .; then
      echo "Pending release migration is missing: $pending" >&2
      exit 65
    fi
  done
fi
