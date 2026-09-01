#!/usr/bin/env bash
set -Eeuo pipefail

readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly repo_root="$(cd -- "${script_dir}/../.." && pwd -P)"
readonly compose_file="${script_dir}/compose.yaml"
readonly project_name="jira-planning-local"
readonly volume_name="jira-planning-local-postgres"
readonly python_bin="${repo_root}/.venv/bin/python"
readonly lock_dir="/tmp/jira-planning-local-runner.lock"

cleanup_armed=0
cleanup_done=0
lock_owned=0
child_pid=""
critical_section=0
pending_signal_status=0

fail() {
  printf 'Local PostgreSQL runner: %s\n' "$*" >&2
  exit 1
}

run_child() {
  local child_status
  critical_section=1
  set -m
  "$@" &
  child_pid=$!
  set +m
  critical_section=0
  service_pending_signal
  if wait "$child_pid"; then
    child_status=0
  else
    child_status=$?
  fi
  child_pid=""
  return "$child_status"
}

terminate_child_group() {
  local target_pid="${child_pid:-}"
  local killer_pid=""
  [[ -n "$target_pid" ]] || return 0

  kill -TERM -- "-${target_pid}" 2>/dev/null || true
  (
    trap '' INT TERM
    sleep 5
    kill -KILL -- "-${target_pid}" 2>/dev/null || true
  ) &
  killer_pid=$!

  wait "$target_pid" 2>/dev/null || true
  if kill -0 -- "-${target_pid}" 2>/dev/null; then
    wait "$killer_pid" 2>/dev/null || true
  else
    kill "$killer_pid" 2>/dev/null || true
    wait "$killer_pid" 2>/dev/null || true
  fi
  child_pid=""
}

cleanup() {
  local original_status=$?
  local cleanup_status=0
  trap - EXIT
  trap '' INT TERM

  if [[ "$cleanup_armed" -eq 1 && "$cleanup_done" -eq 0 ]]; then
    cleanup_done=1
    if run_child "${compose[@]}" down --timeout 10; then
      :
    else
      cleanup_status=$?
      printf 'Local PostgreSQL runner: cleanup failed; original status was %s.\n' \
        "$original_status" >&2
    fi
  fi

  if [[ "$lock_owned" -eq 1 ]]; then
    rmdir "$lock_dir" 2>/dev/null || true
    lock_owned=0
  fi
  if [[ "$original_status" -ne 0 ]]; then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}

handle_signal() {
  local signal_status="$1"
  if [[ "$critical_section" -eq 1 ]]; then
    if [[ "$pending_signal_status" -eq 0 ]]; then
      pending_signal_status="$signal_status"
    fi
    return 0
  fi
  trap '' INT TERM
  terminate_child_group
  exit "$signal_status"
}

service_pending_signal() {
  local signal_status="$pending_signal_status"
  if [[ "$signal_status" -ne 0 ]]; then
    pending_signal_status=0
    handle_signal "$signal_status"
  fi
}

[[ "$#" -eq 0 ]] || fail "arguments are not supported."
[[ -x "$python_bin" ]] || fail "missing .venv; run make install first."
[[ -f "${repo_root}/jira_server.py" && -f "${repo_root}/backend/db/alembic.ini" ]] ||
  fail "runner path does not resolve to a source checkout."
command -v docker >/dev/null 2>&1 || fail "Docker is not installed."

if [[ -n "${DOCKER_HOST:-}" ]]; then
  docker_endpoint="$DOCKER_HOST"
elif [[ -n "${DOCKER_CONTEXT:-}" ]]; then
  active_context="$DOCKER_CONTEXT"
  docker_endpoint="$(
    docker context inspect "$active_context" \
      --format '{{ (index .Endpoints "docker").Host }}' 2>/dev/null
  )" || fail "unable to inspect the selected Docker context."
else
  active_context="$(docker context show 2>/dev/null)" ||
    fail "unable to read the active Docker context."
  docker_endpoint="$(
    docker context inspect "$active_context" \
      --format '{{ (index .Endpoints "docker").Host }}' 2>/dev/null
  )" || fail "unable to inspect the active Docker context."
fi
case "$docker_endpoint" in
  unix://*) ;;
  *) fail "a local Unix Docker daemon is required; remote contexts are unsupported." ;;
esac

unset DOCKER_HOST DOCKER_CONTEXT
readonly -a docker_cli=(docker --host "$docker_endpoint")
readonly -a compose=(
  "${docker_cli[@]}" compose
  --env-file /dev/null
  --project-directory "$script_dir"
  --project-name "$project_name"
  --file "$compose_file"
)

