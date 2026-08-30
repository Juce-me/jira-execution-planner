# Local PostgreSQL Runner

This source-checkout-only runner starts PostgreSQL in Docker, applies Alembic migrations, runs startup preflight, and then runs Flask from `.venv`. It is localhost-only and is not part of the application image, release archive, or production startup path.

## Run

Prerequisites: Docker Engine 28+ with a local Unix-socket context, Docker Compose with `--wait-timeout`, `.venv`, and a valid local `.env` for the application's auth/encryption settings.

```bash
./runners/local/run.sh
```

Press `Ctrl+C` to stop Flask and remove the runner's PostgreSQL container and network. The `jira-planning-local-postgres` volume remains, so database data survives the next run. Docker prune, Docker Desktop reset, or manual volume deletion can still remove it.

The runner always binds Flask and PostgreSQL to `127.0.0.1`, accepts no overrides, and refuses remote Docker contexts or ambiguous existing runner resources. The `jep`/`jep` database credentials are for this dedicated local container only. Docker access is host-administrator access, and the retained volume can contain sensitive local configuration or encrypted token records.

If a prior process was killed without cleanup, inspect the exact `jira-planning-local` Compose project and the lock path reported by the runner. Do not use broad Docker prune commands or `backend.db.reset_local` as lifecycle cleanup.

Only after confirming that no runner process is active and no exact `jira-planning-local` Compose project, container, network, or volume user is active, remove only the empty fixed lock directory with:

```bash
rmdir /tmp/jira-planning-local-runner.lock
```
