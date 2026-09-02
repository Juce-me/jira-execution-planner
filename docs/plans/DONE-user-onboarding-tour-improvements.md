# User Onboarding Tour Interaction Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** Done. Executed on `feature/user-onboarding-tour` through verification commit `06bb1fd`. Kept for audit context only.

**Goal:** Split first-run onboarding into a direct existing-Department path and an optional **Add Department** path, guide create/duplicate users through the real Team Groups editor without a picker round trip, then make the dashboard tour teach users through safe interaction with every current inline Jira delivery-field type, clarify search contracts by surface, split Initiative → Epic → Story into distinct educational steps, and document the operational material from the 1:1 without overstating current product behavior.

**Architecture:** First-run onboarding has two explicit branches. An eligible existing Department is selected and persisted directly from the mandatory **Choose your Department** picker without opening Settings. A persistent **Add Department** action opens a small create-versus-duplicate choice, then the real Departments → Team Groups editor with a session-only configuration guide. A new or duplicated draft becomes the pending personal favorite and visible Department automatically; nothing persists until **Save and continue** commits all dirty shared Settings sections through the existing unified order and performs the existing private preference write last. The guide, favorite draft, and visibility draft are isolated from the dashboard tour and `onboarding_done`; Cancel restores captured drafts only before any server write, while a partial commit uses explicit retry/return recovery against normalized server baselines. Dashboard group-scoped loading and the dashboard tour remain blocked until both ownership domains are verified. The dashboard tour then replaces the single modal-only behavior with two accessibility modes: manual/fallback steps retain the inert modal contract, while the three editable-field steps use a non-modal interactive coachmark and the real option menu in read-only preview mode. Pure target eligibility, isolation, restoration, and ARIA-token helpers live outside the React component; the tour hook owns an atomic step-id guard so stale or duplicate events cannot skip steps.

**Tech Stack:** React 19, React DOM portals, DOM `inert`/ARIA state, CSS spotlight shields, Node 20 test runner, Playwright, esbuild, and the existing GA4/GTM analytics contracts.

**Dependency:** `DONE-user-onboarding-tour.md` is implemented and verified on the same branch. This plan supersedes that plan's return-to-picker configure flow and its “highlighted element is visual context only while the whole background stays inert” interaction contract. It reuses the existing shared-group and private first-run preference endpoints without changing their schemas, ownership, CSRF/auth rules, onboarding persistence, replay behavior, or analytics event taxonomy.

---

## Correctness findings resolved by this plan

1. The current `#root`-wide `inert`/`aria-hidden` state and full-screen hit layer prevent normal target clicks. Interactive steps therefore require a different input and accessibility mode; changing only a click listener is forbidden.
2. Initiative, Epic, and Story onboarding targets are presentational containers with nested links and mutation controls. They remain spotlight-only and always use manual **Next**.
3. The current search implementation matches key/summary across Initiative, Epic, and Story, but assignee only for Epic and Story. The plan uses that factual wording. Initiative-assignee search is deferred because the current Initiative payload has no assignee and adding it would require a separately reviewed backend enrichment and initial-load performance contract.
4. One `editing` step cannot show every current inline Jira delivery-field control in Catch Up. It is replaced by three exact steps: Priority, Project Track, and Status. Planning selection, subtask disclosure, remove, and external Jira links are separate actions, not delivery-field edits.
5. A click-driven last step cannot both advance and avoid implicit completion. A terminal `complete` step now owns explicit **Finish**.
6. Listener lifecycle, duplicate-event, focus, hit-testing, and mutation safety are browser behavior and belong in Playwright, not only in the pure utility test.
7. Operational meeting content spans Configuration, Planning, Board, and Statistics. It belongs in linked feature guidance, not as fourteen additional popup steps.
8. The shared option-menu component currently focuses its first enabled option on mount. Post-render DOM suppression would race that behavior, so the supported implementation must add an explicit read-only preview contract instead of trying to inert the menu after focus has already moved.
9. Returning from first-run configuration to a second selector repeats a decision already made by choosing create/duplicate. The new draft therefore becomes the pending private favorite and visible Department automatically, and configuration closes directly into the dashboard only after the private preference save succeeds.
10. Shared Department configuration and personal favorite/visibility preferences have different owners and cannot be mixed into one payload. **Save and continue** must commit all dirty Settings sections through the established unified order, including `/api/groups-config`, then call `/api/groups-preferences` last; an earlier failure blocks the preference request, while a later preference failure keeps already-saved baselines and retries only unsaved work.
11. Search adds noise and suggests missing data in a small first-run catalog. It is absent for zero through three Departments and appears only for four or more. **Add Department** remains visible in both states because creating a Department is an intentional alternative, not only an empty-search recovery.
12. The current Team Groups editor duplicates Department naming between a left-list label and a right-side input, while the left row is a single button. The active left row must become the only editable name control and the row structure must avoid nesting that input inside a button; the right pane keeps a read-only heading.
13. The current unselected star and **Show in my controls** label do not explain the personal preference model. The star needs an obvious unselected state and first-edit explanation, while the checkbox becomes **Show in Department selector** with persistent helper text and a favorite-always-visible disabled state.
14. **Run onboarding again** is currently tied to Team Groups content. Replay is a Settings-wide action and belongs at the right of `.group-modal-header`, where it remains visible across tabs and is disabled during any dirty/save state.
15. The app/environment does not need a Node-version change: `.nvmrc` and `package.json#engines` already pin Node 20.x. A different version from an uninitialized shell is not valid build evidence; keep the repository pin and initialize the configured runtime manager in the verification worktree.

## Scope and forbidden regressions

### In scope

- Tour catalog/copy, target resolution, target readiness, interaction state, accessibility, CSS hit-testing, and a narrow read-only-preview prop through the existing field-menu render path.
- Exact Priority, Project Track, and Status preview steps.
- Initiative, Epic, and Story educational steps with deterministic loading/absence behavior.
- Search copy that accurately describes the shipped search predicate.
- First-run phase branching: direct selection for an eligible existing Department; a persistent **Add Department** create/duplicate path; deterministic duplicate cleanup defaults; guided real-Settings configuration; automatic pending favorite/visibility; and ordered shared/private persistence.
- Team Groups clarity changes required by the guided path: one left-list inline Department-name input, first-edit favorite education, **Show in Department selector** helper text, and the Settings-header replay action.
- A concise onboarding journey plus focused English operational guidance for Configuration, Planning, Board, Statistics, filters/search, and Jira bulk-work handoff.
- Analytics impact documentation and guards; no new event schema.
- Generated frontend JS, source map, and CSS.

### Out of scope

- Backend route schemas, migrations, auth/CSRF policy, storage ownership, onboarding completion persistence, or replay semantics.
- File/JSON shared `defaultGroupId` or ordinary dashboard Department switching. The revised label/helper/disabled state may clarify existing favorite/visibility behavior, but route schemas and ownership remain unchanged; first-run create/duplicate writes only the existing current-user `visibleGroupIds`/`activeGroupId` preference contract after shared group save succeeds.
- Initiative-assignee fetching/search. Do not claim it exists.
- Clicking hierarchy cards, Jira-export, Refresh, Sprint/Department/Teams dropdowns, Search, or the filter wrapper to advance. Those actions navigate, reload, change scope, focus an input, or use non-native composite controls.
- Jira field mutation during an onboarding preview, including selection from a menu option by pointer or keyboard.
- Hardcoded meeting-specific Department/team/component names. Use generic examples and placeholders; do not commit production identifiers.
- New onboarding step-view/click analytics.

## API and analytics effect matrix

No route schema or policy changes are planned. The first-run configuration branch changes when the two existing configuration requests are composed.

| Onboarding action | Existing request allowed | Forbidden request/result | Analytics contract |
| --- | --- | --- | --- |
| Choose eligible existing Department | Existing exact `POST /api/groups-preferences` with `{visibleGroupIds:[id], activeGroupId:id}` | No `/api/groups-config`; no dashboard group-scoped request before the verified preference response | Existing `settings_action` first-run selection outcome; no group id/name |
| Choose **Add Department** / create / duplicate / edit guide fields | None until **Save and continue** | No request on path choice, draft creation, duplicate cleanup choice, guide navigation, rename, team/component edit, star explanation, or visibility explanation; no premature favorite/visibility persistence | No new guide-step event; no raw query, group name, team, or Component data |
| Save new/duplicated/repaired-as-use Department | Established unified Settings saves, including dirty `POST /api/groups-config` with `baseRevision`, followed only after every verified section by the same exact `POST /api/groups-preferences`; `preference_pending` retry sends only the private request | Never put private favorite/visibility in shared config, never mutate `defaultGroupId`, never send the preference request after validation/409/earlier-section failure, and never reopen the picker after full success | Preserve one existing validation-failure event per blocked Save; request/section events do not repeat after that section commits; `first_run_selection` once after private success; one private failure result per failed attempt; no raw group data |
| Open Priority preview | Existing `GET /api/issues/priorities/options?issueKey=...` | No `POST /api/issues/priorities`; visible priority is unchanged | Existing `priority_options_open` may run with only `source_surface`, `issue_type_mix`, and `selected_count_bucket`; no onboarding step event |
| Open Project Track preview | Existing `GET /api/issues/project-track/options?issueKey=...` | No `POST /api/issues/project-track`; visible track is unchanged | Existing `project_track_options_open` may run with only `source_surface`, `issue_type_mix`, and `selected_count_bucket`; no onboarding step event |
| Open Status preview | Existing read-only `POST /api/issues/transitions/options` with the owning hook's current request shape | No `POST /api/issues/transitions`; visible status is unchanged | Existing `status_options_open` may run with `source_surface`, `issue_type_mix`, `selected_count_bucket`, and Planning-only `selected_sp_bucket`; no submit/result or onboarding step event |
| Manual tour navigation | None beyond existing app behavior | No onboarding write before Skip/Finish | Step navigation remains intentionally untracked |
| Skip/Finish | Existing exact `POST /api/me/onboarding` behavior | No duplicate write or schema change | Existing successful `skipped`/`completed` only after persistence |

Update `docs/README_ANALYTICS.md` to state that a real field-trigger preview can emit its existing safe options-open event, while the tour adds no step id, issue data, raw content, submit, or result event.

Configured first-run analytics are attempt-aware: preserve the current one `settings_action/save_result=failure` validation event for each user Save attempt blocked before requests; emit `first_run_selection` exactly once only after the verified private preference succeeds; emit one preference `save_result=failure` with `source_surface=first_run` for each user-initiated failed private attempt; retain existing admin/Department/EPM events for their current validation/request outcomes; and never re-emit a completed section's events during `sections_pending` or `preference_pending` retry. Never include group ids/names, query text, team/Component values, issue keys, or guide step ids.

### Existing endpoint contract gates

No route accepts a client-supplied user/workspace/site identity. Configuration writes resolve the authenticated user's workspace from the existing request context; Jira option reads resolve that user's Jira OAuth context. Preserve these contracts exactly:

| Route | Auth/request contract | Request → verified success | Expected failures and UI result |
| --- | --- | --- | --- |
| `POST /api/groups-config` | Existing `user_write`; obtain `/api/auth/csrf`, send JSON with `X-Requested-With: jira-execution-planner` and `X-CSRF-Token` | `{version, baseRevision, groups, defaultGroupId}` → normalized shared snapshot containing `source`, `configRevision`, `groups`, and preferences; first-run code additionally verifies the pending id/name/team | `400` invalid/unsupported/implicit-clear stays in Settings; `409 group_config_conflict` carries `current` into Keep/Discard; `401` global auth lock; other failure stays retryable. No preference request follows. |
| `POST /api/groups-preferences` | Existing `user_write` with the same CSRF/X-Requested-With wrapper; workspace/user derived server-side | `{visibleGroupIds:[id], activeGroupId:id}` → `{preferences, groupsConfigSnapshot}`; both snapshots must agree, clear `onboardingRequired`, and contain the eligible active group | `400` invalid/unsupported stays retryable; `409 group_preferences_db_required` is terminal for this DB first-run path; `401` global auth lock; invalid/mismatched success is treated as failure without replay. |
| `POST /api/me/onboarding` | Existing `user_write` with the same CSRF/X-Requested-With wrapper | `{onboardingDone:true}` on Finish or existing Skip behavior → `{onboardingDone:true}` | `400` invalid; `409 onboarding_db_required`/`group_selection_required`; `401`; other storage failure. Tour remains open except for the global auth lock. The configuration guide never calls this route. |
| `GET /api/issues/priorities/options?issueKey=…` | Authenticated Jira OAuth read with existing `X-Requested-With`; no mutation CSRF | Existing priority option-catalog shape → labelled `ready` or `empty` preview | `400/404/403/502` map to the field-specific error/fallback contract; auth-required maps to global lock. Never call `POST /api/issues/priorities`. |
| `GET /api/issues/project-track/options?issueKey=…` | Authenticated Jira OAuth read with existing `X-Requested-With`; exact Epic key required | Existing `{options:[{value}], …}` catalog → labelled `ready` or `empty` preview | `400/404/409/403/502` map to error/fallback; auth-required maps to global lock. Never call `POST /api/issues/project-track`. |
| `POST /api/issues/transitions/options` | Authenticated Jira OAuth read operation with existing JSON and `X-Requested-With`; no mutation CSRF | `{issueKeys:[key]}` → existing per-issue transition/`targetStatuses` catalog → labelled `ready` or `empty` preview | `400/403/502` map to error/fallback; auth-required maps to global lock. Never call `POST /api/issues/transitions`. |

Task 0 and final verification must retain the existing backend ownership/security proof in `tests.test_shared_group_config_routes` and `tests.test_endpoint_security_matrix`; frontend tests alone do not replace the workspace, CSRF, conflict, and identity-spoofing guards.

## First-run chooser and guided-configuration contract

### Phase A — Choose an existing Department

- Keep the mandatory picker blocking and unskippable until one eligible personal starting Department is persisted.
- Use the title **Choose your Department** and describe the choice as the Department the dashboard will open first; do not tell the user to star a group in this picker.
- Hide search for zero through three Departments. For one through three, show **All available Departments are shown · {count}** so a one-row list is understood as complete, not as a broken search state; zero keeps the explicit empty message. Render the existing name/id search only when `groups.length >= 4`; filtering never changes the visibility of the persistent **Add Department** action.
- Keep the picker a labelled modal with background inerting, initial focus, trapped Tab order, and `aria-busy` during persistence. Escape never bypasses the mandatory gate. Non-auth preference errors use `role="alert"`, retain the selected radio, re-enable **Continue**, and move focus to the error summary; `401` uses only the global auth lock.
- Eligible matching rows remain native radio choices; **Continue** sends the existing first-run preference payload and never opens Settings or writes shared configuration.
- Describe **Continue** conditionally: **Next: a skippable dashboard tour** only when `onboardingDone === false`; otherwise **Next: dashboard**. Never promise automatic replay to a user whose dashboard tour is already complete.
- Keep a persistent secondary **Add Department** button in the picker footer for every catalog/search state. It opens the Phase B choice without creating or saving anything.
- If filtering hides the selected radio, keep a footer summary **Selected: {Department}** with a **Clear selection** action; never leave enabled **Continue** bound to an invisible unexplained value.
- A matching group with no configured team remains ineligible, but its row exposes **Configure and use {Department}** as a sibling native button—not inside the disabled radio label. Its accessible name includes the Department and its description explains why the radio is unavailable. Activating it is the user's explicit choice: set that group as the session-only pending favorite/pending-visible Department, open it in the guided repair state, and send no request before Save.

### Phase B — Create, duplicate, or repair a Department

- **Add Department** opens a focused choice with **Create clean Department** and **Duplicate existing Department**. Duplicate is unavailable when there is no source Department; no path is selected automatically.
- The setup choice is its own labelled modal surface over the picker with initial focus and trapped Tab order. Keep the picker mounted but restorably inert and `aria-hidden`, suspend its focus trap/modal semantics, and expose exactly one `aria-modal=true` dialog. Restore picker semantics/trap before returning focus to **Add Department** on **Back** or Escape, without changing picker/query/selection state. Any source/cleanup validation error is announced and stays in the choice.
- **Create clean Department** immediately opens Departments → Team Groups with one active unsaved blank draft. **Duplicate existing Department** first requires a source, then asks whether to **Remove existing teams** and/or **Remove existing components**. Both checkboxes are unchecked by default, so duplication preserves both collections unless the user opts out.
- A duplicate copies the full Department configuration. **Remove existing teams** clears both `teamIds` and dependent `teamLabels`; **Remove existing components** clears `missingInfoComponents`. Boards, exclusions, Ad Hoc capacity, and other group-level fields stay copied. Cleanup is applied to the draft only and never mutates the source.
- Generate a valid collision-free duplicate name/id (`Source Copy`, then `Source Copy 2`, and so on through the existing id builder). The name guide step remains required and focused, but a valid prefilled value satisfies the step without forcing a textual change.
- New and duplicated drafts become the session's pending personal favorite automatically and are pending-visible in the Department selector. **Configure and use {Department}** does the same for its repaired existing group. Capture the pre-guide favorite/visibility draft for exact pre-commit Cancel and post-commit private-only recovery.
- The configuration guide is a separate session-only state machine, not an `OnboardingTour` step and not part of `onboarding_done`. It anchors to the real controls in this order: Department name, Teams, Components, favorite star, and **Show in Department selector**. It must never overlap or run concurrently with the dashboard tour.
- Name is required and Teams requires at least one valid team. Components are optional: use the user's contextual wording without universalizing it—**Component is a Jira issue field; in this workflow it is usually set on the Epic**—then explain that configured Components broaden only Missing Information/Lead Times scope, not the main Story list. Offer an explicit **Continue without components** path. The Teams hint says to add one or more teams so the expected Stories can be scoped to this Department.
- The first-run footer reads **Save and continue**. It remains unavailable until the guide reaches its final step, all required guide fields validate, and every dirty Settings section validates; it becomes available after **Done with guide** and remains available for preference-only retry after shared saves have committed. Ordinary Settings keeps its existing **Save** label and unified behavior.
- Bind the same conditional expectation to **Save and continue**: **Next: a skippable dashboard tour** only when `onboardingDone === false`, otherwise **Next: dashboard**. On a tour-eligible success, finish guide focus/ARIA cleanup before the first dashboard-tour card receives focus and keep **Skip onboarding** available from that first card; when already complete, load the dashboard without replay.

### Phase C — Make the real Team Groups editor understandable

- On desktop, the active Department's name in the left group list becomes the only editable name input. Remove the right-side name input; retain a read-only right-pane heading that mirrors the draft. Inactive rows remain selection controls, and the active row structure must not nest the input, star, or other controls inside a button.
- Pin the active/editing row in the list regardless of the current filter and suspend/clear filtering when the first-run guide focuses the name, so the only textbox cannot filter itself out. Capture the edit-start value on focus. Enter commits only a trimmed, nonblank, unique name; invalid Enter retains focus, sets `aria-invalid`, and announces the inline error. Invalid blur preserves the error/draft but permits focus to guide **Back** or Settings **Cancel**; only actions that require a valid name return focus to the input. Escape restores the captured value. Row switching, duplicate, delete, drawer close, and forward guide navigation must explicitly commit valid input or remain on the name field. Validation, duplicate naming, dirty tracking, and conflict rebase all read the same canonical draft field.
- On compact/mobile layouts, the guide opens the Groups drawer, focuses the same inline name input, completes/validates that step there, then returns focus to the editor. Do not add a second mobile name input.
- Make ordinary Settings stars native buttons with Department-specific accessible names, `aria-pressed`, visible focus, and selected/unselected states that do not rely on glyph/color alone. The first edit guide explains: **Your favorite Department is the one the dashboard opens first.** During mandatory setup, render the auto-selected star as a locked preference-status block announced as **Favorite Department, selected pending save** rather than an operable no-op button.
- Rename **Show in my controls** to **Show in Department selector** and always show: **Controls whether this Department appears in the dashboard Department menu.** Bind that helper through `aria-describedby`. When the active group is the favorite, expose a labelled, programmatically focusable checked status with **Your favorite Department is always shown** during the guide; in ordinary Settings the checkbox remains checked/disabled. A nonfavorite remains togglable.
- Move `<button type="button" class="secondary compact">Run onboarding again</button>` to the right side of `.group-modal-header` through a Settings-shell header action. It is visible across Settings tabs whenever replay is available, hidden when replay is not eligible, and disabled while any section is dirty or saving with visible described text **Save or discard changes before replaying onboarding.** Preserve at least a 44×44 touch target; on narrow layouts allow a second header row so title, dirty badge, and replay never overlap. Remove the Team Groups-local duplicate and preserve existing replay persistence and analytics.
- On compact/coarse-pointer layouts, picker radio rows, **Add Department**, named repair actions, setup choices/checkboxes, guide Back/Continue/Cancel, inline name, and current Teams/Components triggers each need a non-overlapping 44×44 CSS-pixel interaction rectangle without changing desktop density or activating an adjacent control.

### Phase D — Persist, load scope, and start the tour

1. Validate the complete Settings draft and the pending favorite Department. Do not send any request when its name is blank, it has no valid team, or board/shared validation fails. Optional Components never block save after **Continue without components**.
2. Preserve the unified Settings save: commit every dirty editable section through its established order, and save dirty shared groups through `/api/groups-config` with the current revision. Verify the resulting normalized group snapshot contains the pending favorite id with its required name/team state. Any validation failure, `409`, other section error, or invalid snapshot leaves Settings open and sends zero preference requests; already committed section baselines remain clean for retry.
3. As the final write, persist `/api/groups-preferences` with exactly the pending favorite id in both `visibleGroupIds` and `activeGroupId`. Verify the response and `groupsConfigSnapshot` match, reuse the existing first-run one-shot guard, and ignore duplicate Save/click events.
4. Only after both ownership domains are verified: apply the saved preference snapshot, clear `onboardingRequired`, set the active group, close Settings directly, start sprint/group-scoped data loading, and then start the dashboard tour. The mandatory picker must not flash or remount between Settings and the dashboard.
5. If the private preference request fails after successful shared/section saves, keep Settings open, retain the pending favorite/visibility state and committed baselines, show the retryable error, and make the next **Save and continue** retry only unsaved work. A `401` uses the existing global auth lock and never auto-replays either write.
6. Before any server write commits, Cancel/discard restores the captured shared/private/active drafts and returns to the picker without starting group-scoped requests/tour. After a partial commit, use the post-commit recovery contract below; never restore a stale shared snapshot. Conflict **Keep mine** and **Discard mine** follow the same committed-section rules.

### Configuration-guide interaction contract

