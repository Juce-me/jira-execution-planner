const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../frontend/src/eng/planningAssigneeCapacityModel.js');

const getTeamInfo = task => ({ id: task.fields.teamId });
const normalizeStatus = status => String(status || '').toLowerCase();
const story = (key, accountId, name, sp, { team = 't1', status = 'To Do' } = {}) => ({
    key,
    fields: {
        assignee: accountId === undefined ? { accountId: null, displayName: null } : accountId === 'none' ? null : { accountId, displayName: name },
        customfield_10004: sp, teamId: team, status: { name: status },
    },
});
const options = { teamId: 't1', getTeamInfo, normalizeStatus };

test('hundredths arithmetic avoids float drift and trims display', async () => {
    const m = await load();
    assert.equal(m.formatHundredths(m.sumHundredths([m.toHundredths(0.1), m.toHundredths(0.2)])), '0.3');
    assert.equal(m.formatHundredths(1050), '10.5');
    assert.equal(m.formatHundredths(1000), '10');
    assert.equal(m.formatHundredths(5), '0.05');
    assert.equal(m.toHundredths(null), 0);
    assert.equal(m.numberStringToHundredths('10.25'), 1025);
    assert.equal(m.numberStringToHundredths('7.5'), 750);
});

test('draft validation mirrors the server bounds', async () => {
    const m = await load();
    assert.deepEqual(m.validateNumberDraft(''), { ok: true, value: null });
    assert.deepEqual(m.validateNumberDraft('10.50'), { ok: true, value: '10.5' });
    assert.deepEqual(m.validateNumberDraft('10000'), { ok: true, value: '10000' });
    for (const bad of ['10000.01', '-1', '1.234', 'abc', '1e3', '1,5']) assert.equal(m.validateNumberDraft(bad).ok, false, bad);
    assert.equal(m.validateNoteDraft('a'.repeat(500)).ok, true);
    assert.equal(m.validateNoteDraft('a'.repeat(501)).ok, false);
    assert.equal(m.validateNoteDraft('line\nbreak').ok, false);
    assert.equal(m.validateNoteDraft('tab\there').ok, false);
    assert.equal(m.validateNoteDraft('   ').value, null);
    assert.equal(m.validateCellDraft('vacations', '-2').ok, false);
});

test('Unassigned detection handles a null-field assignee object', async () => {
    const m = await load();
    assert.equal(m.isUnassigned(story('A-1', undefined, null, 1)), true);
    assert.equal(m.isUnassigned(story('A-2', 'none', null, 1)), true);
    assert.equal(m.isUnassigned({ fields: {} }), true);
    assert.equal(m.isUnassigned(story('A-3', 'u1', 'Ann', 1)), false);
});

test('the team list holds non-Killed team Stories: it decides "has Stories" and the Unassigned row, and no Total is summed', async () => {
    const m = await load();
    const tasks = [
        story('A-1', 'u1', 'Ann', 3), story('A-2', 'u1', 'Ann', null), story('A-3', 'u2', 'Bob', 2.5),
        story('A-4', undefined, null, 4), story('A-5', 'u4', 'Killed Only', 9, { status: 'Killed' }),
        story('A-6', 'u3', 'Cy', 8, { team: 't2' }),
    ];
    assert.deepEqual(m.teamTasks(tasks, options).map(task => task.key), ['A-1', 'A-2', 'A-3', 'A-4']);
    assert.equal(m.totalEffortByAssignee, undefined);
    assert.equal(m.mayBeIncomplete, undefined);
    const model = m.buildAssigneeRows({ document: { revision: 1, rows: [{ assigneeKey: 'u4', displayName: 'Killed Only', capacity: '2', vacations: null, notes: null, removed: false }], inherited: null }, teamTasksList: m.teamTasks(tasks, options), selectedTasks: [] });
    assert.deepEqual(model.rows.map(row => [row.key, row.hasStories, row.removable, row.selectedHundredths]), [['u1', true, false, 0], ['u2', true, false, 0], ['u4', false, true, 0]]);
    assert.equal('totalHundredths' in model.rows[0], false);
    assert.equal('totalHundredths' in model.totals, false);
    assert.deepEqual(model.unassigned, { storyCount: 1, selectedHundredths: 0 });
});

