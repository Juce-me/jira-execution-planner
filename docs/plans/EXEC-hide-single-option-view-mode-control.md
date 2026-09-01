# Hide Single-Option Dashboard View Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Ready for execution. This is a small, self-contained frontend change suitable for a 5.3 coding model. Execute it inline as one task; do not split it across agents.

**Goal:** Hide the dashboard ENG/EPM view segmented control whenever EPM navigation is unavailable, while preserving the existing two-option control whenever the user can open EPM.

**Architecture:** Keep `showEpmNavigation` as the single availability decision. Make the existing `renderViewSwitch()` renderer return `null` when that decision is false, so its only call site and the shared `SegmentedControl` remain unchanged. Extend the existing Home-token Playwright coverage to prove the control is absent while disconnected, appears after connection, remains available in Basic auth, and disappears again after revocation or a backend prerequisite failure.

**Tech Stack:** React 19, shared `SegmentedControl`, Node 20, Playwright, esbuild

---

## Scope and file map

Allowed implementation files:

- Modify `frontend/src/dashboard.jsx`: guard the dashboard view-switch renderer with `showEpmNavigation`.
- Modify `tests/ui/epm-home-token-gating.spec.js`: replace single-ENG-option expectations with whole-control visibility assertions and retain a settled visual proof.
- Rebuild generated `frontend/dist/dashboard.js` and `frontend/dist/dashboard.js.map` with `npm run build`; do not hand-edit either file.

Do not change `SegmentedControl`, CSS, auth/token state, EPM availability rules, settings behavior, API requests, saved preferences, or analytics event definitions. No new analytics event is required: when the control is hidden there is no user choice to record, and when it is visible the existing `dashboard_view` selection event remains authoritative.

## Expected behavior and forbidden regressions

- OAuth/DB user without an active Home token: no `Dashboard view` radiogroup is rendered; ENG content and the rest of the header remain visible.
- Basic auth user: the existing ENG/EPM radiogroup remains visible without a per-user Home token.
- OAuth/DB user who connects a Home token: the existing ENG/EPM radiogroup appears without a restart.
- Revoking the token, or receiving the existing backend Home-token prerequisite state, removes the entire radiogroup and returns the dashboard to ENG using the existing state effect.
- The shared `SegmentedControl` markup, styling, keyboard semantics, and analytics handler are unchanged when rendered.
- No new request, loading dependency, CSS rule, or layout placeholder is introduced.

### Task 1: Hide the redundant dashboard view selector

**Files:**

- Modify: `tests/ui/epm-home-token-gating.spec.js`
- Modify: `frontend/src/dashboard.jsx:12392-12412`
- Generated: `frontend/dist/dashboard.js`
- Generated: `frontend/dist/dashboard.js.map`

- [ ] **Step 1: Verify the execution baseline and file map**

Run:

```bash
git status --short --branch
test -f frontend/src/dashboard.jsx
test -f tests/ui/epm-home-token-gating.spec.js
```

Expected: execution is on a dedicated non-`main` branch; both file checks exit `0`; unrelated worktree changes are identified and left untouched. Stop if either named file is missing or if uncertain user edits overlap these lines.

- [ ] **Step 2: Change the Playwright expectations first**

In `tests/ui/epm-home-token-gating.spec.js`, update the disconnected-state test from checking for one ENG radio to checking that the whole radiogroup is absent, and capture the settled header:

```js
    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    await expect(viewSwitch).toHaveCount(0);
    await page.screenshot({
        path: '/tmp/epm-home-token-gating-no-view-switch.png',
        animations: 'disabled',
        fullPage: false,
    });
    expect(epmMetadataCalls(fixture.calls)).toEqual([]);
```

In `connecting and revoking Home token updates EPM visibility without restart`, keep one `viewSwitch` locator for the whole lifecycle and assert the whole radiogroup is absent before connection and after revocation:

```js
    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    await expect(viewSwitch).toHaveCount(0);
```

After connection, keep the existing EPM-radio visibility/click assertions. Replace the post-revocation EPM-radio count assertion with:

```js
    await expect(viewSwitch).toHaveCount(0);
```

In `backend Home-token prerequisite refreshes status and clears stale EPM content`, replace the EPM-radio-only absence assertion with:

```js
    const viewSwitch = page.getByRole('radiogroup', { name: 'Dashboard view' });
    await expect(viewSwitch).toHaveCount(0);
```

Do not change the Basic-auth test: it must continue proving that EPM is visible and selected without a per-user Home token.

- [ ] **Step 3: Run the changed disconnected test and verify RED**

