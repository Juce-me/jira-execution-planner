const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountBundledHook } = require('./react_hook_harness');

const ENTRY = path.join(__dirname, '..', 'frontend', 'src', 'shareView', 'useShareViewApply.js');
const PHASES = { ABSENT: 'absent', PENDING: 'pending', RUNNING: 'running', DONE: 'done', PARTIAL: 'partial', DROPPED: 'dropped', CANCELLED: 'cancelled' };
const ALERT_KEYS = ['missing', 'blocked', 'followup', 'backlog', 'missingTeam', 'missingLabels', 'needsStories', 'waiting', 'empty', 'done'];

// The store, the controller and the focus capture have their own tests; the hook only wires them, so they are doubles that
// record calls and keep their binding shapes. The codec and the view defaults are the real modules.
function createDoubles() {
    const calls = [];
    const doubles = { calls, snapshot: { phase: PHASES.PENDING, stage: null, entry: { state: {}, reported: [] }, hold: true, terminal: false, notice: null }, focus: null, rowsMode: null };
    const store = {
        SHARE_VIEW_PHASES: PHASES,
        getShareViewSnapshot: () => doubles.snapshot,
        subscribeShareView: () => () => {},
        dismissShareViewNotice: () => calls.push(['dismissNotice']),
    };
    const controller = {
        noteCommit: () => calls.push(['noteCommit']),
        evaluate: () => calls.push(['evaluate']),
        flushTrack: (track, ready) => calls.push(['flushTrack', track, ready]),
        noteInterrupt: kind => calls.push(['noteInterrupt', kind]),
        isPaused: () => doubles.paused === true,
    };
    return {
        doubles,
        modules: {
            './store.js': store,
            './applyController.js': { createApplyController: (config) => { calls.push(['createController', typeof config.readOptions]); doubles.config = config; return controller; } },
            './focusCapture.js': {
                captureShareViewFocus: (args) => { calls.push(['captureFocus', args]); return doubles.focus; },
                readPlanningRowsMode: (root) => { calls.push(['readRowsMode', root]); return doubles.rowsMode; },
            },
        },
    };
}

function makeOptions(overrides = {}) {
    return {
        selectedSprint: 41, groupsLoading: false, onboardingRequired: false, adminSettingsGate: { status: 'clear' }, engLoadsTasks: true,
        teamSelectionScopeKey: 'team-selection::41::grp-a', teamSelectionHydratedScopeRef: { current: 'team-selection::41::grp-a' },
        sprintCatalogState: { authority: 'validated' }, selectedView: 'eng', activeEngMode: 'catch-up', activeGroupId: 'grp-a',
        buildGroupStateSnapshot: () => ({
            selectedTeams: ['all'], engStatusFilter: { hidden: ['Killed'] }, engPriorityFilter: null, engProjectTrackFilter: undefined,
            showProduct: true, showTech: true, groupByInitiativeChoice: null, statsView: 'teams', cohortStartQuarter: '2026Q3', cohortEndQuarter: '2026Q3', showAlertsPanel: true,
        }),
        searchQuery: 'login', engEpicSort: 'priority', planningLayout: 'table', boardStrictScope: '',
        excludedCapacityStartSprintId: '', excludedCapacityEndSprintId: '', alertCounts: {},
        alertFlags: Object.fromEntries(ALERT_KEYS.map(key => [key, [true, () => {}]])),
        trackShareViewAction: () => {}, analyticsReady: false,
        ...overrides,
    };
}

function withBrowser(fn) {
    const timers = [];
    const originals = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
    const listeners = [];
    globalThis.setInterval = (callback, delay) => { timers.push({ callback, delay, cleared: false }); return timers.length - 1; };
    globalThis.clearInterval = id => { timers[id].cleared = true; };
    globalThis.document = {
        visibilityState: 'visible', querySelector: () => null,
        addEventListener: (type, handler, options) => listeners.push({ type, handler, options }),
        removeEventListener: (type, handler) => { const index = listeners.findIndex(entry => entry.type === type && entry.handler === handler); if (index >= 0) listeners.splice(index, 1); },
    };
    globalThis.window = { location: { origin: 'https://planner.example' } };
    try { return fn({ timers, listeners }); } finally {
        Object.assign(globalThis, originals);
        delete globalThis.document;
        delete globalThis.window;
    }
}

// The real authRequired, interactionGuard, captureState, codec and viewDefaults modules are bundled; only the doubles' specifiers are external.
function mountHook(doubles, options) {
    return mountBundledHook({ entry: ENTRY, exportName: 'useShareViewApply', modules: doubles.modules, makeProps: () => options });
}