test('Selected total equals the sum of the selected list, including Unassigned', async () => {
    const m = await load();
    const selected = [story('A-1', 'u1', 'Ann', 3), story('A-3', 'u2', 'Bob', 0.1), story('A-4', undefined, null, 0.2)];
    const model = m.buildAssigneeRows({ document: { revision: 0, rows: [], inherited: null }, teamTasksList: selected, selectedTasks: selected });
    assert.equal(model.totals.selectedHundredths, m.sumHundredths(selected.map(m.storyPointsHundredths)));
    assert.equal(m.formatHundredths(model.totals.selectedHundredths), '3.3');
});

test('merge: one person one row across Stories, document and inherited', async () => {
    const m = await load();
    const tasks = [story('A-1', 'u1', 'Ann Now', 3)];
    const document = {
        revision: 0, rows: [],
        inherited: { fromSprintId: '41', rows: [
            { assigneeKey: 'u1', displayName: 'Ann Old', capacity: '8', vacations: null, notes: null, removed: false },
            { assigneeKey: 'u9', displayName: 'Gone Person', capacity: '5', vacations: null, notes: null, removed: false },
        ] },
    };
    const model = m.buildAssigneeRows({ document, teamTasksList: tasks, selectedTasks: [] });
    assert.deepEqual(model.rows.map(row => row.key).sort(), ['u1', 'u9']);
    const ann = model.rows.find(row => row.key === 'u1');
    assert.equal(ann.name, 'Ann Now');
    assert.equal(ann.inherited, true);
    assert.equal(ann.capacity, '8');
    assert.equal(model.inheritedFromSprintId, '41');
    const gone = model.rows.find(row => row.key === 'u9');
    assert.equal(gone.name, 'Gone Person');
    assert.equal(gone.removable, true);
    assert.equal(model.totals.capacityHundredths, 1300);
});

test('own document wins over inherited; inherited vacations and notes are not shown; closed Sprint ignores inherited', async () => {
    const m = await load();
    const inherited = { fromSprintId: '41', rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '8', vacations: '2', notes: 'x', removed: false }] };
    const own = m.buildAssigneeRows({ document: { revision: 3, rows: [{ assigneeKey: 'u2', displayName: 'Bob', capacity: '4', vacations: '1', notes: 'n', removed: false }], inherited }, teamTasksList: [], selectedTasks: [] });
    assert.deepEqual(own.rows.map(row => row.key), ['u2']);
    assert.equal(own.rows[0].inherited, false);
    assert.equal(own.rows[0].vacations, '1');
    const gray = m.buildAssigneeRows({ document: { revision: 0, rows: [], inherited }, teamTasksList: [], selectedTasks: [] });
    assert.equal(gray.rows[0].vacations, null);
    assert.equal(gray.rows[0].notes, null);
    const closed = m.buildAssigneeRows({ document: { revision: 0, rows: [], inherited }, teamTasksList: [], selectedTasks: [], ignoreInherited: true });
    assert.deepEqual(closed.rows, []);
});

test('a person with no Stories keeps the stored name; removed people leave the table and Stories override removal', async () => {
    const m = await load();
    const rows = [
        { assigneeKey: 'u1', displayName: 'Dee Deactivated', capacity: '3', vacations: null, notes: null, removed: false },
        { assigneeKey: 'u2', displayName: 'Rem Oved', capacity: '3', vacations: null, notes: null, removed: true },
        { assigneeKey: 'u3', displayName: 'Stale', capacity: '3', vacations: null, notes: null, removed: true },
    ];
    const model = m.buildAssigneeRows({ document: { revision: 2, rows, inherited: null }, teamTasksList: [story('A-1', 'u3', 'Fresh Name', 1)], selectedTasks: [] });
    assert.equal(model.rows.find(row => row.key === 'u1').name, 'Dee Deactivated');
    assert.equal(model.rows.find(row => row.key === 'u1').removable, true);
    assert.deepEqual(model.removed, [{ key: 'u2', name: 'Rem Oved' }]);
    const u3 = model.rows.find(row => row.key === 'u3');
    assert.equal(u3.name, 'Fresh Name');
    assert.equal(u3.removable, false);
    assert.equal(model.totals.capacityHundredths, 600);
});

test('rows sort by name then key', async () => {
    const m = await load();
    const tasks = [story('A-1', 'u2', 'Sam', 1), story('A-2', 'u1', 'Sam', 1), story('A-3', 'u3', 'Abe', 1)];
    const model = m.buildAssigneeRows({ document: { revision: 0, rows: [], inherited: null }, teamTasksList: tasks, selectedTasks: [] });
    assert.deepEqual(model.rows.map(row => row.key), ['u3', 'u1', 'u2']);
});

