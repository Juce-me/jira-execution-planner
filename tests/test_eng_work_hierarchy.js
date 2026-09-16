const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/eng/engWorkHierarchy.js');
}

const SPRINT = { groupId: 'group-1', id: '42', name: 'Sprint 42', state: 'future' };

function task(key, epicKey, priority = 'Major') {
    return { key, fields: { epicKey, priority: { name: priority }, status: { name: 'To Do' } } };
}

function group(key, options = {}) {
    const tasks = options.tasks || [task(`${key}-S1`, key, options.priority)];
    return {
        key,
        epic: {
            key,
            summary: options.summary || key,
            projectClass: options.projectClass || 'product',
            projectTrack: options.projectTrack || 'Committed',
            initiative: options.initiative,
        },
        tasks,
        storyPoints: tasks.length * 3,
    };
}

function readiness(epics, overrides = {}) {
    return {
        schemaVersion: 1,
        complete: true,
        scope: { groupId: 'group-1', sprintId: '42', sprintName: 'Sprint 42', sprintState: 'future' },
        epics,
        ...overrides,
    };
}

function missingEpic(key, teams, options = {}) {
    return {
        key,
        summary: options.summary || key,
        status: { name: 'To Do' },
        priority: { name: options.priority || 'Major' },
        projectTrack: options.projectTrack || 'Committed',
        projectClass: options.projectClass || 'product',
        initiative: options.initiative,
        missingTeams: teams.map(team => ({ reason: 'team_uncovered', ...team })),
    };
}

test('merges one Epic node and one composite requirement per uncovered Team without mutating tasks', async () => {
    const { buildEngWorkHierarchy, storyRequirementId } = await loadModule();
    const original = group('EPIC-1');
    const model = buildEngWorkHierarchy({
        sprint: SPRINT,
        storyEpicGroups: [original],
        readinessSnapshot: readiness([missingEpic('EPIC-1', [
            { id: 'team-a', name: 'Team A' }, { id: 'team-b', name: 'Team B' },
        ])]),
        filters: {},
    });
    assert.equal(model.epicGroups.length, 1);
    assert.equal(model.epicGroups[0].tasks.length, 1);
    assert.equal(model.epicGroups[0].tasks[0], original.tasks[0]);
    assert.equal(model.epicGroups[0].requirements.length, 2);
    assert.equal(model.counts.realStories, 1);
    assert.equal(model.counts.requirements, 2);
    assert.equal(model.counts.visibleRows, 3);
    const id = storyRequirementId({ groupId: 'group-1', sprintId: '42', epicKey: 'EPIC-1', teamId: 'team-a' });
    assert.equal(model.epicGroups[0].requirements[0].id, id);
    assert.equal(model.alertTargetById[id].team.name, 'Team A');
    assert.equal(original.requirements, undefined);
    assert.equal(
        storyRequirementId({ groupId: 'group / one', sprintId: '42', epicKey: 'EPIC 1', teamId: 'team/a' }),
        'story-required::group%20%2F%20one::42::EPIC%201::team%2Fa',
    );
});

test('adds a zero-Story Epic under canonical Initiative metadata and derives no-child state only from snapshot reasons', async () => {
    const { buildEngWorkHierarchy } = await loadModule();
    const model = buildEngWorkHierarchy({
        sprint: SPRINT,
        storyEpicGroups: [],
        readinessSnapshot: readiness([missingEpic('EPIC-EMPTY', [
            { id: 'team-a', name: 'Team A', reason: 'no_stories' },
        ], { initiative: { key: 'INIT-1', summary: 'Initiative' } })]),
        groupByInitiative: true,
    });
    assert.equal(model.epicGroups.length, 1);
    assert.equal(model.epicGroups[0].tasks.length, 0);
    assert.equal(model.epicGroups[0].hasNoChildStories, true);
    assert.equal(model.initiativeGroups[0].initiative.key, 'INIT-1');
    assert.equal(model.initiativeGroups[0].epicGroups[0], model.epicGroups[0]);
});

