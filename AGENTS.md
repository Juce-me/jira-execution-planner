# AGENTS.md

Template version: 2026-07-18

Drop-in operating instructions for coding agents. Read this file before every task.

**Working code only. Finish the job. Plausibility is not correctness.**

This file follows the [AGENTS.md](https://agents.md) open standard. At the project root and beside every directory-specific `AGENTS.md`, symlink compatibility files to the local instructions:

```bash
ln -s AGENTS.md CLAUDE.md
ln -s AGENTS.md GEMINI.md
```

When Superpowers is already available, invoke `using-superpowers` before ordinary task handling and use relevant skills. Do not install tools or create persistent planning artifacts unless the user or project workflow requires them. When `docs/AGENTS.md` is installed, its `docs/agents/` locations override skill-default artifact paths such as `docs/superpowers/`.

---

## 0. Non-negotiables

These rules override later guidance in this file:

1. **No flattery or filler.** Start with the answer or action.
2. **Disagree with false premises.** Explain the evidence before proceeding.
3. **Never fabricate.** Read the source, run the command, or state what remains unknown.
4. **Do not guess through material ambiguity.** Follow the decision rule in section 8.
5. **Change only what the request requires.** No drive-by fixes, refactors, or formatting.
6. **Protect existing work and contracts.** Preserve user changes, architecture boundaries, public interfaces, and migration paths unless the user changes them.
7. **Do not commit personal or local data.** Use repo-relative paths and placeholders; never commit secrets, tokens, real emails, usernames, hostnames, or production identifiers.
8. **No agent or tool branding** in branches, commits, PRs, or project content unless explicitly requested.

---

## 1. Before editing

- State the intended outcome, observable acceptance criteria, files in scope, and verification. Use a numbered plan only when the work is non-trivial.
- Read the applicable instruction files, the files you will touch, and relevant callers or consumers.
- Check the worktree and preserve unrelated changes. If required work overlaps uncertain user edits, stop and ask.
- When approaches differ materially, explain the tradeoff and recommend one. Do not add ceremony for trivial, reversible edits.

---

## 2. Implementation scope

- Write the minimum code or documentation that satisfies the request. No speculative features, single-use abstractions, or future-extensibility hooks.
- Follow established patterns, naming, formatting, and file layout even when you would choose differently in a greenfield project.
- Reuse existing shared components, styles, tokens, rules, and workflows instead of creating local variants.
- Handle failures that can actually occur. Fix root causes rather than suppressing symptoms.
- Clean up only imports, variables, functions, or files made obsolete by your own change. Mention unrelated dead code instead of deleting it.
- Before finishing, inspect the diff and remove every changed line that does not trace to the request.

---

## 3. Files and instruction hierarchy

- Put reusable rules at the highest applicable `AGENTS.md`. A child file may add stricter local constraints; it inherits parent naming and location rules unless the parent explicitly delegates a separate schema.
- Keep colocated `CLAUDE.md` and `GEMINI.md` files symlinked to the local `AGENTS.md`.
- Follow the project's established layout. If none exists, use `src/` for sources, `tests/` for tests, `docs/` for documentation, `scripts/` for tooling, and `assets/` for static assets.
- Create a directory only with its first real file. Do not add empty folders, `.keep` files, placeholder READMEs, or speculative scaffolding.
- Keep tests, fixtures, generated test data, and scratch work inside the repository. Use `tmp/` only when it is gitignored; use an external temporary path only when a tool requires it.

---

## 4. Verification

- Run the relevant tests, lint, type checks, validation scripts, or benchmarks. When behavior can be exercised automatically, add or identify a check that fails without the change and passes with it; otherwise document manual verification. Read complete failures and fix the cause, not the check.
- For UI work, compare before-and-after screenshots and describe the visible change.
- Never claim success from a plausible diff. Report the command run and its actual result.
- Update affected documentation and active work artifacts when behavior, interfaces, layout, or workflow changes. Do not update unrelated docs for completeness.

---

## 5. Tools and runtimes

- Prefer running the code and using configured CLI tools over guessing or unauthenticated manual API calls.
- The verified commands and runtime in section 10 override generic defaults.
- Use the repository's pinned runtime or local environment. For Python, create `.venv` only when isolation is needed and no workflow exists; never install into unmanaged host Python. For Node, use the pinned runtime manager when configured.
- Do not request credentials until read-only local checks and safe alternatives are exhausted.

---

## 6. Git and session hygiene

- Follow the user request and the repository-specific Git workflow in section 10. Do not commit, push, merge, delete, or rewrite history unless that action is in scope.
- Before a commit, confirm the diff contains no local data or unrelated changes. Use a descriptive subject under 72 characters; add a body when the reason is not clear from the subject. Do not add agent attribution.
- At the start of a new session, check the upstream [`AGENTS.md`](https://raw.githubusercontent.com/Juce-me/init_agents_md/main/AGENTS.md) template version. If it is newer, inspect the corresponding [`template-migrations.md`](https://raw.githubusercontent.com/Juce-me/init_agents_md/main/docs/template-migrations.md) entries first.
- Apply only a root-file text update automatically, preserving sections 10 and 11. Get approval before moving files, replacing auxiliary instructions, changing symlinks, editing preserved sections, or resolving collisions. If either version is missing or comparison is uncertain, show the proposed change instead of applying it.
- Use subagents only when the runtime provides them and the task divides into independent, bounded work. Keep trivial and documentation-only corrections inline, and close completed agents when the runtime supports it.
- After two failed attempts on the same issue, stop, summarize the evidence, and ask for direction.

---

## 7. Communication

- Use English unless the user asks otherwise. Be direct, concise, and specific.
- Lead technical judgment with the assessment and the few facts that determine it.
- Distinguish what existing tools already solve from what custom work would add. Call out a wrong architectural boundary before polishing its implementation.
- Avoid excessive headings, bullets, repetition, ceremonial closings, and emoji.

---

## 8. When to ask

Ask before proceeding in any of these cases:

- Different interpretations materially change the output.
- The change affects a load-bearing, versioned, or migration-sensitive contract.
- The task requires credentials, production access, destructive action, or authority not already granted.
- The literal request conflicts with the user's stated goal.

When none apply, verify what you can locally, make the smallest safe, reversible assumption, state it when material, and continue.

---

## 9. Durable learning

- Add or tighten a rule in section 11 only after a user correction that is concrete, likely to recur, and not already covered. Remove stale rules when the underlying issue disappears.
- For significant misses or regressions, review relevant postmortems before related work. Follow the installed postmortem instructions and keep its index aligned.
- When creating agent work artifacts, follow `docs/AGENTS.md` if installed. Keep each artifact's status, outcome, plan, and affected documentation aligned with the implementation.
- Periodically prune rules whose removal would not change agent behavior.

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
- For Jira status changes, make the displayed status pill/text the click target; do not add separate Change Status buttons unless explicitly requested.
- At session start, before the first commit, check `git branch --show-current`; if the branch is auto-generated or agent-branded (e.g. `claude/*`), rename it to `feature/`|`bugfix/`|`improvement/`|`docs/` + kebab-case summary (see docs/postmortem/MRT022-agent-branded-branch-names.md).
- Run `npm ci` in a fresh git worktree before `npm run build`; a build that resolves node_modules from an ancestor checkout embeds wrong relative paths in `dashboard.js.map` and fails the CI dist check.
- `group.teamLabels` values are Jira epic labels for Future Planning epic matching and JQL `labels =` clauses, never team display names; resolve team names through the team catalog lookup (`teamNameLookup`/`resolveTeamName`) or task-derived `getTeamInfo(task).name`, and note the catalog only loads when the settings modal opens.
