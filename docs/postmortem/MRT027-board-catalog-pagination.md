# MRT027: Board scope interpretation and loading regressions

**Date:** 2026-09-09
**Severity:** High
**Status:** Monitoring

## Impact

The delivered Board did not match the user's workflow. It added a second sprint/scope control, rebuilt selected-sprint data through a new request path, temporarily showed an empty result while data was still arriving, and returned a preheader `409` for All work. Component-only discovery also omitted Epics owned by other teams when those Epics contained work assigned to a Department team.

The result was confusing and unreliable: Catch Up displayed the expected sprint while Board could show no Epics, duplicate controls, or a failure for the same visible Department and sprint. After the scope corrections, a live All work request could still start successfully and then terminate with `board_projection_invalid` while projecting valid permission-reduced Jira parent metadata.

## Root cause

The design material was internally ambiguous about whether “optional sprint on Board” meant extending the existing shared Sprint selector or creating independent Board scope state. It also mixed a valid requirement for complete cross-sprint All work discovery with claims about the selected-sprint Catch Up source.

That ambiguity required a product decision. Instead of stopping and asking the user to confirm the control and data-source boundary, the implementation selected an independent Board state, a Board-local control, and a strict selected-sprint pipeline. Tests then encoded that interpretation, making an incorrect design appear internally consistent.

Two technical defects compounded the interpretation error:

- Project discovery incorrectly applied enhanced issue-search token pagination to `/rest/api/3/project/search`, which uses offset pagination.
- Early structural frames were treated as meaningful loaded content, allowing provisional zero membership to render as a final empty state.
- The strict projection treated optional embedded parent display metadata as required. Jira may return only the parent's key when nested fields are unavailable, while the existing Catch Up parser already tolerated that shape. List-valued optional custom fields, Team variants, and legacy Sprint metadata already accepted elsewhere in the app were also treated as fatal values. All of those failures collapsed into the same `phase=shape` log, preventing a field-level diagnosis from the live report.

The key process failure was not merely unclear wording. It was proceeding through a materially ambiguous UX and architecture decision without explicit user confirmation.

## Timeline

- The initial plan was interpreted as requiring Board-owned optional sprint state and a new strict data path.
- Implementation introduced a Board-local selector and later a separate All work button while retaining the existing top Sprint selector.
- Synthetic tests passed because their fixtures reflected the same interpretation and pagination assumptions.
- Live use exposed `409 board_config_invalid`, duplicate controls, delayed content after “No epics found,” and missing cross-team parent Epics.
- The user clarified that Board must reuse Catch Up's selected sprint and existing selector. A later correction added Component as a second cross-sprint strict choice beside All work; ordinary sprints still make no separate Board request.
- The plan, implementation, tests, feature documentation, postmortem, and durable instructions were corrected together.
- A later live retry reached the All work stream but failed during projection with `board_projection_invalid phase=shape`, exposing a Jira-shape compatibility gap absent from synthetic fixtures.

## Resolution

- Use offset pagination for project metadata, retaining token pagination for issues and rejecting stalled/repeated pages.
- For All work, union two additive cross-sprint sources: Epics matched by their own exact Department Component, plus parent Epics discovered from eligible work assigned to Department Teams. Component matching stays at the Epic boundary, and Team-parent discovery still runs when Components exist. Keep existing selected-project, parent-status retention, deadline and resource limits; batch parent lookup rather than issuing per-issue requests.
- Permit team-only All work. Reuse Catch Up's selected-sprint snapshot and add All work and Component only to the existing top Sprint selector while Board is active. Reserve the strict endpoint for those two cross-sprint choices; Component is Component-only, while All work is the Component-plus-Team-parent union. Remove every Board-local sprint/scope control.
- Keep provisional zero membership in a loading state and remove internal transport-progress copy from normal UI.
- Treat permission-reduced parent metadata as optional display context: retain the Epic and omit the incomplete parent projection. Normalize singular list-valued Delivery Owner and Project Track fields, established Team variants, and modern/legacy Sprint values without terminating the stream. Log an internal fixed field-level reason on any remaining projection rejection without exposing issue data.