test('cues: over above 120%, under below 90%, only with Capacity; matches getCapacityStatus', async () => {
    const m = await load();
    const { getCapacityStatus } = await import('../frontend/src/eng/planningCapacityUtils.js');
    assert.equal(m.capacityCue(1201, 1000), 'over');
    assert.equal(m.capacityCue(1200, 1000), '');
    assert.equal(m.capacityCue(899, 1000), 'under');
    assert.equal(m.capacityCue(900, 1000), '');
    assert.equal(m.capacityCue(500, null), '');
    assert.equal(m.capacityCue(500, 0), '');
    assert.equal(m.capacityCue(360, 300), '', '3.6 / 3 is exactly 120%, float division would say over');
    for (const [selected, capacity] of [[13, 10], [12, 10], [8, 10], [9, 10], [10, 10]]) {
        assert.equal(m.capacityCue(selected * 100, capacity * 100), getCapacityStatus(selected, capacity).status);
    }
});

test('Totals cue compares the displayed Selected total (people plus Unassigned) against the sum of Capacity', async () => {
    const m = await load();
    const rows = [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '10', vacations: null, notes: null, removed: false }];
    const tasks = [story('A-1', 'u1', 'Ann', 10), story('A-2', undefined, null, 20)];
    const model = m.buildAssigneeRows({ document: { revision: 1, rows, inherited: null }, teamTasksList: tasks, selectedTasks: tasks });
    // 30 shown against 10: the cue uses the same numbers the Totals row displays.
    assert.equal(model.totals.selectedHundredths, 3000);
    assert.equal(model.totals.cue, 'over');
    assert.equal(model.totals.cue, m.capacityCue(model.totals.selectedHundredths, model.totals.capacityHundredths));
    assert.equal(model.rows[0].cue, '');
    // 8 for Ann plus 2 Unassigned = 10 against 10: within range although people alone (8) would read under.
    const even = m.buildAssigneeRows({ document: { revision: 1, rows, inherited: null }, teamTasksList: tasks, selectedTasks: [story('A-1', 'u1', 'Ann', 8), story('A-2', undefined, null, 2)] });
    assert.equal(even.totals.cue, '');
    assert.equal(m.buildAssigneeRows({ document: { revision: 0, rows: [], inherited: null }, teamTasksList: tasks, selectedTasks: tasks }).totals.cue, '');
});

test('displayName snapshots are made safe before sending: no control characters, at most 200 code points', async () => {
    const m = await load();
    assert.equal(m.sanitizeDisplayName('Ann\u0007 Synthetic\n'), 'Ann Synthetic');
    assert.equal(Array.from(m.sanitizeDisplayName('\u{1F600}'.repeat(250))).length, 200);
    assert.equal(m.sanitizeDisplayName('\u0001\u0002'), null);
    assert.equal(m.sanitizeDisplayName(null), null);
    assert.equal(m.isValidDisplayName('x'.repeat(200)), true);
    assert.equal(m.isValidDisplayName('x'.repeat(201)), false);
    assert.equal(m.isValidDisplayName('a\tb'), false);
    const shown = [{ key: 'u1', storyName: 'x'.repeat(300), storedName: null, capacity: null }];
    const [change] = m.buildChanges([{ key: 'u1', field: 'capacity', value: '3' }], shown);
    assert.equal(change.displayName.length, 200);
    const bad = [{ key: 'u2', storyName: '\u0003', storedName: null, capacity: null }];
    assert.deepEqual(m.buildChanges([{ key: 'u2', field: 'capacity', value: '3' }], bad), [{ assigneeKey: 'u2', capacity: '3' }]);
});

test('selected Stories of the Team hidden by filters are counted', async () => {
    const m = await load();
    const team = [story('A-1', 'u1', 'Ann', 1), story('A-2', 'u1', 'Ann', 2), story('A-3', 'u2', 'Bob', 3)];
    assert.equal(m.hiddenSelectedCount(team, { 'A-1': true, 'A-2': true, 'B-9': true }, [team[0]]), 1);
    assert.equal(m.hiddenSelectedCount(team, { 'A-1': true }, [team[0]]), 0);
    assert.equal(m.hiddenSelectedCount(team, null, []), 0);
});

test('removable only without Stories', async () => {
    const m = await load();
    const rows = [{ assigneeKey: 'u1', displayName: 'Ann', capacity: null, vacations: null, notes: null, removed: false }, { assigneeKey: 'u2', displayName: 'Bob', capacity: null, vacations: null, notes: null, removed: false }];
    const model = m.buildAssigneeRows({ document: { revision: 1, rows, inherited: null }, teamTasksList: [story('A-1', 'u1', 'Ann', 1)], selectedTasks: [] });
    assert.equal(model.rows.find(row => row.key === 'u1').removable, false);
    assert.equal(model.rows.find(row => row.key === 'u2').removable, true);
});

