// Asserting runtime gates for the App() decomposition (B0b). Opt-in: the probe bundle (render counter) is built only
// under JEP_RUNTIME_PROBE=1 and the ceilings are meaningful only under load: run with --workers=4.
//   JEP_RUNTIME_PROBE=1 npx playwright test tests/ui/app_render_counts.spec.js --browser=chromium --workers=4
// Mocked pages only: the host just scopes localStorage, and it must never be the live 5050 server.
process.env.JEP_TEST_BASE_URL ||= 'http://localhost:5051';
const { test, expect } = require('@playwright/test');
const { buildRuntimeProbeBundle } = require('./runtime_probe_helpers');
const { appBaseUrl, installPinFixture, settle } = require('./eng_alert_pin_fixture');

const PREFS_KEY = 'jira_dashboard_ui_prefs_v1';
const PROBE = process.env.JEP_RUNTIME_PROBE === '1';
const MEASURE = process.env.JEP_B0B_MEASURE === '1';

// Recorded from the unmodified B0a base (HEAD dc078ebe), min-of-N over repeated --workers=4 runs, plus a margin.
// renders: App() body executions (the counter increments only there, dashboard.jsx perf block).
// snapshot: executions of the group-snapshot effect (deps [activeGroupId, groupStateSnapshot, planningScopeKey]); an
//   unstable groupValues memo would run it on every render with App render counts unchanged.
// writes: localStorage.setItem calls, and the exact set of keys written. A lone alerts toggle and a lone Project Track
//   preference write the ui-prefs object since B0a, so those baselines include that write.
// Observed over 8 runs under --workers=4 (min..max): filterChange 2, alertToggle 4, alertPin 7, groupSwitchAtoB 18..23,
// groupSwitchBtoA 8, statsViewSwitch 2, dependencyHover 4, scenarioHover 4 renders. Ceilings add a margin of at least 2
// renders (25% on the group switch); snapshot-effect runs and write counts add 1-2; hovers must not touch the snapshot
// effect beyond what was observed. The hover counts are enter plus leave and are non-zero by design: the dependency hover
// state (dependencyHover) and the Scenario tooltip state live in App().
const KEYS = ['jira_dashboard_planning_state_v1', 'jira_dashboard_team_selection_state_v1', 'jira_dashboard_ui_prefs_v1'];
const NO_PREFS = KEYS.slice(0, 2);
const CEILINGS = {
    filterChange: { renders: 4, snapshotRuns: 2, storageWrites: 5, storageKeys: KEYS },
    alertToggle: { renders: 6, snapshotRuns: 3, storageWrites: 7, storageKeys: KEYS },
    alertPin: { renders: 9, snapshotRuns: 0, storageWrites: 10, storageKeys: NO_PREFS },
    groupSwitchAtoB: { renders: 27, snapshotRuns: 10, storageWrites: 31, storageKeys: KEYS },
    groupSwitchBtoA: { renders: 10, snapshotRuns: 4, storageWrites: 16, storageKeys: KEYS },
    statsViewSwitch: { renders: 4, snapshotRuns: 2, storageWrites: 5, storageKeys: KEYS },
    dependencyHover: { renders: 6, snapshotRuns: 0, storageWrites: 6, storageKeys: NO_PREFS },
    scenarioHover: { renders: 6, snapshotRuns: 3, storageWrites: 6, storageKeys: NO_PREFS },
};

test.skip(!PROBE, 'opt-in runtime probe (JEP_RUNTIME_PROBE=1)');

