# Root Cleanup And Postmortem Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the repo root to entry points, packaging, and toolchain configs: move images to `assets/`, move `install.sh` to `scripts/`, delete the redundant `QUICKSTART_ENV.txt`, relocate `TODO.md` and the orphaned `project-context/architecture.md` under `docs/`, move `postmortem/` to `docs/postmortem/`, and update `AGENTS.md`, subfolder `AGENTS.md` files, `README.md`, tests, Dockerfile, and the release workflow to match.

**Architecture:** Pure file relocation and reference rewriting — no behavior change. Served URLs (`/favicon.ico`, `/epm-burst.svg`) stay identical; only the on-disk source paths behind them move, so `backend/security/policy.py`, `jira-dashboard.html`, and all frontend `src="..."` references stay untouched. Packaging tests, the Dockerfile, and `release-latest.yml` pin the old layout and must be updated in the same commit as each move.

**Tech Stack:** git mv, sed, Python `unittest`, Flask (route path check), GitHub Actions workflow YAML.

## Global Constraints

- New branch off up-to-date `main`; never implement on `main`. Branch name: `improvement/root-cleanup-docs-postmortems`.
- No `Co-Authored-By` trailers; no agent/tool branding in branch names, commits, or PR text.
- Every changed line traces to this cleanup; no drive-by refactors of unrelated code.
- `CLAUDE.md` and `GEMINI.md` must remain symlinks to their local `AGENTS.md` at root and in every moved folder.
- Do not touch `frontend/src/` or `frontend/dist/` (no frontend build needed; verify dist stays clean).
- Full Python suite is the baseline and the exit gate: `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests`.
- `jira_server.py` changes (icon route paths) require launching the server and verifying `/api/test` plus both icon URLs before claiming done.
- Wait for explicit user confirmation before any push.
- Gate sweep note: this plan touches no auth/DB/Home/EPM scope. Per `docs/plans/AGENTS.md`, list `GATE-*` docs at execution start (`rg --files docs/plans | rg '/GATE-'`); `GATE-05-home-write-capability.md` requires credentials that are out of scope here — record it as still blocked/untestable and do not edit its result fields without running its command.

## Out Of Scope (deliberate)

- `INSTALL.md`, `README.md`, `LICENSE`, `Makefile`, `Dockerfile`, `.dockerignore`, `.gitlab-ci.yml`, `.nvmrc`, `.env.example`, `package.json`, `pyproject.toml`, `requirements.txt`, `jira_server.py`, `jira-dashboard.html` stay at root. Entry points must stay next to `jira_server.py` (it serves the HTML and resolves paths via `os.path.dirname(__file__)`); CI/packaging configs are only discovered at root; `INSTALL.md` is pinned at root by `tests/test_env_config_docs.py`, `tests/test_project_packaging.py`, the release zip, and seven README links — moving it is churn with no hygiene gain.
- `docs/superpowers/specs/` is legacy (root `AGENTS.md` says new plans do not go there) but relocating those 8 historical specs is not part of this request. Leave them.
- Content rewrites of postmortems or plans. Only path strings change.

---

### Task 1: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Sync and branch**

```bash
git fetch origin
git switch -c improvement/root-cleanup-docs-postmortems origin/main
```

- [ ] **Step 2: Baseline test run (must be green before any change)**

Run: `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests`
Expected: OK (record the test count; the same count must pass at the end).

---

### Task 2: Move `postmortem/` to `docs/postmortem/`

**Files:**
- Move: `postmortem/` → `docs/postmortem/` (24 md files + `CLAUDE.md`/`GEMINI.md` symlinks)
- Modify: `AGENTS.md` (lines ~181–184, ~219, ~235), `README.md` (lines ~58, ~476, ~507–511), `docs/postmortem/AGENTS.md`, `docs/postmortem/README.md`, and every other `*.md` that spells the `postmortem/` path (includes `docs/plans/EXEC-stats-project-track-by-sprint.md`, several `DONE-*`/legacy plans, `docs/superpowers/specs/2026-04-28-epm-zero-manual-portfolio-default-design.md`, and MRT016/017/020/021 self-references)