test('no-op commits send nothing; inherited values are never sent', async () => {
    const m = await load();
    const document = { revision: 0, rows: [], inherited: { fromSprintId: '41', rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '8', vacations: null, notes: null, removed: false }] } };
    const model = m.buildAssigneeRows({ document, teamTasksList: [], selectedTasks: [] });
    assert.deepEqual(m.buildChanges([{ key: 'u1', field: 'capacity', value: '8' }, { key: 'u1', field: 'vacations', value: null }, { key: 'u1', field: 'notes', value: null }], model.rows), []);
    assert.deepEqual(m.buildChanges([{ key: 'u1', field: 'capacity', value: '8.00' }].map(c => ({ ...c, value: m.validateNumberDraft(c.value).value })), model.rows), []);
    // editing Vacations on a gray row sends only Vacations, never the inherited Capacity
    assert.deepEqual(m.buildChanges([{ key: 'u1', field: 'vacations', value: '2' }], model.rows), [{ assigneeKey: 'u1', vacations: '2' }]);
});

test('coalescing keeps the last value per field and drops a round trip back to the shown value', async () => {
    const m = await load();
    const rows = [{ key: 'u1', name: 'Ann', storyName: null, storedName: 'Ann', capacity: '5', vacations: null, notes: null }];
    const commits = [
        { key: 'u1', field: 'capacity', value: '6' }, { key: 'u1', field: 'capacity', value: '7' },
        { key: 'u1', field: 'notes', value: 'a' }, { key: 'u1', field: 'notes', value: null },
        { key: 'u2', field: 'capacity', value: '3' },
    ];
    assert.deepEqual(m.buildChanges(commits, rows), [{ assigneeKey: 'u1', capacity: '7' }, { assigneeKey: 'u2', capacity: '3' }]);
});

test('displayName is sent only when a Story supplies a differing current name', async () => {
    const m = await load();
    const tasks = [story('A-1', 'u1', 'Ann New', 1), story('A-2', 'u2', 'Bob', 1)];
    const rows = [{ assigneeKey: 'u1', displayName: 'Ann Old', capacity: null, vacations: null, notes: null, removed: false }, { assigneeKey: 'u2', displayName: 'Bob', capacity: null, vacations: null, notes: null, removed: false }];
    const model = m.buildAssigneeRows({ document: { revision: 1, rows, inherited: null }, teamTasksList: tasks, selectedTasks: [] });
    assert.deepEqual(m.buildChanges([{ key: 'u1', field: 'capacity', value: '4' }, { key: 'u2', field: 'capacity', value: '4' }], model.rows), [
        { assigneeKey: 'u1', capacity: '4', displayName: 'Ann New' },
        { assigneeKey: 'u2', capacity: '4' },
    ]);
    // a Story person with no row yet gets one, with their name
    const fresh = m.buildAssigneeRows({ document: { revision: 1, rows: [], inherited: null }, teamTasksList: tasks, selectedTasks: [] });
    assert.deepEqual(m.buildChanges([{ key: 'u1', field: 'capacity', value: '4' }], fresh.rows), [{ assigneeKey: 'u1', capacity: '4', displayName: 'Ann New' }]);
});

test('remove and restore commits', async () => {
    const m = await load();
    const rows = [{ assigneeKey: 'u1', displayName: 'Ann', capacity: null, vacations: null, notes: null, removed: false }, { assigneeKey: 'u2', displayName: 'Bob', capacity: null, vacations: null, notes: null, removed: true }];
    const model = m.buildAssigneeRows({ document: { revision: 1, rows, inherited: null }, teamTasksList: [], selectedTasks: [] });
    const removedKeys = model.removed.map(row => row.key);
    assert.deepEqual(m.buildChanges([{ key: 'u1', field: 'removed', value: true }, { key: 'u2', field: 'removed', value: false }], model.rows, removedKeys), [
        { assigneeKey: 'u1', removed: true }, { assigneeKey: 'u2', removed: false },
    ]);
    assert.deepEqual(m.buildChanges([{ key: 'u1', field: 'removed', value: false }], model.rows, removedKeys), []);
});

test('chunkChanges respects the 50-change limit', async () => {
    const m = await load();
    const changes = Array.from({ length: 120 }, (_, index) => ({ assigneeKey: `u${index}` }));
    assert.deepEqual(m.chunkChanges(changes).map(chunk => chunk.length), [50, 50, 20]);
});

