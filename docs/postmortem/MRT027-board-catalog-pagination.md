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