test('pending, unavailable, incomplete, stale, and completed readiness never assert missing work', async () => {
    const { buildEngWorkHierarchy } = await loadModule();
    const candidate = readiness([missingEpic('EPIC-EMPTY', [{ id: 'team-a', name: 'A' }])]);
    const cases = [
        { snapshot: null, status: 'pending', sprint: SPRINT },
        { snapshot: null, status: 'unavailable', sprint: SPRINT },
        { snapshot: { ...candidate, complete: false }, status: 'unavailable', sprint: SPRINT },
        { snapshot: { ...candidate, scope: { ...candidate.scope, sprintId: '99' } }, status: 'ready', sprint: SPRINT },
        { snapshot: candidate, status: 'ready', sprint: { ...SPRINT, state: 'closed' } },
    ];
    for (const item of cases) {
        const model = buildEngWorkHierarchy({
            sprint: item.sprint, storyEpicGroups: [], readinessSnapshot: item.snapshot, readinessStatus: item.status,
        });
        assert.equal(model.requirements.length, 0);
        assert.equal(model.epicGroups.length, 0);
        assert.equal(model.readiness.complete, false);
    }
});

test('filters requirements by selected Team, project, search, Project Track, Status, and Priority', async () => {
    const { buildEngWorkHierarchy } = await loadModule();
    const snapshot = readiness([
        missingEpic('PROD-1', [{ id: 'team-a', name: 'A' }, { id: 'team-b', name: 'B' }], {
            summary: 'Checkout', projectClass: 'product', projectTrack: 'Committed', initiative: { key: 'I-1', summary: 'Payments' },
        }),
        missingEpic('TECH-1', [{ id: 'team-a', name: 'A' }], { summary: 'Platform', projectClass: 'tech', projectTrack: 'Flexible' }),
    ]);
    const base = { sprint: SPRINT, storyEpicGroups: [], readinessSnapshot: snapshot };
    let model = buildEngWorkHierarchy({ ...base, filters: { selectedTeamIds: ['team-a'], showTech: false, searchQuery: 'payments', projectTracks: ['committed'] } });
    assert.deepEqual(model.requirements.map(item => item.epicKey), ['PROD-1']);
    model = buildEngWorkHierarchy({ ...base, filters: { statusNarrowed: true } });
    assert.equal(model.requirements.length, 0);
    assert.equal(model.alertTargets.length, 3, 'hidden list facets keep local alert targets available');
    model = buildEngWorkHierarchy({ ...base, filters: { priorityNeutral: false } });
    assert.equal(model.requirements.length, 0);
});

test('Planning stably partitions Initiatives, Epics, and rows requirement-first while Catch Up retains Story-first rows', async () => {
    const { buildEngWorkHierarchy } = await loadModule();
    const coveredInitiative = { key: 'INIT-C', summary: 'Covered' };
    const requiredInitiative = { key: 'INIT-R', summary: 'Required' };
    const groups = [
        group('COVERED-1', { priority: 'Blocker', initiative: coveredInitiative }),
        group('REQ-1', { priority: 'Low', initiative: requiredInitiative }),
        group('REQ-2', { priority: 'Highest', initiative: requiredInitiative }),
    ];
    const snapshot = readiness([
        missingEpic('REQ-1', [{ id: 'team-a', name: 'A' }], { initiative: requiredInitiative }),
        missingEpic('REQ-2', [{ id: 'team-a', name: 'A' }], { initiative: requiredInitiative }),
    ]);
    const planning = buildEngWorkHierarchy({
        mode: 'planning', sprint: SPRINT, storyEpicGroups: groups, readinessSnapshot: snapshot, groupByInitiative: true, sort: 'priority',
    });
    assert.deepEqual(planning.initiativeGroups.map(item => item.initiative.key), ['INIT-R', 'INIT-C']);
    assert.deepEqual(planning.initiativeGroups[0].epicGroups.map(item => item.key), ['REQ-2', 'REQ-1']);
    assert.deepEqual(planning.epicGroups.find(item => item.key === 'REQ-1').rows.map(row => row.kind), ['story_requirement', 'story']);
    const catchUp = buildEngWorkHierarchy({
        mode: 'catch_up', sprint: SPRINT, storyEpicGroups: [groups[1]], readinessSnapshot: snapshot,
    });
    assert.deepEqual(catchUp.epicGroups[0].rows.map(row => row.kind), ['story', 'story_requirement']);
});

