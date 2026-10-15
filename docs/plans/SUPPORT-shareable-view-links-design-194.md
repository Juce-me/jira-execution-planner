# Shareable View Links Design

> **Status:** Proposed design, validated and tightened on 2026-10-14 by four independent adversarial reviews (security and privacy, frontend state machine, schema and encoding, repo rules and verification) against `origin/main` `bd5b2bc2`, then refined while the plan was drafted and replayed end to end. `origin/main` has since moved to `4247a3b1` (PR #269, the design-system hover contract; PR #275, the Board card layout; PR #276, removal of the release update notice; PR #278, the people-editor search) and was merged into the branch; the line anchors below are for `bd5b2bc2` and the execution plan carries the re-verified ones. Reviewed by the operator on 2026-10-15: the default decisions and gate G1 are accepted (see "Open items for the operator"). This is not an implementation plan; the execution plan is `EXEC-shareable-view-links-194.md`. The first version of this document (commit `63e898f3`) had defects the review found; section "Validation record" lists them and where each is resolved.

| Field | Value |
| --- | --- |
| Issue | [#194 — Create shareable links to the current view](https://github.com/Juce-me/jira-execution-planner/issues/194) |
| Surface | ENG → Catch Up, Planning, Board, Statistics; app header (both surfaces); OAuth login return |
| Server surface | Two existing flows only: the unauthenticated dashboard entry redirect, and the OAuth callback, `/login` and logout redirects. No new route, no new `EndpointPolicy`. |
| Configuration owner | None new. Links reference existing shared Department groups, Sprint catalog and Team catalog. |
| Personal state owner | Existing browser prefs and per-scope selections; a link replaces them through the same writers a click uses |
| Jira writes | None. A link only selects and reveals. |
| Supersedes | The "Shareable View Links" section of [`FUTURE-db-additional-features.md`](FUTURE-db-additional-features.md) for v1. The stored-token variant stays deferred there. |

## Goal

A signed-in user presses one Share control and gets a plain URL to paste into chat. Another user in the same resolved workspace and site who opens it, signing in first if needed, lands in the same ENG view for the link's mode: group, sprint, Teams, filters, search, and an opened alerts category scrolled to a Team, or an exact Epic or Story. Everything the recipient sees is fetched with the recipient's own Jira OAuth token and catalogs. A link carries selectors, not access.

## Decisions (operator-approved 2026-10-13)

| Decision | Choice | Rejected alternative |
| --- | --- | --- |
| Link carrier | Self-contained URL at `/`; no server-stored state | Stored opaque token (`shared_view_links`, `/share/v/<token>`): table, migration, three endpoints, policy and CSRF matrix tests, DB mode only, and a path route that breaks the relative asset URLs in `jira-dashboard.html` |
| Link form | Readable query params, produced by a header Share button | Opaque base64 blob; live address-bar URL (view state in every GA4 `page_location`); short links (need storage) |
| v1 scope | Catch Up, Planning, Board, Statistics | Catch Up only. EPM and Scenario are out of v1. |
| Apply mode | Replace like normal navigation: the link drives the same writers a click uses and persists the same way | Temporary overlay that suppresses persistence |
| Focus target | One Share control; focus is the topmost visible alerts team group, Epic or Story at click time | Per-target Copy link controls |
| Recipient mismatch | Apply what resolves and show one notice; if the group or sprint does not resolve, apply nothing else | Auto-granting a group the recipient has not made visible |

### Adjustments found in validation (evidence in "Evidence")

These keep every decision above and change how it is implemented. Items 1 and 2 narrow what the operator saw, so they are listed for explicit confirmation under "Open items".

| # | Adjustment | Why |
| --- | --- | --- |
| 1 | The Share control is one component rendered on both header surfaces: the main header and the compact sticky header | The compact header appears only after the main header has fully scrolled away (`compactStickyVisible = rect.bottom <= 0`), and the main header holds the only candidate placement, so click-time capture from the main header can only ever see the top of the page |
| 2 | Board has no focus target in v1; Board facets, Stats display options and assignee filters are not carried | The Board Epic panel is a modal whose backdrop (`z-index: 9000`) closes it on mousedown, so Share cannot be clicked while it is open, and `openEpicKey` clears itself until Board data arrives |
| 3 | Apply is a staged machine gated on readiness, not one ordered batch | A group or sprint change runs `applyGroupState`, which resets filters, Teams, mode flags, Board and Stats state and alert flags from the recipient's saved prefs, so anything set in the same batch is overwritten |
| 4 | An omitted key means its default constant, never the recipient's value; `group` and `sprint` are always written | Every ENG field seeds from the recipient's prefs, so omission would keep their value and the views would differ |
| 5 | The search key is `find`, not `q`; the container access log stops recording query strings and Referer | Search text never leaves the browser today; `q` is a GA4 site-search default key |
| 6 | `teams=all` only when the sender's selection contains `all`; otherwise explicit ids | An explicit list excludes stories whose Team is not in it, `['all']` admits them |
| 7 | `alerts` carries the expanded categories; `alertTeam` is `<anchor>:<id>` | Ten independent expand flags exist; anchors repeat across cards and inside `followup`; ids can be names |
| 8 | The ENG task-load effect holds while a link is pending | Otherwise a recipient whose saved scope differs pays a full second load |
| 9 | The login stash is consumed at three exits and cleared on logout and authenticated entry | The callback is not the only post-login exit |
| 10 | Board scope token is `all_work` | The code value |

### Refinements found while drafting the plan (2026-10-14)

Each was measured in a replayed scratch copy while the execution plan was drafted. None changes a decision above; each changes how it is implemented.

| # | Refinement | Evidence |
| --- | --- | --- |
| 1 | The hold releases one commit after Stage B, not Stage A | Released at Stage A, a source-only Statistics link or a strict Board link still triggers a Catch Up task load, because the saved mode flags are still in place |
| 2 | The Planning rows seed is written at the first Stage C run and the table is keyed | The first ENG load unmounts the table, which discarded a seed written at Stage B |
| 3 | A Stage A timeout drops the link; the overall budget ends `partial` when stages ran | Nothing is meaningful without the scope; applied stages are kept, so `dropped` would misreport |
| 4 | The compact Share control is a flex sibling after Search; the notice renders inside the button | A child shrinks Search; an in-flow notice is out of view when the compact header is active |
| 5 | The reveal lands at `T + 12` with the same margin in capture; its `T` omits Epic headers; `revealIfHidden` is not reused; no highlight CSS is added | A capture after a reveal returned the previous sibling; counting the Epic's own header landed it 36 px low; `revealIfHidden` left an Epic block under the sticky bar |
| 6 | The access-log path is rendered with `%(U)r` | gunicorn's `%(U)s` is percent-decoded, so a `%0A` path forged a second log line |
| 7 | `stats=cohort` always writes `from` and `to` | Its default (the current quarter) changes with the clock |
| 8 | The apply result maps `done`, `partial`, `dropped`, `cancelled` to the event results `success`, `partial`, `rejected`, `rejected` | One analytics vocabulary |
| 9 | The read allowlist includes `POST /api/auth/refresh`; the lint command is `fnm exec --using 20 bash scripts/extraction_lint/run.sh` | Every load sends the refresh; the script is not executable |

## Non-goals

- Server-side storage, revocation, expiry, short links, or "save a copy" (the FUTURE token plan).
- EPM and Scenario links. EPM needs the recipient's own Home token and saved private scope; Scenario content is shared realtime draft state. A link whose mode is unavailable falls back to Catch Up.
- Planning row selection, Planning review drafts and dirty state, issue-edit holds, Settings state, dependency focus, alert dismissals, raw scroll offsets, onboarding state, personal group visibility and favorites, Board facets and focus, Stats display options, and any assignee identity.
- Workspace membership or ACLs. Access stays gated by the resolved workspace and site plus the recipient's own Jira authorization (`docs/plans/AGENTS.md`).
- Changing the reauth recovery path (`AuthRequiredGate`, `authRecoveryCoordinator`, `sanitizeLoginUrl`) or its source guards.
- Fixing the pre-existing unvalidated Sprint and Team interpolation into task-fetch JQL. A link never reaches it because every value is resolved against the recipient's own sets first.

## Link contract

Plain query params at `/`. `v`, `mode`, `group` and `sprint` are always written; every other key is written only when it differs from its default, except the cohort range (`from`, `to`), which is always written for `stats=cohort`. Example:

`/?v=1&mode=catch-up&group=<group-id>&sprint=<sprint-id>&teams=<team-id>,<team-id>&status=only:In%20Progress&alerts=blocked&alertTeam=blocked:<team-id>`

| Key | Values | Applies to | Default | Resolution and caps |
| --- | --- | --- | --- | --- |
| `v` | `1`; an integer above 1 means "newer app" | all | none | Must be the first pair; `^[1-9][0-9]{0,2}$` |
| `mode` | `catch-up`, `planning`, `board`, `statistics` | all | `catch-up` | Sets `selectedView='eng'` and the four mode booleans (`showScenario` false). `scenario`, `epm` and unknown values are invalid: apply `catch-up` and report `mode`. The resolver checks Planning (sprint not closed) against the link's own sprint (`availableSprints[].state`, mirrored by `EngModeControl`); Statistics and Board are available for every Sprint state. An unavailable mode is reported instead of relying on later silent coercion effects |
| `group` | Group id, atom ≤255 | all | none | Exact, case-sensitive match in the recipient's `visibleControlGroups`; the decoder never folds case |
| `sprint` | `^[1-9][0-9]{0,11}$` | all | none | Must be in the validated Sprint catalog; the catalog entry's own `id` value and name are stored (downstream compares with `===`). Also written for Board links, because it keys the Team and Planning scopes |
| `scope` | `component`, `all_work` | board | `''` | Applied only when `engSprintSelectorState.componentReadiness` or `allWorkReadiness` is `'ready'` for the link's group (`dashboard.jsx:2447-2467`); otherwise reported |
| `teams` | `all`, or up to 12 Team ids | catch-up, planning, statistics views `teams`, `priority`, `burnout`, `cohort` | `['all']` | `all` only when the sender's `selectedTeams` contains `all`. The resolver dedupes, intersects with the link group's `teamIds` (a group holds at most 12, `GROUPS_MAX_TEAMS`), reports `teams` when any id is dropped, and skips the key rather than applying the widened `['all']` that `sanitizeSelectedTeamsForScope` returns on no match. Not relevant to Board (the Board must not use the private Team selection) or to the source-only Stats views `excludedCapacity`, `monoCrossShare`, `projectTrack` (`dashboard.jsx:914`) |
| `find` | Search text, ≤100 code points after trim | catch-up, planning, board | `''` | No C0, C1, bidi or U+2028/2029 characters. Sets both `searchQuery` and `searchInput`. Empty value resets. The key is never `q`, `s`, `search`, `query` or `keyword` |
| `status` | `all`, `only:<a>,<b>`, `hide:<a>,<b>` | catch-up, planning | `{hidden:['Killed']}` (`DEFAULT_ENG_STATUS_FILTER`) | `all` is the neutral `null`; `hide:` is the stored `{hidden}`. ≤20 atoms of ≤100 chars. Each atom is matched case-insensitively (trim, lowercase) against the facet option ids current at Stage C and stored as the option's canonical id; unmatched atoms are dropped; a key left with no atom is skipped and reported as `filters` |
| `priority` | same shapes | catch-up, planning | `null` | Ids only from the six canonical labels: Blocker, Critical, Major, Minor, Low, Trivial |
| `track` | `all` (`undefined`), `none` (`[]`, No Project Track only), or a comma list of Project Track option ids | catch-up, planning | `undefined` | The shape mirrors `engProjectTrackFilter`, which is not `{only}/{hidden}`; exact ids are pinned in the plan from `engCatchUpFilters.js` |
| `lanes` | `product`, `tech`, `product,tech` | catch-up, planning | both on | Non-empty subset of `showProduct` and `showTech` |
| `initiatives` | `0`, `1` | catch-up, planning list | `null` (data-driven) | Explicit off or on; absent means `null` |
| `sort` | `priority`, `status`, `track-committed`, `track-flexible` | catch-up, planning list | `priority` | Closed enum |
| `layout` | `list`, `table` | planning | `table` | |
| `rows` | `epics`, `stories` | planning table | `epics` | Maps to the table's `'epic'` and `'story'` |
| `stats` | `teams`, `priority`, `burnout`, `cohort`, `excludedCapacity`, `monoCrossShare`, `projectTrack` | statistics | `teams` | Closed enum |
| `from`, `to` | Quarter `^[0-9]{4}Q[1-4]$` for `cohort`; Sprint ids for `excludedCapacity`, `monoCrossShare`, `projectTrack`; none for `teams`, `priority`, `burnout` | statistics | current quarter; `buildDefaultExcludedCapacityRange` | Both or neither; `from <= to`; quarters inside the 16-quarter window; Sprint ids in the catalog; `projectTrack` also writes the range the header Sprint selector would write. For `stats=cohort` both keys are always written, because the default (the current quarter) changes with the clock and a link must not depend on it |
| `alerts` | `off`, `none`, or a comma list of expanded category keys | catch-up | panel shown, all ten expanded | Keys: `missing`, `blocked`, `followup`, `backlog`, `missingTeam`, `missingLabels`, `needsStories`, `waiting`, `empty`, `done`. `off` hides the panel, `none` collapses all. The encoder lists only categories that rendered for the sender |
| `alertTeam` | `<anchor>:<id>`; anchor is a category key or `followupEpics` | catch-up | none | Resolved by dataset equality over rendered groups. The id is emitted only when it is a real Team id or the placeholders `unknown` or `Unknown Team`, never a name fallback. Requires `alerts` not `off` |
| `epic`, `story` | `^[A-Z][A-Z0-9_]{1,63}-[0-9]{1,10}$` | catch-up, planning | none | At most one focus target per link (`alertTeam`, `epic` or `story`). Resolved by class-scoped selector plus dataset equality on a mounted node. `story` resolves only in `rows=stories`, `epic` only in `rows=epics`; the view never auto-switches |

Keys per mode: Catch Up has `teams find status priority track lanes initiatives sort alerts alertTeam` and `epic|story`. Planning has `teams find status priority track lanes layout` plus `rows` (table), `initiatives sort` (list) and `epic|story`. Board has `scope find`. Statistics has `stats from to` and `teams` for the four task-loading views. Keys outside a mode's column are neither encoded nor applied.

### Semantics

Apply is a full replacement for the link's mode. For every key whose "Applies to" includes the mode, an absent key resets to its default constant; keys not relevant to the mode are not touched. Defaults are the constants above, kept once in `shareView/viewDefaults.js` and used by both the encoder and the apply; they are never either user's saved preferences. A recipient's own graph mode, metrics, alert expand flags (outside Catch Up) and other fields outside the mode stay theirs, and acceptance criterion 1 says so.

### Encoding

1. The query is `?` followed by pairs joined by raw `&`. A pair is `key=value`. Keys are exact, case-sensitive and never encoded. `v=1` is the first pair.
2. An atom (group, Team and status ids, `find`) is `encodeURIComponent(s)` with `!'()*` also encoded as `%21 %27 %28 %29 %2A`. The alphabet is `[A-Za-z0-9._~-]` plus uppercase `%XX`; space is `%20`, never `+`. A lone surrogate throws `URIError`; the encoder catches it and omits the key.
3. Separators are raw and never occur inside an atom: `&` between pairs, `,` between list atoms, and the first `:` after `only` or `hide` or after an `alertTeam` anchor. Tokens and numbers (mode, scope, sprint, stats, from, to, sort, layout, rows, lanes, initiatives, alert tokens, issue keys) are matched raw and never percent-decoded.
4. Decode never uses `URLSearchParams` (it decodes `%2C` and a literal `,` identically and turns `+` into a space). Steps: take `location.search` minus one `?`; reject the whole link above 1,536 characters or with any character outside `[A-Za-z0-9._~%&=,:-]`; require the first pair to be `v=`; split on `&` (`v` plus at most 40 further pairs, matching the stash pattern; skip pairs with no `=`); split each pair at the first `=` (a second raw `=` in a value drops the key); accept only `Object.hasOwn(SPEC, key)`; the first duplicate wins and later ones are ignored; split lists on raw `,` and the facet prefix on the first raw `:`; `decodeURIComponent` each atom in try/catch; an atom must match `^[A-Za-z0-9._~%-]+$` with valid `%XX`, contain no control or bidi character, trim to non-empty, stay within its cap and not equal `all` inside a `teams` list. Results go into `Map` or `Object.create(null)`.
5. `find=` is a valid empty search. Every other empty value, empty list item or `only:` with no atoms drops the key and reports its category. Unknown keys are ignored. A known key that is present but invalid is reported under its category.
6. Over the cap, the encoder drops in order `find`, the focus keys, `alerts`, `initiatives`, `sort`, names each drop in the Share notice, and never drops scope keys (`group`, `sprint`, `scope`, `teams`, the facets). If the link is still over 1,536 characters it copies nothing and says so. It never truncates.
7. If the encoded query would end in `.`, the encoder emits `%2E` (chat autolinkers strip trailing dots).

Realistic lengths (computed in review): `teams=` with 12 UUID-shaped Team ids is 449 characters, and the base link (`v`, `mode`, `group`, `sprint` and those 12 Teams) is 508, so even a link with several filters stays well under the 1,536 cap. A group holds at most 12 Teams, so no complement form is needed.

## Surviving login

A link is lost at the login hop today:

- `redirect_unauthenticated_oauth_dashboard_entry` (`jira_server.py:894-909`) redirects `/` and `/jira-dashboard.html` to `/login` or `/login?reason=session_expired`, dropping the query.
- The OAuth callback ends in `redirect('/')` (`backend/routes/auth_routes.py:437`); the two authenticated branches of `/login` also `redirect('/')` (`:102`, `:107`).
- `sanitizeLoginUrl` rejects every query key except `reason` and any hash (`frontend/src/api/authRequired.js:12-31`).
- `/login` is static HTML with no script and the CSP is `script-src 'self'` plus Google Tag Manager (`backend/security/headers.py`), so a client-side stash would need a new served JS file. That is why a `#fragment` carrier was rejected.

Design: keep the validated query in the signed Flask session cookie, which already carries the OAuth state. The logic lives in a new module `backend/auth/share_view_stash.py`; `jira_server.py` and `auth_routes.py` only call it.

1. **Write.** Only on GET, in the final unauthenticated redirect branch of `redirect_unauthenticated_oauth_dashboard_entry` (after the authenticated-return branch; Basic mode returns before it). Use the raw `request.query_string`, decoded as ASCII, checked with `re.fullmatch` (Python `$` accepts a trailing newline):
   `v=[1-9][0-9]{0,2}(?:&[A-Za-z][A-Za-z0-9]{0,15}=(?:[A-Za-z0-9_.~:,-]|%(?![01][0-9A-Fa-f]|7[Ff])[0-9A-Fa-f]{2})*){0,40}`
   with the query at most 1,536 bytes. This rejects raw and percent-encoded CR/LF, NUL, DEL, `+`, quotes, `#`, `/`, backslash, `@`, bidi and non-ASCII (33 hostile vectors tested in review). Store `{q, t}`. The helper never raises. The stash 302 carries `Cache-Control: no-store`.
2. **Cookie budget.** After the tentative write, serialize `dict(session)` with the app's signing serializer; if the value exceeds 3,300 bytes, pop the stash. Measured with Flask's real serializer: auth keys alone 835 to 862 bytes; with a 1,536-byte incompressible stash about 2.2 to 2.6 KB at the worst hop; the browser limit is about 4,093, and an oversize cookie is silently dropped, which would lose `oauth_state` and fail login with `invalid_oauth_state`.
3. **Consume.** At exactly three exits: callback success (`:437`) and the two authenticated `/login` redirects (`:102`, `:107`). Pop the stash; if it re-validates and is at most 900 seconds old, redirect to the literal `'/?' + q`, otherwise to `'/'`. The second character is `?`, so `//host` and `/\host` cannot form, and the target is never built with `urllib` (it would re-encode `,` and `:`). The clock is injectable for tests.
4. **Clear.** Logout pops it. An authenticated request to `/` or `/jira-dashboard.html` clears any stale stash. A plain or invalid unauthenticated entry does not touch it. A newer link replaces an older one. A failed callback keeps it so a retry still applies it.
5. Basic mode and the non-DB OAuth profile need no change: the first has no login hop and the second uses the same cookie session.
6. `sanitizeLoginUrl`, `AuthRequiredGate` and `window.location.assign('/')` (pinned by `tests/test_auth_isolation_source_guard.js:82`) are not modified.
7. Tests patch `jira_server.<name>` or the helper module, never `auth_routes.<name>`: `bind_server_globals` re-copies every `jira_server` global into `auth_routes` before each request and clobbers local patches. The only-`before_request` pin (`tests/test_backend_route_source_guards.py`) means the call stays inside the existing function.

Residual risk: a stash left by an abandoned link visit stays in the cookie (up to about 2.5 KB on every request) until the next login, logout, authenticated entry or browser close, and can be consumed by another sign-in in the same browser within 15 minutes, including a gate-initiated reauth in another tab. The TTL is enforced only when the stash is popped. This is accepted.

## Apply machine

New code lives in `frontend/src/shareView/`. `dashboard.jsx` keeps only the minimum wiring (see "Files").

### Entry

A side-effect module imported first in `dashboard.jsx` runs before React mounts. In a `finally` it removes the schema keys and `v` from the URL with `history.replaceState`, keeping `perf`, any other params and the hash, and never throws (`SecurityError`, decode errors). Parsing and validation run on the captured string. The result is one module-scope store: `absent`, then `pending`, then the stages below, then `done`, `partial`, `dropped` or `cancelled`. Initial `page_location` therefore carries no view state: `initAnalytics` runs in an effect gated on `authMode` (`dashboardAnalytics.js:145-150`) and Google Tag Manager is appended only after the analytics context loads (`appendGtmScript` inside `applyAnalyticsContext`, `analytics.js`).

A reload, a connection-recovery reload or a lazy-chunk reload after the URL was stripped never re-applies a link, and a reload before the apply completes drops it (the recipient reopens the link). There is no `sessionStorage` mirror.

### Readiness and hold

Apply waits until all of these hold, re-evaluated each render (refs have no notifications):

- `sharedConfigReady` (it means "settled", set in `finally`, not "ok"); `groupsLoading` false with no `groupsError` or `boardGroupsReadFailed`; `groupPreferences.onboardingRequired` false (valid only with `groupsLoading` false); `adminSettingsGate.status === 'clear'`.
- The Sprint catalog `authority === 'validated'` with a non-empty `availableSprints`. Not `sprintCatalogReady`, which needs the current `selectedSprint` to be in the catalog.
- `pendingShellAuthResumeRef.current === null` and `pendingPlanningAuthResumeRef.current === null`, evaluated only after `sharedConfigReady` (both capsules, auth and connection recovery, stage through these refs). The apply hook is declared after the restore effects. The reauth source guard is not modified.
- `homeTokenConnectionLoaded` when the recipient's saved initial view is EPM, so the one-shot EPM restore (`restoredInitialEpmViewRef`, `dashboard.jsx:1425-1437`) has fired.
- The terminal auth latch is clear.

While a link is pending or waiting, the ENG task-load effect (`dashboard.jsx:3488-3574`) returns early exactly as it does for `groupsLoading`, so no request is issued for the recipient's saved scope. The hold releases one commit after Stage B's writes have committed, or when the link reaches a terminal state, so an unresolvable link never blocks the default load. It is released after Stage B, not Stage A, because until the mode flags are written the App still carries the recipient's saved mode, and a hold released earlier would start a Catch Up task load for a link whose mode loads none (a source-only Statistics link, a strict Board link). The hold covers the ENG task load and the Planning review read (the `active` expression of `usePlanningSprintReview` gains the hold, because that hook reads the review for the recipient's saved Sprint when it mounts; measured: a link run issued review reads that the equivalent manual navigation did not). It does not cover the capacity and Statistics source loads: a source-only Statistics link fetches its own source for the link's scope and a strict Board link runs the Board pipeline once. The hold does not apply while a staged Planning recovery capsule is pending: `pendingPlanningAuthResumeRef` clears only after the ENG load, so holding the load would wait on itself.

### Stages

| Stage | Runs when | Does |
| --- | --- | --- |
| A scope | readiness holds | `setSelectedView('eng')` and `restoredInitialEpmViewRef.current = true`; `setActiveGroupId(entry.id)`; the sprint through a shared `commitSprintSelection` extracted from `applyOrdinarySprint` (`dashboard.jsx:1514-1545`): the catalog entry's `id` and name, Team carry-forward via `teamSelectionCarryForwardRef`, and the project-track range for `stats=projectTrack`. Skipped when group and sprint already equal the current scope |
| B fields | `activeGroupRef.current === activeGroupId`, `planningHydratedScopeRef.current === planningScopeKey`, `!restoringGroupRef.current`, and one commit has passed since Stage A | The four mode booleans through raw setters; then, for every key that applies to the mode, reset to the default and set the link value: `find` (both states), `lanes`, `initiatives`, `sort`, `layout`, `stats` with its range, the alert panel and ten flags (Catch Up), and `scope` once Board is committed and ready for the link's group |
| C data-dependent | the scope is loaded: `loadEpochRef` at least equal to before Stage A for a verified same-scope apply, strictly newer for a scope change, current group/Sprint still equal the resolved target, both lane loading flags false, `tasksFetched` true, `lastLoadedSprintRef` equals the sprint (`tasksFetched` is never read alone) | Teams (a scope-changing link set the carry-forward in Stage A and the hydrate effect consumes it once; a same-scope link uses the shared Team persistence helper (`persistTeamSelection`, extracted from `toggleTeamSelection`) after `teamSelectionHydratedScopeRef.current === teamSelectionScopeKey`), then status, priority and track once the facet options have recomputed. The Planning rows seed is written when Stage C begins and the Planning table element carries a `key` that changes at the same moment, because the first ENG load unmounts the table and would discard an earlier seed |
| D focus | the alert cohort settled for Catch Up (`catchUpAlertLoadRef.current === catchUpAlertScopeKey && alertCohortRef.current === null`), or the row is mounted for Planning; the connection-recovery scroll has run; the document is visible; no onboarding tour is running | Reveal (see "Focus") |

Stage A and Stage B must not be merged: a group or sprint change runs `applyGroupState` (`dashboard.jsx:2753-2815`) from effects at `2896-2930`, which resets the status, priority and track filters, the Tech and Product lanes, initiative grouping, Teams, the four mode booleans, `boardView`, Board facets, the 19 Stats group keys and the alert flags from the recipient's saved prefs. It does not reset `searchQuery`, `engEpicSort`, `planningLayout`, `boardStrictScope`, the sprint range or the Planning row mode. The planning-scope effect runs `applyGroupState` again when the group-plus-sprint scope key changes and hydration is pending. Team writers are four: the hydrate effect (`4064-4106`), the persist effect (`4108`), planning sync (`usePlanningSelectionSync`) and the `applyGroupState` and `buildDefaultGroupState` pair; the prefs persist effect (`3213-3323`) writes the global blob.

Stages use raw setters and refs only. They never call `applyEngMode`, `clearEngFilters`, `resetEngFilters`, `navigateToAlertStory` or `handleAlertStoryClick`, and re-check that the link's group and sprint are still present before each stage, because a settings save or freshness refresh can change `visibleControlGroups` mid-apply.

### Lifecycle

| Event | Result |
| --- | --- |
| `v` newer, invalid link, groups error, `adminSettingsGate` `missing`, catalog `auth_locked` or `error` or `exhausted` with no validated snapshot, no visible groups, group or sprint unresolved | `dropped` immediately, with one notice. Only an unresolved group or Sprint names a category (`group`, `sprint`); the other drops (groups failed, workspace gate missing, catalog failed, no visible groups) name none and the notice says the link could not be applied right now |
| Terminal auth lock (`AUTH_REQUIRED_EVENT`) | `dropped`; the lock is unchanged and the link is never replayed after sign-in |
| Planning review dirty, saving or `pendingScopeChange` | `cancelled`; a raw sprint change would leave drafts bound to the old sprint (`usePlanningSprintReview.js:194-196`) |
| Deliberate interaction before Stage D starts: `pointerdown`, non-modifier `keydown` or `touchstart` outside the notice | `cancelled`, no notice. During Stage D those plus `wheel` and `touchmove` cancel only the reveal and keep the applied stages |
| Budget: 90 seconds from `sharedConfigReady` overall; Stage A and B 5 seconds each, C 20, D 20 | A timeout in Stage B, C or D skips that stage and reports its categories. A Stage A timeout drops the link (nothing else is meaningful without the link's scope); its 5 seconds open when the readiness gate first opens, so a slow config read does not use them up. The overall budget ends `partial` when stages already ran and `dropped` when Stage A never ran |
| First-run group popup open (`onboardingRequired`) or an onboarding tour running | The clock pauses and the interaction listeners are disarmed. The payload is held in memory; after first-run the link's group resolves only if the recipient made it visible. The Catch Up tour's auto-start waits until the link is terminal |
| Terminal | Exactly one `share_view_action` apply event and at most one notice. Applied stages are kept; there is no rollback |

The interaction listeners are `document` capture-phase listeners in `shareView/` that read the auth latch first. They are not `window.addEventListener('keydown', handler)` registrations, whose count `tests/test_auth_isolation_source_guard.js` pins at six over a fixed owner list that excludes `shareView/`.

### Notice

One notice names the unapplied categories (`group`, `sprint`, `teams`, `filters`, `mode`, `focus`), never raw values. Share and apply report through one existing notice pattern; Task 12 of the plan inventories the candidates and reuses the connection-recovery banner. No new notification system.

### Side effects

- Raw setters emit no analytics. `applyEngMode` is not used: it emits `select_content` and validates nothing. Effect-driven events still fire and are documented in the taxonomy row: `page_view` on a mode change, `app_search` for a non-empty `find`, and `api_result`.
- Apply issues no mutating request. A normal load already sends read-only POSTs (`/api/dependencies`, `/api/stats/*`, sprint-review `values/read`, `/api/performance/loads`) and the session refresh (`/api/auth/refresh`, which writes no view), so the assertion is: no non-GET request outside that allowlist, and `saveGroupPreferences` (called only from first-run and Settings) is never reached.
- Persistence is the click path: the browser prefs blob, per-scope Team selection, and the planning store. In Basic and JSON group mode the persist effect copies `activeGroupId` into the local group preferences, so the link's group becomes the local favorite exactly as a header pick does; in DB mode the server favorite is never written. Both are tested per mode.
- Two tabs share the prefs blob; a second tab's later change can overwrite what a link persisted. Accepted.

## Alerts

- Add `data-alert-team={group.id}` to every `.alert-team-group` (eleven sites in `EngAlertsPanel.jsx`: `214 323 422 500 597 654 706 757 819 932 1046`) and `data-alert-kind="epic"` to the `followup` future-routed Epic groups (`:500`). Resolve with `card.querySelectorAll('.alert-team-group')` and `dataset.alertTeam === id`; never interpolate a link value into a selector.
- Category existence depends on the sprint: `backlog`, `missingTeam`, `missingLabels` for future sprints; `waiting`, `empty` for non-future; `needsStories` for active or future and only with neutral status and priority filters. A category absent for the recipient is not an error; an unresolved `alertTeam` reports `focus`, and so does an unknown `alerts` key (the notice reads "highlighted item"): the key chooses which alert category the recipient is pointed at, and a seventh notice term for it would add copy for a rare case. The operator accepted this on 2026-10-15. The panel renders only in Catch Up and only when there is at least one alert; `alerts=off` removes the panel from the DOM.
- Alert group ids are unique within one list, not across categories, and `followup` has two lists. An id is `team.id || team.name || 'unknown'`, so a group can be keyed by a Team name. The encoder omits `alertTeam` when the id equals its name unless it is a placeholder, and the category still opens.
- All ten categories depend on the sender's `find`, status, priority, lanes, track, Teams and sprint state, which is why the link carries them and applies them before Stage D.

## Focus

Capture is a read-only resolver at Share click time, separate from `engReadingAnchor.js`, whose selector covers only Planning rows, tasks and Epic blocks and which preserves position across refreshes rather than navigating.

| Mode | Captured target |
| --- | --- |
| Catch Up | The first visible alerts team group in DOM order among expanded cards (`.alert-card:not(.collapsed) .alert-card-body:not(.collapsed) .alert-team-group`); else the first visible `.epic-block[data-epic-key]`, returning `epic` when its header is in its natural position and the first visible `.task-item[data-task-key]` as `story` when the header is pinned; a requirement card or no child returns `epic` |
| Planning table | The first visible `tr[data-planning-row-key][data-row-kind][data-issue-key]` with `data-row-kind` `epic` or `story`, written as `epic` or `story` from `dataset.issueKey` (never from `data-planning-row-key`, which is the numeric issue id) |
| Board, Statistics | None |

"Visible" means `rect.bottom > T + SHARE_VIEW_FOCUS_MARGIN + 1 && rect.top < viewportBottom`, where `SHARE_VIEW_FOCUS_MARGIN` is 12, the distance below the sticky stack at which a reveal lands its target. The same margin on both sides makes a capture after a reveal return the same target; with `T + 1` a sliver of the previous sibling stayed visible and a forwarded link pointed at it. `T` is `measureStickyBottom` called with an explicit list, `['.compact-sticky-header.is-visible', '.filterbar-wrap', '.planning-panel.open', '.planning-review-sticky-stack', '.planning-review-docked-header', '.epic-header']`, because the default list names `.eng-filter-bar`, which no element carries. If nothing is visible the link carries no focus keys and is still copied.

Reveal: poll with `requestAnimationFrame` until the target exists, found by dataset equality; the 8-second budget counts visible frame time only and a single frame counts for at most 100 ms. A collapsed alert card is waited for, not expanded (the apply stage owns the flags), and its 0.35 second transition is waited out. Scroll instantly (a smooth jump would still be moving at the settle check) with `window.scrollTo`, landing the target at `T + SHARE_VIEW_FOCUS_MARGIN` below the sticky stack (groups have no `scroll-margin`); wait two frames while the compact header and filter bar settle and correct once if the delta exceeds 1 pixel; cancel on `wheel`, `touchmove`, `pointerdown`, `touchstart` or a non-modifier `keydown`. For the reveal, `T` omits pinned Epic headers (counting the target Epic's own header pushed it 36 px too low in Chromium) and a Story target adds its own Epic header's height. `revealIfHidden` is not reused: it scrolls the minimum distance, measures with a list that names `.eng-filter-bar` (it left an Epic block under the sticky bar) and scrolls smoothly; `blinkElement` from `planningConfirmedEdit.js` is reused. No highlight CSS is added: measured in Chromium, an existing class paints on every target (`epic-flash` on alert groups and Epic blocks, `task-highlight` on Story cards, `planning-review-confirmed` on Planning table rows). The link path passes no `onMissing`: it never opens Jira, never calls `clearEngFilters`, and a miss adds `focus` to the notice. A target near the end of the page cannot reach `T + 12`; the correction pass stops at the page end.

The Planning table's Epics/Stories mode is local `useState` in `PlanningReviewTable.jsx` that resets on every unmount. The link seeds it through a one-shot initial value (`setPendingPlanningRowMode`, taken by `takeInitialPlanningRowMode` in the table's lazy state initializer); no App state is added. The seed is written when Stage C begins and the table is keyed to remount (see Stages), because the first ENG load unmounts the table. Board needs no hoisting (no Board focus in v1).

## Share control

- One `IconButton` with the `header-icon-button` class, rendered on both header surfaces: the main surface in `.header-actions-row` immediately before `JiraExportButton`, which keeps the `.refresh-icon + .group-gear-button` adjacency three UI tests assert, and the compact surface as a flex sibling directly after `.compact-sticky-header-search` (a child would shrink Search or need a `:has()` rule; measured cost: nothing moves at 1028 px and wider, Sprint and Teams are 21 and 16 px narrower at 761 px), following the `surface` prop pattern of `SprintControl` and `SearchControl`. The main control also costs the main header one wrapped line in two bands of viewport width (about 905 down to 865 px with the ENG/EPM switch, and 800 down to about 760 px without it), which the operator reviews at gate G2. At most one is visible at any scroll position: the compact one exactly while the compact header is visible, the main one at the top. For about 87 px of scroll neither is on screen, as for every control in the main actions row, because the compact header appears only once the whole main header has scrolled off.
- Hidden in EPM and Scenario. Disabled while `selectedSprint === null`, `groupsLoading`, `onboardingRequired`, the workspace is unconfigured, the Team hydrate has not reached the scope key (checked only in modes whose ENG load runs tasks: source-only Statistics views and strict Board never hydrate Teams, and would otherwise stay disabled), the catalog is not validated, the auth latch is set, or a link apply is not terminal.
- Capture reads committed state only: `searchQuery` (not `searchInput`), `selectedTeams`, the raw facet state (not the derived selection), the mode from `deriveActiveEngMode`, and `boardStrictScope`.
- Click copies with `navigator.clipboard.writeText`. A copied state swaps the icon at a fixed 38 by 38 with a visually hidden `role=status`. When `navigator.clipboard` is missing (non-secure origins) or the write is rejected, the notice shows the URL in a selectable read-only field. `captureShareUrl()` stays synchronous so the clipboard write happens inside the click (Safari requires it). The notice renders inside `ShareViewButton`, anchored under the control and only on the surface that is showing, reusing the existing connection-recovery banner (`.server-unavailable-banner.connection-recovery-notice`) with one attribute-scoped placement rule (`[data-share-view] > .server-unavailable-banner`; no class is added); there is no notice mount in `dashboard.jsx`, because an in-flow mount is out of view when the compact header is active. The notice covers the right part of the controls row until Dismiss, which the operator reviews at gate G2.
- No new hover CSS: `.header-icon-button` already carries the hover override. Task 12 of the plan starts with a standalone mock built from verbatim repository CSS, reviewed at gate G2 before any wiring, and adds geometry and layering assertions, a headed Firefox and WebKit painted-ink check at 2x, and updates the existing assertions: the exact three-button count in `codebase_structure_smoke.spec.js` becomes four, Share joins the geometry list, and Share is asserted on the compact header.
- The shared UI fixture routes `/` with a regexp that never matches `/?v=1…` (`epm_home_token_fixture.js`), so the new spec registers its own route for the link URL.

## Security and privacy

- A link is untrusted input. It can only select among values the recipient already owns, triggers no write, and `find` is rendered as text (`.includes` filtering; analytics sends a length bucket only). Ids carry no capability: group, Team and Sprint catalogs are readable by every authenticated workspace user, and group visibility is a per-user preference, not an access boundary. Jira data is fetched with the recipient's own token and process caches are partitioned by workspace, connection and token version; the shared stats file cache and `EPICS_SEARCH_CACHE` are Basic mode only, which is loopback-only.
- Validate first, then call setters; never set and then reconcile. The existing facet reconciliation deliberately carries unknown ids forward and persists them, so facet atoms are matched against current options before any setter runs.
- Link values never reach a selector. Use `findIssueElementByKey` (`CSS.escape`) or iterate and compare `dataset`. Several existing lookups interpolate keys (`dashboard.jsx:4598-4600`, `EngBoardView.jsx:205 285`, `useEpicRefresh.js:412`); the link path does not reuse them, and issue keys must pass the key regex first.
- Closed vocabularies are checked with `Set.has`, never `obj[value]` (the alert category map is a plain object).
- **Search text is the one new data class.** It adds `find` to WSGI access-log request lines and Referer, to the signed (not encrypted) session cookie while login is pending, to browser history, and to wherever the link is pasted. Mitigations, all required: `scripts/docker-entrypoint.sh` passes `--access-logformat` with the request path and no query and no Referer, rendering the path with `%(U)r` because gunicorn's `%(U)s` is the percent-decoded path and a `%0A` in it would forge a second log line (`%(l)s` and `%(u)s` are dropped for the same reason), asserted in `tests/test_container_packaging.py`; `SENSITIVE_CALLBACK_QUERY_RE` in `jira_server.py` is extended to redact `/?v=…` for the development server (tested in `tests/test_logging_migration.py`); `docs/PRIVACY.md` lists the pending-link cookie value and the link contents; `find` is capped and stripped as above. The same-origin subresource requests made while parsing `jira-dashboard.html` carry the full URL as Referer before the entry strips it, which is why the Referer is dropped from the access log. If the operator will not change the container log format, `find` is removed from v1.
- GA4: `find` avoids the Enhanced Measurement site-search defaults (`q`, `s`, `search`, `query`, `keyword`), so a strip failure cannot produce a `view_search_results` event with raw text (`docs/README_ANALYTICS.md` forbids it). A test asserts the encoder never emits those keys and that the frame URL at the first `gtm.js` request has an empty search. Accepted residual risk: `performance.getEntriesByType('navigation')[0].name` and browser history keep the original URL; the CSP (`script-src 'self'` plus Tag Manager, no inline script) blocks custom-HTML exfiltration and the repo's policy forbids overriding `page_location`.
- No new route and no new `EndpointPolicy` (`tests/test_endpoint_policy_inventory.py` pins this). The touched flows are GET `/` and `/jira-dashboard.html` (`public_page`), GET `/login` and GET callback (`auth_flow`), and POST `/api/auth/logout`, which already requires `X-Requested-With`. Negative tests prove the redirect target is always `/` with a re-validated query.
- Pre-existing, found in review, not introduced here: the container's gunicorn access log writes the OAuth callback query (`code`, `state`) in clear; the access-log format change in this work closes that for the container as a side effect.

## Analytics

`share_view_action` follows the `board_action` and `planning_action` pattern; `trigger=userevent` and `event_type` as the existing userevent builder produces. `feature_name=share_view`; `source_surface` is `catch_up`, `planning`, `board` or `statistics`. Copy: `workflow_action=copy_link`, `result=success|failure`. Apply: `workflow_action=apply_link`, `result=success|partial|rejected`: a finished apply maps to `success`, a partial one to `partial`, and a dropped or cancelled one to `rejected`; a link already terminal at load (`newer`, `invalid`) reports one `rejected` event. `source_surface` is the resolved mode, else the recipient's current ENG mode, else `catch_up`. The event is sent once, after analytics is ready. No category parameter, no id, name, URL or key. Decision supported: Share adoption and how often recipients resolve only partially, to decide whether stored links are worth building.

The apply event is emitted only after analytics is ready (events sent earlier are dropped), so `useDashboardAnalytics` must expose readiness. Update `frontend/src/analytics/events.js`, the `docs/README_ANALYTICS.md` taxonomy row after `board_action` plus a short subsection, No-Event allowlist rows (URL strip, notice, clipboard fallback field) and a privacy line that link queries never reach GA4, `docs/plans/SUPPORT-ga4-user-configuration.md` (changelog, Use table, verification paragraph), and the tests `tests/test_analytics_events.js` and `tests/test_analytics_source_guards.js`. The GA4 MCP YAML changes only if a key is added. The `result` token is `failure`, matching the taxonomy.

Clipboard feedback is scoped to the current mounted surface and copy attempt. Surface changes, unmount and a newer attempt invalidate older asynchronous success/failure state writes. Capture and `writeText` invocation remain synchronous within the click; analytics keeps the existing fixed enum contract.

## Acceptance criteria

1. Pressing Share copies a URL that, opened by a signed-in user in the same workspace and site, reproduces every key in the contract that applies to the link's mode for Catch Up, Planning, Board and Statistics, whatever the recipient's saved prefs. Keys outside the mode, Stats display options and Board facets remain the recipient's.
2. An unauthenticated recipient who opens the link signs in and lands in the same view without re-clicking. A stash older than 900 seconds at callback time falls back to `/`. The session cookie stays under 4,093 bytes with a maximum stash. A failed callback keeps the stash.
3. If the group or sprint does not resolve, nothing else is applied and the recipient keeps their own view with one notice; other unresolved keys are skipped with one notice naming categories, never values.
4. Opening a link issues no `/api/*` request the equivalent manual navigation would not. Test: for each mode, cold and warm cache, the multiset of requests (method, path, sorted query-parameter names, aborted requests counted) for `/?v=1&…` equals the multiset for `/` with the prefs and per-scope keys pre-seeded to the link's resolved state; a scope-changing link issues no default-scope load; there is no non-GET request outside the read allowlist; the Catch Up to Board reuse spec passes unchanged; the first `gtm.js` request is issued after `history.replaceState` removed the link keys. The acceptance matrix names Catch Up, Planning table (review plus values/read), ordinary Board, strict Board Component and All work, task-loading Statistics and source-only Statistics Project Track, each cold/warm. Warm fixture runs prime the existing backend/cache contracts with a real manual run and reuse the app-persisted v2 Sprint catalog, then prove source identity/version validation and cache consumption. Project Track initial scope navigation intentionally bypasses its source cache on both link/manual paths; the warm catalog remains validated and consumed, and the two source bypasses are asserted. Read POST bodies must match the target scope; duplicate query names and aborted requests remain in the multiset.
5. After a link is consumed, a reload, a connection-recovery reload or a reauth never re-applies it and never alters the recovered view. A terminal auth lock drops a pending link. A reload before apply completes drops it. The reauth source guards pass unmodified.
6. The Share control matches the header cluster's geometry, visibility and hover contrast on both surfaces in Chromium, and the painted-ink check passes in headed Firefox and WebKit at 2x.
7. `decode(encode(state))` equals the state for every key and test vector, and the encoder's output passes the Flask stash validator through one shared corpus.
8. No link-derived value appears in analytics payloads. Container access logs omit the query and the Referer. `docs/PRIVACY.md` lists the new data.

## Verification

| # | Claim | Test | Spy or patch symbol |
| --- | --- | --- | --- |
| V1 | No write on apply | Zero mutating requests outside the read allowlist; zero hits to `/api/groups-preferences`, `/api/groups-config` writes, `/api/me/*`, `/api/issues/*` (`tests/ui/shareable_view_links.spec.js`); source guard: `shareView/**` imports none of `configApi.js`, `jiraIssueApi.js`, `postJsonWithCsrf`, `saveGroupPreferences` | `page.on('request')`; `saveGroupPreferences` |
| V2 | Redirect target always `/` | Hostile stashes injected with `session_transaction()` (`//evil.example/?v=1`, `https://…`, `/\x`, CRLF, non-dict, expired): `Location` is `/`; `urlsplit` gives empty scheme and netloc and empty fragment | `jira_server.redirect` recorded; the callback never reads `request.args` for the target |
| V3 | Strip before Tag Manager | `addInitScript` wraps `history.replaceState` and the `script[data-analytics-gtm]` append; replace precedes append; the frame URL at the `gtm.js` request has an empty search | `history.replaceState`; `appendGtmScript` |
| V4 | No `clearEngFilters`, no selector interpolation | Throwing deps for the apply hook; a source guard forbids `clearEngFilters`, `resetEngFilters`, `navigateToAlertStory`, `handleAlertStoryClick` and template-literal selectors containing link values in `shareView/`; a focus miss keeps `selectedTeams` and fires no `filter_changed` | `resetEngFilters` |
| V5 | Staged apply survives group-state resets | A link for another group and sprint keeps its status, lanes, Teams, mode and alert flags after `applyGroupState` ran | `applyGroupState` call order |
| V6 | Hold prevents a wasted load | No ENG load for the recipient's saved scope when the link changes scope; no abort | request log |
| V7 | Link overrides the capsules | Seed the auth and connection capsules plus a link; the final state is the link's; the source guard is unmodified | `pendingShellAuthResumeRef` |
| V8 | Cookie budget | All session keys plus a 1,536-byte stash: `Set-Cookie` is at most 4,093 bytes; 1,537 bytes is not stored; the guard pops above 3,300; `oauth_state` survives `/api/auth/atlassian/login` | response header |
| V9 | TTL | 899, 900 and 901 seconds at the boundary | injectable clock |
| V10 | Group or sprint unresolved applies nothing | Pure resolver tests; UI with a stubbed groups config lacking the group | none |
| V11 | No ids, names or tokens in the link | Encode with forbidden keys; parity with `FORBIDDEN_VIEW_PAYLOAD_KEYS` | none |
| V12 | Analytics fixed enums and no link values | Builder test; UI `dataLayer` capture holds no URL or key | `EVENT_NAMES` |
| V13 | Unavailable mode is reported, not forced | Closed-sprint Planning falls back to Catch Up with a notice; future-sprint Statistics retains Statistics and its view-specific Teams behavior | none |
| V14 | Share visibility | Hidden in EPM and Scenario; at most one visible at any scroll position (none for about 87 px) | UI counts |
| V15 | EPM-saved recipient lands in ENG | A recipient whose saved view is EPM ends in the link's ENG view | `restoredInitialEpmViewRef` |
| V16 | Cancel and lifecycle | Interaction, dirty review, auth lock, timeout and first-run pause each end in the specified state | none |
| V17 | Encoding vectors | The reviewed decode and encode vectors, including repeated keys, `__proto__`, `constructor`, `epic=../x`, `teams=`, lone surrogates and `%2C` versus `,` | none |
| V18 | Access-log format | `--access-logformat` contains no `%(r)s` and no `%(f)s` | `scripts/docker-entrypoint.sh` |
| V19 | Persistence per mode | Basic or JSON mode: the link's group becomes the local favorite; DB mode: no server write | `groupVisibilityPreferences` |
| V20 | Alert reveal | Collapsed groups are not treated as visible; `followup` Epic and story groups resolve distinctly; a name-keyed group emits no `alertTeam` | none |

Gates, from `AGENTS.md` section 10: `make test-security`; `python3 -m unittest tests.test_codebase_structure_budgets`; `fnm exec --using 20 bash scripts/extraction_lint/run.sh` (the script is not executable; ESLint warnings never exceed the 106 ratchet, and Task 11b leaves one transient `no-unused-vars` for `shareView` that Task 12 clears); `npm run test:frontend:unit` (`node --test tests/test_*.js`, so Node tests live under `tests/`); the full Python suite; the full Chromium `tests/ui` run with `JEP_TEST_PYTHON` set in a worktree; the headed Firefox and WebKit ink spec (record a WebKit baseline first: two `Task9 freshness reserved copy` smoke cases already fail in headless WebKit at the base); `npm ci` then `npm run build` and `make verify-dist-clean`. Negative tests for both server flows patch `jira_server.current_jira_request` and `HTTP_SESSION.post|put|delete|request` to raise. Two-user and two-workspace isolation is N/A with reason: no workspace-scoped data path is added.

## Forbidden regressions

- Reauth recovery and its source guards; sticky layering (re-verify Catch Up, Planning and Scenario); header control geometry and the existing header assertions; non-link startup and persisted-prefs behavior; the alert-loading deferral; initial-load performance and the cache-first sprint startup; the Board strict pipeline's cancellation and budget contract; the Catch Up to Board reuse.
- No change to any Jira write path; no Home, Townsquare or service-credential use.
- Keyboard-only polish is parked in `docs/TODO.md` (Deferred); touch support is required and every action works by tap.

## Files allowed to touch

The execution plan's file map is the contract; this is the shape.

- **New, `frontend/src/shareView/`:** `viewDefaults.js`, `codec.js`, `resolver.js`, `store.js`, `entry.js`, `applyMachine.js`, `applyController.js`, `captureState.js`, `interactionGuard.js`, `useShareViewApply.js`, `focusCapture.js`, `focusReveal.js`, `ShareViewButton.jsx`, `noticeCopy.js`.
- **New, backend:** `backend/auth/share_view_stash.py`.
- **New, tests:** Node tests `tests/test_share_view_*.js` (codec, resolver, store, extraction characterization, apply machine, apply controller, capture state, interaction guard, apply hook, onboarding wait, source guards, alert anchors, focus capture, focus reveal, Planning rows seed, control) with their support files `tests/share_view_fake_dom.js` and `tests/share_view_alert_panel_fixture.js`; `tests/test_share_view_stash.py`; UI specs `tests/ui/shareable_view_links.spec.js`, `tests/ui/share_view_focus.spec.js`, `tests/ui/share_view_control.spec.js` with `tests/ui/share_view_control_harness.jsx`; the shared corpus `tests/fixtures/share-view-query-corpus-example-sanitized.json` (other `.json` names under `tests/fixtures/` are gitignored); the reviewed mock `assets/mockups/share-view-control-194.html`; `docs/features/shareable-view-links.md`.
- **Backend edits:** `jira_server.py` (a call inside the single `before_request` and the log-redaction regex), `backend/routes/auth_routes.py` (callback success exit, the two authenticated `/login` redirects, logout), `scripts/docker-entrypoint.sh` (access-log format).
- **Frontend edits:** `frontend/src/dashboard.jsx` (first import, two extracted closures, the hold, the options object, the table key, the analytics destructure, the Share control on two surfaces), `frontend/src/eng/EngAlertsPanel.jsx`, `frontend/src/eng/PlanningReviewTable.jsx`, `frontend/src/onboarding/useOnboardingTour.js`, `frontend/src/analytics/events.js`, `frontend/src/analytics/dashboardAnalytics.js`, `frontend/src/styles/shared/controls.css` (selector lists and one placement rule next to the header icon-button rules; no new hover CSS), and the regenerated `frontend/dist/`, committed with every task that changes `frontend/src`.
- **Budget and test edits:** `scripts/extraction_lint/owner_budgets.json` (its exact `dashboard.jsx` pins move in each commit that changes the line count; `tests/test_codebase_structure_budgets.py` holds ceilings that the plan's growth stays under, so it is not edited: on `origin/main` `4247a3b1` `jira_server.py` grows by four lines under 6,487 and `dashboard.jsx` by 54 under 7,573), `tests/oauth_test_helpers.py`, `tests/react_hook_harness.js`, `tests/test_auth_entry_page.py`, `tests/test_auth_routes.py`, `tests/test_db_oauth_cutover.py`, `tests/test_container_packaging.py`, `tests/test_logging_migration.py`, `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`, `tests/test_dashboard_freshness_interactions.js`, `tests/ui/codebase_structure_smoke.spec.js`.
- **Docs:** `docs/README_ANALYTICS.md`, `docs/PRIVACY.md`, `docs/ontology.md` (new concepts with verification dates), `docs/features/README.md`, `docs/features/eng-workflows.md`, `README.md`, `docs/architecture.md`, `docs/SUPPORT-atlassian-oauth-setup.md`, `docs/plans/SUPPORT-ga4-user-configuration.md`, `docs/plans/README.md`, `docs/TODO.md`. `docs/security/endpoints.md` has drifted from `backend/security/policy.py` and is left unchanged because no route is added.

New state must stay out of `settings/`, `scenario/` and `epm/`: their line ceilings are frozen and unregistered files fail the budget test.

## Validation record (2026-10-14)

| Lens | Verdict | Findings | Resolved in |
| --- | --- | --- | --- |
| Security and privacy | Ready after fixes; no blocker, no decision conflict | `SEC-1` to `SEC-14` | "Surviving login", "Security and privacy", "Encoding", Acceptance 2 and 8 |
| Frontend state machine | Not ready as written; ready after the fixes below | `FE-1` (blocker) to `FE-16` | "Apply machine", Adjustments 1, 3, 8 |
| Schema and encoding | Not ready as written; ready after the fixes below | `SCH-1` (blocker) to `SCH-26` | "Link contract", "Encoding", "Alerts", "Focus" |
| Repo rules and verification | Ready after fixes; no blocker, no decision conflict | `REP-1` to `REP-17` | "Verification", "Files allowed", "Analytics", Acceptance 4 and 5 |

Material defects in the first version, each confirmed in source by the reviewer and re-read by the author: the single ordered batch lost filters to `applyGroupState`; omitted keys kept the recipient's values; the facet grammar could not express `null`, `track`, `initiatives` or the code's `hidden`; `alerts=<category>` could not express the alerts state; Board focus could never be captured; the Share control was unreachable while reading; click-time `topmost` was always the page top; the stash charset disagreed with the encoder's output; the `all-work` token was wrong; "full group becomes `all`" changed the filter; the readiness list had wrong names and signals; a late apply could corrupt a Planning review; and the line budgets for `jira_server.py` and `dashboard.jsx` could not pass.

## Evidence

Verified against `bd5b2bc2` by four independent reviews on 2026-10-14. Entries marked † were also re-read by the author.

| Claim | Source |
| --- | --- |
| Unauthenticated entry redirects to `/login` or `/login?reason=session_expired` and drops the query † | `jira_server.py:366`, `894-909` |
| The callback pops only `oauth_state` and `oauth_pkce_verifier`; no `session.clear()` exists; success ends `redirect('/')` † | `backend/routes/auth_routes.py:399-437`; repo-wide search |
| `save_oauth_session` pops only `db_oauth_session` and `atlassian_oauth_session_id` | `jira_server.py:504-514` |
| `sanitizeLoginUrl` rejects other keys and any hash † | `frontend/src/api/authRequired.js:12-31` |
| CSP is `script-src 'self'` plus Tag Manager; `/login` has no script † | `backend/security/headers.py`; `auth_routes.py:93` onward |
| Tag Manager is appended only after the analytics context loads | `frontend/src/analytics/analytics.js` (`applyAnalyticsContext`, `appendGtmScript`); `dashboardAnalytics.js:145-150` |
| gunicorn runs `--access-logfile -` with the default format that logs the request line and Referer; the redaction filter covers only the callback † | `scripts/docker-entrypoint.sh:10-16`; `jira_server.py:261-288` |
| Flask's session is signed, not encrypted; measured cookie sizes above | scratch measurement with the app's serializer (two independent runs) |
| `bind_server_globals` re-copies `jira_server` globals into route modules † | `backend/routes/__init__.py:24-31` |
| `tests/fixtures/.gitignore` ignores `*.json` except `*-template.json` and `*-example-sanitized.json` † | `tests/fixtures/.gitignore` |
| Only one `@app.before_request` is allowed in `jira_server.py` † | `tests/test_backend_route_source_guards.py:309-320` |
| At `bd5b2bc2`, `jira_server.py` is 6,487 lines at its ceiling, `dashboard.jsx` is 7,573 at its ceiling and the manifest demands equality (on `4247a3b1` the files are 6,455 and 7,493 lines under the same ceilings, and only the manifest still demands equality) † | `tests/test_codebase_structure_budgets.py:66,71,142,172`; `scripts/extraction_lint/owner_budgets.json` |
| `npm run test:frontend:unit` is `node --test tests/test_*.js` † | `package.json:14` |
| `applyGroupState` and the group and planning-scope effects reset per-scope state from prefs † | `dashboard.jsx:2753-2816`, `2896-2930` |
| The ENG load effect fires on the saved scope once catalog, groups and onboarding settle † | `dashboard.jsx:3488-3574` |
| The one-shot EPM restore re-asserts `'epm'` after `homeTokenConnectionLoaded` † | `dashboard.jsx:1425-1437` |
| `applyEngMode` validates nothing and emits `select_content` † | `frontend/src/eng/engModeState.js:58-68` |
| The compact header shows only when the main header is off screen, and hosts Sprint, Group, Teams, Mode and Search † | `dashboard.jsx:5399-5405`, `6306-6341` |
| Ticking every Team stores an explicit list; an explicit list filters by membership † | `dashboard.jsx:4012-4022`, `4135-4160` |
| `groupByInitiativeChoice` is `null`, `true` or `false`, with `null` data-driven † | `dashboard.jsx:789-791`; `eng/useEngWorkHierarchy.js:71` |
| The facet reconciliation carries unknown ids forward † | `eng/engCatchUpFilters.js:258-292` |
| `measureStickyBottom` defaults to `.eng-filter-bar`, which no element carries; the filter bar is `.filterbar-wrap` † | `eng/alertEpicNavigation.js:22-45`; `eng/EngFilterBar.jsx:174` |
| Board scope token is `all_work`; source-only Stats views are `excludedCapacity`, `monoCrossShare`, `projectTrack` † | `dashboard.jsx:914`, `917` |
| `GROUPS_MAX_TEAMS` is 12 † | `jira_server.py:244` |
| The Board Epic panel is a modal; the backdrop closes it on mousedown † | `eng/EngBoardEpicPanel.jsx:283-292`; `styles/eng/board.css` |
| Alert group id falls back to the Team name or `unknown` † | `eng/useEngAlerts.js:288-312`; `eng/engTaskUtils.js:16-21` |
| Header assertions: refresh-to-gear adjacency and the header-button geometry | `tests/ui/codebase_structure_smoke.spec.js:3249`, `3370`, `3480`, `5848`, `5878` |
| The keydown guard counts `window.addEventListener('keydown', handler)` over a fixed owner list † | `tests/test_auth_isolation_source_guard.js:7-14`, `120-160` |
| Search is client-side; no API module sends it | `frontend/src/api/*.js`; `eng/engTaskUtils.js:48-62` |
| No `navigator.clipboard` use exists in `frontend/src` | repo-wide search |
| Share-link plan constraint; the FUTURE token design | `docs/plans/AGENTS.md:104`; `docs/plans/FUTURE-db-additional-features.md` |

## Open items for the operator

The operator accepted all of these on 2026-10-15: items 1, 2 and 4 to 7 as written, and item 3 (gate G1) as `accept`.

1. **Share on both header surfaces** (Adjustment 1). Default: yes, one component, at most one visible at a time.
2. **v1 trims** (Adjustment 2): no Board focus, no Board facets, no Stats display options, no assignee filters. Default: as listed.
3. **Container access-log format change** in `scripts/docker-entrypoint.sh` to stop recording query strings and Referer. This is a production logging change; it also closes the pre-existing logging of OAuth callback `code` and `state`. Default: change it. Alternative: remove `find` from v1. The choice is made at plan review, before the plan runs: a declined choice re-issues the plan without `find` and without the log task rather than patching it. Accepted by the operator on 2026-10-15.
4. **Planning `rows` is seeded by a one-shot initial value** consumed at first table mount; no new App state, and a later remount resets it exactly as any user choice does today. Alternative, rejected: hoist the state into `App()` (a new state owner; `AGENTS.md` requires confirming that boundary).
5. **Board `scope` links open at most one strict stream** under the existing cancellation and budget contract; they carry no Teams.
6. **`dashboard.jsx` and `jira_server.py` budgets.** Extracting the raw halves of `applyOrdinarySprint` and `toggleTeamSelection` into helpers the link also calls (behavior-preserving, characterization-tested first) measured at plus 11 lines, not the estimated minus 8, because the helpers need their signatures and comments; the alternative is a second implementation of about 25 lines inside `shareView/`. Default: extract. Over the whole plan `dashboard.jsx` grows by 54 lines (+1 first import, +11 extractions, +35 mount and options object, +7 Share control) and `jira_server.py` by 4; on `origin/main` `4247a3b1` that is 7,493 to 7,547 and 6,455 to 6,459. The approved `778fb2aa` sync removes eight dashboard lines: current pre-Task-12 measurement is 7,532 (`appPlusOwners` 34,134), and Task 12 projects 7,539 (34,141); historical measurements remain unchanged. Both stay under their legacy ceilings (7,573 and 6,487), which the plan never edits; only the extraction manifest's exact `dashboard.jsx` pins move, in each commit that changes the line count. The precedent for growth inside an extraction budget is the data-freshness work (+48). This runs against the App decomposition's direction, so it needs the operator's acceptance.
7. **One transient lint warning.** Task 11b leaves `shareView` unused until Task 12 renders the control (105 warnings against the 106 ratchet, 104 again after Task 12). Default: accept.

## Risks

- `dashboard.jsx` is mid-decomposition (`EXEC-dashboard-app-decomposition.md`); sequence with it or accept rebase conflicts in the same file.
- The GA4 container configuration is outside the repo. The design relies on stripping before Tag Manager loads and proves it with a test, but does not inspect the container.
- A reload before the apply completes drops the link; a second tab can overwrite persisted prefs. Both accepted.
- The estimated shape of `useShareViewApply` is about 55 named inputs; the plan must keep it as one options object in the house style (`usePlanningSelectionSync`, `useDashboardFreshness`).
- Pre-existing, not fixed here: Sprint and Team values are interpolated into task-fetch JQL without whitelist validation; four project-track Stats keys are persisted but missing from the persist effect's dependency array (`dashboard.jsx:3251-3254`, `3271-3322`); `docs/security/endpoints.md` has drifted from `backend/security/policy.py`.
