const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { repoRoot } = require('./frontend_source_helpers');

// Parses with the same espree pin as scripts/extraction_lint/run.sh. The package is not a repo dependency:
// it is installed into the gitignored tmp/lint on first use, exactly like the lint runner does.
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

function parse(source) {
    return espree.parse(source, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, range: true });
}

function walk(node, visit, parent = null) {
    if (!node || typeof node.type !== 'string') return;
    visit(node, parent);
    for (const key of Object.keys(node)) {
        if (key === 'parent') continue;
        const child = node[key];
        if (Array.isArray(child)) child.forEach((item) => walk(item, visit, node));
        else if (child && typeof child.type === 'string') walk(child, visit, node);
    }
}

function textOf(source, node) {
    return source.slice(node.range[0], node.range[1]);
}

// A member chain ending in `.current` of a name ending in `Ref` is a ref read. Refs are not reactive, so a ref
// value is exempt from the dependency array (the sprint catalog cache is the one such value in the prefs object).
function isRefRead(expression) {
    return /Ref\.current$/.test(expression);
}

// Collects the reactive value expressions an object (or expression) reads. Only the syntax forms the two
// targets use are accepted; anything else throws so a new form cannot pass unexamined.
function collectValues(source, node, out, { allowedCalls = [] } = {}) {
    switch (node.type) {
        case 'Identifier':
            out.add(node.name);
            return;
        case 'MemberExpression':
            if (node.computed) throw new Error(`unsupported computed member: ${textOf(source, node)}`);
            if (node.object.type !== 'Identifier' && node.object.type !== 'MemberExpression') {
                throw new Error(`unsupported member object: ${textOf(source, node)}`);
            }
            out.add(textOf(source, node));
            return;
        case 'LogicalExpression':
            collectValues(source, node.left, out, { allowedCalls });
            collectValues(source, node.right, out, { allowedCalls });
            return;
        case 'Literal':
            return;
        case 'ArrayExpression':
            if (node.elements.length) throw new Error(`unsupported non-empty array: ${textOf(source, node)}`);
            return;
        case 'ObjectExpression':
            for (const property of node.properties) {
                if (property.type === 'SpreadElement') {
                    collectValues(source, property.argument, out, { allowedCalls });
                } else if (property.computed) {
                    throw new Error(`unsupported computed key: ${textOf(source, property)}`);
                } else {
                    collectValues(source, property.value, out, { allowedCalls });
                }
            }
            return;
        case 'CallExpression': {
            // `ids.join('|')` is a value derived from one binding; the dependency array repeats the same call text.
            if (node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.object.type === 'Identifier'
                && node.callee.property.name === 'join' && node.arguments.every((argument) => argument.type === 'Literal')) {
                out.add(textOf(source, node));
                return;
            }
            const callee = node.callee.type === 'Identifier' ? node.callee.name : '';
            if (!allowedCalls.includes(callee)) throw new Error(`unsupported call: ${textOf(source, node)}`);
            node.arguments.forEach((argument) => collectValues(source, argument, out, { allowedCalls }));
            return;
        }
        default:
            throw new Error(`unsupported expression ${node.type}: ${textOf(source, node)}`);
    }
}

function dependencyNames(source, arrayNode) {
    const names = [];
    for (const element of arrayNode.elements) {
        if (element.type === 'Identifier' || element.type === 'CallExpression' || (element.type === 'MemberExpression' && !element.computed)) {
            names.push({ name: textOf(source, element), range: element.range });
        }
    }
    return names;
}

function findCalls(ast, predicate) {
    const found = [];
    walk(ast, (node) => { if (node.type === 'CallExpression' && predicate(node)) found.push(node); });
    return found;
}

const calleeName = (call) => (call.callee.type === 'Identifier'
    ? call.callee.name
    : call.callee.type === 'MemberExpression' && !call.callee.computed ? `${call.callee.object.name}.${call.callee.property.name}` : '');

// Target 1: the useEffect that saves the UI preferences object (the one whose saveUiPrefs argument holds both
// `selectedView` and `statsView`; an earlier saveUiPrefs call in a ref updater is a different declaration).
function analyzeUiPrefs(source, ast = parse(source)) {
    const effects = findCalls(ast, (call) => calleeName(call) === 'useEffect' && call.arguments.length === 2).filter((effect) => {
        let hit = false;
        walk(effect.arguments[0], (node) => {
            if (node.type === 'CallExpression' && calleeName(node) === 'saveUiPrefs' && node.arguments[0]?.type === 'ObjectExpression') {
                const keys = node.arguments[0].properties.map((property) => property.key?.name);
                if (keys.includes('selectedView') && keys.includes('statsView')) hit = true;
            }
        });
        return hit;
    });
    assert.equal(effects.length, 1, 'expected exactly one ui-prefs save effect');
    const [effect] = effects;
    let prefsObject = null;
    walk(effect.arguments[0], (node) => {
        if (node.type === 'CallExpression' && calleeName(node) === 'saveUiPrefs') prefsObject = node.arguments[0];
    });
    const values = new Set();
    collectValues(source, prefsObject, values);
    return { values, dependencies: dependencyNames(source, effect.arguments[1]) };
}

