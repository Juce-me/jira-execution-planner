const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const SHARE_VIEW = path.join(__dirname, '..', 'frontend', 'src', 'shareView');
const ALERT_KEYS = ['missing', 'blocked', 'followup', 'backlog', 'missingTeam', 'missingLabels', 'needsStories', 'waiting', 'empty', 'done'];
const NOW = new Date();
const THIS_QUARTER = `${NOW.getFullYear()}Q${Math.floor(NOW.getMonth() / 3) + 1}`;

// The controller runs against the real store, codec, resolver and view defaults, so the test sees what the app sees. Only the
// DOM reveal is a double. One bundle serves every rig; each rig evaluates it afresh, so each rig owns its store.
const BUNDLE = esbuild.buildSync({
    stdin: {
        contents: "export * from './applyController.js'; export * as store from './store.js'; export { encodeShareView } from './codec.js';",
        resolveDir: SHARE_VIEW, sourcefile: 'apply-controller-test-entry.js',
    },
    bundle: true, write: false, format: 'cjs', platform: 'browser', external: ['./focusReveal.js'],
}).outputFiles[0].text;

const SPRINTS = [
    { id: 41, name: 'Sprint 41', state: 'active', startDate: '2026-01-05' },
    { id: 42, name: 'Sprint 42', state: 'future', startDate: '2026-01-19' },
    { id: 40, name: 'Sprint 40', state: 'closed', startDate: '2025-12-22' },
];