## Verification

The endpoint-shaped regression failed with the reported `board_config_invalid` before the pager fix. Route tests traverse metadata capture and complete All work and Component Epic/child streams. Separate tests cover cross-team parents, team-only scope, Component-only discovery, permission-reduced parent metadata, optional list-valued custom fields, Team variants, and legacy Sprint values. Browser regressions prove selected-sprint Board reuses Catch Up without another request, both cross-sprint choices use the shared selector, provisional empty data is not presented as final, and an All work failure can return to the cached sprint. The final focused Board backend suite passed 93 tests, the frontend unit suite passed 1,252 tests, and the four corrected browser data-path cases passed. Authenticated live verification remains open.

## Follow-up: All work deadline before first content (2026-09-10)

The All work path still waited for the complete Department Team work scan and parent resolution before emitting its first Epic index. Component could finish while All work exhausted the shared 30-second budget. The frontend then cleared any partial content on a deadline or temporary Jira failure. Child searches also buffered a whole column, leaving the existing page-progress protocol unused. Dependencies were not part of this strict endpoint and were not the cause.

A deterministic actual-stream regression reproduced `start` followed by `deadline_exceeded` without the already-discovered Component Epic. The corrected stream emits those Epics as candidate membership before Team discovery, then emits the complete authoritative union. Team discovery excludes already-known parents where the bounded query has room, preserving null fallback and continuation-token headroom. Child pages publish cumulative counts through a bounded replaceable progress queue; final columns retain complete paginated children. The response opts out of reverse-proxy buffering. The request budget, two-worker limit, auth context, and completion requirements remain intact.

The UI retains partial content on availability failures, shows gray animated placeholders for unavailable totals, and replaces them independently as columns complete. Partial statistics remain explicitly provisional; terminal failures stop the animation, retain retry, and never unlock child-derived filters/export or enter the successful snapshot cache. Auth, invalid frames, and scope changes retain their existing invalidation behavior.

Regression coverage includes a held second child page, known-parent exclusion for modern and legacy parent fields, candidate-to-authoritative replacement, per-column loading, and browser-controlled streaming through a timeout. The full Python run passed 1,739 tests with 9 skipped, the frontend run passed 1,312 tests, and the Board browser suite passed 39 tests. Two additional focused regressions verified identical Epic membership with discovery reduced from two pages to one on a synthetic fixture, and a five-page slow-consumer load with at most two queued progress updates and all five final children retained. Before/after browser captures reproduced the disappearing-card failure against the original source and verified retained cards against the fix. Production Jira timing remains unmeasured; team-only discovery still requires scanning eligible work, so the bounded deadline can still produce an explicitly incomplete result.

## Follow-up: Sprint startup regression (2026-09-10)

Two follow-up changes incorrectly treated the shared Sprint selector as a new discovery problem. They made the control open during an unresolved request, added a browser timeout and retry state, and replaced the established Jira fallback query. This changed behavior outside the Board work and obscured the existing cache-first contract.

The correction removes those changes and restores the prior server cache and first-load catalog flow. The saved Sprint id and label now initialize together, so the selected Sprint is usable immediately while the first-load catalog request validates it. If there is no valid saved selection, the existing loader selects the current Sprint. A browser regression holds the catalog response, proves the cached Sprint is restored before it completes, verifies the selected-sprint data request proceeds, and then proves the selector becomes available from the returned catalog.

## Follow-up: Component index exceeded the Jira URL budget (2026-09-10)

A live All work request was rejected before Jira search with `phase=index`, `limit=url_bytes`, and an observed encoded request size of 11,774 bytes. The index path concatenated every configured Department Component into one JQL request even though the strict transport caps encoded Jira GET searches at 7,000 bytes. Parent and child key searches were already batched; Component discovery was the missing case. Dependencies were outside this endpoint and did not contribute to the failure.

