# Connection Recovery Reload

Status: planned
Type: bugfix

## Outcome

Replace the current partial `Retry connection` fan-out with a guarded full-document reload that
matches the known-good CMD+R recovery path. Preserve supported unsaved work in a short-lived,
tab-local recovery capsule and restore it only after fresh authenticated bootstrap has established
the same user, workspace, private view, and current server revisions.

## Scope

The first version preserves:

- the existing safe shell and Planning recovery state;
- an open Settings draft, including its active settings tab and dirty editable sections;
- unsaved Scenario Planner overrides and the active Scenario draft context;
- the active view and the user's scroll position after the restored content is ready.

Transient inline Jira editors are excluded. Their unsaved values are short-lived field inputs rather
than an established draft workflow, and persisting them would broaden the recovery and security
contract beyond this bug.

## Root Cause

`retryServerConnection` currently clears the banner and launches configuration, groups, selected
projects, priority weights, sprints, Home connection, and sometimes EPM requests independently.
Those requests run against a partially initialized React tree and do not reproduce the ordered
document bootstrap. The ENG active-view path is not reloaded by that retry function. The header's
Jira refresh action assumes the missing bootstrap dependencies are coherent, so it can compound the
failure. A browser reload works because it rebuilds all module and component state and follows the
normal bootstrap ordering.

## Chosen Design

### Recovery states

Connection recovery has four explicit states:

1. `idle`: no backend connection failure is active.
2. `unavailable`: the existing connection banner is visible.
3. `checking`: one backend/auth readiness request is in flight; duplicate attempts are ignored.
4. `restoring`: a valid recovery capsule has been captured and a full-document reload has begun or
   the new document is progressively applying it.

The banner remains authoritative while recovery is unavailable or checking. The header Jira refresh
control is disabled during these states because it is a scoped Jira-data refresh, not an application
bootstrap recovery action.

### Retry and tab-return behavior

The Retry button and a hidden-to-visible tab return while `unavailable` call the same single-flight
recovery function. Ordinary focus events without an active connection failure keep the existing auth
refresh and long-absence behavior and never reload the document.

The recovery function performs one lightweight authenticated backend readiness request. A network
failure retains the unavailable banner. An authentication-required response enters the existing
terminal auth lock. A successful response captures the recovery capsule and calls
`window.location.reload()` exactly once. It does not launch the old parallel loader fan-out.

### Tab-local recovery capsule

Use `sessionStorage`, not `localStorage`. The capsule is isolated to one top-level tab and survives a
same-tab reload without crossing into sibling tabs or persisting indefinitely. Keep it separate from
the existing auth-resume capsule because that capsule intentionally excludes configuration and
Scenario drafts.

The capsule must be:

- versioned and schema validated with exact-key checks;
- limited to 30 minutes and a documented maximum serialized byte size;
- bound to the authenticated workspace id and private view-config id, whose ownership already scopes
  the existing auth-resume capsule to the current application user;
- written only after all required identity fields are known;
- strict about allowed Settings and Scenario fields;
- cleared on expiry, malformed data, size overflow, principal mismatch, successful restoration, or
  explicit discard;
- fail-safe when browser storage is unavailable.

Never store credentials, emails, API tokens, OAuth data, request headers, response bodies, loaded
Jira issue records, summaries, assignee data, analytics context, or arbitrary React state. Jira issue
keys may be stored only where they are already structural identifiers in an established draft.

### Settings restoration

Capture only dirty editable Settings sections and the revision/baseline identifiers needed by their
existing concurrency contracts. After the new document loads fresh configuration, groups, EPM data,
and permissions, validate that the same sections are still editable. Reapply the local draft over the
fresh normalized baseline through the existing draft setters.

If a captured base revision differs from the freshly loaded server revision, do not silently overwrite
the new baseline or auto-save. Restore the local values as an unsaved conflict using the existing
conflict UI and require the user to resolve or save explicitly. Credential inputs remain blank.

