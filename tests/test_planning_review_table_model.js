const test = require('node:test');
const assert = require('node:assert/strict');
const model = () => import('../frontend/src/eng/planningReviewTableModel.js');
const story = (id, key, sp, team = 'Alpha', project = 'DEMO') => ({ id, key, fields: { summary: `${key} summary`, customfield_10004: sp, teamId: team, teamName: team, projectKey: project, status: { name: 'To Do' }, priority: { name: 'High' } } });

test('exact three decimal arithmetic preserves zero/null and validates lexical magnitude', async () => {
    const { parseReviewNumber, formatReviewScaled, validateReviewValue } = await model();
    assert.equal(parseReviewNumber('').value, null);
    assert.equal(parseReviewNumber('0').scaled, 0n);
    assert.equal(parseReviewNumber('999999999.999').scaled, 999999999999n);
    assert.equal(parseReviewNumber('-999999999.999').scaled, -999999999999n);
    for (const input of ['1e3', '.5', '2.', 'Infinity', '1.2345', '1000000000', '1,2']) assert.equal(parseReviewNumber(input).valid, false, input);
    assert.equal(formatReviewScaled(parseReviewNumber('0.1').scaled + parseReviewNumber('0.2').scaled), '0.3');
    assert.equal(validateReviewValue({ type: 'text' }, 'a'.repeat(501)).valid, false);
});

test('review numbers accept at most one decimal place and display without trailing zeros', async () => {
    const { validateReviewValue, formatReviewDisplay, parseReviewNumber } = await model();
    const number = { type: 'number' };
    for (const input of ['', '0', '12', '12.5', '-3.2', '999999999.9', '-999999999.9']) assert.equal(validateReviewValue(number, input).valid, true, input);
    for (const input of ['1.25', '0.001', '12.000', '999999999.99', '1000000000', '1e3', '.5', '2.']) assert.equal(validateReviewValue(number, input).valid, false, input);
    assert.match(validateReviewValue(number, '1.25').error, /999999999\.9 with at most one decimal place/);
    // Stored values written earlier may carry three decimals: they still parse exactly for totals and sorting.
    assert.equal(parseReviewNumber('0.001').valid, true);
    for (const [stored, shown] of [['12.000', '12'], ['55000.000', '55000'], ['12.500', '12.5'], ['-0.000', '0'], ['0.001', '0.001'], ['999999999.900', '999999999.9'], [null, ''], ['', ''], ['not a number', 'not a number']]) assert.equal(formatReviewDisplay(stored), shown, String(stored));
});

test('only real Epic and Story rows without points count as zero SP', async () => {
    const { hasZeroStoryPoints } = await model();
    for (const row of [{ rowKind: 'story', storyPoints: 0 }, { rowKind: 'story', storyPoints: null }, { rowKind: 'story', storyPoints: '0.0' }, { rowKind: 'epic', storyPoints: '0' }, { rowKind: 'epic', storyPoints: '0.000' }]) assert.equal(hasZeroStoryPoints(row), true, JSON.stringify(row));
    for (const row of [{ rowKind: 'story', storyPoints: 0.5 }, { rowKind: 'story', storyPoints: 3 }, { rowKind: 'epic', storyPoints: '2.5' }, { rowKind: 'epic', storyPoints: 'n/a' }, { rowKind: 'requirement', synthetic: true, storyPoints: 0 }, { rowKind: 'group', synthetic: true, storyPoints: '0' }]) assert.equal(hasZeroStoryPoints(row), false, JSON.stringify(row));
});

test('hierarchy projection keeps readiness-only Epics, orphan Stories and synthetic requirements', async () => {
    const { buildPlanningReviewRows, reviewSelectionState } = await model();
    const stories = [story('1', 'DEMO-1', 0.1), story('2', 'DEMO-2', 0.2), story('3', 'DEMO-3', 3)];
    const epicGroups = [{ key: 'DEMO-10', epic: { id: '10', key: 'DEMO-10', summary: 'Epic', teamName: 'Own Team', projectTrack: 'Product', components: ['Platform'] }, tasks: stories.slice(0, 2), requirements: [] }, { key: 'DEMO-20', epic: { id: '20', key: 'DEMO-20' }, tasks: [], requirements: [{ id: 'requirement', team: { name: 'Beta' } }] }];
    const epics = buildPlanningReviewRows({ epicGroups, visibleTasks: stories });
    assert.equal(epics.length, 3);
    assert.equal(epics[0].storyPoints, '0.3');
    assert.equal(epics[0].components, 'Platform');
    assert.deepEqual(epics[0].teamsInScope, ['Alpha']);
    assert.equal(epics[1].issueId, '20');
    assert.equal(epics[2].synthetic, true);
    assert.equal(epics[2].summary, 'No Epic');
    assert.deepEqual(reviewSelectionState(epics[0], new Set(['DEMO-1'])), { checked: false, mixed: true, disabled: false, tasks: stories.slice(0, 2) });
    assert.equal(reviewSelectionState(epics[2]).disabled, true);
    const rows = buildPlanningReviewRows({ epicGroups, visibleTasks: stories, mode: 'story' });
    assert.equal(rows.filter(row => row.rowKind === 'story').length, 3);
    assert.equal(rows[0].epic, 'Epic');
    assert.equal(rows[0].epicKey, 'DEMO-10');
    assert.equal(rows[0].projectTrack, 'Product');
    assert.equal(rows.filter(row => row.rowKind === 'requirement').length, 1);
    const placeholder=rows.find(row=>row.rowKind==='requirement');
    assert.equal(placeholder.epicKey,'DEMO-20');
    assert.equal(placeholder.epic,'DEMO-20');
    assert.equal(placeholder.synthetic,true);
    assert.match(placeholder.summary,/Story awaiting creation for Beta/);
    assert.equal(reviewSelectionState(placeholder).disabled,true);
    assert.equal(rows.find(row => row.key === 'DEMO-3').epicKey, null);
});

