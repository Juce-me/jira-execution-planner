# Test runtime evaluation

Status: executed
Type: bug investigation

## Outcome

Evaluation completed; the first optimization batch is implemented on the active branch under [the runtime execution plan](../../plans/EXEC-test-runtime-budget.md). The operator requires the complete build, backend, frontend-unit and desktop-Chromium verification to finish within 600 seconds combined. Mobile is officially unsupported. The first canonical full-gate attempt failed incomplete at 527.762s; the complete 600-second target is unmet.

Operator scope update (2026-11-10, after independent review): Chromium is the only required browser. Firefox and WebKit verification is suspended, including previously required headed glyph/geometry checks, unless explicitly requested. Active contributor instructions and the frontend UI command now reflect this decision; existing tests and historical cross-browser evidence are preserved.

Independent review corrected the earlier chat estimate: the entire 25.6 minutes of extra campaigns was not removable under the former browser policy. The new explicit Chromium-only decision now removes the historical 18.2 minutes of Firefox/WebKit verification from the required gate. Render probes and task-specific diagnostic repetitions remain separately evaluated; they are not automatically waived by this browser decision. This is subtraction from a historical run, not a newly measured complete runtime or proof of the 600-second target.

## Evidence from previous chats

Reviewed the archived chats **Complete shared planning capacity** and **Evaluate planning selection UX**, including the former's final verification and preceding failure investigations. Checked their claims against the saved publication logs and browser JSON reports in `tmp/planning-323-every-team/publication/` (gitignored local evidence).

| Final publication phase | Measured duration | Result |
| --- | ---: | --- |
| Backend discovery | 2,200.379 seconds | 3,617 tests; OK, one skipped |
| Serial Chromium partition | 267.230 seconds | 39 passed |
| Four-worker Chromium partition | 1,178.582 seconds | 2,346 passed; 34 skipped |
| Headed Firefox capacity acceptance | 518.399 seconds | 218 passed; six skipped; two failed |
| Headed WebKit capacity acceptance | 575.472 seconds | 216 passed; six skipped; four failed |
| Render probes | 112.506 seconds | Six passed |
| Freshness campaign, five repetitions | 332.533 seconds | 435 passed |

The backend and Chromium phases total 60.8 minutes. The additional acceptance campaigns total 25.6 minutes. These totals exclude build, Node, lint, process preparation and earlier failed attempts/investigations. They must not be described as one 10-minute or eight-minute verification run. Node's 3,708 tests passed in that publication.

Earlier backend observations were 3,406 tests in 446.540 seconds with 62 skips, then 3,617 in 1,967.539 seconds and 3,616 in 2,193.089 seconds. The oldest observation predates the PostgreSQL-only test conversion and mandatory concurrency coverage: it is a historical elapsed-time comparison, not a controlled same-coverage regression measurement.

The previous chat ran substantial additional investigations: 30 isolated Firefox repetitions, an ordered Firefox replay, 80 mock WebKit repetitions, 20 real-server repetitions and an ordered WebKit replay. These explain additional elapsed chat time; passing diagnostic replays do not erase original failures.

## PostgreSQL measurements

Ran two existing modules, `tests.test_auth_routes` and `tests.test_db_session`, through the actual isolated source checkout and an owned throwaway PostgreSQL cluster. No application database or credential files were used. All 44 tests passed.

| Phase | Time |
| --- | ---: |
| Source snapshot preparation | 1.886 seconds |
| Owned cluster startup | 2.230 seconds |
| Test execution, including setup/cleanup | 21.592 seconds |
| `fresh_database_url`, 36 calls | 5.126 seconds cumulative |
| `drop_database`, 36 calls | 5.499 seconds cumulative |
| `Base.metadata.create_all`, 43 calls | 9.447 seconds cumulative |

These are cProfile cumulative times: setup, database operations and driver waits overlap and must not be added together. SQL driver waits account for 16.752 seconds across 5,979 calls; this includes ordinary SQL and administrative operations. Test preparation/cleanup dominates this sample. Cluster startup alone is not the explanation for a 36-minute suite. This sample does not establish the full suite's exact bottleneck distribution.