- Keep Settings as the owning modal. The configuration guide is a non-modal anchored coachmark inside that dialog: it must not add a second `aria-modal`, make the whole Settings root inert, cover the target with a pointer layer, or prevent normal keyboard/pointer use of the current real control. Use target refs/stable hooks rather than text matching.
- While the mandatory guide is active, the focus island is `{current real control region, coachmark Back/Continue, Settings Cancel}`. Temporarily suppress other Settings edit regions and tab switches with exactly restorable `inert`/ARIA state; keep the active control's owned search/menu portal in the island. Focus/Shift+Tab stays inside this set. **Cancel setup** uses the existing Settings cancel/discard flow and is never hidden.
- On entry, focus the current real target after it is rendered and scrolled into view, append one guide description id without replacing existing `aria-describedby` tokens, and announce the step once. Place the target and guide actions inside `visualViewport`, recomputing for mobile keyboard, resize, drawer changes, and owned picker size. The coachmark exposes **Back** plus a step-specific continuation action; it never advances from unrelated clicks or a component remount.
- `name`: focus the canonical left-list input. **Continue** is enabled only for a trimmed non-empty name. Enter accepts the inline edit but does not skip the guide step; edit-level Escape restores the edit-start value and stays on the step, while a later Settings-level Escape follows the existing cancel/discard contract. Invalid edit navigation returns focus to the field, but **Cancel setup** remains reachable and is never blocked by name validation.
- `teams`: the actual team search/add controls remain operable. **Continue** is enabled only when at least one non-empty `teamId` exists; duplicate-preserved teams satisfy the requirement but the step is still shown and explained.
- `components`: the actual Component search/add controls remain operable. With one or more values show **Continue**; with none show the explicit **Continue without components** action. Either choice records session guide progress only.
- `favorite` and `visibility`: expose labelled, programmatically focusable preference-status blocks rather than targeting disabled controls. Announce **Favorite Department, selected pending save** and the checked visibility requirement. Use **Next** then **Done with guide**; never require a no-op click on a locked star or checkbox.
- **Back** preserves edits and revisits the prior real target. Escape closes the current owned team/component popup first and otherwise stays inside the guide; it never silently discards setup. Compact layout opens the Groups drawer for `name`, keeps the input and coachmark actions above the mobile keyboard, then returns to the editor for later steps.
- Target removal, duplicate-draft deletion, conflict rebase, or validation that invalidates the pending group closes/docks the coachmark and presents one actionable recovery message. It never falls through to dashboard loading. Cancel/discard/unmount always restores guide-owned inert/ARIA/focus state and restores data only according to the pre-/post-commit session rules; successful save unmounts the guide before dashboard tour bootstrap.

### First-run session ownership, save, and rollback contract

- `dashboard.jsx` owns one `firstRunConfigurationSession` reducer because it already owns `groupDraft`, active draft, Settings open/close, and unified save. Its states are `idle`, `editing`, `saving_sections`, `sections_pending`, `preference_pending`, and `complete`; it stores `mode`, `pendingGroupId`, guide step/completion, captured shared/private/active drafts, the latest normalized group snapshot, error/recovery action, and per-section committed flags.
- Opening Settings consumes a pending create/duplicate/repair draft exactly once after normal Settings initialization; the existing open effect must not overwrite it with committed `groupsConfig`. Use dedicated session pending-favorite/pending-visible state, because the ordinary favorite setter correctly rejects zero-team groups. StrictMode, remount, and repeated open events must not create a second draft/session or reset its guide step.
- Before the first successful server write, Cancel/discard may restore the captured shared draft, private preference draft, and active Department exactly, then return to the picker.
- After any Settings section succeeds, the old shared/admin/EPM snapshot cannot be restored locally. Keep every normalized committed baseline and section flag. A failure with zero committed sections returns `saving_sections → editing`; a failure after at least one commit enters `sections_pending` with **Retry unsaved settings** plus **Return to Department chooser**. `sections_pending → saving_sections` retries, while Return moves to `idle` after discarding only uncommitted local drafts and reapplying actual committed baselines; generic discard is absent. Only after every non-private section succeeds may `saving_sections → preference_pending` occur. If that final preference write fails, show **Retry favorite save** plus **Return to Department chooser**; Return restores only unsaved private preference state and shows the committed Department eligible/focused in the picker. Remove generic wording that promises to discard committed work, and never pretend an unsaved or committed Department has the opposite server state.
- A `409` **Discard mine** is separate: rebase group state to the response's `current` snapshot, preserve already committed unrelated section baselines, and return to recovery/chooser if that snapshot omits or invalidates the pending group. **Keep mine** retries only still-uncommitted work against the supplied revision.
- Put first-run orchestration in `saveAllSettings`, not inside `saveGroupsConfig`. Make section saves return structured `{ok, normalizedGroups, committedSections}` outcomes. `saveAllSettings` awaits current admin/group work, then EPM, and calls the first-run preference write last. On `preference_pending` retry, bypass group/admin/EPM saves, config re-fetches, cache refresh queues, and their save analytics; the explicit pending-private state keeps the footer enabled even when every normal dirty signature is clean.
- Verify recovery against the server, not only React state: after group success → preference failure → Return/Retry, a subsequent `/api/groups-config` snapshot and rendered chooser must agree with the committed group, while no earlier section request repeats.

## Step catalog and progression contract

Use explicit `progression` metadata. Do not add a vague `advanceOnTargetClick` boolean.

| Order | Step id | Target | Presence/readiness | Progression |
| --- | --- | --- | --- | --- |
| 1 | `sprint` | existing Sprint control | existing required/fallback behavior | `manual` |
| 2 | `group` | existing Department control | conditional | `manual` |
| 3 | `teams` | existing Teams control | conditional | `manual` |
| 4 | `refresh` | existing Refresh control | existing required/fallback behavior | `manual` |
| 5 | `search` | existing Search input | conditional | `manual` |
| 6 | `filters` | existing ENG filter wrapper | conditional | `manual` |
| 7 | `hierarchy-initiative` | exact Initiative container | fixed fallback-capable step | `manual` |
| 8 | `hierarchy-epic` | exact Epic container | fixed fallback-capable step | `manual` |
| 9 | `hierarchy-story` | exact Story container | fixed fallback-capable step | `manual` |
| 10 | `editing-priority` | enabled Epic Priority trigger, then Story fallback | fixed fallback-capable step | `menu-preview` |
| 11 | `editing-track` | exact enabled Epic Project Track trigger | fixed fallback-capable step | `menu-preview` |
| 12 | `editing-status` | enabled Epic Status trigger, then Story fallback | fixed fallback-capable step | `menu-preview` |
| 13 | `jira-export` | existing Jira menu trigger | conditional and enabled | `manual` |
| 14 | `complete` | none | always present | `finish` |

Rules:

- Hierarchy steps are never click-driven. Do not attach listeners to their containers or descendants.
- The three editing steps teach field types, not every rendered instance. Priority applies to Epics and Stories, Project Track to Epics, and Status to Epics, Stories, and Subtasks. Prefer one visible Epic for all three examples to avoid scroll churn; if that Epic lacks an eligible Priority or Status trigger, fall back deterministically to the first eligible visible Story. Do not expand Subtasks solely to find a Status example.
- `menu-preview` eligibility requires the resolved node itself to be a connected, enabled native `<button>` with `aria-haspopup="menu"` and a boolean `aria-expanded` state. Otherwise render the field-specific fallback and restore manual **Next**.
- For an eligible preview, hide **Next**. Use input-neutral copy: “Activate the highlighted control to preview its choices; no value change is required. Close the preview or press Escape to continue.”
- The owning field component opens its real options surface with `previewOnly=true`. Keep `role="menu"`, focus the labelled menu root, and expose readable `aria-disabled="true"` menuitems through `aria-activedescendant` with Arrow/Home/End inspection. Preview rows use normal text contrast, are not operable buttons, and ignore selection defensively. The menu label/note announces the field, read-only purpose, loading/error state, and option count. The exact trigger remains reachable.
- Closing advances exactly once only after the owned menu mounted, received focus, and reached `preview_ready` or `preview_empty`. Closing during `preview_loading` cancels that preview and stays on the same step. A catalog failure becomes `preview_error`; closing that labelled error surface returns to the same-step field fallback with manual **Next**.
- **Back**, **Skip onboarding**, and cleanup close any tour-opened preview before changing step or closing the tour. Cleanup-origin lifecycle callbacks must never satisfy progression.
- `complete` is a centered modal card with explicit **Finish**. A target click never persists completion.
- Popup copy stays short: at most two compact sentences per step. Detailed operational training stays in feature docs.
- Show four grouped progress labels—**Dashboard basics**, **Work hierarchy**, **Field previews**, and **Continue in Jira**—so the conditional Jira-export step never appears outside a named section. Add **Skip this section** on hierarchy and field previews. Section skip never persists completion and resolves the next present step exactly once: Jira export when eligible, otherwise `complete`.

## Interactive state machine

| State | Application accessibility/input | Tour controls | Exit |
| --- | --- | --- | --- |
| `manual` | Preserve current `#root` inert + `aria-hidden`; card is `aria-modal=true` | Back, Next/Finish, Skip | Next/Back/Skip/Finish |
| `loading` | Same as manual; centered entity-specific loading card | Back and Skip; Next disabled | Data settles → target or fallback |
| `fallback` | Same as manual; centered field/entity-specific explanation | Back, Next, Skip | Next/Back/Skip |
| `interactive_closed` | Omit `aria-modal`; exact target + tour card form the only active island; every non-target sibling subtree is restorably suppressed | Back, Skip this section, and Skip onboarding; no Next | Target opens menu → `preview_loading`; target loss → `fallback` |
| `preview_loading` | Exact target, focused owned menu root, and tour card are exposed; menu announces loading and cannot submit | Back and Skip actions; no Next | Ready/empty/error → corresponding state; close → same step; 401 → auth lock |
| `preview_ready` | Menu root exposes read-only choices through `aria-activedescendant`; no menuitem can submit | Back and Skip actions; no Next | Same trigger or Escape closes menu → atomic next step |
| `preview_empty` | Menu root announces that no alternative choices are available; no mutation is possible | Back and Skip actions; no Next | Same trigger or Escape closes menu → atomic next step |
| `preview_error` | Owned menu remains open and announces the options failure; no mutation is possible | Back and Skip actions; no Next while open | Close → same-step field-specific fallback with manual Next; 401 → auth lock cleanup |
| `advancing` | Ignore further target events and cleanup clicks | Disabled transiently | Next step commits → its resolved state |

Implementation constraints:

