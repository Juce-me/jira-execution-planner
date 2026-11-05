const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Catch Up names its counts, alerts, requirement cards and row icons by the configured Jira types (EntityNames), and EPM,
// which passes no names, renders exactly as before. Synthetic values only.
const root = path.join(__dirname, '..');
const loadComponent = file => {
    const code = esbuild.buildSync({
        entryPoints: [path.join(root, file)], bundle: true, write: false, format: 'cjs', platform: 'node',
        external: ['react', 'react-dom'], loader: { '.jsx': 'jsx', '.js': 'jsx' },
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports;
};
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
const tasks = count => Array.from({ length: count }, (_, index) => ({ key: `PLAN-${index + 1}`, fields: { status: { name: 'To Do' } } }));
const BOLT_PATH = 'm10.271.050656';
const DASHED_BOLT_PATH = 'M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6l1-8Z';
const BOOKMARK_PATH = 'M7 4h10a2 2 0 012 2v14l-7-4-7 4V6a2 2 0 012-2z';

test('Catch Up readout unit and subject follow the planning type and its count', async () => {
    const { DELIVERY, RENAMED } = await names();
    const { buildEngCatchUpFacetModel, resolveEngCatchUpFilters } = await import('../frontend/src/eng/engCatchUpFilters.js');
    const resolve = (count, entityNames) => resolveEngCatchUpFilters({ model: buildEngCatchUpFacetModel({ tasks: tasks(count), names: entityNames }) });
    assert.equal(resolve(5, DELIVERY).readoutUnit, 'of 5 epics');
    assert.equal(resolve(5, DELIVERY).subject, 'Filtering epics');
    assert.equal(resolve(5, RENAMED).readoutUnit, 'of 5 deliverables');
    assert.equal(resolve(1, RENAMED).readoutUnit, 'of 1 deliverable');
    assert.equal(resolve(2).readoutUnit, 'of 2 stories');
    assert.equal(resolve(2).subject, 'Filtering stories');
    assert.equal(buildEngCatchUpFacetModel({ tasks: tasks(1), names: DELIVERY }).facets.find(facet => facet.id === 'projects').hidden, true);
    const trackEmpty = entityNames => buildEngCatchUpFacetModel({ tasks: tasks(1), names: entityNames }).facets.find(facet => facet.id === 'track').emptyDescription;
    assert.equal(trackEmpty(DELIVERY), 'No Project Track — showing epics under initiatives without a value');
    assert.equal(trackEmpty(RENAMED), 'No Project Track — showing deliverables under themes without a value');
    assert.equal(trackEmpty(), 'No Project Track — showing stories under epics without a value');
});

test('Stories Required reasons name the configured types; Legacy strings are unchanged', async () => {
    const { DELIVERY, RENAMED, LEGACY } = await names();
    const { getFuturePlanningNeedsStoriesReasonText: reason } = await import('../frontend/src/futurePlanningNeedsStories.mjs');
    assert.equal(reason('no_stories', DELIVERY), 'No epics yet for this sprint.');
    assert.equal(reason('only_closed_stories', DELIVERY), 'Only closed epics exist for this initiative.');
    assert.equal(reason('team_uncovered', DELIVERY), 'This Team has no actionable Epic in the selected sprint.');
    assert.equal(reason('no_stories', RENAMED), 'No deliverables yet for this sprint.');
    assert.equal(reason('stories_outside_sprint', RENAMED), 'Deliverables exist, but not in the selected sprint.');
    for (const legacyNames of [undefined, LEGACY]) {
        assert.equal(reason('no_stories', legacyNames), 'No stories yet for this sprint.');
        assert.equal(reason('selected_stories_not_actionable', legacyNames), 'Selected-sprint stories exist, but none are actionable.');
        assert.equal(reason('stories_outside_sprint', legacyNames), 'Stories exist, but not in the selected sprint.');
        assert.equal(reason('team_uncovered', legacyNames), 'This Team has no actionable Story in the selected sprint.');
        assert.equal(reason('only_closed_stories', legacyNames), 'Only closed stories exist for this epic.');
        assert.equal(reason('stories_in_other_sprint', legacyNames), 'Open stories exist, but not in the selected sprint.');
        assert.equal(reason('team_missing_selected', legacyNames), 'This team has no story for the selected sprint.');
        assert.equal(reason('other', legacyNames), 'Needs sprint-ready stories.');
    }
});

test('readiness copy uses the captured names', async () => {
    const { RENAMED } = await names();
    const { storyReadinessStatusMessage } = await import('../frontend/src/eng/engWorkHierarchy.js');
    assert.equal(storyReadinessStatusMessage('unavailable', '', { names: RENAMED }),
        'Deliverable readiness is temporarily unavailable. Jira Deliverables remain visible.');
    assert.match(storyReadinessStatusMessage('invalid_configuration', '', { names: RENAMED, error: { reason: 'teams_missing' } }), /^Deliverables Required needs at least one Team/);
    assert.equal(storyReadinessStatusMessage('unavailable'), 'Story readiness is temporarily unavailable. Jira Stories remain visible.');
});

test('the requirement card names the missing child and the parent it opens', async () => {
    const { DELIVERY, RENAMED } = await names();
    const StoryRequirementCard = loadComponent('frontend/src/eng/StoryRequirementCard.jsx').default;
    const requirement = { id: 'req-1', epicKey: 'PLAN-100', epic: { key: 'PLAN-100', summary: 'Sample initiative' }, team: { id: 't', name: 'Platform Team' }, sprint: { name: '2027Q1', state: 'active' } };
    const render = entityNames => renderToStaticMarkup(React.createElement(StoryRequirementCard, { requirement, jiraUrl: 'https://jira.example', entityNames }));
    const delivery = render(DELIVERY);
    assert.match(delivery, /<span class="story-requirement-title">Epic required<\/span>/);
    assert.ok(delivery.includes('aria-label="PLAN-100, Sample initiative: Epic required for Platform Team, target sprint 2027Q1. Opens the Initiative in Jira to create the Epic."'));
    assert.ok(delivery.includes(DASHED_BOLT_PATH) && delivery.includes('stroke-dasharray="3 2"') && !delivery.includes(BOLT_PATH),
        'a level-1 child shows the dashed placeholder bolt, never the solid one');
    const renamed = render(RENAMED);
    assert.match(renamed, /Deliverable required<\/span>/);
    assert.ok(renamed.includes('Opens the Theme in Jira to create the Deliverable.'));
    const legacy = render(undefined);
    assert.match(legacy, /Story required<\/span>/);
    assert.ok(legacy.includes('Opens the Epic in Jira to create the Story.'));
    assert.ok(legacy.includes('stroke-dasharray="3 2"') && !legacy.includes(BOLT_PATH) && !legacy.includes(DASHED_BOLT_PATH), 'Legacy keeps the dashed bookmark');
});

test('IssueCard icon follows the planning level; without names (EPM) it renders exactly as before', async () => {
    const { DELIVERY, RENAMED } = await names();
    const IssueCard = loadComponent('frontend/src/issues/IssueCard.jsx').default;
    const task = { key: 'PLAN-1', fields: { summary: 'Sample', status: { name: 'To Do' }, priority: { name: 'Medium' }, issuetype: { name: 'Epic' }, customfield_10004: 3 } };
    const render = props => renderToStaticMarkup(React.createElement(IssueCard, { task, jiraUrl: 'https://jira.example', teamLabel: 'Platform Team', ...props }));
    const epm = render({});
    assert.ok(epm.includes('class="story-icon" aria-hidden="true" title="STORY"'));
    assert.ok(epm.includes(BOOKMARK_PATH) && !epm.includes(BOLT_PATH));
    assert.equal(render({ entityNames: undefined }), epm);
    const delivery = render({ entityNames: DELIVERY });
    assert.ok(delivery.includes('class="story-icon" aria-hidden="true" title="EPIC"'));
    assert.ok(delivery.includes(BOLT_PATH) && !delivery.includes(BOOKMARK_PATH));
    assert.ok(render({ entityNames: RENAMED }).includes('title="DELIVERABLE"'));
});

test('a configured DELIVERY type draws its own Jira icon through the same-origin route; Legacy and EPM keep the glyphs', async () => {
    const { LEGACY, DELIVERY, RENAMED } = await names();
    const IssueCard = loadComponent('frontend/src/issues/IssueCard.jsx').default;
    const task = { key: 'PLAN-1', fields: { summary: 'Sample', status: { name: 'To Do' }, priority: { name: 'Medium' }, issuetype: { name: 'Deliverable' }, customfield_10004: 3 } };
    const card = entityNames => renderToStaticMarkup(React.createElement(IssueCard, { task, jiraUrl: 'https://jira.example', teamLabel: 'T', entityNames }));
    const renamed = card(RENAMED);
    assert.match(renamed, /class="story-icon" aria-hidden="true" title="DELIVERABLE"><svg[^>]*><image href="\/api\/issue-type-icon\/6" width="16" height="16"/);
    assert.ok(!renamed.includes(BOLT_PATH), 'the Jira icon replaces the level glyph');
    for (const [label, html] of [['EPM', card(undefined)], ['Legacy', card(LEGACY)], ['DELIVERY without a capture', card(DELIVERY)]]) {
        assert.ok(!html.includes('<image'), label);
    }
    const { EpicBlock } = loadComponent('frontend/src/eng/EpicBlock.jsx');
    const header = entityNames => renderToStaticMarkup(React.createElement(EpicBlock, {
        epicGroup: { key: 'SYN-1', epic: { summary: 'Synthetic parent', status: { name: 'In Progress' } }, storyPoints: 0, tasks: [] },
        statusTransitions: { activeSingleIssueTarget: null }, priorityTransitions: { activePriorityTarget: null }, projectTrackTransitions: { activeProjectTrackTarget: null },
        issueFieldEdits: { activeEditor: null, pendingIssueKeys: new Set(), status: 'idle' }, jiraUrl: 'https://jira.example',
        excludedEpicSet: new Set(), normalizeEpicKey: String, stickyEpicFocusKey: null, epicRefMap: { current: new Map() },
        renderPriorityIcon: () => null, epicRefresh: { epicStates: {}, leavingKeys: new Set() }, selectedTasks: {}, getTeamInfo: () => ({}),
        storySubtasksByKey: {}, entityNames,
    })).split('class="epic-title-row"')[1].split('</span>')[0];
    assert.match(header(RENAMED), /title="THEME"><svg[^>]*><image href="\/api\/issue-type-icon\/11700"/);
    assert.ok(!header(LEGACY).includes('<image'));
});

test('IssueCard field editing follows the planning-leaf role, not the Jira type name', async () => {
    const { RENAMED } = await names();
    const IssueCard = loadComponent('frontend/src/issues/IssueCard.jsx').default;
    const task = { key: 'PLAN-1', fields: { summary: 'Sample', status: { name: 'To Do' }, priority: { name: 'Medium' }, issuetype: { name: 'Deliverable' }, customfield_10004: 3 } };
    const issueFieldEdits = { activeEditor: null, pendingIssueKeys: new Set(), status: 'idle' };
    const render = props => renderToStaticMarkup(React.createElement(IssueCard, { task, jiraUrl: 'https://jira.example', teamLabel: 'T', issueFieldEdits, ...props }));
    const editable = /class="story-points-editor"/;
    assert.match(render({ entityNames: RENAMED, isPlanningLeaf: true }), editable, 'a new-model planning leaf opens the inline Story Points editor');
    assert.doesNotMatch(render({ entityNames: RENAMED }), editable, 'without the role a non story|epic name stays read-only');
    assert.match(render({ task: { ...task, fields: { ...task.fields, issuetype: { name: 'Story' } } } }), editable, 'EPM keeps the type-name test');
});

test('EpicBlock passes the planning-leaf role only in the new model; Legacy editability is unchanged', async () => {
    const { LEGACY, RENAMED } = await names();
    const { EpicBlock } = loadComponent('frontend/src/eng/EpicBlock.jsx');
    const card = (key, type) => ({ key, fields: { summary: key, status: { name: 'To Do' }, priority: { name: 'Medium' }, issuetype: { name: type }, customfield_10004: 3 } });
    const props = entityNames => ({
        epicGroup: { key: 'SYN-1', epic: { summary: 'Synthetic parent', status: { name: 'In Progress' } }, storyPoints: 6, tasks: [card('SYN-2', 'Deliverable'), card('SYN-3', 'Bug'), card('SYN-4', 'Story')] },
        statusTransitions: { activeSingleIssueTarget: null }, priorityTransitions: { activePriorityTarget: null }, projectTrackTransitions: { activeProjectTrackTarget: null },
        issueFieldEdits: { activeEditor: null, pendingIssueKeys: new Set(), status: 'idle' }, issueFieldEditsEnabled: true, jiraUrl: 'https://jira.example',
        excludedEpicSet: new Set(), normalizeEpicKey: String, stickyEpicFocusKey: null, epicRefMap: { current: new Map() }, statusTransitionEnabled: false,
        renderPriorityIcon: () => null, showStats: false, showPlanning: false, isEpicRefreshMode: false, epicRefresh: { epicStates: {}, leavingKeys: new Set() },
        selectedTasks: {}, getTeamInfo: () => ({}), shouldRenderIssueDependencies: false, storySubtasksByKey: {}, onboardingPreviewSession: false, entityNames,
    });
    const editableKeys = entityNames => {
        const html = renderToStaticMarkup(React.createElement(EpicBlock, props(entityNames)));
        return [...html.matchAll(/data-task-key="([^"]+)"/g)].map(match => match[1])
            .filter(key => html.split(`data-task-key="${key}"`)[1].split('data-task-key=')[0].includes('class="story-points-editor"'));
    };
    assert.deepEqual(editableKeys(LEGACY), ['SYN-4'], 'Legacy edits only by the Story/Epic name test, as before');
    assert.deepEqual(editableKeys(RENAMED), ['SYN-2', 'SYN-3', 'SYN-4'], 'every new-model planning row is the planning leaf');
    const capacityTitle = entityNames => renderToStaticMarkup(React.createElement(EpicBlock, { ...props(entityNames), showPlanning: true, canEditSharedConfiguration: true }))
        .match(/class="epic-stat-toggle[^"]*"[^>]*title="([^"]+)"/)[1];
    assert.equal(capacityTitle(LEGACY), 'Include/exclude this epic in shared group capacity and reporting');
    assert.equal(capacityTitle(RENAMED), 'Include/exclude this theme in shared group capacity and reporting');
});

test('alert pill counts are singular at 1 and the pin note is the plural label', async () => {
    const { DELIVERY, LEGACY } = await names();
    const { renderAlertsPanel, alertsPanelTree } = require('./share_view_alert_panel_fixture');
    const pill = (entityNames, count, workModel) => renderAlertsPanel({ props: { entityNames, workModel, alertCounts: { needsStories: count } } });
    assert.match(pill(DELIVERY, 1, 'rnd_2027'), /<span class="alerts-panel-summary-count">1<\/span><span> Epic required<\/span>/);
    assert.match(pill(DELIVERY, 2, 'rnd_2027'), /<span class="alerts-panel-summary-count">2<\/span><span> Epics required<\/span>/);
    assert.match(pill(LEGACY, 1), /<span> Story required<\/span>/);
    assert.match(pill(undefined, 2), /<span> Stories required<\/span>/);
    const { RENAMED } = await names();
    const parentAlerts = renderAlertsPanel({ props: { entityNames: RENAMED, workModel: 'rnd_2027', alertCounts: { empty: 2 } } });
    assert.match(parentAlerts, /<span> Empty theme<\/span>/);
    assert.match(parentAlerts, /Empty Theme<\/div>/);
    assert.match(parentAlerts, /Theme Ready to Close<\/div>/);

    const notes = [];
    const tree = alertsPanelTree({ props: { entityNames: DELIVERY, workModel: 'rnd_2027' }, overrides: { pinAlert: pin => notes.push(pin.note), handleStoryRequirementClick: () => {} } });
    const find = (node, match) => {
        if (!node || typeof node !== 'object') return null;
        if (Array.isArray(node)) { for (const child of node) { const hit = find(child, match); if (hit) return hit; } return null; }
        if (match(node)) return node;
        return find(node.props?.children, match);
    };
    const link = find(tree, node => String(node.props?.className || '').includes('alert-story-local-link'));
    assert.ok(link, 'the requirement row link renders');
    link.props.onClick();
    assert.deepEqual(notes, ['Epics required']);
});

test('the epic refresh announcement names the refreshed parent and its children', async () => {
    const { DELIVERY } = await names();
    const { epicRefreshAnnouncement } = loadComponent('frontend/src/eng/useEpicRefresh.js');
    assert.equal(epicRefreshAnnouncement({ result: 'changed', changedCount: 1, epicChanged: true }, DELIVERY), 'Initiative updated');
    assert.equal(epicRefreshAnnouncement({ result: 'changed', changedCount: 1 }, DELIVERY), '1 epic updated');
    assert.equal(epicRefreshAnnouncement({ result: 'changed', changedCount: 3 }, DELIVERY), '3 epics updated');
    assert.equal(epicRefreshAnnouncement({ result: 'failure' }, DELIVERY), 'Initiative refresh failed');
    assert.equal(epicRefreshAnnouncement({ result: 'same' }), 'Epic is up to date');
    assert.equal(epicRefreshAnnouncement({ result: 'changed', changedCount: 1 }), '1 story updated');
});
