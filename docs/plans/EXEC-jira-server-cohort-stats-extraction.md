# jira_server.py cohort and stats extraction plan

> **Status:** Planned; not started. Survey evidence is read-only at `ea574ed7` (`jira_server.py` is 7,474 lines; `LEGACY_ENTRYPOINT_LINE_BUDGETS["jira_server.py"]` is 8,210). Slices below are separate commits; nothing here authorizes a push or PR.

**Goal:** Move the epic-cohort, statistics, excluded-capacity and Project Track phase code out of `jira_server.py` so its structure budget can shrink again, without changing any route, response, cache key, or patch target that existing tests and callers rely on.

**Architecture:** Follow the repository's existing extraction precedent (`docs/plans/DONE-codebase-operability-jira-issue-fetch-helpers.md`, `...capacity-service-extraction.md`): `jira_server.py` keeps every public name as an alias (pure functions) or a thin wrapper (anything tests patch or that reads a patchable global); new service modules take keyword-only injected callables and values resolved at call time, import nothing from `jira_server`, and have no import-time I/O. No new dependency, no behavior change, no dependency-bag object (`backend/epm/rollup.py` documents that pattern as not to be reused).

## Verified facts that shape the plan

1. `scripts/extraction_lint/owner_budgets.json` is frontend-only: it has no `backend/` entries and `validate_owner_budgets` accepts only `.js/.jsx/.mjs` under `frontend/src`. A new Python owner module is therefore **not registered anywhere** and has no ceiling. The only Python size guard is `LEGACY_ENTRYPOINT_LINE_BUDGETS` in `tests/test_codebase_structure_budgets.py`. The root `AGENTS.md` ceiling rule applies to the JS manifest; Python budgets are ratcheted on `jira_server.py` only.
2. The five stats handlers (`get_excluded_capacity_stats_source`, `get_completed_sprint_stats`, `get_burnout_stats`, `get_epic_cohort_stats`, `get_project_track_phase_durations`) live in `jira_server.py`; `backend/routes/stats_routes.py` is a blueprint whose handlers return `get_jira_server().<name>()`.
3. Route modules call `bind_server_globals(globals())` in `before_request`, so every `jira_server` attribute is visible to route code at request time. `_escape_jql_literal`, `build_missing_info_scope_clause`, `remove_team_filter_from_jql`, `add_clause_to_jql`, `strip_sprint_clause` are used by name from `settings_routes`, `eng_routes`, `alert_epics` and `sprints`, so they must stay `jira_server` attributes.
4. No module imports `jira_server` at top level; only lazy imports exist (`import_config.py`, `sprint_review.py`) plus `get_jira_server()`. `admit_sprint_id_groups` and `get_epic_cohort_stats` import `backend.routes.*` lazily, so they must not move into a service.
5. Two source guards read `jira_server.py` itself: `tests/test_issue_edit_cache_generation.py::test_every_task_two_cache_writer_compares_generation_under_the_cache_lock` (regex for the generation-compare-under-lock pattern for `TASKS_CACHE`, `EXCLUDED_CAPACITY_EPIC_SUMMARY_CACHE`, `EXCLUDED_CAPACITY_STATS_SOURCE_CACHE`, `EPIC_COHORT_CACHE`) and `tests/test_oauth_cache_isolation.py` (requires the `EPIC_COHORT_CACHE` name and `jira_home_process_cache_enabled` in the source).
6. Dead-constant trap: `EXCLUDED_CAPACITY_STATS_MAX_EPICS` is never read in `jira_server.py` but `tests/test_excluded_capacity_stats_api.py` patches it; do not delete it.
7. `MIGRATED_QUERY_SITES` in `scripts/generate_work_configuration_sites.py` is keyed `(path, top-level symbol)` and requires the token (`roles` / `work_request` / `admit_sprint_id_groups`) in the function source. A wrapper has no such token, so every moved entry must be re-keyed to its new module before the inventory guard runs.