test('scope columns avoid Sprint/numeric priority and use admitted dimensions despite filters', async () => {
    const { buildPlanningReviewColumns } = await model();
    const columns = buildPlanningReviewColumns({ mode: 'epic', rows: [], admittedTeamCount: 2, admittedProjectCount: 2 });
    assert.deepEqual(columns.map(column => column.id), ['key', 'summary', 'status', 'priority', 'storyPoints', 'accepted', 'teamsInScope', 'project', 'team', 'assignee', 'components', 'capacity', 'projectTrack']);
    assert.equal(columns.find(column => column.id === 'storyPoints').label, 'Sprint SP');
    const narrow = buildPlanningReviewColumns({ mode: 'story', rows: [], admittedTeamCount: 1, admittedProjectCount: 1 });
    assert.ok(!narrow.some(column => column.id === 'team' || column.id === 'project'));
});

test('totals cover every visible row, custom Epic/Story independent and synthetic cells excluded', async () => {
    const { planningReviewTotals, reviewCellKey } = await model();
    const rows = [{ rowKind: 'story', issueId: '1', storyPoints: 0.1 }, { rowKind: 'story', issueId: '2', storyPoints: 0.2 }, { rowKind: 'requirement', issueId: 'x', synthetic: true, storyPoints: 0 }];
    const columns = [{ id: 'storyPoints', type: 'number', aggregation: 'sum' }, { id: 'cost', type: 'number', custom: true, aggregation: 'sum' }, { id: 'rank', type: 'number', custom: true, aggregation: 'none' }];
    const cells = { [reviewCellKey('story', '1', 'cost')]: { value: '999999999.999' }, [reviewCellKey('story', '2', 'cost')]: { value: '0.001' }, [reviewCellKey('epic', '1', 'cost')]: { value: '99' }, [reviewCellKey('requirement', 'x', 'cost')]: { value: '99' } };
    assert.deepEqual(planningReviewTotals(rows, columns, cells), { storyPoints: '0.3', cost: '1000000000' });
});

test('sorting is numeric, natural, blank-last in either direction and immutable-id tied', async () => {
    const { sortPlanningReviewRows, reviewCellKey } = await model();
    const rows = [{ issueId: '10', id: '10', rowKind: 'story', summary: 'Item 10' }, { issueId: '2', id: '2', rowKind: 'story', summary: 'Item 2' }, { issueId: '3', id: '3', rowKind: 'story', summary: '' }];
    const columns = [{ id: 'summary', type: 'text' }, { id: 'cost', type: 'number', custom: true }];
    const cells = { [reviewCellKey('story', '10', 'cost')]: { value: '9' }, [reviewCellKey('story', '2', 'cost')]: { value: '100' } };
    assert.deepEqual(sortPlanningReviewRows(rows, [{ columnId: 'summary', direction: 'asc' }], columns).map(row => row.id), ['2', '10', '3']);
    assert.deepEqual(sortPlanningReviewRows(rows, [{ columnId: 'cost', direction: 'desc' }], columns, cells).map(row => row.id), ['2', '10', '3']);
    assert.deepEqual(sortPlanningReviewRows(rows, [], columns).map(row => row.id), ['2', '3', '10']);
    assert.throws(() => sortPlanningReviewRows(rows, Array(6).fill({}), columns), /five/);
});

test('admitted scope counts include Teams without Stories and readiness-only projects', async () => {
    const { planningReviewScopeCounts } = await model();
    const counts = planningReviewScopeCounts({ tasks: [story('1', 'DEMO-1', 1)], selectedTeamIds: ['Alpha', 'Beta'], groupTeamIds: ['Alpha', 'Beta'], projects: ['DEMO'], readinessEpics: [{ key: 'OTHER-1', project: { key: 'OTHER' }, missingTeams: [{ id: 'Beta', name: 'Beta' }] }] });
    assert.deepEqual(counts, { teams: 2, projects: 2 });
    assert.deepEqual(planningReviewScopeCounts({ tasks: [], allTeams: true, groupTeamIds: ['Alpha', 'Beta'], projects: ['DEMO'] }), { teams: 2, projects: 1 });
});