let probeBundle;
test.beforeAll(() => {
    if (!PROBE) return;
    let text = buildRuntimeProbeBundle();
    // Instrument the group-snapshot effect inside this spec only; frontend/src is never edited.
    const entry = /(useEffect\w*\(\(\) => \{\s*)(if \(!activeGroupId\) return;\s*if \(activeGroupRef\.current !== activeGroupId\) return;\s*if \(planningScopeKey && planningHydratedScopeRef\.current !== planningScopeKey\) return;\s*)(groupStateRef\.current\.set\(activeGroupId, stripPendingOverlays\()/g;
    const matches = text.match(entry) || [];
    if (matches.length !== 1) throw new Error(`group-snapshot effect anchor must occur exactly once, found ${matches.length}`);
    text = text.replace(entry, '$1window.__JEP_SNAPSHOT_EFFECT_RUNS__ = (window.__JEP_SNAPSHOT_EFFECT_RUNS__ || 0) + 1;\n$2window.__JEP_SNAPSHOT_EFFECT_WRITES__ = (window.__JEP_SNAPSHOT_EFFECT_WRITES__ || 0) + 1;\n$3');
    probeBundle = text;
});

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function openProbe(page, { prefs = {}, scenario = false } = {}) {
    await installPinFixture(page, { prefs });
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200, contentType: 'application/javascript', body: probeBundle,
    }));
    await page.route('**/api/dependencies', route => json(route, { dependencies: {
        'PIN-8': [{ key: 'PIN-9', category: 'block', direction: 'inward', dependentKey: 'PIN-8', prereqKey: 'PIN-9', status: 'To Do' }],
    } }));
    if (scenario) await page.route('**/api/scenario', route => (route.request().method() === 'POST' ? json(route, scenarioPayload()) : route.fallback()));
    await page.addInitScript(() => {
        window.history.replaceState(null, '', '/?perf=1');
        window.__JEP_STORAGE_WRITES__ = [];
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function setItem(key, value) {
            if (this === window.localStorage) window.__JEP_STORAGE_WRITES__.push(String(key));
            return original.call(this, key, value);
        };
    });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    await settle(page);
    await quiet(page);
}

function scenarioPayload() {
    const teams = ['Scenario Team 1', 'Scenario Team 2'];
    return {
        jira_base_url: 'https://jira.example',
        config: { start_date: '2026-04-01', quarter_end_date: '2026-06-30' },
        sprintBoundaries: { previous: { startDate: '2026-03-18' }, selected: { startDate: '2026-04-01', endDate: '2026-04-15' }, next: { endDate: '2026-04-29' } },
        summary: { late_items: [], critical_path: [], unschedulable: [], bottleneck_lanes: [] },
        dependencies: [],
        capacity_by_team: Object.fromEntries(teams.map(team => [team, { size: 3, devLead: `${team} Lead` }])),
        issues: teams.map((team, index) => ({
            key: `PROD-${index + 1}`, summary: `Build scenario lane ${index + 1}`, epicKey: 'PROD-EPIC', epicSummary: 'Product delivery epic',
            team, assignee: `${team} Owner`, sp: 2, start: '2026-04-06', end: '2026-04-09',
        })),
    };
}

// Network idle plus 350 ms, as the smoke contract does, then animations and scrolling settle.
async function quiet(page) {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(350);
    await settle(page);
    await page.waitForLoadState('networkidle');
}

const readProbe = page => page.evaluate(() => ({
    renders: window.__JEP_EXTRACTION_PERF__().renders,
    snapshotRuns: window.__JEP_SNAPSHOT_EFFECT_RUNS__ || 0,
    snapshotWrites: window.__JEP_SNAPSHOT_EFFECT_WRITES__ || 0,
    storage: [...window.__JEP_STORAGE_WRITES__],
}));

// Runs `action`, waits for quiet, and returns the deltas of every counter.
async function measure(page, name, action, testInfo) {
    await quiet(page);
    const before = await readProbe(page);
    await action();
    await quiet(page);
    const after = await readProbe(page);
    const written = after.storage.slice(before.storage.length);
    const result = {
        renders: after.renders - before.renders,
        snapshotRuns: after.snapshotRuns - before.snapshotRuns,
        snapshotWrites: after.snapshotWrites - before.snapshotWrites,
        storageWrites: written.length,
        storageKeys: [...new Set(written)].sort(),
    };
    testInfo.annotations.push({ type: 'b0b-measure', description: `${name} ${JSON.stringify(result)}` });
    console.log('B0B_MEASURE', JSON.stringify({ name, ...result }));
    return result;
}

// The recorded ceilings: a count above one fails; an exact key set is part of the contract.
function expectWithinCeiling(name, result) {
    if (MEASURE) return;
    const ceiling = CEILINGS[name];
    expect(ceiling, `no recorded ceiling for ${name}`).toBeTruthy();
    expect(result.renders, `${name}: App renders`).toBeLessThanOrEqual(ceiling.renders);
    expect(result.snapshotRuns, `${name}: group-snapshot effect runs`).toBeLessThanOrEqual(ceiling.snapshotRuns);
    expect(result.storageWrites, `${name}: localStorage.setItem writes`).toBeLessThanOrEqual(ceiling.storageWrites);
    expect(result.storageKeys, `${name}: localStorage keys written`).toEqual(ceiling.storageKeys);
}

async function switchGroup(page, name, id) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    await page.locator('.view-selector .group-dropdown-toggle').click();
    await page.locator('.view-selector .group-dropdown-option', { hasText: name }).click();
    await expect(page.locator('.view-selector .group-dropdown-toggle')).toContainText(name);
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).activeGroupId, PREFS_KEY)).toBe(id);
}

