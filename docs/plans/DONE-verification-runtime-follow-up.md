# Verification Runtime Follow-Up

> **Status:** Done. Executed and verified on `improvement/verification-runtime`. Records the Board test changes, the Planning coverage changes, and the completed runtime comparisons.

Reduce local verification time by shortening Chromium waits, consolidating equivalent browser coverage, and improving backend parallelism. Preserve regression coverage, fixture isolation and reliable verdicts. Measure elapsed time through cleanup across complete runs. [Previous runtime work](DONE-test-runtime-budget.md) · [Open performance follow-up](../TODO.md)

## Outcome and Current Accuracy

The Board suite runs nine current-build tests. On 2026-11-26 the operator retired the five pinned-history paint comparisons and their fixture setup. The earlier split reduced the measured median from 48.261s to 32.534s. The auth-resume tests now demonstrate owner acceptance, live-principal rejection and TTL clearing. The Planning expiry browser journey and original capacity waits remain part of the test suite.

The canonical full gate runs sequentially and assigns its backend modules across four source-byte shards. Timing weights and six backend workers did not qualify. The focused two-plus-two overlap met the timing and coverage criteria, and the subsequent approved four-plus-four experiment captured one red and one green overlap sample. The backend timeouts make the full comparison ineligible for a speed claim or coordinator mode. The ownership hooks are opt-in test instrumentation and the measured orchestration lives under ignored `tmp/`.

## Baseline

These figures come from the operator's local diagnostics. All three ran four backend shards and four Chromium workers sequentially. Total includes the four stages and coordinator overhead. Exact timings and scope are in the ignored `tmp/verification/<run>/result.json` and adjacent logs.

| Local run | Build | Backend | Frontend unit | Chromium | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| `run-hzzruaer` | 2.2s | 21m 02s, failed | 21.5s | 18m 54s, 2,352 passed and 33 skipped | 40m 19s |
| `run-v8rcyidc` | 1.7s | 13m 09s, passed | 17.8s | 20m 05s, passed | 33m 35s |
| `run-woebvdmu` | 1.8s | 14m 07s, passed | 18.0s | 19m 56s, passed | 34m 22s |

In `run-hzzruaer`, tests under five seconds contributed about 79% of Chromium case time. The last backend shard took 1,261.6s, 170.9s longer than the next-slowest. Its isolated runner reported about 13s of snapshot and cluster startup and 1,247s in the test child. A different shard failed both `wait_for_workers` subtests while waiting for the subprocess to emit `BLOCKED`. This was a dirty-tree diagnostic. Backend evidence is in local `tmp/runtime-shards-jzx8d9t3/`.

- [x] Rebaselined the focused cohorts at the frozen revision and build. The experiment records below link to selector inventories, runtime settings, phase times and whole-command elapsed times through cleanup. The local diagnostics above are prior observations.

## Forbidden regressions and measurement rules

- Keep production code, per-test timeouts and retries out of scope. Fixed sleeps in test helpers are in scope. Keep bounded process termination and the uncapped combined run. Any change to coordinator scheduling or cancellation belongs to the separately approved Track 3B mode.
- Preserve security and PostgreSQL coverage, isolated browser contexts, shard-owned snapshots and clusters, and separate physical databases for migration, database-identity and lock-race tests. Preserve stale-response and request-count assertions, plus settled geometry, pixel and contrast assertions.
- Use Node 20, the repo's Python runtime and disposable PostgreSQL. Make `initdb`, `pg_ctl` and `createdb` available on `PATH` or through `JEP_TEST_PG_BIN`. For a browser worktree without `.venv`, set `JEP_TEST_PYTHON` to the supported interpreter. `http://localhost:5088` is a mock origin for route-fulfilled specs. Real-server specs use their fixture's owned server and port.
- Use focused tests during development and run `npm run build` before browser test collection on each frozen source, including `--list`. Run the full gate before push or PR or on an explicit full-run request. Sequence the full backend and browser stages under the standing rule. Serialize full runs across worktrees.
- **Adoption rule.** Run at least baseline, candidate, candidate, baseline on the same machine and frozen application build. Hold selectors, workers and artifact mode fixed except for the variable being measured. Require at least 10% lower median elapsed time for the readiness pilot and at least 5% for other speed changes. Both candidate runs must be faster than both baseline runs, and the median gain in seconds must exceed the baseline range. Require complete expected coverage, zero failures or retries, no unexpected skips and successful owned cleanup in both variants. Record verdicts and counts alongside wall time, case or module time and fixture phases under ignored `tmp/`. Reject inconclusive speed changes. The separately approved historical-case split can be adopted for coverage organization with its timing reported independently.