function createRig({ link, search, options = {} } = {}) {
    const revealLog = [];
    const reveal = {
        revealShareViewFocus: (target, revealOptions) => {
            let cancelled = false;
            let resolveDone;
            const done = new Promise((resolve) => { resolveDone = resolve; });
            const handle = { target, options: revealOptions, cancel: () => { cancelled = true; resolveDone('cancelled'); }, finish: result => resolveDone(result), get cancelled() { return cancelled; }, done };
            revealLog.push(handle);
            return handle;
        },
    };
    const loaded = { exports: {} };
    new Function('module', 'exports', 'require', BUNDLE)(loaded, loaded.exports, () => reveal);
    const { createApplyController, readFacetOptionIds, store, encodeShareView } = loaded.exports;
    const query = search ?? (link ? `?${encodeShareView(link).query}` : '');
    store.initShareViewFromLocation({ location: { search: query, pathname: '/', hash: '' }, history: { state: null, replaceState() {} } });
    // What the store went through, in the shapes the assertions read: stage starts, the hold release and the end.
    const storeLog = [];
    let seen = store.getShareViewSnapshot();
    store.subscribeShareView(() => {
        const next = store.getShareViewSnapshot();
        if (next.phase === 'running' && (seen.phase !== 'running' || next.stage !== seen.stage)) storeLog.push(['begin', next.stage]);
        if (seen.hold && !next.hold && !next.terminal) storeLog.push(['holdReleased']);
        if (next.terminal && !seen.terminal) storeLog.push(['finish', next.phase, next.notice ? [...next.notice.categories] : []]);
        seen = next;
    });
    const log = [];
    const spy = name => (...args) => log.push([name, ...args]);
    const o = {
        sharedConfigReady: true, groupsLoading: false, groupsFailed: false, onboardingRequired: false, adminSettingsGate: { status: 'clear' },
        sprintCatalogState: { authority: 'validated', status: 'ready', validatedSnapshot: {}, availableSprints: SPRINTS },
        homeTokenConnectionLoaded: true, savedViewIsEpm: false,
        visibleControlGroups: [{ id: 'grp-a', teamIds: ['t1', 't2'] }, { id: 'grp-b', teamIds: ['t3', ' t4 ', 't3'] }],
        pendingShellAuthResumeRef: { current: null }, pendingPlanningAuthResumeRef: { current: null }, pendingConnectionRecoveryRef: { current: null },
        tourRunning: false, planningReviewBusy: false,
        activeGroupId: 'grp-a', selectedSprint: 41, planningScopeKey: 'planning::41::grp-a', teamSelectionScopeKey: 'team-selection::41::grp-a',
        selectedTeams: ['all'], tasksFetched: false, tasksLoading: false, engLoadsTasks: true, activeEngMode: 'catch-up',
        activeGroupRef: { current: 'grp-a' }, planningHydratedScopeRef: { current: 'planning::41::grp-a' }, restoringGroupRef: { current: false },
        teamSelectionHydratedScopeRef: { current: '' }, lastLoadedSprintRef: { current: null }, loadEpochRef: { current: 0 },
        catchUpAlertLoadRef: { current: '' }, catchUpAlertScopeKey: 'alert-scope', alertCohortRef: { current: null },
        engSprintSelectorState: { componentReadiness: 'ready', allWorkReadiness: 'ready' },
        engCatchUpFacetModel: { facets: [
            { id: 'status', options: [{ id: 'In Progress' }, { id: 'To Do' }, { id: 'Done' }] },
            { id: 'priority', options: [{ id: 'Blocker' }, { id: 'Major' }] },
            { id: 'track', options: [{ id: 'Committed' }, { id: 'Flexible' }] },
        ] },
        restoredInitialEpmViewRef: { current: false },
        setSelectedView: spy('setSelectedView'), setActiveGroupId: spy('setActiveGroupId'),
        commitSprintSelection: spy('commitSprintSelection'), persistTeamSelection: spy('persistTeamSelection'),
        setShowPlanning: spy('setShowPlanning'), setShowStats: spy('setShowStats'), setShowScenario: spy('setShowScenario'), setShowBoard: spy('setShowBoard'),
        setSearchInput: spy('setSearchInput'), setSearchQuery: spy('setSearchQuery'), setShowProduct: spy('setShowProduct'), setShowTech: spy('setShowTech'),
        setGroupByInitiativeChoice: spy('setGroupByInitiativeChoice'), setEngEpicSort: spy('setEngEpicSort'), setPlanningLayout: spy('setPlanningLayout'),
        setStatsView: spy('setStatsView'), setCohortStartQuarter: spy('setCohortStartQuarter'), setCohortEndQuarter: spy('setCohortEndQuarter'),
        setExcludedCapacityStartSprintId: spy('setExcludedCapacityStartSprintId'), setExcludedCapacityEndSprintId: spy('setExcludedCapacityEndSprintId'),
        setShowAlertsPanel: spy('setShowAlertsPanel'), setBoardStrictScope: spy('setBoardStrictScope'), setSelectedTeams: spy('setSelectedTeams'),
        setEngStatusFilter: spy('setEngStatusFilter'), setEngPriorityFilter: spy('setEngPriorityFilter'), setEngProjectTrackFilter: spy('setEngProjectTrackFilter'),
        alertFlags: Object.fromEntries(ALERT_KEYS.map(key => [key, [true, spy(`flag:${key}`)]])),
        ...options,
    };
    // None of the App's navigation, reset or analytics-emitting helpers may be reachable from the apply.
    for (const name of ['applyEngMode', 'clearEngFilters', 'resetEngFilters', 'navigateToAlertStory', 'handleAlertStoryClick', 'saveGroupPreferences']) {
        Object.defineProperty(o, name, { get() { throw new Error(`${name} must never be read by the link apply`); }, enumerable: false });
    }
    const clock = { now: 0 };
    const controller = createApplyController({ readOptions: () => o, now: () => clock.now });
    const tick = (advance = 0, { commit = true } = {}) => {
        clock.now += advance;
        if (commit) controller.noteCommit();
        controller.evaluate();
    };
    const tracked = [];
    const flush = (analyticsReady = true) => controller.flushTrack(payload => tracked.push(payload), analyticsReady);
    const take = () => log.splice(0);
    return {
        o, log, take, controller, tick, flush, tracked, revealLog, readFacetOptionIds,
        store: { log: storeLog, module: store, snapshot: () => store.getShareViewSnapshot() },
    };
}

const LINK = {
    version: 1, mode: 'catch-up', group: 'grp-b', sprint: '42', teams: ['t3'], find: 'login', lanes: { product: false, tech: true },
    initiatives: true, sort: 'status', alerts: ['blocked'], status: { only: ['in progress'] }, priority: { hidden: ['major'] }, track: [],
};

// What React would have committed after Stage A (the Department and Sprint are now the link's).
function commitScope(rig, { group = 'grp-b', sprint = 42 } = {}) {
    const { o } = rig;
    o.activeGroupId = group;
    o.selectedSprint = sprint;
    o.activeGroupRef.current = group;
    o.planningScopeKey = `planning::${sprint}::${group}`;
    o.planningHydratedScopeRef.current = o.planningScopeKey;
    o.teamSelectionScopeKey = `team-selection::${sprint}::${group}`;
}