The correction splits exact Component names into bounded searches with continuation-token headroom, shares the existing request/deadline counters across them, and deduplicates their Epic union under one incremental 1,000-key ceiling. Candidate Epic cards publish after each Component batch; membership becomes authoritative only after the complete union. Sprint startup also persists both the cached id and label, and the Board keeps All work and Component inactive while the first catalog request is pending. Regression coverage sends a synthetic Component catalog large enough to exceed the original URL budget through the actual stream, paginates the batches with a large token, and verifies every emitted Jira request stays within the cap.

## Follow-up: Progressive discovery limits and incomplete-result retention (2026-09-12)

Deterministic production-path fixtures proved four additional defects. All work applied the 1,000-Epic ceiling to raw Team-work parent candidates before the bounded Epic eligibility lookup, so 1,001 raw candidates could reject a valid two-Epic result without making a parent lookup. Component discovery exposed candidates between query batches but buffered every page inside a batch, so a valid first page remained invisible while page two was held or failed. A later `scope_too_large` terminal discarded already-validated cards on a cold load. Optional load-measurement promises could also hold terminal Board reduction even though telemetry is not data authority. These are proven synthetic causes; no captured authenticated run yet shows which one, if any, caused the reported production failure.

The correction separates raw parent candidates from admitted Epic membership. It preserves the 10,000 Team-work scan ceiling, performs sorted 40-key eligibility lookups, publishes each newly admitted valid prefix, and applies the unchanged 1,000-Epic limit only to the deduplicated Component-plus-eligible-parent union. Component discovery now validates and exposes each enhanced-search page before requesting the next. One route-local policy emits the first useful cumulative candidate immediately and coalesces later updates so optional candidate lines use at most 8 MiB. The writer prepares exact newline-inclusive UTF-8 bytes, advances identity/sequence/byte state only after successful admission, and reserves 1 KiB for one parseable `scope_too_large` terminal inside the unchanged 8 MiB frame and 32 MiB generation ceilings. Required malformed data still fails closed.

The owner now retains validated current-generation candidates and completed columns for `scope_too_large`, `deadline_exceeded`, `jira_unavailable`, and unexpected EOF without creating a successful snapshot or child authority. A compatible refresh continues to display only the prior complete snapshot with stale-specific copy; it never leaks the failed refresh's new membership into filters or Work items export. Optional measurement callbacks are fire-and-forget, contain synchronous and asynchronous failures, and retire by request identity so late observations cannot block data or overwrite a newer sample.

The large-shell acceptance fixture completed 1,000 Epics over 100 ten-row pages with 5,452,545 candidate bytes and 15,515,720 total serialized bytes; its largest frame was 4,293,058 bytes. A duplicate-only fixture emitted one candidate before final authority. Exact-bound/overflow coverage exercises admitted Epics, Team scans, children, pages, URL bytes, frame/generation bytes, terminal reserve, sequence integrity, late failures and reducer retention.

A joined loopback campaign ran the production `_frame_stream` over real HTTP into the actual dashboard owner, parser and Board DOM. After review tightened bounded startup cleanup, prepare/write serialization accounting, explicit producer-to-frame coalescing correlation, synchronous reducer-completion timing, generation-specific two-frame paint validation, scope-specific request matching and stale-artifact cleanup, all 11 serial cases passed in 13.1 seconds and independent spec/quality re-reviews passed. The campaign comprised one routing/owner diagnostic plus five gated scenarios each against current and baseline `40bffe7` sources. The current Component-page-two case emitted and painted its first candidate while page two was held; the baseline showed the loading state with zero Epics until release. The held current screenshot showed the focused card, while the complementary collapsed-column case kept focus on the collapsed rail and did not count hidden content as an early visible card. The campaign also covered a later Component batch, the second Team-parent lookup and child completion, measured synthetic serialization and coalescing, recorded frame/chunk ordering with clock-alignment uncertainty, and left genuinely unobservable values `null` rather than fabricating them.

Final local verification completed 1,786 Python tests with 9 skipped, 1,368 Node 20 frontend unit tests, 14 combined strict-stream/joined-campaign browser tests, 22 focused Basic-compatibility/source-guard/measurement tests and the production build. The current full Board spec command, `npx --no-install playwright test tests/ui/eng_group_board_view.spec.js --workers=1`, passed 68 tests. Chromium launch failed on the first sandboxed Board UI attempt; the approved outside-sandbox rerun passed. Settled synthetic screenshots were visually inspected for current/baseline held delivery, loading/progressive/complete states, Team-only and timeout partial content, compatible-refresh stale content, and cold hard-limit retention at desktop and 800px widths.

