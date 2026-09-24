# Connection Recovery Reload Implementation Plan

> **For agentic workers:** use `superpowers:executing-plans` and implement each task test-first.

**Status:** implemented and verified locally on 2026-09-23; review follow-up implemented on 2026-09-24; pending acceptance or merge
**Branch:** `bugfix/connection-recovery-reload`

## Goal

Replace the partial in-place `Retry connection` fan-out with one guarded hard reload that follows the
known-good browser-refresh bootstrap. Preserve only unsaved Scenario Planner overrides and recoverable
position state. Reload all Settings and EPM data from their saved server versions.

## Resolved contract

- Probe `/api/config?includeViewConfig=true` once through the existing authenticated client, bounded
  by a 10-second timeout. A timeout or a still-refused connection keeps the page, re-enables Retry, and
  says why; it never reloads.
- The recovery principal is the exact `{workspaceId, viewConfigId}` when `viewConfig` is present. JSON
  mode (no `sharedConfig`) uses a local principal scoped to the configured Jira site. DB mode without a
  resolved view config, or a page that never bootstrapped, has no principal and reloads without a capsule.
- If the fresh principal differs from the mounted one, reload without a capsule. When dirty Scenario work
  would be lost, require explicit `Reload and discard` first.
- Before capturing the capsule, wait (bounded by the probe timeout) for in-flight write requests tracked
  by `apiFetch`, so a save that lands during the outage is not reported as a remote conflict.
- A `401` always wins: do not write a connection capsule or reload after the global auth lock is set.
- While connection recovery is active, suppress auth-focus refresh and the long-absence Jira refresh.
- Persist a session-scoped outage attempt marker across documents. One automatic reload is allowed per
  outage. A later attempt for that outage requires the explicit Retry button. The outage ends once the
  config, groups, and Sprint bootstrap reads each receive any HTTP response; a Jira/HTTP error from a
  reachable server does not keep the marker alive.
- Refresh Jira is disabled only while the server is unavailable or recovery is checking, waiting for a
  save, or reloading/restoring. Terminal `blocked_scope` and `failed` states leave it enabled.
- Store no Settings values. If Settings was dirty, store only `droppedSettings: true` and show a notice
  after reload that unsaved configuration was discarded.
- Store no EPM draft state. EPM always reloads fresh.
- Restore Scenario only after the exact group and sprint exist and the same principal is active.
- Permit exactly one recovery-owned `/api/scenario` compute POST after reload. It is a fresh read/compute,
  not mutation replay. Never replay draft save, publish, rollback, reload-from-Jira, or Jira writes.
- If the Scenario revision changed, retain the fresh server baseline, overlay the local overrides, enter
  the existing `conflict_remote` state, disable direct Save, and require existing conflict resolution.
- If group/sprint is missing, retain the capsule until its 30-minute expiry and show Recover/Discard.
- If capsule storage fails and Scenario is dirty, do not reload. If Scenario is clean, reload without a
  capsule. If Settings is dirty but the capsule cannot be stored, require explicit `Reload and discard`.
- Restore scroll only after the target view renders, using the live Scenario timeline element and two
  animation frames with clamping.

## Deterministic capsule precedence

Validate auth-resume and connection-recovery capsules independently against the fresh exact principal.

1. If only one is valid, apply it.
2. If both are valid, auth-resume owns shell/navigation state.
3. Connection recovery may still restore Scenario only when its exact group+sprint matches the winning
   shell scope.
4. Invalid, expired, or principal-mismatched capsules are cleared.
5. A connection capsule is consumed once; conflict restoration counts as successful consumption.

| Result | Capsule action | User outcome |
|---|---|---|
| `restored` | clear | local Scenario work restored |
| `conflict` | clear | local work shown in `conflict_remote` |
| `skipped` | clear | no dirty Scenario data required restoration |
| `blocked_identity` | clear | clean bootstrap; no cross-principal restore |
| `blocked_scope` | retain to TTL | Recover/Discard notice |
| `failed` | retain to TTL | explicit retry; no automatic reload |
| `discarded` or `expired` | clear | clean server state |

## File map

