const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');
const hookPath = path.join(__dirname, '../frontend/src/eng/useEngAlerts.js');
const EXPECTED_NAMES = ['visibleAlertCollections', 'missingAlertKeySet', 'blockedAlertKeySet', 'postponedAlertKeySet', 'needsStoriesAlertKeySet', 'waitingAlertKeySet', 'emptyAlertKeySet', 'doneAlertKeySet', 'alertCounts', 'alertItemCount', 'missingAlertTeams', 'blockedAlertTeams', 'doneEpicTeams', 'postponedAlertTeams', 'postponedEpicTeams', 'emptyEpicTeams', 'analysisEpicTeams', 'backlogEpicTeams', 'missingTeamEpicTeams', 'missingLabelEpicTeams', 'needsStoriesTeams'];
const normalizeStatus = value => String(value || '').trim().toLowerCase();
function story(key, status = 'In Progress', epicKey = 'PROD-1', extra = {}) {
    return { key, fields: { summary: key, status: { name: status }, priority: { name: 'High' }, customfield_10004: 3, teamId: 'team-a', teamName: 'Alpha', epicKey, ...extra } };
}
function epic(key, status = 'Analysis', extra = {}) {
    return { key, summary: key, status: { name: status }, priority: { name: 'High' }, teamId: 'team-a', teamName: 'Alpha', sprint: '7', totalStories: 1, projectClass: 'product', ...extra };
}
function inputs(overrides = {}) {
    return {
        scope: { activeGroupId: 'group-a', selectedSprint: '7', selectedSprintInfo: { name: 'Sprint 7' }, isAllTeamsSelected: true, selectedTeamSet: new Set(['team-a']), teamNameById: new Map([['team-a', 'Alpha']]), teamOptions: [], capacityTasks: [], techProjectKeys: new Set(['TECH']), excludedEpicSet: new Set(), adHocEpicSet: new Set(), adHocEpicSignature: '' },
        dismissedAlertKeys: [], visibleTasks: [], normalizeStatus,
        isExcludedStatus: status => ['killed', 'done', 'postponed'].includes(status),
        getTeamInfo: task => ({ id: task.fields?.teamId || 'unknown', name: task.fields?.teamName || 'Unknown Team' }),
        missingPlanningInfoTasks: [], isTaskInSelectedSprint: task => task.fields?.inSprint !== false,
        hasStoryPoints: task => Number(task.fields?.customfield_10004) > 0,
        priorityOrder: { High: 1, Low: 2 }, activeGroupTeamLabels: { 'team-a': ['alpha'] }, resolveTeamName: () => 'Alpha',
        tasks: [], alertScopeTooLarge: false, epicsInScope: [], isFutureSprintSelected: false,
        backlogProductEpics: [], backlogTechEpics: [], selectedSprintState: 'active', dismissedStoryRequirementIds: [], engWorkHierarchy: { alertTargets: [] }, readyToCloseEpicsInScope: [], readyToCloseTasks: [], selectionTasks: [], visibleTasksForList: [], searchQuery: '', epicDetails: {},
        engCatchUpFilters: { admitsProject: () => true, admitsEpicProjectTrack: () => true, admitsStatus: () => true, admitsPriority: () => true }, burnoutTaskFilter: null,
        ...overrides,
    };
}
let useEngAlerts;
function render(overrides = {}) {
    if (!useEngAlerts) {
        const code = esbuild.buildSync({ entryPoints: [hookPath], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'] }).outputFiles[0].text;
        const module = { exports: {} };
        new Function('module', 'exports', 'require', code)(module, module.exports, require);
        useEngAlerts = module.exports.useEngAlerts;
    }
    let result;
    function Probe() { result = useEngAlerts(inputs(overrides)); return null; }
    renderToString(React.createElement(Probe));
    assert.deepEqual(Object.keys(result).sort(), EXPECTED_NAMES.slice().sort());
    return result;
}
const keys = values => values.map(value => value.task?.key || value.epic?.key || value.key);
function fixture() {
    const tasks = [story('PROD-11', 'In Progress', 'PROD-1', { customfield_10004: null }), story('PROD-12', 'Blocked'), story('PROD-13', 'Postponed'), story('PROD-14', 'Done', 'PROD-4'), story('PROD-15', 'Done', 'PROD-5')];
    const requirements = [{ id: 'req-1', epic: epic('PROD-6'), team: { id: 'team-a', name: 'Alpha' } }];
    return { tasks, visibleTasks: tasks, visibleTasksForList: tasks, readyToCloseTasks: tasks, readyToCloseEpicsInScope: [epic('PROD-4', 'Accepted', { openChildCount: 0 }), epic('PROD-5')], epicsInScope: [epic('PROD-2', 'Analysis', { totalStories: 0 }), epic('PROD-3', 'Analysis', { totalStories: 0, futureOpenStories: 2 })], engWorkHierarchy: { alertTargets: requirements } };
}
test('composite Alerts freezes all current-sprint collections, groups, counts and keysets', () => {
    const result = render(fixture());
    assert.deepEqual(result.alertCounts, { missing: 1, blocked: 1, followup: 2, backlog: 0, missingTeam: 0, missingLabels: 0, needsStories: 1, waiting: 1, empty: 1, done: 1 });
    assert.equal(result.alertItemCount, 8);
    for (const [name, expected] of [['missingAlertKeySet', ['PROD-11']], ['blockedAlertKeySet', ['PROD-12']], ['postponedAlertKeySet', ['PROD-13', 'PROD-3']], ['needsStoriesAlertKeySet', ['PROD-6']], ['waitingAlertKeySet', ['PROD-5']], ['emptyAlertKeySet', ['PROD-2']], ['doneAlertKeySet', ['PROD-4']]]) assert.deepEqual([...result[name]], expected);
    for (const [name, expected] of [['missingAlertTeams', ['PROD-11']], ['blockedAlertTeams', ['PROD-12']], ['postponedAlertTeams', ['PROD-13']], ['postponedEpicTeams', ['PROD-3']], ['needsStoriesTeams', ['PROD-6']], ['analysisEpicTeams', ['PROD-5']], ['emptyEpicTeams', ['PROD-2']], ['doneEpicTeams', ['PROD-4']]]) {
        assert.equal(result[name][0].name, 'Alpha');
        assert.deepEqual(keys(result[name][0].items), expected);
    }
});
test('dismissed issue and requirement identities remove matching alerts', () => {
    const result = render({ ...fixture(), dismissedAlertKeys: ['PROD-11', 'PROD-12', 'PROD-13', 'PROD-2', 'PROD-3', 'PROD-4', 'PROD-5'], dismissedStoryRequirementIds: ['req-1'] });
    assert.equal(result.alertItemCount, 0);
    assert.equal(result.needsStoriesTeams.length, 0);
});
test('ready-to-close strictly requires authoritative numeric zero and a selected-sprint child', () => {
    const candidates = [epic('PROD-20', 'Accepted', { openChildCount: 0 }), epic('PROD-21', 'Accepted'), epic('PROD-22', 'Accepted', { openChildCount: 1 }), epic('PROD-23', 'Accepted', { openChildCount: '0' }), epic('PROD-24', 'Accepted', { openChildCount: 0 })];
    const tasks = candidates.slice(0, 4).map((value, index) => story(`PROD-${30 + index}`, 'Done', value.key));
    assert.deepEqual([...render({ tasks, readyToCloseEpicsInScope: candidates }).doneAlertKeySet], ['PROD-20']);
});
test('server missing-info fallback merges client checks, excludes other sprint and preserves server task', () => {
    const server = story('PROD-40', 'In Progress', '', { missingFields: ['Team'], teamId: '', teamName: '', customfield_10004: 0, summary: 'Server version' });
    const other = story('PROD-41', 'In Progress', '', { missingFields: ['Team'], inSprint: false });
    const local = story('PROD-40', 'In Progress', '', { customfield_10004: 0 });
    const result = render({ missingPlanningInfoTasks: [server, other], visibleTasks: [local], visibleTasksForList: [local] });
    assert.deepEqual(keys(result.visibleAlertCollections.consolidatedMissingStories), ['PROD-40']);
    assert.equal(result.visibleAlertCollections.consolidatedMissingStories[0].task, server);
    assert.deepEqual(result.visibleAlertCollections.consolidatedMissingStories[0].missingFields, ['Team', 'Story Points', 'Epic']);
    assert.equal(result.missingAlertTeams[0].name, 'Unknown Team');
});
// Two distinct Teams and opposite facets ensure a narrowed fixture includes and rejects
// real alerts. Stories use the caller's visible list; Epic facets use the Epic's own
// fields (a Done Story can therefore keep an Accepted Epic under a status filter).
function partialFilterFixture() {
    const alpha = { teamId: 'team-a', teamName: 'Alpha', projectTrack: 'Committed' };
    const beta = { teamId: 'team-b', teamName: 'Beta', priority: { name: 'Low' }, projectClass: 'tech', projectTrack: 'Flexible' };
    const tasks = [
        story('PROD-111', 'In Progress', 'PROD-101', { ...alpha, customfield_10004: null }),
        story('PROD-112', 'Blocked', 'PROD-101', alpha),
        story('PROD-113', 'Postponed', 'PROD-101', alpha),
        story('PROD-114', 'Done', 'PROD-104', alpha),
        story('PROD-115', 'Done', 'PROD-105', alpha),
        story('TECH-211', 'Review', 'TECH-201', { ...beta, customfield_10004: null }),
        story('TECH-212', 'Blocked Review', 'TECH-201', beta),
        story('TECH-213', 'Postponed', 'TECH-201', beta),
        story('TECH-214', 'Done', 'TECH-204', beta),
        story('TECH-215', 'Done', 'TECH-205', beta),
    ];
    const epics = [
        epic('PROD-102', 'Analysis', { ...alpha, summary: 'Needle empty', totalStories: 0 }),
        epic('PROD-103', 'Analysis', { ...alpha, summary: 'Needle routed', totalStories: 0, futureOpenStories: 2 }),
        epic('TECH-202', 'Review', { ...beta, totalStories: 0 }),
        epic('TECH-203', 'Review', { ...beta, totalStories: 0, futureOpenStories: 2 }),
    ];
    const ready = [
        epic('PROD-104', 'Accepted', { ...alpha, summary: 'Needle close', openChildCount: 0 }),
        epic('PROD-105', 'Analysis', { ...alpha, summary: 'Needle waiting' }),
        epic('TECH-204', 'In Progress', { ...beta, openChildCount: 0 }),
        epic('TECH-205', 'Review', beta),
    ];
    const requirements = [
        { id: 'req-alpha', epic: epic('PROD-106', 'Analysis', { ...alpha, summary: 'Needle readiness' }), team: { id: 'team-a', name: 'Alpha' } },
        { id: 'req-beta', epic: epic('TECH-206', 'Review', beta), team: { id: 'team-b', name: 'Beta' } },
    ];
    return {
        tasks, visibleTasks: tasks, visibleTasksForList: tasks, readyToCloseTasks: tasks,
        epicsInScope: epics, readyToCloseEpicsInScope: ready,
        engWorkHierarchy: { alertTargets: requirements },
        epicDetails: { 'PROD-101': { summary: 'Needle parent' }, 'TECH-201': { summary: 'Other parent' } },
    };
}
const alphaCollections = {
    consolidatedMissingStories: ['PROD-111'], blockedTasks: ['PROD-112'], postponedTasks: ['PROD-113'],
    futureRoutedEpics: ['PROD-103'], backlogEpics: [], missingTeamEpics: [], missingLabelEpics: [],
    needsStoriesEntries: ['PROD-106'], needsStoriesEpics: ['PROD-106'],
    waitingForStoriesEpics: ['PROD-105'], emptyEpicsForAlert: ['PROD-102'], doneStoryEpics: ['PROD-104'],
};
const alphaKeySets = {
    missingAlertKeySet: ['PROD-111'], blockedAlertKeySet: ['PROD-112'],
    postponedAlertKeySet: ['PROD-113', 'PROD-103'], needsStoriesAlertKeySet: ['PROD-106'],
    waitingAlertKeySet: ['PROD-105'], emptyAlertKeySet: ['PROD-102'], doneAlertKeySet: ['PROD-104'],
};
const alphaGroups = {
    missingAlertTeams: [['team-a', 'Alpha', ['PROD-111']]], blockedAlertTeams: [['team-a', 'Alpha', ['PROD-112']]],
    postponedAlertTeams: [['team-a', 'Alpha', ['PROD-113']]], postponedEpicTeams: [['team-a', 'Alpha', ['PROD-103']]],
    needsStoriesTeams: [['team-a', 'Alpha', ['PROD-106']]], analysisEpicTeams: [['team-a', 'Alpha', ['PROD-105']]],
    emptyEpicTeams: [['team-a', 'Alpha', ['PROD-102']]], doneEpicTeams: [['team-a', 'Alpha', ['PROD-104']]],
    backlogEpicTeams: [], missingTeamEpicTeams: [], missingLabelEpicTeams: [],
};
const alphaCounts = { missing: 1, blocked: 1, followup: 2, backlog: 0, missingTeam: 0, missingLabels: 0, needsStories: 1, waiting: 1, empty: 1, done: 1 };
function assertFilteredContract(result, collections, keySets, groups, counts, total) {
    // Expectations above are frozen synthetic identities, never obtained from hook output.
    assert.deepEqual(Object.fromEntries(Object.entries(result.visibleAlertCollections).map(([name, values]) => [name, keys(values)])), collections);
    for (const [name, expected] of Object.entries(keySets)) assert.deepEqual([...result[name]], expected, name);
    for (const [name, expected] of Object.entries(groups)) {
        assert.deepEqual(result[name].map(group => [group.id, group.name, keys(group.items)]), expected, name);
    }
    assert.deepEqual(result.alertCounts, counts);
    assert.equal(result.alertItemCount, total);
}
for (const [name, filters] of [
    ['Priority', { admitsPriority: priority => priority === 'High' }],
    ['Project Track', { admitsEpicProjectTrack: value => value.projectTrack === 'Committed' }],
    ['Product/Tech project', { admitsProject: isTech => !isTech }],
]) {
    test(`narrowed ${name} retains admitted alerts and excludes the other Team across every projection`, () => {
        const base = partialFilterFixture();
        // This list is the already-filtered Story input supplied by App, including
        // terminal children needed by the independent waiting/ready-to-close sources.
        const result = render({ ...base, visibleTasksForList: base.tasks.slice(0, 5), engCatchUpFilters: { ...inputs().engCatchUpFilters, ...filters } });
        assertFilteredContract(result, alphaCollections, alphaKeySets, alphaGroups, alphaCounts, 8);
    });
}
test('narrowed Status uses Story visibility and Epic status independently', () => {
    const base = partialFilterFixture();
    const result = render({
        ...base, visibleTasksForList: [...base.tasks.slice(0, 3), base.tasks[7]],
        engCatchUpFilters: { ...inputs().engCatchUpFilters, admitsStatus: status => ['In Progress', 'Blocked', 'Postponed', 'Analysis', 'Accepted'].includes(status) },
    });
    // Both Postponed Stories survive. Both ready-to-close Epics survive their own
    // Accepted/In Progress status despite their Done children being hidden.
    assertFilteredContract(result,
        { ...alphaCollections, postponedTasks: ['PROD-113', 'TECH-213'], doneStoryEpics: ['PROD-104', 'TECH-204'] },
        { ...alphaKeySets, postponedAlertKeySet: ['PROD-113', 'TECH-213', 'PROD-103'], doneAlertKeySet: ['PROD-104', 'TECH-204'] },
        { ...alphaGroups, postponedAlertTeams: [['team-a', 'Alpha', ['PROD-113']], ['team-b', 'Beta', ['TECH-213']]], doneEpicTeams: [['team-a', 'Alpha', ['PROD-104']], ['team-b', 'Beta', ['TECH-204']]] },
        { ...alphaCounts, followup: 3, done: 2 }, 10);
});
test('search keeps parent-summary Story matches and direct Epic matches aligned in all projections', () => {
    const result = render({ ...partialFilterFixture(), searchQuery: '  NEEDLE  ' });
    assertFilteredContract(result, alphaCollections, alphaKeySets, alphaGroups, alphaCounts, 8);
    const keyMatch = render({ ...fixture(), searchQuery: 'PROD-4' });
    assertFilteredContract(keyMatch,
        { ...alphaCollections, consolidatedMissingStories: [], blockedTasks: [], postponedTasks: [], futureRoutedEpics: [], needsStoriesEntries: [], needsStoriesEpics: [], waitingForStoriesEpics: [], emptyEpicsForAlert: [], doneStoryEpics: ['PROD-4'] },
        { ...alphaKeySets, missingAlertKeySet: [], blockedAlertKeySet: [], postponedAlertKeySet: [], needsStoriesAlertKeySet: [], waitingAlertKeySet: [], emptyAlertKeySet: [], doneAlertKeySet: ['PROD-4'] },
        { ...alphaGroups, missingAlertTeams: [], blockedAlertTeams: [], postponedAlertTeams: [], postponedEpicTeams: [], needsStoriesTeams: [], analysisEpicTeams: [], emptyEpicTeams: [], doneEpicTeams: [['team-a', 'Alpha', ['PROD-4']]] },
        { ...alphaCounts, missing: 0, blocked: 0, followup: 0, needsStories: 0, waiting: 0, empty: 0 }, 1);
});
test('focused Stats includes only visible Stories and their parent Epic alerts', () => {
    const base = partialFilterFixture();
    const visibleTasksForList = [base.tasks[0], base.tasks[1], base.tasks[3], base.tasks[4]];
    const result = render({ ...base, burnoutTaskFilter: { issueKeys: visibleTasksForList.map(task => task.key) }, visibleTasksForList });
    // Empty, routed and readiness-only Epics have no Story in the focused set.
    // Postponed Stories are excluded even though their parent has other visible Stories.
    assertFilteredContract(result,
        { ...alphaCollections, postponedTasks: [], futureRoutedEpics: [], needsStoriesEntries: [], needsStoriesEpics: [], emptyEpicsForAlert: [] },
        { ...alphaKeySets, postponedAlertKeySet: [], needsStoriesAlertKeySet: [], emptyAlertKeySet: [] },
        { ...alphaGroups, postponedAlertTeams: [], postponedEpicTeams: [], needsStoriesTeams: [], emptyEpicTeams: [] },
        { ...alphaCounts, followup: 0, needsStories: 0, empty: 0 }, 4);
});
test('oversized alert scope suppresses primary Epic producers but preserves independent sources', () => {
    const result = render({ ...fixture(), alertScopeTooLarge: true });
    assert.deepEqual(result.alertCounts, { missing: 1, blocked: 1, followup: 1, backlog: 0, missingTeam: 0, missingLabels: 0, needsStories: 1, waiting: 1, empty: 0, done: 1 });
    assert.equal(result.alertItemCount, 6);
});
test('composite owner owns no state, refs, effects or dashboard imports', () => {
    const source = fs.readFileSync(hookPath, 'utf8');
    assert.doesNotMatch(source, /\buse(?:State|Ref|Effect|LayoutEffect)\b|from ['"][^'"]*dashboard/);
    assert.match(source, /backlogAlertKeySet,/);
});
test('future sprint preserves backlog precedence, missing Team/labels and readiness suppression', () => {
    const backlog = epic('PROD-50', 'Analysis', { sprint: '', teamId: '', teamName: '' });
    const noTeam = epic('PROD-51', 'Analysis', { teamId: '', teamName: '' });
    const noLabels = epic('PROD-52');
    const ready = epic('PROD-53', 'Analysis', { labels: ['Sprint 7', 'alpha'] });
    const epics = [backlog, noTeam, noLabels, ready];
    const entries = epics.map(value => ({ id: `req-${value.key}`, epic: value, team: { id: 'team-a', name: 'Alpha' } }));
    const result = render({ isFutureSprintSelected: true, selectedSprintState: 'future', epicsInScope: epics, backlogProductEpics: [backlog], engWorkHierarchy: { alertTargets: entries } });
    assert.deepEqual(result.alertCounts, { missing: 0, blocked: 0, followup: 0, backlog: 1, missingTeam: 1, missingLabels: 1, needsStories: 1, waiting: 0, empty: 0, done: 0 });
    assert.equal(result.alertItemCount, 4);
    for (const [collection, expected] of [['backlogEpics', ['PROD-50']], ['missingTeamEpics', ['PROD-51']], ['missingLabelEpics', ['PROD-52']], ['needsStoriesEpics', ['PROD-53']]]) assert.deepEqual(keys(result.visibleAlertCollections[collection]), expected);
    assert.deepEqual(keys(result.backlogEpicTeams[0].items), ['PROD-50']);
    assert.deepEqual(keys(result.missingTeamEpicTeams[0].items), ['PROD-51']);
    assert.deepEqual(keys(result.missingLabelEpicTeams[0].items), ['PROD-52']);
    assert.deepEqual(keys(result.needsStoriesTeams[0].items), ['PROD-53']);
});
test('primary Epic fallback supplies waiting alerts when ready-to-close metadata is not loaded', () => {
    const waiting = epic('PROD-60');
    const tasks = [story('PROD-61', 'Done', waiting.key)];
    const result = render({ tasks, readyToCloseTasks: tasks, epicsInScope: [waiting] });
    assert.deepEqual([...result.waitingAlertKeySet], ['PROD-60']);
    assert.deepEqual(keys(result.analysisEpicTeams[0].items), ['PROD-60']);
    assert.equal(result.alertCounts.waiting, 1);
    // Replacement metadata wins by key; the same primary Epic must not duplicate it.
    const replaced = render({ tasks, readyToCloseTasks: tasks, epicsInScope: [waiting], readyToCloseEpicsInScope: [epic('PROD-60', 'Accepted', { openChildCount: 0 })] });
    assert.equal(replaced.alertCounts.waiting, 0);
    assert.deepEqual([...replaced.doneAlertKeySet], ['PROD-60']);
});
test('selected Team scope keeps unknown missing-info stories and groups priorities in stable order', () => {
    const tasks = [story('PROD-71', 'Blocked', 'PROD-1', { summary: 'Zeta', priority: { name: 'Low' } }), story('PROD-72', 'Blocked', 'PROD-1', { summary: 'Beta' }), story('PROD-73', 'Blocked', 'PROD-1', { summary: 'Alpha' }), story('PROD-74', 'Postponed', 'PROD-1', { teamId: 'team-b', teamName: 'Beta' }), story('PROD-75', 'In Progress', 'PROD-1', { teamId: '', teamName: '' })];
    const scope = { ...inputs().scope, isAllTeamsSelected: false };
    const result = render({ scope, tasks, visibleTasks: tasks, visibleTasksForList: tasks });
    assert.deepEqual(keys(result.blockedAlertTeams[0].items), ['PROD-73', 'PROD-72', 'PROD-71']);
    assert.equal(result.postponedAlertTeams.length, 0);
    assert.deepEqual([...result.missingAlertKeySet], ['PROD-75']);
    assert.equal(result.missingAlertTeams[0].name, 'Unknown Team');
});