test('malformed Initiative metadata degrades to ungrouped and duplicate Epic input stays canonical', async () => {
    const { buildEngWorkHierarchy } = await loadModule();
    const model = buildEngWorkHierarchy({
        sprint: SPRINT,
        storyEpicGroups: [group('EPIC-1'), group('EPIC-1')],
        readinessSnapshot: readiness([
            missingEpic('EPIC-1', [{ id: 'team-a', name: 'A' }], { initiative: { summary: 'Missing key' } }),
            missingEpic('EPIC-1', [{ id: 'team-b', name: 'B' }]),
        ]),
        groupByInitiative: true,
    });
    assert.equal(model.epicGroups.length, 1);
    assert.equal(model.initiativeGroups.length, 1);
    assert.equal(model.initiativeGroups[0].initiative, null);
    assert.equal(model.requirements.length, 1);
    assert.ok(model.diagnostics.some(item => item.code === 'duplicate_epic_group'));
    assert.ok(model.diagnostics.some(item => item.code === 'duplicate_readiness_epic'));
    assert.ok(model.diagnostics.some(item => item.code === 'initiative_metadata_invalid'));
});

test('malformed required snapshot metadata fails closed without unreachable alert targets', async () => {
    const { buildEngWorkHierarchy } = await loadModule();
    const model = buildEngWorkHierarchy({
        sprint: SPRINT,
        storyEpicGroups: [],
        readinessSnapshot: readiness([
            missingEpic('BAD-CLASS', [{ id: 'team-a', name: 'A' }], { projectClass: 'unknown' }),
            missingEpic('BAD-REASON', [{ id: 'team-b', name: 'B', reason: 'invented' }]),
        ]),
    });
    assert.equal(model.epicGroups.length, 0);
    assert.equal(model.requirements.length, 0);
    assert.equal(model.alertTargets.length, 0);
    assert.ok(model.diagnostics.some(item => item.code === 'project_class_invalid'));
    assert.ok(model.diagnostics.some(item => item.code === 'requirement_reason_invalid'));
});

test('alert projection preserves precedence, composite dismissal, unique Epic counts, and status copy', async () => {
    const { buildStoryReadinessAlertModel, storyReadinessStatusMessage } = await loadModule();
    const targets = [
        { id: 'a', epic: { key: 'E-1', status: { name: 'To Do' } } },
        { id: 'b', epic: { key: 'E-1', status: { name: 'To Do' } } },
        { id: 'c', epic: { key: 'E-2', status: { name: 'Postponed' } } },
        { id: 'd', epic: { key: 'E-3', status: { name: 'To Do' } } },
    ];
    const model = buildStoryReadinessAlertModel({
        selectedSprintState: 'future', dismissedIds: ['a'], alertTargets: targets,
        isFutureSprintSelected: true, backlogEpicKeys: new Set(['E-3']),
    });
    assert.deepEqual(model.entries.map(entry => entry.id), ['b']);
    assert.deepEqual(model.epics.map(epic => epic.key), ['E-1']);
    assert.deepEqual(Array.from(model.epicKeySet), ['E-1', 'E-2', 'E-3']);
    assert.match(storyReadinessStatusMessage('unavailable'), /temporarily unavailable/);
    assert.equal(storyReadinessStatusMessage('ready'), '');
    assert.equal(storyReadinessStatusMessage('unavailable', 'Navigation failed.'), 'Navigation failed.');
});