A separate ten-lifecycle comparison on an owned cluster measured:

- Empty database, model `create_all`, then cleanup: 6.211 seconds.
- Clone an already-created clean model-schema template, then cleanup: 3.904 seconds.

Template creation is excluded from the second measurement and must be amortized in a real run. The repeated lifecycle is 37% faster in this sample. This is a candidate optimization, not a shipped improvement or evidence that the complete gate fits 600 seconds. Migration tests must continue starting from their intended empty or historical schema; concurrency tests must retain real PostgreSQL connections and isolation. `fresh_database_url` currently promises an empty independent database and that default contract must remain intact.

Probe code and output are in gitignored `tmp/test-speed/`: `profile_backend.py`, `baseline-profile.txt`, `pg_setup_probe.py`, `probe_pg_setup.py`, and `pg-setup-comparison.txt`.

## Browser cost and mobile scope

The final parallel Chromium report contains 4,485.6 seconds of summed case execution; the serial partition contains another 211.6 seconds. Summed case duration is not wall time and excludes some fixture overhead. Four workers cannot execute that unchanged amount of work within ten minutes, even before backend tests run.

The largest parallel files by summed case execution are `eng_group_board_view.spec.js` (464.5 seconds), `eng_epic_refresh.spec.js` (324.0), `eng_alert_pin.spec.js` (293.3), `planning_assignee_capacity.spec.js` (253.5), and `shareable_view_links.spec.js` (235.3).

The earlier publication made only Planning capacity mobile checks opt-in. Other mobile cases and embedded narrow-viewport phases remain. A source inventory found mobile-related matches in 34 files. The published parallel report has 61 case titles explicitly mentioning mobile, phone, 390 or 375, totaling 93.9 case-seconds. This is a lower bound: generic titles, viewport matrices and tests combining desktop/mobile phases are not fully counted by title matching. Removing those 61 alone cannot explain or solve the budget gap.

Retirement must remove mobile variants and dedicated mobile journeys while preserving desktop portions of mixed tests and unique functional checks currently mounted at mobile widths. Touch input alone does not prove a mobile-only test: desktop touch devices and component-sized fixtures must be distinguished from phone viewport acceptance.

## Workflow findings and implementation sequence

1. `make verify` runs full backend discovery and then `test-security`, duplicating modules already included by discovery. Keep `test-security` as a focused command, but avoid repeating it in the full gate.
2. Keep failure-investigation repetition campaigns separate from routine full verification. The complete normal gate must still exercise every required desktop/security/concurrency contract once.
3. Retire mobile collection across the entire browser suite, including embedded mobile phases. Verify the before/after case inventory and retain the desktop assertions; changing only `JEP_TEST_MOBILE` is insufficient.
4. Add phase/module timing and setup accounting to the isolated runner. Preserve its pre-import, source, network and credential boundaries and sanitized output.
5. Use an explicit model-schema fixture path to amortize ordinary schema setup where safe. Do not silently change empty-database or Alembic-test semantics. Verify clean data, sequences, cleanup and two-user/concurrency behavior.
6. Evaluate bounded process-level backend parallelism and browser scheduling only after the fixture changes. The current backend runner is sequential; increasing browser workers alone does not solve the combined budget and could aggravate contention.
7. Measure one complete final build/backend/frontend/desktop-browser run with a monotonic wall clock. Report the actual result and remaining coverage. A 600-second timeout or an incomplete smoke subset is not proof that the full gate meets its budget.

## Current Accuracy

Accurate for historical evidence and the initial optimization checkpoint below, reviewed on 2026-11-11. Mobile retirement, controlled browser timers, explicit clean model fixtures, DDL-free session setup, gate orchestration and the confirmed icon-readiness repair are implemented and focused-tested. The canonical full-gate attempt below failed incomplete; a complete-suite runtime and passing 600-second target remain unverified. Historical browser timings describe earlier coverage, not the new required gate.

## Where 7.4 minutes became 86.4 minutes

