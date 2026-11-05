const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

async function loadEvents() {
    return import('../frontend/src/analytics/events.js');
}

test('the Project configuration editor reuses settings_action with section work_configurations', async () => {
    const { sanitizeAnalyticsParams } = await loadEvents();
    for (const workflowAction of ['open', 'save', 'save_result']) {
        assert.deepEqual(
            sanitizeAnalyticsParams({
                feature_name: 'settings',
                section: 'work_configurations',
                workflow_action: workflowAction,
                source_surface: 'settings',
                result: 'success',
                dirty_state: 'dirty',
                validation_count_bucket: '1_5',
            }, 'settings_action'),
            {
                feature_name: 'settings',
                section: 'work_configurations',
                workflow_action: workflowAction,
                source_surface: 'settings',
                result: 'success',
                dirty_state: 'dirty',
                validation_count_bucket: '1_5',
            });
    }
    assert.deepEqual(
        sanitizeAnalyticsParams({
            feature_name: 'settings', section: 'work_configurations', workflow_action: 'save_result',
            result: 'failure', conflict_state: 'remote', conflict_count_bucket: '1_5',
        }, 'settings_action').conflict_state, 'remote');
});

test('native Initiative work uses the existing safe kinds and no new vocabulary is needed', async () => {
    const { sanitizeAnalyticsParams } = await loadEvents();
    for (const kind of ['initiative', 'epic', 'story', 'mixed']) {
        assert.equal(sanitizeAnalyticsParams({ feature_name: 'external_links', issue_kind: kind }, 'external_link_opened').issue_kind, kind);
    }
    assert.equal(sanitizeAnalyticsParams({
        feature_name: 'eng_status_transitions', workflow_action: 'status_change_submit', source_surface: 'planning',
        issue_type_mix: 'initiatives',
    }, 'issue_status_action').issue_type_mix, 'initiatives');
});

test('configuration identity can never ride an analytics parameter', async () => {
    const { sanitizeAnalyticsParams } = await loadEvents();
    for (const name of ['configuration_id', 'configuration_revision', 'configuration_digest', 'quarter', 'jql',
        'field_id', 'board_id', 'project_key']) {
        assert.throws(
            () => sanitizeAnalyticsParams({ feature_name: 'settings', [name]: 'x' }, 'settings_action'),
            /unsupported analytics parameter/, name);
    }
    for (const value of ['cfg:legacy:1:abc', 'PLAN-12', 'project in (PLAN)', 'customfield_10101 = 5',
        'Legacy 2026', 'https://example.test/browse/PLAN-1']) {
        assert.throws(
            () => sanitizeAnalyticsParams({ feature_name: 'settings', section: value }, 'settings_action'),
            /unsafe analytics value/, value);
    }
});

test('work configuration adds no event name and no standalone auto-load event', async () => {
    const source = read('frontend/src/analytics/events.js');
    const names = source.slice(source.indexOf('EVENT_NAMES = new Set(['), source.indexOf(']);', source.indexOf('EVENT_NAMES')));
    assert.doesNotMatch(names, /work_config|configuration|quarter/i);
    const { sanitizeAnalyticsParams } = await loadEvents();
    for (const eventName of ['work_configuration_loaded', 'quarter_changed', 'work_configurations_action']) {
        assert.throws(() => sanitizeAnalyticsParams({ feature_name: 'settings' }, eventName), /unsupported analytics event_name/);
    }
});

test('the taxonomy documents the contract exactly once and keeps identity out', () => {
    const doc = read('docs/README_ANALYTICS.md');
    const marker = 'Quarterly work configuration: Project configuration Settings editor';
    assert.equal(doc.split(marker).length - 1, 1);
    const row = doc.split('\n').find(line => line.includes(marker));
    assert.ok(row.includes('`section=work_configurations`'));
    assert.ok(row.includes('`issue_kind=initiative`'));
    assert.ok(row.includes('no new standalone auto-load event'));
    assert.ok(row.includes('No GA4 admin or runbook change'));
    assert.match(row, /Never send configuration names or ids, revisions, digests/);
});