test('underbar: one segment per person with Planned capacity or effort, max(capacity, effort) wide, plus Unassigned effort', async () => {
    const m = await load();
    const tasks = [story('S-1', 'a', 'Ann', 3), story('S-2', 'b', 'Bob', 5), story('S-3', undefined, null, 4), story('S-4', 'c', 'Cy', 2)];
    const doc = { revision: 1, rows: [
        { assigneeKey: 'a', displayName: 'Ann', capacity: '8', vacations: null, notes: null, removed: false },
        { assigneeKey: 'b', displayName: 'Bob', capacity: '6', vacations: null, notes: null, removed: false },
        { assigneeKey: 'z', displayName: 'Zed', capacity: null, vacations: null, notes: null, removed: false },
        { assigneeKey: 'gone', displayName: 'Gone', capacity: '9', vacations: null, notes: null, removed: true },
    ] };
    // Ann (Capacity 8, effort 3), Cy (no Capacity, effort 2) and the unassigned Story are checked; Bob (Capacity 6) has
    // nothing selected; Zed has neither; Gone is removed.
    const view = m.buildAssigneeRows({ document: doc, teamTasksList: m.teamTasks(tasks, options), selectedTasks: [tasks[0], tasks[2], tasks[3]] });
    const bar = m.buildUnderbar(view);
    assert.deepEqual(bar.people.map(person => [person.key, person.widthHundredths, person.base, person.overlay]), [
        ['a', 800, 'tint', { tone: 'solid', hundredths: 300 }],
        ['b', 600, 'tint', null],
        ['c', 200, 'solid', null],
    ]);
    assert.deepEqual(bar.unassigned, { key: m.UNDERBAR_UNASSIGNED_KEY, name: 'Unassigned (effort)', selectedHundredths: 400 });
    // The total is what the strip spans: 8 + 6 + 2 + 4 = 20, more than the Estimated effort total (9).
    assert.equal(bar.totalHundredths, 2000);
    assert.equal(view.totals.selectedHundredths, 900);
    assert.equal(bar.selectedHundredths, 900, 'the strip still knows the Estimated effort total it shows');
    // Nothing checked still draws the capacity-only people; nobody with a number draws nothing.
    const none = m.buildAssigneeRows({ document: doc, teamTasksList: m.teamTasks(tasks, options), selectedTasks: [] });
    assert.deepEqual(m.buildUnderbar(none).people.map(person => person.key), ['a', 'b']);
    assert.equal(m.buildUnderbar(none).unassigned, null);
    assert.equal(m.buildUnderbar({ rows: [{ key: 'z', name: 'Zed', capacity: null, selectedHundredths: 0 }], unassigned: null }), null);
    assert.equal(m.buildUnderbar(null), null);
    assert.equal(m.underbarOnBarAxis, undefined);
});

test('underbar layers: the effort lies on top below capacity, the capacity lies on top once effort reaches or passes it', async () => {
    const m = await load();
    // effort < capacity: tinted capacity full width, solid effort on top; the tinted rest is the capacity left.
    assert.deepEqual(m.underbarLayers(800, 300), { widthHundredths: 800, base: 'tint', overlay: { tone: 'solid', hundredths: 300 } });
    // effort = capacity: the rule "capacity on top when effort >= capacity" makes it fully tinted over solid.
    assert.deepEqual(m.underbarLayers(500, 500), { widthHundredths: 500, base: 'solid', overlay: { tone: 'tint', hundredths: 500 } });
    // effort > capacity: solid effort full width, tinted capacity on top up to where capacity is used up.
    assert.deepEqual(m.underbarLayers(400, 650), { widthHundredths: 650, base: 'solid', overlay: { tone: 'tint', hundredths: 400 } });
    // hundredths, not floats: 0.01 below and above.
    assert.deepEqual(m.underbarLayers(1001, 1000).overlay, { tone: 'solid', hundredths: 1000 });
    assert.deepEqual(m.underbarLayers(999, 1000).overlay, { tone: 'tint', hundredths: 999 });
    // capacity only, effort only, neither (blank and zero capacity are the same here).
    assert.deepEqual(m.underbarLayers(500, 0), { widthHundredths: 500, base: 'tint', overlay: null });
    assert.deepEqual(m.underbarLayers(null, 300), { widthHundredths: 300, base: 'solid', overlay: null });
    assert.deepEqual(m.underbarLayers(0, 300), { widthHundredths: 300, base: 'solid', overlay: null });
    assert.equal(m.underbarLayers(null, 0), null);
    assert.equal(m.underbarLayers(0, 0), null);
});