- Do not infer open/close from DOM `aria-expanded` timing or add a generic document/direct-target click listener. The exact field owner already handles the real trigger; in `previewOnly` it reports toggle/open/close provenance through the explicit lifecycle bridge after applying its normal state transition. Do not use capture interception, `preventDefault`, `stopPropagation`, forced clicks, or a cloned/proxy control.
- Key the one-shot latch by current session, step id, and target identity. Use a functional `advanceFromStep(stepId)` hook transition that returns unchanged state when the current id no longer matches.
- In interactive mode, do not set the whole root inert/hidden. Starting at the target, suppress every sibling subtree along the path to `#root`, then restorably suppress every unrelated body-level portal/container outside `#root`; explicitly exempt only the tour coachmark/shields and the exact owned preview portal. Preserve exact prior `inert` attributes/properties, `aria-hidden`, and `aria-describedby` tokens. Restore them on target replacement/disappearance, step change, Back, Skip, Finish, auth lock, close, and unmount.
- Track tour-owned suppression separately. Target discovery may ignore only tour-owned suppression; pre-existing inert/hidden state still disqualifies a target. This prevents future steps from disappearing from the snapshot and prevents MutationObserver feedback loops.
- Add an explicit bidirectional ownership bridge. `OnboardingTour` calls `onPreviewTargetChange(descriptorOrNull)` with `{sessionId, stepId, fieldKind, issueKey, targetIdentity}`. `dashboard.jsx` owns `onboardingPreviewSession`, passes it back as `previewSession`, and sets `previewOnly` only on the exact matching Catch Up field control. The matching field/menu reports `onPreviewLifecycleChange(descriptor, {state, reason})`, where `state` is `closed|loading|ready|empty|error|auth_required` and a close reason is exactly `same_trigger|escape|cleanup|target_loss|auth_required|unmount`. `OnboardingTour` requests cleanup through `onRequestPreviewClose(descriptor, reason)`, and dashboard maps the exact kind/key to `closePriorityControl`, `closeProjectTrackControl`, or `closeSingleIssueStatusControl`. Stale descriptor callbacks are no-ops.
- Advance only on an owned `closed` callback whose descriptor still matches, whose immediately preceding settled state was `ready` or `empty`, and whose reason is `same_trigger` or `escape`. A close from `loading`, `error`, cleanup, target loss, auth lock, unmount, Back, or either Skip action cannot advance. Set the cleanup latch before requesting owner close, then clear it only after the matching `closed` callback or owner teardown.
- Match the owned preview menu by session, step, field kind, issue key, and target identity; a stale or different field/issue menu must never be put in preview mode, raised, closed, or used as progression evidence. Multiple rendered controls in the fixture are mandatory proof.
- In `previewOnly`, `IssueFieldOptionMenu` disables its current document-capture outside-pointer dismissal. Shield/card pointerdown is ignored for menu lifecycle; it neither closes nor advances. Only the same trigger, Escape handled by the owned menu, or an explicit tour cleanup callback may close. Back, section skip, tour Skip, auth lock, target replacement/disappearance, and unmount set the cleanup latch **before** invoking `onRequestPreviewClose`; their resulting `closed` callback cannot advance.
- Thread the exact `previewOnly` descriptor through the existing Catch Up Epic/Story render path into Priority, Project Track, Status, and `IssueFieldOptionMenu`. In that mode, keep focus on the labelled menu root, render normal-contrast non-button `menuitem` rows with stable ids and `aria-disabled="true"`, implement Arrow/Home/End `aria-activedescendant` inspection, make Enter/Space a no-op, expose stable lifecycle hooks, and guard `onSelect` even if an event is dispatched programmatically. Preserve normal field-menu behavior bit-for-bit outside an active tour, including first-option focus, outside dismissal, and Escape-to-trigger behavior.
- Set the full layer pointer-transparent only in interactive mode. Add four body-level scrim shields around an exact interaction hole equal to the target's measured hit box; the visual spotlight may retain padding, but its padded rectangle must never expand the clickable hole onto an adjacent control. Keep the coachmark and matched read-only menu visually above the shields. Do not move the overlay inside transformed/sticky content.
- Eligibility requires center and boundary `elementFromPoint` checks to resolve to the target or its descendant. On coarse-pointer/mobile layouts, temporarily expand undersized Priority, Project Track, and Status native buttons to a 44×44 CSS-pixel interaction rectangle with layout-compensating tour styles; measure that expanded hit region. If it overlaps another control or cannot stay inside the viewport, use the honest fallback instead of proxying a click.
- In `interactive_closed`, the focus island is `{exact trigger, Back, section skip, Skip onboarding}`. In preview states it is `{owned preview root, exact trigger, Back, section skip, Skip onboarding}`. Define deterministic forward/reverse Tab order, redirect `focusin` outside the active set, and never include preview menuitems. Closing restores trigger focus before atomic advance; the next committed step then focuses its own target/card once. Restore pre-tour focus only when the tour itself closes.
- Lock background and target-ancestor scrolling while interactive, preserving exact previous scroll/overflow state; allow internal scrolling only in the coachmark and owned preview. Recompute shields/placement from `visualViewport`, resize, target replacement, and preview-size changes before reopening hit-testing. Place the coachmark against the union of target and preview rectangles; if a non-overlapping placement cannot fit, use a mobile bottom-sheet coachmark or honest fallback.
- Escape in `preview_ready`/`preview_empty` closes and advances; Escape in `preview_loading` closes and remains on the same step. Escape elsewhere in either mode retains the existing one-time Skip behavior. After a step change focus the next target or fallback card; restore pre-tour focus only when the tour closes.
- Use one announcement path: interactive steps rely on focused target/menu plus their appended description; manual/loading/fallback steps use the live region. Never announce identical instructions through both.

## Target readiness and absence contract

`frontend/src/dashboard.jsx` must pass loading/settled readiness for the hierarchy/editing steps from the existing ENG task-loading state. Add no request.

- At step entry, if relevant ENG data is still loading, stay on the same fixed step and show its loading state. Do not let a fast user skip a target merely because Jira has not settled.
- After data settles, find a rendered candidate even when it is currently offscreen, scroll it into view with non-animated/`prefers-reduced-motion`-safe behavior, then resolve and measure the viewport target.
- Before opening, fallback is allowed only when the entity/control is absent, filtered out, pre-disabled, or cannot be brought into view. Jira edit permission, empty catalogs, and catalog errors are learned only after activating an enabled trigger: success becomes ready, an empty catalog becomes empty, 403/500 becomes a closable error preview then same-step fallback, and 401 invokes global auth-lock cleanup. Do not claim permission awareness before the options request.
- If a target disappears or is replaced mid-step, detach/restore the old interaction island before binding the new one. Never auto-advance.
- Initiative, Epic, and Story remain in fixed order whenever at least one exists. For the seven non-empty presence combinations, present targets get spotlights and absent targets get distinct fallback copy; section skip lands on `editing-priority`.
- If all three hierarchy targets are absent after loading settles, compact those three catalog entries into one concise fallback explaining Initiative → Epic → Story. Its Next/section-skip action lands on `editing-priority`; no empty card follows it.
- If all three editing targets are absent, compact them into one availability-aware summary whose Next/section-skip action resolves the next present step: `jira-export` when eligible, otherwise `complete`. For partial availability, retain all three ordered field-type steps with specific fallbacks; do not infer Jira edit permission until a real options request returns.

## File map

### Create

- `frontend/src/settings/FirstRunGroupSetupChoice.jsx` — focused create/duplicate/source/cleanup choice UI.
- `frontend/src/settings/FirstRunGroupConfigurationGuide.jsx` — session-only anchored guide rendered over real Team Groups controls.
- `frontend/src/settings/firstRunGroupConfiguration.js` — pure search-threshold, duplicate-draft, guide-step, restore, and validation helpers.
- `tests/test_first_run_group_configuration.js` — pure first-run configuration contracts.
- `frontend/src/onboarding/onboardingInteraction.js` — target eligibility, ancestor-sibling isolation plan, exact restoration, owned-suppression tracking, and ARIA token helpers.
- `tests/test_onboarding_tour_interaction.js` — pure helper contracts with a small fake DOM tree.
- `docs/features/eng-workflows.md` — focused Configuration, Planning, Board, filters/search, and Jira handoff guide.

### Modify

- `frontend/src/settings/FirstRunGroupSelectionModal.jsx`
- `frontend/src/settings/SettingsModal.jsx`
- `frontend/src/settings/TeamGroupsSettings.jsx`
- `frontend/src/settings/useGroupVisibilityPreferences.js`
- `frontend/src/onboarding/onboardingSteps.js`
- `frontend/src/onboarding/OnboardingTour.jsx`
- `frontend/src/onboarding/useOnboardingTour.js`
- `frontend/src/dashboard.jsx`
- `frontend/src/issues/IssueCard.jsx`
- `frontend/src/issues/IssueFieldOptionMenu.jsx`
- `frontend/src/issues/PriorityTransitionMenu.jsx`
- `frontend/src/issues/ProjectTrackTransitionMenu.jsx`
- `frontend/src/issues/StatusTransitionMenu.jsx`
- `frontend/src/styles/settings/first-run.css`
- `frontend/src/styles/settings/group-editor.css`
- `frontend/src/styles/settings/team-groups.css`
- `frontend/src/styles/settings/team-selector.css`
- `frontend/src/styles/settings/onboarding-tour.css`
- `tests/test_group_visibility_utils.js`
- `tests/test_epm_settings_source_guards.js`
- `tests/test_onboarding_tour_utils.js`
- `tests/test_eng_task_utils.js`
- `tests/test_onboarding_analytics.js`
- `tests/test_analytics_source_guards.js`
- `tests/test_frontend_api_source_guards.js`
- `tests/ui/onboarding_tour.spec.js`
- `tests/ui/eng_group_board_panel.spec.js`
- `tests/ui/eng_group_board_view.spec.js`
- `tests/ui/shared_department_groups.spec.js`
- `tests/ui/settings_unified_save.spec.js`
- `tests/ui/global_auth_lock.spec.js`
- `docs/features/onboarding.md`
- `docs/features/personal-group-star.md`
- `docs/features/statistics.md`
- `docs/features/README.md`
- `docs/README_ANALYTICS.md`
- `docs/plans/README.md` — its existing entry is now stale, but the current modification is user-owned; obtain confirmation before overlapping it during execution.

### Generated by `npm run build`; never hand-edit

- `frontend/dist/dashboard.js`
- `frontend/dist/dashboard.js.map`
- `frontend/dist/dashboard.css`
- `frontend/dist/auth-focus-refresh.js`
- `frontend/dist/auth-focus-refresh.js.map`

### Do not modify

- Backend routes, services, models, migrations, auth/security policy, or Jira payloads.
- Priority/Project Track/Status mutation hooks and API wrappers. The presentational menu components listed above may receive only the narrow `previewOnly` behavior defined here; do not change their normal submission, catalog, result, or layout contracts.
- Shared-group versus private-preference ownership, existing route payloads, ordinary non-first-run favorite/visibility semantics, and file/JSON `defaultGroupId` behavior. The plan clarifies the existing controls and changes first-run orchestration, not their storage owners.
- `docs/plans/README.md` unless its already-present entry becomes factually stale during execution.

---

## Task 0 — Preflight the branch, runtime, files, and green baseline

**Files:** read only.

- [ ] Confirm the active checkout and preserve unrelated changes:

```bash
git status --short --branch
git log --oneline -5
```

Expected: dedicated `feature/user-onboarding-tour` branch; do not implement on `main`. Record and preserve every pre-existing modified/untracked path before editing; current observed unrelated changes such as `docs/plans/README.md` must not be folded into this implementation merely because they are present.

- [ ] Verify every planned existing file is present and the created files are absent or explicitly reviewed before reuse:

```bash
for onboarding_file in frontend/src/settings/FirstRunGroupSelectionModal.jsx frontend/src/settings/SettingsModal.jsx frontend/src/settings/TeamGroupsSettings.jsx frontend/src/settings/useGroupVisibilityPreferences.js frontend/src/onboarding/onboardingSteps.js frontend/src/onboarding/OnboardingTour.jsx frontend/src/onboarding/useOnboardingTour.js frontend/src/dashboard.jsx frontend/src/issues/IssueCard.jsx frontend/src/issues/IssueFieldOptionMenu.jsx frontend/src/issues/PriorityTransitionMenu.jsx frontend/src/issues/ProjectTrackTransitionMenu.jsx frontend/src/issues/StatusTransitionMenu.jsx frontend/src/styles/settings/first-run.css frontend/src/styles/settings/group-editor.css frontend/src/styles/settings/team-groups.css frontend/src/styles/settings/team-selector.css frontend/src/styles/settings/onboarding-tour.css tests/test_group_visibility_utils.js tests/test_epm_settings_source_guards.js tests/test_onboarding_tour_utils.js tests/test_eng_task_utils.js tests/test_onboarding_analytics.js tests/test_analytics_events.js tests/test_analytics_source_guards.js tests/test_frontend_api_source_guards.js tests/ui/onboarding_tour.spec.js tests/ui/eng_group_board_panel.spec.js tests/ui/eng_group_board_view.spec.js tests/ui/shared_department_groups.spec.js tests/ui/settings_unified_save.spec.js tests/ui/global_auth_lock.spec.js docs/features/onboarding.md docs/features/personal-group-star.md docs/features/statistics.md docs/features/README.md docs/README_ANALYTICS.md docs/plans/README.md backend/security/CONFIGURATION_OWNERSHIP.md; do test -f "$onboarding_file" || exit 1; done
for onboarding_file in frontend/src/settings/FirstRunGroupSetupChoice.jsx frontend/src/settings/FirstRunGroupConfigurationGuide.jsx frontend/src/settings/firstRunGroupConfiguration.js tests/test_first_run_group_configuration.js frontend/src/onboarding/onboardingInteraction.js tests/test_onboarding_tour_interaction.js docs/features/eng-workflows.md; do test ! -e "$onboarding_file" || { echo "review existing create path: $onboarding_file"; exit 1; }; done
```

Expected: exit 0.

- [ ] Read `backend/security/CONFIGURATION_OWNERSHIP.md` before changing orchestration and preserve its shared group, private preference/EPM, authenticated user, and workspace boundaries. Inspect the existing modified `docs/plans/README.md`; obtain user confirmation before changing overlapping lines, otherwise leave it untouched and report its stale entry as an unresolved documentation gate.

