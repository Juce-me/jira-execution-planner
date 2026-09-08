# Issue #137 All work — subagent execution handoff

Status: Execution continued on `feature/issue-137-board-all-work` after merging current `origin/main`. Independent strict-core, parser/shared-stream, state-owner, settings-retention and measurement-schema slices are implemented and verified. Production Task 3 remains blocked because runtime review rejected the current Gunicorn/thread boundary as a hard-termination mechanism. The dedicated supervisor/security-boundary proposal remains unapproved; do not distribute this as a production-integration handoff.

## Base and intended outcome

The accepted measurement implementation is commit `fc4d6a4`. The full handoff base is the published branch tip containing this file and [EXEC-eng-board-all-work.md](EXEC-eng-board-all-work.md). Verify both files are fetchable before delegating.

Resume the existing `feature/issue-137-board-all-work` branch, created from `ea587d984013d5926f8dee5df06b543286b8560a`. Do not recreate it or switch to main. Check PR #172's current state before choosing a future PR base; a merged measurement branch does not require restarting implementation. Preserve local work and avoid history rewrites. No push/merge/deploy authorization is inherited from this reusable prompt.

## Copyable orchestrator prompt

```text
Resume issue #137, ENG Board All work, on feature/issue-137-board-all-work using
docs/plans/EXEC-eng-board-all-work.md and its revised DB evidence/gate table.
Use superpowers:subagent-driven-development. Treat this as a gated implementation contract,
not permission to skip prototype, runtime, completeness or SLO evidence.

1. Read AGENTS.md, docs/AGENTS.md, docs/plans/AGENTS.md, docs/plans/README.md,
   backend/security/CONFIGURATION_OWNERSHIP.md, the complete implementation plan,
   SUPPORT-eng-board-optional-sprint-design.md and MRT004/MRT010/MRT023/MRT026.
   Inspect every referenced existing symbol. Verify the actual file map and migration head.
2. Verify the measurement commit and the latest revised All work documents in the current
   branch. Before remote delegation, verify those exact revisions are committed, pushed and
   fetchable; the old measurement ref alone does not contain these gate amendments.
   Keep the existing branch and user changes; no new worktree or branch recreation.
3. Read the plan's Current DB evidence and gate table before declaring work blocked.
   DB discovery is satisfied: four observations (three success, one cancelled), two revisions,
   and a saved group with Components, Teams and Board columns. Query existing load_performance
   rows and shared-config metadata read-only; reuse evidence and collect only missing samples.
   Preserve build/configuration-digest/cache/completeness cohorts; unknown legacy rows cannot
   pass candidate SLO. Never reconstruct an old row's scope from today's saved configuration.
   Handle already-decoded SQL JSON without double decoding. Never substitute a standalone
   collector or another auth profile, and never fabricate percentile or completeness claims.
4. Delegate only bounded independent work using the ownership map below. Share exact typed
   contracts first. The orchestrator owns integration files and serializes changes to them.
   Start strict core/config work and isolated stream/parser/auth tests independently. Once
   the frame contract is frozen, start isolated Board state and measurement tests. Assign
   runtime-remedy review separately; a blocked runtime subtask does not stop these workers.
5. For every slice: failing behavior test, minimal implementation, focused green checks,
   independent specification review then code review. Resolve material findings before the
   next dependent slice. Record outcome and evidence in the plan.
6. Apply each gate to its dependent task. Continue Task 2, isolated parser/stream/auth checks
   and Task 4's state/measurement tests while the runtime remedy is reviewed. Do not repeat
   the executor limitation probe as a global prerequisite. Transport/focus/memory/auth/runtime
   checks still precede dependent production binding. DB latency rows cannot prove termination;
   the supervisor proposal remains unapproved. Twenty complete candidate samples per cohort
   is an acceptance target after the candidate exists, not a gate before development.
7. Follow Tasks 2–6 only as their gates allow. Reuse the strict pager/query core; no duplicated
   query implementation. At most two child searches, strict nextPageToken/isLast pagination,
   provisional display separate from authority. Retire the legacy request family only under
   the server-provided strict-Board capability. Preserve unavailable-deployment compatibility.
   Serialize focus POSTs per generation, coalesce pending intent and acknowledge only committed
   revisions. An ambiguous focus failure retires the generation. Cancel clears queued intent;
   atomic active-state guards prevent late focus writes from reviving cancelled work.
8. Keep Board scope/filters/session state independent of the mandatory ENG sprint and private
   Team selection. Preserve reviewed first-visit sprint inheritance. All work applies Components
   to Epics only, includes all eligible direct children, and never eagerly hydrates subtasks.
   Strict Board Work items export uses authoritative filtered canonical child keys, bypassing
   the Story-only collector. Preserve legacy exports; test mixed types and non-Story-only Boards.
9. Preserve current-user OAuth, workspace/shared-group ownership, CSRF and existing Jira write
   routes. No Home/Townsquare, service credential fallback, new Jira mutation, issue manifests,
   raw issue data in diagnostics, automatic replay, or partial-success completeness claims.
   Validate/refresh DB OAuth tokens before claim, commit, then capture a fresh context and
   revalidate after metadata capture. Later successful rotation retires the immutable generation
   as scope_changed with explicit Retry, not global auth_required. Revocation/disabled-user
   failures still lock auth. Prove both behaviors through the real Jira/token wrapper path.
10. Query existing candidate DB rows first, then use the app to gather only missing comparable
    selected-sprint and All work timings once the candidate is available. Record
    index, first focused content, full completion, dependencies, unique issues/Epics, pages,
    bytes, retries, cache state, peakChildSearches and scopeCohortDigest. Keep the digest separate
    from build revision and rotating token versions; older unknown rows remain contextual.
    Require loading feedback within 100ms and comparable selected-sprint median first-content
    regression <=10%, alongside the 2s useful-content target and 4s full-load p95 SLO.
    Use the same painted-content milestone and do not count stale display as fresh content.
    Missing baseline evidence cannot pass the regression gate. A quick first column does not
    pass a slow full load. Synthetic excluded-profile tests support development only; missing
    measured scope coverage remains a release blocker under Task 7, unless a separate explicit
    release amendment is approved. Do not manufacture shared configuration or change auth mode.
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