function finishLoad(rig, { group = 'grp-b', sprint = 42 } = {}) {
    const { o } = rig;
    o.loadEpochRef.current += 1;
    o.tasksFetched = true;
    o.lastLoadedSprintRef.current = sprint;
    o.teamSelectionHydratedScopeRef.current = `team-selection::${sprint}::${group}`;
}

test('a scope-changing Catch Up link applies scope, fields, Teams and facets in four separate stages', () => {
    const rig = createRig({ link: LINK });
    rig.tick();
    assert.deepEqual(rig.take(), [
        ['setSelectedView', 'eng'],
        ['setActiveGroupId', 'grp-b'],
        ['commitSprintSelection', { id: 42, name: 'Sprint 42', state: 'future' }, { groupId: 'grp-b', teams: ['t3'], projectTrackRange: false }],
    ]);
    assert.equal(rig.o.restoredInitialEpmViewRef.current, true);
    assert.deepEqual(rig.store.log, [['begin', 'A']]);

    rig.tick();
    assert.deepEqual(rig.take(), [], 'Stage B waits for the scope to commit');
    commitScope(rig);
    rig.tick();
    assert.deepEqual(rig.take(), [
        ['setShowPlanning', false], ['setShowStats', false], ['setShowScenario', false], ['setShowBoard', false],
        ['setSearchInput', 'login'], ['setSearchQuery', 'login'], ['setShowProduct', false], ['setShowTech', true],
        ['setGroupByInitiativeChoice', true], ['setEngEpicSort', 'status'],
        ['setShowAlertsPanel', true],
        ...ALERT_KEYS.map(key => [`flag:${key}`, key === 'blocked']),
    ]);
    assert.deepEqual(rig.store.log, [['begin', 'A'], ['begin', 'B']]);

    rig.tick();
    assert.deepEqual(rig.store.log.at(-1), ['holdReleased'], 'the hold is released only after Stage B committed');

    finishLoad(rig);
    rig.o.selectedTeams = ['t3'];
    rig.tick();
    assert.deepEqual(rig.take(), [], 'the hydrate effect already applied the carried-forward Teams');
    rig.tick();
    assert.deepEqual(rig.take(), [
        ['setEngStatusFilter', { only: ['In Progress'] }], ['setEngPriorityFilter', { hidden: ['Major'] }], ['setEngProjectTrackFilter', []],
    ]);
    rig.tick();
    assert.deepEqual(rig.store.log.slice(-1), [['finish', 'done', []]]);
});

test('Stage C corrects Teams only when the hydrate effect did not already set them', () => {
    const rig = createRig({ link: { ...LINK, teams: ['t3', 'zz'] } });
    rig.tick();
    commitScope(rig);
    rig.tick();
    rig.tick();
    rig.take();
    finishLoad(rig);
    rig.tick();
    assert.deepEqual(rig.take(), [['persistTeamSelection', ['t3']], ['setSelectedTeams', ['t3']]]);
    rig.tick();
    rig.tick();
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'partial', ['teams']], 'the dropped Team id is named, never its value');
});

test('a same-scope link skips the scope write but still syncs the view and applies fields, Teams and facets', () => {
    const rig = createRig({ link: { ...LINK, group: 'grp-a', sprint: '41', teams: ['t1'] } });
    rig.tick();
    assert.deepEqual(rig.take(), [['setSelectedView', 'eng']]);
    assert.equal(rig.o.restoredInitialEpmViewRef.current, true);
    rig.tick();
    assert.equal(rig.log.some(([name]) => name === 'setShowPlanning'), true, 'Stage B runs next, without waiting for a commit');
    rig.take();
    rig.tick();
    finishLoad(rig, { group: 'grp-a', sprint: 41 });
    rig.tick();
    assert.deepEqual(rig.take(), [['persistTeamSelection', ['t1']], ['setSelectedTeams', ['t1']]]);
    rig.tick();
    rig.tick();
    assert.equal(rig.log.some(([name]) => name === 'setEngStatusFilter'), true);
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'done', []]);
});

test('a recipient whose saved view is EPM waits for the Home token read, then lands in ENG without the one-shot restore', () => {
    const rig = createRig({ link: LINK, options: { savedViewIsEpm: true, homeTokenConnectionLoaded: false } });
    rig.tick();
    assert.deepEqual(rig.take(), []);
    rig.o.homeTokenConnectionLoaded = true;
    rig.tick();
    assert.deepEqual(rig.take().slice(0, 1), [['setSelectedView', 'eng']]);
    assert.equal(rig.o.restoredInitialEpmViewRef.current, true);
});

