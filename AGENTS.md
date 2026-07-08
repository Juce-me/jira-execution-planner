# AGENTS.md

Template version: 2026-06-28

Drop-in operating instructions for coding agents. Read this file before every task.

**Working code only. Finish the job. Plausibility is not correctness.**

This file follows the [AGENTS.md](https://agents.md) open standard (Linux Foundation / Agentic AI Foundation). Claude Code, Codex, Cursor, Windsurf, Copilot, Aider, Devin, Amp read it natively. For tools that look elsewhere, symlink at the project root:

```bash
ln -s AGENTS.md CLAUDE.md
ln -s AGENTS.md GEMINI.md
```

For any directory-specific `AGENTS.md`, create the same colocated `CLAUDE.md` and `GEMINI.md` symlinks from that subfolder.

When the agent runtime supports Superpowers, install or enable it for the project on first start and invoke `using-superpowers` before ordinary task handling. If Superpowers is unavailable, say so explicitly and continue with this file as the fallback.

---

## 0. Non-negotiables

These rules override everything else in this file when in conflict:

1. **No flattery, no filler.** Skip openers like "Great question", "You're absolutely right", "Excellent idea", "I'd be happy to". Start with the answer or the action.
2. **Disagree when you disagree.** If the user's premise is wrong, say so before doing the work. Agreeing with false premises to be polite is the single worst failure mode in coding agents.
3. **Never fabricate.** Not file paths, not commit hashes, not API names, not test results, not library functions. If you don't know, read the file, run the command, or say "I don't know, let me check."
4. **Stop when confused.** If the task has two plausible interpretations, ask. Do not pick silently and proceed.
5. **Touch only what you must.** Every changed line must trace directly to the user's request. No drive-by refactors, reformatting, or "while I was in there" cleanups.

The git and repo rules marked non-negotiable in section 6 rank with this list.

---

## 1. Before writing code

**Goal: understand the problem and the codebase before producing a diff.**

- State your plan in one or two sentences before editing. For anything non-trivial, produce a numbered list of steps with a verification check for each.
- Do not create persistent agent plan files unless explicitly needed; when needed, use `docs/agents/` per `docs/AGENTS.md`, not `docs/superpowers/`.
- If Superpowers is active, use the relevant Superpowers skills for planning and execution. Use `writing-plans` for implementation plans, then `subagent-driven-development` when available or `executing-plans` for plan execution.
- Read the files you will touch. Read the files that call the files you will touch. Claude Code: use subagents for exploration so the main context stays clean.
- Match existing patterns in the codebase. If the project uses pattern X, use pattern X, even if you'd do it differently in a greenfield repo.
- Do not discard prior architecture constraints. Treat existing boundaries, public contracts, migration paths, and explicit decisions as requirements unless the user changes them.
- Surface assumptions out loud: "I'm assuming you want X, Y, Z. If that's wrong, say so." Do not bury assumptions inside the implementation.
- If context becomes uncertain, stop and state uncertainty. Say what is unknown, stale, or conflicting, then ask or verify before proceeding.
- If two approaches exist, present both with tradeoffs. Do not pick one silently. Exception: trivial tasks (typo, rename, log line) where the diff fits in one sentence.

---

## 2. Writing code: simplicity first

**Goal: the minimum code that solves the stated problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code. No configurability, flexibility, or hooks that were not requested.
- Reuse existing design elements. If a style, component, token, or pattern for what you need already exists in the project, use it. When changing reusable UI, docs, prompts, or workflow behavior, update the shared component, token, template, or instruction instead of creating a one-off local variant.
- No error handling for impossible scenarios. Handle the failures that can actually happen.
- If the solution runs 200 lines and could be 50, rewrite it before showing it.
- Do not simplify implementation for brevity. Prefer the shortest correct implementation, but never remove required behavior, architectural constraints, or edge-case handling just to shorten code or explanation.
- If you find yourself adding "for future extensibility", stop. Future extensibility is a future decision.
- Bias toward deleting code over adding code. Shipping less is almost always better.

The test: would a senior engineer reading the diff call this overcomplicated? If yes, simplify.

---

## 3. Surgical changes

**Goal: clean, reviewable diffs. Change only what the request requires.**

- Do not "improve" adjacent code, comments, formatting, or imports that are not part of the task.
- Do not refactor code that works just because you are in the file.
- Do not delete pre-existing dead code unless asked. If you notice it, mention it in the summary.
- Do clean up orphans created by your own changes (unused imports, variables, functions your edit made obsolete).
- Match the project's existing style exactly: indentation, quotes, naming, file layout.
- Put reusable project rules at the highest applicable level. Subfolder `AGENTS.md` files may add stricter constraints but must not redefine artifact naming, location, or other rules set by the root template or `docs/AGENTS.md` — if a different scheme is genuinely needed, change it at the template level so every project stays consistent. Keep `CLAUDE.md` and `GEMINI.md` symlinked to the local `AGENTS.md`.
- Place new files in the appropriate top-level subfolder (e.g., `assets/` for static assets, `scripts/` for tooling and automation, `src/` for sources, `tests/` for tests, `docs/` for documentation) instead of the project root. If the project has an established layout, follow it; otherwise use these defaults. Create a folder only when adding its first real file. Do not commit empty placeholders, `.keep` files, or scaffold directories.

The test: every changed line traces directly to the user's request. If a line fails that test, revert it.

---

## 4. Goal-driven execution

**Goal: define success as something you can verify, then loop until verified.**

Rewrite vague asks into verifiable goals before starting:

- "Add validation" becomes "Write tests for invalid inputs (empty, malformed, oversized), then make them pass."
- "Fix the bug" becomes "Write a failing test that reproduces the reported symptom, then make it pass."
- "Refactor X" becomes "Ensure the existing test suite passes before and after, and no public API changes."
- "Make it faster" becomes "Benchmark the current hot path, identify the bottleneck with profiling, change it, show the benchmark is faster."

For every task:

1. State the success criteria before writing code.
2. Write the verification (test, script, benchmark, screenshot diff) where practical.
3. Run the verification. Read the output. Do not claim success without checking.
4. If the verification fails, fix the cause, not the test.
5. Before ending execution from a plan or docs artifact, update the artifact, implementation plan, README, and affected docs to match the result.

---

## 5. Tool use and verification

- Prefer running the code to guessing about the code. If a test suite exists, run it. If a linter exists, run it. If a type checker exists, run it.
- Never report "done" based on a plausible-looking diff alone. Plausibility is not correctness.
- When debugging, address root causes, not symptoms. Suppressing the error is not fixing the error.
- For UI changes, verify visually: screenshot before, screenshot after, describe the diff.
- Run project commands through the project-local environment or pinned runtime manager whenever the toolchain supports it. For Python, prefer an existing `.venv`; create `.venv` if missing before installing dependencies or running Python-based install, build, test, lint/typecheck, or local-run commands. Use `.venv/bin/python -m ...` or activate `.venv` before invoking Python tools, and never install packages into system Python. For Node/npm, use the repo-pinned runtime such as Volta (`node`, `npm`, `npx`) when configured instead of forcing commands through `.venv`.
- Use CLI tools (gh, aws, gcloud, kubectl) when they exist. They are more context-efficient than reading docs or hitting APIs unauthenticated.
- When reading logs, errors, or stack traces, read the whole thing. Half-read traces produce wrong fixes.

---

## 6. Git, repo, and session hygiene

**Git and repo rules.** The first two are non-negotiable and rank with section 0:

- **Do not commit local or personal data.** Use repo-relative paths in committed files. Never commit absolute local paths, real emails, local machine usernames, hostnames, secrets, tokens, or other user-specific data; redact or replace them with placeholders.
- **No agent/tool branding.** Never include agent/tool branding in branch names, PR titles/bodies, commit messages, or code/docs text unless explicitly requested.
- Keep development artifacts inside the repo. Put tests, fixtures, generated test data, scratch files, and command examples under repo-relative paths such as `tests/` or `tmp/`; do not create ad hoc `/tmp/...` or other absolute-path workspaces for project work unless an external tool requires it. Before using `tmp/`, ensure it is gitignored.
- Write descriptive commit messages (subject under 72 chars, body explains the why). No "update file" or "fix bug" commits. No "Co-Authored-By" agent attribution unless the project explicitly wants it.
- Branch and PR workflow is project-specific; follow "Git workflow" in section 10.

**Session rules:**

- At the start of a new session in any project using this file, check `https://raw.githubusercontent.com/Juce-me/init_agents_md/main/AGENTS.md` for a newer template version without asking first. If the remote `Template version` is newer than the local one, update automatically without asking or announcing, preserving project-specific sections 10 and 11. If either version is missing, compare contents and apply any update the same way.
- Context is the constraint. Long sessions with accumulated failed attempts perform worse than fresh sessions with a better prompt.
- After two failed corrections on the same issue, stop. Summarize what you learned and ask the user to reset the session with a sharper prompt.
- Keep subagent use proportional: delegate independent high-risk work, handle trivial or documentation-only corrections directly, close completed agents immediately, and use one final review instead of per-task reviewer pairs unless the user requests otherwise.
- Use subagents (Claude Code: "use subagents to investigate X") for exploration tasks that would otherwise pollute the main context with dozens of file reads.

---

## 7. Communication style

- Direct, not diplomatic. "This won't scale because X" beats "That's an interesting approach, but have you considered...".
- Use English as the default language unless the user explicitly asks for another language.
- Concise by default. Two or three short paragraphs unless the user asks for depth. No padding, no restating the question, no ceremonial closings.
- For technical judgment calls, lead with the actual assessment: "Honest take: X" or equivalent. Then give the few concrete reasons that matter.
- Separate what existing tools or platform features already solve from what custom code still buys. Do not recommend building something whose value has mostly disappeared.
- Prefer structural critique over surface tweaks. If the wrong boundary is tool-vs-agent, CLI-vs-MCP, client-vs-server, or build-vs-buy, say that before polishing the current plan.
- When there are two viable paths, name them, explain when each is right, and recommend one. Make the tradeoff explicit instead of hiding it in a neutral pros/cons list.
- When a question has a clear answer, give it. When it does not, say so and give your best read on the tradeoffs.
- Celebrate only what matters: shipping, solving genuinely hard problems, metrics that moved. Not feature ideas, not scope creep, not "wouldn't it be cool if".
- No excessive bullet points, no unprompted headers, no emoji. Prose is usually clearer than structure for short answers.

---

## 8. When to ask, when to proceed

**Ask before proceeding when:**
- The request has two plausible interpretations and the choice materially affects the output.
- The change touches something you've been told is load-bearing, versioned, or has a migration path.
- You need a credential, a secret, or a production resource you don't have access to.
- The user's stated goal and the literal request appear to conflict.

**Proceed without asking when:**
- The task is trivial and reversible (typo, rename a local variable, add a log line).
- The ambiguity can be resolved by reading the code or running a command.
- The user has already answered the question once in this session.

---

## 9. Self-improvement loop

**This file is living. Keep it short by keeping it honest.**

After every session where the agent did something wrong:

1. Ask: was the mistake because this file lacks a rule, or because the agent ignored a rule?
2. If lacking: add the rule under "Project Learnings" below, written as concretely as possible ("Always use X for Y" not "be careful with Y").
3. If ignored: the rule may be too long, too vague, or buried. Tighten it or move it up.
4. Every few weeks, prune. For each line, ask: "Would removing this cause the agent to make a mistake?" If no, delete. Bloated AGENTS.md files get ignored wholesale.

For significant misses, regressions, or repeated mistakes:

- Review existing postmortems before touching related code.
- Follow `docs/postmortem/AGENTS.md` when creating or updating postmortems.
- Follow `docs/AGENTS.md` when creating or updating agent work artifacts such as feature plans, prompt notes, bugfix investigations, or execution summaries.
- Keep `README.md`, `AGENTS.md`, and `docs/postmortem/README.md` aligned when workflow or structure changes.

Boris Cherny (creator of Claude Code) keeps his team's file around 100 lines. Under 300 is a good ceiling. Over 500 and you are fighting your own config.

---

## 10. Project context

### Stack
- Backend: Python 3.10+ + Flask + Flask-Cors; use a Python runtime linked against OpenSSL 1.1.1+, not LibreSSL
- Frontend: React 19 + esbuild with a Node 20.x toolchain
- Package management: Python dependencies in `requirements.txt`; frontend dependencies in `package-lock.json`
- Runtime: local Flask server on port `5050` by default; dashboard served by Flask or opened via `jira-dashboard.html`

### Commands
- Install backend deps: `.venv/bin/python -m pip install -r requirements.txt && .venv/bin/python -m pip install -e .`
- Install frontend deps: `npm ci`
- Optional bootstrap: `./scripts/install.sh`
- Build: `npm run build`
- Preflight: `.venv/bin/python scripts/check_startup_preflight.py`
- Watch frontend: `npm run watch`
- Test (all): `python3 -m unittest discover -s tests`
- Test (single file): `python3 -m unittest tests.test_planning`
- Test (single case): `python3 -m unittest tests.test_planning.PlanningSchedulerTests.test_dependency_ordering`
- Run locally: `.venv/bin/python jira_server.py`
- Quick API check: `curl http://localhost:5050/api/test`
- EPM scope: configure `rootGoalKey` and `subGoalKey` in `Settings -> EPM`; the Atlassian site cloudId is detected from Jira /_edge/tenant_info

Prefer single-file or single-test runs during iteration. Run the full suite before push.

### Layout
- Backend/API: `jira_server.py`, `backend/epm/`, `backend/routes/`, `planning/`
- Frontend source: `frontend/src/`, `jira-dashboard.html`
- Generated frontend output: `frontend/dist/`
- Static assets: `assets/`
- Tests: `tests/`, `tests/ui/`
- Docs: `docs/features/`, `docs/AGENTS.md`, `docs/postmortem/`

### Conventions
- Python: 4-space indentation, `snake_case` functions, `CapWords` classes
- Frontend JS/JSX: `camelCase` variables/functions; match the existing patterns in `frontend/src/`
- Config keys in `.env` are `UPPER_SNAKE_CASE`
- No formatter or linter is enforced; match existing style in touched files
- Tests use `unittest` in `tests/test_*.py` with `test_*` methods
- Do not hand-edit `frontend/dist/`; rebuild it from `frontend/src/` with `npm run build`
- Reusable rules and design guidance belong at the highest applicable `AGENTS.md`; subfolder `AGENTS.md` files are for local constraints only.
- Keep `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` aligned at the root and in subfolders; `CLAUDE.md` and `GEMINI.md` should point to the local `AGENTS.md`.
- Agent work artifacts under `docs/agents/` use `YYYY-MM-DD-status-summary.md` per `docs/AGENTS.md`.
- Keep `AGENTS.md`, `README.md`, and other contributor docs aligned when workflow or structure changes
- User-visible feature changes must include analytics impact review: `trigger`, `event_type`, canonical `event_name`, `feature_name` or `page_name`, typed params, tests, `docs/README_ANALYTICS.md` taxonomy updates, and GA4 runbook updates when relevant; app-owned analytics must keep the two-trigger GTM dataLayer contract (`pageview`/`userevent`), avoid bulk custom-dimension registration, use `GA4_ENABLED` as the app-level transport gate without in-app consent UI, and never use `event_group`, `ga4_event_name`, Universal Analytics fields, or boolean presence dimensions such as `has_*`; if no event is needed, document the allowlist reason.
- Keep the repo root to entry points and packaging/toolchain configs; images belong in `assets/`, scripts in `scripts/`, docs (including `TODO.md` and postmortems) under `docs/`

### Repo-specific constraints
- Review relevant postmortems before making related changes. Add new postmortems under `docs/postmortem/` as `MRTXXX-short-title.md` and update `docs/postmortem/README.md`.
- Store Jira credentials in `.env`; never commit secrets.
- Server-side Jira and Home/Townsquare API-token credentials in `.env` are dedicated service-account credentials; do not ask individual users to create personal Atlassian API tokens for shared app auth.
- Service-account API tokens for `home_townsquare_basic` and `jira_basic` belong only in `service_integration_tokens`; never store them in normal-user `auth_tokens`.
- Treat `team-groups.json`, `team-catalog.json`, and `sprints_cache.json` as generated local caches.
- Never commit real Jira fixture data. Use synthetic or sanitized examples only, and never copy identifiable config-derived values into committed tests.
- Jira API pagination uses `nextPageToken` / `isLast`, not `startAt` / `total`. Verify response shapes before coding against them.
- Any new API plan in `docs/plans/` must use the same Jira pagination contract.
- EPM Project rollups are label-driven; each Project has one exact Jira label. No wildcard/fallback. Metadata-only Home projects still render the Home card plus `Settings -> EPM` CTA.
- `epm.labelPrefix` in `dashboard-config.json` is a Home tag mask such as `"rnd_project_*"` and also filters manual Jira-label autocomplete. Resolve each Home Project's exact matching tag as the Jira label; rollup JQL uses that full label, never the mask.
- Home/Townsquare-backed and Jira-project-backed EPM/APM surfaces are read-oriented for normal users; any mutation route for those surfaces requires an explicit tool-admin or service-account guard in the plan and implementation.
- Initial dashboard load is performance-critical. Avoid redundant requests, justify heavy endpoints, and measure before/after when claiming improvements.
- For analytics-style views, prefer one scoped fetch plus client-side regrouping/filtering. Re-fetch only when scope changes or the user explicitly refreshes.
- If per-issue Jira enrichment is required, define strict fan-out limits before implementation.
- If the user uses a domain term like `quarter`, map it to existing data structures before building new UI.
- Sticky order is `planning-panel.open` above `.epic-header`. When planning is closed, `.epic-header` sticks to the top. Re-verify Catch Up, Planning, and Scenario modes after changing sticky UI.
- In settings/config modals, preserve established selected-chip/remove/search behavior unless the user explicitly asks for a new interaction pattern.

### Git workflow
- Never implement on `main`. Use a dedicated `feature/`, `bugfix/`, `improvement/`, or `docs/` branch.
- Before editing, confirm the current branch and sync it when network access is available.
- Keep commits atomic and honest. Do not claim measured improvements you did not verify.
- For UI changes, include screenshots in the PR notes.
- Before push, run the full test suite, review `git log --oneline -5`, and wait for explicit user confirmation.
- Do not use the `using-git-worktrees` skill in this repo unless the user explicitly asks for a worktree.

---

## 11. Project Learnings

- Keep this section short and concrete.
- Add a new line only when the user corrects the agent and the correction is likely to recur.
- Tighten an existing line instead of adding a near-duplicate.
- Delete stale learnings when the underlying issue goes away.

When the user corrects your approach, append a one-line rule here before ending the session. Write it concretely ("Always use X for Y"), never abstractly ("be careful with Y"). If an existing line already covers the correction, tighten it instead of adding a new one. Remove lines when the underlying issue goes away (model upgrades, refactors, process changes).

- Keep auth-mode changes and OAuth entry screens isolated from `frontend/src/dashboard.jsx` unless the user explicitly approves dashboard auth UI.
- Keep progress updates compact: state the action directly instead of explaining routine tool choices.
- In settings UIs, when a value is already selected or the option set is small, default to a compact selected-state control and reveal search only on explicit change; do not leave persistent search inputs visible by default.
- In EPM settings project lists, sort only by table data columns; keep Home as a subtle icon beside the project name, never as a sort option or primary row action.
- Load saved EPM config with the initial user config bootstrap; never make the EPM board depend on opening Settings to populate saved scope/projects.
- For any scoped view, show the active scope value in that same view; do not treat request parameters or hidden React state as a substitute for visible controls.
- In EPM settings, never clear the saved sub-goal on modal open or project loading; the child goal drives cached project configuration, and EPM rollups use configured project labels plus selected sprint, not Jira teams.
- In EPM, `labelPrefix` is a Home tag mask such as `rnd_project_*`; resolve each Home project's exact matching tag as its Jira label, then use the selected sprint only when fetching/filtering leaf stories, not when discovering labeled Initiatives/Epics.
- Atlassian Home tag fetchers return normalized string tag lists; preserve those strings when building EPM project records instead of passing them through raw GraphQL shape extractors.
- For EPM Goal 2/3 planning, treat the Active sprint selector as already present; plan to wire selectedSprint into rollups and guard render priority, not rebuild the control.
- EPM Active rollups must fetch selected-sprint Stories under each labeled Epic and render them with the ENG Epic/Story/dependency structure.
- EPM project board headers must keep the collapse button separate from links, label pills, and long update text; never nest anchors or metadata inside the toggle.
- EPM Active visibility must be validated from Home project lifecycle labels as well as enum values, and Home project pagination caps must exceed current scoped Home goal sizes.
- EPM cold loads must warm project metadata before all-project rollups, and aggregate EPM endpoints must expose `Server-Timing` before performance tuning.
- EPM first-load project metadata must be scoped to the active lifecycle; Active includes pending, on-track, at-risk, and off-track Home projects, while Backlog is paused or todo only.
- In EPM settings Projects, keep rows compact: project name plus Home status on one line, no Home update snippets, and Jira label search hidden behind explicit Choose/Change actions.
- In EPM settings Projects, blank custom rows, including legacy rows with missing Home linkage, are draft-only: show an explicit delete action and drop fully empty rows before saving.
- In EPM settings Projects, put project name, Home status, Home link, and Jira label in stable cells so variable statuses do not distort the row.
- In EPM settings Projects, use table-style header sorting and compact icon actions in cells; avoid bulky text sort/change controls in headers or label chips.
- For UI screenshots, wait for CSS animations/transitions to settle or disable them before capturing visual proof.
- Line-chart legends and points must use readable in-app hover/readout states; never rely on native `title` tooltips or dark hover pills.
- In PR descriptions and final summaries, never include secrets, token placeholders, credential env vars, local absolute paths, or real project issue keys; use sanitized placeholders unless the user explicitly asks for real-key evidence.
- Put PR descriptions directly in the reply body unless the user explicitly asks for a file; do not create temporary PR body files.
- Treat Atlassian account ids only as stable identity keys for tool-local admin roles; never imply Atlassian tenant/admin status grants tool admin access.
- Redact OAuth callback query strings from logs; never log authorization code or state values.
- Store implementation plans in `docs/plans/` only.
- For any plan review, creation, or execution under `docs/plans/`, read `docs/plans/AGENTS.md` first and follow its plan review prompt, naming, and gate rules.
- Before creating or executing any Home/Townsquare auth migration plan, read `docs/plans/AGENTS.md` and run or document the Home GraphQL OAuth probe gate; do not mark Home/Townsquare-backed routes OAuth-ready unless it passes with a real local user 3LO session.
- After DB auth exists, Home/Townsquare 3LO plans must use DB `auth_connections`/encrypted `auth_tokens` and must not resolve route tokens through local OAuth token-store helpers.
- When an auth plan names a security gate, include the concrete implementation task and verification before the dependent handoff.
- For Atlassian OAuth work, treat Microsoft Entra/Azure SSO through Atlassian Cloud SSO as a primary acceptance path.
- Auth/backend plans must name and verify the user journey for each supported route surface; backend tests alone are not enough unless the route is explicitly developer-only.
- OAuth cookie-session slices must include unsafe-method CSRF protection before the first supported browser POST route.
- Local OAuth token stores must require both a local/dev environment key and an explicit allow flag at startup.
- Auth-expired states must have a visible recovery screen or re-auth target; do not leave users with only backend `401` JSON.
- Browser-focus auth refresh is an optimization only; keep the visible expired-auth recovery path as the fallback.
- Keep local task changes in the checkout the user is actively viewing; use a secondary worktree only when the user explicitly asks for one.
- For shared header/menu UI changes, add or update Playwright assertions for menu layering and icon/control geometry before reporting visual verification.
- Before merging backend dependency or startup-path changes, launch `.venv/bin/python jira_server.py` and verify `/api/test`.
- Treat Python dependency/runtime warnings before the Flask startup banner as failed server verification unless the warning is intentionally documented as benign.
- In settings, the config modal footer Save must persist all dirty editable sections together; keep each endpoint payload scoped to its own section instead of mixing department, admin, preference, or EPM fields.
- For cross-layer access or configuration changes, verify the backend response contract and the frontend render/edit/save gates together; do not treat backend route tests as enough when UI permissions control the user journey.
- Pre-DB OAuth treats every signed-in Atlassian user as a local tool admin; when environment JSON exists, settings should default to Team Groups/EPM workflows instead of setup tabs.
- Settings edit permission must fail closed until `/api/config` explicitly returns `userCanEditSettings: true`; never treat a missing flag or loading state as admin-editable.
- Team Groups saves must allow empty `teamIds`; group-level components, labels, and exclusions must save even when team discovery returns no teams.
- Dashboard config save endpoints must reject implicit empty overwrites of existing selected projects or groups; clearing shared JSON state needs an explicit action.
- DB/OAuth EPM must not require Jira/Home Basic credential environment variables; Home/Townsquare EPM reads use the current user's connected `atlassian_user_api_token`.
- DB/OAuth EPM routes use user OAuth for Jira REST and the current user's Home token only for Home/Townsquare metadata; worker-thread rollups must carry captured request auth context plus dashboard-derived config, Jira field IDs, and base JQL.
- Scenario Planner Jira publish/write-back plans must use only the signed-in user's OAuth Jira REST context; never use Jira/Home API tokens, Basic credentials, service integrations, Home/Townsquare APIs, or local token-store helpers for publishing.
- Treat Scenario Planner group scope as a shared environment-scoped PM/EPM-managed configuration reference; drafts may reference groups but must not create private group definitions or own group membership.
- In DB/OAuth mode, hide the EPM tab until the current user has connected a Home/Townsquare token in Settings; once visible, the EPM tab must expose an accessible EPM settings gear.
- At the start of auth/DB/Home/EPM plan work, scan `docs/plans/GATE-*.md` and update each gate's `Checked on` and `Last result`; never mark a gate passed without its documented `PASS` output.
- For OAuth Jira worker-thread fixes, verify a no-request-context test that reaches the real Jira auth wrapper; route mocks alone are not sufficient.
- Name active auth/DB/Home migration docs with `EXEC-*`, executed docs with `DONE-*`, support/reference/setup docs with `SUPPORT-*`, and deferred scope with `FUTURE-*`; keep expectations in `docs/plans/README.md`.
- Before executing a plan task, verify every named file in that task's file map exists unless the plan explicitly marks it `Create`.
- In mono vs cross UI, label denominator story points as Total SP, not Shared SP.
- In ENG filter cards, keep every card fixed-size with one-line labels and an inset fixed value/icon slot sized for up to three digits; selected Display filters use border-only state, not tinted fills.
- Chart legends must use native button controls, not span role=button handlers.
- Chart hover readouts inside transformed or scrollable panels must be pointer-positioned with width/height edge bounds and covered by Playwright edge assertions before commit.
- Chart hover readouts should size to content with a narrow max width; do not reserve a wide fixed box for short labels.
- Excluded Capacity and Mono vs Cross stats must use cached progressive stats-source requests and must not load or render ENG alerts, filters, or task lists for those tabs.
- In Mono vs Cross stats, Team Cross Share must render a per-sprint per-team graph of cross SP divided by total team story points; do not replace it with aggregate bars or text chips.
- In dashboard filters, reuse existing dropdown classes such as `team-dropdown-*` or `sprint-dropdown-*`; do not create bespoke hover, caret, radius, or action styles for one-off dropdowns.
- For EPM project board visual changes, preserve clear per-project boundaries and verify collapsed and expanded states with screenshots before committing.
- EPM project board status pills must reuse the existing status-pill sizing, casing, and success green; do not create one-off completed badge styling.
- When preparing PRs, keep feature commits on the feature branch; never merge feature work into local `main` just to create or test the PR branch.
- When frontend source changes, run `npm run build` and commit generated `frontend/dist` output if `.github/workflows/verify-frontend-build.yml` requires a clean post-build diff; do not hand-edit dist.
- For first-ever DB/OAuth users, require a focused department group-selection popup before dashboard group-scoped data loads; do not silently default them into all groups.
- Startup paths that read dashboard config before a Flask request exists must pass `source="jsonfile"` explicitly in DB config mode.
- In ENG story subtask rows, keep desktop columns table-aligned and drop low-priority mobile cells instead of cramming every column into narrow cards.
- Place ENG story subtask controls after the story Last Update meta on desktop; do not use title-row chips or status-stack placement.
- Keep expanded ENG story subtask lists compact and visually quiet; constrain desktop width instead of stretching rows across the whole card.
- Map ENG subtask workflow statuses such as Analysis and Release to colored progress chips, and keep story meta rows vertically centered.
- Keep ENG Show only cards in one desktop row and tighten widths/gaps before allowing filter-card wrapping or floating dependency-pill spacing.
- In ENG Catch Up controls, align alerts, Show only stats, and Display toggles as one compact control stack; avoid distributed tile spacing.
- In ENG Catch Up controls, Killed belongs only in the Display inclusion toggles; never duplicate it as a Show only stat filter.
- Keep ENG header dependency pills in the detail row/right lane so they do not increase the story title/header row height.
- Subtask-toggle animations must target `.story-subtasks-panel`; task removal animations must target the full `.task-item`, not dependency metadata or the remove button alone.
- Product renames must include all user-visible product-name surfaces: README, docs, browser title, app header, auth/recovery screens, installer output, package description, matching tests, and generated frontend output when source changes.
- For Lead Times/stats panel UI changes, verify long lists with more than 30 open and completed epics, active inner-view overflow, load-more behavior, and a screenshot before reporting completion.
- For ENG filter/display visual changes, keep Display controls in the same compact card grammar as Show only, and verify selected/unselected states side by side against the user's screenshot before reporting completion.
- Treat Ad Hoc capacity, including business-as-usual work, as included Product capacity; configure it separately from `excludedCapacityEpics`.
- When the user names a Jira field like `X[Dropdown]` (e.g. "Project Track[Dropdown]"), treat it as an existing Jira custom field to fetch by id and render (map values to emoji/icons), not a label convention to invent; discover the real field id and beware duplicate-named fields — pick the one actually populated on the target issues.
- Config-reading field-id getters (`get_*_field_config`) invoked from no-request-context helpers like `fetch_epic_details_bulk` must catch `ConfigStorageError` and fall back to the default field id in DB mode. Run the FULL Python suite (incl. `test_initiative_extraction`, `test_codebase_structure_budgets`) as the baseline and before claiming done — focused per-task runs miss no-request-context regressions and structure-budget breaches; ratchet the budgets when these legacy entrypoints legitimately grow.
- New ENG dropdowns placed inside the animated `.filters-strip` need a `:has(.<hook> .sprint-dropdown-panel)` z-index lift mirroring `.view-selector:has(.sprint-dropdown-panel)`, or the panel renders under `.task-list`; a Playwright `click({ force: true })` masks this real layering bug, so prove dropdown options are clickable with a normal click.
- For any new filter bar/control, reuse existing control components and classes (`SegmentedControl` via its `eng-mode-control` class, `.stats-control-group` + its `shell.css` `label` typography, the established inline checkbox/toggle pattern) instead of hand-rolling a bespoke group; a new class for a control that already exists is a review-stop. Never reserve control width with a magic-number `min-width` or use `white-space: nowrap` that overflows its box (MRT020).
- Reusing a shared component FORBIDS overriding its layout: pass its documented class hook (e.g. `eng-mode-control` on `SegmentedControl`) and never add local CSS that changes its `display`/`flex-wrap`/`height` — that is reinvention wearing the component's name, and it breaks the single-row/fixed-height rendering (MRT021). Assert each reused control's shared class + single-row/fixed-height in Playwright.
- A reported UI bug is a class, not one instance: when the user points at a broken control, audit EVERY sibling control of the same kind on that surface and add an element-level assertion per control before claiming the surface fixed. Fixing only the reported instance and signing off "ready" is the MRT020→MRT021 recurrence.
- Filter-bar/layout "visual verification" = a screenshot AND element-level geometry assertions on the actual text-bearing elements (label `getBoundingClientRect().right` within its group and clear of the next control; `scrollWidth`/`clientWidth` clip checks). Never rely only on sibling container bounding boxes — they cannot see overflowing `nowrap` text and give false green. Look at the screenshot, don't trust the assertion alone (MRT020).
- Use one categorical color resolver (e.g. `resolveProjectTrackColor`) as the single source of an entity's color across every chart/section; never let an entity (e.g. `No track`) fall through to a hash-assigned new color in one view while it is fixed in another.
- At session start, before the first commit, check `git branch --show-current`; if the branch is auto-generated or agent-branded (e.g. `claude/*`), rename it to `feature/`|`bugfix/`|`improvement/`|`docs/` + kebab-case summary (see docs/postmortem/MRT022-agent-branded-branch-names.md).
- Run `npm ci` in a fresh git worktree before `npm run build`; a build that resolves node_modules from an ancestor checkout embeds wrong relative paths in `dashboard.js.map` and fails the CI dist check.

---

## 12. How this file was built

This boilerplate synthesizes:
- Sean Donahoe's IJFW ("It Just F\*cking Works") principles: one install, working code, no ceremony.
- Andrej Karpathy's observations on LLM coding pitfalls (the four principles: think-first, simplicity, surgical changes, goal-driven execution).
- Boris Cherny's public Claude Code workflow (reactive pruning, keep it ~100 lines, only rules that fix real mistakes).
- Anthropic's official Claude Code best practices (explore-plan-code-commit, verification loops, context as the scarce resource).
- Community anti-sycophancy patterns (explicit banned phrases, direct-not-diplomatic).
- Project postmortem practice: blameless incident records, explicit verification, prevention actions, and an indexed learning history.
- The AGENTS.md open standard (cross-tool portability via symlinks).

Read once. Fill section 10 with verified project facts. Add to section 11 only when a concrete correction should apply to future sessions. Prune the rest over time. This file gets better the more you use it.