test('App render counts: a filter change, an alert toggle, an alert pin and a group switch', async ({ page }, testInfo) => {
    test.setTimeout(90000);
    await openProbe(page);

    const filter = await measure(page, 'filterChange', async () => {
        await page.locator('.fb-trigger', { hasText: 'Filters' }).click();
        await expect(page.locator('.pop-host .popover[aria-label="Filters"]')).toBeVisible();
        await page.locator('.pop-group[data-facet="status"] [data-option="Done"]').click();
        await expect(page.locator('.pop-group[data-facet="status"] [data-option="Done"]')).toHaveAttribute('aria-pressed', 'false');
        await page.keyboard.press('Escape');
        await expect(page.locator('.pop-host .popover')).toHaveCount(0);
    }, testInfo);
    expectWithinCeiling('filterChange', filter);

    const toggle = await measure(page, 'alertToggle', async () => {
        await page.locator('#eng-alert-blocked .alert-toggle').click();
        await expect(page.locator('#eng-alert-blocked')).toHaveClass(/collapsed/);
    }, testInfo);
    expectWithinCeiling('alertToggle', toggle);

    const pin = await measure(page, 'alertPin', async () => {
        await page.locator('#eng-alert-missing .alert-story-link').first().click();
        await expect(page.locator('.alert-story--pinned')).toHaveCount(1);
    }, testInfo);
    expectWithinCeiling('alertPin', pin);

    const toB = await measure(page, 'groupSwitchAtoB', () => switchGroup(page, 'Second', 'grp-second'), testInfo);
    expectWithinCeiling('groupSwitchAtoB', toB);
    const toA = await measure(page, 'groupSwitchBtoA', () => switchGroup(page, 'Default', 'grp-default'), testInfo);
    expectWithinCeiling('groupSwitchBtoA', toA);
});

test('App render counts: a Stats view switch', async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await openProbe(page, { prefs: { showStats: true, statsView: 'teams' } });
    const stats = await measure(page, 'statsViewSwitch', async () => {
        await page.locator('.stats-panel.open .stats-view-toggle').getByRole('radio', { name: 'Priority', exact: true }).click();
        await expect(page.locator('.stats-panel.open .stats-view-toggle').getByRole('radio', { name: 'Priority', exact: true })).toHaveAttribute('aria-checked', 'true');
    }, testInfo);
    expectWithinCeiling('statsViewSwitch', stats);
});

test('App hover: a dependency chip hover re-renders App() only within its ceiling', async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await openProbe(page);
    const chip = page.locator('[data-dep-chip]').first();
    await chip.scrollIntoViewIfNeeded();
    await settle(page);
    const box = await chip.boundingBox();
    const hover = await measure(page, 'dependencyHover', async () => {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        // The hovered Story's dependency chain is highlighted (other cards are dimmed) while the pointer rests on it.
        await expect(page.locator('.task-item.is-dimmed').first()).toBeVisible();
        await page.mouse.move(2, 2);
        await expect(page.locator('.task-item.is-dimmed')).toHaveCount(0);
    }, testInfo);
    expectWithinCeiling('dependencyHover', hover);
});

test('App hover: a Scenario bar hover re-renders App() only within its ceiling', async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await openProbe(page, { scenario: true });
    await page.getByRole('radio', { name: 'Scenario', exact: true }).click();
    await page.getByRole('button', { name: 'Run Scenario' }).click();
    const bar = page.locator('.scenario-bar').first();
    await expect(bar).toBeVisible();
    await quiet(page);
    const box = await bar.boundingBox();
    const hover = await measure(page, 'scenarioHover', async () => {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await expect(page.locator('.scenario-tooltip.visible')).toBeVisible();
        await page.mouse.move(2, 2);
        await expect(page.locator('.scenario-tooltip.visible')).toHaveCount(0);
    }, testInfo);
    expectWithinCeiling('scenarioHover', hover);
});