test('editor, context hook and request builders never forward configuration identity to analytics', () => {
    const files = [
        'frontend/src/settings/WorkConfigurationsEditor.jsx',
        'frontend/src/settings/useWorkConfigurationSettings.js',
        'frontend/src/workStructure/useActiveWorkContext.js',
        'frontend/src/api/statsApi.js',
        'frontend/src/api/epmApi.js',
    ];
    const call = /\btrack(?:ProductEvent|SettingsAction|StatsAction|EpmAction|Event|AppError|ApiResult)\s*\(([\s\S]{0,600}?)\)\s*;/g;
    const identity = /configuration(?:Id|Revision|Digest|Name)|\bdigest\b|\brevision\b|fieldId|fieldName|\bjql\b|projectKey|boardId|quarter/i;
    for (const relative of files) {
        const full = path.join(ROOT, relative);
        if (!fs.existsSync(full)) continue;
        const source = fs.readFileSync(full, 'utf8');
        for (const match of source.matchAll(call)) {
            assert.doesNotMatch(match[1], identity, `${relative}: ${match[0].slice(0, 120)}`);
        }
    }
});

// Task 5: analytics kinds come from the row's role and the configured hierarchy level (EntityNames *Kind), never from a
// Jira type name. Synthetic values only.
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const loadComponent = async (file, stubs = {}) => {
    const code = (await esbuild.build({
        entryPoints: [path.join(ROOT, file)], bundle: true, write: false, format: 'cjs', platform: 'node',
        external: ['react', 'react-dom'], loader: { '.jsx': 'jsx', '.js': 'jsx' },
        plugins: [{
            name: 'stubs',
            setup(build) {
                for (const [pattern, contents] of Object.entries(stubs)) {
                    build.onResolve({ filter: new RegExp(pattern) }, args => ({ path: args.path, namespace: 'stub' }));
                    build.onLoad({ filter: new RegExp(pattern), namespace: 'stub' }, () => ({ contents, loader: 'jsx' }));
                }
            },
        }],
    })).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports;
};
const entityNames = async () => {
    const { resolveEntityNames } = await import('../frontend/src/eng/engWorkModel.js');
    return {
        LEGACY: resolveEntityNames('legacy'),
        DELIVERY: resolveEntityNames('rnd_2027'),
        RENAMED: resolveEntityNames('rnd_2027', {
            planning: { id: '6', name: 'Deliverable', hierarchyLevel: 1 },
            parent: { id: '11700', name: 'Theme', hierarchyLevel: 2 },
            ancestor: { id: '12723', name: 'Goal', hierarchyLevel: 3 },
        }),
    };
};

test('issue_kind gains objective; every role maps to its native kind in both configurations', async () => {
    const { DELIVERY, LEGACY, RENAMED } = await entityNames();
    const { buildJiraBrowseLinkAnalytics, buildJiraIssueListLinkAnalytics } = await import('../frontend/src/analytics/externalLinks.js');
    const { buildIssueFieldEditAnalyticsParams } = await import('../frontend/src/analytics/dashboardAnalytics.js');
    const { reviewRowIssueKind } = await import('../frontend/src/eng/planningReviewKinds.js');
    assert.equal(buildJiraBrowseLinkAnalytics({ issueKind: DELIVERY.ancestorKind }).issueKind, 'objective');
    assert.equal(buildJiraIssueListLinkAnalytics({ issueKind: 'objective' }).issueKind, 'objective');
    assert.equal(buildIssueFieldEditAnalyticsParams('open', { fieldName: 'assignee', issueKind: 'objective', sourceSurface: 'catch_up' }).issue_kind, 'objective');
    // Planning review roles: `story` rows are the child, `epic` rows the parent.
    assert.equal(buildJiraBrowseLinkAnalytics({ issueKind: reviewRowIssueKind('story', DELIVERY) }).issueKind, 'epic');
    assert.equal(buildJiraBrowseLinkAnalytics({ issueKind: reviewRowIssueKind('epic', DELIVERY) }).issueKind, 'initiative');
    assert.equal(reviewRowIssueKind('story', RENAMED), 'epic', 'a renamed planning type keeps its level kind');
    assert.equal(reviewRowIssueKind('story', LEGACY), 'story');
    assert.equal(reviewRowIssueKind('epic', LEGACY), 'epic');
    assert.equal(reviewRowIssueKind('requirement', LEGACY), 'unknown');
});