## Hard rules for every slice

- Sibling calls inside a moved module are injected callables or are resolved on `jira_server` at call time. A direct local call makes `patch.object(jira_server, '<name>')` silently vacuous; the `_cohort_project_scope` trap in `tests/test_work_structure_stats.py` and the `current_jira_get` trap in `tests/test_work_structure_negative_credentials.py` would then pass without exercising the code.
- Constants and cache dicts stay defined in `jira_server.py` (`STATS_*`, `EPIC_COHORT_*`, `EXCLUDED_CAPACITY_*`, `PROJECT_TRACK_PHASE_*`, `EPIC_COHORT_CACHE`, both `EXCLUDED_CAPACITY_*_CACHE`, `_cache_lock`, generation counter). Wrappers pass them in on every call; modules never hold their own copy.
- Thread pools (`_normalize_cohort_issues`, `get_project_track_phase_durations`) keep passing the explicit auth `context=` to the transport; no reliance on a Flask request context in workers.
- Pure aliases use `name = module.name` with an `assertIs(jira_server.X, module.X)` guard; wrappers get a call-time delegation test.
- New modules: `from __future__ import annotations` when they use `X | None` (`tests/test_python39_runtime_source_guards.py`), no Basic Jira URLs (`tests/test_oauth_jira_client_source_guard.py`), and added to `SEARCH_FILES` in `tests/test_jira_search_pagination_source_guard.py` if they call `jira_search_request` / `current_jira_search`.
- Per slice: add `assertNotIn('<old body snippet>', server_source)` to `tests/test_backend_service_extraction.py`, re-key `MIGRATED_QUERY_SITES`, regenerate the inventory, and ratchet the `jira_server.py` budget to `ceil(lines*1.10/10)*10` of the new size in the same commit.

## Slices (order: 1, 2, 3, 5, 4; slices 6 and 7 per decisions D1/D2)

| Slice | Moves | New module (proposed) | Gross lines | Risk |
| --- | --- | --- | --- | --- |
| 1 | `_track_state_label`, `parse_track_transitions`, `compute_track_phase_durations`, `PROJECT_TRACK_NULL_LABEL` | `backend/services/project_track_phases.py` | ~70 | Low; tests import these from `jira_server`, alias them |
| 2 | burnout pure helpers (normalize/rewind/resolve team state, `extract_burnout_events_from_issue`, timezone getter taking the constant as a parameter); `parse_jira_datetime` stays or is aliased from here | `backend/services/burnout_events.py` | ~240 | Low-Medium; `ZoneInfo` guarded import copied |
| 3 | `_build_epic_cohort_cache_key`, `resolve_epic_cohort_range`, `parse_epic_cohort_request`, excluded-capacity key/field/header builders, `build_excluded_capacity_stats_jql`, `build_excluded_capacity_issue_payload`, `build_stats_cache_key` body | `backend/services/stats_builders.py` | ~230 | Medium; `parse_epic_cohort_request` is patched with a delegating side effect and called by name from the route, keep it resolved on `jira_server`; two entries re-keyed in the inventory |
| 5 | `fetch_stats_for_sprint`, `fetch_burnout_events_for_sprint`, `get_stats_team_ids` as wrappers over services | `backend/services/stats_fetch.py` | ~420 | Medium; both fetchers are patched on `jira_server`, wrappers remain |
| 4 | `_cohort_project_scope`, `_cohort_fetch_terminal_date_from_changelog`, `_normalize_cohort_issues`, `_cohort_qualifies_through_leaves`, `_make_cohort_pager`, `_cohort_leaf_scope_builder`, `fetch_epic_cohort_data`, `fetch_closed_epic_cohort_data` | `backend/services/epic_cohort.py` (composes `epic_cohort_closed.py`) | ~400 | High; 12 patches of `_cohort_project_scope` in `test_epic_cohort_api.py`, constant patches (`EPIC_COHORT_ENRICH_MAX_ISSUES`), seven inventory re-keys |
| 6 (not planned, D2) | `fetch_cached_excluded_capacity_epic_summaries`, `fetch_excluded_capacity_stats_source` | `backend/services/excluded_capacity_source.py` | ~200 | High; cache writes under `_cache_lock` with the generation compare are what the regex guard reads |
| 7 (deferred, D1) | the five handler bodies, `_cohort_range_fetch`, `_fetch_full_issue_changelog`, `_fetch_epic_track_phase` | `backend/routes/stats_routes.py` with `bind_server_globals` (capacity-route precedent) | ~520 | Medium-High; route module may use Flask `request`/`jsonify`, services may not |