This evidence is synthetic loopback evidence, not a measured production speedup. Authenticated Component and All work require at least five comparable observations per scope/cache category before a live timing comparison; the reported 5.57-second observation remains separate. The exact current live terminal diagnostics, real scope cardinalities, production proxy buffering, live serialization CPU and live peak memory remain unverified.

## Lessons learned

Passing tests cannot validate a product interpretation when the fixtures and assertions were derived from that same unconfirmed interpretation. A plan can be detailed and still contain a strategic ambiguity.

API fixtures must model the documented endpoint, not mirror implementation assumptions. A successful mock suite is not proof of live Jira compatibility. Ownership of a parent does not determine which departments contribute child work.

Strict transport validation must distinguish required work identity from optional presentation enrichment. A partial optional subobject must not discard an otherwise valid Epic or terminate the complete Board generation.

The existing control and data owner are part of the product contract. “Make sprint optional on Board” did not authorize replacing them. When a requirement could reasonably mean either extending an existing interaction or introducing independent state, implementation must pause before code or UI work and ask the user which contract is intended.

## Prevention

- Before executing a plan, write the user-visible interaction in plain language, naming the existing control and the request triggered by each choice.
- Treat a new control, independent persistence/state owner, or parallel data source as a strategic decision requiring confirmation unless the plan states it unambiguously.
- Add a failing browser assertion that entering Board with an ordinary selected sprint performs zero additional Jira data requests.
- Test authoritative empty snapshots separately from loading/provisional empty state.
- Keep endpoint-shaped pagination fixtures distinct for Jira project search and enhanced issue search.
- Include permission-reduced embedded resources, list-valued configured fields, Team variants, and legacy Sprint values in projection fixtures. Keep fixed field-level reasons in sanitized rejection logs.
- Exercise request-size limits with the full configured Component catalog, not only short single-Component fixtures.
- Apply membership ceilings to validated admitted entities, not unresolved relationship candidates, and test the filtered-success case above the raw-candidate count.
- Join the production stream to the real owner and DOM with held response gates; parser-only or browser-injected fixtures do not prove pager-to-card delivery.
- Reserve a valid terminal before emitting optional cumulative frames, and test the exact byte boundary through writer, parser and owner.
- Model cross-sprint fixtures with the same persisted authority as production: strict capability, Department Board columns, a settled Sprint catalog, and either saved Jira selected projects or a saved Jira source Board. The 2026-09-14 selector correction supersedes the earlier disabled/no-op prevention rule: missing authority must still block every strict request, but Component and All work remain selectable and show the explicit setup state without revealing or refetching ordinary Sprint Board.
- Keep operational observation validators, persistence, and report filters aligned with every emitted Board scope. Test Component and All work with a null Sprint through validation, committed storage, HTTP ingestion, and filtered retrieval; never fabricate the saved Sprint for a cross-sprint sample.

## Action items

- [x] Add endpoint-shaped pagination and composed fetch regressions.
- [x] Add cross-team discovery and scope-recovery tests.
- [x] Correct the repository pagination rule and product documentation.
- [x] Keep Board-local sprint/scope controls removed and add both All work and Component to the shared top Sprint selector with distinct strict scopes.
- [x] Add a durable rule requiring clarification before choosing between existing-control reuse and new independent state/data ownership.
- [x] Add projection regressions for permission-reduced parent metadata, optional custom-field lists, Team variants, and legacy Sprint values; add sanitized field-level rejection reasons.
- [ ] Confirm live selected-sprint reuse plus All work and Component loads after server restart/browser refresh.

## References

- `backend/routes/eng_board_routes.py`
- `backend/services/eng_board.py`
- `tests/test_eng_board_routes.py`
- `tests/ui/eng_group_board_view.spec.js`
- [Atlassian project search contract](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/#api-rest-api-3-project-search-get)