test('shared order places custom columns among Jira columns and keeps row identity pinned', async()=>{
    const {buildPlanningReviewColumns}=await model();
    const columns=buildPlanningReviewColumns({mode:'story',customColumns:[{id:'cost',rowKind:'story',label:'Cost',type:'number',order:0}],layout:{order:['cost','storyPoints','status']},hidden:new Set(['assignee']),admittedTeamCount:1,admittedProjectCount:1});
    assert.deepEqual(columns.slice(0,5).map(column=>column.id),['key','summary','cost','storyPoints','status']);
    assert.equal(columns.some(column=>column.id==='assignee'),false);
    assert.equal(columns.some(column=>column.id==='team'),false);
});

test('every column but Summary is optional and hideable, and Summary always stays visible', async()=>{
    const {buildPlanningReviewColumns,DEFAULT_REVIEW_HIDDEN_COLUMNS}=await model();
    assert.deepEqual(DEFAULT_REVIEW_HIDDEN_COLUMNS,['components','project','capacity','projectTrack']);
    for(const mode of ['epic','story']) {
        const options={mode,admittedProjectCount:2,admittedTeamCount:2};
        const all=buildPlanningReviewColumns(options);
        for(const id of DEFAULT_REVIEW_HIDDEN_COLUMNS) assert.equal(all.find(column=>column.id===id).optional,true);
        const hidden=buildPlanningReviewColumns({...options,hidden:new Set([...DEFAULT_REVIEW_HIDDEN_COLUMNS,'key','summary','status','storyPoints'])});
        for(const id of [...DEFAULT_REVIEW_HIDDEN_COLUMNS,'key','status','storyPoints']) assert.equal(hidden.some(column=>column.id===id),false,id);
        assert.equal(hidden.some(column=>column.id==='summary'),true);
        for(const column of all) assert.equal(Boolean(column.required),column.id==='summary',column.id);
    }
});

test('readiness-only Epics and one placeholder per uncovered Team survive an empty Story scope',async()=>{
    const {buildPlanningReviewRows,planningReviewTotals}=await model();
    const groups=[{key:'DEMO-20',epic:{id:'20',key:'DEMO-20',summary:'Uncreated Epic'},tasks:[],requirements:[{id:'alpha',team:{name:'Alpha'}},{id:'beta',team:{name:'Beta'}}]}];
    const epics=buildPlanningReviewRows({epicGroups:groups,visibleTasks:[]});
    assert.equal(epics.length,1);assert.equal(epics[0].key,'DEMO-20');assert.equal(epics[0].requirements.length,2);assert.equal(epics[0].storyPoints,'0');
    const stories=buildPlanningReviewRows({epicGroups:groups,visibleTasks:[],mode:'story'});
    assert.equal(stories.length,2);assert.deepEqual(stories.map(row=>row.id),['alpha','beta']);assert.ok(stories.every(row=>row.synthetic && !row.issueId && row.epicKey==='DEMO-20'));
    assert.equal(planningReviewTotals(stories,[{id:'storyPoints',type:'number',aggregation:'sum'}],{}).storyPoints,'0');
});

test('insertColumnId places a column after a neighbour, right after the pinned columns, or at the end', async () => {
    const { insertColumnId } = await model();
    const order = ['status', 'priority', 'storyPoints'];
    assert.deepEqual(insertColumnId(order, 'new', 'priority'), ['status', 'priority', 'new', 'storyPoints']);
    assert.deepEqual(insertColumnId(order, 'new', 'summary'), ['new', 'status', 'priority', 'storyPoints']);
    assert.deepEqual(insertColumnId(order, 'new'), ['status', 'priority', 'storyPoints', 'new']);
    assert.deepEqual(insertColumnId(order, 'new', 'missing'), ['status', 'priority', 'storyPoints', 'new']);
    assert.deepEqual(insertColumnId(['a', 'new', 'b'], 'new', 'b'), ['a', 'b', 'new']);
    assert.deepEqual(order, ['status', 'priority', 'storyPoints'], 'the input order is not mutated');
});

test('nearestBoundary returns the column left of the closest edge within the threshold', async () => {
    const { nearestBoundary } = await model();
    const edges = [{ afterId: 'summary', x: 100 }, { afterId: 'status', x: 180 }, { afterId: 'priority', x: 260 }];
    assert.equal(nearestBoundary(edges, 183), 'status');
    assert.equal(nearestBoundary(edges, 98), 'summary');
    assert.equal(nearestBoundary(edges, 190), null);
    assert.equal(nearestBoundary(edges, 185), 'status');
    assert.equal(nearestBoundary([], 50), null);
});