test('saved Scenario flags are overwritten by the four mode booleans with Scenario always off', () => {
    const rig = createRig({ link: { ...LINK, mode: 'planning', group: 'grp-a', sprint: '41', layout: 'table', rows: 'story' } });
    rig.tick();
    rig.take();
    rig.tick();
    const names = rig.take().filter(([name]) => name.startsWith('setShow') && !name.startsWith('setShowAlerts') && name !== 'setShowProduct' && name !== 'setShowTech');
    assert.deepEqual(names, [['setShowPlanning', true], ['setShowStats', false], ['setShowScenario', false], ['setShowBoard', false]]);
});

test('the Planning rows are seeded once, when Stage C begins after the scope has loaded: the first load unmounts the table', () => {
    const rig = createRig({ link: { ...LINK, mode: 'planning', group: 'grp-a', sprint: '41', layout: 'table', rows: 'story' } });
    const { module: store } = rig.store;
    rig.tick();
    rig.tick();
    rig.tick();
    assert.deepEqual(rig.store.log.map(entry => entry[0]), ['begin', 'begin', 'holdReleased']);
    assert.equal(store.takeInitialPlanningRowMode(), null, 'nothing is seeded after Stage B: the table that mounts then is unmounted again by the load');
    finishLoad(rig, { group: 'grp-a', sprint: 41 });
    rig.tick();
    assert.equal(store.getShareViewSnapshot().stage, 'C');
    assert.equal(store.takeInitialPlanningRowMode(), 'story', 'the seed holds the link rows until the table remounts');
    rig.tick();
    rig.tick();
    assert.equal(store.takeInitialPlanningRowMode(), null, 'later Stage C parts and Stage D do not seed again');

    const list = createRig({ link: { ...LINK, mode: 'planning', group: 'grp-a', sprint: '41', layout: 'list' } });
    for (let step = 0; step < 4; step += 1) { finishLoad(list, { group: 'grp-a', sprint: 41 }); list.tick(); }
    assert.equal(list.store.module.takeInitialPlanningRowMode(), null, 'the List layout has no rows to seed');

    const cancelled = createRig({ link: { ...LINK, mode: 'planning', group: 'grp-a', sprint: '41', layout: 'table', rows: 'story' } });
    cancelled.tick();
    cancelled.tick();
    cancelled.controller.noteInterrupt('deliberate');
    cancelled.tick();
    assert.deepEqual(cancelled.store.log.at(-1), ['finish', 'cancelled', []]);
    assert.equal(cancelled.store.module.takeInitialPlanningRowMode(), null, 'a cancelled link seeds nothing');
});

test('a pending auth or Planning recovery capsule holds the link until the capsule is consumed', () => {
    for (const ref of ['pendingShellAuthResumeRef', 'pendingPlanningAuthResumeRef']) {
        const rig = createRig({ link: LINK, options: { [ref]: { current: { scopeKey: 'x' } } } });
        rig.tick();
        rig.tick(2000);
        assert.deepEqual(rig.take(), [], ref);
        rig.o[ref].current = null;
        rig.tick();
        assert.equal(rig.log.some(([name]) => name === 'setActiveGroupId'), true, ref);
    }
});

test('the first-run popup pauses the link; a group the recipient does not have drops it with the group category on the recipient surface', () => {
    const rig = createRig({ link: { ...LINK, group: 'grp-link' }, options: { onboardingRequired: true, visibleControlGroups: [] } });
    for (let step = 0; step < 5; step += 1) rig.tick(30000);
    assert.deepEqual(rig.take(), []);
    assert.equal(rig.controller.isPaused(), true);
    rig.o.onboardingRequired = false;
    rig.o.visibleControlGroups = [{ id: 'grp-picked', teamIds: ['t1'] }];
    rig.tick(100);
    assert.deepEqual(rig.take(), []);
    assert.deepEqual(rig.store.log, [['finish', 'dropped', ['group']]]);
    rig.flush(false);
    assert.deepEqual(rig.tracked, [], 'nothing is sent before analytics is ready');
    rig.flush(true);
    rig.flush(true);
    assert.deepEqual(rig.tracked, [{ workflowAction: 'apply_link', result: 'rejected', sourceSurface: 'catch_up' }], 'exactly one apply event');

    const planning = createRig({ link: { ...LINK, group: 'grp-link' }, options: { activeEngMode: 'planning' } });
    planning.tick();
    planning.flush(true);
    assert.deepEqual(planning.tracked.map(entry => entry.sourceSurface), ['planning'], 'a link that never resolved reports the recipient mode');
});

