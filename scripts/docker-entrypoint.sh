#!/bin/sh
set -eu

if [ "${RUN_DB_MIGRATIONS:-false}" = "true" ]; then
  python -m alembic -c backend/db/alembic.ini upgrade head
fi

python scripts/check_startup_preflight.py

exec gunicorn \
  --bind "${APP_BIND_HOST:-127.0.0.1}:${PORT:-5050}" \
  --workers "${WEB_CONCURRENCY:-1}" \
  --threads "${GUNICORN_THREADS:-8}" \
  --timeout "${GUNICORN_TIMEOUT:-120}" \
  --access-logfile - \
  --error-logfile - \
  jira_server:app