test('capacity balance readout text: capacity left, over capacity, none without capacity; at most two decimals', async () => {
    const m = await load();
    assert.equal(m.capacityBalanceText(800, 500), '3 SP capacity left');
    assert.equal(m.capacityBalanceText(500, 500), '0 SP capacity left');
    assert.equal(m.capacityBalanceText(400, 650), '2.5 SP over capacity');
    assert.equal(m.capacityBalanceText(1025, 0), '10.25 SP capacity left');
    assert.equal(m.capacityBalanceText(null, 300), null);
    assert.equal(m.capacityBalanceText(0, 300), null);
});

test('mark: on plan within 20% of a set capacity (inclusive), over above 120%, none otherwise, in integer hundredths', async () => {
    const m = await load();
    // Capacity 5: 0.8 x 5 = 4 exactly is on plan, 0.01 less is none; 1.2 x 5 = 6 exactly is on plan, 0.01 more is over.
    assert.equal(m.capacityMark(500, 400), 'on-plan');
    assert.equal(m.capacityMark(500, 399), null);
    assert.equal(m.capacityMark(500, 500), 'on-plan');
    assert.equal(m.capacityMark(500, 600), 'on-plan');
    assert.equal(m.capacityMark(500, 601), 'over');
    // No float drift: capacity 3, effort 3.6 (3 x 1.2 = 3.5999… in floats) and 2.4 (3 x 0.8 = 2.4000…04).
    assert.equal(m.capacityMark(300, 360), 'on-plan');
    assert.equal(m.capacityMark(300, 361), 'over');
    assert.equal(m.capacityMark(300, 240), 'on-plan');
    assert.equal(m.capacityMark(300, 239), null);
    // Effort 0 with capacity, and spare capacity, get no mark.
    assert.equal(m.capacityMark(500, 0), null);
    assert.equal(m.capacityMark(800, 300), null);
    // No capacity set (blank, null or 0) never gets a mark, however large the effort.
    assert.equal(m.capacityMark(null, 900), null);
    assert.equal(m.capacityMark(0, 900), null);
    assert.equal(m.capacityMark(m.numberStringToHundredths(''), 900), null);
    assert.equal(m.capacityMarkText('over', 500, 800), 'Effort 8 SP, capacity 5 SP: 3 SP over capacity');
    assert.equal(m.capacityMarkText('over', 100, 1025), 'Effort 10.25 SP, capacity 1 SP: 9.25 SP over capacity');
    assert.equal(m.capacityMarkText('on-plan', 250, 300), 'Effort 3 SP of capacity 2.5 SP: on plan');
    assert.equal(m.capacityMarkText('on-plan', 1025, 820), 'Effort 8.2 SP of capacity 10.25 SP: on plan');
    assert.equal(m.capacityMarkText(null, 500, 0), '');
});

test('a person row tint equals the underbar segment colour for every person, and people with no segment get none', async () => {
    const m = await load();
    const row = (key, name, capacity, selectedHundredths) => ({ key, name, capacity, selectedHundredths });
    // Bob and Ann carry Estimated effort; Cy has Capacity but nothing selected (a tinted-only segment); Di neither.
    const rows = [row('acc-b', 'Bob', '6', 300), row('acc-a', 'Ann', null, 500), row('acc-c', 'Cy', '4', 0), row('acc-d', 'Di', null, 0), row('acc-e', 'Eve', '0', 0)];
    const map = m.buildAssigneeColorMap(rows);
    // Sorted by name: Ann, Bob, Cy, Di, Eve take the palette in order.
    assert.deepEqual(map, { 'acc-a': m.ASSIGNEE_PALETTE[0], 'acc-b': m.ASSIGNEE_PALETTE[1], 'acc-c': m.ASSIGNEE_PALETTE[2], 'acc-d': m.ASSIGNEE_PALETTE[3], 'acc-e': m.ASSIGNEE_PALETTE[4] });
    const bar = m.buildUnderbar({ rows, unassigned: null });
    assert.deepEqual(bar.people.map(person => person.key), ['acc-b', 'acc-a', 'acc-c']);
    for (const person of bar.people) {
        const source = rows.find(entry => entry.key === person.key);
        assert.equal(m.assigneeRowColor(source, map), m.resolveAssigneeColor(person.key, map));
    }
    assert.equal(m.assigneeRowColor(rows[3], map), null);
    assert.equal(m.assigneeRowColor(rows[4], map), null, 'Capacity 0 and no effort: no segment, no tint');
    assert.notEqual(m.assigneeRowColor(rows[0], map), m.assigneeRowColor(rows[1], map));
    assert.ok(m.ASSIGNEE_PALETTE.includes(m.resolveAssigneeColor('unmapped', map)));
});