test('the requirement card opens the parent and reports the parent kind', async () => {
    const { DELIVERY, LEGACY } = await entityNames();
    const { default: StoryRequirementCard } = await loadComponent('frontend/src/eng/StoryRequirementCard.jsx');
    const card = names => StoryRequirementCard({
        requirement: { id: 'r1', epicKey: 'PLAN-1', team: { id: 't1', name: 'Team A' }, sprint: { name: 'S1', state: 'active' } },
        jiraUrl: 'https://jira.example.test', entityNames: names,
    });
    assert.equal(card(DELIVERY).props.analyticsMeta.issueKind, 'initiative');
    assert.equal(card(LEGACY).props.analyticsMeta.issueKind, 'epic');
    assert.equal(StoryRequirementCard({
        requirement: { id: 'r1', epicKey: 'PLAN-1', team: { id: 't1', name: 'Team A' }, sprint: { name: 'S1', state: 'active' } }, jiraUrl: '',
    }).props.analyticsMeta.issueKind, 'epic', 'no names keeps the Legacy kind');
});

test('Board panel field edits on a renamed planning type send the level kind and are emitted', async () => {
    const { RENAMED, LEGACY } = await entityNames();
    const { buildIssueFieldEditAnalyticsParams } = await import('../frontend/src/analytics/dashboardAnalytics.js');
    const { default: EngBoardEpicPanel } = await loadComponent('frontend/src/eng/EngBoardEpicPanel.jsx', {
        'IssuePersonEditor\\.jsx$': 'export default function IssuePersonEditor(props) { props.onOpen(); return null; }',
    });
    const opened = names => {
        const editors = [];
        const issueFieldEdits = { activeEditor: null, pendingIssueKeys: new Set(), openEditor: editor => editors.push(editor) };
        const typeName = names === LEGACY ? 'Story' : 'Deliverable';
        const epicGroup = {
            key: 'PLAN-P1', epic: { key: 'PLAN-P1', summary: 'Synthetic parent', status: { name: 'To Do' } },
            tasks: [{ key: 'PLAN-1', fields: { summary: 'Synthetic child', status: { name: 'To Do' }, issuetype: { name: typeName } } }],
        };
        renderToStaticMarkup(React.createElement(EngBoardEpicPanel, {
            epicGroup, columns: [], issueFieldEdits, workModel: names.model, entityNames: names, onClose() {},
        }));
        return editors;
    };
    const renamed = opened(RENAMED);
    assert.deepEqual([...new Set(renamed.map(editor => `${editor.issueKey}:${editor.issueKind}`))].sort(), ['PLAN-1:epic', 'PLAN-P1:initiative']);
    for (const editor of renamed) {
        assert.ok(buildIssueFieldEditAnalyticsParams('open', { fieldName: 'assignee', issueKind: editor.issueKind, sourceSurface: 'board' }));
    }
    assert.deepEqual([...new Set(opened(LEGACY).map(editor => `${editor.issueKey}:${editor.issueKind}`))].sort(), ['PLAN-1:story', 'PLAN-P1:epic']);
    // The kind follows the configured level, not the model default: a planning type one level higher reports `initiative`.
    const { resolveEntityNames } = await import('../frontend/src/eng/engWorkModel.js');
    const raised = resolveEntityNames('rnd_2027', {
        planning: { name: 'Deliverable', hierarchyLevel: 2 }, parent: { name: 'Theme', hierarchyLevel: 3 }, ancestor: { name: 'Goal', hierarchyLevel: 4 },
    });
    assert.deepEqual([...new Set(opened(raised).map(editor => `${editor.issueKey}:${editor.issueKind}`))].sort(), ['PLAN-1:initiative', 'PLAN-P1:objective']);
});