**Interfaces:**
- Produces: canonical postmortem location `docs/postmortem/` with unchanged file names (`MRTXXX-short-title.md`), unchanged index (`docs/postmortem/README.md`), unchanged directory instructions (`docs/postmortem/AGENTS.md`).

- [ ] **Step 1: Move the directory**

```bash
git mv postmortem docs/postmortem
```

- [ ] **Step 2: Verify symlinks survived**

Run: `ls -la docs/postmortem/CLAUDE.md docs/postmortem/GEMINI.md`
Expected: both are symlinks pointing to `AGENTS.md`.

- [ ] **Step 3: Rewrite path references repo-wide (idempotent sed — protects already-correct `docs/postmortem/`)**

```bash
grep -rl --include='*.md' 'postmortem/' . 2>/dev/null | grep -v node_modules | while read -r f; do
  sed -i '' -e 's|docs/postmortem/|__DPM__|g' -e 's|postmortem/|docs/postmortem/|g' -e 's|__DPM__|docs/postmortem/|g' "$f"
done
```

- [ ] **Step 4: Fix relative markdown links that the sed would have made self-nested**

Run: `grep -n '](docs/postmortem' docs/postmortem/*.md`
For any hit **inside** `docs/postmortem/` that is a relative markdown link (not backticked prose), rewrite the link target to `./<file>` form (e.g. `](./MRT020-project-track-filter-bar-bespoke-controls.md)`). Backticked prose like `` `docs/postmortem/README.md` `` is correct repo-relative text — leave it.

- [ ] **Step 5: Verify no stale references remain**

```bash
grep -rn --include='*.md' --include='*.py' --include='*.yml' '[^/]postmortem/' . | grep -v node_modules | grep -v 'docs/postmortem'
```

Expected: no output.

- [ ] **Step 6: Run tests**

Run: `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests`
Expected: OK, same count as baseline.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: move postmortems under docs/postmortem and update references"
```

---

### Task 3: Move root images to `assets/`

**Files:**
- Move: `epm-burst.svg` → `assets/epm-burst.svg`, `favicon.ico` → `assets/favicon.ico`
- Modify: `jira_server.py:5836` and `jira_server.py:5844` (icon file paths), `Dockerfile` (runtime COPY), `tests/test_container_packaging.py:29`, `.github/workflows/release-latest.yml:62`
- Do NOT modify: `jira-dashboard.html`, `frontend/src/ui/LoadingState.jsx`, `frontend/src/dashboard.jsx`, `backend/security/policy.py`, UI tests — they reference the **URLs** `/favicon.ico` and `/epm-burst.svg`, which do not change.

**Interfaces:**
- Produces: `assets/` directory at repo root for static assets (matches root `AGENTS.md` section 3 default layout). Server routes `/favicon.ico` and `/epm-burst.svg` keep serving the same bytes.

- [ ] **Step 1: Move the files**

```bash
mkdir assets
git mv epm-burst.svg favicon.ico assets/
```

- [ ] **Step 2: Update the two route handlers in `jira_server.py`**

At ~line 5836 change:

```python
    favicon_path = os.path.join(os.path.dirname(__file__), 'favicon.ico')
```

to:

```python
    favicon_path = os.path.join(os.path.dirname(__file__), 'assets', 'favicon.ico')
```

At ~line 5844 change:

```python
    icon_path = os.path.join(os.path.dirname(__file__), 'epm-burst.svg')
```

to:

```python
    icon_path = os.path.join(os.path.dirname(__file__), 'assets', 'epm-burst.svg')
```

(Confirm with `grep -n "epm-burst.svg\|favicon.ico" jira_server.py` that these are the only two file-path references; route decorators `@app.route('/favicon.ico')` / `@app.route('/epm-burst.svg')` stay unchanged.)

- [ ] **Step 3: Update `Dockerfile`**

Change:

```dockerfile
COPY jira_server.py jira-dashboard.html favicon.ico epm-burst.svg ./
```

to:

```dockerfile
COPY jira_server.py jira-dashboard.html ./
COPY assets ./assets
```

- [ ] **Step 4: Update `tests/test_container_packaging.py` (`test_dockerfile_includes_runtime_source_layout`)**

Change the required-lines tuple entry:

```python
            "COPY jira_server.py jira-dashboard.html favicon.ico epm-burst.svg ./",