test('the assignee palette leaves out the colours that clash with the Unassigned pink and the amber bar and text', async () => {
    const m = await load();
    const { RADAR_PALETTE } = await import('../frontend/src/stats/statsConstants.js');
    for (const clash of ['#eab308', '#db2777', '#d97706']) assert.equal(m.ASSIGNEE_PALETTE.includes(clash), false, clash);
    assert.deepEqual(m.ASSIGNEE_PALETTE, RADAR_PALETTE.filter(color => !['#eab308', '#db2777', '#d97706'].includes(color)));
    // Warm hues (red through yellow: hue below 65 degrees or above 300) are absent, so nothing reads as pink or amber.
    const hue = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b); if (max === min) return null; const d = max - min; const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
    for (const color of m.ASSIGNEE_PALETTE) { const h = hue(color); if (h != null && color !== '#78716c') assert.ok(h >= 65 && h <= 300, `${color} ${h}`); }
});

// ---- Team capacity (not in Jira), #323 Task 8 ----

test('planned equality rounds both sides half-up to hundredths; absent equals absent only', async () => {
    const m = await load();
    assert.equal(m.roundHalfUpHundredths(1.005), 101);
    assert.equal(m.roundHalfUpHundredths(12.345), 1235);
    assert.equal(m.roundHalfUpHundredths('12.3'), 1230);
    assert.equal(m.roundHalfUpHundredths(null), null);
    assert.equal(m.samePlannedValue({ value: '12.35' }, { value: 12.345 }), true);
    assert.equal(m.samePlannedValue({ value: '12.34' }, { value: 12.345 }), false);
    assert.equal(m.samePlannedValue(null, null), true);
    assert.equal(m.samePlannedValue(null, { value: '0' }), false);
    assert.equal(m.plannedWireValue(12.345), '12.35');
    assert.equal(m.plannedWireValue(20), '20');
    assert.equal(m.plannedWireValue(10000.004), '10000');
    assert.equal(m.plannedWireValue(10001), null);
    assert.equal(m.plannedWireValue(-1), null);
    assert.equal(m.plannedWireValue(null), null);
});

test('the shown stored number: own document, else the inherited one (gray, source inherited)', async () => {
    const m = await load();
    assert.deepEqual(m.effectivePlanned({ revision: 2, planned: { value: '14', source: 'user' }, inherited: null }), { value: '14', source: 'user' });
    assert.deepEqual(m.effectivePlanned({ revision: 0, planned: null, inherited: { rows: [], planned: { value: '9', source: 'inherited' } } }), { value: '9', source: 'inherited' });
    assert.equal(m.effectivePlanned({ revision: 0, planned: null, inherited: null }), null);
    assert.equal(m.effectivePlanned(null), null);
});

test('a typed equal number is a no-op whatever its source; a jira write also converts the source', async () => {
    const m = await load();
    assert.equal(m.isPlannedNoop({ value: '9', source: 'inherited' }, { value: '9.00', source: 'user' }), true);
    assert.equal(m.isPlannedNoop({ value: '9', source: 'user' }, { value: '9', source: 'jira' }), false);
    assert.equal(m.isPlannedNoop({ value: '9', source: 'jira' }, { value: '9', source: 'jira' }), true);
    assert.equal(m.isPlannedNoop(null, { value: null }), true);
    assert.equal(m.isPlannedNoop({ value: '9', source: 'user' }, { value: null }), false);
});

test('the overlay keeps the gray number while a row commit is pending and applies a planned commit', async () => {
    const m = await load();
    const inheritedDoc = { revision: 0, rows: [], planned: null, inherited: { fromSprintId: '9', rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '5', removed: false }], planned: { value: '12', source: 'inherited' } } };
    const rowPending = m.applyChangesToDocument(inheritedDoc, [{ assigneeKey: 'u1', vacations: '1' }]);
    assert.deepEqual(rowPending.planned, { value: '12', source: 'inherited' }, 'a pending row commit does not drop the gray number');
    assert.equal(rowPending.inherited, null);
    const plannedPending = m.applyChangesToDocument(inheritedDoc, [{ assigneeKey: m.PLANNED_SLOT, planned: { value: '15', source: 'user' } }]);
    assert.deepEqual(plannedPending.planned, { value: '15', source: 'user' });
    assert.deepEqual(plannedPending.rows.map(row => row.assigneeKey), ['u1'], 'the planned slot is never a row');
    const cleared = m.applyChangesToDocument({ revision: 1, rows: [], planned: { value: '15', source: 'user' } }, [{ assigneeKey: m.PLANNED_SLOT, planned: { value: null } }]);
    assert.equal(cleared.planned, null);
});

