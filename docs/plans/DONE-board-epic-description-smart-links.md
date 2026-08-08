# Board Epic Description Smart Links Implementation Plan

> **Status:** Done. Accepted by the requester and executed in `3770d2b`. Kept for audit context only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Jira Smart Links in Board Epic descriptions as safe clickable links instead of silently dropping their ADF nodes.

**Architecture:** Keep Jira description fetching and frontend HTML injection unchanged. Extend the shared server-side ADF node walker to turn `inlineCard` and `blockCard` `attrs.url` values into escaped anchors only after the existing `_safe_adf_href` allowlist accepts them; verify the API output at the route boundary and the anchor contract in the existing Board panel fixture.

**Tech Stack:** Python 3.10+, Flask, `unittest`, React 19, Playwright, esbuild.

## Global Constraints

- Render only HTTP, HTTPS, and mailto Smart Link URLs accepted by `_safe_adf_href`.
- Escape the URL independently for the anchor attribute and its visible fallback label.
- Keep `target="_blank"` and `rel="noopener noreferrer"` on rendered Smart Links.
- Never request or inject Jira-rendered HTML and never add client-side ADF parsing.
- Do not add description data to bulk Jira fetches or add per-link metadata/unfurl requests.
- Preserve loading, empty, error, clamp, expansion, and session-cache behavior.
- Do not modify or stage the unrelated alert-loading work already present in the checkout.
- No new analytics event: Smart Links are user-authored read-only description content; update the no-event allowlist reason without recording URLs or description text.
- The user requested one implementation commit after all verification passes.

---

### Task 1: Render safe ADF Smart Links at the API boundary

**Files:**
- Modify: `tests/test_oauth_eng_routes.py:1511`
- Modify: `backend/epm/home.py:806-857`

**Interfaces:**
- Consumes: `_safe_adf_href(value: Any) -> str` and `_render_adf_html_nodes(nodes: list) -> str`.
- Produces: safe anchor HTML for ADF nodes with `type` equal to `inlineCard` or `blockCard` and `attrs.url` accepted by `_safe_adf_href`.

- [x] **Step 1: Write the failing route regression test**

Add this method to `IssueDescriptionRouteTests` after `test_description_route_renders_adf_to_html`:

```python
def test_description_route_renders_safe_inline_and_block_smart_links(self):
    inline_url = 'https://docs.example.test/spec?mode="review"&section=quality'
    block_url = 'mailto:owner@example.test?subject=Quality & review'
    description = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "Tech design: "},
                    {"type": "inlineCard", "attrs": {"url": inline_url}},
                    {"type": "inlineCard", "attrs": {"url": "javascript:alert(1)"}},
                    {"type": "inlineCard", "attrs": {}},
                ],
            },
            {"type": "blockCard", "attrs": {"url": block_url}},
        ],
    }
    with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
         patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
             "fields": {"description": description},
         })):
        response = self.client.get("/api/issues/description?key=PROD-1")

    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
    html = response.get_json()["html"]
    self.assertEqual(html.count("<a href"), 2, html)
    self.assertIn(
        '<a href="https://docs.example.test/spec?mode=&quot;review&quot;&amp;section=quality" '
        'target="_blank" rel="noopener noreferrer">'
        'https://docs.example.test/spec?mode=&quot;review&quot;&amp;section=quality</a>',
        html,
    )
    self.assertIn(
        '<a href="mailto:owner@example.test?subject=Quality &amp; review" '
        'target="_blank" rel="noopener noreferrer">'
        'mailto:owner@example.test?subject=Quality &amp; review</a>',
        html,
    )
    self.assertNotIn("javascript:", html)
    self.assertFalse(response.get_json()["isEmpty"])
```

- [x] **Step 2: Run the new test and verify RED**

Run:

```bash
.venv/bin/python -m unittest tests.test_oauth_eng_routes.IssueDescriptionRouteTests.test_description_route_renders_safe_inline_and_block_smart_links
```