test('an unresolvable Sprint drops the link and applies nothing', () => {
    const rig = createRig({ link: { ...LINK, sprint: '999' } });
    rig.tick();
    assert.deepEqual(rig.take(), []);
    assert.deepEqual(rig.store.log, [['finish', 'dropped', ['sprint']]]);
});

test('a link that cannot start names no category, so the notice stays neutral', () => {
    const rig = createRig({ link: LINK, options: { groupsFailed: true } });
    rig.tick();
    assert.deepEqual(rig.take(), []);
    assert.deepEqual(rig.store.log, [['finish', 'dropped', []]]);
});

test('a Planning link for a closed Sprint is applied as Catch Up and reports the mode', () => {
    const rig = createRig({ link: { ...LINK, mode: 'planning', group: 'grp-a', sprint: '40' } });
    rig.tick();
    commitScope(rig, { group: 'grp-a', sprint: 40 });
    rig.tick();
    rig.tick();
    const modeWrites = rig.take().filter(([name]) => name === 'setShowPlanning' || name === 'setShowBoard');
    assert.deepEqual(modeWrites, [['setShowPlanning', false], ['setShowBoard', false]]);
    for (let step = 0; step < 6; step += 1) { finishLoad(rig, { group: 'grp-a', sprint: 40 }); rig.tick(); }
    assert.equal(rig.store.log.at(-1)[1], 'partial');
    assert.ok(rig.store.log.at(-1)[2].includes('mode'));
});

test('a Statistics link whose Sprint is still in the future is applied as Catch Up: Teams and facets resolve for the resolved mode', () => {
    const rig = createRig({ link: { version: 1, mode: 'statistics', group: 'grp-a', sprint: '42', stats: 'projectTrack' } });
    rig.tick();
    assert.deepEqual(rig.take().pop(), ['commitSprintSelection', { id: 42, name: 'Sprint 42', state: 'future' }, { groupId: 'grp-a', teams: ['all'], projectTrackRange: false }]);
    commitScope(rig, { group: 'grp-a', sprint: 42 });
    rig.tick();
    rig.tick();
    rig.take();
    finishLoad(rig, { group: 'grp-a', sprint: 42 });
    rig.tick();
    rig.tick();
    assert.deepEqual(rig.take().filter(([name]) => /^setEng/.test(name)), [
        ['setEngStatusFilter', { hidden: ['Killed'] }], ['setEngPriorityFilter', null], ['setEngProjectTrackFilter', undefined],
    ]);
    rig.tick();
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'partial', ['mode']]);
    rig.flush(true);
    assert.deepEqual(rig.tracked, [{ workflowAction: 'apply_link', result: 'partial', sourceSurface: 'catch_up' }]);
});

test('decode-time reports reach the notice and the result is partial', () => {
    const rig = createRig({ search: '?v=1&mode=catch-up&group=grp-a&sprint=41&status=bogus' });
    for (let step = 0; step < 8; step += 1) { finishLoad(rig, { group: 'grp-a', sprint: 41 }); rig.tick(); }
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'partial', ['filters']]);
});

test('every raw write goes through the options bag: the throwing helpers are never read', () => {
    const rig = createRig({ link: { ...LINK, focus: { kind: 'epic', key: 'PROJ-1' } } });
    for (let step = 0; step < 12; step += 1) {
        if (step === 1) commitScope(rig);
        if (step === 4) finishLoad(rig);
        if (step === 8) { rig.o.catchUpAlertLoadRef.current = rig.o.catchUpAlertScopeKey; }
        rig.tick(50);
    }
    assert.equal(rig.revealLog.length, 1, 'Stage D ran without touching a forbidden helper');
});