test('pruneChange drops a planned change the document already holds (after rounding)', async () => {
    const m = await load();
    const document = { revision: 1, rows: [], planned: { value: '12.35', source: 'user' } };
    assert.equal(m.pruneChange({ assigneeKey: m.PLANNED_SLOT, planned: { value: '12.35', source: 'user' } }, document), null);
    const change = { assigneeKey: m.PLANNED_SLOT, planned: { value: '13', source: 'user' } };
    assert.deepEqual(m.pruneChange(change, document), change);
});

test('addAssigneeAction: existing row is a focus no-op, removed is Restore, new is a named change with no Capacity', async () => {
    const m = await load();
    const rows = [{ key: 'u1', name: 'Ann' }];
    assert.deepEqual(m.addAssigneeAction({ accountId: 'u1', displayName: 'Ann' }, rows, []), { type: 'exists', key: 'u1' });
    assert.deepEqual(m.addAssigneeAction({ accountId: 'u9', displayName: 'Old' }, rows, ['u9']), { type: 'restore', key: 'u9' });
    assert.deepEqual(m.addAssigneeAction({ accountId: 'u7', displayName: ' Cy\u0007 ' }, rows, []), { type: 'add', key: 'u7', change: { assigneeKey: 'u7', displayName: 'Cy' } });
    assert.equal(m.addAssigneeAction({ accountId: 'u7', displayName: '  ' }, rows, []), null);
    assert.equal(m.addAssigneeAction({ displayName: 'No id' }, rows, []), null);
});

test('pruneChange keeps an Add assignee (a named change for a person not stored) and drops a name-only refresh', async () => {
    const m = await load();
    const document = { revision: 1, rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '5', vacations: null, notes: null, removed: false }], inherited: null, planned: null };
    assert.deepEqual(m.pruneChange({ assigneeKey: 'u7', displayName: 'Cy' }, document), { assigneeKey: 'u7', displayName: 'Cy' });
    assert.equal(m.pruneChange({ assigneeKey: 'u1', displayName: 'Ann B' }, document), null);
    const inherited = { revision: 0, rows: [], inherited: { fromSprintId: '9', rows: [{ assigneeKey: 'u1', displayName: 'Ann', capacity: '5' }], planned: null }, planned: null };
    assert.equal(m.pruneChange({ assigneeKey: 'u1', displayName: 'Ann' }, inherited), null);
});

test('a person added with no Stories stays a row under the stored name and is inherited by the next Sprint', async () => {
    const m = await load();
    const saved = { revision: 2, rows: [{ assigneeKey: 'u7', displayName: 'Cy', capacity: null, vacations: null, notes: null, removed: false }], inherited: null };
    const view = m.buildAssigneeRows({ document: saved, teamTasksList: [], selectedTasks: [] });
    assert.deepEqual(view.rows.map(row => [row.key, row.name, row.capacity, row.removable]), [['u7', 'Cy', null, true]]);
    const next = { revision: 0, rows: [], inherited: { fromSprintId: '100', rows: saved.rows } };
    assert.deepEqual(m.buildAssigneeRows({ document: next, teamTasksList: [], selectedTasks: [] }).rows.map(row => row.name), ['Cy']);
});

test('assignee avatar URLs come from the loaded Stories by account id, first one wins, unassigned and blank skipped', async () => {
    const m = await load();
    const withAvatar = (task, url) => ({ ...task, fields: { ...task.fields, assignee: { ...task.fields.assignee, avatarUrl: url } } });
    const urls = m.assigneeAvatarUrls([
        withAvatar(story('S-1', 'a', 'Ann', 1), 'https://host.example/a1'),
        withAvatar(story('S-2', 'a', 'Ann', 1), 'https://host.example/a2'),
        withAvatar(story('S-3', 'b', 'Bob', 1), ''),
        story('S-4', 'c', 'Cy', 1),
        story('S-5', undefined, null, 1),
        story('S-6', 'none', null, 1),
    ]);
    assert.deepEqual([...urls], [['a', 'https://host.example/a1']]);
    assert.equal(m.assigneeAvatarUrls(null).size, 0);
});
