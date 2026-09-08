# Local PostgreSQL Runner

This source-checkout-only runner starts PostgreSQL in Docker, applies Alembic migrations, runs startup preflight, and then runs Flask from `.venv`. It is localhost-only and is not part of the application image, release archive, or production startup path.

## Run

Prerequisites: Docker Engine 28+ with a local Unix-socket context, Docker Compose with `--wait-timeout`, `.venv`, and a valid local `.env` for the application's auth/encryption settings.

```bash
./runners/local/run.sh
```

Press `Ctrl+C` to stop Flask and remove the runner's PostgreSQL container and network. The `jira-planning-local-postgres` volume remains, so database data survives the next run. Docker prune, Docker Desktop reset, or manual volume deletion can still remove it.

Starting the command again while another local runner is active stops that runner and waits for its cleanup before taking ownership. Shutdown first uses `TERM`; if the old runner does not exit within the bounded grace period, replacement escalates to `KILL` and terminates the child process group recorded by that runner.

The runner always binds Flask and PostgreSQL to `127.0.0.1`, accepts no overrides, and refuses remote Docker contexts or ambiguous existing runner resources. The `jep`/`jep` database credentials are for this dedicated local container only. Docker access is host-administrator access, and the retained volume can contain sensitive local configuration or encrypted token records.

The lock records the runner PID. It uses `/tmp` when available and otherwise uses the operating system's per-user temporary directory. Startup validates that the live PID belongs to `runners/local/run.sh` before signalling it; it does not signal unrelated processes. If the PID is missing, malformed, dead, or belongs to another command, startup reclaims stale or corrupt lock metadata automatically. If the lock path cannot be created, contains unexpected entries, or cannot be removed, startup reports the problem once and exits with an actionable error instead of retrying. Existing exact-project Docker resource checks still fail closed, so ambiguous containers, networks, or volume users are never removed as stale lock cleanup.

If startup reports ambiguous runner resources after lock recovery, inspect only the exact `jira-planning-local` Compose project named in the error. Do not use broad Docker prune commands or `backend.db.reset_local` as lifecycle cleanup.