These measurements describe different scopes. The old 446.540-second figure was backend-only; it is not an earlier end-to-end gate. The historical ledger reconciles as follows:

| Component | Minutes |
| --- | ---: |
| Earlier backend observation | 7.44 |
| Additional time in later backend observation | 29.23 |
| Later Chromium gate, not included in the old backend figure | 24.10 |
| Later Firefox/WebKit acceptance, now suspended | 18.23 |
| Later render probes | 1.88 |
| Later five-repeat freshness campaign | 5.54 |
| Total historical recorded phases | 86.42 |

This is accounting, not a causal allocation of the backend increase. Several full backend reruns and failure investigations occurred outside this 86.4-minute ledger.

The UI's former eight-minute estimate was introduced in commit `159ccd49` on 2026-09-30, whose verification record had 953 passes and three skips: 956 cases. The later inventory had 2,419 cases, 2.53 times as many; source spec files grew from 52 to 99. Scaling the approximate old time by count gives 20.2 minutes, compared with the observed 24.1 minutes. That is a growth comparison, not a controlled measurement of performance regression.

The backend inventory grew only about 6%, but existing tests became more expensive at `ea75bf41`: the ordinary fixture changed from two Basic/JSON patches to real database/schema, OAuth actor/session, view/configuration and per-write single-use CSRF work. Previously optional PostgreSQL concurrency cases also became required. Static audit identified three fixture families with hundreds of test methods; their counts are not guaranteed disjoint and are not runtime totals. The OAuth session-helper audit found 112 actual install/push calls across 31 modules and repeated schema initialization during session installation. That redundancy is now removed after migrating the two consumers that relied on implicit DDL.

Historical 3,617-case backend logs range from 1,783.851 to 2,353.631 seconds at different heads. This is not a controlled same-source experiment. During current work four unrelated backend runners and clusters were observed concurrently in another worktree, followed by that task's full Chromium gate. No unrelated process was stopped. This prevents a quiet end-to-end benchmark; it does not prove historical contention caused the entire backend increase.

## Initial optimization checkpoint

- **Mobile:** original whole-collection comparison 2,419 to 2,338 cases, zero collection errors. The later collection is 2,342 cases across 98 files after upstream changes and two readiness canaries; that inventory does not revise the original mobile-retirement delta. In the mobile owner's 32 files, 79 cases were retired, 17 renamed/remounted and preserved, 1,429 unchanged-named contracts preserved and two desktop-touch cases activated: net 77 fewer cases. The browser-clock owner retired four further viewport variants. All 79 retired cases uniquely matched historical reports by file/full title/project, totaling 124.886 gross case-seconds; preserved remounts and newly active cases are excluded from that credit. This is not a net wall-time gain. Embedded phone phases were also trimmed without dropping desktop checks.
- **Controlled clocks:** the six-case pilot changed 118.007 to 34.280 seconds wall time. After two additional settling barriers, the final 16-case set passed in 54.136 seconds; its six matched timer cases summed to 33.320 case-seconds, versus 115.806 in the baseline. The larger final set is not an equivalent wall-time benchmark. Fault checks retained sensitivity to an early retry and premature cleanup.
- **PostgreSQL, first checkpoint:** separate model-schema cloning initially served two audited ordinary fixture families; the subsequently approved per-case-schema adoption is recorded below. `fresh_database_url` stays empty; migrations/history/races are unchanged. Session installation performs no repeated `create_all`. Real checks passed: initial 76 cases; full ENG OAuth/new schema 113 cases with zero skips (280.848s complete under contention); another 12 Epic/Auth/Scenario cases with zero skips (21.620s complete). Four additional diagnostic cases passed. No full-backend speedup percentage is established.
- **Database diagnostic:** four actual ENG cases took 8.057 profiled seconds including imports/template cleanup, with 5.295 seconds of test execution. Overlapping cumulative costs were administrative SQL 3.931s, model allocation 2.694s, database drops 1.826s, actor seeding 0.827s, request auth resolution 0.074s, and one model-schema creation 0.586s. Repeated schema creation is gone in that sample; database creation/cloning/deletion is the remaining sampled hotspot. General audit-hook overhead is not proven zero.
- **Workflow:** `make verify` now runs one build/backend/Node/Chromium sequence with a shared 600-second limit and cleanup reserve. It records version/cache/worker conditions and sanitized phase/case timing. An incomplete or over-budget gate fails. A common-repository advisory slot prevents overlapping cooperating full gates; older/custom runners do not honor it. Explicit fixture cleanup errors and abandoned process groups fail the gate. The integrated canonical scheduler defaults to four backend processes and four Chromium workers, each configurable up to eight; stages remain sequential and a 90-second cleanup reserve remains inside the total 600 seconds. Interrupted cluster startup is cleaned; unconfirmed shutdown preserves the enclosing snapshot rather than deleting live data.
- **Icon readiness:** issue #337's delayed-child regression failed with the original image-presence race and then passed after awaiting settled fallback images. Existing SVG/path and exact geometry checks remain; production renderer code is unchanged. After explicit user approval, the remote issue update succeeded; issue #337 remains open. Historical Firefox/WebKit failures remain suspended evidence, not fixed findings.
- **Other checks:** build passed; all 3,708 Node tests passed; mobile's 38-case focused Chromium set and the clock/icon owner's 16-case set passed without skips/retries. Pure orchestration/isolation/cluster/source guards passed. These checks are not a full optimized end-to-end acceptance run.