- Create `frontend/src/scenario/scenarioDraftOverrides.js` for canonical `{start,end}` normalization.
- Create `frontend/src/api/connectionRecoveryState.js` for the strict Scenario-only capsule and outage marker.
- Create `frontend/src/api/useConnectionRecovery.js` for recovery ownership, probing, and reload orchestration.
- Create `frontend/src/scenario/connectionScenarioRecovery.js` for terminal Scenario restoration.
- Create `frontend/src/components/ConnectionRecoveryNotice.jsx` for recovery notices and actions.
- Modify `frontend/src/api/authRefreshContract.js` and `frontend/src/api/authFocusRefresh.js` for suppression.
- Modify `frontend/src/components/ServerUnavailableBanner.jsx` for recovery states.
- Modify `frontend/src/dashboard.jsx` for capture, probe, reload, restoration, conflict, notices, and gates.
- Modify focused Node and Playwright tests under `tests/` and `tests/ui/`.
- Update `docs/ontology.md`, `docs/README_ANALYTICS.md`, this design record, and the plan index.
- Rebuild `frontend/dist/` using `npm run build`; never edit generated files manually.

## Tasks

### 1. Pure storage and override contracts

- [x] Add failing tests for canonical overrides, exact schemas, TTL, principal mismatch,
  malformed/oversized data, forbidden keys, storage failure, and the persistent outage marker.
- [x] Implement both pure modules without network, analytics, credentials, or event listeners.
- [x] Run focused Node tests and source guards.

### 2. Recovery ownership and reload guard

- [x] Add failing cases for focus suppression, one automatic attempt per outage, explicit manual retry,
  `401` precedence, duplicate events, and disabled Refresh Jira.
- [x] Add shared connection-unavailable events, suppress auth/long-absence refresh, replace retry fan-out
  with a single-flight config probe, and hard reload once.
- [x] Clear the outage marker only after config, groups, and sprint bootstrap are healthy, or normal
  onboarding explicitly makes sprint loading inapplicable.

### 3. Capture and post-reload restoration

- [x] Add failing cases for clean reload, discarded Settings notice, same-revision Scenario restoration,
  changed-revision conflict, exact-scope blocking, recover/discard, storage failure, and scroll.
- [x] Capture only live view and dirty Scenario fields. After reload, stage shell precedence, run one
  Scenario compute, load fresh draft history, then apply local overrides or `conflict_remote`.
- [x] Gate Scenario polling until recovery settles and prevent every mutation replay.

### 4. Documentation, build, and verification

- [x] Document the recovery concept and no-new-analytics allowlist decision.
- [x] Run focused Node/Playwright suites, build, inspect the diff, and capture UI evidence. The backend
  suite could not run in this checkout because its Python environment and dependencies are absent.
- [x] Update the design record to executed accuracy. Do not push without explicit user confirmation.

## Acceptance criteria

- Retry and an unavailable tab's first visible return make one exact-principal config probe and at most
  one automatic hard reload for the outage; they never launch the previous loader fan-out.
- A concurrent `401` produces only the existing auth lock and no recovery reload.
- Auth focus and long-absence Jira refresh do not race connection recovery.
- Refresh Jira is disabled until recovery reaches a terminal state.
- Settings/EPM use fresh saved state; dirty Settings loss is stated explicitly.
- Dirty Scenario work survives for the exact principal/scope, with one compute and no mutation replay.
- A changed revision enters `conflict_remote` with Save disabled.
- Missing scope and failed restoration retain the capsule to TTL with explicit Recover/Discard.
- Storage failure blocks reload only when dirty Scenario work would be lost.
- No reload loop occurs when bootstrap remains broken.

## Review follow-up (2026-09-24)

A branch review found cases where Retry still did not hard refresh, or the refresh was unsafe.

- [x] Retry never reloaded without a mounted workspace/private-view identity (JSON mode, DB mode without
  a view config, or a page that never bootstrapped). Covered by the Board Retry tests in
  `tests/ui/eng_group_board_view.spec.js`, whose fixture has no `viewConfig`.
- [x] The probe had no timeout and could leave Retry stuck on "Checking connection…". Covered in
  `tests/ui/server_unavailable_ui.spec.js`.
- [x] Refresh Jira stayed disabled in terminal recovery states. Covered by the blocked-scope test in
  `tests/ui/scenario_draft_history.spec.js`.
- [x] A changed workspace/private view told the user to reload by hand. Covered by the changed-view tests
  in `tests/ui/scenario_draft_history.spec.js`.
- [x] A non-network bootstrap failure kept the outage marker for its full TTL. Covered by the
  reachable-server test in `tests/ui/server_unavailable_ui.spec.js`.
- [x] Reload did not wait for an in-flight save. Covered by `tests/test_http_pending_mutations.js` and
  the Board in-flight Department save test.
- [x] Merging `main` replaced `loadSprints` with the Sprint catalog controller. The controller now reports
  backend connection failures and marks the Sprint bootstrap healthy. Board selector-scheduling tests from
  `main` that used Retry for in-place rereads are rewritten to the reload contract.
- [x] Each new browser test was checked to fail with its fix disabled.