Expected effect: about 1,650–1,850 net lines after wrappers, `jira_server.py` near 5,650–5,850, new budget near 6,260–6,430. Estimates are from reading, not measured; re-measure after each slice.

## Verification per slice (run, read, and record in this plan before moving on)

1. `npm run build` is not required (no frontend change); run `python -m unittest tests.test_backend_service_extraction tests.test_route_move_preservation tests.test_backend_route_source_guards tests.test_python39_runtime_source_guards tests.test_jira_search_pagination_source_guard tests.test_oauth_jira_client_source_guard tests.test_codebase_structure_budgets tests.test_work_structure_consumer_inventory`.
2. The affected behavior suites: `test_epic_cohort_api`, `test_epic_cohort_closed`, `test_oauth_stats_routes`, `test_work_structure_stats`, `test_work_structure_negative_credentials`, `test_work_structure_cache_identity`, `test_excluded_capacity_stats_api`, `test_project_track_phase_api`, `test_burnout_stats_api`, `test_cache_partitioning`, `test_issue_edit_cache_generation`, `test_oauth_cache_isolation`, `test_sprint_dates`.
3. Mutation proof for the vacuity risk: for each moved function that tests patch on `jira_server`, temporarily break the `jira_server` attribute and confirm a named test fails, so a trap cannot pass vacuously. Record the check.
4. Full `python -m unittest discover -s tests`, then the startup check from `AGENTS.md` (`.venv/bin/python jira_server.py` on a non-5050 port, `GET /api/test`) before the final slice.
5. Request-shape parity: for slices 4, 5 and 7, capture the Jira request multiset for a Legacy Last N, a stats sprint, a burnout call and an excluded-capacity read before and after, and require them identical.

## Decisions (resolved 2026-10-31: reliability first)

- **D1 route-layer move (slice 7): deferred.** Execute slices 1–5 only. Re-evaluate slice 7 after slice 5 is measured; take it only if `jira_server.py` is still above its target and the `bind_server_globals` behavior is proven by a patch-effectiveness test for each moved handler. Services stay Flask-free, so handlers never move into them.
- **D2 slice 6 (excluded-capacity fetchers): not extracted.** They write `EXCLUDED_CAPACITY_*_CACHE` under `_cache_lock` with the generation compare that two source guards read in `jira_server.py`; moving them would weaken that guard for about 160 net lines. Only their pure builders move (slice 3).
- **D3 budget ratchet: after each slice**, to `ceil(lines*1.10/10)*10` of the measured size at that commit, never raised. If execution follows the quarterly-configuration merge, start from the merged size, not 7,474.
- **D4 slice order and gating:** 1, 2, 3, 5, 4. Each slice is its own commit and does not start until the previous slice's verification below is recorded here. Slice 4 additionally requires the request-shape parity capture (check 5) taken before any code moves.

## Out of scope

Behavior changes, Last N or stats semantics, the quarterly-configuration contracts, config getters and transport wrappers, `admit_*` work-request admission, `STATS_PRIORITY_WEIGHTS` parsing, and the JS owner manifest. Wider JSON/Basic removal stays separately owned.

## Outcome and current accuracy

Not executed. This plan records contracts and checks only; no slice has run. Rename to `DONE-` only after every chosen slice is merged-ready and verified, per `docs/plans/AGENTS.md`.