Evidence remains in gitignored `tmp/test-speed/`, including mobile contract mappings, paired/final clock reports, icon red/green reports, OAuth caller audit, schema regression results, runtime/source guards and database profiles.

## Remaining high-cost work and concrete next candidates

Seventy-nine percent of historical parallel browser case work came from cases under five seconds, while the 30 cases at ten seconds or more contributed 10.2%. The four-worker parallel packing was already about 95.1%; reshuffling the same work at four workers could ideally save only about 57 seconds. Most remaining work is distributed across ordinary app journeys.

Named browser pilots: the Board/pin fixtures use `networkidle` (500ms quiet threshold) before further DOM/scroll settling; the hover helper waits 450ms twice per control and writes screenshot/pixel evidence. Replace only with explicit equivalent readiness/paint assertions after bounded experiments, preserving pixel/contrast and no-later-effect coverage. Profile app mount/reset and server startup/migrations independently before broad fixture changes. Do not delete assertions or raise timeouts.

The operator explicitly approved ordinary per-case schemas after the initial three-case scratch prototype. `fresh_model_schema_url()` now creates actual model DDL in a unique schema within one process-owned disposable database; full-URL engine/session cache keys keep connections bound to the case namespace. The independent audit covered 57 ordinary test modules / 74 setup sites and found no explicit public/search-path/database-identity assumptions in those consumers. SQL advisory locks remain database-scoped: ordinary cases stay sequential within each worker, and true races/migrations/database-identity fixtures retain separate physical databases.

Fifteen independent schema-isolation regressions passed, together with eleven original empty/model-clone compatibility tests and three OAuth fixture tests: 29 passing cases, 16.530 aggregate case seconds. They exercise rows/two users, actual FKs/checks/uniqueness/defaults/native identity sequences, captured administrative targets, exact registered GitHub admission, nested empty/clone allocation, foreign/PID refusal, partial creation, held-transaction failure/retry, and comprehensive cleanup preserving a failed verdict while removing its worker database before green.

A frozen-source 20-case ENG auth/CSRF ABBA experiment completed 80 executions with zero failures/skips and no remaining owned databases. The complete experiment took 48.008s. Median case phase plus final cleanup was 10.42115s for physical model clones versus 7.2367s for fresh schemas: 30.6% lower. Median complete cold process was 12.40785s versus 9.13995s: 26.3% lower. This comparison predates the final checked-out-connection survivor guard; no updated gain is measured for the final implementation. This is a measured gain for that earlier cohort, not a full-backend or combined-gate forecast. The earlier three-case prototype's roughly 72% case-phase reduction was cold-template-biased and is not the adoption estimate.