test('Stage D reveals the focus target once the alert cohort settles and finishes on the reveal result', async () => {
    const rig = createRig({ link: { ...LINK, focus: { kind: 'epic', key: 'PROJ-1' } } });
    rig.tick();
    commitScope(rig);
    rig.tick();
    rig.tick();
    finishLoad(rig);
    rig.o.selectedTeams = ['t3'];
    rig.tick();
    rig.tick();
    rig.tick();
    assert.equal(rig.revealLog.length, 0, 'the alert cohort has not settled');
    rig.o.catchUpAlertLoadRef.current = rig.o.catchUpAlertScopeKey;
    rig.tick();
    assert.equal(rig.revealLog.length, 1);
    assert.deepEqual(rig.revealLog[0].target, { kind: 'epic', key: 'PROJ-1' });
    assert.equal(rig.revealLog[0].options.mode, 'catch-up');
    assert.equal(rig.revealLog[0].options.isCancelled(), false);
    rig.revealLog[0].finish('revealed');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'done', []]);
});

test('a missing focus target is reported as focus', async () => {
    const rig = createRig({ link: { ...LINK, alertTeam: { anchor: 'blocked', id: 't3' } } });
    rig.o.catchUpAlertLoadRef.current = rig.o.catchUpAlertScopeKey;
    rig.tick();
    commitScope(rig);
    rig.tick();
    rig.tick();
    finishLoad(rig);
    rig.o.selectedTeams = ['t3'];
    rig.tick();
    rig.tick();
    rig.tick();
    assert.deepEqual(rig.revealLog[0].target, { kind: 'alertTeam', anchor: 'blocked', id: 't3' });
    rig.revealLog[0].finish('missing');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'partial', ['focus']]);
    rig.flush(true);
    assert.deepEqual(rig.tracked, [{ workflowAction: 'apply_link', result: 'partial', sourceSurface: 'catch_up' }]);
});

test('a deliberate interaction before the reveal cancels the link without a notice; scrolling alone does not', () => {
    const rig = createRig({ link: LINK });
    rig.tick();
    rig.controller.noteInterrupt('scroll');
    rig.tick();
    assert.equal(rig.store.log.some(([name]) => name === 'finish'), false);
    rig.controller.noteInterrupt('deliberate');
    rig.tick();
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'cancelled', []]);
    assert.equal(rig.store.snapshot().notice, null);
    rig.flush(true);
    assert.deepEqual(rig.tracked.map(entry => entry.result), ['rejected']);
});

test('an interaction during the reveal cancels only the reveal and keeps the applied stages', async () => {
    const rig = createRig({ link: { ...LINK, focus: { kind: 'story', key: 'PROJ-9' } } });
    rig.tick();
    commitScope(rig);
    rig.tick();
    rig.tick();
    finishLoad(rig);
    rig.o.selectedTeams = ['t3'];
    rig.o.catchUpAlertLoadRef.current = rig.o.catchUpAlertScopeKey;
    rig.tick();
    rig.tick();
    rig.tick();
    assert.equal(rig.revealLog.length, 1);
    rig.controller.noteInterrupt('deliberate');
    rig.tick();
    assert.equal(rig.revealLog[0].cancelled, true);
    assert.equal(rig.revealLog[0].options.isCancelled(), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'done', []], 'the user scrolled on their own, so focus is not reported');
});

test('the reveal is cancelled by an interaction the guard reported since the last tick and by the terminal auth lock', () => {
    const drive = () => {
        const rig = createRig({ link: { ...LINK, focus: { kind: 'story', key: 'PROJ-9' } } });
        rig.tick();
        commitScope(rig);
        rig.tick();
        rig.tick();
        finishLoad(rig);
        rig.o.selectedTeams = ['t3'];
        rig.o.catchUpAlertLoadRef.current = rig.o.catchUpAlertScopeKey;
        rig.tick();
        rig.tick();
        rig.tick();
        assert.equal(rig.revealLog.length, 1);
        return rig;
    };
    const interacted = drive();
    const { isCancelled } = interacted.revealLog[0].options;
    assert.equal(isCancelled(), false);
    interacted.controller.noteInterrupt('scroll');
    assert.equal(isCancelled(), true, 'the reveal stops at its next frame, without waiting for the next tick');
    interacted.tick();
    assert.equal(isCancelled(), true, 'and stays cancelled after the tick consumed the interaction');

    const locked = drive();
    assert.equal(locked.revealLog[0].options.isCancelled(), false);
    globalThis.window = { __JEP_AUTH_REQUIRED__: { locked: true } };
    try { assert.equal(locked.revealLog[0].options.isCancelled(), true, 'a terminal auth lock stops the reveal'); } finally { delete globalThis.window; }
});

