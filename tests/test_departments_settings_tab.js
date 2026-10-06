const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Server-render probe for DepartmentsSettingsTab (ST3 R4b): the stateless container renders the Departments
// sub-tab strip, the Team groups / Group labels / Boards panels and derives the group-board props. The three
// heavy children are replaced by stubs that record the props they receive, so forwarding and derivation are
// observable. DOM identity with the former inline JSX is proved by the Playwright Settings specs, not here.
const containerPath = path.join(__dirname, '../frontend/src/settings/DepartmentsSettingsTab.jsx');
const source = fs.readFileSync(containerPath, 'utf8');
const PROP_NAMES = (() => {
    const start = source.indexOf('({\n');
    const end = source.indexOf('\n}) {', start);
    return source.slice(start + 3, end).split('\n').map((line) => line.trim().replace(/,$/, '')).filter(Boolean);
})();
const STUBBED = ['TeamGroupsSettings', 'GroupBoardsTab', 'FirstRunGroupConfigurationGuide'];

let containerPromise;
function loadContainer() {
    containerPromise = containerPromise || buildContainer();
    return containerPromise;
}

async function buildContainer() {
    const stubPlugin = {
        name: 'stub-children',
        setup(build) {
            build.onResolve({ filter: /^\.\/(TeamGroupsSettings|GroupBoardsTab|FirstRunGroupConfigurationGuide)\.jsx$/ }, (args) => ({ path: path.basename(args.path, '.jsx'), namespace: 'stub' }));
            build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
                loader: 'js',
                contents: `const React = require('react');
module.exports = function ${args.path}(props) {
    (globalThis.__stubProps = globalThis.__stubProps || {})['${args.path}'] = props;
    return React.createElement('div', { 'data-stub': '${args.path}', 'data-keys': Object.keys(props).sort().join(',') });
};`,
            }));
        },
    };
    const code = (await esbuild.build({
        entryPoints: [containerPath], bundle: true, write: false, format: 'cjs', platform: 'node',
        external: ['react', 'react-dom'], loader: { '.jsx': 'jsx' }, plugins: [stubPlugin],
    })).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports.default;
}

const noop = () => {};
const GROUP = { id: 'g1', name: 'Alpha', teamIds: ['t1', 't2'], teamLabels: { t1: ['one', 'two', 'three'], t2: ['solo'] }, board: { columns: [] } };

function stub(name, overrides) {
    if (name in overrides) return overrides[name];
    const base = {
        BACKEND_URL: 'http://example.test', groupManageTab: 'teams', labelsTabEnabled: true, activeGroupDraft: GROUP,
        groupDraft: { groups: [GROUP] }, filteredGroupDrafts: [GROUP], savedBoardId: '12', savedSelectedProjects: [{ key: ' b ' }, { key: 'a' }, { key: '' }],
        firstRunConfigurationGuideVisible: false, firstRunConfigurationSession: { guideStep: 1, status: 'idle', error: '' },
        teamCatalogReady: true, epicsByStatus: [], resolveTeamName: (id) => `Team ${id}`,
    };
    if (name in base) return base[name];
    if (/Ref$/.test(name)) return { current: {} };
    if (/^(labelAddOpen|labelSearchQuery|labelSearchOpen|labelSearchLoading|labelSearchIndex|teamSearchFeedback|teamSearchOpen)$/.test(name)) return {};
    if (/^(set|handle|get|add|remove|select|toggle|update|duplicate|export|import|close|schedule|retry|return|advance|back|cancel|fetch)/.test(name)) return name === 'getLabelSearchResults' ? () => [] : noop;
    if (/(Query|Error|Label|Text)$/.test(name)) return '';
    if (/(Loading|Open|Saving|Advanced|Import|Visible|Mobile)$|^isGroup|^first.*Active$|Enabled$|Ready$|CanRefresh$/.test(name)) return false;
    if (/Index$/.test(name)) return 0;
    if (/(Results|Teams|Ids|Warnings)$|^visible/.test(name)) return [];
    return {};
}

function propsFor(overrides = {}) {
    return Object.fromEntries(PROP_NAMES.map((name) => [name, stub(name, overrides)]));
}

async function render(overrides) {
    const Container = await loadContainer();
    globalThis.__stubProps = {};
    const markup = renderToStaticMarkup(React.createElement(Container, propsFor(overrides)));
    return { markup, stubs: globalThis.__stubProps };
}