function mountEarly(exportName, modules) {
    return mountBundledHook({ entry: ENTRY, exportName, modules, makeProps: () => ({}) });
}

test('the early hooks read the hold, the terminal state and the Planning table key from the store snapshot', () => {
    const { doubles, modules } = createDoubles();
    const hold = mountEarly('useShareViewHold', modules);
    assert.equal(hold.render(), true);
    doubles.snapshot = { ...doubles.snapshot, hold: false };
    assert.equal(hold.render(), false);

    const terminal = mountEarly('useShareViewApplyTerminal', modules);
    assert.equal(terminal.render(), false, 'a pending link is not terminal');
    doubles.snapshot = { ...doubles.snapshot, phase: PHASES.DONE, terminal: true };
    assert.equal(terminal.render(), true);
    doubles.snapshot = { ...doubles.snapshot, phase: PHASES.ABSENT, terminal: false };
    assert.equal(terminal.render(), true, 'no link at all counts as settled');

    const key = mountEarly('useShareViewPlanningTableKey', modules);
    for (const stage of [null, 'A', 'B']) {
        doubles.snapshot = { ...doubles.snapshot, phase: PHASES.RUNNING, terminal: false, stage };
        assert.equal(key.render(), 0, `before Stage C (${stage})`);
    }
    for (const stage of ['C', 'D']) {
        doubles.snapshot = { ...doubles.snapshot, stage };
        assert.equal(key.render(), 1, `from Stage C on (${stage})`);
    }
    doubles.snapshot = { ...doubles.snapshot, phase: PHASES.DONE, terminal: true };
    assert.equal(key.render(), 1, 'the key stays once the link ended, so the table is not remounted a second time');
});

test('every commit refreshes the options, counts the commit, steps the apply and flushes analytics', () => withBrowser(() => {
    const { doubles, modules } = createDoubles();
    const options = makeOptions({ analyticsReady: true });
    const hook = mountHook({ modules }, options);
    hook.render();
    assert.deepEqual(doubles.calls.slice(0, 4).map(call => call[0]), ['createController', 'noteCommit', 'evaluate', 'flushTrack']);
    assert.equal(doubles.calls[3][1], options.trackShareViewAction);
    assert.equal(doubles.calls[3][2], true);
    assert.equal(doubles.config.readOptions().searchQuery, 'login', 'the controller reads the latest committed options');
    const next = makeOptions({ searchQuery: 'next' });
    hook.render(next);
    assert.equal(doubles.config.readOptions().searchQuery, 'next');
    assert.equal(doubles.calls.filter(call => call[0] === 'createController').length, 1, 'one controller for the App lifetime');
    assert.equal(doubles.calls.filter(call => call[0] === 'noteCommit').length, 2);
    hook.unmount();
}));

test('a pending link steps on an interval and arms the interaction guard; a settled link does neither', () => withBrowser(({ timers, listeners }) => {
    const { doubles, modules } = createDoubles();
    const hook = mountHook({ modules }, makeOptions());
    hook.render();
    assert.deepEqual(timers.map(timer => timer.delay), [50]);
    assert.deepEqual(listeners.map(entry => entry.type).sort(), ['keydown', 'pointerdown', 'touchmove', 'touchstart', 'wheel']);
    const before = doubles.calls.length;
    timers[0].callback();
    assert.deepEqual(doubles.calls.slice(before), [['evaluate']]);
    const keydown = listeners.find(entry => entry.type === 'keydown');
    keydown.handler({ type: 'keydown', key: 'a' });
    assert.deepEqual(doubles.calls.slice(before + 1), [['noteInterrupt', 'deliberate'], ['evaluate']]);
    doubles.paused = true;
    keydown.handler({ type: 'keydown', key: 'b' });
    assert.equal(doubles.calls.filter(call => call[0] === 'noteInterrupt').length, 1, 'a paused link ignores interactions');
    doubles.snapshot = { ...doubles.snapshot, phase: PHASES.DONE, terminal: true };
    hook.render();
    assert.equal(timers[0].cleared, true);
    assert.deepEqual(listeners, []);
    hook.unmount();
}));