test('a dirty Planning review, a terminal auth lock and a vanished group each end the link', () => {
    const review = createRig({ link: LINK, options: { planningReviewBusy: true } });
    review.tick();
    assert.deepEqual(review.store.log, [['finish', 'cancelled', []]]);

    const locked = createRig({ link: LINK });
    globalThis.window = { __JEP_AUTH_REQUIRED__: { locked: true } };
    try { locked.tick(); } finally { delete globalThis.window; }
    assert.deepEqual(locked.store.log, [['finish', 'dropped', []]]);

    const vanished = createRig({ link: LINK });
    vanished.tick();
    commitScope(vanished);
    vanished.o.visibleControlGroups = [{ id: 'grp-a', teamIds: ['t1'] }];
    vanished.tick();
    assert.deepEqual(vanished.store.log.at(-1), ['finish', 'partial', ['group']], 'the re-check before Stage B stops a link whose group disappeared');
    assert.deepEqual(vanished.log.filter(([name]) => name === 'setShowPlanning'), [], 'Stage B wrote nothing');
});

test('a throwing writer ends the link and keeps the dashboard alive', () => {
    const originalError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    try {
        const early = createRig({ link: LINK, options: { setSelectedView: () => { throw new Error('writer failed'); } } });
        early.tick();
        assert.deepEqual(early.store.log.at(-1), ['finish', 'partial', ['group', 'sprint', 'mode', 'filters', 'teams']], 'the scope write failed, everything it owed is named');
        early.tick();
        assert.equal(early.store.log.filter(([name]) => name === 'finish').length, 1, 'the failed link stays finished');

        const late = createRig({ link: LINK });
        late.tick();
        commitScope(late);
        late.o.setShowPlanning = () => { throw new Error('writer failed'); };
        late.tick();
        assert.deepEqual(late.store.log.at(-1), ['finish', 'partial', ['mode', 'filters', 'teams']], 'the failing Stage B and the stages after it are named');

        const unresolved = createRig({ link: LINK, options: { sprintCatalogState: { get availableSprints() { throw new Error('catalog failed'); }, authority: 'validated', status: 'ready', validatedSnapshot: {} } } });
        unresolved.tick();
        assert.deepEqual(unresolved.store.log.at(-1), ['finish', 'dropped', []], 'a fault before Stage A leaves the view as it was and names nothing');
        assert.equal(errors.length, 3);
    } finally {
        console.error = originalError;
    }
});

test('Board scope is applied only when ready, and a Board link has no Teams or facets stage', () => {
    const ready = createRig({ link: { version: 1, mode: 'board', group: 'grp-a', sprint: '41', scope: 'component', find: 'x' } });
    ready.tick();
    ready.take();
    ready.tick();
    const writes = ready.take();
    assert.deepEqual(writes.filter(([name]) => name === 'setShowBoard' || name === 'setBoardStrictScope'), [['setShowBoard', true], ['setBoardStrictScope', 'component']]);
    ready.tick();
    ready.tick();
    assert.deepEqual(ready.store.log.at(-1), ['finish', 'done', []]);

    const pending = createRig({ link: { version: 1, mode: 'board', group: 'grp-a', sprint: '41', scope: 'all_work' }, options: { engSprintSelectorState: { componentReadiness: 'catalog_pending', allWorkReadiness: 'catalog_pending' } } });
    pending.tick();
    pending.tick(1000);
    assert.equal(pending.log.some(([name]) => name === 'setShowBoard'), false, 'Stage B waits for the readiness');
    pending.o.engSprintSelectorState = { componentReadiness: 'ready', allWorkReadiness: 'components_required' };
    pending.tick(100);
    assert.deepEqual(pending.log.filter(([name]) => name === 'setBoardStrictScope'), [], 'an unavailable scope is skipped');
    for (let step = 0; step < 4; step += 1) pending.tick(100);
    assert.deepEqual(pending.store.log.at(-1), ['finish', 'partial', ['mode']]);
});

