> **Status:** Proposed, revised 2026-10-29 after a three-reviewer pass and a code verification; awaiting operator approval. Issue [#324](https://github.com/Juce-me/jira-execution-planner/issues/324), branch `feature/324-person-avatars-eng-epm` from `origin/main`; reference the issue in commits. Execution started 2026-10-29; see Execution log. Follows the EPM pill and font alignment of #319, which is a separate branch.

# Profile photos in the existing person-glyph slot

## Problem

Every ENG assignee renders a generic person glyph (`task-assignee-icon`) beside the display name, and the EPM project owner is a generated initials circle (`epm-project-board-owner-avatar`). Jira already returns `avatarUrls` for each assignee, but `shape_jira_person` drops them, and `backend/security/headers.py` limits `img-src` to `'self'`, `data:` and Google Analytics hosts, so a remote photo would be blocked anyway.

## Priority and design rule

Basic data first. Names, statuses and Story Points must paint exactly as fast as today. The photo is decoration that fills a slot that already exists: no new request, no new row element, no layout change, no work on the critical path. Anything that cannot meet that is out of scope.

## Verified on 2026-10-29 (code read, no live data)

- **The slot exists.** The glyph box is `.task-assignee-icon` (14x14 in story rows, `issues.css:598-610`; 20x24 with a 21px svg in the Epic header, `issues.css:829-838`). Real glyph sites are exactly three: `issues/IssueCard.jsx:306`, `eng/EpicBlock.jsx:316`, `epm/EpmRollupPanel.jsx:594`. The EPM owner circle is `EpmRollupPanel.jsx:299`, which already renders `<img src={avatarUrl}>` when a URL is present.
- **ENG Board has no glyph** (`EngBoardEpicPanel.jsx`, `EngBoardEpicCard.jsx` render only the person editor), so photos there would be a new element and a layout change. Out of scope. `eng_board.py::_person` already ships `avatarUrl` (48px first) and is left untouched.
- **Text-only assignee sites stay text:** `EpmRollupTree.jsx:56`, `PlanningReviewTable.jsx:402`, `EngAlertsPanel.jsx:936`, Stats, Scenario and `OpenEpicsChart`.
- **`shape_jira_person` (`jira_server.py:1459`) has 8 call sites:** 2912 and 3046 (Epic details, feed `EpicBlock`), 3691 (Story payload, feeds `IssueCard`), 5669/5679/5739 (excluded-capacity stats), `routes/eng_routes.py:1567` (missing-field alerts) and 2918 (`deliveryOwner`, Board only). The Story payload also carries `epicAssignee`, which the frontend reads only for `displayName` in Stats. Putting a URL on every call site would add it twice per Story for no rendered benefit.
- **EPM owner `accountId` exists only on the legacy Home path** (`backend/epm/home.py:621,636,655`). The OAuth `public-read-v1` queries deliberately omit `owner` (`home.py:722-723`, `SUPPORT-home-oauth-public-read-design.md`). A new Jira bulk lookup would therefore run only on a path being retired, and `/rest/api/3/user/bulk` returns 10 users by default (needs `maxResults`/`isLast` handling). It is dropped. Adding `picture` to the Home GraphQL selection is also dropped: an unknown field fails the whole query, which is a load-regression risk with no verified payoff.
- **Payloads are gzipped** (`backend/response_compression.py` covers `/api/` JSON except `/api/auth/`), and avatar URLs repeat per person, so wire cost is far below raw size. Raw size still matters for `TASKS_CACHE` memory and JSON parsing.
- **Cache key:** `TASKS_CACHE_SCHEMA_VERSION = 'v3-team-label-aliases'` (`jira_server.py:216`) must change, or the 5-minute cache serves avatar-less payloads after deploy.
- **CSP test** (`tests/test_security_headers.py:34-37`) string-matches the whole `img-src` value and will need the new hosts.
- **Design map:** `docs/design-system.md` has no row for the glyph or owner circle; Task 5 adds one.

## Decisions to confirm before execution

1. **Direct CDN images with a code-owned host allowlist** (recommended) versus a same-origin proxy route. A proxy adds a route, auth/CSRF/workspace checks, SSRF surface and per-image backend load, which contradicts the priority above. Avatar CDN URLs are public.
2. **Gravatar: decided 2026-10-29, Atlassian-hosted avatars only.** Jira avatar URLs for some users are `secure.gravatar.com/avatar/<md5 of email>?d=...`; the viewer's browser would send that email hash and IP to Gravatar. `AVATAR_HOSTS` therefore contains Atlassian-hosted avatar hosts only; a Gravatar-hosted URL fails the sanitizer, so those users keep the glyph at zero image requests (which also avoids the Gravatar-then-redirect double fetch). Reopen only with new evidence, e.g. Task 0 shows most users are Gravatar-hosted.
3. **Scope:** the three glyph sites plus the EPM owner circle. Board, Planning Table and text-only sites are not included.

## Design

**Backend.** `shape_jira_person(value, avatar=False)`: with `avatar=True` it adds `avatarUrl` taken only from `avatarUrls['32x32']` (one size rule: sharp at 2x for 14-20px slots; no fallback chain), passed through `sanitize_avatar_url`. `avatar=True` only at 2912, 3046 and 3691, plus the EPM slim issue payload (`shape_epm_issue_payload`, `jira_server.py:2215`): its `assignee` stays a display-name string and gains an optional sibling `assigneeAvatarUrl` (sanitized; absent when none), which `EpmRollupPanel.jsx:619` passes into `epic.assignee`. Other sites keep today's `{accountId, displayName}` shape, so their exact-shape tests do not change. One shared constant `AVATAR_HOSTS` and `sanitize_avatar_url(value)` live in `backend/security/avatar_urls.py` (`https` only, no userinfo or port, exact lowercase hostname in the frozen set, else `None`); `headers.py` builds `img-src` from the same constant so guard and CSP cannot drift. A direct generated-initials default URL (Atlassian `/initials/` path) is mapped to `None`, so users without a photo cost zero image requests and keep the glyph. Bump `TASKS_CACHE_SCHEMA_VERSION`.

**Frontend.** `ui/PersonAvatar.jsx`: props `avatarUrl`, `children` (the fallback: existing glyph svg or initials). Renders `<img alt="" loading="lazy" decoding="async" width height>` inside the existing slot, re-checks `https:` and the host set, and on `onError` marks the URL failed in a module-level `Set` (one failure learned once, no per-row state) and renders the fallback. The three glyph sites and the owner circle swap their inner content only; the `task-assignee-icon` and `epm-project-board-owner-avatar` boxes, sizes and the 20x24 Epic header override stay, with a descendant `img` rule (circle, `object-fit: cover`) and no new class hook. The avatar is not a click target; editors, Enter/Escape and touch behaviour are untouched.

**EPM owner.** No lookup. The circle shows a photo only when `ownerAvatarUrl` already arrives (sanitized) and initials otherwise. OAuth-mode owners stay on initials until the owner `accountId` contract changes; this is a recorded non-goal, not a risk.

## Tasks

0. **Verify (open items only).** Read `docs/plans/AGENTS.md`; scan `docs/plans/GATE-*.md` per root rules. From the running app, hosts only (no payloads, no screenshots of live data; the operator signs in): distinct avatar hosts and redirect targets across several users and tenants, and whether Atlassian cache headers allow reuse of one URL across rows. Trace which backend function feeds `epic.assignee` in `EpmRollupPanel.jsx:594` and confirm it is one of the `avatar=True` sites. Confirm 32x32 exists in real `avatarUrls`. Report only counts of users per host class (Atlassian-hosted photo, Atlassian initials default, Gravatar, none) so the coverage of the Atlassian-only decision is known.
1. **Guards first (red):** `sanitize_avatar_url` table tests (`javascript:`, `data:`, `http:`, `//host`, foreign host, `https://allowed@evil/`, `https://allowed.evil.com/`, a Gravatar URL (must return `None`), uppercase and trailing-dot hosts, `/initials/` default); CSP built from `AVATAR_HOSTS` with no wildcard; source guard that every `avatarUrl` producer calls the sanitizer and that `PersonAvatar` is the only component rendering a remote `<img>` for a person.
2. **Backend ENG:** `shape_jira_person(value, avatar=False)`, the three `avatar=True` call sites, cache version bump. Tests: synthetic shapes (missing, non-string, non-dict, no 32x32), unchanged shape at the other five sites. Update only the exact-shape tests that cover the three changed sites.
3. **CSP:** `img-src` from the shared constant; update `tests/test_security_headers.py`.
4. **Frontend:** `ui/PersonAvatar.jsx`, the three glyph sites and the owner circle; descendant `img` CSS. Update the specs that assert the glyph box (`tests/ui/eng_group_board_card.spec.js:784,843,863`, `tests/test_eng_board_styles.js:144-145`, `tests/ui/epm_portfolio_header_visual.spec.js`, `tests/test_dashboard_css_extraction.py:245`) only where the contract changes.
5. **Design system and budgets:** add a "Person avatar" row to the `docs/design-system.md` element map (passive, writes nothing); run the baseline generator and report the real delta (target: no new class hook, baseline unchanged); re-sync `scripts/extraction_lint/owner_budgets.json` for `EpicBlock.jsx`, `EpmRollupPanel.jsx`, `IssueCard.jsx` and `jira_server.py` if registered or over ceiling, and run `tests.test_codebase_structure_budgets`.
6. **Verification (assertions, not just records):**
   - Playwright: the multiset of `/api/*` requests on ENG and EPM loads is identical with and without avatars; every image request host is in `AVATAR_HOSTS`; a `securitypolicyviolation` listener stays silent against real headers.
   - Geometry: story-row, Epic-header and EPM owner heights and positions unchanged before and after the image loads (delayed stub) and after a 404 fallback; sticky offsets unchanged with the inherited-view hint present and dismissed (MRT009); `avatarUrl` change resets the failed state.
   - Payload: on a synthetic 3,000-Story fixture record raw and gzip bytes and JSON parse time before and after, and TTFB through `Server-Timing` / `backend/services/load_performance.py` (same scope, N runs, cold and warm, medians). Count image requests and decoded images on a 500-Story fixture with a cold HTTP cache. If cold-cache image fetches or commit time regress beyond what the measurement shows as noise, limit photos to Epic headers and the first N visible Stories rather than shipping the regression.
   - Headed Firefox and WebKit check at 2x of a fixture with a photo and with the fallback.
   - Full Python, frontend unit and Chromium suites at the final head; compare known flakes against a stashed baseline before calling them unrelated.
7. **Docs:** `docs/features/eng-workflows.md`, `docs/features/epm-view.md`, `docs/ontology.md` (dated `Verified on` for the touched section; not the Coverage line), `docs/README_ANALYTICS.md` allowlist reason (no event), this plan's Outcome and `docs/plans/README.md`.

## Acceptance

- ENG Story and Epic assignees and the EPM Epic assignee show the Atlassian photo in the existing glyph slot where Jira returns a real photo, else the existing glyph; the EPM owner circle shows a photo only when one already arrives, else initials.
- No new request on ENG or EPM loads; no new Jira call anywhere; first paint of names, statuses and points unchanged.
- `img-src` contains exactly the verified Atlassian-hosted avatar hosts, from the same constant the sanitizer uses; no wildcard and no Gravatar.
- Layout (row and header heights, sticky offsets, geometry specs) unchanged; no new class hook; baseline does not grow.
- Measured payload, TTFB and image-request deltas are recorded in this plan and within the agreed noise, or the scope is reduced as in Task 6.

## Risks

- Avatars load from a third-party CDN: slow or blocked networks show fallbacks (by design).
- The host list is empirical; a missing host fails silently into the fallback, which is why Task 6 asserts no CSP violations.
- OAuth-mode EPM owners stay on initials (non-goal above).
- Per-row images in long lists: lazy loading, fixed dimensions and the Task 6 fallback scope bound the cost.

## Execution log

- 2026-10-29 Task 0 (partial, code trace). `EpmRollupPanel.jsx:592-600` renders `epic.assignee`, built at `:619` from `epicIssue.assignee`, a plain string from `shape_epm_issue_payload`, not one of the three `avatar=True` sites. Operator decision: add the optional `assigneeAvatarUrl` field on that existing payload (no new request, no new Jira call; the avatar comes from the assignee object already fetched). Divergence recorded in Design and Task 2. Host probe pending: needs the operator signed in to the running app.
- 2026-10-29 Task 0 host probe (operator signed in, in-page aggregation of the Board response, numbers and hostnames only, nothing saved). 58 distinct assignees on one Board load: 18 (31%) `avatar-management--avatars.us-west-2.prod.public.atl-paas.net` photos, 40 (69%) `secure.gravatar.com/avatar/<hash>?d=...`, 0 without a URL. Gravatar is the majority host class, which triggers the decision-2 reopen condition. Not measured: redirect targets, 32x32 presence (Board `_person` returns the 48x48 string only), the `d=` default's target. STOPPED for operator decision; no code written.
