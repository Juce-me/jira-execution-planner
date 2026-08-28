#!/usr/bin/env bash
set -euo pipefail

readonly repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly expected_ci_url="postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_ci"

fail() {
  printf 'PostgreSQL CI runner: %s\n' "$*" >&2
  exit 1
}

[[ "$#" -eq 0 ]] || fail "arguments are not supported."
[[ "${GITHUB_ACTIONS:-}" == "true" ]] || fail "this runner is for GitHub Actions only."
[[ "${DATABASE_URL:-}" == "$expected_ci_url" ]] ||
  fail "DATABASE_URL must be the exact synthetic CI target."
[[ "${TEST_DATABASE_URL:-}" == "$expected_ci_url" ]] ||
  fail "TEST_DATABASE_URL must be the exact synthetic CI target."

cd "$repo_root"
export DATABASE_CONNECTION_MODE=url
export REQUIRE_POSTGRES_USER_VIEW_CONCURRENCY=1

python -m alembic -c backend/db/alembic.ini upgrade head
python -m unittest -v \
  tests.test_db_migrations \
  tests.test_token_refresh_race \
  tests.test_user_view_config_concurrency