```

to:

```python
            "COPY jira_server.py jira-dashboard.html ./",
            "COPY assets ./assets",
```

- [ ] **Step 5: Update `.github/workflows/release-latest.yml` "Create release zip" step**

Change:

```yaml
          cp jira_server.py jira-dashboard.html favicon.ico epm-burst.svg requirements.txt install.sh pyproject.toml .env.example INSTALL.md README.md LICENSE release-info.json release-root/
```

to:

```yaml
          cp jira_server.py jira-dashboard.html requirements.txt install.sh pyproject.toml .env.example INSTALL.md README.md LICENSE release-info.json release-root/
          cp -R assets release-root/
```

(`install.sh` moves out of this line in Task 4; keep it here for now so each commit stays green.)

- [ ] **Step 6: Run packaging tests**

Run: `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_container_packaging tests.test_project_packaging`
Expected: OK.

- [ ] **Step 7: Launch the server and verify the routes serve the moved files**

```bash
.venv/bin/python jira_server.py &
sleep 3
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:5050/favicon.ico
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:5050/epm-burst.svg
curl -s http://localhost:5050/api/test
kill %1
```

Expected: `200 image/x-icon`, `200 image/svg+xml` (Flask may report `image/svg+xml; charset=utf-8`), and a JSON success body from `/api/test`. No dependency/runtime warnings before the Flask startup banner.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(repo): move root icons into assets/ and update packaging"
```

---

### Task 4: Move `install.sh` to `scripts/` and ship `scripts/` in the release zip

**Files:**
- Move: `install.sh` → `scripts/install.sh`
- Modify: `README.md` (every `./install.sh` mention), `INSTALL.md` (every `./install.sh` mention), `AGENTS.md` (Commands: `Optional bootstrap: ./install.sh`), `tests/test_project_packaging.py:16` and `:39`, `.github/workflows/release-latest.yml` (zip step)

**Interfaces:**
- Produces: `scripts/install.sh`, invoked as `./scripts/install.sh` from repo root or extracted release root. The release zip now contains the whole `scripts/` directory (this also fixes an existing gap: `INSTALL.md` tells release users to run `scripts/check_startup_preflight.py`, which the zip previously did not include).

- [x] **Step 1: Move the script**

```bash
git mv install.sh scripts/install.sh
```

(No content change needed: the script uses `pwd`-relative paths — `python3 -m venv .venv`, `pip install -r requirements.txt` — so it must be run from the repo/release root, which `./scripts/install.sh` preserves.)

- [x] **Step 2: Rewrite invocation docs**

```bash
grep -rln --include='*.md' '\./install\.sh' README.md INSTALL.md AGENTS.md | while read -r f; do
  sed -i '' 's|\./install\.sh|./scripts/install.sh|g' "$f"
done
grep -rn 'install\.sh' README.md INSTALL.md AGENTS.md
```

Expected after: every remaining mention reads `./scripts/install.sh` or `scripts/install.sh`. Fix any bare `install.sh` mentions by hand (e.g. `AGENTS.md` line `- Optional bootstrap: ./install.sh`).

- [x] **Step 3: Update `tests/test_project_packaging.py`**

Line 16, change:

```python
        source = (ROOT / "install.sh").read_text(encoding="utf8")
```

to:

```python
        source = (ROOT / "scripts" / "install.sh").read_text(encoding="utf8")
```

In `test_release_workflow_defines_runnable_zip_shape`, remove `"install.sh",` from the `runtime_file` tuple (after Step 4 the workflow copies the whole directory, so no literal `install.sh` string remains) and add directory-copy assertions next to the existing `cp -R` assertion:

```python
        self.assertIn("cp -R backend planning frontend release-root/", source)
        self.assertIn("cp -R assets release-root/", source)
        self.assertIn("cp -R scripts release-root/", source)
```

- [x] **Step 4: Update `.github/workflows/release-latest.yml` zip step**

Change the `cp` line from Task 3 Step 5 to drop `install.sh` and add the scripts directory:

```yaml
          cp jira_server.py jira-dashboard.html requirements.txt pyproject.toml .env.example INSTALL.md README.md LICENSE release-info.json release-root/
          cp -R assets release-root/
          cp -R scripts release-root/
```

The final zip step block should read:

```yaml
          mkdir -p release-root
          cp -R backend planning frontend release-root/
          rm -rf release-root/frontend/src
          find release-root/frontend -mindepth 1 -maxdepth 1 ! -name dist -exec rm -rf {} +
          cp jira_server.py jira-dashboard.html requirements.txt pyproject.toml .env.example INSTALL.md README.md LICENSE release-info.json release-root/
          cp -R assets release-root/
          cp -R scripts release-root/
          find release-root -name "__pycache__" -type d -prune -exec rm -rf {} +
          find release-root -name "*.pyc" -delete
          cd release-root
          zip -r ../jira-execution-planner-latest.zip .
```

- [x] **Step 5: Run packaging tests and a script smoke check**

Run: `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_project_packaging tests.test_container_packaging`
Expected: OK.
Run: `bash -n scripts/install.sh`
Expected: no output (syntax OK).

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(repo): move install.sh under scripts/ and ship scripts in release zip"
```

---

### Task 5: Remove/relocate remaining root stragglers

**Files:**
- Delete: `QUICKSTART_ENV.txt` (its own header defers to `INSTALL.md`; content is a duplicate checklist of `INSTALL.md` and the README quick start)
- Move: `TODO.md` → `docs/TODO.md`
- Move: `project-context/architecture.md` → `docs/architecture.md`; remove the now-empty `project-context/`
- Modify: `docs/TODO.md` (drop the one executed item), `docs/plans/FUTURE-codebase-operability-improvements.md` (P2 quickstart row), `README.md` (repository guide list)

**Interfaces:**
- Produces: root contains no loose docs besides `README.md`, `INSTALL.md`, `LICENSE`, `AGENTS.md` (+symlinks).

- [ ] **Step 1: Delete and move**

```bash
git rm QUICKSTART_ENV.txt
git mv TODO.md docs/TODO.md
git mv project-context/architecture.md docs/architecture.md
rmdir project-context 2>/dev/null || true
```

- [ ] **Step 2: Prune the executed item from `docs/TODO.md`**

Remove the whole `## Now` block (scenario planner versioned draft history) — it shipped; see `docs/plans/DONE-scenario-planner-quarter-drafts-00-overview.md`. Keep every other section verbatim.

- [ ] **Step 3: Update the stale forward reference in `docs/plans/FUTURE-codebase-operability-improvements.md`**

In the P2 row `Replace obsolete quickstart docs`, change the files cell `` `QUICKSTART_ENV.txt`, `README.md`, `AGENTS.md` `` to `` `README.md`, `AGENTS.md` `` and append to the outcome cell: `QUICKSTART_ENV.txt was removed in the root cleanup; INSTALL.md is the single install doc.` Leave `docs/plans/DONE-codebase-operability-doc-cleanup.md` untouched (historical audit record).

- [ ] **Step 4: Check nothing else references the removed/moved names**

```bash
grep -rn 'QUICKSTART_ENV\|project-context' --include='*.md' --include='*.py' --include='*.yml' --include='*.html' --include='Makefile' . | grep -v node_modules | grep -v docs/plans/DONE-
grep -rn '\bTODO\.md' --include='*.md' --include='*.py' . | grep -v node_modules | grep -v docs/plans/2026-
```

Expected: no output (legacy `DONE-*`/dated plan mentions are allowed to remain).

- [ ] **Step 5: Sanity-check `docs/architecture.md` for contradictions**

Read `docs/architecture.md` once. It is an unreferenced agent-bootstrap doc; if any statement contradicts current root `AGENTS.md` (e.g., stale layout claims), add a one-line note at the top: `> Historical bootstrap notes. Root AGENTS.md is the source of truth for agent behavior.` Do not rewrite its content.

- [ ] **Step 6: Run tests and commit**

Run: `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests`
Expected: OK.

```bash
git add -A
git commit -m "chore(repo): remove quickstart duplicate, move TODO and architecture notes to docs/"
```

---