test('status, priority and Project Track mixes come from the target kind; the Planning leaf keeps its SP bucket', async () => {
    const { DELIVERY, LEGACY } = await entityNames();
    const { buildCatchUpStatusTargets, buildStatusActionAnalyticsParams } = await import('../frontend/src/eng/engStatusTransitionUtils.js');
    const { buildCatchUpPriorityTargets, buildPriorityActionAnalyticsParams } = await import('../frontend/src/eng/engPriorityTransitionUtils.js');
    const { buildProjectTrackActionAnalyticsParams } = await import('../frontend/src/eng/engProjectTrackTransitionUtils.js');
    const initiatives = ['PLAN-1', 'PLAN-2'].map(key => buildCatchUpStatusTargets({ key, status: 'To Do' }, 'Epic', DELIVERY.parentKind));
    assert.equal(initiatives[0].issueKind, 'initiative');
    assert.equal(buildStatusActionAnalyticsParams({ sourceSurface: 'catch_up', targets: initiatives }).issue_type_mix, 'initiatives');
    assert.equal(buildPriorityActionAnalyticsParams({
        sourceSurface: 'catch_up', targets: [buildCatchUpPriorityTargets({ key: 'PLAN-1', priority: 'High' }, 'Epic', DELIVERY.parentKind)],
    }).issue_type_mix, 'initiatives');
    assert.equal(buildStatusActionAnalyticsParams({ targets: [{ key: 'PLAN-9', issueKind: 'objective' }] }).issue_type_mix, 'objectives');
    assert.equal(buildStatusActionAnalyticsParams({ targets: [initiatives[0], { key: 'PLAN-3', issueKind: 'epic' }] }).issue_type_mix, 'mixed');

    // A DELIVERY Planning Epic (the planning leaf) keeps its Story Points bucket; its Initiative parent sends none.
    const leaf = buildCatchUpStatusTargets({ key: 'PLAN-5', fields: { status: { name: 'To Do' }, issuetype: { name: 'Epic' }, customfield_10004: 3 } }, 'Story', DELIVERY.childKind);
    const planning = targets => buildStatusActionAnalyticsParams({ sourceSurface: 'planning', targets, leafKind: DELIVERY.childKind });
    assert.equal(planning([leaf]).selected_sp_bucket, '1_5');
    assert.equal(planning([leaf]).issue_type_mix, 'epics');
    assert.equal('selected_sp_bucket' in planning([initiatives[0]]), false);

    // Legacy is unchanged, with or without a kind on the target.
    const story = { key: 'OLD-1', fields: { status: { name: 'To Do' }, issuetype: { name: 'Story' }, customfield_10004: 3 } };
    for (const target of [buildCatchUpStatusTargets(story, 'Story'), buildCatchUpStatusTargets(story, 'Story', LEGACY.childKind)]) {
        const params = buildStatusActionAnalyticsParams({ sourceSurface: 'planning', targets: [target] });
        assert.equal(params.issue_type_mix, 'stories');
        assert.equal(params.selected_sp_bucket, '1_5');
    }
    // A kind-less target counts as the leaf only under the Legacy name rule: a new-model Jira "Epic" needs its role kind.
    const kindless = { key: 'PLAN-6', issueType: 'Epic', storyPoints: 3 };
    assert.equal('selected_sp_bucket' in planning([kindless]), false);
    assert.equal('selected_sp_bucket' in planning([{ key: 'PLAN-7', issueType: 'Story', storyPoints: 3 }]), false);
    assert.equal(buildStatusActionAnalyticsParams({ sourceSurface: 'planning', targets: [{ key: 'OLD-3', issueType: 'Story', storyPoints: 3 }] }).selected_sp_bucket, '1_5');
    const epic = buildCatchUpStatusTargets({ key: 'OLD-2', status: 'To Do' }, 'Epic', LEGACY.parentKind);
    assert.equal(buildStatusActionAnalyticsParams({ sourceSurface: 'planning', targets: [epic] }).issue_type_mix, 'epics');
    assert.equal('selected_sp_bucket' in buildStatusActionAnalyticsParams({ sourceSurface: 'planning', targets: [epic] }), false);

    assert.equal(buildProjectTrackActionAnalyticsParams({ sourceSurface: 'catch_up' }).issue_type_mix, 'epics');
    assert.equal(buildProjectTrackActionAnalyticsParams({ sourceSurface: 'catch_up', issueKind: DELIVERY.parentKind }).issue_type_mix, 'initiatives');
});

