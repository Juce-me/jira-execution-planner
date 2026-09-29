#!/usr/bin/env bash
set -Eeuo pipefail

readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly repo_root="$(cd -- "${script_dir}/../.." && pwd -P)"
readonly compose_file="${script_dir}/compose.yaml"
readonly project_name="jira-planning-local"
readonly volume_name="jira-planning-local-postgres"
readonly python_bin="${repo_root}/.venv/bin/python"
runtime_tmp_dir="/tmp"
if [[ ! -d "$runtime_tmp_dir" || ! -w "$runtime_tmp_dir" ]]; then
  runtime_tmp_dir="$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null || true)"
  runtime_tmp_dir="${runtime_tmp_dir%/}"
fi
readonly runtime_tmp_dir
readonly lock_dir="${runtime_tmp_dir}/jira-planning-local-runner.lock"
readonly lock_pid_file="${lock_dir}/runner.pid"
readonly lock_child_pid_file="${lock_dir}/child.pid"

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

process_is_running() {
  local target_pid="$1"

  kill -0 "$target_pid" 2>/dev/null
}

pid_belongs_to_runner() {
  local target_pid="$1"
  local process_command=""

  process_command="$(ps -p "$target_pid" -o command= 2>/dev/null)" || return 1
  [[ "$process_command" == *"runners/local/run.sh"* ]]
}

remove_observed_lock() {
  local observed_pid="$1"
  local current_pid=""

  if [[ -f "$lock_pid_file" ]]; then
    current_pid="$(< "$lock_pid_file")"
  fi
  [[ "$current_pid" == "$observed_pid" ]] || return 2
  rm -f -- "$lock_child_pid_file" || return 1
  rm -f -- "$lock_pid_file" || return 1
  if ! rmdir "$lock_dir" 2>/dev/null; then
    [[ ! -d "$lock_dir" ]] || return 1
  fi
}

stop_existing_runner() {
  local target_pid="$1"
  local target_child_pid=""
  local attempt=0

  printf 'Local PostgreSQL runner: replacing runner process %s.\n' \
    "$target_pid" >&2
  kill -TERM "$target_pid" 2>/dev/null || return 0
  while process_is_running "$target_pid" &&
        [[ -d "$lock_dir" && "$attempt" -lt 140 ]]; do
    sleep 0.05
    attempt=$((attempt + 1))
  done
  if process_is_running "$target_pid" && [[ -d "$lock_dir" ]]; then
    printf 'Local PostgreSQL runner: runner process %s did not stop; sending KILL.\n' \
      "$target_pid" >&2
    if [[ -f "$lock_child_pid_file" ]]; then
      target_child_pid="$(< "$lock_child_pid_file")"
    fi
    kill -KILL "$target_pid" 2>/dev/null || true
    if [[ "$target_child_pid" =~ ^[0-9]+$ ]]; then
      kill -TERM -- "-${target_child_pid}" 2>/dev/null || true
      kill -KILL -- "-${target_child_pid}" 2>/dev/null || true
    fi
    remove_observed_lock "$target_pid" || true
  fi
  if process_is_running "$target_pid" && [[ -d "$lock_dir" ]]; then
    fail "unable to stop existing runner process ${target_pid}."
  fi
}