### Task 6: Align `AGENTS.md`, subfolder `AGENTS.md`, `README.md`, and the plan index

**Files:**
- Modify: `AGENTS.md` (section 10 Layout + Commands + repo-specific constraints; most postmortem/install.sh strings were already rewritten by Tasks 2 and 4 — this task verifies and finishes), `README.md` (project structure tree and repository guide), `docs/postmortem/AGENTS.md` (title/index lines — verify Task 2 sed result reads correctly), `docs/plans/README.md` (add this plan to the index)

**Interfaces:**
- Produces: docs that describe the new layout exactly; no reference anywhere to root-level `postmortem/`, `install.sh`, `TODO.md`, `QUICKSTART_ENV.txt`, `epm-burst.svg`, `favicon.ico`, or `project-context/`.

- [ ] **Step 1: Update root `AGENTS.md` section 10 Layout**

Change:

```markdown
- Docs: `docs/features/`, `docs/AGENTS.md`, `docs/postmortem/`
```

(confirm the Task 2 sed already produced this) and extend the Layout list with the new asset location so it reads:

```markdown
### Layout
- Backend/API: `jira_server.py`, `backend/epm/`, `backend/routes/`, `planning/`
- Frontend source: `frontend/src/`, `jira-dashboard.html`
- Generated frontend output: `frontend/dist/`
- Static assets: `assets/`
- Tests: `tests/`, `tests/ui/`
- Docs: `docs/features/`, `docs/AGENTS.md`, `docs/postmortem/`
```

- [ ] **Step 2: Verify the remaining root `AGENTS.md` strings**

```bash
grep -n 'postmortem\|install\.sh\|QUICKSTART\|project-context\|TODO\.md' AGENTS.md
```

Expected: every postmortem mention says `docs/postmortem/...`; the bootstrap command says `./scripts/install.sh`; no other hits.

- [ ] **Step 3: Add the root-hygiene rule to root `AGENTS.md` section 10 Conventions**

Append one line to the Conventions list:

```markdown
- Keep the repo root to entry points and packaging/toolchain configs; images belong in `assets/`, scripts in `scripts/`, docs (including `TODO.md` and postmortems) under `docs/`
```

- [ ] **Step 4: Update `README.md` structure surfaces**

- Repository guide list (~line 54–58): `install.sh` entry → `scripts/install.sh`; `postmortem/` entry → `docs/postmortem/` (index in `docs/postmortem/README.md`); remove any `QUICKSTART_ENV.txt`/`TODO.md` root entries; add `assets/` if the list enumerates root items.
- Project structure tree (~line 476): move `postmortem/` under `docs/`, add `assets/`, show `scripts/install.sh`.
- Contribution notes (~lines 507–511): confirm Task 2 sed produced `docs/postmortem/...` in all three lines.

- [ ] **Step 5: Verify `docs/postmortem/AGENTS.md` reads correctly after the sed**

Title should be `# docs/postmortem/AGENTS.md`; index-maintenance bullet should say `Update docs/postmortem/README.md.`. Fix by hand if the sed produced anything else.

- [ ] **Step 6: Add this plan to `docs/plans/README.md`**

Append an entry in the style of the existing index, under the most fitting section (or a short `## Repo Hygiene` section at the end):

```markdown
## Repo Hygiene

- `EXEC-root-cleanup-docs-postmortems.md`
  - Root-folder cleanup: icons to `assets/`, `install.sh` to `scripts/`, postmortems to `docs/postmortem/`, redundant root docs removed, AGENTS/README aligned.
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: align AGENTS, README, and plan index with new repo layout"
```

---

### Task 7: Add postmortem MRT022 — agent-branded branch names

**Files:**
- Create: `docs/postmortem/MRT022-agent-branded-branch-names.md`
- Modify: `docs/postmortem/README.md` (append index row), `AGENTS.md` (one new line in section 11 Project Learnings)

**Interfaces:**
- Consumes: `docs/postmortem/` layout from Task 2. Follow `docs/postmortem/AGENTS.md` rules: blameless, sequential ID, index update.

- [ ] **Step 1: Write `docs/postmortem/MRT022-agent-branded-branch-names.md`**

