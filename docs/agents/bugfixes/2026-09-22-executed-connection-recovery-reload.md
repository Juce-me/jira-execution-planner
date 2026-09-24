# Connection Recovery Reload

Status: executed
Type: bugfix

## Outcome

Replace `Retry connection`'s partial loader fan-out with the same clean document-bootstrap boundary as
CMD+R. Preserve dirty Scenario Planner overrides in a short-lived, principal-bound tab capsule. Reload
Settings and EPM from saved server state; if Settings was dirty, state that its unsaved changes were
discarded.

## Root cause

The current retry clears the banner and independently starts config, group, sprint, Jira, and EPM
loaders against an already inconsistent React tree. It neither recreates bootstrap ordering nor reloads
all active-view data. Refresh Jira then assumes dependencies that may still be absent. CMD+R succeeds
because it rebuilds the document and executes the normal ordered bootstrap.

## Recovery model

Retry and the first hidden-to-visible return while unavailable share one single-flight action:

1. Suppress auth-focus and long-absence Jira refresh while recovery owns the tab.
2. Fetch fresh `/api/config?includeViewConfig=true` within a 10-second bound and compare its recovery
   principal with the mounted one: the exact workspace/private view, a Jira-site-scoped local principal
   in JSON mode, or none. No mounted principal or a changed principal reloads without a capsule; a
   changed principal with dirty Scenario work first requires `Reload and discard`.
3. Wait, bounded, for in-flight write requests before capturing the page.
4. Give any concurrent global auth `401` terminal precedence.
5. Capture a strict Scenario-only `sessionStorage` capsule when needed.
6. Persist one automatic-attempt marker for the outage and hard reload once.
7. Clear the marker once config, group, and sprint bootstrap reads each receive an HTTP response, but
   retain recovery ownership until Scenario restoration reaches a terminal result.

If that document still fails, no second automatic reload occurs. Retry remains an explicit action.

## Preservation boundaries

The capsule may contain the exact principal, shell scope and scroll, a `droppedSettings` boolean,
Scenario scope/draft identity/base revision/canonical `{start,end}` overrides/edit mode/timeline scroll,
and outage metadata. It never contains Settings values, EPM state, credentials, email, OAuth material,
loaded Jira records, arbitrary network payloads, or arbitrary React state. It expires after 30 minutes
and has a strict serialized-size limit.

If dirty Scenario work cannot be stored safely, reload is blocked. If Scenario is clean, storage failure
does not prevent a clean reload. Dirty Settings with unavailable storage requires explicit
`Reload and discard` acknowledgement.

## Scenario restoration

After fresh principal and shell bootstrap, recover only when the exact group and sprint exist. Permit
one recovery-owned `/api/scenario` compute POST to construct a fresh baseline. Draft save, publish,
rollback, reload-from-Jira, and Jira writes are never replayed.

If the active draft revision matches, overlay local overrides as ordinary unsaved work. If it changed,
preserve the fresh server baseline, overlay local values into the existing `conflict_remote` state,
disable direct Save, and require the existing conflict workflow. Gate Scenario polling until this
decision completes.

If group or sprint is missing, retain the capsule until expiry and show Recover/Discard. A conflict is
a successful terminal restore and consumes the capsule.

## Capsule precedence

Auth-resume and connection-recovery capsules are validated separately. Auth-resume owns shell and
navigation when both are valid. Connection recovery may restore Scenario only when its exact scope
matches that winning shell. Principal mismatch clears the connection capsule; missing scope retains it.

## Analytics

This changes reliability behavior, not a product action. Add no new `userevent`; existing bounded API
and error events remain authoritative, and capsule contents never enter analytics.

## Current accuracy

Implemented and verified locally on 2026-09-23; review follow-up for identity-less modes, probe timeout,
Refresh Jira gating, identity change, reachable-server outage end, and in-flight saves implemented on
2026-09-24 (see the plan's review follow-up). Retry now performs one exact-principal readiness probe
and guarded hard reload, preserves principal/scope-bound dirty Scenario deltas, retains the fresh server
baseline on conflict, and prevents automatic reload or compute loops. Settings/EPM values always reload
from saved state; discarded Settings work is disclosed. Focus/auth ownership, onboarding, missing scopes,
storage failures, and terminal recovery outcomes have explicit behavior and regression coverage.