- [ ] Use the pinned Node runtime before accepting any frontend evidence:

```bash
nvm use
node --version
```

Expected: `.nvmrc` resolves to `v20.x`. If the runtime manager is not initialized in the executing shell, initialize the host's configured manager without adding a local absolute path to project content, then rerun. A Node 22 pass is baseline information only, not final evidence; inability to run the pinned Node 20 build/test path blocks completion rather than authorizing an environment-file change.

- [ ] Run the current green baseline before writing RED tests:

```bash
python3 -m unittest tests.test_shared_group_config_routes tests.test_endpoint_security_matrix
node --test tests/test_group_visibility_utils.js tests/test_epm_settings_source_guards.js tests/test_onboarding_tour_utils.js tests/test_eng_task_utils.js tests/test_onboarding_analytics.js tests/test_analytics_source_guards.js
npx playwright test tests/ui/shared_department_groups.spec.js tests/ui/onboarding_tour.spec.js
```

Expected before this improvement: current tests pass. Record actual counts and unrelated failures before editing; do not hard-code a stale count as evidence.

## Task 1 — Implement the first-run chooser and create/duplicate choice test-first

**Files:** create `frontend/src/settings/FirstRunGroupSetupChoice.jsx`, `frontend/src/settings/firstRunGroupConfiguration.js`, `tests/test_first_run_group_configuration.js`; modify `frontend/src/settings/FirstRunGroupSelectionModal.jsx`, `frontend/src/dashboard.jsx`, `frontend/src/styles/settings/first-run.css`, `tests/test_group_visibility_utils.js`, `tests/test_analytics_source_guards.js`, `tests/ui/shared_department_groups.spec.js`.

**Interfaces:** preserve `buildFirstRunGroupPreferencesPayload(selectedGroupId)` exactly. Keep the new choice UI controlled and express draft construction with pure helpers:

```js
shouldShowFirstRunGroupSearch(groupCount); // true only when groupCount >= 4
buildFirstRunGroupDraft({ mode: 'create' | 'duplicate', sourceGroup, existingGroups, removeTeams: false, removeComponents: false });
beginFirstRunGroupConfiguration({ mode: 'create' | 'duplicate' | 'repair', sourceGroupId: null, removeTeams: false, removeComponents: false });
```

- [ ] Add RED unit cases for search counts `0, 1, 2, 3, 4, 5`; only four and five return true. Add pure duplicate cases for both cleanup flags independently and together, proving both default to false, the source is never mutated, team cleanup also clears `teamLabels`, Component cleanup clears `missingInfoComponents`, unrelated fields remain copied, and name/id generation produces the first collision-free `Source Copy N` pair.
- [ ] Add RED Playwright assertions that the dialog title is **Choose your Department**, zero through three groups render no search, one through three state that every available Department is shown, four or more render search, and **Add Department** remains visible with matches, without matches, and with an empty catalog.
- [ ] Add RED modal/focus assertions: picker initial focus and Tab trap, Escape cannot close it, `aria-busy` during direct persistence, and preference errors retain selection and focus an alert. If search hides the selected row, the footer exposes **Selected: {Department}** plus **Clear selection**.
- [ ] Prove the direct branch separately for both completion states: when `onboardingDone=false`, **Continue** is described by **Next: a skippable dashboard tour** and the tour bootstraps after verified selection; when true, it says **Next: dashboard** and no replay starts. Both send exactly one `/api/groups-preferences`, zero `/api/groups-config`, and zero group-scoped requests before the verified response; the picker closes and Settings never opens.
- [ ] Make an ineligible matching row expose a sibling **Configure and use {Department}** button, not a nested control. It cannot use the radio; activating the named repair action sets only the session pending favorite/visibility, opens that exact group in the guided repair state, and sends no request.
- [ ] Add RED choice-dialog cases: **Add Department** creates/saves nothing; **Create clean Department** immediately opens one blank unsaved draft; **Duplicate existing Department** requires a source, is unavailable with zero sources, then shows **Remove existing teams** and **Remove existing components** unchecked. Submitting creates one copied draft, applies only selected cleanup, and leaves the source unchanged.
- [ ] Prove the setup choice exposes exactly one modal to the accessibility tree, makes/restores the underlying picker inert/hidden, traps focus, and returns the unchanged picker plus focus to **Add Department** on **Back** or Escape; validation stays announced in the choice. Opening Team Groups restores no stale choice focus behind Settings.
- [ ] Cover empty search without turning it into a separate creation model: the empty result message keeps the same persistent **Add Department** button, the raw query seeds neither the new name nor analytics, and changing the query restores rows without losing the setup choice state only when that choice is still open.
- [ ] Implement the controlled chooser/choice UI and pure helper. Avoid a route request, analytics event, `onboarding_done` update, or personal preference write until direct **Continue** or later **Save and continue**.
- [ ] Run:

```bash
node --test tests/test_first_run_group_configuration.js tests/test_group_visibility_utils.js tests/test_analytics_source_guards.js
npx playwright test tests/ui/shared_department_groups.spec.js --grep "first-run|Add Department|search threshold|create clean|duplicate existing|Configure and use"
```

Expected: pass; small catalogs have no search, the creation path is always available, duplicate defaults preserve teams/team-label mappings/components, and path selection has no persistence side effect.

## Task 2 — Guide real Team Groups configuration and persist the pending favorite safely

**Files:** create `frontend/src/settings/FirstRunGroupConfigurationGuide.jsx`; modify `frontend/src/settings/SettingsModal.jsx`, `frontend/src/settings/TeamGroupsSettings.jsx`, `frontend/src/settings/useGroupVisibilityPreferences.js`, `frontend/src/dashboard.jsx`, `frontend/src/styles/settings/first-run.css`, `frontend/src/styles/settings/group-editor.css`, `frontend/src/styles/settings/team-groups.css`, `frontend/src/styles/settings/team-selector.css`, `tests/test_first_run_group_configuration.js`, `tests/test_epm_settings_source_guards.js`, `tests/test_analytics_source_guards.js`, `tests/test_frontend_api_source_guards.js`, `tests/ui/shared_department_groups.spec.js`, `tests/ui/settings_unified_save.spec.js`, `tests/ui/global_auth_lock.spec.js`.

**Interfaces:** keep `TeamGroupsSettings` controlled/stateless and do not add a backend field. Add one dashboard-owned reducer and structured save outcomes:

```js
startFirstRunConfigurationSession({ mode, groupId, capturedGroupDraft, capturedPreferencesDraft, capturedActiveGroupId });
advanceFirstRunConfigurationSession({ type, payload }); // idle|editing|saving_sections|sections_pending|preference_pending|complete
saveAllSettings({ firstRunSession }); // => {ok, normalizedGroups, committedSections, preferencePending}
saveFirstRunGroupPreferences({ groupsSnapshot, selectedGroupId: pendingFavoriteGroupId });
cancelFirstRunConfigurationSession(); // exact restore only before any committed section
```

- [ ] Add RED reducer/guide-state tests for one canonical session and exact transitions: zero-commit failure `saving_sections → editing`; partial-commit failure `saving_sections → sections_pending`; retry/return `sections_pending → saving_sections|idle`; all non-private success `saving_sections → preference_pending`; private success `→ complete`. Per-section flags survive remount/conflict rebase and generic discard is absent in `sections_pending`. Guide steps remain `name → teams → components → favorite → visibility`; StrictMode/open-effect/remount cannot duplicate/reset the session or draft; validation/optional/prefilled rules hold and **Save and continue** is unavailable until **Done with guide**.
- [ ] Add RED guide-interaction assertions: one Settings `aria-modal` only; each real target receives focus and an appended/restored description token; unrelated clicks/remounts do not advance; Back preserves edits; duplicate-preserved teams still show the Teams step; selected-star/disabled-visibility steps use coachmark actions instead of requiring no-op target clicks.
- [ ] Add RED desktop assertions that the active left-list Department name is the only textbox for the name, the right pane is a read-only heading, and the active row contains no nested button/input. Pin the editing row through filter changes; guide entry suspends filtering. Valid Enter/blur commits; invalid Enter retains focus; invalid blur preserves `aria-invalid`/announced error but Tab/Shift+Tab and pointer can still reach guide Back/Settings Cancel. Forward/row-switch/delete/drawer-close actions requiring validity return focus. Escape restores the edit-start value. Rename, conflict rebase, and dirty tracking all use the same draft field.
- [ ] Add RED compact/coarse-pointer assertions that the guide opens the Groups drawer, focuses that same inline input, returns to the editor after the step, and never renders a second name input. Picker rows/Add/repair, setup choices/checkboxes, guide navigation/Cancel, inline name, and current Teams/Components triggers each expose a measured non-overlapping 44×44 interaction rectangle.
- [ ] Add RED focus/target-loss assertions: unrelated Settings tab/edit regions are inert only while the mandatory guide is active, the active control/picker portal plus guide and Settings Cancel form the complete focus island, and compact placement stays inside `visualViewport` above the keyboard. Deleting/rebasing away the pending group gives one recovery state; target disappearance never skips; Cancel/unmount restores focus and every guide-owned inert/ARIA token.
- [ ] Add RED Teams/Components assertions: at least one non-empty team is required; the Teams hint asks for one or more teams; Components is optional and the contextual hint says Component is a Jira issue field that in this workflow is usually set on an Epic, followed by the actual Missing Information/Lead Times-only scope; **Continue without components** is explicit and does not weaken name/team validation.
- [ ] Add RED personal-preference assertions: a new/duplicated/repaired-as-use draft immediately appears as pending favorite/visible; no private request fires yet. During the guide, favorite and visibility are labelled focusable status blocks, not misleading operable controls. Ordinary stars are accessible pressed buttons with visible selected/unselected states. **Show in Department selector** always has described helper text; ordinary favorite is checked+disabled with **Your favorite Department is always shown**, while an ordinary nonfavorite remains togglable.
- [ ] Remove the right-side name input and restructure group-list rows so inactive selection, active inline edit, star, duplicate, and delete controls are siblings with deterministic Tab order. Reuse existing list/editor styling and responsive drawer behavior; do not add a second naming source.
- [ ] Add a `SettingsModal` header-action slot and move the exact `<button type="button" class="secondary compact">Run onboarding again</button>` to the right of `.group-modal-header`. Assert it is visible on Team Groups and at least one other Settings tab when eligible, hidden during mandatory first run, disabled while any section is dirty or saving with its visible described explanation, and preserves the existing replay request/outcome analytics. At compact width assert a 44×44 target and a non-overlapping second-row fallback for title, dirty badge, and replay. Remove the Team Groups-local button.
- [ ] Put configured first-run ordering in `saveAllSettings`: await its existing admin/group phase, retain the normalized group snapshot and committed flags, await EPM, then call `/api/groups-preferences` last with exactly:

```json
{"visibleGroupIds":["selected-group"],"activeGroupId":"selected-group"}
```

