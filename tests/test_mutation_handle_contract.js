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

const DASHBOARD = parse(readSrc('dashboard.jsx'));
const EPIC_BLOCK = parse(readSrc('eng/EpicBlock.jsx'));

// handle binding in App() -> [hook function, hook file]
const HANDLES = {
    statusTransitions: ['useEngStatusTransitions', 'eng/useEngStatusTransitions.js'],
    priorityTransitions: ['useEngPriorityTransitions', 'eng/useEngPriorityTransitions.js'],
    projectTrackTransitions: ['useEngProjectTrackTransitions', 'eng/useEngProjectTrackTransitions.js'],
};

function findFunction(program, name) {
    let found = null;
    walk(program, (node) => { if (node.type === 'FunctionDeclaration' && node.id?.name === name) found = node; });
    assert.ok(found, `${name} not found`);
    return found;
}

function returnedKeys(handle) {
    const [hookName, file] = HANDLES[handle];
    const fn = findFunction(parse(readSrc(file)), hookName);
    const returns = fn.body.body.filter((statement) => statement.type === 'ReturnStatement');
    assert.equal(returns.length, 1, `${hookName} must have one top-level return`);
    return new Set(returns[0].argument.properties.map((property) => {
        assert.equal(property.type, 'Property', `${hookName} return must not spread`);
        return property.key.name;
    }));
}

function epicBlockParams() {
    const fn = findFunction(EPIC_BLOCK, 'EpicBlock');
    return fn.params[0].properties.map((property) => property.key.name);
}

// `const { member, other: alias } = <handle>;` and `<handle>.member` reads inside EpicBlock.
function epicBlockMemberReads(handle) {
    const fn = findFunction(EPIC_BLOCK, 'EpicBlock');
    const members = new Set();
    walk(fn.body, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init?.type === 'Identifier' && node.init.name === handle) {
            node.id.properties.forEach((property) => members.add(property.key.name));
        }
        if (node.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier' && node.object.name === handle) members.add(node.property.name);
    });
    return members;
}

function epicBlockPropsKeys() {
    let literal = null;
    walk(DASHBOARD, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.name === 'epicBlockProps') literal = node.init;
    });
    assert.ok(literal && literal.type === 'ObjectExpression', 'epicBlockProps literal not found in dashboard.jsx');
    return literal.properties.map((property) => {
        assert.equal(property.type, 'Property', 'epicBlockProps must not spread');
        return property.key.name;
    });
}

const missing = (wanted, available) => [...wanted].filter((name) => !available.has(name));

test('every prop EpicBlock reads exists on epicBlockProps and nothing extra is passed', () => {
    const params = epicBlockParams();
    const keys = epicBlockPropsKeys();
    assert.deepEqual(params.filter((name) => name !== 'epicGroup' && !keys.includes(name)), []);
    assert.deepEqual(keys.filter((name) => !params.includes(name)), [], 'epicBlockProps supplies a key EpicBlock never reads');
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(missing(['epicGroup'], new Set(params)).length === 0);
});

test('the three transition handles are passed whole and none of their members ride epicBlockProps', () => {
    const keys = epicBlockPropsKeys();
    for (const handle of Object.keys(HANDLES)) {
        assert.ok(keys.includes(handle), `${handle} must be an epicBlockProps key`);
        const members = returnedKeys(handle);
        const leaked = keys.filter((key) => key !== handle && members.has(key));
        assert.deepEqual(leaked, [], `${handle} members must not be re-passed flat`);
    }
    // The plan gate: 65 keys fold to at most 40 (the three handles replace 27 members and 5 derived locals).
    assert.ok(keys.length <= 40, `epicBlockProps has ${keys.length} keys, the gate is 40`);
});

test('every handle member EpicBlock reads exists on the hook return shape, and the control detects a missing one', () => {
    for (const handle of Object.keys(HANDLES)) {
        const returned = returnedKeys(handle);
        const read = epicBlockMemberReads(handle);
        assert.ok(read.size >= 8, `${handle}: EpicBlock reads too few members (${read.size})`);
        assert.deepEqual(missing(read, returned), [], `${handle}: member read by EpicBlock is not returned by its hook`);
        const [removed] = [...read];
        const without = new Set([...returned].filter((name) => name !== removed));
        assert.deepEqual(missing(read, without), [removed], 'control: a dropped member is detected');
    }
    for (const [handle, member] of [['statusTransitions', 'activeSingleIssueTarget'], ['priorityTransitions', 'activePriorityTarget'], ['projectTrackTransitions', 'activeProjectTrackTarget']]) {
        assert.ok(epicBlockMemberReads(handle).has(member), `${handle}.${member} derives the active key`);
    }
});

test('App() binds each handle to its hook and destructures only members the hook returns', () => {
    for (const [handle, [hookName]] of Object.entries(HANDLES)) {
        let declarator = null;
        walk(DASHBOARD, (node) => {
            if (node.type === 'VariableDeclarator' && node.init?.type === 'CallExpression' && node.init.callee.name === hookName) declarator = node;
        });
        assert.ok(declarator, `${hookName} call not found in dashboard.jsx`);
        assert.equal(declarator.id.type, 'Identifier');
        assert.equal(declarator.id.name, handle);
        const returned = returnedKeys(handle);
        const destructured = [];
        const reads = new Set();
        walk(DASHBOARD, (node) => {
            if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init?.type === 'Identifier' && node.init.name === handle) {
                node.id.properties.forEach((property) => destructured.push(property.key.name));
            }
            if (node.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier' && node.object.name === handle) reads.add(node.property.name);
        });
        assert.deepEqual(destructured.filter((name) => !returned.has(name)), []);
        assert.deepEqual(missing(reads, returned), [], `${handle}: dashboard.jsx reads a member the hook does not return`);
    }
});

test('EpicBlock derives the Priority and Project Track write gates from the Status gate exactly as App() does', () => {
    const source = readSrc('dashboard.jsx');
    assert.match(source, /const priorityTransitionEnabled = statusTransitionEnabled;/);
    assert.match(source, /const projectTrackTransitionEnabled = priorityTransitionEnabled;/);
    const block = readSrc('eng/EpicBlock.jsx');
    assert.match(block, /const priorityTransitionEnabled = statusTransitionEnabled;/);
    assert.match(block, /const projectTrackTransitionEnabled = statusTransitionEnabled;/);
});