test('selectedStoryPoints counts only ticked Stories for Story, Epic and No Epic rows', async () => {
    const { buildPlanningReviewRows, selectedStoryPoints } = await model();
    const tasks = [story('1', 'DEMO-1', 1.5), story('2', 'DEMO-2', 2), story('3', 'DEMO-3', 4)];
    const group = { key: 'DEMO-10', epic: { id: '10', key: 'DEMO-10', summary: 'Epic' }, tasks: tasks.slice(0, 2), requirements: [{ id: 'req', team: { name: 'Beta' } }] };
    const epicRows = buildPlanningReviewRows({ epicGroups: [group], visibleTasks: tasks, mode: 'epic' });
    const storyRows = buildPlanningReviewRows({ epicGroups: [group], visibleTasks: tasks, mode: 'story' });
    const none = new Set(), all = new Set(['DEMO-1', 'DEMO-2', 'DEMO-3']), one = new Set(['DEMO-1']);
    const epic = epicRows.find(row => row.key === 'DEMO-10'), orphans = epicRows.find(row => row.id === 'no-epic');
    assert.equal(selectedStoryPoints(epic, none), null);
    assert.equal(selectedStoryPoints(epic, all), '3.5');
    assert.equal(selectedStoryPoints(epic, one), '1.5');
    assert.equal(selectedStoryPoints(orphans, all), '4');
    assert.equal(selectedStoryPoints(storyRows.find(row => row.key === 'DEMO-1'), one), '1.5');
    assert.equal(selectedStoryPoints(storyRows.find(row => row.key === 'DEMO-2'), one), null);
    assert.equal(selectedStoryPoints(storyRows.find(row => row.rowKind === 'requirement'), all), null);
});

test('the Accepted column is a visible-by-default optional number column summed in the footer, right after the points column', async () => {
    const { buildPlanningReviewColumns, planningReviewTotals, DEFAULT_REVIEW_HIDDEN_COLUMNS } = await model();
    for (const mode of ['epic', 'story']) {
        const columns = buildPlanningReviewColumns({ rows: [], mode, admittedTeamCount: 2, admittedProjectCount: 2, hidden: new Set(DEFAULT_REVIEW_HIDDEN_COLUMNS) });
        const ids = columns.map(column => column.id), accepted = columns.find(column => column.id === 'accepted');
        assert.equal(ids[ids.indexOf('storyPoints') + 1], 'accepted', mode);
        assert.deepEqual({ label: accepted.label, type: accepted.type, aggregation: accepted.aggregation, optional: accepted.optional, required: Boolean(accepted.required) }, { label: 'Accepted', type: 'number', aggregation: 'sum', optional: true, required: false });
        assert.equal(DEFAULT_REVIEW_HIDDEN_COLUMNS.includes('accepted'), false);
    }
    const accepted = { id: 'accepted', type: 'number', aggregation: 'sum' };
    assert.deepEqual(planningReviewTotals([{ accepted: '1.5' }, { accepted: null }, { accepted: '2' }], [accepted]), { accepted: '3.5' });
    assert.deepEqual(planningReviewTotals([{ accepted: null }], [accepted]), { accepted: '0' });
});

// ---- a pending status/priority edit sorts by its original value (issue #250 Task 6) -------------

test('rows with a pending priority or status edit sort by the original value until it is confirmed', async () => {
    const { sortPlanningReviewRows } = await model();
    const columns = [{ id: 'priority', type: 'priority' }, { id: 'status', type: 'text' }, { id: 'summary', type: 'text' }];
    const rows = [
        { id: '1', key: 'DEMO-1', rowKind: 'story', priority: 'Highest', status: 'To Do', summary: 'a' },   // optimistic: was Low
        { id: '2', key: 'DEMO-2', rowKind: 'story', priority: 'High', status: 'To Do', summary: 'b' },
        { id: '3', key: 'DEMO-3', rowKind: 'story', priority: 'Low', status: 'Done', summary: 'c' },        // optimistic: was To Do
    ];
    const originals = new Map([['DEMO-1', { priority: { name: 'Low' } }], ['DEMO-3', { status: { name: 'To Do' } }]]);
    const byPriority = [{ columnId: 'priority', direction: 'asc' }];
    const byStatus = [{ columnId: 'status', direction: 'asc' }];

    assert.deepEqual(sortPlanningReviewRows(rows, byPriority, columns, {}, originals).map(row => row.id), ['2', '1', '3'], 'pending: DEMO-1 still sorts as Low, tied with DEMO-3 and ordered by id');
    assert.deepEqual(sortPlanningReviewRows(rows, byPriority, columns, {}, new Map()).map(row => row.id), ['1', '2', '3'], 'confirmed: it moves to the top');
    assert.deepEqual(sortPlanningReviewRows(rows, byPriority, columns, {}).map(row => row.id), ['1', '2', '3'], 'no originals: unchanged behavior');
    assert.deepEqual(sortPlanningReviewRows(rows, byStatus, columns, {}, originals).map(row => row.id), ['1', '2', '3'], 'a pending status sorts by To Do, so DEMO-3 does not jump below Done yet');
    assert.deepEqual(sortPlanningReviewRows(rows, byStatus, columns, {}).map(row => row.id), ['3', '1', '2'], 'confirmed: Done sorts before To Do');
    const untouched = sortPlanningReviewRows(rows, [{ columnId: 'summary', direction: 'asc' }], columns, {}, originals);
    assert.deepEqual(untouched.map(row => row.id), ['1', '2', '3'], 'other columns ignore originals');
});

// ---- derived columns and anchor placement (issue #267 Task D1) ---------------------------------

