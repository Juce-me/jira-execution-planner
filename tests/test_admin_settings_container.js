const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Server-render probe for AdminSettingsContainer (ST1 R4c): the stateless container renders every Admin
// tab from explicit props. DOM identity with the former inline JSX is proved by the Playwright DOM
// parity captures (settings_unified_save.spec.js), not here.
const containerPath = path.join(__dirname, '../frontend/src/settings/AdminSettingsContainer.jsx');
const source = fs.readFileSync(containerPath, 'utf8');
const PROP_NAMES = (() => {
    const start = source.indexOf('({\n');
    const end = source.indexOf('\n}) {', start);
    return source.slice(start + 3, end).split('\n').map((line) => line.trim().replace(/,$/, '')).filter(Boolean);
})();

function loadContainer() {
    const code = esbuild.buildSync({
        entryPoints: [containerPath], bundle: true, write: false, format: 'cjs', platform: 'node',
        external: ['react', 'react-dom'], loader: { '.jsx': 'jsx' },
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports.default;
}

function stub(name, tab, performanceAdminAvailable) {
    if (name === 'groupManageTab') return tab;
    if (name === 'BACKEND_URL') return 'http://example.test';
    if (name === 'authMode') return 'atlassian_oauth';
    if (name === 'adminAccess') return { users: [{ id: 'u1', name: 'A' }], loading: false, error: '', selectedUserIds: ['u1'], toggleUser() {} };
    if (name === 'performanceAdminAvailable') return performanceAdminAvailable;
    if (name === 'adminAccessAvailable' || name === 'adminUserManagementAvailable') return true;
    if (name === 'issueTypesDraft') return ['Story'];
    if (name === 'selectedProjectsDraft') return [{ key: 'AAA', type: 'product' }];
    if (name === 'priorityWeightsDraft') return [{ priority: 'High', weight: 3 }];
    if (name === 'jiraFields') return [{ id: 'customfield_1', name: 'Capacity' }];
    if (name === 'jiraProjects') return [{ key: 'AAA', name: 'Alpha' }];
    if (/Ref$/.test(name)) return { current: null };
    if (/^(set|handle|add|remove|clear|resolve|select|reset|update)/.test(name)) return () => '';
    if (/Results$/.test(name)) return [];
    if (/(Query|Draft|Source|ValidationError|HoverKey)$/.test(name)) return name === 'priorityWeightsSource' ? 'default' : '';
    if (/(Open|Loading|loading)/.test(name)) return false;
    if (/(Index|Hidden|Sum)$/.test(name)) return 0;
    return '';
}

function render(tab, performanceAdminAvailable = false) {
    const Container = loadContainer();
    const props = Object.fromEntries(PROP_NAMES.map((name) => [name, stub(name, tab, performanceAdminAvailable)]));
    return renderToStaticMarkup(React.createElement(Container, props));
}

test('the container takes the 160 explicit props the interface checker verifies', () => {
    assert.equal(PROP_NAMES.length, 160);
    assert.equal(new Set(PROP_NAMES).size, 160);
});

test('the container is stateless', () => {
    assert.equal(/\buse(State|Effect|Ref|Memo|Callback|Reducer)\b/.test(source), false);
});

const TAB_MARKERS = {
    scope: 'AAA',
    source: '',
    mapping: '',
    capacity: '',
    priorityWeights: 'High',
    access: 'App administrators',
};

test('every Admin tab selects its own tab, mounts its own panel and renders its own body', () => {
    const markup = new Map();
    for (const [tab, marker] of Object.entries(TAB_MARKERS)) {
        const html = render(tab);
        assert.ok(html.length > 200, `${tab} rendered markup`);
        assert.ok(html.includes(`id="admin-settings-${tab}-panel"`), `${tab} mounts its panel`);
        const selected = [...html.matchAll(/id="(admin-settings-[\w-]+-tab)"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="(admin-settings-[\w-]+-tab)"/g)]
            .map((match) => match[1] || match[2]);
        assert.deepEqual(selected, [`admin-settings-${tab}-tab`], `${tab} selects its tab`);
        if (marker) assert.ok(html.includes(marker), `${tab} renders ${marker}`);
        markup.set(tab, html);
    }
    assert.equal(new Set(markup.values()).size, markup.size, 'each tab renders its own body');
});

test('the performance tab renders its panel only when it is available', () => {
    const withPerformance = render('performance', true);
    assert.ok(withPerformance.includes('id="admin-settings-performance-panel"'));
    assert.ok(withPerformance.includes('Load performance'));
    assert.notEqual(withPerformance, render('performance', false));
});