// Target 2: the group snapshot memo, `groupStateSnapshot = React.useMemo(() => buildGroupStateSnapshot(), [deps])`,
// whose values come from the `buildGroupStateSnapshot` arrow returning the snapshot object.
function analyzeGroupSnapshot(source, ast = parse(source)) {
    const memos = findCalls(ast, (call) => calleeName(call) === 'React.useMemo' && call.arguments.length === 2)
        .filter((call) => textOf(source, call.arguments[0]).replace(/\s/g, '') === '()=>buildGroupStateSnapshot()');
    assert.equal(memos.length, 1, 'expected exactly one group snapshot memo');
    let builder = null;
    walk(ast, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.name === 'buildGroupStateSnapshot') builder = node.init;
    });
    assert.ok(builder && builder.type === 'ArrowFunctionExpression' && builder.body.type === 'ObjectExpression',
        'buildGroupStateSnapshot must stay an arrow returning an object literal');
    const values = new Set();
    collectValues(source, builder.body, values, { allowedCalls: ['snapshotStatsGroupState'] });
    return { values, dependencies: dependencyNames(source, memos[0].arguments[1]) };
}

function missing({ values, dependencies }) {
    const have = new Set(dependencies.map((dependency) => dependency.name));
    return [...values].filter((value) => !isRefRead(value) && !have.has(value)).sort();
}

const TARGETS = [
    ['ui-prefs save effect', analyzeUiPrefs],
    ['group snapshot memo', analyzeGroupSnapshot],
];

// Names a dependency list may hold that are not read as values, and values that are not reactive state.
// A value read inside `buildGroupStateSnapshot` that is a stable non-state binding is exempted by name here,
// with the reason; keep this list empty unless a real exemption exists.
const NON_REACTIVE_VALUES = new Set();

const source = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx'), 'utf8');
const ast = parse(source);

for (const [label, analyze] of TARGETS) {
    test(`dashboard.jsx ${label} lists every value it reads`, () => {
        const result = analyze(source, ast);
        const gaps = missing(result).filter((name) => !NON_REACTIVE_VALUES.has(name));
        assert.deepEqual(gaps, [], `${label} reads values missing from its dependency array`);
    });

    // A negative control per real dependency: deleting it from the real source must make the analysis fail.
    test(`dashboard.jsx ${label} negative controls: removing any read dependency is reported`, () => {
        const { values, dependencies } = analyze(source, ast);
        const controls = dependencies.filter((dependency) => values.has(dependency.name));
        assert.ok(controls.length > 30, `expected many value-backed dependencies, found ${controls.length}`);
        for (const control of controls) {
            const [start, end] = control.range;
            const mutated = `${source.slice(0, start)}__removed__${source.slice(end)}`;
            const gaps = missing(analyze(mutated));
            assert.ok(gaps.includes(control.name), `removing dependency "${control.name}" was not reported from the ${label}`);
        }
    });
}

test('parity analysis syntax controls', () => {
    const wrap = (prefs, deps) => `function App(){ useEffect(() => { saveUiPrefs({ selectedView, statsView${prefs} }); }, [selectedView, statsView${deps}]); }`;
    // aliasing: the key name differs from the value binding
    assert.deepEqual(missing(analyzeUiPrefs(wrap(', planningTeamsEffortExpanded: teamsEffortExpanded', ', teamsEffortExpanded'))), []);
    assert.deepEqual(missing(analyzeUiPrefs(wrap(', planningTeamsEffortExpanded: teamsEffortExpanded', ''))), ['teamsEffortExpanded']);
    // a ref read is exempt from the dependency array
    assert.deepEqual(missing(analyzeUiPrefs(wrap(', catalog: someRef.current', ''))), []);
    // member and logical expressions resolve to the member chain
    assert.deepEqual(missing(analyzeUiPrefs(wrap(', nested: { ids: group.ids || [], id: group.id || fallback }', ', group.ids, group.id, fallback'))), []);
    assert.deepEqual(missing(analyzeUiPrefs(wrap(', nested: { ids: group.ids || [] }', ''))), ['group.ids']);
    // unsupported forms are rejected instead of passing unexamined
    assert.throws(() => analyzeUiPrefs(wrap(', value: compute(a)', '')), /unsupported call/);
    assert.throws(() => analyzeUiPrefs(wrap(', value: a ? b : c', '')), /unsupported expression ConditionalExpression/);
    assert.throws(() => analyzeUiPrefs(wrap(', value: items[0]', '')), /unsupported computed member/);
    // the snapshot target resolves spreads and the allowed stats call
    const snapshot = (body, deps) => `function App(){ const buildGroupStateSnapshot = () => ({ ${body} }); const groupStateSnapshot = React.useMemo(() => buildGroupStateSnapshot(), [${deps}]); }`;
    assert.deepEqual(missing(analyzeGroupSnapshot(snapshot('a, ...snapshotStatsGroupState({ b }), ...c', 'a, b, c'))), []);
    assert.deepEqual(missing(analyzeGroupSnapshot(snapshot('a, ...snapshotStatsGroupState({ b }), ...c', 'a, c'))), ['b']);
});