Run:

```bash
npx playwright test tests/ui/epm-home-token-gating.spec.js --grep "dashboard without Home token hides EPM"
```

Expected: FAIL because the current renderer still produces one `Dashboard view` radiogroup containing only ENG (`Expected: 0`, `Received: 1`). If it fails for fixture, server, or syntax reasons, fix the test setup before touching production code.

- [ ] **Step 4: Add the minimal render guard**

Replace the current `renderViewSwitch` body in `frontend/src/dashboard.jsx` with:

```jsx
            const renderViewSwitch = () => {
                if (!showEpmNavigation) return null;
                return (
                    <SegmentedControl
                        className="view-mode-control"
                        ariaLabel="Dashboard view"
                        value={selectedView}
                        onChange={(nextView) => {
                            trackSelectContent('dashboard_view', nextView, { from_view: currentDashboardView() });
                            setSelectedView(nextView);
                        }}
                        options={[
                            { value: 'eng', label: 'ENG' },
                            { value: 'epm', label: 'EPM' },
                        ]}
                    />
                );
            };
```

The early return is the behavior change. Removing the now-unreachable conditional option/value/handler branches keeps the renderer internally consistent; do not move the availability rule into the shared component or its call site.

- [ ] **Step 5: Run the complete Home-token gating spec and verify GREEN**

Run:

```bash
npx playwright test tests/ui/epm-home-token-gating.spec.js
```

Expected: all tests in the file PASS. This proves the disconnected, Basic-auth, connection, revocation, and backend-prerequisite paths together.

- [ ] **Step 6: Inspect the visual proof**

Open `/tmp/epm-home-token-gating-no-view-switch.png` with the available image-viewing tool.

Expected: the header contains no single ENG segmented pill and no empty gap reserved for it; Search, Jira export, Refresh, and Settings remain visible and aligned. The screenshot is temporary QA evidence and must not be committed.

- [ ] **Step 7: Rebuild generated frontend output**

Run:

```bash
npm run build
```

Expected: exit `0`; esbuild regenerates `frontend/dist/dashboard.js` and `frontend/dist/dashboard.js.map` from source. Do not hand-edit generated output.

- [ ] **Step 8: Run focused regression verification**

Run:

```bash
node --test tests/test_epm_view_source_guards.js
npm run test:frontend:unit
npx playwright test tests/ui/epm-home-token-gating.spec.js
git diff --check
```

Expected: every command exits `0`; the focused source guards, all frontend unit tests, and the Home-token UI contract pass; `git diff --check` reports no whitespace errors.

- [ ] **Step 9: Review scope and generated output**

Run:

```bash
git status --short
git diff -- frontend/src/dashboard.jsx tests/ui/epm-home-token-gating.spec.js
git diff --stat -- frontend/dist/dashboard.js frontend/dist/dashboard.js.map
```

Expected: only the two source/test files and the two generated bundle files are implementation changes. Every changed line traces to hiding the redundant control, its regression coverage, or the required build output. No CSS, API, auth, settings, analytics taxonomy, or unrelated documentation changes are present.

- [ ] **Step 10: Report completion and stop before Git publication**

Report the exact commands and results, the inspected screenshot path, and the final changed-file list. Do not commit, push, merge, or open a PR unless the user explicitly authorizes that Git action. If commit authorization is later given, use:

```bash
git add frontend/src/dashboard.jsx tests/ui/epm-home-token-gating.spec.js frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "Hide unavailable dashboard view selector"
```

Before any later push, follow the repository rule to run the full Python suite, review `git log --oneline -5`, and wait for explicit user confirmation.

## Acceptance criteria

- The `Dashboard view` radiogroup has count `0` whenever `showEpmNavigation` is false.
- The radiogroup still offers both ENG and EPM whenever `showEpmNavigation` is true.
- Runtime connection and revocation update the control without restarting the app.
- No EPM metadata startup calls are introduced for disconnected users.
- The temporary screenshot visibly confirms that removing the control leaves the header aligned.
- Focused Playwright, frontend unit/source-guard tests, build, and diff checks pass.

## Plan self-review

- Spec coverage: the approved hide/show behavior, Basic-auth preservation, runtime connection lifecycle, generated output, analytics allowlist, and visual verification are all assigned concrete checks.
- Scope: one React renderer and its existing behavioral test; no shared-component or CSS change.
- Placeholders: none.
- Gate status: `GATE-05-home-write-capability.md` remains blocked; this frontend-only plan adds no Home/Townsquare write path and does not require the destructive write probe.