const derivedFixture = () => {
    const stories = [story('1', 'DEMO-1', 1), story('2', 'DEMO-2', 2), story('3', 'DEMO-3', 3)];
    const epicGroups = [
        { key: 'DEMO-10', epic: { id: '10', key: 'DEMO-10', summary: 'Epic' }, tasks: stories.slice(0, 2), requirements: [{ id: 'req', team: { name: 'Beta' } }] },
        { key: 'DEMO-20', epic: { id: '20', key: 'DEMO-20', summary: 'Empty Epic' }, tasks: [], requirements: [] },
    ];
    return { stories, epicGroups };
};
const reviewColumns = [
    { id: 'cost', rowKind: 'story', label: 'Cost', type: 'number', aggregation: 'sum', archived: false, order: 0 },
    { id: 'rating', rowKind: 'story', label: 'Rating', type: 'number', aggregation: 'none', archived: false, order: 1 },
    { id: 'note', rowKind: 'story', label: 'Note', type: 'text', aggregation: 'none', archived: false, order: 2 },
    { id: 'gone', rowKind: 'story', label: 'Gone', type: 'number', aggregation: 'sum', archived: true, order: 3 },
    { id: 'owner', rowKind: 'epic', label: 'Owner', type: 'text', aggregation: 'none', archived: false, order: 0 },
    { id: 'budget', rowKind: 'epic', label: 'Budget', type: 'number', aggregation: 'sum', archived: false, order: 1 },
    { id: 'old', rowKind: 'epic', label: 'Old', type: 'text', aggregation: 'none', archived: true, order: 2 },
];
const everyLoaded = () => true;

test('derived columns are opt-in: without derived:true the columns are exactly as before', async () => {
    const { buildPlanningReviewColumns } = await model();
    for (const mode of ['epic', 'story']) {
        const ids = buildPlanningReviewColumns({ mode, customColumns: reviewColumns, admittedTeamCount: 2, admittedProjectCount: 2 }).map(column => column.id);
        assert.equal(ids.some(id => ['cost', 'note', 'rating'].includes(id)), mode === 'story', mode);
        assert.equal(ids.some(id => ['owner', 'budget'].includes(id)), mode === 'epic', mode);
        assert.equal(ids.includes('gone') || ids.includes('old'), false);
    }
});

test('Story number+sum columns roll up into the Epic view and every Epic column goes down to the Story view, never reversed', async () => {
    const { buildPlanningReviewColumns } = await model();
    const epicView = buildPlanningReviewColumns({ mode: 'epic', customColumns: reviewColumns, admittedTeamCount: 1, admittedProjectCount: 1, derived: true });
    const epicDerived = epicView.filter(column => column.derived);
    assert.deepEqual(epicDerived.map(column => column.id), ['cost'], 'only number+sum Story columns go up; text, non-sum and archived do not');
    assert.deepEqual(epicView.filter(column => column.custom).map(column => column.id), ['owner', 'budget']);
    assert.deepEqual({ ...epicDerived[0] }, { id: 'cost', rowKind: 'story', label: 'Cost', type: 'number', aggregation: 'sum', order: 0, derived: true });
    assert.equal(epicView.at(-1).id, 'cost', 'derived columns default last');
    const storyView = buildPlanningReviewColumns({ mode: 'story', customColumns: reviewColumns, admittedTeamCount: 1, admittedProjectCount: 1, derived: true });
    const storyDerived = storyView.filter(column => column.derived);
    assert.deepEqual(storyDerived.map(column => column.id), ['owner', 'budget'], 'every non-archived Epic column goes down, in creation order');
    assert.ok(storyDerived.every(column => column.aggregation === 'none' && !column.custom && column.rowKind === 'epic'));
    assert.deepEqual(storyView.slice(-2).map(column => column.id), ['owner', 'budget']);
    assert.deepEqual(storyView.filter(column => column.custom).map(column => column.id), ['cost', 'rating', 'note']);
    // "Show total" off removes the rollup; archiving the source removes the derived column in the other view.
    const totalOff = reviewColumns.map(column => column.id === 'cost' ? { ...column, aggregation: 'none' } : column.id === 'owner' ? { ...column, archived: true } : column);
    assert.equal(buildPlanningReviewColumns({ mode: 'epic', customColumns: totalOff, derived: true }).some(column => column.derived), false);
    assert.deepEqual(buildPlanningReviewColumns({ mode: 'story', customColumns: totalOff, derived: true }).filter(column => column.derived).map(column => column.id), ['budget']);
});

test('a saved order can place derived columns and Hide applies per view', async () => {
    const { buildPlanningReviewColumns } = await model();
    const placed = buildPlanningReviewColumns({ mode: 'epic', customColumns: reviewColumns, admittedTeamCount: 1, admittedProjectCount: 1, derived: true, layout: { order: ['cost', 'status'] } });
    assert.deepEqual(placed.slice(0, 4).map(column => column.id), ['key', 'summary', 'cost', 'status']);
    const hidden = buildPlanningReviewColumns({ mode: 'epic', customColumns: reviewColumns, derived: true, hidden: new Set(['cost']) });
    assert.equal(hidden.some(column => column.id === 'cost'), false);
    const otherView = buildPlanningReviewColumns({ mode: 'story', customColumns: reviewColumns, derived: true, hidden: new Set(['owner']) });
    assert.equal(otherView.some(column => column.id === 'cost'), true, 'hiding the rollup in the Epic view leaves the Story source');
    assert.equal(otherView.some(column => column.id === 'owner'), false);
});

