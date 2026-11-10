# Planning finalization: separated follow-ups

> **Status:** Deferred. Split from the completed shared Planning, every-Team capacity and Department Allocation plans on 2026-11-10 by operator instruction. Browser fixes are tracked in [#337](https://github.com/Juce-me/jira-execution-planner/issues/337), labeled `bug` in project JDP. Runtime and operator acceptance are tracked in [#338](https://github.com/Juce-me/jira-execution-planner/issues/338). Review and scope each implementation slice before execution; this record does not authorize live access, deployment, data cleanup or behavior changes.

## Delivered implementation

- [Shared Planning](DONE-planning-shared-plan-331.md): shared inclusion and atomic app-owned review save, scoped projection/recovery, DB/OAuth-only runtime, PostgreSQL single-use CSRF and Table-only presentation.
- [Every-Team capacity](DONE-planning-team-capacity-every-team-323.md): every displayed Team's own stored number, bounded batch reads, independent save owners, own-ticket push, hover/touch controls and row-choice retention.
- [Department Allocation](DONE-department-allocation-board-scope.md): shared Department values and Product/Tech mapping, manually configured empty initial lists, saved-map cache isolation and distinct Component/Allocation scopes. Ready promoted quarters supply Board authority; both era choices are listed and the other era is unavailable.

Closing those records does not attest a real installation cutover, resolve every verification exception, or approve the product choices below. The original design/checklists remain historical evidence.

## Browser fixes — #337

| Case | Observed failure and evidence | Required next work |
| --- | --- | --- |
| Issue-type fallback, `tests/ui/work_structure_entity_names.spec.js` | The immediate fallback snapshot retained the child image. Child-only delayed 404 reproduced the exact failure 3/3; immediate controls passed 3/3; all delayed requests subsequently fell back. A readiness-before-snapshot counterfactual passed 3/3 with unchanged glyph and settled geometry assertions. Actual renderer/test block are unchanged from the pre-branch baseline. | Add a delayed-response regression, then await mounted rows/ancestor and zero role-image elements before taking the glyph snapshot. Keep all existing fallback and geometry checks. No production renderer defect is demonstrated; the original full-run scheduling trigger was not captured. |
| Firefox header Refresh, `tests/ui/planning_assignee_capacity.spec.js` | Expected scroll45, received42; editor text/focus and clean-Team read checks passed. Thirty isolated original cases and the original-order replay passed; target161 passed after the same preceding order. The earlier six-run geometry probe also passed. | Capture a recurrence with baseline/settled/pre-dispatch/final scroll, maximum scroll, table and stack geometry. Distinguish a premature baseline from a post-action clamp before changing code. Preserve exact equality and every draft/read/write assertion; no tolerance or timeout increase. |
| WebKit stored-number pencil navigation, same spec | The 30-second test deadline expired during `page.goto` waiting for load, before pencil assertions. Eighty reused-browser target cases passed; the ordered replay target passed after 61 same-worker predecessors. | Capture outstanding resources, request/lifecycle events, readyState, UI readiness and browser/worker identity during an actual hang. No cause or waitUntil change is justified by passing replays. |
| WebKit auth-expiry navigation, `tests/ui/planning_capacity_real_server.spec.js` | The same deadline expired before expiry/recovery assertions. Twenty reused-browser targets passed; the ordered replay target passed after 57 same-worker predecessors, including its complete expiry/no-replay assertions. | Capture the navigation failure separately from authentication behavior; preserve the real disposable-PostgreSQL journey and all terminal-recovery/no-replay checks. |

The two bounded reproduction approaches did not establish causes for the last three cases. Their original failures remain open; a passing diagnostic is not a waiver. Instrumentation/tracing can alter timing. The final WebKit replay used the original trace-off setting plus a passive request/lifecycle ledger and captured no pending-navigation/error event.

The ordered WebKit replay also observed keyboard Space failing to activate Catch Up during an in-flight push (`planning_assignee_capacity.spec.js`, original case near 4351). The original full gate passed that case. It is an unconfirmed, separate keyboard-only observation, deferred under existing policy rather than a fifth confirmed bug.

Fix verification must use the actual failing seam, retain assertions/default timeouts and existing skip policy, and run the repository's required final gates at the fix head. Use Node 20 and synthetic browser fixtures. Real-server tests use only their owned disposable PostgreSQL cluster; backend tests use `tests/run_isolated_runtime_tests.py`. Never use the running application's port/database or read private configuration/credential files for this work.

## Release and product acceptance — #338

- **Integrated shared-plan recovery acceptance:** normal mounted real-server include/save/reload/readback, HTTP receipt/replay tests, mocked capsule recovery and separate DB auth lifecycle checks exist. The complete real-session paused-save, dropped acknowledgement, later-edit and cross-document restore/reconciliation journey remains unverified. `planning_shared_plan_fixture.js` exposes `pauseSave`, `releaseSave` and `dropNextAckAfterCommit`, but no test calls them. Add actual mounted journeys using those seams, real disposable PostgreSQL and provider stubs; prove preserved later edits and no write replay. Do not describe focused/controller or ordinary reload coverage as this integrated acceptance.
- **E5 real installation and provider SSO:** synthetic compatibility/restart/security results do not prove the actual installation. A separately authorized target and nonsecret effective-profile evidence are required before cutover. Preserve encrypted/session/private-view state and the frozen supported-profile contract. Actual Atlassian/Microsoft Entra SSO remains operator acceptance; this branch does not inspect private configuration or run live probes.
- **CI and release:** read the actual pushed checks, including PostgreSQL-binary discovery. Local success does not attest online CI, a release workflow or a deployment.
- **Resting no-capacity height:** synthetic before/after row crops are 70/82 px, approximately 12 px taller. Idle/editing geometry is tested and current hover/editor glyphs were manually inspected in Chromium, Firefox and WebKit. Obtain an explicit disposition; do not describe manual synthetic inspection as missing or infer approval of a redesign.
- **Toggle-paint signoff:** historical React-development samples against `55ef631b` at 500/2,000/5,000 Stories have head/base p50 (ms) 171.1/167.7,854.7/841.1,1820.8/1773.6 and p95 (ms) 450.1/433.9,932.5/988.5,2161.7/2113.4. Operator signoff is unrecorded. New measurements must identify source/runtime/build/sample conditions; these figures are not production latency.
- **Recovery capsule:** the v2 capsule stays staged while the Department chooser is open. Decide whether to retain that behavior; any change preserves principal/scope binding, bounded storage, drafts and no automatic write replay.
- **Mock origins:** older mocked specs retain defaults on the main application's port. All finalization runs used safe explicit overrides. Decide on a separate default-origin cleanup; never stop another server.

## Runtime hardening — #338

These are independent reviewed slices, not one broad implementation mandate:

- The unpointed-only Team two-read case, unconfigured-ticket containment, larger-installation costs and missing typical Team/document counts remain in [the existing capacity follow-up](FUTURE-planning-assignee-capacity-deferred-323.md). Only maximum 12 Teams is recorded; do not invent typical or lifetime-document usage.
- Older DB-cookie concurrent upgrades can create multiple browser-session rows and one fail-closed CSRF 403 for a losing row. Add deterministic PostgreSQL race evidence before changing upgrade/issuance behavior. Browser-session expiry/orphan cleanup remains separately designed; no destructive cleanup is authorized here.
- Read/session-reset fencing and automatic-refresh eligibility after a manual Refresh remain the existing [TODO Deferred](../TODO.md#deferred) entries. Do not silently widen the scope of #337 to these older paths.
- A SIGKILL can leave an owned disposable test cluster under ignored scratch. A possible reaper must prove ownership before cleanup; never target an application or unrelated cluster.
- Extraction lint remains red at the audited checkpoint: 111 warnings, 51 interface diagnostics and one `WorkConfigurationsEditor.jsx` handle dependency violation, while physical budgets pass. Re-review contracts before re-stamping digests; never raise baselines/ceilings merely to clear the gate.
- Existing headed exceptions stay separate: Firefox Product/Tech editor contexts, WebKit Jira keyboard focus, native undo and intermittent mirror/unresolved-Team cases. Preserve actual failure stages and assertions. Keyboard-only work, including Tab-after-Enter and the Department Allocation picker, stays deferred.

The independent [Home write gate](GATE-05-home-write-capability.md) remains blocked; Planning closure does not authorize it.

## Evidence and completion rules

At `c920a86a`, build passed; the isolated backend ran 3,617 tests (`OK (skipped=1)`), Node passed 3,707, runtime probes passed 6 and freshness passed 435 with five repetitions. Complete Chromium was 2,388 pass/34 skip/1 fail; headed Firefox 221/6/3 and WebKit 219/6/5. Five headed case failures were previously accepted; four newly investigated failures are the #337 scope above. Those are historical counts, not results for later commits.

Ignored local evidence is under `tmp/planning-323-every-team/finalize-allocation/` and `investigate-four/` within it. It is supplementary, not a required input for another maintainer: both GitHub issues contain source entry points, reproduction commands, findings and safety/acceptance instructions. Final publication-head commands/results and history/path inventories use `tmp/planning-323-every-team/publication/`.

Close each follow-up only with a regression or explicit evidence-backed disposition. Update its GitHub issue, this record and TODO; keep the completed implementation plans audit-only. Do not claim all gates green when lint or named browser failures remain.
