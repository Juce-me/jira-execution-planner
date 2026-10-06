const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Server-render probe for EpmSettingsTab (ST2 R4b): the stateless container forwards its explicit props to
// EpmSettings, owns the project skeleton rows and derives three props. DOM identity with the former inline
// JSX is proved by the Playwright EPM settings specs, not here.
const containerPath = path.join(__dirname, '../frontend/src/epm/EpmSettingsTab.jsx');
const source = fs.readFileSync(containerPath, 'utf8');
const PROP_NAMES = (() => {
    const start = source.indexOf('({\n');
    const end = source.indexOf('\n}) {', start);
    return source.slice(start + 3, end).split('\n').map((line) => line.trim().replace(/,$/, '')).filter(Boolean);
})();
const DERIVED = new Set(['removedEpmProjectIds', 'setTrackedEpmSettingsProjectSort']);

function loadContainer() {
    const code = esbuild.buildSync({
        entryPoints: [containerPath], bundle: true, write: false, format: 'cjs', platform: 'node',
        external: ['react', 'react-dom'], loader: { '.jsx': 'jsx' },
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports.default;
}

function stub(name, overrides) {
    if (name in overrides) return overrides[name];
    if (name === 'epmConfigDraft') return { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: '', subGoalKeys: [] }, projects: {} };
    if (name === 'epmSettingsTab') return 'scope';
    if (name === 'epmScopeMeta') return { cloudId: 'cloud-1', error: '' };
    if (name === 'epmSettingsProjectView') return 'current';
    if (name === 'epmSettingsProjectSort') return 'status';
    if (name === 'epmSettingsProjectsFetchMeta') return {};
    if (name === 'removedEpmProjectIds') return new Set();
    if (name === 'selectedEpmRootGoal') return null;
    if (name === 'getEpmLabelRowKey') return (projectId) => `epm-project::${projectId}`;
    if (/Ref$/.test(name)) return { current: null };
    if (/^(set|handle|get|add|remove|clear|select|open|load|ensure|register|request|focus|update|delete)/.test(name)) return () => [];
    if (/(Query|Error|LoadedAt)$/.test(name)) return '';
    if (/(Rows|Projects|Goals|Prerequisites|Results|SubGoals)$/.test(name)) return [];
    if (/(Loading|Open|Saving|Refreshing|Loaded)$|^canLoad/.test(name)) return false;
    if (/Index$/.test(name)) return 0;
    return {};
}

function propsFor(overrides = {}) {
    return Object.fromEntries(PROP_NAMES.map((name) => [name, stub(name, overrides)]));
}

function render(overrides) {
    return renderToStaticMarkup(React.createElement(loadContainer(), propsFor(overrides)));
}

test('the container takes the 80 explicit props the interface checker verifies', () => {
    assert.equal(PROP_NAMES.length, 80);
    assert.equal(new Set(PROP_NAMES).size, 80);
});

test('the container is stateless', () => {
    assert.equal(/\buse(State|Effect|Ref|Memo|Callback|Reducer)\b/.test(source), false);
    assert.equal(/React\.use[A-Z]/.test(source), false);
});

test('every prop reaches EpmSettings under its own name, except the two documented derivations', () => {
    const props = Object.fromEntries(PROP_NAMES.map((name) => [name, { forwarded: name }]));
    props.epmConfigDraft = { version: 2, labelPrefix: 'custom_', scope: { rootGoalKey: '', subGoalKeys: [] }, projects: {} };
    props.removedEpmProjectIds = new Set(['p1']);
    const element = loadContainer()(props);
    assert.equal(typeof element.type, 'function');
    for (const name of PROP_NAMES.filter((key) => !DERIVED.has(key))) {
        assert.strictEqual(element.props[name], props[name], `${name} is forwarded unchanged`);
    }
    assert.strictEqual(element.props.setEpmSettingsProjectSort, props.setTrackedEpmSettingsProjectSort);
    assert.equal(element.props.hasSessionRemovedEpmProjects, true);
    assert.equal(element.props.epmLabelPrefixMask, 'custom_');
    assert.equal(element.props.DEFAULT_EPM_LABEL_PREFIX, 'rnd_project_');
    assert.equal(typeof element.props.isEmptyCustomEpmProjectRow, 'function');
    assert.equal(Object.keys(element.props).length, 84);
});

test('the container owns the project skeleton rows and the empty-draft prefix mask default', () => {
    const props = propsFor();
    props.epmConfigDraft = { version: 2, scope: { rootGoalKey: '', subGoalKeys: [] }, projects: {} };
    const element = loadContainer()(props);
    const skeleton = element.props.renderEpmProjectSkeletonRows();
    assert.equal(skeleton.props.ariaLabel, 'Loading EPM projects');
    assert.equal(skeleton.props.className, 'epm-project-skeleton-list');
    assert.equal(element.props.epmLabelPrefixMask, 'rnd_project_');
    assert.equal(element.props.hasSessionRemovedEpmProjects, false);
});

test('the Scope tab selects itself and renders the site and label prefix from the props', () => {
    const html = render({ epmConfigDraft: { version: 2, labelPrefix: 'custom_', scope: { rootGoalKey: '', subGoalKeys: [] }, projects: {} } });
    assert.ok(html.includes('id="epm-settings-scope-panel"'));
    assert.ok(!html.includes('id="epm-settings-projects-panel"'));
    assert.ok(html.includes('aria-selected="true" aria-controls="epm-settings-scope-panel"'));
    assert.ok(html.includes('cloud-1'));
    assert.ok(html.includes('value="custom_"'));
    assert.ok(html.includes('placeholder="rnd_project_"'));
});

test('the Projects tab renders skeleton rows while loading and a row for each project once loaded', () => {
    const loading = render({ epmSettingsTab: 'projects', epmSettingsProjectsLoading: true, canLoadEpmProjects: true });
    assert.ok(loading.includes('id="epm-settings-projects-panel"'));
    assert.ok(loading.includes('aria-selected="true" aria-controls="epm-settings-projects-panel"'));
    assert.ok(loading.includes('epm-project-skeleton-row'));
    const loaded = render({
        epmSettingsTab: 'projects',
        canLoadEpmProjects: true,
        epmSettingsProjectsLoaded: true,
        epmSettingsProjectRows: [{ id: 'p1', homeProjectId: 'p1', homeName: 'Alpha home', name: 'Alpha', label: 'rnd_project_alpha', stateLabel: 'On track', stateValue: 'on-track' }],
    });
    assert.ok(!loaded.includes('epm-project-skeleton-row'));
    assert.ok(loaded.includes('class="epm-project-settings-row'));
    assert.ok(loaded.includes('rnd_project_alpha'));
    assert.ok(loaded.includes('On track'));
});

test('session-removed projects change the empty Projects state', () => {
    const base = { epmSettingsTab: 'projects', canLoadEpmProjects: true, epmSettingsProjectsLoaded: true };
    assert.notEqual(render(base), render({ ...base, removedEpmProjectIds: new Set(['p1']) }));
});