test('placement fold: anchors resolve through insertColumnId on the unfiltered list, then derived columns append', async () => {
    const { buildPlanningReviewColumns } = await model();
    const ids = options => buildPlanningReviewColumns({ mode: 'story', admittedTeamCount: 1, admittedProjectCount: 1, derived: true, ...options }).map(column => column.id).filter(id => !['key', 'summary'].includes(id));
    const col = (id, order, after, extra = {}) => ({ id, rowKind: 'story', label: id, type: 'text', aggregation: 'none', archived: false, order, after, ...extra });
    const defaults = ['status', 'priority', 'storyPoints', 'accepted', 'epic', 'assignee', 'components', 'capacity', 'projectTrack'];
    // Empty order: built-ins in default sequence, 'summary' first, null at the end.
    assert.deepEqual(ids({ customColumns: [col('first', 0, 'summary'), col('last', 1, null), col('legacy', 2, undefined)] }), ['first', ...defaults, 'last', 'legacy']);
    // A saved order is the base; built-ins missing from it follow in default sequence; a custom column after a built-in.
    assert.deepEqual(ids({ layout: { order: ['priority', 'status'] }, customColumns: [col('a', 0, 'status')] }).slice(0, 4), ['priority', 'status', 'a', 'storyPoints']);
    // Chained (b after a, a after status) and sibling anchors (c and d both after status: the later one lands first, as insertColumnId does).
    assert.deepEqual(ids({ customColumns: [col('a', 0, 'status'), col('b', 1, 'a'), col('c', 2, 'status')] }).slice(0, 5), ['status', 'c', 'a', 'b', 'priority']);
    // Archived anchors still resolve a chain; the archived column itself is not shown.
    assert.deepEqual(ids({ customColumns: [col('x', 0, 'status', { archived: true }), col('y', 1, 'x')] }).slice(0, 3), ['status', 'y', 'priority']);
    // Hidden anchors resolve; the hidden column is filtered afterwards.
    assert.deepEqual(ids({ customColumns: [col('h', 0, 'priority'), col('k', 1, 'h')], hidden: new Set(['h']) }).slice(0, 4), ['status', 'priority', 'k', 'storyPoints']);
    // Admission-gated built-in anchor (team, admitted only with more than one Team) still resolves when the anchor itself is not admitted.
    assert.deepEqual(ids({ layout: { order: ['status', 'team', 'priority'] }, customColumns: [col('t', 0, 'team')] }).slice(0, 3), ['status', 't', 'priority']);
    // A column already in the saved order keeps its saved position, whatever its anchor.
    assert.deepEqual(ids({ layout: { order: ['saved', 'status'] }, customColumns: [col('saved', 0, 'projectTrack')] }).slice(0, 2), ['saved', 'status']);
    // An unknown anchor appends; derived columns come after the whole fold.
    const withDerived = ids({ customColumns: [col('u', 0, 'missing'), { id: 'owner', rowKind: 'epic', label: 'Owner', type: 'text', aggregation: 'none', archived: false, order: 0 }] });
    assert.deepEqual(withDerived.slice(-2), ['u', 'owner']);
});

test('nativeAnchorFor maps the corner and boundaries after derived columns to a native anchor', async () => {
    const { nativeAnchorFor, insertColumnId } = await model();
    const order = ['status', 'cost', 'hiddenNative', 'd1', 'd2'];
    const derived = ['d1', 'd2'];
    assert.equal(nativeAnchorFor(order, null, derived), 'hiddenNative', 'corner: last native column of the full order, hidden included');
    assert.equal(nativeAnchorFor(order, 'd2', derived), 'hiddenNative', 'boundary after a derived column: nearest preceding native');
    assert.equal(nativeAnchorFor(['d1', 'status'], 'd1', derived), 'summary', 'no preceding native: directly after the pinned columns');
    assert.equal(nativeAnchorFor(order, 'status', derived), 'status', 'a native id is its own anchor');
    assert.equal(nativeAnchorFor(order, 'summary', derived), 'summary');
    assert.equal(nativeAnchorFor([], null, derived), null, 'empty order: append');
    assert.equal(nativeAnchorFor(['d1', 'd2'], null, derived), 'summary', 'only derived columns: a new column still lands ahead of them');
    assert.equal(nativeAnchorFor(order, null, []), 'd2', 'no derived ids: the corner is the last column, as insertColumnId append');
    assert.deepEqual(insertColumnId(order, 'new', nativeAnchorFor(order, null, derived)), ['status', 'cost', 'hiddenNative', 'new', 'd1', 'd2']);
});

test('Story rows carry epicIssueId from the real Epic; Epic rows are unchanged', async () => {
    const { buildPlanningReviewRows } = await model();
    const { stories, epicGroups } = derivedFixture();
    const rows = buildPlanningReviewRows({ epicGroups: [...epicGroups, { key: 'NO_EPIC', epic: { key: 'NO_EPIC' }, tasks: [], requirements: [] }, { key: 'DEMO-30', epic: { key: 'DEMO-30', summary: 'No id' }, tasks: [stories[2]], requirements: [] }], visibleTasks: stories, mode: 'story' });
    assert.equal(rows.find(row => row.key === 'DEMO-1').epicIssueId, '10');
    assert.equal(rows.find(row => row.key === 'DEMO-3').epicIssueId, null, 'an Epic without an issue id gives null');
    const orphanRows = buildPlanningReviewRows({ epicGroups: [], visibleTasks: [stories[0]], mode: 'story' });
    assert.equal(orphanRows[0].epicIssueId, null);
    const epics = buildPlanningReviewRows({ epicGroups, visibleTasks: stories });
    assert.ok(epics.every(row => !('epicIssueId' in row)));
});