Author it with the standard sections (Impact, Root Cause, Timeline, Resolution, Verification, Lessons Learned, Prevention, Action Items) from these facts, all of which are verified:

- Incident: coding-agent sessions in this repo repeatedly started work on auto-generated, agent-branded branches named `claude/<codename>-<hash>` (observed 2026-07-08: branch `claude/vibrant-edison-6cc684` in a worktree). Root `AGENTS.md` forbids this twice: section 6 non-negotiable "No agent/tool branding … in branch names", and section 10 Git workflow "Use a dedicated `feature/`, `bugfix/`, `improvement/`, or `docs/` branch".
- Impact: convention violations recurred across sessions; the user had to notice and ask for the fix (2026-07-08); risk that a branded branch name reaches the remote or a PR. No code impact.
- Root cause (blameless): the agent harness auto-creates the branch at session start, *before* the agent reads `AGENTS.md`. The agent then treated the pre-existing branch name as given infrastructure rather than a violation to correct — the rules say what branch names must look like but no rule said "check and rename the current branch at session start", so the check was never triggered.
- Resolution: on 2026-07-08 the session branch was renamed to `docs/root-cleanup-plan`, and cleanup execution moved to `improvement/root-cleanup-docs-postmortems`; this postmortem plus a section 11 learning line make the session-start check explicit.
- Prevention: the new AGENTS.md learning (Step 2), plus this postmortem as the reviewable record.
- Verification: `git branch --show-current` prints a conventionally named branch before the first commit of a session.

Do not include real Jira issue keys, local absolute paths, emails, or tool marketing language beyond naming the branch pattern itself.

- [ ] **Step 2: Add the learning line to root `AGENTS.md` section 11**

Append to the Project Learnings list:

```markdown
- At session start, before the first commit, check `git branch --show-current`; if the branch is auto-generated or agent-branded (e.g. `claude/*`), rename it to `feature/`|`bugfix/`|`improvement/`|`docs/` + kebab-case summary (see docs/postmortem/MRT022-agent-branded-branch-names.md).
```

- [ ] **Step 3: Append the index row to `docs/postmortem/README.md`**

Add to the bottom of the postmortem table, matching the existing column format:

```markdown
| [MRT022](./MRT022-agent-branded-branch-names.md) | Agent-Branded Branch Names Ignored Git Conventions | 2026-07-08 | Low | Resolved | Sessions repeatedly started on auto-generated `claude/*` branches despite AGENTS.md forbidding tool branding and requiring typed branch prefixes; fixed with a session-start rename rule in AGENTS.md section 11 |
```

- [ ] **Step 4: Commit**

```bash
git add docs/postmortem/MRT022-agent-branded-branch-names.md docs/postmortem/README.md AGENTS.md
git commit -m "docs(postmortem): MRT022 agent-branded branch names ignored git conventions"
```

---

### Task 8: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full Python suite**

Run: `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests`
Expected: OK with the same test count as the Task 1 baseline.

- [ ] **Step 2: Confirm no frontend churn**

Run: `git status --porcelain -- frontend/`
Expected: empty (no source touched, no rebuild needed).

- [ ] **Step 3: Server launch check (required because `jira_server.py` changed)**

Repeat Task 3 Step 7 (launch, curl `/api/test`, `/favicon.ico`, `/epm-burst.svg`, kill). Expected: all 200, no pre-banner warnings.

- [ ] **Step 4: Stale-path sweep**

```bash
git grep -n 'QUICKSTART_ENV\|project-context/' -- '*.md' '*.py' '*.yml' | grep -v docs/plans/DONE-
git grep -n '[^/]postmortem/' -- '*.md' '*.py' '*.yml' | grep -v docs/postmortem
ls AGENTS.md CLAUDE.md GEMINI.md README.md INSTALL.md LICENSE Makefile Dockerfile
```

Expected: first two greps empty; root listing shows only the intended survivors plus configs.

- [ ] **Step 5: Review history and stop for user confirmation before push**

```bash
git log --oneline -8
```

Report results; do not push or open a PR until the user confirms. PR notes need no screenshots (no UI change) but must state the URL-compatibility invariant (`/favicon.ico` and `/epm-burst.svg` unchanged) and use no real issue keys or local paths.
