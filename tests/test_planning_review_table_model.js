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