test('derivedValue sums in-scope Stories up to Epics only when complete, and inherits the Epic value down', async () => {
    const { buildPlanningReviewRows, derivedValue, reviewCellKey, formatReviewScaled } = await model();
    const { stories, epicGroups } = derivedFixture();
    const epics = buildPlanningReviewRows({ epicGroups, visibleTasks: stories });
    const epic = epics.find(row => row.key === 'DEMO-10'), empty = epics.find(row => row.key === 'DEMO-20'), noEpic = epics.find(row => row.id === 'no-epic');
    const cost = { id: 'cost', rowKind: 'story', type: 'number', aggregation: 'sum', derived: true };
    const cell = (kind, id, column, value) => ({ [reviewCellKey(kind, id, column)]: { value } });
    const cells = { ...cell('story', '1', 'cost', '999999999.999'), ...cell('story', '3', 'cost', '4') };
    const up = derivedValue(epic, cost, { cells, isLoaded: everyLoaded });
    assert.equal(up.complete, true);
    assert.equal(up.scaled, 999999999999n, 'a blank Story value counts as 0 once any Story has a value');
    assert.equal(formatReviewScaled(up.scaled), '999999999.999');
    assert.deepEqual(derivedValue(epic, cost, { cells: {}, isLoaded: everyLoaded }), { scaled: null, value: null, complete: true }, 'no stored value: blank');
    assert.deepEqual(derivedValue(empty, cost, { cells, isLoaded: everyLoaded }), { scaled: null, value: null, complete: true }, 'no in-scope Stories: blank, not 0');
    assert.equal(derivedValue(noEpic, cost, { cells, isLoaded: everyLoaded }).scaled, 4000n, 'the No Epic row shows its own Stories');
    assert.deepEqual(derivedValue(epic, cost, { cells, isLoaded: id => id !== '2' }), { scaled: null, value: null, complete: false }, 'blank until every in-scope Story is loaded and available');
    assert.equal(derivedValue(epic, cost, { cells, isLoaded: everyLoaded, forceLoading: true }).complete, false, 'blank during a manual refresh');
    assert.equal(derivedValue(epic, cost, { cells }).complete, false, 'no loaded signal fails closed');
    // A carried-over Story keeps one value per issue and counts in each Sprint's sum where it is in scope.
    const nextSprint = buildPlanningReviewRows({ epicGroups: [{ ...epicGroups[0], tasks: [stories[0]] }], visibleTasks: [stories[0]] });
    assert.equal(derivedValue(nextSprint[0], cost, { cells, isLoaded: everyLoaded }).scaled, 999999999999n);
    // An unsaved source edit (the controller's cells hold saved values plus drafts) shows in both views.
    const edited = { ...cells, ...cell('story', '2', 'cost', '1') };
    assert.equal(derivedValue(epic, cost, { cells: edited, isLoaded: everyLoaded }).value, '1000000000.999');

    const storyRows = buildPlanningReviewRows({ epicGroups, visibleTasks: stories, mode: 'story' });
    const child = storyRows.find(row => row.key === 'DEMO-1'), orphan = storyRows.find(row => row.key === 'DEMO-3'), placeholder = storyRows.find(row => row.rowKind === 'requirement');
    const owner = { id: 'owner', rowKind: 'epic', type: 'text', aggregation: 'none', derived: true }, budget = { id: 'budget', rowKind: 'epic', type: 'number', aggregation: 'none', derived: true };
    const epicCells = { ...cell('epic', '10', 'owner', 'Ada'), ...cell('epic', '10', 'budget', '12.500') };
    assert.deepEqual(derivedValue(child, owner, { cells: epicCells, isLoaded: everyLoaded }), { scaled: null, value: 'Ada', complete: true });
    assert.deepEqual(derivedValue(child, budget, { cells: epicCells, isLoaded: everyLoaded }), { scaled: 12500n, value: '12.5', complete: true });
    assert.equal(derivedValue(child, owner, { cells: epicCells, isLoaded: (id, kind) => kind !== 'epic' }).complete, false, 'blank until the Epic row is loaded');
    assert.equal(derivedValue(child, owner, { cells: epicCells, isLoaded: everyLoaded, forceLoading: true }).complete, false);
    for (const row of [orphan, placeholder, { ...child, epicIssueId: null }]) assert.equal(derivedValue(row, owner, { cells: epicCells, isLoaded: everyLoaded }).value, null, row.key || row.id);
    assert.equal(derivedValue(child, owner, { cells: { ...epicCells, ...cell('epic', '10', 'owner', 'Grace') }, isLoaded: everyLoaded }).value, 'Grace', 'unsaved Epic edit shows on its Stories');
    // Nothing flows the other way: a Story-kind derived rule never reads Epic cells, an Epic-kind rule never reads Story cells.
    assert.equal(derivedValue(epic, { ...owner, rowKind: 'epic' }, { cells: epicCells, isLoaded: everyLoaded }).value, null);
    assert.equal(derivedValue(child, cost, { cells, isLoaded: everyLoaded }).value, null);
});

