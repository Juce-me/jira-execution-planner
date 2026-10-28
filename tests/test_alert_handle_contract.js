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

const PANEL = parse(readSrc('eng/EngAlertsPanel.jsx'));
const PIN_MODULE = parse(readSrc('eng/useAlertPin.js'));
const ALERTS_HOOK = parse(readSrc('eng/useEngAlerts.js'));
const DASHBOARD = parse(readSrc('dashboard.jsx'));

function findFunction(program, name) {
    let found = null;
    walk(program, (node) => { if (node.type === 'FunctionDeclaration' && node.id?.name === name) found = node; });
    assert.ok(found, `${name} not found`);
    return found;
}

// The names EngAlertsPanel destructures from its `alertProps` prop (`const { ... } = alertProps;`).
function panelNames() {
    const names = [];
    walk(PANEL, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init?.type === 'Identifier' && node.init.name === 'alertProps') {
            for (const property of node.id.properties) {
                assert.equal(property.type, 'Property', 'EngAlertsPanel destructure must list plain names');
                names.push(property.key.name);
            }
        }
    });
    // Plus direct member reads such as `alertProps.pinAlert?.(...)`.
    walk(PANEL, (node) => {
        if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'alertProps' && !node.computed && !names.includes(node.property.name)) names.push(node.property.name);
    });
    return names;
}

function returnedKeys(program, hookName) {
    const fn = findFunction(program, hookName);
    const returns = fn.body.body.filter((statement) => statement.type === 'ReturnStatement');
    assert.equal(returns.length, 1, `${hookName} must have one top-level return`);
    return returns[0].argument.properties.map((property) => {
        assert.equal(property.type, 'Property', `${hookName} return must not spread`);
        return property.key.name;
    });
}

// The generated `show<Name>Alert` / `setShow<Name>Alert` names, from the ALERT_FLAG_NAMES table.
function flagNames() {
    let table = null;
    walk(PIN_MODULE, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.name === 'ALERT_FLAG_NAMES') table = node.init;
    });
    assert.ok(table, 'ALERT_FLAG_NAMES not found');
    return table.elements.flatMap((pair) => [`show${pair.elements[0].value}Alert`, `setShow${pair.elements[0].value}Alert`]);
}

// What the panel-props builder supplies: its explicit keys, the generated flag names and the `alerts.<member>` reads.
function builder() {
    const fn = findFunction(PIN_MODULE, 'createAlertPanelProps');
    const inputs = fn.params[0].properties.map((property) => property.key.name);
    const body = fn.body.body.filter((statement) => statement.type === 'ReturnStatement')[0].argument;
    const keys = [];
    for (const property of body.properties) {
        if (property.type === 'SpreadElement') {
            assert.equal(property.argument.name, 'flagProps', 'only the generated flag props may be spread');
            keys.push(...flagNames());
        } else keys.push(property.key.name);
    }
    const members = new Set();
    walk(fn, (node) => {
        if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'alerts' && !node.computed) members.add(node.property.name);
    });
    return { inputs, keys, members };
}

function dashboardHandle() {
    let call = null; let declarator = null;
    walk(DASHBOARD, (node) => {
        if (node.type === 'VariableDeclarator' && node.init?.type === 'CallExpression' && node.init.callee.name === 'useEngAlerts') { call = node.init; declarator = node; }
    });
    assert.ok(call, 'useEngAlerts call not found in dashboard.jsx');
    return { call, declarator };
}

test('useEngAlerts is a handle in App(), not a destructure', () => {
    const { declarator } = dashboardHandle();
    assert.equal(declarator.id.type, 'Identifier');
    assert.equal(declarator.id.name, 'alerts');
});

test('every name EngAlertsPanel destructures from alertProps exists on the panel props builder', () => {
    const names = panelNames();
    assert.equal(names.length, 55, 'EngAlertsPanel destructure size changed; review the builder');
    assert.equal(new Set(names).size, names.length);
    const { keys } = builder();
    assert.deepEqual(names.filter((name) => !keys.includes(name)), []);
    assert.deepEqual(keys.filter((key) => !names.includes(key)), [], 'the builder supplies a key the panel never reads');
});

test('every alerts.<member> the builder reads is returned by useEngAlerts', () => {
    const returned = new Set(returnedKeys(ALERTS_HOOK, 'useEngAlerts'));
    const { members } = builder();
    assert.ok(members.has('visibleAlertCollections'));
    assert.deepEqual([...members].filter((member) => !returned.has(member)), []);
});

test('App() passes every builder input and the panel receives the builder result', () => {
    const { inputs } = builder();
    let bag = null;
    walk(DASHBOARD, (node) => {
        if (node.type === 'CallExpression' && node.callee.name === 'createAlertPanelProps') bag = node.arguments[0];
    });
    assert.ok(bag, 'createAlertPanelProps call not found in dashboard.jsx');
    const supplied = bag.properties.map((property) => property.key.name);
    assert.deepEqual(inputs.filter((name) => !supplied.includes(name)), []);
    assert.deepEqual(supplied.filter((name) => !inputs.includes(name)), []);
});

test('names App() still destructures from the alerts handle exist on it, and the control detects a missing one', () => {
    const returned = new Set(returnedKeys(ALERTS_HOOK, 'useEngAlerts'));
    const destructured = [];
    walk(DASHBOARD, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init?.type === 'Identifier' && node.init.name === 'alerts') {
            node.id.properties.forEach((property) => destructured.push(property.key.name));
        }
    });
    assert.ok(destructured.length > 0);
    assert.deepEqual(destructured.filter((name) => !returned.has(name)), []);
    assert.ok(['notReturnedByTheHook'].some((name) => !returned.has(name)), 'control: a missing name is detected');
});