test('in-scope ENG call sites pass a kind from the role and names, never a literal or a lowercased name', () => {
    // Object (`issueKind: 'epic'`) and JSX (`issueKind="epic"`, `issueKind={'epic'}`) literals, a raw row kind or a
    // lowercased name. A default parameter (`issueKind = 'epic'`) is the component's own fallback, not a call site.
    const literalKind = /issueKind(?::\s*|=\{?)['"][a-z]+['"]|issueKind:\s*(?:row\.rowKind|[\w.]+\.toLowerCase\(\))/;
    const literalKindLines = source => source.split('\n').map(line => line.replace(/\/\/.*$/, ''))
        .filter(line => literalKind.test(line) && !/\bissueKind\s+=\s/.test(line));
    for (const sample of ['<Card issueKind="epic" />', "<Card issueKind={'epic'} />", "open({ issueKind: 'story' })"]) {
        assert.equal(literalKindLines(sample).length, 1, sample);
    }
    assert.deepEqual(literalKindLines("function Card({ issueKind = 'epic' }) {}"), []);
    for (const relative of [
        'frontend/src/eng/StoryRequirementCard.jsx', 'frontend/src/eng/EpicBlock.jsx', 'frontend/src/issues/IssueCard.jsx',
        'frontend/src/eng/EngBoardEpicCard.jsx', 'frontend/src/eng/EngBoardEpicPanel.jsx', 'frontend/src/eng/PlanningReviewTable.jsx',
        'frontend/src/eng/EngBoardView.jsx',
    ]) assert.deepEqual(literalKindLines(read(relative)), [], relative);
    assert.doesNotMatch(read('frontend/src/dashboard.jsx'), /issueKind:\s*row\.rowKind/);
    for (const relative of ['frontend/src/issues/StatusTransitionMenu.jsx', 'frontend/src/issues/PriorityTransitionMenu.jsx']) {
        assert.match(read(relative), /onOpen\?\.\(issue, fallbackIssueType, issueKind\)/, relative);
    }
    assert.match(read('frontend/src/issues/StatusTransitionMenu.jsx'), /onPrefetch\?\.\(issue, fallbackIssueType, issueKind\)/);
    // data-issue-kind stays the fixed onboarding token derived from fallbackIssueType.
    assert.match(read('frontend/src/issues/StatusTransitionMenu.jsx'), /data-issue-kind=\{String\(fallbackIssueType \|\| ''\)\.toLowerCase\(\)\}/);
});

test('the taxonomy and runbook document role kinds, objective and the mix values', () => {
    const doc = read('docs/README_ANALYTICS.md');
    const row = event => doc.split('\n').find(line => line.startsWith(`| \`${event}\``));
    for (const event of ['issue_status_action', 'issue_priority_action']) {
        assert.ok(row(event).includes('`issue_type_mix` (`stories`\\|`epics`\\|`subtasks`\\|`initiatives`\\|`objectives`\\|`mixed`; from each target\'s role kind'), event);
    }
    assert.match(row('issue_project_track_action'), /`issue_type_mix` \(`epics`\\\|`initiatives`: the parent role/);
    assert.match(row('issue_field_edit_action'), /`initiative`\\\|`epic`\\\|`story`\\\|`objective`/);
    assert.match(row('external_link_opened'), /native kind from the row's role and configured hierarchy level/);
    assert.match(doc, /no new event: kinds derive from role and configured hierarchy level/i);
    const runbook = read('docs/plans/SUPPORT-ga4-user-configuration.md');
    assert.ok(runbook.includes('`issue_kind=story|epic|initiative|objective|unknown`'));
    assert.ok(runbook.includes('`issue_kind=initiative|epic|story|objective`'));
});
