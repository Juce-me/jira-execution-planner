const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Planning, Board, Statistics, Scenario, Jira export, share links and the tour name work entities by the configured
// Jira types (EntityNames); without names every surface keeps its Legacy words. Synthetic values only.
const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const loadComponent = file => {
    const code = esbuild.buildSync({
        entryPoints: [path.join(root, file)], bundle: true, write: false, format: 'cjs', platform: 'node',
        external: ['react', 'react-dom'], loader: { '.jsx': 'jsx', '.js': 'jsx' },
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports;
};
const render = (file, props, exportName = 'default') => renderToStaticMarkup(React.createElement(loadComponent(file)[exportName], props));
const names = async () => {
    const { resolveEntityNames } = await import('../frontend/src/eng/engWorkModel.js');
    return {
        LEGACY: resolveEntityNames('legacy'),
        DELIVERY: resolveEntityNames('rnd_2027'),
        RENAMED: resolveEntityNames('rnd_2027', {
            planning: { id: '6', name: 'Deliverable', hierarchyLevel: 1 },
            parent: { id: '11700', name: 'Theme', hierarchyLevel: 2 },
            ancestor: { id: '12723', name: 'Objective', hierarchyLevel: 3 },
        }),
    };
};
const epicGroup = key => ({ key, epic: { key, summary: key, status: { name: 'To Do' } }, tasks: [] });

test('Board filter subject, readout and track description name the parent level, singular at one', async () => {
    const { LEGACY, DELIVERY, RENAMED } = await names();
    const { buildEngBoardFacetModel, resolveEngBoardFilters } = await import('../frontend/src/eng/engBoardFilters.js');
    const resolve = (count, entityNames, workModel) => resolveEngBoardFilters({
        model: buildEngBoardFacetModel({ epicGroups: Array.from({ length: count }, (_, i) => epicGroup(`P-${i}`)), workModel, names: entityNames }),
    });
    assert.equal(resolve(2, RENAMED, 'rnd_2027').subject, 'Filtering themes');
    assert.equal(resolve(2, RENAMED, 'rnd_2027').readoutUnit, 'of 2 themes');
    assert.equal(resolve(1, RENAMED, 'rnd_2027').readoutUnit, 'of 1 theme');
    assert.equal(resolve(1, DELIVERY, 'rnd_2027').readoutUnit, 'of 1 initiative');
    assert.equal(resolve(3, LEGACY).readoutUnit, 'of 3 epics');
    assert.equal(resolve(3).subject, 'Filtering epics', 'no names keeps the Legacy words');
    const track = model => model.facets.find(facet => facet.id === 'track').emptyDescription;
    assert.equal(track(resolve(2, RENAMED, 'rnd_2027')), 'No Project Track — showing themes without a value');
    assert.equal(track(resolve(2)), 'No Project Track — showing epics without a value');
});

test('the unconfigured Board column is named by the parent level', async () => {
    const { RENAMED } = await names();
    const { buildBoardColumns, UNCONFIGURED_COLUMN_NAME } = await import('../frontend/src/eng/engBoardColumns.js');
    assert.equal(UNCONFIGURED_COLUMN_NAME, 'All epics');
    assert.equal(buildBoardColumns({ columns: [], epicGroups: [epicGroup('P-1')], names: RENAMED })[0].name, 'All themes');
    assert.equal(buildBoardColumns({ columns: [], epicGroups: [epicGroup('P-1')] })[0].name, 'All epics');
});

test('Board help names the parent and child levels and counts the tallest bar', async () => {
    const { RENAMED } = await names();
    // The popover is closed on a static render, so the copy is pinned in source and through the count helper.
    const source = read('frontend/src/eng/EngBoardHelp.jsx');
    assert.match(source, /\{names\.parent\} details include every eligible \{workItemLabel\}, not only \{names\.childPlural\}\./);
    assert.match(source, /The tallest bar represents \{lowerEntityWord\(formatEntityCount\(scaleMax, names, 'parent'\)\)\}\./);
    const { formatEntityCount, lowerEntityWord } = await import('../frontend/src/eng/engWorkModel.js');
    assert.equal(lowerEntityWord(formatEntityCount(1, RENAMED, 'parent')), '1 theme');
});

test('Planning review rows and columns name the configured parent and child', async () => {
    const { RENAMED } = await names();
    const { buildPlanningReviewRows, buildPlanningReviewColumns } = await import('../frontend/src/eng/planningReviewTableModel.js');
    const orphan = { key: 'NO_EPIC', epic: { key: 'NO_EPIC' }, tasks: [{ key: 'PLAN-1', fields: { summary: 'Leaf' } }],
        requirements: [{ id: 'req-1', team: { name: 'Data Team' } }] };
    const rows = buildPlanningReviewRows({ epicGroups: [orphan], visibleTasks: orphan.tasks, mode: 'story', names: RENAMED });
    assert.equal(rows[0].epic, 'No Theme');
    assert.match(rows[1].summary, /Deliverable awaiting creation for Data Team$/);
    const columns = buildPlanningReviewColumns({ rows, mode: 'story', names: RENAMED, derived: false });
    assert.equal(columns.find(column => column.id === 'initiative').label, 'Theme');
    assert.equal(buildPlanningReviewRows({ epicGroups: [orphan], visibleTasks: orphan.tasks, mode: 'story' })[0].epic, 'No Epic');
});

test('Planning action titles and assignee copy use the planning type; Legacy is unchanged', async () => {
    const { RENAMED } = await names();
    const bar = props => render('frontend/src/eng/PlanningActionBar.jsx', { hasVisibleTasks: true, selectedCount: 0, selectedVisibleCount: 0, ...props });
    assert.match(bar({ entityNames: RENAMED }), /title="Include all Accepted and In Progress deliverables for the current view"/);
    assert.match(bar({ entityNames: RENAMED }), /aria-label="Open selected deliverables in Jira"/);
    assert.match(bar({}), /title="Include all To Do \/ Pending stories for the current view"/);
    const source = read('frontend/src/eng/PlanningAssigneeCapacity.jsx');
    assert.match(source, /`\$\{names\.child\} of this Team is` : `\$\{names\.childPlural\} of this Team are`/);
    assert.match(source, /No \{names\.childPlural\} or saved people for this Team in this Sprint\./);
});

test('Statistics words come from EntityNames: team links, burnout and Lead Times lists', async () => {
    const { RENAMED } = await names();
    const { roleLabels } = await import('../frontend/src/stats/statsScope.js');
    const words = roleLabels(RENAMED);
    const teams = render('frontend/src/stats/StatsTeamsView.jsx', {
        open: true, statsTeamRows: [{ id: 't', name: 'Team', straight: { done: 2, incomplete: 1 }, product: { done: 1, incomplete: 0 }, tech: { done: 1, incomplete: 1 }, weightedProduct: {}, weightedTech: {} }],
        statsBarColumns: [], statsGraphMode: 'table', buildStatLink: () => 'https://jira.example/issues', computeRate: () => 0, formatPercent: () => '0%', getRateClass: () => '', words,
    });
    assert.match(teams, /title="View done deliverables for this team in Jira"/);
    assert.doesNotMatch(teams, /stories/);
    const legacyTeams = render('frontend/src/stats/StatsTeamsView.jsx', {
        open: true, statsTeamRows: [{ id: 't', name: 'Team', straight: { done: 2, incomplete: 1 }, product: { done: 1, incomplete: 0 }, tech: { done: 1, incomplete: 1 }, weightedProduct: {}, weightedTech: {} }],
        statsBarColumns: [], statsGraphMode: 'table', buildStatLink: () => 'https://jira.example/issues', computeRate: () => 0, formatPercent: () => '0%', getRateClass: () => '',
    });
    assert.match(legacyTeams, /title="View done stories for this team in Jira"/);
    const charts = render('frontend/src/cohort/LeadTimesEpicCharts.jsx', {
        roles: words, cohortMode: 'created', cohortOpenBars: [{ key: '', summary: 'Open item', status: 'Open', ageDays: 3 }], cohortCompletedBars: [],
    });
    assert.match(charts, /Open Themes \(All Cohorts\)/);
    assert.match(charts, /class="cohort-open-key">Theme</);
    assert.doesNotMatch(charts, /Epic/);
    const burnout = read('frontend/src/stats/BurnoutChart.jsx');
    assert.match(burnout, /\{event\.issueKey \|\| words\.child\}/);
    assert.match(burnout, /more closed \{lowerEntityWord\(words\.children\)\}/);
});

test('Lead Times and planning links use the configured type id in the new model and the name in Legacy', async () => {
    const { buildJiraCohortIssueSearchUrl } = await import('../frontend/src/jiraExportUtils.mjs');
    const jql = url => decodeURIComponent(new URL(url).searchParams.get('jql'));
    const base = { jiraUrl: 'https://jira.example', startQuarter: '2027Q1', endQuarter: '2027Q1', statuses: ['Open'] };
    assert.match(jql(buildJiraCohortIssueSearchUrl({ ...base, issueTypeId: '11700' })), /^issuetype = 11700 AND/);
    assert.match(jql(buildJiraCohortIssueSearchUrl({ ...base, issueTypeId: 'x" OR 1=1' })), /^issuetype = "Epic" AND/);
    assert.match(jql(buildJiraCohortIssueSearchUrl(base)), /^issuetype = "Epic" AND/);
    const { describeStatsScope } = await import('../frontend/src/stats/statsScope.js');
    const summaries = [
        { id: 'delivery', model: 'rnd_2027', name: 'DELIVERY', roleTypes: { planning: { id: '6' }, parent: { id: '11700' } } },
        { id: 'legacy', model: 'legacy', name: 'Legacy', roleTypes: { parent: { id: '10000' } } },
    ];
    assert.equal(describeStatsScope({ id: 'delivery', quarter: '2027Q1' }, summaries).parentTypeId, '11700');
    assert.equal(describeStatsScope({ id: 'legacy', quarter: '2026Q4' }, summaries).parentTypeId, null);
    // The App's planning-leaf clause, evaluated from its source line: new model by id, else by the configured name; Legacy none.
    const dashboard = read('frontend/src/dashboard.jsx');
    const expression = dashboard.match(/const planningTypeClause = (.*?); \/\//)[1];
    const clause = (workModel, id) => new Function('isCombinedWorkModel', 'workModel', 'activeConfiguration', 'entityNames', `return ${expression};`)(
        model => model === 'rnd_2027', workModel, { roleTypes: { planning: { id } } }, { child: 'Deliverable' });
    assert.equal(clause('rnd_2027', '6'), 'issuetype = 6');
    assert.equal(clause('rnd_2027', null), 'issuetype = "Deliverable"');
    assert.equal(clause('rnd_2027', '6 OR 1=1'), 'issuetype = "Deliverable"');
    assert.equal(clause('legacy', '6'), null);
    assert.match(dashboard, /clauses\.push\(issueType === 'Story' && planningTypeClause \? planningTypeClause : `issuetype = "\$\{issueType\}"`\);/);
    // Lead Times: the new model passes the parent's id and name; a missing id links by the configured name.
    assert.match(jql(buildJiraCohortIssueSearchUrl({ ...base, issueType: 'Theme', issueTypeId: null })), /^issuetype = "Theme" AND/);
    const { buildJiraCohortStatusSearchUrl } = await import('../frontend/src/jiraExportUtils.mjs');
    assert.match(jql(buildJiraCohortStatusSearchUrl({ ...base, issueType: 'Theme', issueTypeId: '11700' })), /^issuetype = 11700 AND/);
    const panel = read('frontend/src/stats/StatsPanel.jsx');
    assert.match(panel, /const parentLink = combinedScope \? \{ issueType: statWords\.parent, issueTypeId: workScope\.parentTypeId \} : \{\};/);
    assert.match(panel, /const parentKind = combinedScope \? \(entityNames \|\| resolveEntityNames\(workScope\.model\)\)\.parentKind : 'epic';/);
    assert.equal((panel.match(/\{\.\.\.parentLink\}/g) || []).length, 2, 'Lead Times charts and the Workflow Status card');
    assert.match(panel, /<ProjectTrackBreakdownChart\n\s+issueKind=\{parentKind\}/);
});

test('Jira export, share links and Scenario name their levels; tokens stay', async () => {
    const { RENAMED } = await names();
    const share = { copyOwner: { subscribe: () => () => {}, getSnapshot: () => 0 }, shareDisabled: false };
    const shareMarkup = props => render('frontend/src/shareView/ShareViewButton.jsx', { surface: 'epic', activeControlSurface: 'epic', share, epicKey: 'PLAN-1', ...props });
    assert.match(shareMarkup({ entityNames: RENAMED }), /aria-label="Copy link to Theme PLAN-1"/);
    assert.match(shareMarkup({ entityNames: RENAMED, issueKind: 'story' }), /aria-label="Copy link to Deliverable PLAN-1"/);
    assert.match(shareMarkup({}), /aria-label="Copy link to Epic PLAN-1"/);
    const { scenarioNoParentLane } = await import('../frontend/src/scenario/scenarioUtils.js');
    assert.equal(scenarioNoParentLane(RENAMED), 'No Theme');
});

test('the tour names the ancestor, parent and child; ids, groups and selectors never change', async () => {
    const { DELIVERY, RENAMED } = await names();
    const steps = await import('../frontend/src/onboarding/onboardingSteps.js');
    const delivery = steps.buildOnboardingSteps(DELIVERY);
    const step = (set, id) => set.catalog.find(entry => entry.id === id);
    assert.equal(step(delivery, 'hierarchy-initiative').title, 'Start with the Objective');
    assert.equal(step(delivery, 'hierarchy-initiative').body, 'An Objective groups related Initiatives around a broader outcome.');
    assert.equal(step(delivery, 'hierarchy-epic').body, 'An Initiative groups the Epics that contribute to a larger delivery outcome.');
    assert.equal(step(delivery, 'hierarchy-story').title, 'See the delivery Epics');
    const renamed = steps.buildOnboardingSteps(RENAMED);
    assert.equal(step(renamed, 'hierarchy-story').body, 'Deliverables are the delivery work grouped under a Theme.');
    assert.equal(renamed.byModule.board[0].body, 'Board is the Theme view for this Department. You can configure your group Board in Settings.');
    assert.equal(renamed.byModule['catch-up'], renamed.catalog);
    const fallback = steps.buildVisibleOnboardingSteps({}, { catalog: renamed.catalog }).find(entry => entry.id === 'hierarchy');
    assert.equal(fallback.body, 'Work is organized from Objectives to Themes and then to the Deliverables that deliver them.');
    const tokens = set => [...set.catalog, ...Object.values(set.byModule).flat()].map(entry => [entry.id, entry.group, entry.selectors.join('|')]);
    assert.deepEqual(tokens(renamed), tokens({ catalog: steps.ONBOARDING_STEP_CATALOG, byModule: steps.ONBOARDING_STEPS_BY_MODULE }));
    for (const entry of renamed.catalog) {
        assert.doesNotMatch(`${entry.title} ${entry.body} ${entry.loadingBody || ''} ${entry.fallbackBody || ''}`, /\b(stor(y|ies)|epics?)\b/i, entry.id);
    }
    // Articles follow the spoken first sound: acronyms by letter name.
    const { resolveEntityNames } = await import('../frontend/src/eng/engWorkModel.js');
    const withAncestor = ancestor => steps.buildOnboardingSteps(resolveEntityNames('rnd_2027', { ancestor: { name: ancestor, hierarchyLevel: 3 } }));
    assert.equal(step(withAncestor('OKR'), 'hierarchy-initiative').body, 'An OKR groups related Initiatives around a broader outcome.');
    assert.equal(step(withAncestor('UX goal'), 'hierarchy-initiative').body, 'A UX goal groups related Initiatives around a broader outcome.');
    assert.equal(step(withAncestor('Goal'), 'hierarchy-initiative').body, 'A Goal groups related Initiatives around a broader outcome.');
    // Legacy keeps today's copy.
    assert.equal(step({ catalog: steps.ONBOARDING_STEP_CATALOG }, 'hierarchy-epic').body, 'An Epic groups the Stories that contribute to a larger delivery outcome.');
});