acquire_lock() {
  local acquisition_attempt=0
  local owner_pid=""
  local publication_attempt=0
  local removal_status=0

  while [[ "$acquisition_attempt" -lt 20 ]]; do
    acquisition_attempt=$((acquisition_attempt + 1))
    critical_section=1
    if mkdir "$lock_dir" 2>/dev/null; then
      lock_owned=1
      chmod 700 "$lock_dir"
      printf '%s\n' "$$" > "$lock_pid_file"
      critical_section=0
      service_pending_signal
      return 0
    fi
    critical_section=0
    service_pending_signal

    [[ -d "$lock_dir" ]] ||
      fail "unable to create runner lock: ${lock_dir}"

    publication_attempt=0
    while [[ ! -f "$lock_pid_file" && "$publication_attempt" -lt 20 ]]; do
      [[ -d "$lock_dir" ]] || break
      sleep 0.05
      publication_attempt=$((publication_attempt + 1))
    done
    if [[ -f "$lock_pid_file" ]]; then
      owner_pid="$(< "$lock_pid_file")"
    else
      owner_pid=""
    fi

    if [[ "$owner_pid" =~ ^[0-9]+$ ]] &&
       process_is_running "$owner_pid" &&
       pid_belongs_to_runner "$owner_pid"; then
      stop_existing_runner "$owner_pid"
      continue
    fi

    printf 'Local PostgreSQL runner: reclaiming stale runner lock: %s\n' \
      "$lock_dir" >&2
    if remove_observed_lock "$owner_pid"; then
      continue
    else
      removal_status=$?
    fi
    if [[ "$removal_status" -eq 2 ]]; then
      continue
    fi
    fail "unable to reclaim stale runner lock: ${lock_dir}"
  done
  fail "unable to acquire or reclaim runner lock: ${lock_dir}"
}

run_child() {
  local child_status
  local completed_child_pid=""
  critical_section=1
  set -m
  "$@" &
  child_pid=$!
  completed_child_pid="$child_pid"
  if [[ "$lock_owned" -eq 1 ]]; then
    printf '%s\n' "$child_pid" > "$lock_child_pid_file"
  fi
  set +m
  critical_section=0
  service_pending_signal
  if wait "$child_pid"; then
    child_status=0
  else
    child_status=$?
  fi
  if [[ -f "$lock_child_pid_file" ]] &&
     [[ "$(< "$lock_child_pid_file")" == "$completed_child_pid" ]]; then
    rm -f -- "$lock_child_pid_file"
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
  rm -f -- "$lock_child_pid_file"
  child_pid=""
}

cleanup() {
  local original_status=$?
  local cleanup_status=0
  local owner_pid=""
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
    owner_pid=""
    if [[ -f "$lock_pid_file" ]]; then
      owner_pid="$(< "$lock_pid_file")"
    fi
    if [[ "$owner_pid" == "$$" ]]; then
      rm -f -- "$lock_child_pid_file"
      rm -f -- "$lock_pid_file"
      rmdir "$lock_dir" 2>/dev/null || true
    fi
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

resource_ids_are_subset() {
  local subset="$1"
  local superset="$2"
  local candidate=""

  while IFS= read -r candidate; do
    [[ -n "$candidate" ]] || continue
    grep -Fqx -- "$candidate" <<< "$superset" || return 1
  done <<< "$subset"
}

inspect_runner_resources() {
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
}

runner_resources_exist() {
  [[ -n "$project_containers" || -n "$legacy_containers" ||
     -n "$project_networks" || -n "$exact_default_network" ||
     -n "$volume_users" ]]
}

runner_resources_form_exact_stack() {
  [[ "$volume_exists" -eq 1 && -n "$project_containers" &&
     -n "$project_networks" && -n "$volume_users" ]] || return 1
  resource_ids_are_subset "$legacy_containers" "$project_containers" || return 1
  resource_ids_are_subset "$exact_default_network" "$project_networks" || return 1
  resource_ids_are_subset "$volume_users" "$project_containers"
}

[[ "$#" -eq 0 ]] || fail "arguments are not supported."
[[ -n "$runtime_tmp_dir" && -d "$runtime_tmp_dir" && -w "$runtime_tmp_dir" ]] ||
  fail "no writable temporary directory is available for the runner lock."
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
acquire_lock

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

inspect_runner_resources
if runner_resources_exist; then
  runner_resources_form_exact_stack ||
    fail "runner resources already exist or the retained volume is in use; inspect them before retrying."
  printf '%s\n' \
    "Local PostgreSQL runner: removing stale runner container and network." >&2
  run_child "${compose[@]}" down --timeout 10 ||
    fail "unable to remove stale runner container and network."
  inspect_runner_resources
  runner_resources_exist &&
    fail "stale runner resources remain after targeted cleanup; inspect them before retrying."
fi

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