Assert shared/EPM payloads contain no private favorite/visibility fields and shared `defaultGroupId` is unchanged. A `preference_pending` retry bypasses all earlier POSTs, config GET/refetch, refresh queues, and section analytics.
- [ ] Add the full failure matrix in `settings_unified_save.spec.js`: local/board/shared validation and `409`/500/invalid snapshots send zero preference requests; **Keep mine** retries only dirty work then private; **Discard mine** rebases to `current`; preference 500/invalid snapshot after earlier commits enters `preference_pending`; retry sends only the preference request; duplicate clicks send each required request at most once. Assert the exact ordered URL list and subsequent server snapshot/UI after every boundary.
- [ ] Split cancellation tests: before any commit, Cancel/discard restores captured shared/private/active drafts exactly. After a partial section commit, generic discard cannot restore stale server data; **Retry unsaved settings** repeats only uncommitted sections and Return drops only uncommitted local drafts. In `preference_pending`, **Retry favorite save** preserves committed baselines and Return restores only unsaved private state while rendering the committed Department eligible/focused. Cover admin success → group 500 → Return, group success → EPM 500 → retry, group/EPM success → preference 500 → Return, and full earlier success → preference 500 → retry.
- [ ] In `global_auth_lock.spec.js`, prove a 401 at every first-run save phase terminally locks the mounted app, preserves session/committed state, sends no replay after reauthentication, and exposes no local/raw error. Cover create/duplicate/repair with both `onboardingDone` values: **Save and continue** says **Next: a skippable dashboard tour** and starts it only when false, otherwise says **Next: dashboard** and does not replay. In both cases Settings closes directly, the picker never remounts, and scoped loading begins only after verification; tour-eligible success finishes guide focus/ARIA cleanup before tour focus and exposes **Skip onboarding** immediately.
- [ ] Specify analytics counts and assert them through the browser data layer: zero requests plus exactly one existing validation-failure event for a blocked Save; `first_run_selection` exactly once only after verified private success; one preference `save_result=failure` with `source_surface=first_run` per user-initiated failed private attempt; completed section events never repeat on `sections_pending`/`preference_pending` retry; no raw ids/names/query/field content; duplicate click cannot duplicate outcomes.
- [ ] Update source guards so the guide is separate from `OnboardingTour`/`onboarding_done`, `TeamGroupsSettings` remains controlled, the header action is shell-owned, route helpers remain CSRF-wrapped, and no guide-step/raw-field analytics schema is introduced.
- [ ] Run:

```bash
node --test tests/test_first_run_group_configuration.js tests/test_group_visibility_utils.js tests/test_epm_settings_source_guards.js tests/test_analytics_events.js tests/test_analytics_source_guards.js tests/test_frontend_api_source_guards.js
npx playwright test tests/ui/shared_department_groups.spec.js tests/ui/settings_unified_save.spec.js tests/ui/global_auth_lock.spec.js --grep "first-run|inline name|configuration guide|favorite|Department selector|Run onboarding again|partial save|preference pending|auth lock|compact"
```

Expected: pass; there is one canonical name input, new/duplicated Departments are pending favorite/visible without premature writes, replay is Settings-wide, and the shared/private retry boundary is deterministic.

## Task 3 — Lock the catalog, accurate search copy, and fixed absence matrix test-first

**Files:** `tests/test_onboarding_tour_utils.js`, `tests/test_eng_task_utils.js`, `frontend/src/onboarding/onboardingSteps.js`.

- [ ] Add failing unit assertions for the exact 14-step order from the catalog table; exact `progression` values; one exact selector per hierarchy step; deterministic Epic-first selector preferences for Priority/Status; the Epic-only Project Track selector; and an always-present `complete` step.
- [ ] Add all eight Initiative/Epic/Story presence combinations. The seven non-empty combinations must preserve `hierarchy-initiative`, `hierarchy-epic`, `hierarchy-story` in order; the all-absent combination must deterministically produce one aggregate hierarchy fallback and then the field-preview group.
- [ ] Add grouped progress and section-skip assertions: basics → hierarchy → field previews → Continue in Jira. Hierarchy skip lands on `editing-priority`; field-preview skip resolves `jira-export` only when eligible and otherwise `complete`; neither path invokes Skip/Finish persistence.
- [ ] Add copy assertions for:
  - key and summary across Initiatives, Epics, and Stories;
  - assignee on Epics and Stories only;
  - Priority, Project Track, and Status each having their own preview/fallback copy;
  - no copy claiming that a value must change.
- [ ] Strengthen `tests/test_eng_task_utils.js` so Initiative key/summary, Epic assignee, and Story assignee are separately proved. Do not add an Initiative-assignee fixture expectation.
- [ ] Run RED:

```bash
node --test tests/test_onboarding_tour_utils.js tests/test_eng_task_utils.js
```

Expected: fail for the old 9-step catalog, combined hierarchy/editing steps, missing progression metadata, and old search copy.

- [ ] Implement only the catalog/copy changes and rerun GREEN:

```bash
node --test tests/test_onboarding_tour_utils.js tests/test_eng_task_utils.js
```

Expected: pass.

## Task 4 — Add pure interaction eligibility, isolation, and exact restoration helpers

**Files:** create `frontend/src/onboarding/onboardingInteraction.js`, create `tests/test_onboarding_tour_interaction.js`.

- [ ] Write failing tests for:
  - eligibility accepts only the exact enabled native menu button;
  - a container, nested child, disabled button, disconnected node, custom role-button, input, and button without boolean `aria-expanded` are rejected;
  - the isolation plan contains every non-target sibling from target to `#root` plus every unrelated body-level portal/container, never contains the target/ancestor path, and exempts only the coachmark/shields and exact owned preview portal;
  - pre-existing `inert`, inert property, `aria-hidden`, and `aria-describedby` values restore byte-for-byte across root and portal containers;
  - tour-owned suppression is distinguishable from pre-existing suppression;
  - appending/removing the coachmark description token preserves other description ids.
- [ ] Run RED:

```bash
node --test tests/test_onboarding_tour_interaction.js
```

Expected: fail because the module does not exist.

- [ ] Implement the narrow helper interfaces used by `OnboardingTour.jsx`; keep React state and event listeners out of this module.
- [ ] Run GREEN:

```bash
node --test tests/test_onboarding_tour_interaction.js
```

Expected: pass.

## Task 5 — Make hierarchy/editing readiness and offscreen targeting deterministic

**Files:** `frontend/src/dashboard.jsx`, `frontend/src/onboarding/onboardingSteps.js`, `frontend/src/onboarding/OnboardingTour.jsx`, utility and Playwright tests.

- [ ] Add one exact readiness enum: `loading` when `!tasksFetched || loading || productTasksLoading || techTasksLoading`; `terminal-error` when loading is false and `displayedEngError` is non-empty; otherwise `settled`. Pass that enum to the tour. Partial cached rows do not make a still-loading state settled; a terminal ENG error cannot expose an interactive target.
- [ ] Add failing pure/browser cases for every hierarchy and editing step across `loading`, visible, offscreen-rendered, filtered/missing, pre-disabled, terminal error, disappearing, and replacement. Cover all eight Priority/Project Track/Status presence combinations as well as the hierarchy matrix. Assert that future steps do not disappear while tour-owned sibling subtrees are suppressed.
- [ ] In `dashboard.jsx`, derive the enum from those existing ENG values only. Add no fetch and do not change Catch Up preparation or saved sprint/Department/team scope.
- [ ] Add a renderable-candidate resolver that still rejects hidden/zero/pre-existing-inert nodes but can find an offscreen candidate before `scrollIntoView` and viewport measurement.
- [ ] Use immediate/reduced-motion-safe scrolling only on step entry or target replacement; do not continuously fight user scrolling.
- [ ] Extend observation to the `inert` attribute while preventing tour-owned attribute changes from causing an unbounded MutationObserver/measure loop.
- [ ] Run:

```bash
node --test tests/test_onboarding_tour_utils.js tests/test_onboarding_tour_interaction.js
npx playwright test tests/ui/onboarding_tour.spec.js --grep "readiness|offscreen|hierarchy matrix|replacement"
```

Expected: pass; all eight hierarchy combinations are finishable with deterministic order/totals, including the specified all-absent compaction.

## Task 6 — Implement dual-mode accessibility and preview-only target progression

**Files:** `frontend/src/onboarding/OnboardingTour.jsx`, `frontend/src/onboarding/useOnboardingTour.js`, `frontend/src/onboarding/onboardingInteraction.js`, `frontend/src/dashboard.jsx`, `frontend/src/issues/IssueCard.jsx`, `frontend/src/issues/IssueFieldOptionMenu.jsx`, `frontend/src/issues/PriorityTransitionMenu.jsx`, `frontend/src/issues/ProjectTrackTransitionMenu.jsx`, `frontend/src/issues/StatusTransitionMenu.jsx`, `frontend/src/styles/settings/onboarding-tour.css`, `tests/ui/onboarding_tour.spec.js`.

- [ ] Extend the Playwright harness with three real menu-trigger shapes matching Priority, Project Track, and Status (`button`, `aria-haspopup=menu`, controlled `aria-expanded`, owned menu). Instrument owner lifecycle `{state, reason}` callbacks, normal-mode outside listeners, target handler order, focus, and cleanup counts.
- [ ] Add failing cases proving:
  - `locator.click()` reaches the exact highlighted target without `{ force: true }`;
  - `document.elementFromPoint()` at target center and near each boundary resolves the target/descendant, while points inside visual padding and outside the exact hit box resolve a shield and never an adjacent application control;
  - the application trigger owner opens the preview and reports `loading` without the tour reading stale `aria-expanded` DOM;
  - the matched real menu is visually present with a preview-only note, its root—not its first option—receives focus, Arrow/Home/End moves `aria-activedescendant` across readable disabled menuitems, and pointer, Enter/Space, or dispatched selection cannot invoke `onSelect`;
  - a different field/issue menu cannot become the owned preview or progression signal;
  - an unrelated open body portal is inert/hidden, absent from the active accessibility/focus set, and restored exactly after the step; only the exact owned preview portal is exempt;
  - closing during loading stays on the same step; ready, explicit-empty, and error states are announced; only closing a focused ready/empty preview advances once;
  - shield/card pointerdown does not close; same-trigger and owned-menu Escape report their exact close reason; Back/section-skip/tour-Skip/auth-lock/target-loss/unmount set cleanup before explicit close and their callbacks never advance;
  - a late options response after close, replacement, unmount, or session change is ignored;
  - synchronous double click, re-render, remount, stale target click, and replacement do not multi-advance;
  - target disappearance restores fallback **Next** and exact page state; reappearance hides **Next** and rebinds once;
  - Enter/Space activate the native target; Tab/Shift+Tab follow the exact closed/open focus-island order; Escape skips only when no preview is open;
  - Back/Skip/unmount while a preview is open closes it and leaves balanced listeners/observers;
  - wheel/touch scroll cannot desynchronize the target and shields; `visualViewport` resize recomputes before hit-testing; target, preview, and coachmark rectangles never overlap incorrectly;
  - coarse-pointer Priority/Project Track/Status targets meet the 44×44 interaction-rectangle rule without changing row layout or activating a neighbour; unsafe overlap produces fallback **Next**;
  - manual/fallback steps still set the original root inert/hidden state and exact legacy restoration tests keep passing.
- [ ] Add `advanceFromStep(stepId)` as a functional, stale-id-safe transition in the hook. Do not place DOM listener state in the hook.
- [ ] Implement the named preview-session bridge and exact prop/callback chain. Keep the real surface visible, label its read-only purpose/state/count, focus its menu root, expose readable disabled menuitems through `aria-activedescendant`, disable preview-only outside dismissal, and guard selection without touching normal non-tour behavior.
- [ ] Implement the interactive state machine without a generic target/document advancement listener: reconcile exact session/step/field/key/identity owner lifecycle, accept only ready/empty `same_trigger|escape` close reasons, set the pre-close cleanup latch for every non-progress close, and implement dual focus handling, ARIA description tokens, one announcement path, and exact restoration.
- [ ] Replace the monolithic pointer-catching layer only for interactive mode with body-level exact-target-hole shields, a separately padded visual spotlight, a pointer-active card, and the matched read-only menu above the scrim. Preserve portal/z-index behavior and viewport placement.
- [ ] Run:

```bash
node --test tests/test_onboarding_tour_utils.js tests/test_onboarding_tour_interaction.js
npx playwright test tests/ui/onboarding_tour.spec.js --grep "interactive|focus|Escape|fallback|cleanup"
```

Expected: pass with normal pointer and keyboard paths; no forced click appears in these tests.

## Task 7 — Prove real field previews never mutate Jira

**Files:** `tests/ui/onboarding_tour.spec.js`, `tests/ui/eng_group_board_panel.spec.js`, `tests/ui/eng_group_board_view.spec.js`; read/reuse current transition components and route shapes.