After ABBA, per-case connection tags and a bounded survivor check were added to reject cleanup that leaves a checked-out idle/advisory-lock connection alive, even if `DROP SCHEMA` encounters no relation lock. Final cleanup still removes only the process-owned worker database and preserves a failed verdict. The new sixteenth independent schema regression, three OAuth and three ENG cases passed together: 22 cases, 17.907 test seconds / 28.549 isolated-runner seconds / 28.680 enclosing-wrapper seconds. This validates the final guard, not a new speedup percentage.

Module-only process sharding is integrated in `tests/runtime_shards.py`: independent snapshots/clusters and worker-owned databases, sequential cases within workers, disjoint/exhaustive module assignments and completed case counts, unique logs, and bounded terminate/join cleanup. Source-size partition weights are a heuristic. The canonical gate adds `--backend-workers` (four by default); Chromium keeps four by default, configurable through eight. Full acceptance still requires one complete build/backend/Node/desktop-Chromium run within 600 seconds including the 90-second cleanup reserve. Planning allocations are build 30s, backend 225s, Node 30s, Chromium 225s and cleanup/orchestration 90s; these are not enforced per-stage deadlines or measured forecasts. The code enforces the shared total and cleanup reserve.

The pin fixture now uses `bootstrap_readiness.js` to observe browser `requestfinished`/`requestfailed` boundaries, require bootstrap responses, and drain started API work alongside mounted controls and existing paint/scroll settling. This preserves functional readiness assertions while replacing a fixed network-quiet threshold. Broader readiness/hover gains require their own comparable measurements.