test('derived cells display, total and sort through derivedValue with BigInt, never through parseReviewNumber', async () => {
    const { buildPlanningReviewRows, buildPlanningReviewColumns, reviewValue, planningReviewTotals, sortPlanningReviewRows, reviewCellKey } = await model();
    const stories = [story('1', 'DEMO-1', 1), story('2', 'DEMO-2', 2), story('3', 'DEMO-3', 3), story('4', 'DEMO-4', 1)];
    const groups = [
        { key: 'DEMO-10', epic: { id: '10', key: 'DEMO-10', summary: 'Big' }, tasks: [stories[0], stories[1]], requirements: [] },
        { key: 'DEMO-20', epic: { id: '20', key: 'DEMO-20', summary: 'Small' }, tasks: [stories[2]], requirements: [] },
        { key: 'DEMO-30', epic: { id: '30', key: 'DEMO-30', summary: 'Blank' }, tasks: [], requirements: [] },
    ];
    const rows = buildPlanningReviewRows({ epicGroups: groups, visibleTasks: stories });
    const columns = buildPlanningReviewColumns({ rows, mode: 'epic', customColumns: reviewColumns, derived: true });
    const cost = columns.find(column => column.id === 'cost');
    const cells = { [reviewCellKey('story', '1', 'cost')]: { value: '999999999.999' }, [reviewCellKey('story', '2', 'cost')]: { value: '999999999.999' }, [reviewCellKey('story', '3', 'cost')]: { value: '5' }, [reviewCellKey('story', '4', 'cost')]: { value: '1' } };
    const ctx = { isLoaded: everyLoaded };
    assert.equal(reviewValue(rows[0], cost, cells, undefined, ctx), '1999999999.998');
    assert.equal(reviewValue(rows[0], cost, cells), null, 'no context: blank, never a guess');
    const sorted = sortPlanningReviewRows(rows, [{ columnId: 'cost', direction: 'desc' }], [cost], cells, undefined, ctx).map(row => row.key || row.id);
    assert.deepEqual(sorted, ['DEMO-10', 'DEMO-20', 'no-epic', 'DEMO-30'], 'a sum of 1e9 and more sorts ahead of 5; blank last');
    assert.equal(sortPlanningReviewRows(rows, [{ columnId: 'cost', direction: 'asc' }], [cost], cells, undefined, ctx).map(row => row.key || row.id).at(-1), 'DEMO-30', 'empty sorts last ascending too');
    const partial = sortPlanningReviewRows(rows, [{ columnId: 'cost', direction: 'desc' }], [cost], cells, undefined, { isLoaded: id => id !== '1' }).map(row => row.key || row.id);
    assert.deepEqual(partial.slice(-2).sort(), ['DEMO-10', 'DEMO-30'], 'incomplete sorts with the empties');
    // Totals: the No Epic row counts once, so the rollup equals the in-scope Story total; blank while incomplete; Epic-derived has no total.
    assert.equal(planningReviewTotals(rows, columns, cells, ctx).cost, '2000000005.998');
    assert.equal(planningReviewTotals(rows, columns, cells, { isLoaded: id => id !== '4' }).cost, null);
    assert.equal(planningReviewTotals(rows, columns, cells, { ...ctx, forceLoading: true }).cost, null);
    const storyRows = buildPlanningReviewRows({ epicGroups: groups, visibleTasks: stories, mode: 'story' });
    const storyColumns = buildPlanningReviewColumns({ rows: storyRows, mode: 'story', customColumns: reviewColumns, derived: true });
    const totals = planningReviewTotals(storyRows, storyColumns, { ...cells, [reviewCellKey('epic', '10', 'budget')]: { value: '5' } }, ctx);
    assert.equal('budget' in totals, false, 'an Epic value inherited by its Stories is never totalled');
    assert.equal(totals.cost, '2000000005.998', 'the Story view still totals its own sum column');
});

test('no model function makes a derived cell writable', async () => {
    const model_ = await model();
    const columns = model_.buildPlanningReviewColumns({ mode: 'epic', customColumns: reviewColumns, derived: true }).concat(model_.buildPlanningReviewColumns({ mode: 'story', customColumns: reviewColumns, derived: true }));
    const derived = columns.filter(column => column.derived);
    assert.ok(derived.length > 0);
    for (const column of derived) assert.equal(column.custom, undefined, `${column.id} never takes the editable custom-cell path`);
    const result = model_.derivedValue({ rowKind: 'story', epicIssueId: '10' }, derived.find(column => column.rowKind === 'epic'), { cells: {}, isLoaded: everyLoaded });
    assert.deepEqual(Object.keys(result).sort(), ['complete', 'scaled', 'value'], 'a value, not a cell handle');
    assert.ok(Object.values(result).every(value => typeof value !== 'function'));
});