## 1. Shorten repeated Chromium waits

**Files allowed to touch** · [Planning capacity spec](../../tests/ui/planning_assignee_capacity.spec.js). Any separately approved hover pilot is limited to [the hover helper](../../tests/ui/design_system_hover_helpers.js) and its [ENG](../../tests/ui/design_system_hover_eng.spec.js) and [surface](../../tests/ui/design_system_hover_surfaces.spec.js) consumers.

- [x] Baselined automatic return, header Refresh and auth-session refresh. `tmp/verification-runtime/capacity/summary.json` records mount, scoped request, saved-value render and observation timing for each case with one Chromium worker, no retries and a frozen build.

  ```sh
  npm run build
  JEP_TEST_BASE_URL=http://localhost:5088 npm run test:frontend:ui -- planning_assignee_capacity.spec.js --grep 'a return after more than 12 minutes|the header Refresh re-reads|a new auth session re-reads' --workers=1 --retries=0
  ```

- [x] The candidate awaited the successful scoped initial capacity response and rendered value. The diagnostic observed no in-flight initial API requests when taking the request-start ledger offset.
- [x] The automatic-return diagnostic observed the tasks response complete 37–39 ms before scoped review began and retained the exactly-one-GET observation. Automatic return and header Refresh observed the ledger for at least 304 ms after the new value rendered. Auth-session refresh retained its original at-least-one-read and no-loading-state assertions.
- [x] The delayed 120 ms duplicate reached the ledger and failed the original assertion with two GETs. Removed the mutation before timing. The complete candidate spec ran with `--workers=4` and Playwright's normal single-spec scheduling used one worker. It passed 171 cases with six expected opt-in skips and zero failures or retries. Concurrent external load made this functional evidence only.
- **Pilot rejected.** Instrumented ABBA passed all three cases per sample with zero skips or retries, clean browser teardown, and wall times of 8.325s, 7.732s, 9.968s and 10.484s. The 5.90% median improvement fell short of 10%, and one candidate was slower than one baseline. A separate exact-source comparison coincided with a competing Chromium run and was excluded. All 177 complete-spec IDs matched in collection. The original spec is restored. Evidence: `tmp/verification-runtime/capacity/outcome.md`.
- **Separate approval.** Hover stayed closed under the two-attempt rule. The prior investigation recorded 396.559 case-seconds across 55 hover cases. A future approved pilot would validate held-transition and one-pixel-movement canaries and preserve screenshot and contrast checks. [Prior hover pilot and canaries](DONE-test-runtime-budget.md#hover-pilot-stopped)

## 2. Consolidate Chromium coverage selectively

**Files allowed to touch** · [Board progressive-loading spec](../../tests/ui/eng_board_progressive_loading.spec.js), [Planning selection defaults spec](../../tests/ui/planning_selection_defaults.spec.js) and [auth resume unit tests](../../tests/test_auth_resume_state.js) for the v2 expiry assertion. The [worker lifecycle guard](../../tests/test_chromium_worker_lifecycle.py) is a verification input. Any other receiving test file must be identified by an assertion map before it enters scope.

### Historical Board paint comparisons

The following records the original opt-in split and its verification. The opt-in and its commands were retired on 2026-11-26.

- [x] The operator approved moving the five pinned-history paint comparisons behind one opt-in on 2026-11-25. The original Board acceptance included both revisions. [Original Board acceptance](DONE-eng-board-progressive-loading-190.md#task-6--make-measurement-observational-and-measure-actual-paint)
- [x] Captured 14 original titles, nine default titles and five opt-in titles with identical title text. Only the historical group's hook materializes and cleans historical source/output, and only the current-build group's hook cleans `current/`. SHA-256 confirmed the embedded Python template is byte-identical.
- [x] The nine default cases passed, including worker isolation and malformed startup. All five historical-only cases and three isolated Python lifecycle checks passed. Both Chromium runs had zero skips and retries. Hashes confirmed the default run preserved 10 historical artifacts and 237 pinned-source files, and the historical-only run preserved all 10 current artifacts. A focused default paint case passed with pinned source absent and did not create it. Evidence: `tmp/verification-runtime/board/functional-1795628020224477000/summary.json`.

  ```sh
  npm run test:frontend:ui -- eng_board_progressive_loading.spec.js --list
  JEP_BOARD_HISTORICAL_PAINT=1 npm run test:frontend:ui -- eng_board_progressive_loading.spec.js --grep 'joined baseline' --list
  npm run test:frontend:ui -- eng_board_progressive_loading.spec.js --workers=1 --retries=0
  JEP_BOARD_HISTORICAL_PAINT=1 npm run test:frontend:ui -- eng_board_progressive_loading.spec.js --grep 'joined baseline' --workers=1 --retries=0
  .venv/bin/python tests/run_isolated_runtime_tests.py tests.test_chromium_worker_lifecycle
  ```

The five historical cases accounted for about five reported case-seconds in `run-hzzruaer`. At the time of the comparison, historical source preparation ran only with the opt-in tests. The controlled ABBA spec comparison took 43.406s, 32.139s, 32.929s and 53.116s. Median wall time declined 15.727s (32.59%), exceeding the 9.710s baseline range. Both candidates finished ahead of both baselines. The 14/9/9/14 cases passed without skips or retries, and the five opt-in case IDs plus the nine default IDs matched the original inventory. This measures the Board spec only. Evidence: `tmp/verification-runtime/board/run-1795629096936288000/summary.json`.

### Planning auth-resume overlap

- [x] Fixed the v2 nested workspace in `seedPlanningAuthResume`. The real reader accepts the exact capsule bytes under the owner and rejects and clears them under the live principal. The browser case independently verifies a closed shell, cleared tab storage and unchanged saved Story selection. The v1 default-all case still proves a successful shell restore that preserves saved selection.
- [x] Extended the v2 unit case to prove the capsule is valid at the TTL boundary and to assert `expired.getItem(AUTH_RESUME_STORAGE_KEY) === null` one millisecond later. All 27 unit cases passed. An in-memory mutation that returned `null` for valid expired v2 capsules without clearing storage failed the new assertion alone. Keep the browser expiry case until the corrected retained browser case passes and the timing evidence supports removal.
- [x] Ran the three-title hardened baseline and two-title candidate in ABBA order on the same build. **Retained the browser expiry case.** Browser wall times were 6.509s, 5.372s, 6.441s and 9.160s. The 1.928s median gain (24.61%) did not exceed the 2.651s baseline spread. All 3/2/2/3 browser cases and 27 unit cases per sample passed with no skips or retries. The retained browser IDs matched and each Chromium process shut down cleanly. The unit check covers the TTL decision and storage clearing. The mismatch case covers browser rejection wiring, and the legacy case covers successful restore. The complete Planning selection spec passed all 30 cases on the retained source. Evidence: `tmp/verification-runtime/auth-resume/comparison-nmq7axxh/summary.json` and `tmp/verification-runtime/auth-resume/full-functional/report.json`.

  ```sh
  JEP_TEST_BASE_URL=http://localhost:5088 npm run test:frontend:ui -- planning_selection_defaults.spec.js --grep 'principal-mismatched capsule|expired capsule|version-1 default-all capsule' --workers=1 --retries=0
  node --test tests/test_auth_resume_state.js
  ```

## 3. Improve backend parallelism

### 3A. Balance the existing shards

**Files allowed to touch** · `tmp/verification-runtime/backend_pilot.py` and its ignored inputs and reports, [shard coordinator](../../tests/runtime_shards.py), [isolated runner](../../tests/run_isolated_runtime_tests.py), [shard contracts](../../tests/test_runtime_shards.py) and [runtime runner contracts](../../tests/test_isolated_runtime_runner.py). The [Board stream probe](../../tests/test_eng_board_stream.py) may be instrumented temporarily. Only after a weighting win is shown does the optional CLI path include [the verification coordinator](../../scripts/verify_tests.py) and [its tests](../../tests/test_verify_tests.py).

- [x] Reran the failed handshake in isolation and in both focused four-worker source-byte controls with the full module loaded. The loaded pairs were 3.357s/1.033s and 1.412s/1.048s. Upstream commit `20c5e8ac` gives the first `BLOCKED` marker 30 seconds and keeps later checks at five seconds. Neither timeout changed. All observed arrivals met the historical five-second reference. Temporary instrumentation stayed in disposable snapshots.
- **Isolated handshake.** Passed in 7.276s through cleanup. The marker arrived in 0.576s with worker waiting enabled and 0.668s without it, both within the historical five-second reference. The owned PostgreSQL listener closed, its directory was removed, and the test child and cluster kernel identities were gone. The actual test timeout was unchanged. Evidence: `tmp/verification-runtime/handshake-1795629366128765000/result.json`. The focused four-worker baseline remains a separate check.

  ```sh
  .venv/bin/python tests/run_isolated_runtime_tests.py --timings \
    tests.test_eng_board_stream.EngBoardHardTerminationFeasibilityTests.test_cooperative_cancel_cannot_terminate_blocked_executor_work
  ```

- [x] Build the training data from green reports whose source and build match the frozen inventory. `JEP_TEST_TIMING module=` groups by the class's defining module. A selector may load classes defined elsewhere. Trace per-selector discovery when assigning report rows, including when two selectors share the same shard. For example, `test_planning_inclusion_routes` imports `SprintReviewRouteTests`. For ambiguous selectors, time each selector by itself in the isolated runner and sum all its module timing rows. Preserve all original test cases. If matching reports are unavailable, obtain approval for a backend-only baseline before ranking the full inventory. [Timing collector](../../tests/runtime_test_runner.py) · [Imported test case](../../tests/test_planning_inclusion_routes.py)
- **Training checkpoint.** The operator approved a fresh backend-only baseline on 2026-11-25. The first run was interrupted after review found the opt-in hook changed the default mocked runner call. All four owned workers exited 130 with clean teardown. The corrected hook preserves the opt-out call shape, and all 67 tests across the runner, shard and PostgreSQL lifecycle modules passed. Only the corrected run can train the comparison.
- **First complete training attempt.** All 223 selectors ran 3,720 cases in 1,097.578s, with one recorded skip and clean shard teardown. One existing local runner test failed when signaling its synthetic process group (`PermissionError`). Its exact isolated retry passed in 13.315s. The two loaded Board markers arrived in 1.292s and 1.542s. This training sample is red and was excluded. Evidence: `tmp/verification-runtime/train-1795629925008933000/training.json` and `tmp/verification-runtime/backend-cleanup-diagnosis-6kez2d5m/`.
- **Matched training repeat.** With identical source, build and toolchain fingerprints, 223 selectors and 3,720 cases completed in 1,091.134s with the same one skip, matching IDs and owned cleanup. The two Board marker observations were 1.966s and 1.346s. Selector discovery linked every defining-module timing row to a unique owning selector within its shard. The 36 highest-case-time selectors and the handshake module are frozen in `tmp/verification-runtime/backend-modules.txt`; training data and assignment previews are in `tmp/verification-runtime/train-1795631099270944000/`.
- [x] Select the 36 slowest selectors by median case time, breaking ties by module name, and add the handshake module if absent. Freeze the list, training data and predicted assignments separately from the ABBA samples. Save the list in `tmp/verification-runtime/backend-modules.txt` and use the full reviewed inventory for assignment previews.
- [x] In the scratch driver, use `reviewed_test_modules`, `approved_node` and the repository-common `verification_slot` through cleanup. Confirm no competing verification is bypassing the lease. Freeze expected case IDs and skips per selector and reconcile both variants against them. The shard summary's aggregate test count alone does not detect a new skip.
- [x] Compare source-byte versus timing assignment at fixed workers using `partition_modules(..., weights=...)` and `run_shards(..., weights=..., timings=True)`. Score both assignments against the same duration vector. Case timing excludes class and module fixture work. Compare predicted shard sums with worker wall time through cleanup. Verify disjoint, exhaustive, deterministic module assignments. Then compare four versus six workers at fixed weights. Consider eight after a repeatable six-worker result.
- **Timing weights rejected.** The four-worker ABBA took 587.207s, 623.178s, 601.795s and 619.055s. Timing weights increased median wall time by 9.356s (1.55%). All four samples passed 1,353 cases with the same IDs, zero skips and clean teardown. Both source-byte controls' loaded Board markers met the historical five-second reference. The same training durations predicted a lower maximum shard sum with timing weights (665.74s versus 772.62s), but elapsed time did not improve. Evidence: `tmp/verification-runtime/compare-1795632242935799000/`.
- **Six-worker schedule did not qualify.** Reused the immediately preceding 619.055s source-byte control after matching source, build, toolchain, selector assignment, case IDs and skips. The first six-worker sample ran all 1,353 cases in 556.474s with zero skips and clean teardown, but the Scenario Draft slow-loader test raised a PostgreSQL `InterfaceError` during readback. The exact isolated case passed in 9.383s. The comparison stopped with a red candidate. The default remains source-byte scheduling with four workers. Evidence: `tmp/verification-runtime/worker-count-zv0uvya8/` and `tmp/verification-runtime/backend-scenario-diagnosis-kwsv2_fl/`.
- [x] Build a complete weight map in seconds before passing it to the scheduler. Accept finite, nonnegative durations including zero. Estimate missing modules as `source bytes × (sum of known seconds / sum of known source bytes)` over the same selected inventory. If matched observations cannot produce a positive rate, use source bytes for the entire batch. This conversion is new logic. The current scheduler's partial-map fallback uses raw bytes. Add a partial-map check with differently sized files, including a measured zero and a missing module. Also check an unusable map, invalid entries and conservation during interruption.
- **Conditional runner changes.** A full-backend speed claim required a qualifying focused result and a separately approved matched comparison. The weighting and worker-count samples did not qualify. The duration-map CLI was conditional on a qualifying and approved duration map. A future database-lifetime proposal requires profiling the heaviest ordinary fixture first.

### 3B. Measure backend and Chromium overlap

**Focused approval.** On 2026-11-25 the operator approved an exception to the sequencing rule for the focused pilot. The experiment uses a scratch driver. Editing the coordinator's scheduling or cancellation and running a full overlapping gate each require an explicit subsequent decision.

**Files allowed to touch** · `tmp/verification-runtime/overlap_pilot.py` and its ignored evidence. The operator separately approved focused test-only ownership reporting on 2026-11-25 for the [shard coordinator](../../tests/runtime_shards.py), [isolated runner](../../tests/run_isolated_runtime_tests.py), [PostgreSQL fixture](../../tests/postgres_cluster.py), and [browser launcher](../../tests/fixtures/db_oauth_server.py) with its [JS wrapper](../../tests/ui/db_oauth_fixture.js). Changes to the verification coordinator still require a separate decision.

- [x] The ignored pilot driver resolves the common repo exactly as `make verify` and owns the verification lease through both child commands and cleanup. Synthetic preflight verified both commands start when the lease is free and neither starts when held. Shared cleanup was exercised on interruption, second-stage launch failure, and detached workers whose leader exited before or after the parent observed them. An unobserved group was never signaled. Evidence: `tmp/verification-runtime/overlap-synthetic-qwolghgi/result.json`. Check for non-cooperating jobs before timing.
- [x] Proved nested ownership with synthetic cleanup and independent, opt-in browser and backend smoke checks before the paired run. The driver joined its process trees under one absolute cleanup deadline, verified listeners and clusters had stopped, and retained the shared lease through cleanup. [Backend worker launch](../../tests/runtime_shards.py) · [Flask fixture launch](../../tests/fixtures/db_oauth_server.py) · [PostgreSQL cleanup](../../tests/postgres_cluster.py)
- **Ownership evidence.** Owner-reported kernel birth and parent identities supplement the live ancestry observation. Cleanup validates current group members before signaling and checks the PostgreSQL data directory, port and saved kernel identity. An independent functional browser run passed with Chromium, Flask and PostgreSQL ownership receipts and clean shutdown. Evidence: `tmp/verification-runtime/overlap-browser-smoke-t634fi8v/result.json`. The isolated backend handshake also proved live test-child and PostgreSQL ownership and clean teardown.
- [x] Ran the two-backend/two-Chromium comparison with fixed source-byte assignment, pinned Node 20 and verified PostgreSQL binaries. The actual Flask/backend test-child intersections were 35.795s and 35.121s in the overlapping samples, and zero in the two controls. All owned groups and listeners ended through their regular cleanup paths.
- **Frozen overlap cohort.** The Board handshake, `test_adopt_legacy_sprint_reviews`, `test_review_adoption_migration`, `test_work_structure_storage`, `test_sprint_review`, and `test_scenario_draft_routes`. The five ranked modules include physical migration fixtures and ordinary route fixtures. The reviewed test source launches no additional detached groups in these modules. Both arms consume `tmp/verification-runtime/overlap-modules.txt`.

  ```sh
  JEP_TEST_BASE_URL=http://localhost:5088 npm run test:frontend:ui -- planning_assignee_capacity.spec.js planning_capacity_real_server.spec.js --workers=2 --retries=0
  ```

- [x] **Focused overlap qualified.** The 446.945s sequential median fell to 257.838s, a 189.107s (42.31%) reduction. Both overlap samples beat both controls and the gain exceeded the 76.251s control range. All four runs matched 278 backend case IDs with zero skips and 183 Chromium IDs with six expected render-probe skips, zero failures or retries, 88 archived screenshots per run and clean teardown. Evidence: `tmp/verification-runtime/overlap-real-m4v4iw_b/`.

| Focused sample | Backend | Chromium | Total through cleanup |
| --- | ---: | ---: | ---: |
| Sequential 1 | 160.839s | 247.760s | 408.820s |
| Overlap 1 | 186.043s | 257.184s | 257.308s |
| Overlap 2 | 230.460s | 258.251s | 258.368s |
| Sequential 2 | 235.859s | 248.980s | 485.071s |

- [x] The operator approved the matched full comparison after the focused pilot qualified. The ignored driver invoked `make verify` in sequential/overlap/overlap/sequential order under the normal repository lease. It ran frontend units immediately after the build in both arms and held four source-byte backend shards, four Chromium workers, full inventories, source and build fingerprints, no retries and artifact mode fixed. Synthetic checks verified shared cleanup, a failed build leaving dependent stages unrun, and independent stage verdicts on launch or peer failure.
- **Full preflight.** Froze 2,382 current Chromium case IDs and the same 33 expected headless skips from the independent prior inventory. The Node listener and malformed Flask startup checks passed. The first attempted sample passed build and frontend units, but the backend stage refused the scratch evidence path before launching a worker. The interrupted Chromium arm cleaned up without error. Excluded that attempt and moved stage state into the validated pilot directory for the corrected comparison. Evidence: `tmp/verification/run-m0m2r9u8/result.json` and `tmp/verification-runtime/overlap-full-2kcmn56u/`.
- **Full result: four-plus-four overlap did not qualify.** Build, frontend units and Chromium passed in all four samples, with Chromium at 2,349 passes and 33 expected skips each time. Both sequential controls and the second overlap passed the backend and matched the frozen 3,720-case inventory. The first overlap ran all backend cases. Scenario Draft writeback preview hit a PostgreSQL connection timeout, and the Work Reader Board stream hit a PostgreSQL statement timeout. Both exact cases passed in 7.264s through teardown in a standalone disposable cluster. All four samples cleaned up their owned resources. The red backend run makes the full comparison ineligible to report a speedup. Evidence: `tmp/verification-runtime/overlap-full-2kcmn56u/progress.json` and `result.json` in the ledger directories below.

| Full sample | Build | Frontend units | Backend | Chromium | Total | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Sequential 1 (`run-0wb7picq`) | 1.111s | 14.321s | 1,041.849s | 1,165.408s | 2,223.932s | Passed |
| Overlap 1 (`run-t6udpaj2`) | 1.205s | 14.314s | 1,753.964s | 1,469.166s | 1,774.905s | Backend failed |
| Overlap 2 (`run-xz8gpxmr`) | 1.807s | 13.182s | 1,623.937s | 1,383.041s | 1,644.017s | Passed |
| Sequential 2 (`run-y3m6wwc_`) | 2.858s | 13.959s | 1,110.750s | 1,159.269s | 2,296.614s | Passed |

## Acceptance criteria

- [x] Recorded each focused experiment's disposition, matched inventories, skips, failure diagnoses and ownership evidence. Recorded the approvals for the historical split, backend training and focused overlap.
- [x] The first authorized matched control ran through `make verify` and passed all four stages in 2,223.932s through cleanup: build 1.111s, frontend units 14.321s, backend 1,041.849s, and Chromium 1,165.408s. The exact inventories matched 3,720 backend cases and Chromium's 2,349 passes plus 33 expected skips. Evidence: `tmp/verification/run-0wb7picq/result.json`. The remaining matched samples are separate evidence for the full runtime comparison.
- [x] Documented current Board coverage in the [runtime verification ontology](../ontology.md#runtime-profile-preparation) and its rerun command and trigger in the [Board measurement ontology](../ontology.md#eng-board-cross-sprint-loading). Updated the [verification performance entry](../TODO.md) from the focused results.
- [x] Recorded the unused conditional approvals separately from measured rejections and updated the finished plan and its [index link](README.md). Any future publication follows [root AGENTS.md §10](../../AGENTS.md#git-workflow), including full verification at the proposed head and operator approval to push.