- [ ] Add one production-bundled dashboard Catch Up integration fixture with multiple Epic/Story issue controls and the real owner hooks. It must traverse dashboard → direct Epic menus and dashboard → `IssueCard` → Story menus; a harness that passes `previewOnly` directly to isolated field components is insufficient. Assert that only the exact `{sessionId, stepId, fieldKind, issueKey, targetIdentity}` control receives preview mode while sibling kinds/issues retain normal behavior.
- [ ] For each field independently, assert:
  1. the exact field step resolves and spotlights its own trigger;
  2. another editing trigger cannot satisfy the current step;
  3. a normal click opens the actual options surface;
  4. the displayed field value and issue snapshot remain unchanged;
  5. the exact mutation endpoint receives zero requests;
  6. no option receives focus or invokes its selection callback in preview mode;
  7. closing the preview advances once and leaves no menu open.
- [ ] Allow the existing options-catalog request from the API matrix. Assert no status transition submit/result analytics and no priority/track update result analytics.
- [ ] For each of the three fields, cover options `{success, empty, 403/500, 401}`. Success/empty can advance only after close; 403/500 shows the labelled error then restores fallback **Next**; 401 exercises the global auth lock and complete preview cleanup. Assert zero mutation requests in every cell.
- [ ] Inspect the analytics sink on cold opens: assert the exact existing field options-open event name and typed low-cardinality params, no issue key/raw option content, zero `*_change_submit`/`*_change_result`, and zero new onboarding step event. Cover cached repeat opens where the existing hook may legitimately emit no second Priority/Status options-open event.
- [ ] Extend the Group Board view/panel suites to prove `previewOnly=false` retains normal first-option focus, Escape-to-trigger, capture-phase outside dismissal, and portalled/drop-menu behavior after the shared menu change.
- [ ] Add a terminal-step test proving Status preview advances to `complete`, the tour remains open, and only explicit **Finish** invokes persistence once.
- [ ] Run the onboarding suite plus the existing shared transition suites to detect cross-component regressions:

```bash
npx playwright test tests/ui/onboarding_tour.spec.js tests/ui/eng_priority_transitions.spec.js tests/ui/eng_project_track_transitions.spec.js tests/ui/eng_status_transitions.spec.js tests/ui/eng_group_board_panel.spec.js tests/ui/eng_group_board_view.spec.js
```

Expected: pass; zero field mutations from the tour.

## Task 8 — Add accurate operational guidance without overloading the popup tour

**Files:** create `docs/features/eng-workflows.md`; modify `docs/features/onboarding.md`, `docs/features/personal-group-star.md`, `docs/features/statistics.md`, `docs/features/README.md`, `docs/README_ANALYTICS.md`, analytics tests; conditionally update the already-modified `docs/plans/README.md` only after user confirmation.

- [ ] Write `eng-workflows.md` in English with these verified sections:
  - **Choose or add a Department:** split the journey explicitly. With zero through three Departments there is no search; at four or more it appears. If an eligible existing Department matches, select it and Continue without opening configuration. **Add Department** is always available and offers a clean draft or source-explicit duplicate. Duplicates copy the full Department and preserve teams/team-label mappings/components by default; the two cleanup choices affect only those named collections. A new/duplicate, or an explicit **Configure and use {Department}** repair, becomes the pending favorite and visible Department; finish with **Save and continue** and do not return to the picker.
  - **Configure the Department:** document the single left-list inline name field, at least one required Team, optional Components with **Continue without components**, the favorite star meaning, and **Show in Department selector**. Explain that Component is a Jira issue field, use the contextual Epic-level hint, and state the actual Missing Information/Lead Times-only effect. Document that **Run onboarding again** lives in the Settings header and is unavailable while Settings has unsaved/saving work.
  - **Make expected Epics and Stories visible:** at least one configured team is required for first-run eligibility. Separate three shipped discovery paths: (1) in the main hierarchy, an in-selected-sprint Story whose Jira Team matches a configured Department team brings its parent Epic; (2) Epic-only/empty discovery requires Epic Team **or** the configured mapped-team label, plus Epic Sprint **or** the selected-sprint-name label; (3) future **sprint ready** requires both the mapped team label and selected-sprint-name label. Explain that Jira Components broaden only Missing Information/Lead Times through configured-team **or** Component matching and never make Stories appear in the main Product/Tech list. Troubleshooting order: confirm active Department and sprint, clear search/facets/Product-Tech display filters, verify Story Team/sprint, verify Epic Team or exact team-label mapping plus sprint/sprint-name label, save configuration, then Refresh.
  - **Planning:** capacity comes from the configured capacity project when enabled; individual Story checkboxes and the `Accepted`, `To Do`, `Postponed`, `Awaiting Val.`, and `Select All` action-bar buttons change only the planning selection and recalculate selected count/SP and team allocation. Distinguish those controls from the per-issue Status pill, which performs a permission-gated Jira workflow transition. Selected SP vs Team Cap is the calculator signal, including over/under capacity; describe the capacity table/bar using its actual labels.
  - **Board (Kanban):** Epics are grouped into configured columns; opening an Epic shows Stories and status progress; the Board's own facet filters refine Epics; dragging an Epic between columns changes its Jira status when permitted; column stars are session-only. Settings → Departments → Boards maps Jira statuses to columns and supports column reorder/name/color/min/max/default-star. Qualify permissions and loaded-status prerequisites, and document the unconfigured one-column fallback.
  - **Filters and search:** in Catch Up/Planning, search matches key/summary across Initiative/Epic/Story and assignee on Epic/Story; priority, status, and Product/Tech filters recalculate that visible scope. Board search is a separate Epic-only predicate over Epic key, summary, assignee, and Delivery Owner, combined with Board facet filters. Do not claim Initiative-assignee support or one global search predicate.
  - **Continue in Jira:** the blue Jira control opens the scoped issue set in Jira, where Jira provides bulk operations; the app does not perform an in-app bulk mutation.
- [ ] Use generic examples. Do not copy any meeting-specific Department/team/component names or claim a confirmation checkmark; ordinary Settings saves through **Save**, first-run configuration through **Save and continue**, and the confirmation dialog is only for discarding changes.
- [ ] Keep `onboarding.md` focused on the four phases—existing selection or **Add Department**, guided real-Settings configuration, verified save, and a dashboard tour only when it is still incomplete—and link to the operational guide instead of appending a second full manual. Document the shared/private save boundary and preference-only retry without exposing implementation jargon to end users. State that the configuration guide and dashboard tour never run together and that completed users are not auto-replayed.
- [ ] Update `personal-group-star.md` so direct picker selection remains explicit, while create/duplicate and **Configure and use {Department}** intentionally assign the edited Department as the pending private favorite/visible group before Save. Preserve exactly one private favorite, pre-commit Cancel versus post-commit recovery, no premature request, and the existing shared/private ownership boundary.
- [ ] Update `statistics.md` with an accurate Mono vs Cross explanation and map meeting terms to current UI names (`Burndown`, Lead Times/cohort heatmap, Excluded Capacity, Project Track/assignee views). Correct the stale `Burnout` heading to the shipped `Burndown` label. Do not claim per-task hover details where the current chart does not provide them.
- [ ] Update the feature index and analytics impact text. Add guards that target activation creates no new onboarding event contract and docs name the existing safe options-open behavior.
- [ ] After obtaining confirmation to overlap the user-owned `docs/plans/README.md` edit, update the existing plan entry to name the first-run chooser, create/duplicate/repair guide, cross-domain save/recovery contract, and interactive field previews. If confirmation is not granted, leave the file byte-for-byte untouched and report the stale index entry as a completion gate.
- [ ] Run:

```bash
node --test tests/test_onboarding_analytics.js tests/test_analytics_source_guards.js
rg -n "Choose or add a Department|Configure the Department|Make expected Epics and Stories visible|Save and continue|Planning|Board \(Kanban\)|Filters and search|Continue in Jira|Priority|Delivery Owner" docs/features/eng-workflows.md
rg -n "Burndown|Lead Times|Excluded Capacity|Mono vs Cross|Project Track|assignee" docs/features/statistics.md
```

Expected: analytics tests pass and the operational guide uses all verified shipped sections/terms. Manually inspect the docs diff to confirm that it contains only generic examples and no meeting-specific or production identifiers.

## Task 9 — Build, run final verification, and inspect the UX again

**Files:** all in-scope source, tests, docs, and generated output.

- [ ] Before any final `npm ci`/build, stop and obtain explicit user authorization to create a temporary fresh verification worktree and to use a concrete implementation commit/ref. This gate reconciles the repository rules that implementation stays in the active checkout while frontend dependency installation/build verification must occur in a fresh worktree. If authorization or a reviewable ref is unavailable, mark Task 9 blocked and do not call Node 22/current-checkout evidence final.

- [ ] After authorization and creation of a concrete source implementation commit/ref, capture the active checkout/ref, create the fresh detached verification worktree, initialize the host's configured Node manager there, and install exactly the lockfile. Do not leave a literal placeholder in an executed command:

```bash
onboarding_active_checkout="$(pwd -P)"
onboarding_source_ref="$(git rev-parse HEAD)"
onboarding_verify_parent="$(mktemp -d)"
onboarding_verify_tree="$onboarding_verify_parent/jira-planning"
test -n "$onboarding_source_ref"
git worktree add --detach "$onboarding_verify_tree" "$onboarding_source_ref"
cd "$onboarding_verify_tree"
nvm use
node --version
npm ci
```

Expected: the worktree resolves the exact reviewed source ref; Node is `v20.x`; `npm ci` exits 0 and uses `package-lock.json` without changing it. Every following Task 9 test/build command runs with `workdir="$onboarding_verify_tree"` (or after an explicit `cd` there). Never implement source changes in the verification worktree.

- [ ] Run the complete frontend unit set under Node 20:

```bash
npm run test:frontend:unit
```

Expected: pass.

- [ ] Run focused browser regression:

```bash
npx playwright test tests/ui/onboarding_tour.spec.js tests/ui/eng_priority_transitions.spec.js tests/ui/eng_project_track_transitions.spec.js tests/ui/eng_status_transitions.spec.js tests/ui/eng_group_board_panel.spec.js tests/ui/eng_group_board_view.spec.js tests/ui/shared_department_groups.spec.js tests/ui/settings_unified_save.spec.js tests/ui/global_auth_lock.spec.js
```

Expected: pass.

- [ ] Make the onboarding Playwright cases disable/wait out animations and write settled screenshots under `test-results/onboarding-tour-qa/` with these exact names:
  - desktop two-Department picker with no search and persistent **Add Department**;
  - desktop four-Department picker with search;
  - desktop create/duplicate choice;
  - desktop duplicate cleanup with both checkboxes unchecked;
  - desktop guide on the single left-list name field;
  - compact/mobile guide with the Groups drawer and same name field;
  - desktop favorite and **Show in Department selector** education;
  - desktop Settings non-Team-Groups tab with header replay action;
  - compact Settings header with title, dirty state, and replay geometry;
  - desktop Priority preview open;
  - desktop partial hierarchy absence;
  - desktop all-hierarchy aggregate fallback;
  - narrow/mobile interactive target and fallback card;
  - terminal `complete` step.

Use `first-run-two-groups-desktop.png`, `first-run-four-groups-desktop.png`, `first-run-add-choice-desktop.png`, `first-run-duplicate-defaults-desktop.png`, `first-run-guide-name-desktop.png`, `first-run-guide-name-mobile.png`, `first-run-preferences-desktop.png`, `settings-replay-header-desktop.png`, `settings-replay-header-mobile.png`, `priority-preview-desktop.png`, `hierarchy-partial-desktop.png`, `hierarchy-all-absent-desktop.png`, `interactive-mobile.png`, `fallback-mobile.png`, and `complete-desktop.png`. The focused Playwright run must assert that each file was produced before visual inspection.

