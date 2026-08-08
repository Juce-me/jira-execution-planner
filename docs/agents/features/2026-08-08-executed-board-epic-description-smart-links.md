Status: executed
Type: feature

# Board Epic Description Smart Links

## Outcome

Implemented as planned. Board Epic descriptions preserve Jira Smart Links instead of silently
omitting them. Jira ADF `inlineCard` and `blockCard` nodes render as safe clickable anchors in the
existing description panel, using their URL as the visible fallback label.

## Scope

- Extended the shared server-side ADF renderer in `backend/epm/home.py`.
- Supported `inlineCard` and `blockCard` nodes whose `attrs.url` value passes the existing URL
  allowlist.
- Rendered accepted links with `target="_blank"` and `rel="noopener noreferrer"`.
- Used the accepted URL as the link text because Jira Smart Link nodes do not reliably include a
  display title in their ADF payload.
- Preserved the current Board description fetch, cache, sanitization, clamp, and expansion behavior.
- Updated the active Group Board plan so its supported-node policy matches the implementation.

## Out of Scope

- Fetching or unfurling remote link metadata.
- Requesting or injecting Jira-rendered HTML.
- Adding a client-side ADF parser.
- Changing ordinary ADF link marks, description layout, or unrelated ADF node rendering.
- Adding analytics: the no-event allowlist records that user-authored Smart Link destinations,
  description text, and issue keys are not collected; existing API reliability tracking remains.

## Data Flow

1. `GET /api/issues/description` continues fetching only the selected issue's Jira `description`.
2. `adf_to_html` passes the ADF document to the shared `_render_adf_html_nodes` walker.
3. For `inlineCard` or `blockCard`, the walker reads `attrs.url` and passes it through
   `_safe_adf_href`.
4. An allowed HTTP, HTTPS, or mailto URL becomes an escaped anchor whose visible text is the escaped
   URL. A missing or rejected URL contributes no HTML.
5. `EngBoardEpicPanel` continues rendering only the server-produced HTML.

## Security And Failure Behavior

- The existing scheme allowlist remains the only route to an anchor; `javascript:`, `data:`, and
  other schemes are rejected.
- Both the `href` attribute and visible fallback label are HTML-escaped.
- The renderer performs no network request and exposes no additional Jira or Atlassian credentials.
- Unknown ADF nodes retain the existing content-walking fallback.

## Acceptance Criteria

- A Jira `inlineCard` with an HTTPS URL renders one clickable anchor containing that URL.
- A Jira `blockCard` with an allowed URL renders one clickable anchor containing that URL.
- A Smart Link URL containing HTML-sensitive characters is escaped in both attribute and label.
- An unsafe or absent Smart Link URL does not render an anchor.
- Existing ordinary link-mark sanitization continues to pass.
- The Board Epic panel displays the server-rendered Smart Link without changing the description
  panel's loading, empty, error, clamp, expansion, or cache behavior.

## Verification

- The focused Python regression failed first because the renderer returned zero anchors, then passed
  after the minimal shared-renderer change.
- The focused Python Smart Link, ordinary-link XSS, and empty-description tests passed together.
- All 19 focused Group Board panel Playwright tests passed.
- Collapsed and expanded screenshots show the link clearly without disturbing panel layout.
- Full-suite and build results are recorded in the execution plan.

## Forbidden Regressions

- Do not render raw Jira HTML.
- Do not broaden the accepted URL schemes.
- Do not add description data to bulk Jira fetches.
- Do not add per-link Jira, Home, Confluence, or third-party requests.
- Do not modify unrelated alert-loading work currently present in the checkout.

## Current Accuracy

Implemented as planned. The implementation and regression tests are now the source of truth.