"${docker_cli[@]}" compose version >/dev/null 2>&1 ||
  fail "Docker Compose v2 is unavailable."
compose_help="$("${docker_cli[@]}" compose up --help 2>&1)" ||
  fail "unable to inspect Docker Compose capabilities."
[[ "$compose_help" == *"--wait-timeout"* ]] ||
  fail "Docker Compose must support up --wait and --wait-timeout."

"${docker_cli[@]}" info >/dev/null 2>&1 ||
  fail "the Docker daemon is unavailable; start Docker and retry."
engine_major="$("${docker_cli[@]}" version --format '{{.Server.Version}}' | cut -d. -f1)"
[[ "$engine_major" =~ ^[0-9]+$ && "$engine_major" -ge 28 ]] ||
  fail "Docker Engine 28 or newer is required for localhost port isolation."

export COMPOSE_DISABLE_ENV_FILE=1
"${compose[@]}" config --quiet || fail "runners/local/compose.yaml is invalid."

trap cleanup EXIT
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM
critical_section=1
if mkdir "$lock_dir" 2>/dev/null; then
  lock_owned=1
else
  critical_section=0
  service_pending_signal
  fail "another runner is active or a stale runner lock requires inspection: ${lock_dir}"
fi
critical_section=0
service_pending_signal

volume_names="$(
  "${docker_cli[@]}" volume ls --format '{{.Name}}'
)" || fail "unable to enumerate runner resources: Docker volumes."
volume_exists=0
while IFS= read -r candidate; do
  if [[ "$candidate" == "$volume_name" ]]; then
    volume_exists=1
    break
  fi
done <<< "$volume_names"

if [[ "$volume_exists" -eq 1 ]]; then
  volume_project="$(
    "${docker_cli[@]}" volume inspect "$volume_name" \
      --format '{{ index .Labels "com.docker.compose.project" }}'
  )" || fail "unable to inspect runner resources: persistent-volume project label."
  volume_key="$(
    "${docker_cli[@]}" volume inspect "$volume_name" \
      --format '{{ index .Labels "com.docker.compose.volume" }}'
  )" || fail "unable to inspect runner resources: persistent-volume key label."
  [[ "$volume_project" == "$project_name" && "$volume_key" == "postgres-data" ]] ||
    fail "runner resources include a persistent volume not owned by this runner."
fi

project_containers="$(
  "${docker_cli[@]}" ps --all --quiet \
    --filter "label=com.docker.compose.project=${project_name}"
)" || fail "unable to inspect project containers."
legacy_containers="$(
  "${docker_cli[@]}" ps --all --quiet \
    --filter "name=^/${project_name}[-_]"
)" || fail "unable to inspect legacy project containers."
project_networks="$(
  "${docker_cli[@]}" network ls --quiet \
    --filter "label=com.docker.compose.project=${project_name}"
)" || fail "unable to inspect project networks."
exact_default_network="$(
  "${docker_cli[@]}" network ls --quiet \
    --filter "name=^${project_name}_default$"
)" || fail "unable to inspect the default project network."
volume_users="$(
  "${docker_cli[@]}" ps --all --quiet --filter "volume=${volume_name}"
)" || fail "unable to inspect persistent-volume users."

[[ -z "$project_containers" && -z "$legacy_containers" &&
   -z "$project_networks" && -z "$exact_default_network" &&
   -z "$volume_users" ]] ||
  fail "runner resources already exist or the retained volume is in use; inspect them before retrying."

export DATABASE_URL="postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_local"
export DATABASE_CONNECTION_MODE=url
export CONFIG_STORAGE_BACKEND=db
export APP_ENVIRONMENT_KEY=local
export APP_BIND_HOST=127.0.0.1
export ALLOW_NETWORK_BIND=false
export ALLOW_BASIC_AUTH_ON_NETWORK=false
export DEBUG_MODE=false

cd "$repo_root"
cleanup_armed=1

if run_child "${compose[@]}" up --detach --wait --wait-timeout 60 postgres; then
  :
else
  startup_status=$?
  printf '%s\n' \
    "Local PostgreSQL runner: PostgreSQL did not become healthy; port 127.0.0.1:5432 may be occupied." >&2
  "${compose[@]}" ps --all >&2 || true
  "${compose[@]}" logs --no-color --tail 100 postgres >&2 || true
  exit "$startup_status"
fi

run_child "$python_bin" -m alembic -c backend/db/alembic.ini upgrade head
run_child "$python_bin" scripts/check_startup_preflight.py
run_child "$python_bin" jira_server.py
