const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { repoRoot } = require('./frontend_source_helpers');

// Same espree pin and lazy install into the gitignored tmp/lint as scripts/extraction_lint/run.sh.
function loadEspree() {
    const lintDir = path.join(repoRoot, 'tmp', 'lint');
    const manifest = path.join(lintDir, 'node_modules', 'espree', 'package.json');
    const installed = () => {
        try { return JSON.parse(fs.readFileSync(manifest, 'utf8')).version === '10.4.0'; } catch { return false; }
    };
    if (!installed()) {
        fs.mkdirSync(lintDir, { recursive: true });
        execFileSync('npm', ['install', '--prefix', lintDir, '--no-audit', '--no-fund', 'espree@10.4.0'], { stdio: 'inherit' });
    }
    return require(path.join(lintDir, 'node_modules', 'espree'));
}

const espree = loadEspree();
const readSrc = (relative) => fs.readFileSync(path.join(repoRoot, 'frontend', 'src', relative), 'utf8');
const parse = (source) => espree.parse(source, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } });

function walk(node, visit) {
    if (!node || typeof node.type !== 'string') return;
    visit(node);
    for (const key of Object.keys(node)) {
        if (key === 'parent') continue;
        const child = node[key];
        if (Array.isArray(child)) child.forEach((item) => walk(item, visit));
        else if (child && typeof child.type === 'string') walk(child, visit);
    }
}

const STATS_PANEL = parse(readSrc('stats/StatsPanel.jsx'));
const DASHBOARD = parse(readSrc('dashboard.jsx'));
const STATE_HOOK = parse(readSrc('stats/useStatsState.js'));
const DATA_HOOKS = parse(readSrc('stats/useStatsData.js'));

// The names StatsPanel destructures from its `stats` prop (`const { ... } = stats;`).
function statsPanelNames() {
    const names = [];
    walk(STATS_PANEL, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init?.type === 'Identifier' && node.init.name === 'stats') {
            for (const property of node.id.properties) {
                assert.equal(property.type, 'Property', 'StatsPanel destructure must list plain names');
                names.push(property.key.name);
            }
        }
    });
    return names;
}

// The keys a hook returns, read from its single top-level `return { ... }` of shorthand properties.
function returnedKeys(program, hookName) {
    let fn = null;
    walk(program, (node) => {
        if (node.type === 'FunctionDeclaration' && node.id?.name === hookName) fn = node;
    });
    assert.ok(fn, `${hookName} not found`);
    const returns = fn.body.body.filter((statement) => statement.type === 'ReturnStatement');
    assert.equal(returns.length, 1, `${hookName} must have one top-level return`);
    assert.equal(returns[0].argument.type, 'ObjectExpression', `${hookName} must return an object literal`);
    return returns[0].argument.properties.map((property) => {
        assert.equal(property.type, 'Property', `${hookName} return must not spread`);
        return property.key.name;
    });
}

// `const <handle> = useX(...)` bindings and the spread members of the StatsPanel `stats` prop, both from App.
function appBindings() {
    const handles = {};
    walk(DASHBOARD, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init?.type === 'CallExpression'
            && node.init.callee.type === 'Identifier' && /^useStats(State|Derived[ABC])$/.test(node.init.callee.name)) {
            handles[node.id.name] = { hook: node.init.callee.name, call: node.init };
        }
    });
    return handles;
}

function statsPanelPropMembers() {
    let members = null;
    walk(DASHBOARD, (node) => {
        if (node.type === 'JSXOpeningElement' && node.name.name === 'StatsPanel') {
            const attribute = node.attributes.find((item) => item.name?.name === 'stats');
            assert.ok(attribute, 'StatsPanel must receive a stats prop');
            members = attribute.value.expression.properties;
        }
    });
    assert.ok(members, 'StatsPanel element not found in dashboard.jsx');
    return members;
}

function providedKeys(handleNames, handles) {
    const keys = new Set();
    for (const name of handleNames) {
        const { hook } = handles[name];
        const program = hook === 'useStatsState' ? STATE_HOOK : DATA_HOOKS;
        returnedKeys(program, hook).forEach((key) => keys.add(key));
    }
    return keys;
}

test('the StatsPanel stats prop is built only from the four Stats hook handles', () => {
    const handles = appBindings();
    assert.deepEqual(Object.fromEntries(Object.entries(handles).map(([name, { hook }]) => [name, hook])),
        { stats: 'useStatsState', statsA: 'useStatsDerivedA', statsB: 'useStatsDerivedB', statsC: 'useStatsDerivedC' });
    const members = statsPanelPropMembers();
    assert.ok(members.every((member) => member.type === 'SpreadElement' && member.argument.type === 'Identifier'),
        'the prop must be a spread of handles, not a hand-written key list');
    assert.deepEqual(members.map((member) => member.argument.name), ['stats', 'statsA', 'statsB', 'statsC']);
});

test('every name StatsPanel destructures from stats exists on the merged model', () => {
    const names = statsPanelNames();
    assert.equal(names.length, 123, 'StatsPanel destructure size changed; review the model');
    assert.equal(new Set(names).size, names.length);
    const handles = appBindings();
    const provided = providedKeys(statsPanelPropMembers().map((member) => member.argument.name), handles);
    assert.deepEqual(names.filter((name) => !provided.has(name)), []);
});

test('dropping any one handle from the model leaves StatsPanel names unprovided', () => {
    const names = statsPanelNames();
    const handles = appBindings();
    const all = ['stats', 'statsA', 'statsB', 'statsC'];
    for (const dropped of all) {
        const provided = providedKeys(all.filter((name) => name !== dropped), handles);
        assert.ok(names.some((name) => !provided.has(name)), `${dropped} must contribute at least one StatsPanel name`);
    }
});

test('derived-hook call bags take the state handle by spread and every bag name the hooks read exists', () => {
    const handles = appBindings();
    const spreads = { statsA: ['stats'], statsB: ['stats', 'statsA'], statsC: ['stats', 'statsA'] };
    for (const [name, expected] of Object.entries(spreads)) {
        const bag = handles[name].call.arguments[0];
        assert.equal(bag.type, 'ObjectExpression');
        const spread = bag.properties.filter((property) => property.type === 'SpreadElement').map((property) => property.argument.name);
        assert.deepEqual(spread, expected, `${name} bag spreads`);
        // Every name the hook destructures must come from a spread handle or an explicit key.
        let hookFn = null;
        walk(DATA_HOOKS, (node) => { if (node.type === 'FunctionDeclaration' && node.id?.name === handles[name].hook) hookFn = node; });
        const wanted = hookFn.params[0].properties.map((property) => property.key.name);
        const explicit = new Set(bag.properties.filter((property) => property.type === 'Property').map((property) => property.key.name));
        const provided = providedKeys(expected, handles);
        assert.deepEqual(wanted.filter((key) => !explicit.has(key) && !provided.has(key)), [], `${name} missing hook inputs`);
    }
});