test('the container takes the 120 explicit props the interface checker verifies', () => {
    assert.equal(PROP_NAMES.length, 120);
    assert.equal(new Set(PROP_NAMES).size, 120);
    assert.deepEqual([...PROP_NAMES].sort(), PROP_NAMES, 'props are alphabetical like the other containers');
    assert.ok(!/use(State|Effect|Ref|Memo|Callback)\(/.test(source), 'the container must stay stateless');
});

test('the sub-tab strip names the three Departments tabs and disables Group labels until a group exists', async () => {
    const teams = (await render({ labelsTabEnabled: false })).markup;
    assert.match(teams, /role="tablist" aria-label="Departments settings sections"/);
    for (const id of ['teams', 'labels', 'boards']) assert.ok(teams.includes(`id="department-settings-${id}-tab"`), `tab ${id}`);
    assert.match(teams, /aria-selected="true"[^>]*aria-controls="department-settings-teams-panel"/);
    assert.match(teams, /id="department-settings-labels-tab"[^>]*disabled=""[^>]*title="Save at least one group first"/);
    assert.ok(teams.includes('>Team groups<') && teams.includes('>Group labels<') && teams.includes('>Boards<'));
    const enabled = (await render({ labelsTabEnabled: true })).markup;
    assert.doesNotMatch(enabled, /id="department-settings-labels-tab"[^>]*disabled=""/);
    assert.doesNotMatch(enabled, /Save at least one group first/);
});

test('only the active panel mounts, and the Team groups panel forwards its explicit props to TeamGroupsSettings', async () => {
    const teams = await render({ groupManageTab: 'teams' });
    assert.ok(teams.markup.includes('id="department-settings-teams-panel"') && !teams.markup.includes('id="department-settings-labels-panel"') && !teams.markup.includes('id="department-settings-boards-panel"'));
    const forwarded = Object.keys(teams.stubs.TeamGroupsSettings).sort();
    const callSource = source.slice(source.indexOf('<TeamGroupsSettings'), source.indexOf('/>', source.indexOf('<TeamGroupsSettings')));
    const expected = callSource.split('\n').map((line) => line.trim().replace(/,$/, '')).filter((line) => /^[A-Za-z_$][\w$]*$/.test(line)).sort();
    assert.deepEqual(forwarded, expected);
    assert.equal(forwarded.length, 90);
    assert.equal(teams.stubs.TeamGroupsSettings.groupManageTab, 'teams');
    assert.equal(teams.stubs.FirstRunGroupConfigurationGuide, undefined, 'the guide stays hidden outside first-run');
});

test('the first-run guide mounts inside the Team groups panel with its busy and interaction flags', async () => {
    const run = async (status, error, ready = true) => (await render({
        firstRunConfigurationGuideVisible: true, teamCatalogReady: ready,
        firstRunConfigurationSession: { guideStep: 2, status, error },
    })).stubs.FirstRunGroupConfigurationGuide;
    assert.equal((await run('saving_sections', '')).busy, true);
    assert.equal((await run('preference_pending', '')).busy, true);
    assert.equal((await run('preference_pending', 'failed')).busy, false);
    assert.equal((await run('idle', '')).busy, false);
    const guide = await run('idle', '', false);
    assert.equal(guide.step, 2);
    assert.equal(guide.interactionReady, false);
    assert.equal(guide.group.id, 'g1');
    assert.deepEqual(guide.groups.map((group) => group.id), ['g1']);
});

test('the Group labels panel lists groups and renders per-Team alias rows with the three-alias limit', async () => {
    const { markup } = await render({ groupManageTab: 'labels' });
    assert.ok(markup.includes('id="department-settings-labels-panel"') && markup.includes('aria-labelledby="department-settings-labels-tab"'));
    assert.match(markup, /group-list-item active[\s\S]*Alpha[\s\S]*2 teams/);
    assert.ok(markup.includes('Remove one from Team t1') && markup.includes('Remove three from Team t1'));
    assert.ok(markup.includes('3 of 3 labels'), 'a Team at the alias limit shows the count instead of an add control');
    assert.ok(!markup.includes('aria-label="Search Jira labels for Team t1"'));
    assert.ok(markup.includes('aria-label="Add label for Team t2"') && !markup.includes('aria-label="Search Jira labels for Team t2"'), 'a Team with aliases offers + Add label until it is opened');
    const opened = await render({ groupManageTab: 'labels', labelAddOpen: { 'g1::t2': true } });
    assert.ok(opened.markup.includes('aria-label="Search Jira labels for Team t2"') || opened.markup.includes('Search Jira labels for'), 'opening the add row shows the Jira label search');
    const noGroup = (await render({ groupManageTab: 'labels', activeGroupDraft: null, filteredGroupDrafts: [] })).markup;
    assert.ok(noGroup.includes('Select a group to edit its team label mappings.'));
    const noTeams = (await render({ groupManageTab: 'labels', activeGroupDraft: { ...GROUP, teamIds: [] } })).markup;
    assert.ok(noTeams.includes('Add teams in Team groups first, then return here to map labels.'));
    const single = (await render({ groupManageTab: 'labels', filteredGroupDrafts: [{ ...GROUP, teamIds: ['t1'] }] })).markup;
    assert.ok(single.includes('1 team<'));
});

test('the Boards panel derives the group-board props from the saved board and projects only', async () => {
    const calls = [];
    const { markup, stubs } = await render({ groupManageTab: 'boards', updateGroupDraftBoard: (...args) => calls.push(args) });
    assert.ok(markup.includes('id="department-settings-boards-panel"'));
    const props = stubs.GroupBoardsTab;
    assert.deepEqual(Object.keys(props).sort(), ['backendUrl', 'board', 'boardId', 'epicsByStatus', 'filteredGroupDrafts', 'groupManageTab', 'groupName', 'groupSearchQuery', 'onChange', 'projectScopeKey', 'random', 'setActiveGroupDraftId', 'setGroupSearchQuery', 'setShowGroupListMobile', 'showGroupListMobile', 'activeGroupDraft'].sort());
    assert.equal(props.backendUrl, 'http://example.test');
    assert.equal(props.boardId, '12', 'saved, not draft, board id');
    assert.equal(props.projectScopeKey, 'A,B', 'upper-cased, trimmed, blank-free and sorted project keys');
    assert.equal(props.groupName, 'Alpha');
    assert.equal(props.board, GROUP.board);
    assert.equal(props.random, Math.random);
    props.onChange({ columns: ['x'] });
    assert.deepEqual(calls, [['g1', { columns: ['x'] }]]);
    const none = (await render({ groupManageTab: 'boards', activeGroupDraft: null, updateGroupDraftBoard: (...args) => calls.push(args) })).stubs.GroupBoardsTab;
    assert.equal(none.board, null);
    assert.equal(none.groupName, '');
    none.onChange({ columns: [] });
    assert.equal(calls.length, 1, 'no active group, no board update');
});