test('the Share control is disabled until the scope is settled, whatever the blocker', () => withBrowser(() => {
    const blockers = [
        { selectedSprint: null }, { groupsLoading: true }, { onboardingRequired: true }, { adminSettingsGate: { status: 'missing' } },
        { teamSelectionScopeKey: '' }, { teamSelectionHydratedScopeRef: { current: 'another-scope' } },
        { sprintCatalogState: { authority: 'display_only' } }, { selectedView: 'epm' }, { activeEngMode: 'scenario' },
    ];
    for (const blocker of blockers) {
        const { doubles, modules } = createDoubles();
        doubles.snapshot = { phase: PHASES.ABSENT, stage: null, entry: null, hold: false, terminal: true, notice: null };
        const hook = mountHook({ modules }, makeOptions(blocker));
        hook.render();
        assert.equal(hook.render().shareDisabled, true, JSON.stringify(blocker));
    }
    // A source-only Statistics view and a strict Board scope load no task list, so no Team hydrate ever runs there and Share does not wait for one.
    for (const [overrides, disabled] of [
        [{ engLoadsTasks: false, teamSelectionHydratedScopeRef: { current: '' } }, false],
        [{ engLoadsTasks: false, teamSelectionScopeKey: '', teamSelectionHydratedScopeRef: { current: '' } }, true],
        [{ engLoadsTasks: true, teamSelectionHydratedScopeRef: { current: '' } }, true],
    ]) {
        const { doubles: scoped, modules: scopedModules } = createDoubles();
        scoped.snapshot = { phase: PHASES.ABSENT, stage: null, entry: null, hold: false, terminal: true, notice: null };
        const scopedHook = mountHook({ modules: scopedModules }, makeOptions(overrides));
        scopedHook.render();
        assert.equal(scopedHook.render().shareDisabled, disabled, JSON.stringify(overrides));
    }
    const { doubles, modules } = createDoubles();
    doubles.snapshot = { phase: PHASES.ABSENT, stage: null, entry: null, hold: false, terminal: true, notice: null };
    const hook = mountHook({ modules }, makeOptions());
    assert.equal(hook.render().shareDisabled, true, 'the first render is disabled until a commit settled it');
    assert.equal(hook.render().shareDisabled, false);
    doubles.snapshot = { phase: PHASES.PENDING, stage: null, entry: { state: {}, reported: [] }, hold: true, terminal: false, notice: null };
    hook.render();
    assert.equal(hook.render().shareDisabled, true, 'a link that is still applying blocks sharing');
}));

test('the hook returns the binding shape with the store notice and dismiss action', () => withBrowser(() => {
    const { doubles, modules } = createDoubles();
    doubles.snapshot = { phase: PHASES.PARTIAL, stage: null, entry: null, hold: false, terminal: true, notice: { kind: 'partial', categories: ['teams'] } };
    const hook = mountHook({ modules }, makeOptions());
    const result = hook.render();
    assert.deepEqual(Object.keys(result).sort(), ['applyTerminal', 'captureShareUrl', 'copyOwner', 'dismissNotice', 'notice', 'shareDisabled']);
    assert.deepEqual(result.notice, { kind: 'partial', categories: ['teams'] });
    assert.equal(result.applyTerminal, true);
    result.dismissNotice();
    assert.deepEqual(doubles.calls.at(-1), ['dismissNotice']);
}));

test('header copies view settings without a focus target at every scroll position', () => withBrowser(() => {
    const { doubles, modules } = createDoubles();
    doubles.snapshot = { phase: PHASES.ABSENT, stage: null, entry: null, hold: false, terminal: true, notice: null };
    doubles.focus = { kind: 'epic', key: 'PROJ-1' };
    const hook = mountHook({ modules }, makeOptions());
    hook.render();
    const { captureShareUrl } = hook.render();
    const result = captureShareUrl();
    assert.equal(typeof result.then, 'undefined', 'the click handler copies inside the user gesture, so the result is not a promise');
    assert.deepEqual(result, { ok: true, url: 'https://planner.example/?v=1&mode=catch-up&group=grp-a&sprint=41&find=login', dropped: [] });
    assert.equal(doubles.calls.some(call => call[0] === 'captureFocus'), false, 'viewport focus is never captured');
    assert.equal(doubles.calls.find(call => call[0] === 'readRowsMode')[1], globalThis.document, 'the rows mode is read from the rendered table');

    doubles.rowsMode = 'story';
    doubles.focus = null;
    const planning = mountHook({ modules }, makeOptions({ activeEngMode: 'planning' }));
    planning.render();
    const { url } = planning.render().captureShareUrl();
    assert.equal(url, 'https://planner.example/?v=1&mode=planning&group=grp-a&sprint=41&rows=stories&find=login');
}));

