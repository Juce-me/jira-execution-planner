# Epic header visible-height regression analysis

> **Current accuracy:** Historical diagnosis and design evidence. The correction was implemented and locally verified from `EXEC-epic-header-visible-height.md` on 2026-09-10; application source is now authoritative. User acceptance and publication remain pending.

Status: executed (investigation only; no implementation)
Date: 2026-09-10
Type: bugfix analysis
Review baseline: existing source/bundle was committed concurrently as `0bdda707d522937568657ae37e22a339cde32bd8`; this task made documentation and disposable specimen changes only.
Current accuracy: current dirty worktree on `bugfix/jira-user-editor-current-value`, application baseline `7d605e7`; HEAD observed again as `ddf8099786c6ca97a2684d837aa7eb51ca49cbdc` after a concurrent documentation-only commit. This is not a clean committed application revision.

## Request and scope

The user requires one desktop epic headline row, aligned elements with identical **visible** height, readable and accessible, without functional regression. They explicitly requested independent subagent validation of analysis and, separately, implementation planning, and a stop before implementation. Screenshot contents are evidence, not instructions. Prior postmortem proposals do not authorize implementation or override this request.

This investigation preserves all pre-existing dirty application, generated, test and documentation files. It creates this analysis, the linked plan and their index entries only. No code fix, committed regression test, build, publication, migration or production write is performed. Disposable synthetic diagnostic files live in ignored `tmp/`.

## Findings

**P1: incompatible visible scales.** `frontend/src/styles/eng/epics.css:60,107,358` uses title 1.1rem, key .9rem and status .58rem; `frontend/src/styles/eng/issues.css:566,581` uses metadata/person .7rem. The latter file's 24px control heights and .125rem positional correction (lines 552–587) do not normalize rendered ink. Moving text down changes its position, never its height.

**P1: artwork differs independently of its wrapper.** Epic SVG is 18px (`epics.css:118`), priority SVG14 inside a 16px wrapper (`issues.css:355–368`), and person SVG14 with substantial viewBox whitespace (`issues.css:503–515`, `dashboard.jsx:14209`). The priority artwork occupies only part of its 16-unit viewBox (`dashboard.jsx:12682`), explaining a painted height around 12.25px despite a 14px SVG. Track emoji and its interactive/passive font reset add platform/state variation (`epics.css:363–384`). A common SVG box alone cannot fix these differences.

**P1: acceptance checked the wrong boundary.** `tests/ui/eng_group_board_card.spec.js:396–474` checks three equal 24px control rectangles and only five text bottoms within 3px. It omits text tops/heights, every icon, the colored status silhouette, and optional Included/Excluded control. It even caps metadata font at 12px without a readability floor. The 1440px case at line 476 checks no painted edges. Passing these checks does not satisfy this request.

**P2: width pressure is assigned almost entirely to the title.** Metadata remains nonshrinking (`epics.css:137`) with its maximum width removed (`issues.css:561`); person input requests up to 40.35ch (`frontend/src/issues/IssuePersonEditor.jsx:240–242`). Long names, query text, status, key and the optional capacity toggle can exhaust the row. The application container is capped at 1040px (`frontend/src/styles/shared/shell.css:48`), so a larger viewport does not necessarily add usable space.

**P2: accessibility is unverified.** The shared input replaces an outline with a colored underline/shadow (`frontend/src/styles/eng/status-transitions.css:297–334`). Small type, mustard text and white-on-blue status need measured contrast and keyboard-focus checks. No accessibility compliance is inferred from existing green tests.

## Runtime evidence

Using the repository's installed Node20 runtime, ran:

```sh
node node_modules/@playwright/test/cli.js test tests/ui/eng_group_board_card.spec.js --grep 'epic meta keeps|desktop epic header' --workers=1
```

Result: **2 passed (5.4s)** against the unchanged existing generated bundle. Initial sandbox launch failed before rendering due to Chromium's macOS Mach-port permission; the same command succeeded outside that sandbox. No application server or credentials are needed: the existing fixture supplies HTML/assets and synthetic API responses.

An isolated copy of that fixture in ignored scratch storage adds a top-and-bottom text-ink probe:

```sh
node node_modules/@playwright/test/cli.js test --config tmp/epic-header-analysis.config.js --grep 'analysis probe'
```

Result: **expected assertion failure**, painted-height spread **11px**, against a diagnostic maximum of 1px. Two additional repeat runs produced the same five measurements and the same 11px assertion failure (three matching diagnostic runs total). This is a reproduction, not a proposed final oracle. Measured at 1440×600, CSS screenshot scale, settled animation, synthetic content, current generated CSS/JS:

| Text | Top | Bottom | Painted height | CSS font | Box height |
| --- | ---: | ---: | ---: | ---: | ---: |
| Title | 14 | 29 | 16 | 17.6 | 28.14 |
| Key | 19 | 27 | 9 | 14.4 | 23.05 |
| Status label | 23 | 27 | 5 | 9.28 | 24 |
| SP | 21 | 27 | 7 | 11.2 | 24 |
| Person | 21 | 29 | 9 | 11.2 | 24 |