Do not blindly replace the database copy strategy as a shortcut: [PostgreSQL 18 documentation](https://www.postgresql.org/docs/18/sql-createdatabase.html) identifies the default `WAL_LOG` strategy as suitable for small templates; `FILE_COPY` forces checkpoints before and after copying. Any alternative still needs its own measurement.

Integration checkpoint (2026-11-11): 78 orchestration/source checks passed in 8.674s. Two owned-cluster workers completed 19 schema/OAuth tests in 18.381s, with terminal summaries and cleanup successful. Full-gate acceptance remains pending.

## Canonical gate attempt (2026-11-11)

`tmp/verification/run-jqqh9tow/result.json` records `complete: false`, `passed: false`, total 527.762s. Build passed in 1.429s; backend hit its available deadline and took 526.086s including interruption/cleanup. All eight backend workers lacked terminal summaries. Frontend-unit and Chromium were not run. The attempt used eight backend/eight configured Chromium workers, Python 3.14.10, Node 20.20.2, PostgreSQL 18.6 and fresh owned clusters at dirty `49b99e5e`. Its `withinBudget: true` describes return/cleanup before 600s, not passing complete verification. The target is unmet; no full-suite speedup or completed backend count is established.

The schema strategy now also covers the audited WorkStructure and two SharedGroup fixture bases. The corrected WorkStructure inheritance audit spans 16 source modules. A first 306-case run had all bodies OK but failed final owned-database cleanup; simultaneous checkpoints exceeded the inherited five-second statement timeout. A 70-schema diagnostic observed `CheckpointDone` during a 3.530s final DROP. Final owned-database cleanup now has a separate 15-second statement limit, preserving per-case 1s/5s limits and failure propagation. The representative rerun passed 323 cases/16 selected modules in 109.173s; SharedGroup plus Sprint-values passed 88/88 across three modules in 40.187s. These are correctness results, not controlled before/after gain estimates.

Shard completion now compares discovered and executed counts, with a final outer inventory after nested runners; 58 focused orchestration checks passed. The hover experiment failed both canary harness attempts and was fully reverted; no benchmark or saving is claimed. A separate local-shell watchdog cancellation defect is repaired and under paired validation: the original watchdog ignored the TERM used to cancel it, adding a five-second wait even for cooperative exits. The replacement preserves escalation/ownership semantics without a background watchdog.

## Local runner watchdog validation (2026-11-11)

The old script failed the added cooperative cleanup bound (5.613s cleanup); the fix passed. A matched 36-case pair using byte-identical original test assertions passed both variants: 83.649s baseline versus 66.907s candidate complete process, 16.742s / 20.0% lower for this module in one pair. A first shared 155-second validation deadline interrupted the candidate; the subsequent dedicated complete run is the accepted candidate result. These timings do not causally allocate the historical contended 169.774s or forecast the full gate. The intentional ignored-descendant case increased from 6.754s to 8.991s complete process: 100 external 50ms sleeps preserve a nominal grace, with measurable process/scheduling overhead. Real descendant KILL, PID/group disappearance, replacement and lock assertions remained green.

## Final bounded attempt and handoff (2026-11-11)

The second combined attempt (`tmp/verification/run-3dkebsga/result.json`) failed incomplete at 518.790s. Build passed in 1.667s; backend reached its work deadline and finished interruption/cleanup in 516.915s. Combined frontend-unit/Chromium stages did not run. The discovered inventory was 3,689: one worker fully passed 389/389; a second produced OK 480/480 but was interrupted during cleanup, so it is not green. The remaining six lacked terminal summaries. Coordinator cleanup reported no failure/orphaned owner groups. Separate final focused checks passed 92 infrastructure/source/budget cases and 3,710 frontend unit tests. These do not substitute for the incomplete combined gate.

Both complete attempts failed, so further optimization stops for operator direction under root `AGENTS.md` section 6. The active plan records a separately reviewed historical-physical-template proposal, preserving distinct per-test databases and real target migrations. It requires a new strategy decision and bounded equivalence/ownership/cleanup checks before adoption; no implementation or forecast exists. No code was committed or published. The approved issue #337 status update remains open with its historical findings preserved.

## Approved historical-template experiment: rejected (2026-11-11)

The operator approved a pilot and conditional adoption of exact historical physical templates. Catalog parity, clone isolation, disconnected state and cleanup passed 13 independent checks; existing fixture compatibility passed its 28 cases. A current-model-plus-stamp fault was correctly rejected by the catalog comparison, with cleanup complete.

Performance did not validate adoption. An eight-case cold ABBA completed 32 passing executions in 53.054s: complete-process medians 13.5655s→12.961s (4.46% lower), but case medians 8.371s→9.0805s (8.48% slower), with overlapping ranges. The full baseline passed 103 cases in 120.824s. Candidate historical cases worsened 50.103s→52.888s; the candidate then reached the shared comparison deadline before completing CLI cases. Total comparison interruption/cleanup finished in 226.703s; no completed candidate total or CLI saving exists.

No historical-template change was adopted. The helper and both setup files were restored byte-for-byte from pre-pilot snapshots, verified by SHA-256; the experimental test is not collected. Candidate sources remain only in ignored diagnostic storage. Earlier verified PostgreSQL-schema, watchdog, Chromium-only and mobile-retirement work remains intact. The 600-second complete-gate goal is unresolved; further optimization awaits direction after two unsuccessful performance probes.

## Fresh category measurement (2026-11-11)

The selected diagnostic passed in **298.293s**, with zero failures/skips/not-run cases and all 1,584 reviewed source hashes unchanged during execution. Coverage was **95 of 3,689 backend cases**, the complete **3,710-case Node unit entry point**, and **48 of 2,342 Chromium cases** across six complete selected cohorts. This is sampled diagnosis, not complete backend/UI acceptance and not evidence that the full ten-minute target is met.

| Category | Cases | Command wall seconds | Case-work sum seconds |
| --- | ---: | ---: | ---: |
| Ordinary PostgreSQL/API | 45 | 66.885 | 46.747 |
| Migration/history | 6 | 14.004 | 6.229 |
| Actual concurrency | 4 | 15.026 | 3.469 |
| Pure/source checks | 17 | 9.704 | 0.076 |
| Infrastructure/lifecycle | 23 | 50.079 | 38.863 |
| Frontend Node unit (complete) | 3710 | 16.192 | 61.924 |
| Chromium cohorts (sampled) | 48 | 86.182 | 62.288 |

Commands ran sequentially; per-command wall includes its setup and owned cleanup. Case work is a sum of test durations, may overlap within Node/Chromium workers, and must not be added to wall time. Separate category invocations repeat process/browser/cluster startup, so their sum is not a projected full-suite runtime. Build took 4.878s. Outside all command walls, 35.343s was diagnostic source-audit/orchestration/report residual; this is not a normal application/test-body cost.

Backend nested phase sums were snapshot 16.087s, cluster startup 18.635s, child 111.813s and standard `preparation-and-cleanup` residual 7.929s. Discovery (13.580s) and case work (95.384s) are already inside child time; the remaining child time includes class/module fixtures and final fixture cleanup, which were not separately isolated in this campaign. Do not double-count these nested figures. Exact per-cohort Chromium rows, command logs, runtime inventories, JSON case IDs, source hashes and the fixed category manifest are in ignored `tmp/test-speed/category-measurement/`.

No source optimization was applied during this measurement. The actionable finding remains fixture cost: in the separate two sampled ordinary PostgreSQL cases, allocation/model DDL/cleanup consumed about 91% of case time, while request/body work was 30–50ms. Prioritize matched measurements of already-approved fresh-schema conversion for audited ordinary fixtures; preserve migration and genuine lock-race isolation and explicitly validate setup-failure/custom-engine/background-worker cleanup before adopting any conversion.


## Full diagnostic without a cutoff — 2026-11-11

All four commands completed. **Actual total: 1,888.143s (31m 28.143s). The run failed.** The ten-minute target was exceeded by 1,288.143s. Eight backend workers and eight desktop Chromium workers ran sequential stages; Node 20.20.2, Python 3.14.10 and PostgreSQL 18.6. No Firefox/WebKit/mobile runs or retries were enabled. Reviewed source hashes were unchanged during execution.

| Stage | Wall time | Outcome |
| --- | ---: | --- |
| Build | 2.391s | passed |
| Full backend | 844.853s (14m 4.853s) | 3,687 passed, 1 failed, 1 skipped; all 3,689 expected cases accounted for |
| Full frontend unit | 16.353s | 3,710 passed, no failures/skips |
| Full desktop Chromium | 1,016.477s (16m 56.477s) | 2,280 passed, 20 failed, 33 declared skips, 9 blocked/not run after fixture failures; 2,342 collected |
| Diagnostic metadata/source audit residual | 8.069s | included in total |

Command completion is not passing acceptance. The 9 blocked Chromium cases are not successful coverage: 5 in `planning_capacity_real_server.spec.js` and 4 in `planning_shared_plan.spec.js`. The declared skips include opt-in probes and headed glyph checks; their conditions were not enabled for this normal headless Chromium suite. The backend skip is the Git-tracking guard in a source snapshot intentionally lacking `.git`.

## Backend failure

`tests.test_postgresql_runner_contract.LocalRunnerSourceContractTests.test_local_runner_forces_loopback_and_exact_compose_ownership` still asserts the literal `sleep 5`; the implementation now uses bounded polling after the watchdog-cancellation repair. The real process/descendant/lock tests passed. This stale contract assertion was not changed during the measurement.

## Chromium failures

| Source | Test | Outcome |
| --- | --- | --- |
| `tests/ui/codebase_structure_smoke.spec.js:1852` | Statistics subviews render extracted panels and preserve stats API ownership | failed |
| `tests/ui/design_system_hover_eng.spec.js:443` | mounted compact Board off-frame hint rings its visible pill without framing the overlay | failed |
| `tests/ui/eng_board_progressive_loading.spec.js:517` | diagnoses strict Component owner activation and Board request routing | timedOut |
| `tests/ui/eng_board_progressive_loading.spec.js:587` | joined current component_batch_2 schedule preserves real paint ordering | timedOut |
| `tests/ui/eng_board_progressive_loading.spec.js:587` | joined current team_parent_lookup_2 schedule preserves real paint ordering | timedOut |
| `tests/ui/eng_board_progressive_loading.spec.js:587` | joined current child_completion schedule preserves real paint ordering | timedOut |
| `tests/ui/eng_board_progressive_loading.spec.js:587` | joined current collapsed_first schedule preserves real paint ordering | timedOut |
| `tests/ui/eng_board_progressive_loading.spec.js:601` | joined baseline component_page_2 schedule records the historical paint boundary | timedOut |
| `tests/ui/eng_board_progressive_loading.spec.js:601` | joined baseline component_batch_2 schedule records the historical paint boundary | timedOut |
| `tests/ui/eng_board_progressive_loading.spec.js:601` | joined baseline team_parent_lookup_2 schedule records the historical paint boundary | timedOut |
| `tests/ui/eng_board_progressive_loading.spec.js:601` | joined baseline child_completion schedule records the historical paint boundary | timedOut |
| `tests/ui/eng_board_progressive_loading.spec.js:601` | joined baseline collapsed_first schedule records the historical paint boundary | timedOut |
| `tests/ui/eng_group_board_settings_tab.spec.js:570` | overflowing Board columns expose controls and route wheel input by scroll boundary | failed |
| `tests/ui/planning_capacity_real_server.spec.js:101` | two Teams saved concurrently both persist, and the other member reads them back | timedOut |
| `tests/ui/planning_review_integration.spec.js:458` | Planning overview row: direct controls in order, right-aligned details, no options menu, List toggle or summary readout at 1440x900 | timedOut |
| `tests/ui/planning_shared_plan_http.spec.js:14` | real v2 HTTP saves use authoritative scope, cross-user projection and durable receipt | failed |
| `tests/ui/planning_shared_plan_http.spec.js:62` | real v2 promoted namespace saves an empty plan without touching Legacy | timedOut |
| `tests/ui/planning_shared_plan.spec.js:70` | UI smoke: existing Planning table mounts against real application APIs | failed |
| `tests/ui/share_view_control.spec.js:290` | a deferred clipboard rejection stays cleared after the active surface hides and returns | failed |
| `tests/ui/shareable_view_links.spec.js:752` | AC4 strict Board component warm: link and manual API request multisets match | failed |

Ten failures are 30-second timeouts in the progressive-loading diagnostic file. Three other cases explicitly reported synthetic server startup failures; observed startup phases reached about 34s snapshot preparation and 26s PostgreSQL startup. These are observed timings under eight-worker load, not a demonstrated root cause for every timeout. Other failures include geometry/visibility, clipboard state and request-multiset assertions. The desktop Statistics check still contains a hardcoded 359px right boundary; its actual right edge was 566.34375px. Reproduction/repair is separate from this frozen-source timing run.

All backend workers returned with matching expected/ran counts; coordinator cleanup_failed/orphaned flags were false. After all stages, a read-only process check found no remaining matching fixture-server or repository-temporary PostgreSQL processes. No source fixes, commits or publication were performed during the run.

Raw stage logs, worker reports, Playwright JSON, artifacts, before/after source hashes and commands are retained with this report. Summed parallel test durations are not added to the stage wall times.

## Checkpoint and next Chromium priorities (2026-11-11)

The operator requested a local checkpoint of the current state, including the known full-diagnostic failures. This is not a passing publication gate. Contributor rules now require only affected cases/files and necessary consumer contract checks during development; complete suites are reserved for push/PR or an explicit full-run request.

Prioritize targeted real-server startup measurements: failed launches recorded snapshot preparation around 34 seconds and PostgreSQL startup around 26 seconds under eight browser workers. Compare focused one-worker and four-worker runs before changing concurrency. The progressive-loading diagnostic also materializes a historical frontend baseline through per-file Git reads in `beforeAll`; cache that immutable artifact by source identity rather than rebuilding it after each failed-worker restart. Then investigate readiness waits and desktop overflow fixtures, including the retained 359-pixel Statistics bound. Preserve all functional assertions and true database concurrency; no further Chromium optimization or gain is claimed by this checkpoint.

Rule-update verification: `.venv/bin/python -m unittest tests.test_agents_md_learnings` passed all 12 checks; `git diff --check` passed. No complete suite was rerun for this documentation/checkpoint request.
