# Issue #137 All work — subagent execution handoff

Status: Prepared, not executed. Published with the implementation plan on `feature/in-app-load-performance`.

## Base and intended outcome

The accepted measurement implementation is commit `fc4d6a4`. The full handoff base is the published branch tip containing this file and [EXEC-eng-board-all-work.md](EXEC-eng-board-all-work.md). Verify both files are fetchable before delegating.

Recommended integration: PR the measurement branch into main, resolve its divergence through the normal review flow, then branch `feature/issue-137-board-all-work` from updated main. Do not implement on main. Before merge, a stacked feature branch may start from the published measurement branch if explicitly chosen; keep its PR base on the measurement branch until merge. Never reset or discard the active checkout to switch branches. No push/merge/deploy authorization is inherited from this reusable prompt.

## Copyable orchestrator prompt

```text
Implement issue #137, ENG Board All work, using docs/plans/EXEC-eng-board-all-work.md.
Use superpowers:subagent-driven-development. Treat this as a gated implementation contract,
not permission to skip prototype, runtime, completeness or SLO evidence.

1. Read AGENTS.md, docs/AGENTS.md, docs/plans/AGENTS.md, docs/plans/README.md,
   backend/security/CONFIGURATION_OWNERSHIP.md, the complete implementation plan,
   SUPPORT-eng-board-optional-sprint-design.md and MRT004/MRT010/MRT023/MRT025.
   Inspect every referenced existing symbol. Verify the actual file map and migration head.
2. Verify that the measurement commit and both All work documents exist in the checked-out
   published base. If the measurement branch has merged, use updated main only to create
   feature/issue-137-board-all-work; do not implement on main. Otherwise use an explicitly
   selected stacked branch. Keep user changes and the active checkout; no new worktree by default.
3. Run Task 0 baseline. The three recorded sprint observations are contextual and completeness
   is unknown. Query newer in-app measurements read-only. Never fabricate a p95 or substitute
   a standalone collector, capped legacy All work request, or different auth profile.
4. Delegate only bounded independent work using the ownership map below. Share exact typed
   contracts first. The orchestrator owns integration files and serializes changes to them.
5. For every slice: failing behavior test, minimal implementation, focused green checks,
   independent specification review then code review. Resolve material findings before the
   next dependent slice. Record outcome and evidence in the plan.
6. Task 1 must prove visible streaming, cross-worker queued-focus control, finite frame memory,
   global auth lock and bounded blocked-I/O termination before production integration.
   Cooperative cancellation is not a hard deadline. If proof fails, report the actual failure
   and propose the bounded-runtime remedy; do not wire or enable a production shortcut.
7. Follow Tasks 2–6 only as their gates allow. Reuse the strict pager/query core; no duplicated
   query implementation. At most two child searches, strict nextPageToken/isLast pagination,
   provisional display separate from authority. Retire the legacy request family only under
   the server-provided strict-Board capability. Preserve unavailable-deployment compatibility.
8. Keep Board scope/filters/session state independent of the mandatory ENG sprint and private
   Team selection. Preserve reviewed first-visit sprint inheritance. All work applies Components
   to Epics only, includes all eligible direct children, and never eagerly hydrates subtasks.
9. Preserve current-user OAuth, workspace/shared-group ownership, CSRF and existing Jira write
   routes. No Home/Townsquare, service credential fallback, new Jira mutation, issue manifests,
   raw issue data in diagnostics, automatic replay, or partial-success completeness claims.
10. Use the app to gather candidate selected-sprint and All work timings separately. Record
    index, first focused content, full completion, dependencies, unique issues/Epics, pages,
    bytes, retries and cache state. Keep 2s useful-content target and 4s full-load p95 SLO
    distinct. A quick first column does not pass a slow full load.
11. Run full Python, frontend unit and relevant existing/new browser suites, migration tests,
    build, deployment-equivalent runtime gates and authenticated startup check. Capture
    synthetic screenshots for PR evidence. Stop all test/prototype runners on completion;
    preserve an explicitly user-owned local app runner.
12. Return changes, exact verification, sanitized measured evidence, gate results and remaining
    risks. Do not claim release-ready with unresolved gates. Do not push, merge or deploy without
    current-session authorization. Update the plan status only to match actual implementation.
```

## Delegation and file ownership

| Worker | Bounded assignment | Owns | Dependencies/output |
| --- | --- | --- | --- |
| Transport feasibility | Task 1 prototype and failure tests | `eng_board_stream.py`, stream tests, shared `api/http.js` and its tests | Returns measured deadline/byte/focus proof or explicit stop; no production app route registration |
| Strict scope/config | Task 2 | strict core relocation, `group_board.py`, group model/normalizer files, service/model tests | May run alongside prototype after wire contract freeze; publishes pure core and saved grammar |
| Backend generation | Task 3 | route module, control orchestration, backend route tests | Starts after transport gate and core; requests schema/policy edits from integrator |
| Board data | Task 4 | `useEngBoardData.js`, Board API and unit tests | Starts after frame contract freeze; shared HTTP file belongs to transport worker until released |
| UI/Settings | Tasks 5–6 | Board components/models and Settings UI | Starts after data-owner contract; do not modify dashboard or shared telemetry independently |
| Independent reviewer | Review each slice and final integration | Read-only findings with path/line and reproductions | Checks plan contract, auth/ownership, stale authority, gates and workload comparisons |

The orchestrator exclusively owns `dashboard.jsx`, `backend/app.py`, policy registration, DB models/migration numbering, shared measurement schema, analytics/docs integration and generated bundles. Delegate those edits only by explicit temporary ownership transfer. Use no more active workers than runtime slots; do not have multiple workers edit the same file.

If only planning is authorized in the execution session, run read-only source/evidence review and return an amended plan; do not implement merely because this document contains an implementation prompt.