Inspect, not merely generate, each image. For first-run screens check search threshold, **Add Department** persistence, choice hierarchy, unchecked cleanup defaults, single-name-field clarity, guide/target overlap, star visibility, helper copy, replay placement, footer visibility, compact overflow, and whether configuration looks optional for eligible existing-group users. For the tour check coachmark/menu overlap, clipped copy, spotlight alignment, dimming continuity, sticky-layer bleed-through, accidental active controls, and target/card viewport containment.

- [ ] On the source ref in the verification worktree, build twice and compare generated hashes, then copy exactly the five generated artifacts to the active checkout for review:

```bash
onboarding_hash_a="$(mktemp)"
onboarding_hash_b="$(mktemp)"
npm run build
shasum frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css frontend/dist/auth-focus-refresh.js frontend/dist/auth-focus-refresh.js.map > "$onboarding_hash_a"
npm run build
shasum frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css frontend/dist/auth-focus-refresh.js frontend/dist/auth-focus-refresh.js.map > "$onboarding_hash_b"
diff -u "$onboarding_hash_a" "$onboarding_hash_b"
cp frontend/dist/dashboard.js "$onboarding_active_checkout/frontend/dist/dashboard.js"
cp frontend/dist/dashboard.js.map "$onboarding_active_checkout/frontend/dist/dashboard.js.map"
cp frontend/dist/dashboard.css "$onboarding_active_checkout/frontend/dist/dashboard.css"
cp frontend/dist/auth-focus-refresh.js "$onboarding_active_checkout/frontend/dist/auth-focus-refresh.js"
cp frontend/dist/auth-focus-refresh.js.map "$onboarding_active_checkout/frontend/dist/auth-focus-refresh.js.map"
```

Expected: both builds pass, the two hash sets are identical, and only generated artifacts are copied back. Review those diffs in the active checkout. Obtain any required authority to create the final implementation ref containing reviewed source plus generated output; do not proceed on an uncommitted or different ref.

- [ ] Repoint the verification worktree to that validated final ref without a hard reset, reinstall/build there, and run the CI-equivalent clean-dist assertion before treating later tests as final:

```bash
onboarding_final_ref="$(git -C "$onboarding_active_checkout" rev-parse HEAD)"
test "$onboarding_final_ref" != "$onboarding_source_ref"
git -C "$onboarding_verify_tree" restore --source="$onboarding_final_ref" -- package-lock.json frontend/dist
git -C "$onboarding_verify_tree" checkout --detach "$onboarding_final_ref"
cd "$onboarding_verify_tree"
nvm use
node --version
npm ci
npm run build
git diff --exit-code -- package-lock.json frontend/dist
npm run test:frontend:unit
npx playwright test tests/ui/onboarding_tour.spec.js tests/ui/eng_priority_transitions.spec.js tests/ui/eng_project_track_transitions.spec.js tests/ui/eng_status_transitions.spec.js tests/ui/eng_group_board_panel.spec.js tests/ui/eng_group_board_view.spec.js tests/ui/shared_department_groups.spec.js tests/ui/settings_unified_save.spec.js tests/ui/global_auth_lock.spec.js
```

Expected: Node is `v20.x`, the worktree is on the exact final ref, build exits 0, the lockfile/generated tree remains byte-clean, and final-ref unit/focused browser tests pass. Assert the named screenshot files were regenerated by this final-ref run and re-inspect them; source-ref results are iteration evidence only.

- [ ] Run final source/analytics/whitespace/status checks:

```bash
python3 -m unittest tests.test_shared_group_config_routes tests.test_endpoint_security_matrix
node --test tests/test_first_run_group_configuration.js tests/test_group_visibility_utils.js tests/test_epm_settings_source_guards.js tests/test_onboarding_analytics.js tests/test_analytics_source_guards.js tests/test_frontend_api_source_guards.js
git diff --check
git status --short
git diff -- frontend/src/settings/FirstRunGroupSelectionModal.jsx frontend/src/settings/FirstRunGroupSetupChoice.jsx frontend/src/settings/FirstRunGroupConfigurationGuide.jsx frontend/src/settings/firstRunGroupConfiguration.js frontend/src/settings/SettingsModal.jsx frontend/src/settings/TeamGroupsSettings.jsx frontend/src/settings/useGroupVisibilityPreferences.js frontend/src/onboarding frontend/src/dashboard.jsx frontend/src/issues/IssueCard.jsx frontend/src/issues/IssueFieldOptionMenu.jsx frontend/src/issues/PriorityTransitionMenu.jsx frontend/src/issues/ProjectTrackTransitionMenu.jsx frontend/src/issues/StatusTransitionMenu.jsx frontend/src/styles/settings/first-run.css frontend/src/styles/settings/group-editor.css frontend/src/styles/settings/team-groups.css frontend/src/styles/settings/team-selector.css frontend/src/styles/settings/onboarding-tour.css tests/test_first_run_group_configuration.js tests/test_group_visibility_utils.js tests/test_epm_settings_source_guards.js tests/test_onboarding_tour_utils.js tests/test_onboarding_tour_interaction.js tests/test_eng_task_utils.js tests/test_onboarding_analytics.js tests/test_analytics_events.js tests/test_analytics_source_guards.js tests/ui/shared_department_groups.spec.js tests/ui/settings_unified_save.spec.js tests/ui/global_auth_lock.spec.js tests/ui/onboarding_tour.spec.js tests/ui/eng_group_board_panel.spec.js tests/ui/eng_group_board_view.spec.js docs/features docs/README_ANALYTICS.md docs/plans/README.md frontend/dist
```

Expected: pass; every changed line maps to this plan; no backend/persistence/auth/personal-star drift; no unrelated pre-existing edit is staged or rewritten.

- [ ] Run the full configured suites before claiming implementation complete and again before any later push:

```bash
python3 -m unittest discover -s tests
npm run test:frontend:unit
npm run test:frontend:ui
git log --oneline -5
```

Expected: every suite exits 0. Show the full-suite and screenshot evidence, then wait for explicit user confirmation before push.

## Acceptance criteria

- Eligible existing-Department users select and Continue from the mandatory picker without opening Settings or writing shared configuration. Search is absent for zero through three Departments and present for four or more. **Add Department** remains visible in every picker/search state; empty search does not create a separate query-seeded path. A selected row hidden by filtering remains named/clearable in the footer.
- **Add Department** offers clean create or source-explicit duplicate. Duplicate cleanup defaults preserve teams, dependent team labels, and components; cleanup affects only the chosen collections. A new/duplicated draft, or an explicitly chosen **Configure and use {Department}** repair, becomes the pending private favorite and visible Department without a request.
- The guide uses the real Team Groups controls in the order name, teams, components, favorite, visibility. Name and one team are required; Components is optional through explicit **Continue without components**. It is isolated from `onboarding_done` and never overlaps the dashboard tour.
- The active left-list Department name is the only editable name input on desktop and compact layouts; the right pane is a read-only mirror. Enter accepts, Escape restores the edit-start value, and the mobile guide opens the Groups drawer instead of creating a second input.
- During first-run, pending favorite/visibility are explained through focusable locked status blocks, not no-op controls. In ordinary Settings, the favorite star is an accessible noticeable pressed button; **Show in Department selector** has persistent helper text and is checked+disabled for the favorite. **Run onboarding again** is a Settings-header action across tabs and is disabled during dirty/save state.
- Picker/Save copy promises a skippable dashboard tour only when `onboardingDone=false`; already-complete users see **Next: dashboard**, and no implicit replay starts.
- Unified admin/group and EPM work completes before the private preference save. Zero-commit failure returns to editing; partial-section failure enters explicit `sections_pending`; private failure enters `preference_pending`. Retries repeat only unsaved work and no completed POST/GET/refresh/analytics. Pre-commit Cancel restores captured drafts; post-commit Return keeps normalized server baselines and restores only unsaved state. 401, 409, stale/invalid snapshots, duplicate clicks, retry/return, and compact layout are covered. No payload crosses the shared/private ownership boundary or changes `defaultGroupId`.
- Priority, Project Track, and Status each appear as a separate field-type step and each requires interaction with its exact highlighted native trigger when eligible. The tour documents where each type applies and uses a deterministic Epic-first example without expanding Subtasks.
- A target interaction opens its real menu in explicit read-only preview mode without allowing an option selection or sending a Jira field-mutation request. The labelled menu root receives focus and offers Arrow/Home/End inspection through `aria-activedescendant`; closing a ready/empty preview advances exactly one step and the popup **Next** is absent for that eligible step. Closing while loading stays on the step; load failure restores fallback **Next**.
- If an editing target is missing, disabled, removed, replaced, or unresolved after loading settles, the same step becomes a centered field-specific fallback and manual **Next** is available.
- Initiative, Epic, and Story are three ordered, spotlight-only phases whenever hierarchy data exists. All eight presence combinations are deterministic and finishable; the all-absent state compacts to one explicit hierarchy explanation, and no hierarchy container click advances or triggers a nested action.
- Current and future targets stay discoverable despite tour-owned suppression; pre-existing hidden/inert state still disqualifies them.
- Normal pointer clicks, Enter/Space, Arrow/Home/End, Tab/Shift+Tab, Escape, Back, section skip, tour Skip, target replacement, re-render, remount, unmount, duplicate clicks, loading/error/empty preview states, wheel/touch/viewport changes, exact hit-test boundaries, and coarse-pointer target sizing are covered. No Playwright force-click is used to prove reachability.
- Manual/fallback steps preserve the existing modal root-inert contract. Closed interactive steps expose only the exact target and tour card; open preview states additionally expose only the matched read-only menu. Unrelated body portals are suppressed and restored. Interactive states omit modal semantics, block every other application interaction, and restore exact prior DOM/focus/scroll state.
- A terminal centered step owns explicit **Finish**. No target click completes or persists the tour.
- Catch Up/Planning search copy says key/summary across Initiative/Epic/Story and assignee on Epic/Story; it does not promise Initiative-assignee search. Board guidance separately limits Board search to Epic key, summary, assignee, and Delivery Owner.
- Detailed English operational guidance covers direct versus configured onboarding, the exact team/sprint/Epic-label conditions for expected Epic/Story visibility, the Missing Information/Lead Times-only Component scope, Planning, Board, Statistics, filters/search, and Jira bulk-work handoff using current UI terms and generic examples.
- Existing onboarding persistence and analytics outcome schemas remain unchanged. Existing safe field-options-open events may occur; no field submit/result or new onboarding step event is emitted.
- `frontend/dist/dashboard.js`, `frontend/dist/auth-focus-refresh.js`, their maps, and `frontend/dist/dashboard.css` are reproducibly generated from source in the authorized fresh Node 20 verification worktree.

## Residual risks after implementation

- Shared Department configuration and private first-run preference persistence remain two transactions by design. The UI must retain the committed shared baseline and a retryable pending private selection so a partial failure cannot duplicate the group write or strand the user behind a disabled footer.
- A user-edited duplicate name can still collide or violate current validation after the collision-free default is generated. Existing id/name normalization and validation remain authoritative; the name step stays required/editable and no request is sent until it is valid.
- The catalog contains 14 maximum steps, grouped into four named sections with section skip on hierarchy/field previews; all-absent hierarchy/editing groups compact to one summary each. The first-run surfaces must visibly state that this skippable dashboard tour comes next. Keep popup copy short and do not add the operational guide as more popup steps without a separate usability decision.
- Selective inert/ARIA restoration is browser-sensitive. Exact restoration, focus, `elementFromPoint`, and normal-click tests are release gates, not optional polish.
- Initiative-assignee search remains unsupported until a separate backend/performance plan defines how Initiative assignee data is fetched without unsafe initial-load fan-out.
- Actual Jira option catalogs and permissions vary. Missing/pre-disabled controls use honest fallbacks; an empty catalog remains a labelled read-only preview; 403/500 errors return to fallback after inspection; 401 enters the existing global auth lock. Never claim editing is universally available.