Expected: `FAIL`; the response contains no Smart Link anchors because `_render_adf_html_nodes` currently ignores card nodes without `content`.

- [x] **Step 3: Implement the minimal shared-renderer change**

Insert this branch in `_render_adf_html_nodes` after the `text` branch and before paragraph rendering:

```python
if node_type in {"inlineCard", "blockCard"}:
    href = _safe_adf_href((node.get("attrs") or {}).get("url"))
    if href:
        safe_href = html_module.escape(href, quote=True)
        safe_label = html_module.escape(href)
        parts.append(
            f'<a href="{safe_href}" target="_blank" rel="noopener noreferrer">{safe_label}</a>'
        )
    continue
```

- [x] **Step 4: Run focused route tests and verify GREEN**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_oauth_eng_routes.IssueDescriptionRouteTests.test_description_route_renders_safe_inline_and_block_smart_links \
  tests.test_oauth_eng_routes.IssueDescriptionRouteTests.test_description_route_xss_guard_strips_unsafe_href_but_keeps_safe_one \
  tests.test_oauth_eng_routes.IssueDescriptionRouteTests.test_description_route_whitespace_only_description_is_empty
```

Expected: `Ran 3 tests` and `OK` with no warnings.

---

### Task 2: Prove the Board panel exposes the rendered anchor

**Files:**
- Modify: `tests/ui/eng_group_board_panel.spec.js:46,420-443`

**Interfaces:**
- Consumes: server-produced description HTML inserted by `EngBoardEpicPanel` into `.m-desc-body`.
- Produces: Playwright evidence that a Smart Link anchor remains visible and actionable with the correct safe new-tab attributes.

- [x] **Step 1: Extend the existing loaded-description fixture**

Add a safe anchor to the beginning of `DESCRIPTION_HTML` without changing its length/clamp intent:

```javascript
const SMART_LINK_URL = 'https://docs.example.test/spec?section=quality';
const DESCRIPTION_HTML = `<p>Tech design: <a href="${SMART_LINK_URL}" target="_blank" rel="noopener noreferrer">${SMART_LINK_URL}</a></p>${'<p>Objective paragraph that is long enough to need clamping. </p>'.repeat(4)}<ul><li>One</li><li>Two</li></ul>${'<p>More body copy so the block exceeds 11.5rem. </p>'.repeat(8)}`;
```

- [x] **Step 2: Add anchor assertions to the loaded-description test**

Immediately after `await expect(body).toBeVisible()` add:

```javascript
const smartLink = body.getByRole('link', { name: SMART_LINK_URL });
await expect(smartLink).toBeVisible();
await expect(smartLink).toHaveAttribute('href', SMART_LINK_URL);
await expect(smartLink).toHaveAttribute('target', '_blank');
await expect(smartLink).toHaveAttribute('rel', 'noopener noreferrer');
```

- [x] **Step 3: Run the focused Board panel Playwright file**

Run:

```bash
npx playwright test tests/ui/eng_group_board_panel.spec.js
```

Expected: all tests in the file pass; `panel-loaded.png` and `panel-expanded.png` continue showing a readable, clamped/expanded description with the link present.

---

### Task 3: Align documentation and analytics review

**Files:**
- Modify: `docs/plans/EXEC-eng-group-board.md:1560-1574`
- Modify: `docs/README_ANALYTICS.md:122`
- Modify: `docs/agents/features/2026-08-08-planned-board-epic-description-smart-links.md`
- Modify: `docs/plans/EXEC-board-epic-description-smart-links.md`

**Interfaces:**
- Consumes: the implemented `inlineCard`/`blockCard` renderer behavior and verified test results.
- Produces: an accurate Group Board node policy, analytics impact record, and executed work artifacts.

- [x] **Step 1: Update the Group Board ADF policy**

Add this table row before `Anything else`:

```markdown
| Node | `inlineCard`, `blockCard` | Escaped `<a href>` using `attrs.url` as the fallback label, only when `_safe_adf_href` accepts the URL |
```

Remove `inlineCard` from the unsupported-node sentence and state that unsafe/missing Smart Link URLs render nothing.

- [x] **Step 2: Update the analytics no-event allowlist**

Extend the `ENG Board epic detail panel open` row to cover Smart Link rendering and explain that user-authored destinations and description text are not collected; the existing `eng_issue_description` API reliability event remains sufficient.

- [x] **Step 3: Mark work artifacts executed after verification**

Rename the design record to:

```text
docs/agents/features/2026-08-08-executed-board-epic-description-smart-links.md
```

Change its status to `executed`, set the outcome to `Implemented as planned`, and state that implementation/tests are now the source of truth. In this plan, check completed steps and add an `Outcome` section containing the actual verification results.

---

### Task 4: Final verification and scoped commit

**Files:**
- Verify all files changed by Tasks 1-3.
- Do not stage unrelated modified/untracked files.

**Interfaces:**
- Consumes: completed implementation, regression tests, and documentation.
- Produces: evidence-backed completion and one atomic commit.

- [x] **Step 1: Run the full Python suite**

Run:

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected: all tests pass with no runtime errors. Existing unrelated file-handle `ResourceWarning`s
may still be emitted by the legacy suite and must be reported rather than attributed to this change.

- [x] **Step 2: Run focused frontend checks and build**

Run:

```bash
npx playwright test tests/ui/eng_group_board_panel.spec.js
npm run build
```

Expected: the focused Playwright file passes and the build completes successfully. If concurrent,
unrelated frontend source changes cause generated `frontend/dist` diffs, leave those files unstaged.

- [x] **Step 3: Inspect visual proof and diff**

Open `tmp/eng-group-board-panel/panel-loaded.png` and `panel-expanded.png`. Confirm the link is visible and the existing clamp/expanded layout remains readable. Run:

```bash
git diff --check
git status --short
git diff -- backend/epm/home.py tests/test_oauth_eng_routes.py tests/ui/eng_group_board_panel.spec.js docs/plans/EXEC-eng-group-board.md docs/README_ANALYTICS.md docs/agents/features/2026-08-08-executed-board-epic-description-smart-links.md docs/plans/EXEC-board-epic-description-smart-links.md
```

Expected: no whitespace errors; every scoped line traces to Smart Link support; unrelated alert-loading changes remain outside the scoped diff/staging set.

- [x] **Step 4: Commit only scoped files**

Stage exactly the scoped files and commit:

```bash
git add backend/epm/home.py tests/test_oauth_eng_routes.py tests/ui/eng_group_board_panel.spec.js docs/plans/EXEC-eng-group-board.md docs/README_ANALYTICS.md docs/plans/EXEC-board-epic-description-smart-links.md
git add -A -- docs/agents/features/2026-08-08-planned-board-epic-description-smart-links.md docs/agents/features/2026-08-08-executed-board-epic-description-smart-links.md
git commit -m "Support Smart Links in Board descriptions"
```

Expected: one commit containing only Smart Link implementation, tests, and documentation.

## Outcome

Implemented as planned. The route-level regression first failed with zero anchors and
`<p>Tech design: </p>`, then the focused Smart Link/XSS/empty-description set passed `3/3` after
the minimal shared-renderer change. The full Python suite passed `1216` tests with `1` skipped; it
emitted existing unrelated file-handle `ResourceWarning`s. The focused Board panel Playwright file
passed `19/19` with its existing Node deprecation/environment warnings. `npm run build` completed
successfully; generated dashboard assets changed only because unrelated frontend source edits
appeared concurrently and are excluded from this task's staging set. Fresh collapsed and expanded
screenshots show the Smart Link clearly and preserve the description clamp and panel layout.