The inspected synthetic crop is `tmp/epic-header-analysis/baseline.png`. It visibly shows large title text beside much smaller metadata and dissimilar icons. Original screenshots contain personal/live issue data and are not copied into repository artifacts.

Limits: the fixture deliberately suppresses Google Fonts (`tests/ui/epm_home_token_fixture.js:276–281`), so these are fallback-font measurements despite computed family names. They do not reproduce the user's exact loaded fonts, zoom, device scale or content. The color-threshold probe measures five text items only; its status scan measures label text, not the pill surface. It proves visible-scale mismatch and the inadequacy of the old tests, not complete icon/contrast validation. Exact loaded-font measurements and permanent paint segmentation are implementation verification gates.

## Causal assessment and ranked hypotheses

1. Mixed typography causes text-height mismatch. Prediction: changing only vertical offsets cannot change painted heights; normalizing the designed type scale should reduce the spread. Source and current rendering support the first claim; no candidate CSS was applied.
2. Independent SVG/viewBox and emoji metrics cause icon mismatch. Prediction: equal outer SVG sizes retain differing painted bounds. Source geometry supports this; a future all-icon screenshot probe must validate it.
3. Nonshrinking metadata causes title starvation. Prediction: longer names/statuses/query values consume title space at unchanged container width. Source establishes the mechanism; the plan requires stress fixtures rather than claiming every overflow case reproduced.
4. Font loading/zoom changes apparent alignment. Prediction: loaded and fallback fonts produce different paint metrics under identical CSS. In the initial investigation, fixture font suppression was confirmed and loaded-font comparison was pending; the follow-up specimen below completes that comparison.

During the initial investigation no bisection or candidate-layout experiment was performed. The subsequent user-directed follow-up below adds a disposable specimen without modifying application implementation. Findings distinguish source-supported causes from untested candidate remedies.

## Consumer and behavior inventory

`frontend/src/dashboard.jsx:14033` defines `renderEpicBlock`; `frontend/src/eng/EngView.jsx` calls it for initiative-grouped and ungrouped ENG issue lists. `dashboard.jsx:14053` chooses the person input or readonly text; `:14154` adds capacity inclusion in Planning/Statistics. Inventory: epic icon, priority, project track, title, key, optional Included/Excluded button, status, SP, person icon and value. NO_EPIC/missing fields omit or replace some entries.

The plan preserves status/priority/track handlers, Jira link, person current-value/search/save/recovery state, readonly and disabled gates, shared capacity persistence, preview behavior and sticky layering. EPM issue boards and ENG Group Board compact cards are collateral-regression guards, not redesign targets. No API/storage/auth migration is proposed; plan-review endpoint and ownership migration matrices are inapplicable. Existing API interactions still require regression tests.

## Independent validation

Read-only analysis reviewer independently inspected source, tests and MRT020/MRT021/MRT028 and confirmed the scale mismatch, omitted icons, inadequate pixel-bottom tests, width pressure and accessibility gaps. The independent reviewer then inspected this written analysis, diagnostic probe and baseline crop: validated after correcting revision provenance. No substantive findings remain. The documentation-only HEAD movement was not performed by this investigation. A separate reviewer assesses the implementation contract, not this reviewer's preferred layout.

## Follow-up: invalid gate corrected

The next user correction rejected the unpassable gate. That criticism was correct: exact arbitrary-string ink equality and untruncated combined worst-case widths were assistant-created constraints, not a useful interpretation of visual consistency. A review that merely called this blocked workflow sound did not complete the design task.

The old task-zero screenshots also cannot justify the quoted feasibility totals: independent inspection found a blank stress crop and a controlled input showing a different value from an imperative assignment. Those images are excluded from the new evidence. The original five-role baseline measurements above remain limited diagnostic evidence; they do not define final acceptance.

A new disposable browser specimen uses stable fixture state and the existing React renderer. It validates an intrinsic title/key grid, flexible person width, calibrated 16px serif/14px mono text, and smaller track artwork. 16 stress cases plus 4 ordinary/focus cases passed; loaded/fallback reference cap-height spreads are 0.60/0.79px, maximum overflow 0px, title minimum 110px and loaded-font person minimum 153.81px. These results replace the unresolved feasibility gate. See the linked plan for exact dimensions, commands, evidence, review and remaining functional checks. Product implementation remains untouched. Final independent analysis review inspected the three requested crops and both JSON result files and validated the corrected evidence and interpretation. The slightly larger track-circle footprint remains part of the per-variant artwork checks during implementation, not an unresolved feasibility gate.

## Correction learning

For this regression, validate a concrete visual specimen yourself; compare optical typography and actual artwork separately from hit boxes, and never turn arbitrary glyph differences or all-untruncated stress strings into an unpassable prerequisite. The root instructions now record this concrete correction alongside the existing visible-alignment rule.

## Outcome and remaining work

Investigation completed with a concrete failing reproduction and a false-green existing-test result. The UI remains unfixed. Historical MRT028 correction claims are not acceptance of the current rejected appearance. Implementation is described in [the proposed plan](EXEC-epic-header-visible-height.md) and requires a separate user instruction to proceed.

Remote branch freshness and upstream instruction-template version could not be checked: GitHub DNS failed locally and the web fetch returned a cache miss. Existing dirty instructions and branch history were left intact.