test('an alert group target is shareable from Catch Up only, and carries the group with its card expanded', () => withBrowser(() => {
    const { doubles, modules } = createDoubles();
    doubles.snapshot = { phase: PHASES.ABSENT, stage: null, entry: null, hold: false, terminal: true, notice: null };
    const hook = mountHook({ modules }, makeOptions());
    hook.render();
    const { ok, url } = hook.render().captureShareUrl({ kind: 'alertTeam', anchor: 'missing', id: 'team-1' });
    assert.equal(ok, true);
    assert.match(url, /[?&]alertTeam=missing:team-1(&|$)/);
    const planning = mountHook({ modules }, makeOptions({ activeEngMode: 'planning' }));
    planning.render();
    assert.deepEqual(planning.render().captureShareUrl({ kind: 'alertTeam', anchor: 'missing', id: 'team-1' }), { ok: false, reason: 'invalid_state' });
}));

test('captureShareUrl refuses while disabled and passes an encoder failure through without a URL', () => withBrowser(() => {
    const { doubles, modules } = createDoubles();
    doubles.snapshot = { phase: PHASES.ABSENT, stage: null, entry: null, hold: false, terminal: true, notice: null };
    const blocked = mountHook({ modules }, makeOptions({ groupsLoading: true }));
    blocked.render();
    assert.deepEqual(blocked.render().captureShareUrl(), { ok: false, reason: 'disabled' });
    assert.equal(doubles.calls.some(call => call[0] === 'captureFocus'), false, 'nothing is captured while disabled');

    const invalid = mountHook({ modules }, makeOptions({ activeGroupId: 'g'.repeat(300) }));
    invalid.render();
    assert.deepEqual(invalid.render().captureShareUrl(), { ok: false, reason: 'invalid_state' });

    const teams = Array.from({ length: 12 }, (_, index) => `${String(index).padStart(2, '0')}${'x'.repeat(128)}`);
    const longSnapshot = { ...makeOptions().buildGroupStateSnapshot(), selectedTeams: teams };
    const tooLong = mountHook({ modules }, makeOptions({ buildGroupStateSnapshot: () => longSnapshot }));
    tooLong.render();
    assert.deepEqual(tooLong.render().captureShareUrl(), { ok: false, reason: 'too_long' });
}));


test('explicit Epic copy targets the clicked Epic and refuses a dropped focus', () => withBrowser(() => {
    const { doubles, modules } = createDoubles();
    doubles.snapshot = { phase: PHASES.ABSENT, terminal: true, hold: false, notice: null };
    doubles.focus = { kind: 'epic', key: 'PROJ-99' };
    for (const mode of ['catch-up', 'planning']) {
        const hook = mountHook({ modules }, makeOptions({ activeEngMode: mode }));
        hook.render();
        const result = hook.render().captureShareUrl({ kind: 'epic', key: 'PROJ-2' });
        assert.equal(result.ok, true);
        assert.match(result.url, /&epic=PROJ-2$/);
        assert.equal(result.url.includes('PROJ-99'), false);
        assert.deepEqual(hook.render().captureShareUrl({ kind: 'story', key: 'PROJ-2' }), { ok: false, reason: 'invalid_state' });
    }
    const teams = Array.from({ length: 12 }, (_, index) => `${index}${'x'.repeat(118)}`);
    const snapshot = { ...makeOptions().buildGroupStateSnapshot(), selectedTeams: teams };
    const hook = mountHook({ modules }, makeOptions({ searchQuery: '', buildGroupStateSnapshot: () => snapshot }));
    hook.render();
    assert.equal(hook.render().captureShareUrl().ok, true, 'the view alone fits');
    assert.deepEqual(hook.render().captureShareUrl({ kind: 'epic', key: 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ-1234567890' }), { ok: false, reason: 'too_long' });
    const board = mountHook({ modules }, makeOptions({ activeEngMode: 'board' })); board.render();
    const boardLink = board.render().captureShareUrl({ kind: 'epic', key: 'PROJ-2', column: 'col-9' });
    assert.equal(boardLink.ok, true);
    assert.match(boardLink.url, /mode=board.*&bcolumn=col-9&epic=PROJ-2$/);
    for (const mode of ['statistics']) {
        const other = mountHook({ modules }, makeOptions({ activeEngMode: mode })); other.render();
        assert.deepEqual(other.render().captureShareUrl({ kind: 'epic', key: 'PROJ-2' }), { ok: false, reason: 'invalid_state' });
    }
}));
