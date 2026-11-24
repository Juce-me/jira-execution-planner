# Plan Index And Naming

- [Desktop Chromium verification runtime](DONE-test-runtime-budget.md): preserve full desktop/security/PostgreSQL coverage while reducing the combined build and test gate to 600 seconds; historical timings and pilot evidence determine remaining work.

Use this file to choose the right plan before starting auth, DB, or Home/Townsquare work.

`docs/plans/` uses the prefix taxonomy below. The date/status naming rules in `docs/agents.md` apply to the separate `docs/agents/` artifact namespace, not to this directory. `docs/agents/` may be absent until the first real artifact is created.

## Release closeout evidence

Reviewed on 2026-11-24 against released `main` commit `19b05ee9`. The operator confirmed that inclusion in the latest release is the deployment boundary for this cleanup. The [release workflow](https://github.com/Juce-me/jira-execution-planner/actions/runs/43252937025) completed successfully on 2026-11-12; each renamed plan links its merged implementation PRs. This is release evidence, not independent verification of a running installation. Remaining live/environment checks stay recorded in the plans and [TODO](../TODO.md).

## Prefixes

- `EXEC-*`: implementation-ready execution plans. Run these in numeric order unless a plan says it is gated or explicitly independent of the previous `EXEC-*` plan.
- `DONE-*`: completed and verified execution plans. Keep these for audit/history only; do not execute them as active plans.
- `GATE-*`: blocked external capability gates. Check these at session startup for relevant auth, DB, Home/Townsquare, EPM, or plan work, then update `Checked on` and `Last result` only when the result changed or `Next review` has passed.
- `SUPPORT-*`: review, handoff, or operator support documents. Do not execute them as implementation plans.
- `FUTURE-*`: deferred scope. Do not pull these into the current implementation unless the scope is explicitly reopened.
- Do not create new date-only docs in `docs/plans/`. Use one of the prefixes above so execution state is visible from the filename.
- Index entries are one line each (`- [Title](PREFIX-name.md): one-sentence scope`); plan status lives only in the plan's top `> **Status:**`. The file merges with `merge=union` and each plan link must appear exactly once (`tests/test_agents_md_learnings.py`).

## Dashboard data freshness

- [Dashboard data freshness #251](DONE-dashboard-data-freshness-251.md): Recheck loaded data after long returns while preserving reading position, scoped authority and staged edits.

## Current Planning Work

- [Planning capacity prefill across configurations](DONE-planning-capacity-prefill-cross-configuration.md): diagnose and repair cross-configuration previous-Sprint capacity lookup, Team ambiguity and refresh recovery.
- [Shared Planning inclusion and clear controls #331](DONE-planning-shared-plan-331.md): prerequisite app-wide DB/OAuth-only retirement, then shared Department/Sprint inclusion, atomic review save, scoped projection, recovery, wording, Table inspection and real persistence/concurrency acceptance.
- [Quarterly project configurations design](SUPPORT-quarterly-project-configurations-design.md): Settings hierarchy, component reuse, DB/OAuth-only quarterly configuration contracts, runnable mockup and accepted planning decisions.
- [Quarterly work-structure migration](DONE-quarterly-work-structure-migration.md): Tasks 0–6 with dependencies and acceptance journeys for DB/OAuth quarter ranges, reader enablement, isolated reviews, combined capacity and Legacy Scenario compatibility; separate extraction remains a release prerequisite.
- [DELIVERY Allocation split and Sprint scoping](DONE-delivery-allocation-split-and-sprint-scoping.md): Allocation-mapped Product/Tech split for DELIVERY with a Settings value picker, per-configuration Sprint ids when the Board is inherited, and `- legacy`/`- delivery` labels for same-name Sprint values; supersedes D-C, D-D and D-E.
- [DELIVERY Initiative Allocation and Board-only Sprints](DONE-delivery-initiative-allocation-and-board-sprints.md): Initiative-only Allocation class with a No Allocation state across filters, capacity, alerts and Stats; Board-mode Sprints from the Board only, split by quarter range; Refresh Sprint values for an inherited Board.
- [Department-owned DELIVERY Allocation and distinct Board scope](DONE-department-allocation-board-scope.md): shared Department Allocation values and Product/Tech mapping, distinct era-specific Board scopes, safe saved-data transition, classification/cache isolation and existing-control relocation.
- [Planning finalization follow-ups](FUTURE-planning-finalization-follow-ups.md): browser reliability fixes #337 and separated runtime/operator acceptance #338, preserving known exceptions and live-access boundaries.
- [Work entity names and Jira type validation](DONE-work-entity-names-and-type-validation.md): configured Jira type names for every role on ENG surfaces, per-response type validation against Field mapping, analytics issue kinds and a literal-word guard.
- [jira_server.py cohort and stats extraction](EXEC-jira-server-cohort-stats-extraction.md): Sliced, patch-preserving extraction of epic-cohort, statistics, excluded-capacity and Project Track phase code into services, with per-slice guards and a budget ratchet.

- [Planning assignee capacity table #323](DONE-planning-assignee-capacity-table-323.md): with one team selected, Planning shows a per-assignee table (Planned capacity, Estimated effort, Vacations, Notes) stored per workspace, Sprint and Team in the app database, inherited gray from the nearest earlier Sprint, with a per-assignee strip in the pinned capacity bar, a stored planned team capacity and Add assignee.
- [Planning assignee capacity deferred scope #323](FUTURE-planning-assignee-capacity-deferred-323.md): what stays deferred after the every-Team plan: the second Jira capacity read on load for an unpointed Team, containment against an unconfigured ticket, and installations beyond the G1 Team count.
- [Planning Team capacity for every selected Team #323](DONE-planning-team-capacity-every-team-323.md): per-Team stored numbers for one, several or All Teams, bounded batch reads, per-Team save owners, own-ticket push exclusion, touch readouts, verification evidence and Table-only Planning with legacy-link normalization and session row-choice retention.

- [Board status pill non-blocking #241](DONE-board-status-pill-nonblocking-241.md): Board status pill changes stop locking the Board and announce their outcome like drag, with strict-scope coverage (issue #241).
- [Home OAuth public reads](DONE-home-oauth-public-reads.md): Home reads through the signed-in user's OAuth grant only; the stored personal API-token connection was removed. The [design/DoD](SUPPORT-home-oauth-public-read-design.md) uses a self-controlled private Enable EPM view checkbox, EPM-only Home scopes and a bounded Home-access signal; no-access Goals/Projects navigation stays hidden. It preserves non-empty Goals -> Home projects -> exact-label Jira entities and documents rollback without a credential switch. Validation against main `e99b7e2a` records F-01–F-39 dispositions; historical 141/190 baseline counts are not current-main test evidence. GATE-05 remains write-only.

- [Alerts pinned workflow #209](DONE-alerts-pinned-workflow-209.md): Pin the clicked Catch Up alert beneath the sticky controls, with dismissal and return navigation.

- [Design system Part 3 surface migration](DONE-design-system-part-3.md): Apply the approved hover vocabulary to feature-owned controls with registered CSS and write-boundary guards.
- [Design system Part 2 global hover foundation](DONE-design-system-part-2.md): Replace global hover overrides with shared foundation tokens while preserving control geometry.
- [Design system Part 1 contract, map and guards](DONE-design-system-part-1.md): implemented, locally verified and accepted (2026-10-13); commit-only delivery authorized, with push and PR separately gated. Own-issue binding, the UI registry, inert tokens and shrink-only guards; current visible appearance retained. Final checks: Python 2,102 passed/29 skipped, Node 2,512 passed, Chromium 1,529 passed/8 skipped, reproducible build and structure/analytics guards. The initial scroll-test failure and successful unchanged reruns are recorded in the execution plan.
- [Design system map, write contract and hover system (design)](SUPPORT-design-system-hover-contract-design.md): design revision 2 (2026-10-13), validated by four read-only reviews and Part 1 execution authorized locally; subsequent parts require separate plans. Three PRs: (1) `docs/design-system.md`, the call-site-pinned write contract, tokens and ratcheting guards for hover, font, radius and new element classes, with no visible change; (2) the global button and ring hover fix; (3) per-surface migration. One hover and focus language with no enlarge or lift effects. Spec #3 (shared `Button`, type/radius/spacing scales) is a separate follow-up.
- [Planning local priority and status edits #250](DONE-planning-local-issue-edits-250.md): Settle Planning row edits locally without reloading the Board.
- [Planning Sprint review table #217](DONE-planning-sprint-review-table-217.md): Provide workspace/Sprint custom review columns, editable rows, totals and sorting in a spreadsheet view.
- [Planning review group columns and Sprint views #267](DONE-planning-review-group-columns-267.md): implemented and merged in [PR #290](https://github.com/Juce-me/jira-execution-planner/pull/290) (2026-10-20); kept for audit. Tasks A1 to E2 covered the backend group tables and contract, the adoption script and cutover runbook, the client plumbing and group guard, derived columns, the hint and group copy, and the records. The gates its record lists as open at merge time (the Gate 7 cutover rehearsal, headed Firefox and WebKit marker geometry, a CI PostgreSQL run) were not formally closed there; the #299 plan below records later evidence.
- [Planning review adoption merge mode](DONE-planning-review-adoption-merge-mode.md): approved 2026-10-22 (recommendations accepted for D-1 to D-12; issue #299, branch `bugfix/299-review-adoption-merge-mode`), validated by three independent plan reviews and one implementation review (findings applied), executed locally 2026-10-22 (Tasks 1 to 7 and one review-fix commit; full Python suite 2,379 OK, CI PostgreSQL runner 82 OK, rehearsal and a 99,600-cell scale probe recorded in the plan); delivered by the PR that closes #299; accepted by the operator on 2026-10-22, so the plan is `DONE-` (kept for audit). Open: the operator's staging dry run and a root `AGENTS.md` learning. Adds `--merge` to `scripts/adopt_legacy_sprint_reviews.py` so legacy per-Sprint review data can be adopted into a workspace that already has group rows (live data wins, group-archived columns stay archived, idempotent, per-group schema-row locks so it can run while the app serves); the default mode and its refusal are unchanged. All twelve operator decisions (D-1 to D-12) are resolved as recommended, including a postmortem.
- [Planning review automatic adoption on release](DONE-planning-review-automatic-adoption-on-release.md): Adopt eligible legacy review data automatically on upgrade with transactional merge semantics.
- [Planning review group columns and Sprint views design #267](SUPPORT-planning-review-sprint-inheritance-design-267.md): design rewritten 2026-10-17 on operator direction and extended with read-only derived columns between the Epic and Story views (Story sums up, Epic values down); validated by two rounds of five independent passes plus two focused re-checks of three, with all findings applied 2026-10-19 (not re-validated). Custom columns and one-value-per-issue values belong to the Department group across all Sprints, and each Sprint's shared view (column order and hidden columns) is inherited from the nearest earlier saved view until the Sprint saves its own. Implemented locally per the EXEC plan above; the design remains the source of truth. Supersedes the 2026-10-16 pin-chain design.
- [Planning review table chrome #217](DONE-planning-review-table-chrome-217.md): Move table view and dirty-save controls into the shared filter row and simplify column controls.
- [Board column status colours](DONE-board-column-status-colours.md): Optionally inherit each Department Board column colour on its ENG Jira status pills.
- [Board Killed and Incomplete closed-work counting](DONE-board-killed-incomplete-done-253.md): Count Incomplete children as done and exclude Killed children from Board Epic progress totals.
- [Board Epic card layout #271](DONE-board-card-layout-271.md): Group Epic card identity, progress and people into three aligned bands.

- [Person avatars on Board and Planning](DONE-person-avatars-board-planning-336.md): the shared person mark beside Assignee and Delivery owner on Board cards and in Planning Table cells, plus an optional Epic Delivery Owner column.
- [Person avatars for ENG and EPM](DONE-person-avatars-eng-epm.md): profile photos in the existing assignee glyph slot and EPM owner circle, no new requests, allowlisted CDN hosts in the CSP.
- [EPM design-system alignment #319](DONE-epm-design-system-alignment-319.md): project status pill and Jira label reuse the ENG epic pill and key text (Option A), deleting two bespoke pill hooks.
- [EPM fonts alignment #319 follow-up](DONE-epm-fonts-alignment-319.md): project name and update text move from the system sans stack to the app font.

## Dashboard decomposition

- [Conflict-resistant repository and dashboard architecture](DONE-dashboard-conflict-resistant-architecture.md): Track A removes the shared files that cause most merge conflicts (committed `frontend/dist`, exact budget counts, append-style docs, sync command); Track B reshapes `dashboard.jsx` so a feature edit stays local (handles, then group slices after a spike).
- [App decomposition](DONE-dashboard-app-decomposition.md): implemented and merged in [PR #254](https://github.com/Juce-me/jira-execution-planner/pull/254) (2026-10-08); kept for audit. Moved Statistics, composite Alerts derivation/filtering and Capacity state/lifecycle out of `App()` using the #220 container-plus-seam pattern, turned closure renderers into keyed components, hoisted the verified shared scope, and lazy-loaded Stats, Scenario and Settings with mounted-build retry manifests. Ended direct `file://` open of `jira-dashboard.html` (OAuth-only direction). Task commits, verification counts and the review resolution map are in the plan header.
- [Scenario Planner and Settings state extraction](DONE-dashboard-scenario-settings-state-extraction.md): implemented and merged (issue #220; PR-1 #219, PR0 #227, Scenario slices #228 to #232, Settings slices #233 to #238, 2026-10-06). `frontend/src/dashboard.jsx` went from 18,203 to 10,855 lines with Scenario and Settings state, effects and tab bodies in feature-owned hooks and containers; the only behavior change is the fail-closed Settings edit grant (#237). The per-rung records are historical; the Scenario history/save/rollback rebuild remains deferred (issue #230).

## Current Stats Work

- [Lead Times modes plan](DONE-lead-times-modes.md): implemented and accepted by the operator (2026-10-22) on `feature/lead-times-modes` in four layered commits (backend, frontend, share links and dist, tests and docs; not pushed or merged); revised after two rounds of independent read-only validation reviews; the Execution status table in the plan holds per-task evidence and the rulings, including why the commits are layered. Twelve tasks (0-11): baseline, a read-only Jira probe gate (latency based), the closed-mode backend, route contract, Assignee removal, cohort model and heatmap, state and fetching, panel UI with a Mode dropdown, Jira links, share links, browser coverage, and registry/docs/final gate.
- [Lead Times modes design](SUPPORT-lead-times-modes-design.md): approved by the operator (2026-10-22) and implemented as written (accepted 2026-10-22); divergences are recorded as rulings in the plan. Single-select mode (Created, Closed, Last N) with one selection control each; the closed modes use the Board's exact-Component scope; Last N counts after the filters from a bounded server window; Assignee filter removed; share links gain optional keys at `v=1`.
- [Project Track Board-column strips](DONE-project-track-board-column-strips.md): Split Project Track summaries by Board column; later Story-status and summary changes supersede parts of the original design.

## Shareable view links (issue #194)

- [Shareable view links design](SUPPORT-shareable-view-links-design-194.md): proposed 2026-10-13, validated and tightened 2026-10-14 by four independent adversarial reviews and refined while the plan was drafted; operator-accepted on 2026-10-15 (default decisions and gate G1). A header Share button (rendered on both header surfaces) copies a readable self-contained URL (`/?v=1&mode=...`) for ENG Catch Up, Planning, Board and Statistics; the recipient's own Jira access bounds what applies, an OAuth login hop keeps the query through a validated session-cookie stash, apply is a staged machine gated on readiness, and a failed group or sprint applies nothing else. No server-stored token, no new route. Supersedes the "Shareable View Links" section of [FUTURE-db-additional-features.md](FUTURE-db-additional-features.md) for v1.
- [Shareable view links implementation #194](DONE-shareable-view-links-194.md): Capture and apply readable scoped links across ENG views with login return, target reveal and privacy guards.
- [Shareable view links: server login stash](DONE-shareable-view-links-194-server.md): Keep validated link parameters through OAuth login while excluding them from access logs.
- [Shareable view links: resolver and store](DONE-shareable-view-links-194-resolver-store.md): Resolve authorized view intent and keep one-shot link application state outside persistent browser storage.
- [Shareable view links: target focus](DONE-shareable-view-links-194-focus.md): Capture, reveal and highlight arrival targets after the relevant view becomes ready.
- [Shareable view links: controls and analytics](DONE-shareable-view-links-194-control.md): Provide header and target-level copy-link actions with the approved analytics contract.
- [Shareable view links: codec](DONE-shareable-view-links-194-codec.md): Encode and validate readable versioned view parameters against canonical defaults.
- [Shareable view links: apply machine](DONE-shareable-view-links-194-apply.md): Stage scope, fields, dependent data and target focus through bounded readiness and cancellation rules.

## Per-epic refresh (issue #213)

- [Per-Epic refresh with glare #213](DONE-per-epic-refresh-213.md): Refresh one Epic and its alerts in place and highlight changed cards.

## Catch Up weekly load performance

- [EPM load performance metrics #318](DONE-epm-load-performance-318.md): per-project load measurement and weekly Projects listed / Rollup loaded charts for the EPM surface.
- [Catch Up weekly load performance](DONE-catch-up-weekly-load-performance.md): Chart weekly List loaded and Fully loaded timings in Admin Performance.

## Catch Up cold load speed

- [Catch Up cold load speed](DONE-catch-up-cold-load-speed.md): Compress responses, bound concurrent Jira enrichment, lazy-load Admin panels and prefetch bootstrap configuration.

## Hosted perimeter session recovery

- [Perimeter session expiry recovery](DONE-perimeter-session-expiry-recovery.md): an expired OAuth2 Proxy session makes API calls redirect cross-origin; detect the redirect and recover with one draft-preserving reload instead of the "Server is not responding" banner.

## OAuth callback recovery

- [OAuth stale callback recovery design](SUPPORT-oauth-stale-callback-recovery-design.md): a replayed, superseded, denied or truncated Atlassian callback redirects to `/login?reason=sign_in_incomplete`, which forwards a signed-in browser to the dashboard and otherwise shows a notice; the state check and single pending login are unchanged.
- [OAuth stale callback recovery](EXEC-oauth-stale-callback-recovery.md): three test-first tasks (sign-in notice, callback redirect, docs) with the no-exchange and redaction pins.

## Epic header regression review

- [Visible-height analysis](SUPPORT-epic-header-visible-height-analysis.md): historical diagnosis and validated specimen evidence; application source is now authoritative.
- [Epic header visible-height correction](DONE-epic-header-visible-height.md): Keep direct and Initiative-grouped Epic headers compact with full-value readouts for truncated fields.

## Current DB Workflow

- [ENG Board All work transport and throughput](EXEC-board-all-work-throughput.md): proposed. The blocking `scope_too_large` index defect is fixed and locally verified on `bugfix/board-progressive-loading`; this plan covers the structural work it exposed — moving the strict Jira pager to POST so the encoded-URL ceiling stops deciding correctness, sharding the team discovery scan, and writing down a Board caching contract before `cacheState` stops being a hardcoded `miss`. Carries the measured read-only live baseline (48 Jira pages, 14.4 s, 194 Epics, 1,821 Stories) for the reported department. No slice is accepted. Two pieces of the measured cost were taken early on 2026-10-21 (concurrent, key-filtered catalog reads before the first byte, and four child searches instead of two); see the plan's execution record.
- [Persistent Sprint and Team catalogs runtime repair](DONE-persistent-sprint-team-catalogs-runtime-repair.md): Remove unsupported cache-busters and accept Jira-capped Board pages without accepting incomplete catalogs.
- [ENG shared Sprint selector availability](DONE-eng-board-scope-selector-availability.md): implemented, verified, accepted, and merged into `bugfix/board-progressive-loading` on 2026-09-14. The shared semantic selector separates scope intent from load authority, exposes explicit loading/setup/error states, preserves ordinary Sprint access across all five ENG modes, and makes explicit Project Track Sprint commitments perform one current source-only reload even with prewarmed range/per-Sprint caches. A current-Sprint commitment repairs a divergent range once; an already matching reselect remains a no-op. Its 22-cell two-scope authority/readiness matrix and config/stream auth-lock interaction negatives pass within the affected serial 199-test browser campaign, alongside frontend unit, build, backend safety, and full Python checks. Supersedes only the prior no-op selection requirement; Sprint catalog implementation remains separately owned. No existing authenticated local server was available, so positive authenticated cross-sprint loading remains unverified.
- [Persistent Sprint and per-Sprint Team catalogs](DONE-persistent-sprint-team-catalogs.md): Persist workspace-shared catalogs with scoped identity, fenced publication and bounded refresh ownership.
- [ENG Board scope and performance regressions #190](DONE-eng-board-scope-performance-regressions-190.md): Gate cross-Sprint scopes on saved Jira authority and record Component observations independently of Sprint.
- [ENG Board progressive loading #190](DONE-eng-board-progressive-loading-190.md): Deliver bounded cumulative Epic candidates progressively and preserve completed-snapshot authority.
- [OAuth inline issue editing](DONE-oauth-inline-issue-editing.md): Edit ENG Assignee, Epic Delivery Owner and Story Points through the signed-in Jira user context.
- [OAuth inline issue editing design](SUPPORT-oauth-inline-issue-edit-design.md): implemented reuse-first UX contract; awaiting live tenant and disposable-write evidence.
- [In-app load performance](DONE-in-app-load-performance.md): implemented, verified and user-accepted; three local contextual sprint observations recorded.
- [ENG Board All work implementation](DONE-eng-board-all-work.md): Add strict Component and All work scopes with bounded discovery, loading authority and measurement.
- [All work subagent handoff](SUPPORT-eng-board-all-work-handoff.md): local draft updated after the corrective slices; not cleared for distribution until its exact revision is published and verified fetchable. Execute only within the remaining plan gates.

1. `SUPPORT-db-migration-claude-review-workflow.md`
   - Use first for external review or handoff.
   - Expected output: findings and a go/no-go recommendation, not code changes.

2. `DONE-01-db-auth-foundation.md`
   - Completed first DB implementation plan. Use for audit and prerequisite evidence; do not execute as active work.
   - Expected output: DB-backed users, workspaces, auth connections, encrypted tokens, service integrations, admin inspection, token-bound CSRF, cache partitioning, and auth recovery surfaces.

3. `DONE-02-db-home-user-api-token-bridge.md`
   - Completed user-owned Atlassian API-token connection bridge. Use for audit and prerequisite evidence; do not execute as active work.
   - Expected output: optional per-user Atlassian API-token connection for future explicit Home/Townsquare writes while Home user 3LO is unsupported. Superseded: the connection, its routes and stored tokens were removed by the public-read-v1 execution; Home is read through the user's OAuth grant only.

4. `DONE-03-db-user-configuration.md`
   - Completed DB user-configuration plan. Use for audit and prerequisite evidence; do not execute as active work.
   - Output: DB-backed user-owned saved views, including private EPM scope, label prefix, issue types, and project-label mappings. EPM tab and sprint are private UI state; existing private-view values remain preserved. PR #130 temporarily moved normalized EPM settings into workspace configuration; `DONE-user-owned-epm-configuration.md` corrects that ownership regression.

5. `DONE-04-db-user-home-epm-read-token.md`
   - Completed per-user Home token requirement for DB/OAuth EPM reads. Use for audit and prerequisite evidence; do not execute as active work.
   - Current implemented output: DB/OAuth EPM is hidden until the current user connects a Home/Townsquare API token in Settings, then EPM Home reads use that user-owned token while Jira REST remains OAuth-backed. Superseded by the [public-read cutover](DONE-home-oauth-public-reads.md): the token prerequisite and stored tokens are removed and EPM Home reads use the user's OAuth grant; do not reopen this DONE plan.

6. `GATE-05-home-write-capability.md`
   - Historical Home/Townsquare project-write capability record; retained for existing links and excluded from startup gate checks. See its top status note.

7. `FUTURE-db-additional-features.md`
   - Execute only after the DB auth and user-configuration phases are complete and explicitly reopened.

8. `DONE-shared-department-groups.md`
   - Completed and merged in [PR #62](https://github.com/Juce-me/jira-execution-planner/pull/62). Moves department/team-group definitions to workspace-shared configuration while keeping per-user visible-group preferences. Use for audit and prerequisite evidence; do not execute as active work.
   - Historical output: any authenticated user can edit the shared group catalog, every user can discover shared groups, each user controls which groups appear in dashboard controls, and shared saves are revision-conflict protected. PR #62 left the existing star wired to shared `defaultGroupId`; `DONE-personal-group-star.md` corrects that product mismatch without rewriting shared catalog history.

9. `DONE-shared-admin-configuration.md`
   - Completed and merged in PR #130 (`7ea40db`). Use for audit context only.
   - Current output: administrator dashboard sections persist once per workspace/Jira site with revisioned, authorized writes; normal-user catalog refreshes use separate storage; no private payload is auto-promoted. Its shared-EPM decision is superseded by `DONE-user-owned-epm-configuration.md`.
   - Execution record: `../agents/bugfixes/2026-08-26-executed-shared-admin-configuration.md`.

10. `DONE-user-owned-epm-configuration.md`
   - Completed, verified, and accepted correction for the ownership regression identified after PR #130. Use for audit context only.
   - Current output: EPM settings use each user's default private saved view and every functional EPM path uses that source; cache keys include a normalized-configuration digest and every effective-default change performs post-commit user-partitioned invalidation; legacy import discards derived `teamCatalog`; misplaced workspace EPM is held in a reversible archive without an inferred owner; and every application API `401` terminally locks the whole app behind one sanitized same-tab sign-in recovery screen. Department groups remain workspace-shared and user-editable, while administrator settings remain workspace-shared and admin-only. Full Python, Node, Playwright, startup, clean-build, and explicit PostgreSQL gates pass.
   - Design record: `../agents/bugfixes/2026-08-27-planned-global-auth-lock.md`.

- [Cloud SQL IAM connectivity](DONE-cloud-sql-iam-connectivity.md): Inject refreshed ADC login tokens for opt-in hosted PostgreSQL connections through the shared engine factory.

- [Localhost PostgreSQL runners](DONE-local-postgresql-runners.md): Supervise isolated loopback Docker PostgreSQL development and verify PostgreSQL locking in GitHub Actions.

13. `SUPPORT-multi-device-browser-sessions-design.md`
   - Reviewed design for persistent DB/OAuth browser-profile sessions plus issue #143's per-tab reauthentication resume. The branch contains global auth lock `b38e8f7` and migration head `20260827_0008`; execution still begins with each plan's Task 0 baseline check.
   - Expected output after both execution slices: independent per-profile/device login/logout, shared token refresh without cross-device sign-out, connection-wide revocation that fails closed, lazy upgrade of current legacy cookies, terminal `401` recovery without raw config errors or request replay, and per-tab restoration of available view/Planning scope and selected story checkboxes after same-tab OAuth. Tabs in one profile share the Flask cookie/browser-session row but retain isolated recovery capsules.

- [Multi-device browser sessions: server](DONE-multi-device-browser-sessions-01-server.md): Separate browser-session authority and revocation for concurrent devices.

- [Multi-device browser sessions: tab resume](DONE-multi-device-browser-sessions-02-tab-resume.md): Resume tabs with the correct browser session and preserve scoped recovery state.

## Completed Scenario Planner Workflow

1. `DONE-scenario-planner-quarter-drafts-00-overview.md`
   - Completed DB-backed Scenario draft-history split and canonical `/api/scenario/drafts` contract. Use for audit context only.

2. `DONE-scenario-planner-quarter-drafts-01-persistence-api.md`
   - Output: one shared active Scenario draft per workspace plus sprint/team/group scope, append-only version history, rollback, and legacy `/api/scenario/overrides` compatibility.

3. `DONE-scenario-planner-quarter-drafts-02-frontend-history.md`
   - Output: Scenario UI loads active drafts, saves new versions, reloads snapshots, rolls back before write-back, and handles stale saves without losing local edits.

4. `DONE-scenario-planner-quarter-drafts-03-collaboration-writeback-gate.md`
   - Output: real-time awareness through SSE/polling, advisory presence/locks, multi-user conflict recovery, and a Jira write-back route that remains blocked. Real Jira mutation still requires a separate future `EXEC-*` plan.
   - Future Jira publish/write-back must use only the signed-in user's OAuth Jira REST context; do not use Jira/Home API tokens, Basic credentials, service integrations, Home/Townsquare APIs, or local token-store helpers.
   - Scenario group scope is a shared environment-scoped PM/EPM-managed configuration reference; drafts may reference groups but must not create private group definitions or own group membership.

## Frontend Planning Workflow

- [Candidate Sprint labels](DONE-candidate-sprint-label.md): Recognize candidate Sprint label suffixes in selected-Sprint Epic alerts.
- [Connection recovery reload](DONE-connection-recovery-reload.md): Recover through a guarded Retry connection reload while preserving the existing recovery contracts.
  fan-out with a guarded document reload, preserves principal/scope-bound dirty Scenario deltas in a
  strict expiring tab capsule, reloads Settings/EPM from saved state, and keeps changed revisions in
  the existing conflict workflow without replaying mutations.
- [Multiple Jira group labels per Team](DONE-multiple-group-labels.md): Allow up to three exact Jira group-label aliases per Department Team.

- [Board column scroll panes](DONE-board-column-scroll-panes.md): Keep desktop Board columns in independent fixed-height scroll panes with a small-screen fallback.

- [ENG Story readiness ghosts](DONE-eng-story-readiness-ghosts.md): Progressively show synthetic required-Story rows from bounded authenticated readiness snapshots.

- [Deferred ENG alert loading](DONE-defer-eng-alert-loading.md): Render primary task data before alert enrichment and run alert reads only in Catch Up.

1. `DONE-auth-unfocused-auto-refresh.md`
   - Completed and merged in [PR #111](https://github.com/Juce-me/jira-execution-planner/pull/111). Amended 2026-07-16: the previously planned long-absence full-page reload was rejected and replaced with a refresh-only design. The superseded reload implementation remains unmerged on `feature/auth-unfocused-auto-refresh`. Use for audit context only.
   - Output: `frontend/src/api/authRefreshContract.js` holds the shared throttle/absence constants and event name; `frontend/src/api/authFocusRefresh.js` tracks continuous unfocused/hidden time and, after more than 12 minutes, issues one throttled `POST /api/auth/refresh` deduplicated across tabs via a shared `localStorage` timestamp, dispatching a `jep:auth-long-absence-return` `CustomEvent` on success; `frontend/src/dashboard.jsx` listens for that event and re-runs the same manual-refresh path the refresh button uses, gated by the same disabled condition. No document reload anywhere. `401` recovery (with and without `loginUrl`) is unchanged on both the initial and long-absence paths. `jira_server.py` adds a temporary, anonymized `after_request` diagnostics log (`jep.static_diagnostics`) scoped to `/`, `/jira-dashboard.html`, and `/frontend/dist/*` to identify the real owner of the originally reported repeated document/asset requests; it is explicitly temporary and slated for removal once that owner is identified. Content-hashed/immutable asset serving via a CDN/proxy remains deferred scope, not implemented here. Unit (`tests/test_auth_focus_refresh.js`), source-guard, and Playwright request-count coverage (`tests/ui/auth_focus_refresh_counts.spec.js`) prove: one document load produces one auth-script GET; focus/visibility bursts never add document or asset requests; multi-tab returns produce exactly one auth POST per cooldown window; a long absence refreshes only the active view's data; `401` recovery is intact.

2. `DONE-planning-default-selection-undo.md`
   - Completed and verified locally on 2026-06-09. Use for audit only; do not execute as active work.
   - Output: unseen future sprint/group scopes default to all visible Planning stories selected, Planning/Reporting epic Included/Excluded toggles persist to the selected group's shared `excludedCapacityEpics` config, manual checkbox edits persist until Select All, bulk status/select/clear actions can be undone to the loaded-page baseline, existing analytics events cover undo and shared excluded-capacity toggles, and focused Node/Python plus Playwright coverage verifies the behavior.

3. `DONE-planning-selection-card-grid.md`
   - Completed and merged in [PR #75](https://github.com/Juce-me/jira-execution-planner/pull/75). Aligns Planning story selection controls with story-point metadata while keeping non-Planning and EPM card layouts unchanged. Use for audit context only.
   - Output: ENG Planning cards render story points, the rounded checkbox, and Jira key as the final meta-row cluster; selected Planning stories get a subtle selected tint/ring; Playwright geometry and selected-state assertions guard against layout creep.

4. `DONE-jira-oauth-planning-status-transitions.md`
   - Completed Jira OAuth-backed ENG Catch Up and Planning status changes across Epics, Stories, and Subtasks. Merged in [PR #100](https://github.com/Juce-me/jira-execution-planner/pull/100). Use for audit context only.
   - Output: Catch Up can transition one Epic, Story, or expanded Subtask at a time by clicking the displayed status; Planning can fetch transition options from clicked status pills/text and transition every selected status target through the signed-in user's Jira OAuth context; batch mode never silently truncates selected targets, rejects over-cap selections before mutation, preserves Story selection capacity math, and keeps EPM Jira/Home-backed issue surfaces view-only under their existing authorization contracts.

5. `DONE-eng-priority-edit-mode.md`
   - Completed and merged in [PR #103](https://github.com/Juce-me/jira-execution-planner/pull/103) (branch `docs/eng-priority-edit-mode-plan`, commits `04be74a..8e4d764`). OAuth-backed ENG priority edits from the existing `task-priority-icon`, reusing the compact status dropdown UI/API pattern, and caching priority/status catalogs across app usage.
   - Expected output: Story and Epic priority icons open a compact dropdown whose option rows show the app's own priority icons and are filtered per issue to that project/issue-type scheme (via editmeta), fetched once per project/issue-type per app session; the menu dismisses on any outside click; priority writes use signed-in user Jira OAuth only; status transition option caching is widened safely without treating every status as universally transitionable; EPM remains read-only.

6. `DONE-eng-targeted-task-updates.md`
   - Completed and merged in [PR #105](https://github.com/Juce-me/jira-execution-planner/pull/105) (branch `feature/eng-targeted-task-updates`). Use for audit context only.
   - Expected output: ENG Catch Up status and priority writes optimistically patch only the selected Epic, Story, or expanded Subtask, reconcile in the background through a four-request shared queue with same-key serialization, roll back failed writes, ignore stale scope completions, and never refetch the Catch Up task lists; Planning and non-ENG surfaces retain their existing behavior.

7. `DONE-priority-refresh-preserve-team-filter.md`
   - Completed and merged in [PR #107](https://github.com/Juce-me/jira-execution-planner/pull/107) (branch `bugfix/priority-change-drops-single-team-filter`). Corrected during execution: team display names come from the team catalog lookup plus in-session retained task names, never `teamLabels` (Jira epic labels).
   - Expected output: configured group teams remain authoritative across Planning priority refreshes, true config removal still falls back to All Teams, behavioral Node and Playwright coverage passes, and generated dist is rebuilt.

8. `FUTURE-warm-team-catalog-team-names.md`
   - Deferred Minor follow-up to `DONE-priority-refresh-preserve-team-filter.md`: warm the team catalog once per session, only when a configured team option is visibly degraded to its raw id, so cold loads show catalog display names without any unconditional initial-load request.
   - Expected output: degradation-triggered `GET /api/team-catalog` warm effect, Playwright proof of the rename plus a no-request guard when names already resolve, and no changes to selection behavior, `availableTeams`, or analytics events.

9. `DONE-initiative-search.md`
   - Completed and accepted on 2026-07-28 in commits `a7cacf6..5d3b136`. Use for audit context only.
   - Output: Initiative key/summary matches render every loaded descendant Epic and Story, Epic matching retains its descendant behavior, active ENG filters remain authoritative, the Initiative grouping choice survives search transitions, existing bucketed `app_search` analytics remain canonical, and focused unit plus committed-dist Playwright screenshot coverage proves the result.

- [Filterable header dropdown inputs](DONE-filterable-header-dropdown-inputs.md): Filter shared header choices through the existing selected-state dropdown controls.

- [Shared header dropdown width contract](DONE-shared-header-dropdown-width-contract.md): Keep ENG header dropdown triggers and options within their responsive width boundaries.

12. `DONE-personal-group-star.md`
   - Completed and verified on 2026-08-26 in commits `50db7ee..083a09c`; this prerequisite is satisfied for the onboarding tour.
   - Expected output: one personal starred Department group per authenticated workspace/user, single-select first-run search UI, personal Settings star controls, and strict separation between the persisted favorite and temporary dashboard Group scope. Shared `defaultGroupId` remains a file/JSON compatibility field and is never shown or mutated as a DB user's favorite.
   - This plan owns star persistence and UI only. It adds no onboarding completion state, guided tour, configure guidance, skip action, or replay action.

13. `DONE-user-onboarding-tour.md`
    - Completed, verified, and accepted for remote integration on `feature/user-onboarding-tour` on 2026-09-01. Use for audit context only. The prerequisite `DONE-personal-group-star.md` remains satisfied.
    - Expected output: configure/duplicate guidance after the mandatory group gate, followed by a guided tour of dashboard scope controls, actions, filters, issue hierarchy, and editable Jira fields. Per-user/workspace `onboarding_done` supports completion, skip, interruption recovery, and an explicit Settings replay action without another startup request.
    - The tour consumes the personal-star contract read-only and must not change star persistence or UI. Existing users are backfilled as complete; JSON/basic mode stays unchanged; privacy-safe `settings_action` events measure only started/completed/skipped outcomes.

14. `DONE-user-onboarding-tour-improvements.md`
   - Tasks 0–9 are implemented and verified on `feature/user-onboarding-tour`. The dashboard tour is desktop-only; first-run Department selection and configuration still work on mobile, while the mobile dashboard tour is deferred in GitHub issue #151.
   - Implemented output includes direct existing-Department selection or persistent **Add Department**, guided create/duplicate/repair in the real Team Groups editor, automatic pending favorite/visibility with ordered shared/private save recovery, a single left-list name input, Settings-header replay, safe target-driven Priority/Project Track/Status previews, deterministic hierarchy fallbacks, analytics review, source guards, and operational guidance.
   - Task 9 used the authorized fresh Node 20 verification worktree. The clean final ref passed 1,396 Python tests with 7 skips, 1,027 frontend unit tests, and 563 Playwright tests with 2 skips; reproducible generated output and all 15 settled screenshots were verified and inspected. Completed and accepted for remote integration on 2026-09-01; use for audit context only.

15. `DONE-user-onboarding-contextual-follow-up.md`
   - Tasks 0–8 plus the final whole-branch review fixes are implemented, verified, and accepted for remote integration on `feature/user-onboarding-tour` through build commit `02f75e1`. Use for audit context only.
   - Delivered output: a wider desktop coachmark with blue/red/neutral action hierarchy, explicit Next after safe field previews, contextual Configuration/Planning/Board/Statistics modules launched by native activation of the real controls, persistence-safe terminal retries, focusable destination regions, exact launcher hit-testing through centered placement, desktop-only contextual Settings routing, one canonical left-row Department favorite, and a compact right-pane visibility layout.
   - Final verification under pinned Node 20: 96 focused Node tests; both unchanged named baseline cases; 151 combined onboarding/Settings Playwright tests; 1,396 Python tests run with 1,389 passed and 7 skipped; 1,044 frontend unit tests; and 589 full Playwright tests with 2 skips. Generated output reproduced cleanly from `02f75e1`, and all 11 required screenshots passed original-resolution inspection.
   - Mobile dashboard onboarding remains deferred to issue #151. The final review added no backend, ownership, persistence-schema, Jira-mutation, dependency, or analytics-event change. See the final whole-branch review evidence in `DONE-user-onboarding-contextual-follow-up.md` for RED/GREEN history and residual risks.

- [Hide single-option view mode control](DONE-hide-single-option-view-mode-control.md): Hide the ENG/EPM mode selector when only one view is available.

17. `SUPPORT-planning-capacity-editing-design.md`
   - Approved interaction design and synthetic reference for Selected SP by Team capacity editing.
   - Expected output: hover/focus Jira and pencil actions, one active editor, equal-height compact controls, Enter-to-save, explicit cancel, responsive/touch-safe cards, and no per-card lookup fan-out.

- [Planning Team capacity editing](DONE-planning-capacity-editing.md): Read workspace-shared capacity targets and edit one authorized Jira capacity ticket at a time.

19. `SUPPORT-eng-filter-option-visuals-design.md`
   - Approved design reference for GitHub issue #150's ENG filter-popover visual improvements.
   - Colors each Status label directly from the active Department board with a contrast-safe classic/neutral fallback, reuses the existing priority SVGs, labels the facet `Project Track`, keeps Committed/Flexible visible at zero, shows the full admitted heading total independently of their counts, and treats both unchecked as only genuinely unset `No Project Track` Epics. Preserves the existing per-scope reset lifecycle and adds no request, persistence, analytics event, or backend route.

- [ENG filter option visuals](DONE-eng-filter-option-visuals.md): Use richer Status, Priority and Project Track facet options while retaining filter semantics.

- [Catch Up Project Track filter](DONE-catch-up-project-track-filter.md): Filter Catch Up Stories through parent-Epic Project Track metadata and soften Status option backgrounds.

## Capacity Reporting Workflow

1. `SUPPORT-excluded-capacity-control-row-design.md`
   - Approved design for compacting Excluded Capacity into one desktop control row: Sprint first, Excluded Epics flexible in the middle, and both segmented controls grouped on the right.
   - Presentation-only scope; existing state, analytics, requests, and calculations remain unchanged.

2. `DONE-excluded-capacity-control-row.md`
   - Completed and merged in [PR #110](https://github.com/Juce-me/jira-execution-planner/pull/110).
   - Output: Sprint first, Excluded Epics flexible in the middle, and both segmented controls aligned on the right, with focused source and rendered-geometry verification.

3. `DONE-ad-hoc-capacity-epics.md`
   - Completed and merged in [PR #88](https://github.com/Juce-me/jira-execution-planner/pull/88). Adds department/team-group Ad Hoc capacity epic configuration as included Product capacity, separate from excluded capacity. Use for audit context only.
   - Output: `teamGroups.groups[].adHocCapacityEpics` round-trips through shared group config, Settings exposes a separate epic selector, Ad Hoc stories remain included in Product Planning and reporting, excluded capacity behavior remains driven only by `excludedCapacityEpics`, and affected Planning, Stats, Burndown, Lead Times, Mono vs Cross, and Scenario paths have focused verification.

4. `DONE-statistics-consistency-bugfix.md`
   - Completed and merged in [PR #108](https://github.com/Juce-me/jira-execution-planner/pull/108) (branch `bugfix/statistics-consistency-exec`, integrated via `bugfix/statistics-colors-capacity-lead-time`, commits `a42e7ca..c4fb36c`). Shared Statistics team colors, removal of the redundant Excluded Capacity Range card, and a bounded Lead Times creation cohort with inclusive End Quarter. Decisions recorded in `SUPPORT-statistics-consistency-bugfix-design.md`.
   - Expected output: Priority, Burndown, Excluded Capacity, and Mono vs Cross consume one deterministic active-group color map; Excluded Capacity drops only its Range card; Lead Times adds an inclusive End Quarter with last-control-wins reconciliation, half-open Jira creation-date JQL, matching Jira links, and terminal dates preserved beyond the cohort boundary.

## Project Grade Security Hardening

1. `DONE-project-grade-security-hardening.md`
   - Completed project-grade hardening plan. Use for audit and release evidence; do not execute as active work.
   - Output: central endpoint policy registry, default-deny route guards, local-only dev diagnostics, loopback-safe startup defaults, security headers, project packaging metadata, CI backend/security checks, and a hardened release zip.
   - This plan does not authorize Home/Townsquare writes or Jira write-back. The historical `GATE-05-home-write-capability.md` record adds no startup prerequisite.

## Completed Frontend Structure

1. `DONE-eng-story-subtasks.md`
   - Completed and merged in [PR #59](https://github.com/Juce-me/jira-execution-planner/pull/59). Lightweight ENG story subtask visibility. Use for audit context only.
   - Expected output: existing ENG task fetch includes a cheap embedded subtask summary, exact subtask rows load only after a user expands the story subtask control, no startup subtask fan-out is introduced, and count-based progress uses done/in-progress subtask counts rather than story points.

2. `DONE-eng-compact-filter-epic-layout.md`
   - Completed and merged in [PR #65](https://github.com/Juce-me/jira-execution-planner/pull/65). Desktop-focused compaction of ENG Catch Up filter cards and epic/story blocks with CSS-only scoped overrides. Use for audit context only.
   - Expected output: ENG `Show only` filters render as compact readable desktop controls, ENG epic/story cards use denser spacing, source guards prevent unscoped `.stat-card`/`.task-list` changes, and EPM issue-board rollups remain visually compatible through `.task-list:not(.epm-issue-board)` scoping.

3. `DONE-alerts-panel-summary.md`
   - Completed and merged in [PR #71](https://github.com/Juce-me/jira-execution-planner/pull/71). Persistent ENG alerts toolbar summary next to the toggle. Use for audit context only.
   - Expected output: `EngAlertsPanel` shows total alerts plus every non-zero alert category using existing alert colors/styles, stays visible open and collapsed, preserves existing toggle persistence, and includes source guards plus desktop/mobile Playwright visual proof.

4. `DONE-eng-catch-up-control-stack.md`
   - Completed and merged in [PR #75](https://github.com/Juce-me/jira-execution-planner/pull/75). Unifies the ENG Catch Up alert summary, Show only stat filters, and Display toggles into a coherent, non-redundant control stack. Use for audit context only.
   - Expected output: upper ENG control rows share alignment, sizing, and visual hierarchy; stat filters use a compact content-aware treatment instead of distributed tiles; Killed is removed from Show only and owned only by the Display Killed toggle; focused Playwright/source guards prevent regressions and preserve EPM, Planning, Settings preview, and Scenario layouts.

5. `DONE-statistics-module-extraction.md`
   - Completed Statistics module extraction. Use for audit and prerequisite evidence; do not execute as active work.
   - Supersedes the stale root-level `statistics_module_extraction_plan.md` from `origin/plan/statistics-module-extraction`.
   - Output: remaining legacy Statistics Teams, Priority, and Burndown utilities/components extracted from `frontend/src/dashboard.jsx` into the existing `frontend/src/stats/` package, with source guards, focused Node tests, full unit verification, Playwright smoke coverage, regenerated frontend dist output, and shared bounded hover positioning for stats chart readouts.

6. `DONE-epm-project-reading-experience.md`
   - Completed EPM project reading experience plan in PR #41 (`94b759b`). Use for audit and prerequisite evidence; do not execute as active work.
   - Output: Home update freshness classification, stale/missing/unknown badges, stale date styling, visual fixture coverage, and freshness source guards for the EPM project board.

## Codebase Structure And Operability

1. `DONE-application-hosting-readiness.md`
   - Completed and merged in [PR #64](https://github.com/Juce-me/jira-execution-planner/pull/64). Internal container-app hosting readiness. Use for audit context only.
   - Expected output: DB/OAuth works without local OAuth token files, hosted mode avoids local mutable JSON/cache state, frontend APIs default to same-origin behind ingress, Docker/Gunicorn packaging exists, and docs expose the runtime contract without secrets.
   - Accuracy note: the Task 7 GitLab CI skeleton (`.gitlab-ci.yml`, `tests/test_gitlab_ci_contract.py`) was removed on 2026-07-19 because the repo's CI is GitHub Actions and GitLab hosting is no longer planned; the container packaging and pre-SRE checklist deliverables remain current.

2. `DONE-codebase-operability-verification.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: local frontend unit/UI npm scripts, `make verify` for build/Python/security/Node/dist checks, and refreshed test-command documentation.

3. `DONE-codebase-operability-startup-preflight.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: operator preflight for runtime/auth/DB/encryption/migrations plus unified DB storage aliases.

4. `FUTURE-codebase-operability-improvements.md`
   - Deferred structural review and prioritized backlog for packaging, local verification, startup preflight, backend service extraction, frontend feature ownership, and source guards.
   - Do not execute directly. Convert each chosen slice into a separate `EXEC-*` plan before implementation.

5. `DONE-css-feature-owned-partials.md`
   - Completed and merged in [PR #75](https://github.com/Juce-me/jira-execution-planner/pull/75). Splits the remaining large dashboard CSS source files into feature-owned partials while preserving one bundled shipped stylesheet. Use for audit context only.
   - Output: `dashboard.css` remains the root ordered import entrypoint, large top-level CSS files become thin maps, feature-owned CSS files mirror ENG, Planning, Settings, Stats, Scenario, and EPM ownership, and source guards prevent top-level CSS from growing back.

6. `2026-05-01-codebase-structure-optimization.md`
   - Support/history context for earlier structure extraction work. Do not execute directly.

7. `DONE-codebase-operability-doc-cleanup.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: refreshed quickstart/setup docs, May 1 plan support/history status, and current README structure snapshot.

8. `DONE-codebase-operability-packaging-contract.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: explicit release-zip runnable-package contract and tests guarding the release zip shape.

9. `DONE-codebase-operability-import-safe-startup.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: import-safe `jira_server`, explicit Flask app creation, and launch-path startup validation.

10. `DONE-codebase-operability-request-context-guardrails.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: tests guarding explicit request auth context propagation through worker fan-out.

11. `DONE-codebase-operability-epm-aggregate-extraction.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: all-project EPM rollup orchestration moved to `backend/epm/aggregate.py` with `jira_server.py` shims preserved.

12. `DONE-codebase-operability-frontend-api-boundary.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: remaining Scenario, stats, issue lookup, and EPM config endpoint construction moved out of `frontend/src/dashboard.jsx` into `frontend/src/api/*` modules.

13. `DONE-codebase-operability-config-repository-selection.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: dashboard config load/save wrappers require explicit JSON selection when DB mode is active without request context.

14. `DONE-codebase-operability-epm-config-extraction.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: EPM config defaults and normalization helpers move into `backend/epm/config.py` with `jira_server.py` compatibility aliases preserved.

15. `DONE-codebase-operability-structural-budgets.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: source guard budgets prevent `jira_server.py` and `frontend/src/dashboard.jsx` from growing while extraction work continues, with ceilings ratcheted after follow-up extraction slices.

16. `DONE-codebase-operability-epm-issues-extraction.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: EPM project issues endpoint orchestration moved to `backend/epm/issues.py` with the Flask route reduced to request parsing, dependency wiring, and JSON response handling.

17. `DONE-codebase-operability-local-oauth-store-extraction.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: local OAuth token-store persistence, TTL cleanup, and refresh-lock mechanics moved to `backend/auth/local_oauth_store.py` with `jira_server.py` compatibility wrappers preserved.

18. `DONE-codebase-operability-css-split.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: `frontend/src/styles/dashboard.css` becomes an ordered import entrypoint over top-level CSS partials while esbuild still produces one bundled `frontend/dist/dashboard.css`.
   - Current accuracy: superseded for deeper CSS ownership by `DONE-css-feature-owned-partials.md`.

19. `DONE-codebase-operability-epm-payload-helpers.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: pure EPM issue payload helpers moved to `backend/epm/payload.py` with `jira_server.py` compatibility aliases preserved.

20. `DONE-codebase-operability-eng-planning-capacity-utils.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: pure ENG Planning capacity status, team metadata, total capacity, and project-capacity split helpers moved to `frontend/src/eng/planningCapacityUtils.js` while Planning state and rendering remain in `frontend/src/dashboard.jsx`.

21. `DONE-codebase-operability-jira-issue-fetch-helpers.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: Jira issue key-batch and JQL pagination helpers moved to `backend/jira_client.py` with `jira_server.py` patchable wrappers preserved.

22. `DONE-codebase-operability-eng-planning-selection-stats.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: pure selected Planning task filtering and selected story-point/team/project aggregation helpers moved to `frontend/src/eng/planningSelectionStats.js` while Planning state and rendering remain in `frontend/src/dashboard.jsx`.

23. `DONE-codebase-operability-eng-planning-capacity-aggregates.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: pure Planning capacity table aggregation and entry-shaping helpers moved to `frontend/src/eng/planningCapacityUtils.js` while capacity fetching, Planning state, and rendering remain in `frontend/src/dashboard.jsx`.

24. `DONE-codebase-operability-capacity-service-extraction.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: Jira capacity JQL construction, capacity issue parsing, watcher fallback, and capacity route response handling moved out of `jira_server.py` into a backend service and route adapter while compatibility wrappers remain patchable.

25. `DONE-codebase-operability-dependency-focus-utils.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: pure dependency focus/key helpers shared by `dashboard.jsx` and issue dependency rendering move into `frontend/src/issues/dependencyFocusUtils.js` while dependency chip UI and lookup fetching remain unchanged.

26. `DONE-codebase-operability-sprint-service-extraction.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: sprint cache, board sprint loading, JQL fallback sprint discovery, and sprint de-duplication logic moved to `backend/services/sprints.py` while `jira_server.py` compatibility wrappers remain patchable.

27. `DONE-codebase-operability-planning-action-bar.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: the ENG Planning action button row moved to `frontend/src/eng/PlanningActionBar.jsx` while Planning state, handlers, capacity math, and persistence stay in `dashboard.jsx`.

28. `DONE-codebase-operability-stats-cache-service.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: completed-sprint stats file-cache load/save/invalidation and cache-key construction moved to `backend/services/stats_cache.py` while `jira_server.py` compatibility wrappers remain patchable.

29. `DONE-codebase-operability-planning-capacity-bar.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: the ENG Planning capacity bar and selected-summary fallback moved to `frontend/src/eng/PlanningCapacityBar.jsx` while Planning state, capacity math inputs, team microbars, and project split bars stay in `dashboard.jsx`.

30. `DONE-codebase-operability-update-check-service.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: `/api/version` git command, release-info fallback, and update payload construction moved to `backend/services/update_check.py` while `jira_server.py` compatibility wrappers remain patchable.

30. `DONE-codebase-operability-planning-project-split-bar.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: the ENG Planning selected-SP-by-project bar moved to `frontend/src/eng/PlanningProjectSplitBar.jsx` while selected project stat derivation, excluded capacity math, and Planning state stay in `dashboard.jsx`.

31. `DONE-codebase-operability-priority-weights-service.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: stats priority weight normalization, env parsing, and effective config selection moved to `backend/services/priority_weights.py` while `jira_server.py` compatibility wrappers remain patchable.

32. `DONE-codebase-operability-team-catalog-service.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: team catalog, catalog metadata, and group team-label normalization moved to `backend/services/team_catalog.py` while `jira_server.py` compatibility wrappers remain patchable.

33. `DONE-codebase-operability-group-config-service.md`
   - Completed in PR #54 (`879ad59`) after local verification on 2026-05-28. Use for audit only; do not execute as active work.
   - Expected output: team-group env parsing, validation, and default construction moved to `backend/services/group_config.py` while `jira_server.py` compatibility wrappers remain patchable.

## EPM Settings Bugfixes

1. `DONE-epm-label-config-bugfixes.md`
   - Bugfix plan for the EPM Settings → Projects label configuration. Completed and
     merged in [PR #90](https://github.com/Juce-me/jira-execution-planner/pull/90) (branch `bugfix/epm-label-config`, commits `2138ab1`, `b24a091`,
     `b39e1f7`/`ac3dcaf`, `78a6b06`/`12af7da`). Use for audit context only.
   - Expected output: the label-prefix mask `*` is stripped before the Jira
     `startswith` filter so prefix autocomplete returns results, the label dropdown
     opens reliably from "Choose label" (no anchor race), every project row has one
     consistent compact delete with session-only removal plus a clear notice that
     Home-discovered projects reappear until closed/paused/archived in Jira Home, and
     the active label prefix is shown as a hint pill with a descriptive placeholder.
   - No new routes, no auth-mode change, no Home/Jira writes; `GATE-05` unaffected.

## ENG Epic Sort And Track

1. `DONE-eng-epic-sort-and-track.md`
   - Completed and merged in [PR #92](https://github.com/Juce-me/jira-execution-planner/pull/92). Read-only epic header enrichment plus epic ordering in the ENG view. Use for audit context only.
   - Expected output: each ENG epic header shows an effective-priority pill (highest-urgency child) and a Product Track emoji (🔒 Committed / 🤷 Flexible) read from the configurable `projectTrackField` Jira custom field (default `customfield_35024`); a single `sprint-dropdown`-styled Sort control orders epics by Priority, Status (built-in workflow-phase fallback), or Track (committed-first / flexible-first), each tie-broken by priority, with the choice persisted in localStorage UI prefs.
   - No new routes, no Jira writes, no auth-mode change; `GATE-05` unaffected. The board-imported per-group workflow source and group-by-kanban-column grouping are deferred to a separate future plan; the sort comparator already accepts an injected phase-rank map.

2. `SUPPORT-eng-project-track-write-switch-design.md`
   - User-approved design reference for the follow-up OAuth-backed ENG Project Track write plan.
   - Expected output: every real ENG Epic header renders 🔒 Committed, 🤷 Flexible, or ⚪ Unidentified; clicking the indicator in Catch Up or Planning opens the existing compact issue-field option-menu behavior and writes only the configured Jira Project Track field through the signed-in user's OAuth context, with the same queue, optimistic update, rollback, stale-scope, auth-recovery, analytics, and surface-isolation contracts as status and priority changes.
   - No Home/Townsquare or EPM mutation; `GATE-05` is historical context only. This support document feeds `DONE-eng-project-track-write-switch.md`, which now exists.

3. `DONE-eng-project-track-write-switch.md`
   - Completed and merged in [PR #112](https://github.com/Juce-me/jira-execution-planner/pull/112) (branch `feature/eng-project-track-write-switch`). Use for audit context only.
   - Expected output: every real ENG Epic header renders an always-visible 🔒/🤷/⚪ Project Track indicator that, on Catch Up/Planning with Settings closed, is a native button opening the shared compact option menu and writing only the configured Jira Project Track field between Flexible and Committed through the signed-in user's OAuth context, with the same queue/optimistic/rollback/stale-scope/auth-recovery/analytics contracts as status and priority changes.
   - No Home/Townsquare or EPM mutation; `GATE-05` unaffected.

- [ENG Group Board](DONE-eng-group-board.md): Render Department-configured Board columns, Epic cards, scoped facets and guarded issue interactions.

5. `EXEC-eng-board-optional-sprint-measurement-spike.md`
   - Diagnostic Tasks 0–5 implemented and verified on 2026-09-07 from `5c385ac`; the original twenty
     findings, follow-up closures and sanitized execution evidence are recorded in §§11–12.
     Task 6 startup and authenticated options preflight ran on 2026-09-07, but the campaign stopped
     before sampling because the saved workspace had two Component-eligible Departments and zero
     Team-fallback-eligible Departments. No configuration/Jira mutation or result artifact was made.
   - Corrective follow-up adds a loopback-only Python collector over the existing authenticated
     groups/tasks GET endpoints. It skips unusable no-Team Departments and stores only sanitized
     contextual aggregates outside the repo; legacy caps keep it non-authorizing.
   - A 2026-09-07 operator-approved Basic-auth/jsonfile run sampled the one active numeric sprint:
     one Department eligible, zero skipped; selected-sprint Product/Tech returned 83/109 issues in
     1,696.0/1,598.1 ms and 108,559/122,167 bytes without triggering the cap heuristic; All-work
     Product/Tech each returned 250 issues in 3,237.4/2,598.5 ms and 271,499/247,444 bytes with both
     legacy-cap flags set. Epic-detail/scope-Epic cardinalities are recorded in §15 of the plan.
     This is contextual evidence for one Basic-mode Department, not strict completeness,
     signed-in-user OAuth, transport, hard-deadline, excluded-scope, visible-progress, or production
     authorization evidence. No production `EXEC-*` plan was created; schema v2 can never PASS.
   - Local strict DB-OAuth diagnostic only: read-only existing-row options, CSP-compatible runner,
     isolated campaigns/transport, guarded legacy cache returns, Epic-first Team fallback,
     explicit cache states, private row-incarnation checks and consistent workload/retry/memory metrics.
   - Five rounds characterize saved Product/Tech Boards at 28-day retention with selected-sprint,
     All-work and all-saved-Team fallback candidates. Legacy calls are contextual, not equal work.
   - Historical diagnostic conclusion: cooperative cancellation cannot prove hard termination.
     The active `DONE-eng-board-all-work.md` contract now explicitly accepts that residual risk
     and gates production on bounded known I/O, strict ceilings, completeness and measured speed.

6. `SUPPORT-eng-board-optional-sprint-design.md`
   - Reviewed non-executable design for GitHub issue #137 and production handoff boundary after the
     diagnostic Tasks 0–5 implementation; authenticated Task 6 preflight is blocked by the absence
     of a saved Team-fallback-eligible Department. A separate capped Basic-mode collector sample is
     recorded as contextual evidence only and does not close any production gate.
   - Settled behavior: Board renders the existing Catch Up snapshot for the ordinary sprint selected
     in the shared top Sprint control. While Board is active, that same control presents **All work**,
     **Component**, and ordinary sprints. Either cross-sprint choice starts one strict Board request
     without changing the saved sprint. Component contains only exact `missingInfoComponents` matches
     on Epics; All work unions those Epics with parents discovered from eligible Department-Team work,
     even when Components exist. Teams stays visible but disabled; Project Track is Epic-index
     data; Product/Tech Projects is inherited from each child's Jira project; directly-created
     terminal Epics use `created` for retention; Unmapped remains before the structural terminal column.
   - This support design's original hard-deadline alternatives are superseded by the active
     execution plan's approved bounded best-effort single-request transport. Refresh granularity,
     excluded-scope coverage, completion budgets and safety ceilings remain measurement-gated.
     The validated pure core must be reused.
     Board request retirement, mutation generation ordering and bounded telemetry are specified.
     Follow-up review closes terminal-identity migration, delayed sprint initialization and provisional
     page-progress contracts; streaming needs an opt-in shared HTTP boundary before selection.

7. `DONE-board-epic-description-smart-links.md`
   - Accepted by the requester and executed in `3770d2b`; use for audit context only.
   - Jira ADF `inlineCard` and `blockCard` nodes in Board Epic descriptions render as escaped,
     allowlisted links using the URL as fallback text. Unsafe or missing URLs render nothing; the
     existing lazy description fetch, sanitization boundary, clamp, cache, and analytics privacy
     contract remain unchanged.

- [Sticky Board column chrome](DONE-sticky-board-column-chrome.md): Pin open-column headers and collapsed rails beneath shared controls outside desktop pane mode.

- [Board help, fixed titles and ADF tables](DONE-board-help-title-adf-tables.md): Show Board guidance on demand, contain long card titles and preserve semantic ADF tables.

- [Board Configuration horizontal scrolling](DONE-board-configuration-horizontal-scroll.md): Reach every configuration column through wheel, keyboard controls and drag-edge scrolling.

## Stats Project Track By Sprint

1. `DONE-stats-project-track-by-sprint.md`
   - Completed and merged in [PR #95](https://github.com/Juce-me/jira-execution-planner/pull/95) (branch `feature/stats-project-track-quarters`). Use for audit context only.
   - Expected output: a `Project Track` ENG stats sub-tab (after `Mono vs Cross`) with a filter bar (shared Start/End sprint range, Capacity side Product/Tech/Tech+Product, Exclude Ad Hoc, Exclude Excluded Capacity, Mode Epic/Team), a mode title, a range totals bar, a per-sprint chart (hidden for a single-sprint range), a By assignee/By team breakdown, and an Epic-mode-only time-in-phase section built from a new bounded, read-only `POST /api/stats/project-track-phase-durations` endpoint.
   - No Jira/Home writes, no auth-mode change; `GATE-05` unaffected. See the plan's `## Outcome` and `## Current Accuracy` sections for as-built divergences from the original endpoint-contract text (response field names, absence of `cached`/`generatedAt`, client-side signature caching).

## Stats Controls Unification

1. `DONE-stats-controls-unification.md`
   - Initial implementation completed on `improvement/stats-controls-unification` (2026-07-15, execution commits `331f3c9..2d5f0a7`; full JS/Python/Playwright regression green apart from 2 pre-existing `eng_alerts_panel_summary` failures inherited from the ancestor branch). The Lead Times control-row compaction follow-up was implemented in `8b3f32d` (`fix: compact lead times controls`) on 2026-07-16. Final-review fix `16ff875` (`fix: contain stats range panels`) constrains all mobile stats range groups/panels without changing the global Sprint and aligns the six actual Lead Times control surfaces. Fresh verification: source guards 15/15, focused Playwright 4/4 across all four range views and Task 7 exclusions/layout, frontend unit 519/519, structure budget 1/1, and build green. Inspected desktop and three 375px screenshots show aligned Lead Times controls and readable, normally clickable long sprint options contained within each narrow stats panel. The measured 966px stats container uses the approved 8.5rem select flex basis instead of the planned 12rem, which required 1067px and wrapped Exclude. The plan was merged in [PR #108](https://github.com/Juce-me/jira-execution-planner/pull/108). The implementation unifies Statistics Start/End ranges through one stats-owned component extracted from the existing `sprint-dropdown` pattern, reusing `ControlField`, `.controls-label`, `.view-filters`, `.sprint-dropdown*`, `SegmentedControl`, and the corrected Project Track checkbox treatment; per-task divergence notes live in the plan.
   - Expected output: Excluded Capacity, Mono vs Cross, Project Track, and Lead Times share one accessible downward-opening range-control implementation; Lead Times Group By uses the existing segmented control; its capacity filters render as an `Exclude` group with `Ad Hoc` + `Excluded Capacity` checkboxes while retaining explicit accessible names; range/refetch/persistence semantics stay unchanged and receive pointer, keyboard, view-switch, reload, layer, and narrow-viewport verification.
   - No backend route, auth/CSRF, Jira/Home credential, mutation, or new analytics-event contract; the global sticky Sprint control, Project select, and Assignee select remain out of scope.

## Analytics

1. `DONE-ga4-instrumentation.md`
   - Completed and merged in [PR #58](https://github.com/Juce-me/jira-execution-planner/pull/58). GA4/GTM dataLayer instrumentation implemented in app code on 2026-05-30. Use for audit context only.
   - Output: two-trigger GTM dataLayer contract (`pageview`/`userevent`), `GA4_ENABLED` transport gate with no in-app consent UI, and typed event params per `docs/README_ANALYTICS.md`.
   - 2026-10-16 local repair: explicit per-occurrence DLV clearing, logout/auth-expiry identity/debug clearing, and a validator-compatible 25-parameter core. Full native mapping, Google tag sequencing, Enhanced Measurement and external receipt gates are in `SUPPORT-ga4-user-configuration.md`; instance-specific preparation and external receipt evidence stay in the private operator handoff.

## Legacy Unclassified Date-Only Plans

These files predate the `EXEC`/`DONE`/`GATE`/`SUPPORT`/`FUTURE` taxonomy. Treat them as unclassified historical context, not executable current plans, until a reviewer classifies and renames them or moves them to `docs/agents/`:

- `2026-03-03-epic-lead-time-cohort-design.md`
- `2026-03-03-epic-lead-time-cohort.md`
- `2026-03-04-create-stories-alert.md`
- `2026-03-06-create-stories-alert-design.md`
- `2026-03-06-split-team-catalog-design.md`
- `2026-03-06-split-team-catalog-plan.md`
- `2026-03-13-compact-sticky-header-design.md`
- `2026-03-13-compact-sticky-header.md`
- `2026-03-18-config-save-refresh-design.md`
- `2026-03-18-config-save-refresh.md`
- `2026-03-24-epic-icon-swap-design.md`
- `2026-03-24-epic-icon-swap.md`
- `2026-03-24-needs-stories-alert.md`
- `2026-03-30-planning-module-improvements-design.md`
- `2026-03-30-planning-module-improvements.md`
- `2026-03-31-scenario-planner-improvements.md`
- `2026-03-31-team-selection-persistence-and-compact-team-cards-design.md`
- `2026-03-31-team-selection-persistence-and-compact-team-cards.md`
- `2026-04-09-incomplete-stories-visual.md`
- `2026-04-10-initiative-level-grouping.md`
- `2026-04-20-epm-project-view.md`
- `2026-04-21-epm-project-rollup.md`
- `2026-04-27-epm-active-sprint-visibility.md`
- `2026-04-27-epm-project-config-tab-cache.md`
- `2026-04-27-epm-view-extraction.md`
- `2026-04-28-epm-goals-2-3-portfolio-active-sprint.md`
- `2026-04-28-epm-zero-manual-portfolio-default.md`
- `2026-04-29-epm-portfolio-ui-cleanup.md`
- `2026-05-04-epm-multi-subgoal-scope.md`

## Known Artifact Drift

Use this section to avoid treating missing historical artifacts as current work:

- Legacy EPM plans that reference `frontend/src/epm/epmFetch.js` predate the frontend API consolidation. Current EPM API wrappers live in `frontend/src/api/epmApi.js`; `2026-05-01-codebase-structure-optimization.md` records that history.
- `docs/features/epm-rollup.md` was optional in `2026-04-21-epm-project-rollup.md` and is not present in this checkout. Current operator-facing EPM rollup guidance lives in `docs/features/epm-view.md`.
- `2026-04-21-epm-settings-scope-and-linkage.md` and `2026-04-21-epm-goal-picker.md` were branch-only predecessor plans referenced by `2026-04-21-epm-project-rollup.md`; they are not present in this checkout.
- Missing files named under `Create:` or unchecked task lists inside legacy, `DONE-*`, or `SUPPORT-*` plans are not automatically current missing artifacts. Create them only when a reviewed `EXEC-*` plan or explicit reopened scope requires them.
- Generated local cache files such as `team-groups.json`, `team-catalog.json`, and `sprints_cache.json` may be absent in a checkout and should not be recreated for documentation cleanup.

## Expectations

- Before executing any `EXEC-*` plan, run the preflight commands named in that plan.
- At session startup for relevant auth, DB, Home/Townsquare, EPM, or plan work, check every `GATE-*` doc; update `Checked on` plus `Last result` only when the result changed or `Next review` has passed.
- Keep Home/Townsquare user 3LO blocked unless `scripts/check_home_graphql_oauth.py` records a real `PASS home_graphql_3lo_supported`.
- Before the `DONE-04` commits, workspace Home/Townsquare reads were service-integration-backed while the Home 3LO gate failed.
- `DONE-04` supersedes that earlier service-backed EPM read assumption for DB/OAuth mode: EPM Home reads use the current user's connected `atlassian_user_api_token`, and that token is never a shared service credential.
- Commit each completed task with the commit message specified in the plan.
- Rename an `EXEC-*` plan to `DONE-*` only after implementation is completed and verified, in the commit that completes the work and before the push or PR (merge is not required first; a plan executed across several PRs keeps `EXEC-*` until the PR that completes it), then add a top status note with the execution branch, commit or PR.

## Repo Hygiene

- `DONE-root-cleanup-docs-postmortems.md`
  - Completed and merged in [PR #99](https://github.com/Juce-me/jira-execution-planner/pull/99). Root-folder cleanup: icons to `assets/`, `install.sh` to `scripts/`, postmortems to `docs/postmortem/`, redundant root docs removed, AGENTS/README aligned. Use for audit context only.

- [Catch Up subtask layout #346](DONE-catch-up-subtask-layout-346.md): Fill expanded Story panels and size aligned status pills to their labels, preserving Board and Planning consumers.