test('Statistics writes its view and range, and a source-only view skips Stage C silently', () => {
    const cohort = createRig({ link: { version: 1, mode: 'statistics', group: 'grp-a', sprint: '41', stats: 'cohort', from: THIS_QUARTER, to: THIS_QUARTER, teams: ['t1'] } });
    cohort.tick();
    cohort.take();
    cohort.tick();
    assert.deepEqual(cohort.take().filter(([name]) => /^set(Stats|Cohort|Excluded)/.test(name)), [
        ['setStatsView', 'cohort'], ['setCohortStartQuarter', THIS_QUARTER], ['setCohortEndQuarter', THIS_QUARTER],
    ]);

    const sourceOnly = createRig({ link: { version: 1, mode: 'statistics', group: 'grp-b', sprint: '41', stats: 'projectTrack', from: '40', to: '41' }, options: { engLoadsTasks: false } });
    sourceOnly.tick();
    assert.deepEqual(sourceOnly.take().pop(), ['commitSprintSelection', { id: 41, name: 'Sprint 41', state: 'active' }, { groupId: 'grp-b', teams: undefined, projectTrackRange: true }]);
    commitScope(sourceOnly, { group: 'grp-b', sprint: 41 });
    sourceOnly.tick();
    assert.deepEqual(sourceOnly.take().filter(([name]) => /^setExcluded/.test(name)), [['setExcludedCapacityStartSprintId', '40'], ['setExcludedCapacityEndSprintId', '41']]);
    sourceOnly.tick();
    sourceOnly.tick();
    sourceOnly.tick();
    assert.deepEqual(sourceOnly.take(), [], 'no Teams or facets where no task list loads');
    assert.deepEqual(sourceOnly.store.log.at(-1), ['finish', 'done', []]);
});

test('a Sprint range is ordered by the catalog start dates, not by the Sprint names', () => {
    const sprints = [
        { id: 61, name: 'Sprint 9', state: 'closed', startDate: '2026-01-05' },
        { id: 62, name: 'Sprint 10', state: 'closed', startDate: '2026-02-02' },
        { id: 63, name: 'Sprint 11', state: 'active', startDate: '2026-03-02' },
    ];
    const rig = createRig({
        link: { version: 1, mode: 'statistics', group: 'grp-a', sprint: '63', stats: 'excludedCapacity', from: '61', to: '62' },
        options: { selectedSprint: 63, sprintCatalogState: { authority: 'validated', status: 'ready', validatedSnapshot: {}, availableSprints: sprints }, engLoadsTasks: false },
    });
    rig.tick();
    rig.take();
    rig.tick();
    assert.deepEqual(rig.take().filter(([name]) => /^setExcluded/.test(name)), [['setExcludedCapacityStartSprintId', '61'], ['setExcludedCapacityEndSprintId', '62']]);
    rig.tick();
    rig.tick();
    assert.deepEqual(rig.store.log.at(-1), ['finish', 'done', []], 'alphabetical order would have made the range invalid and reported the mode');
});

test('an invalid or newer link that never became pending reports one rejected apply event on the recipient surface', () => {
    for (const [search, activeEngMode, sourceSurface] of [['?v=2&mode=board', 'planning', 'planning'], ['?v=01&mode=board', 'catch-up', 'catch_up'], ['?v=2', 'scenario', 'catch_up']]) {
        const rig = createRig({ search, options: { activeEngMode } });
        assert.equal(rig.store.snapshot().entry, null);
        rig.tick();
        rig.flush(true);
        rig.tick();
        rig.flush(true);
        assert.deepEqual(rig.tracked, [{ workflowAction: 'apply_link', result: 'rejected', sourceSurface }], search);
    }
    const absent = createRig({});
    absent.tick();
    absent.flush(true);
    assert.deepEqual(absent.tracked, [], 'no link, no event');
});

test('an apply that the store already ended reports no apply event', () => {
    const rig = createRig({ link: LINK });
    Object.defineProperty(rig.o, 'planningReviewBusy', { get() { rig.store.module.finishShareView('dropped', ['sprint']); return true; }, configurable: true });
    rig.tick();
    rig.flush(true);
    assert.deepEqual(rig.store.log, [['finish', 'dropped', ['sprint']]], 'the first ending stands');
    assert.deepEqual(rig.tracked, [], 'only the call that ended the apply reports it');
});

test('the facet option ids are read from the facet model', () => {
    const rig = createRig({ link: LINK });
    assert.deepEqual(rig.readFacetOptionIds(rig.o.engCatchUpFacetModel), {
        status: ['In Progress', 'To Do', 'Done'], priority: ['Blocker', 'Major'], track: ['Committed', 'Flexible'],
    });
    assert.deepEqual(rig.readFacetOptionIds(undefined), { status: [], priority: [], track: [] });
});
