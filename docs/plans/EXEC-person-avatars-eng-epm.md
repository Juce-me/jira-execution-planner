> **Status:** Proposed (2026-10-29), awaiting operator approval. Issue [#324](https://github.com/Juce-me/jira-execution-planner/issues/324), branch `feature/324-person-avatars-eng-epm` from `origin/main`; reference the issue in commits. Not started. Follows the EPM pill and font alignment of #319, which is a separate branch.

# One person-avatar element for ENG assignees and EPM owners

## Problem

No ENG surface shows a profile photo: every assignee renders a generic person glyph (`task-assignee-icon`) beside the display name. The only avatar-like element is the EPM project owner circle with generated initials (`epm-project-board-owner-avatar`). The EPM render path already switches to an `<img>` when `ownerAvatarUrl` is present, but the backend never supplies one, and `backend/security/headers.py` limits `img-src` to `'self'`, `data:` and Google Analytics hosts, so a remote avatar would be blocked anyway. `docs/design-system.md` requires one kind of element to have one look; EPM-only photos next to glyph-only ENG assignees would split the kind.

## Findings that shape the plan (verified 2026-10-29)

- **ENG needs no extra Jira request.** Jira returns `avatarUrls` inside the `assignee` object of every issue search. `jira_server.py::shape_jira_person` keeps only `accountId` and `displayName`, discarding it; `backend/services/eng_board.py::_person` already keeps `avatarUrl` (48/32/24/16 px) and `frontend/src/api/engBoardApi.js` already validates it (`exact(value, ['accountId','displayName','avatarUrl'])`), but no component draws it.
- **Render sites (current glyph + name):** `issues/IssueCard.jsx` (Story rows in Catch Up, Planning and EPM), `eng/EpicBlock.jsx` and `epm/EpmRollupPanel.jsx` (Epic header assignee), `eng/EngBoardEpicPanel.jsx` (Board subtasks), and the inline person editors (`issues/IssuePersonEditor.jsx`, which handles assignee and Delivery Owner). Re-verify this list with a search in Task 0.
- **EPM owner needs a lookup.** `backend/epm/home.py` selects `owner { id accountId name }` (legacy path); the DB/OAuth `public-read-v1` queries deliberately omit `owner` (it needs an identity scope outside the bounded contract, see `SUPPORT-home-oauth-public-read-design.md`). So in OAuth mode there is no owner `accountId` today and this plan does not change that contract; avatars appear for owners only where `ownerAccountId` already exists. The Home owner `accountId` is an Atlassian account id, so Jira's user API can resolve its `avatarUrls` (Jira OAuth already holds `read:jira-user`; `ATLASSIAN_SCOPES`).
- **Which Home owner field would carry a picture is unknown** and is not guessed here; the Jira lookup is the chosen route.

## Decisions to confirm before execution

1. **CSP:** add the Atlassian avatar host(s) to `img-src` (recommended; the avatar URLs are public CDN URLs, so no credential or token is sent) versus proxying images through a server route (more code, cache and auth surface). Task 0 captures the exact hosts from real `avatarUrls` values, never a wildcard on `*.atlassian.com`.
2. **Privacy/availability:** third-party image requests reveal the viewer's IP to the avatar CDN; accepted in the same way Google Fonts already is. A failed or blocked image falls back to the existing glyph/initials, never an empty box.
3. **Scope:** one shared element (`ui/PersonAvatar.jsx`) for ENG and EPM, replacing the per-surface glyph/initial markup; the EPM owner circle is the first consumer, not a second kind.

## Design

`ui/PersonAvatar.jsx`: props `person` (`{ displayName, avatarUrl }`), `size` (`sm` 16px for dense rows, `md` 20px for EPM owner); renders `<img>` (`loading="lazy"`, `decoding="async"`, explicit width/height, empty `alt` because the name is always adjacent text) when `avatarUrl` is present and not failed, else the existing person glyph (ENG) or initials (EPM owner) at the same size. `onError` swaps to the fallback once. Styling reuses the existing `task-assignee-icon` box and the `epm-project-board-owner-avatar` circle values moved into one class hook registered in the design-system map (`person-avatar`, modifier per size); the two bespoke hooks are deleted so the baseline does not grow.

Backend: `shape_jira_person` gains `avatarUrl` (smallest `avatarUrls` size that is at least 24px; null when absent), no new Jira call. Home owners: one bulk `GET /rest/api/3/user/bulk?accountId=...` per EPM rollup request for the unique owner `accountId`s of the projects in scope (cap 50 accountIds, one request, `startAt`/`maxResults` pagination contract per endpoint), cached per workspace for 24h; failure or missing scope leaves `ownerAvatarUrl` empty and never fails the rollup. Uses the signed-in user's Jira auth context only (no service tokens, no Home calls); runs outside the critical rollup path where possible and is measured (Task 6).

## Tasks

0. **Verify assumptions.** Read `docs/plans/AGENTS.md` (this plan changes no configuration storage or endpoint rights, so `backend/security/CONFIGURATION_OWNERSHIP.md` needs no change). Capture the real avatar host(s) from synthetic-safe inspection of a response shape (numbers/hosts only; no saved screenshots or payloads of live data). Re-run the render-site search. Check `engBoardApi.js` and the payload validators (`backend/services/eng_board_stream.py`) accept the added field wherever `shape_jira_person` output is validated; list every consumer of `shape_jira_person`.
1. **Guards first (fail before code):** source guards that `shape_jira_person` returns `avatarUrl`, that no component other than `PersonAvatar` renders `task-assignee-icon` markup, and a CSP test asserting `img-src` contains exactly the verified hosts and no wildcard.
2. **Backend ENG:** extend `shape_jira_person`; unit tests with synthetic Jira shapes (all four sizes, missing, non-string, non-dict).
3. **Backend EPM:** owner avatar lookup helper (bulk call, unique ids, cap, TTL cache keyed by workspace and accountId, never raises), wired where `ownerAccountId` is set; tests for ordering, cap, failure and the no-request-context path (must reach the real Jira auth wrapper, see the worker-thread learning), and a negative test that no Basic/service/Home path is used.
4. **CSP:** add the verified hosts to `img-src` in `backend/security/headers.py`; update its test.
5. **Frontend:** create `ui/PersonAvatar.jsx`; replace the glyph/initials markup at each render site found in Task 0; register `person-avatar` in `docs/design-system.md` and remove `task-assignee-icon`/`epm-project-board-owner-avatar` hooks; regenerate the baseline (must only shrink). Keep the editors' open/close, Enter/Escape and touch behaviour untouched; the avatar is not a click target.
6. **Verification:** unit and Playwright tests (image present, 404 falls back to glyph/initials, long names truncate, row heights unchanged: assert epic-header and story-row heights before/after, no layout shift when the image loads thanks to fixed width/height, sticky offsets unchanged (MRT009)). Performance: record initial EPM and ENG load request counts and timings before/after (expected ENG +0 requests, EPM +1 bulk request only on a cold owner cache). Headed Firefox/WebKit check of a fixture with an image and with the fallback. Full Python, frontend unit and Chromium suites at the final head; compare known flakes (`dashboard_data_freshness` EPM specs, SIGINT runner tests) against a stashed baseline before calling them unrelated.
7. **Docs:** `docs/features/` ENG and EPM notes, `docs/design-system.md`, `docs/ontology.md` entry for the new element (do not edit its Coverage line), `docs/README_ANALYTICS.md` allowlist reason (no event).

## Acceptance

- Assignees (ENG Catch Up, Planning, Board) and EPM owners render their Atlassian photo where Jira returns one, else the existing glyph or initials, through one `PersonAvatar` element.
- No new Jira request on ENG loads; EPM adds at most one bulk request per rollup, only for uncached owners; failures never affect rollups.
- CSP allows only the verified avatar hosts.
- Layout (row and header heights, sticky offsets, geometry specs) unchanged; baseline does not grow; two bespoke avatar/glyph hooks removed.

## Risks

- Avatars load from a third-party CDN: slower or blocked networks show fallbacks (by design).
- OAuth-mode EPM owners stay without avatars until the owner `accountId` is available there; fixing that is a separate contract change.
- Per-row images in long lists (30+ Epics): lazy loading and fixed dimensions bound the cost; measured in Task 6.