### Scenario restoration

Capture the established Scenario draft identity, base version/revision, normalized local overrides,
and the minimum view state required to reopen Scenario. After fresh Scenario scope and draft history
load, restore overrides only when the workspace, view, sprint, group, and draft identity still match.
If the server version advanced, preserve the local overrides in the existing remote-conflict state;
never replay a write or publish automatically.

### Progressive position restoration

Restore in dependency order:

1. fresh authenticated config and principal;
2. active group, sprint, and top-level view;
3. Settings or Scenario draft after its fresh baseline is ready;
4. modal/tab state;
5. scroll position after the target content has rendered.

Each phase is idempotent and records completion so React effects cannot reapply a draft or scroll more
than once. If a requested scope no longer exists, use the normal product fallback, keep any safe
recoverable draft visible as a conflict where possible, and explain why exact position restoration was
not possible.

## Error Handling

- Storage write failure: keep the banner and report that recovery cannot safely reload without losing
  unsaved work; do not reload.
- Oversized or invalid draft: keep the current document and report that automatic recovery cannot
  preserve it; do not truncate silently.
- Readiness request remains unavailable: keep the existing banner and allow another later attempt.
- Authentication expiry: delegate to the existing global auth lock without issuing more requests.
- Capsule validation or principal mismatch after reload: clear it and continue with a clean bootstrap.
- Restoration conflict: keep the draft unsaved and surface the established conflict workflow.

## Analytics

This is reliability recovery, not a new product action. Add no new `userevent`. Existing bounded
`api_result` and `app_error_shown` coverage remains authoritative. The capsule and recovery state must
never be included in analytics payloads. Record this allowlist decision in `docs/README_ANALYTICS.md`.

## Expected File Areas

- `frontend/src/api/`: a focused connection-recovery capsule and readiness helper.
- `frontend/src/components/ServerUnavailableBanner.jsx`: unavailable/checking/restoration copy and
  disabled/busy behavior.
- `frontend/src/dashboard.jsx`: capture, ordered restoration, single-flight reload, focus wiring, and
  Refresh Jira gating.
- `tests/`: capsule validation and source-contract tests.
- `tests/ui/`: clean retry, tab-return recovery, dirty Settings restore/conflict, dirty Scenario
  restore/conflict, unavailable retry, auth expiry, duplicate-event, and scroll restoration coverage.
- `docs/ontology.md`, `docs/README_ANALYTICS.md`, and affected feature documentation.

Generated `frontend/dist/` output is rebuilt from source and is never edited directly.

## Acceptance Criteria

- Retry performs one readiness request and one document reload after recovery, with no parallel
  bootstrap-loader burst.
- Returning to a previously unavailable tab triggers the same single-flight recovery once.
- Ordinary focus and long-absence refresh do not reload unless the connection banner was active.
- Refresh Jira cannot run while connection recovery is unresolved.
- Dirty Settings and Scenario work survives the reload for the same principal and scope without any
  automatic write.
- Fresh server changes produce the existing conflict state rather than a silent overwrite.
- Another tab, user, workspace, or private view cannot consume the capsule.
- Invalid, expired, oversized, or unavailable storage never causes data loss through an automatic
  reload.
- Position restoration occurs only after the restored target is rendered and does not repeat.
- Focused unit and browser tests pass, the frontend is rebuilt, and before/after screenshots verify the
  banner's unavailable, checking, and restored-draft states.

## Forbidden Regressions

- No credential, token, email, loaded Jira payload, or arbitrary request/response data enters browser
  storage.
- No mutation is replayed after reload or authentication recovery.
- No cross-tab draft restoration.
- No silent conflict resolution or stale revision overwrite.
- No reload loop when the backend remains unavailable or bootstrap fails again.
- No change to normal auth focus refresh when the server connection banner is absent.

## Current Accuracy

Planned design. No product implementation has been applied yet.
