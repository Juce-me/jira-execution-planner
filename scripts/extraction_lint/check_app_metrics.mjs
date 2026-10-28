// App() metrics table and the handle-in-dependency guard (DONE-dashboard-conflict-resistant-architecture, Task B0b).
// Usage (after run.sh copied the tool to tmp/lint, which holds espree and eslint-scope):
//   node tmp/lint/check_app_metrics.mjs [--src frontend/src] [--baseline FILE] [--manifest FILE] [--guard-only] [--json]
// Metrics (definitions fixed by the plan; this script measures, nothing is hard-coded):
//   names   = App()-scope bindings by eslint-scope analysis
//   courier = a name with at least one reference whose every reference is a shorthand object key, a bare JSX prop
//             or a dependency-array entry (a JSX tag use or any write counts against it)
//   bag     = an object literal with 25 or more properties inside App()
//   hooks   = occurrences of `useX(` in dashboard.jsx (`rg -o` semantics, not lines)
// Guard: a handle is a binding initialised from a custom `use*()` call whose hook does not return a memoized value
// (a hook whose every return is a `useMemo(...)`, or an identifier bound to one, is stable and not a handle). Functions
// that receive a parameter named like a handle found anywhere under --src also treat it as a handle. Violations:
//   bare-handle-in-deps         a bare handle in a useMemo/useCallback/useEffect/useLayoutEffect dependency array
//   handle-read-in-narrow-deps  a closure of such a hook reads a handle (or a member) its dependency array omits
// Known violations live in a shrink-only baseline (a new one fails; a baseline entry that no longer occurs also fails).
// Exit 0 clean, 1 guard failure, 2 tool error.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import * as espree from 'espree';
import * as eslintScope from 'eslint-scope';

const HOOK_NAME = /^use[A-Z]/;
const REACT_HOOKS = new Set(['useState', 'useReducer', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useId', 'useDeferredValue',
    'useTransition', 'useSyncExternalStore', 'useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useImperativeHandle', 'useDebugValue',
    'useOptimistic', 'useActionState']);
const DEP_HOOKS = new Set(['useMemo', 'useCallback', 'useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useImperativeHandle']);
const COUNTED_HOOKS = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useReducer', 'useLayoutEffect'];
const CANARIES = ['cohortMode', 'alertPin', 'showDoneEpicAlert'];
// A custom hook returning one of these (directly, or through a once-bound identifier) hands out an identity-stable value.
const STABLE_RETURNS = new Set(['useMemo', 'useSyncExternalStore', 'useRef', 'useDeferredValue']);
const BAG_SIZE = 25;
const SKIP_KEYS = new Set(['loc', 'range', 'tokens', 'comments', 'parent']);

function fail(message) { const error = new Error(message); error.toolError = true; throw error; }

function parseArgs(argv) {
    const options = { src: 'frontend/src', baseline: null, manifest: null, guardOnly: false, json: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--guard-only') options.guardOnly = true;
        else if (arg === '--json') options.json = true;
        else if (arg === '--src' || arg === '--baseline' || arg === '--manifest') {
            if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail(`${arg} requires a value`);
            options[arg.slice(2)] = argv[i + 1]; i += 1;
        } else fail(`unknown option: ${arg}`);
    }
    return options;
}

const childrenOf = (node) => Object.entries(node).flatMap(([key, value]) => {
    if (SKIP_KEYS.has(key) || !value || typeof value !== 'object') return [];
    return (Array.isArray(value) ? value : [value]).filter((child) => child && typeof child.type === 'string');
});

function walk(node, visit, parent = null) {
    visit(node, parent);
    for (const child of childrenOf(node)) walk(child, visit, node);
}

function parseSource(code, file) {
    let ast;
    try { ast = espree.parse(code, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true, range: true }); }
    catch (error) { fail(`${file}: parse error: ${error.message}`); }
    const parents = new WeakMap();
    walk(ast, (node, parent) => { if (parent) parents.set(node, parent); });
    const scopeManager = eslintScope.analyze(ast, {
        ecmaVersion: 2022, sourceType: 'module',
        fallback: (node) => childrenOf(node).length ? Object.keys(node).filter((key) => !SKIP_KEYS.has(key)) : [],
    });
    return { ast, code, parents, scopeManager, file };
}

function listSources(root) {
    return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const child = path.join(root, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : listSources(child);
        return /\.(jsx?|mjs)$/.test(entry.name) ? [child] : [];
    }).sort();
}

const hookCallName = (call) => {
    const callee = call?.type === 'CallExpression' ? call.callee : null;
    if (callee?.type === 'Identifier' && HOOK_NAME.test(callee.name)) return callee.name;
    if (callee?.type === 'MemberExpression' && !callee.computed && callee.object.name === 'React' && HOOK_NAME.test(callee.property.name)) return callee.property.name;
    return null;
};

// ---- metrics ---------------------------------------------------------------------------------------------------
const countOccurrences = (text, needle) => { let n = 0; for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n += 1; return n; };
const countLines = (text) => (text.match(/\n/g) || []).length + (text.endsWith('\n') || text === '' ? 0 : 1);

function measureApp(parsed) {
    const { ast, code, parents, scopeManager } = parsed;
    let appNode = null;
    walk(ast, (node) => { if (!appNode && node.type === 'FunctionDeclaration' && node.id?.name === 'App') appNode = node; });
    if (!appNode) fail(`${parsed.file}: App() not found`);
    const appScope = scopeManager.acquire(appNode);
    const names = appScope.variables.filter((variable) => variable.defs.length > 0);
    const tagNames = new Set();
    walk(appNode, (node) => {
        if (node.type !== 'JSXOpeningElement') return;
        let name = node.name;
        while (name.type === 'JSXMemberExpression') name = name.object;
        if (name.type === 'JSXIdentifier') tagNames.add(name.name);
    });
    const depArrayEntry = (node) => {
        const array = parents.get(node);
        const call = array && parents.get(array);
        return array?.type === 'ArrayExpression' && call?.type === 'CallExpression' && DEP_HOOKS.has(hookCallName(call)?.replace(/^React\./, '') ?? '')
            && call.arguments[call.arguments.length - 1] === array && call.arguments.length >= 2;
    };
    const courierPosition = (node) => {
        const parent = parents.get(node);
        if (parent?.type === 'Property' && parent.shorthand && parent.value === node && parents.get(parent)?.type === 'ObjectExpression') return true;
        if (parent?.type === 'JSXExpressionContainer' && parents.get(parent)?.type === 'JSXAttribute') return true;
        return depArrayEntry(node);
    };
    const couriers = names.filter((variable) => {
        if (tagNames.has(variable.name)) return false;
        const refs = variable.references.filter((ref) => !ref.init);
        return refs.length > 0 && refs.every((ref) => !ref.isWrite() && courierPosition(ref.identifier));
    });
    let bags = 0;
    walk(appNode, (node) => { if (node.type === 'ObjectExpression' && node.properties.length >= BAG_SIZE) bags += 1; });
    // The ui-prefs save: the largest object literal passed to saveUiPrefs inside App(), with its enclosing effect's dependency array.
    let prefs = null;
    walk(appNode, (node) => {
        if (node.type !== 'CallExpression' || node.callee.name !== 'saveUiPrefs' || node.arguments[0]?.type !== 'ObjectExpression') return;
        const keys = node.arguments[0].properties.filter((property) => property.type === 'Property').length;
        if (prefs && prefs.keys >= keys) return;
        let up = parents.get(node);
        while (up && !(up.type === 'CallExpression' && /^(React\.)?use(Layout)?Effect$/.test(code.slice(up.callee.range[0], up.callee.range[1])))) up = parents.get(up);
        const deps = up?.arguments[up.arguments.length - 1];
        prefs = { keys, deps: deps?.type === 'ArrayExpression' ? deps.elements.length : null, line: node.loc.start.line };
    });
    return { appLine: appNode.loc.start.line, names: names.length, couriers: couriers.length, bags, prefs };
}

function measure(src, dashboardFile) {
    const code = fs.readFileSync(dashboardFile, 'utf8');
    const app = measureApp(parseSource(code, dashboardFile));
    const lines = code.split('\n');
    const hooks = Object.fromEntries(COUNTED_HOOKS.map((hook) => [hook, countOccurrences(code, `${hook}(`)]));
    const canaries = Object.fromEntries(CANARIES.map((name) => [name, lines.filter((line) => new RegExp(`\\b${name}\\b`).test(line)).length]));
    const bundleFile = path.join(src, '..', 'dist', 'dashboard.js');
    let bundle = null;
    if (fs.existsSync(bundleFile)) { const buffer = fs.readFileSync(bundleFile); bundle = { raw: buffer.length, gzip: zlib.gzipSync(buffer, { level: 9 }).length }; }
    return { lines: countLines(code), ...app, hooks, canaries, bundle };
}

function printMetrics(metrics) {
    const rows = [
        ['dashboard.jsx lines', metrics.lines], ['Names in App() scope', metrics.names], ['Courier names', metrics.couriers],
        [`Bags with ${BAG_SIZE} or more keys`, metrics.bags],
        ['ui-prefs explicit keys (deps)', metrics.prefs ? `${metrics.prefs.keys} (${metrics.prefs.deps ?? 'no effect found'} deps)` : 'not found'],
        ...COUNTED_HOOKS.map((hook) => [`${hook}( occurrences`, metrics.hooks[hook]]),
        ...CANARIES.map((name) => [`canary lines: ${name}`, metrics.canaries[name]]),
        ['dashboard.js raw bytes', metrics.bundle ? metrics.bundle.raw : 'no frontend/dist build'],
        ['dashboard.js gzip bytes', metrics.bundle ? metrics.bundle.gzip : 'no frontend/dist build'],
    ];
    console.log('| Metric | Value |\n| --- | --- |');
    for (const [label, value] of rows) console.log(`| ${label} | ${value} |`);
}

// ---- handle-in-dependency guard --------------------------------------------------------------------------------
function functionReturns(fn) {
    const returns = [];
    const visit = (node) => {
        if (node !== fn && /Function/.test(node.type)) return;
        if (node.type === 'ReturnStatement') returns.push(node);
        childrenOf(node).forEach(visit);
    };
    visit(fn.body);
    return returns;
}

// A custom hook is "memoized" when every return is a STABLE_RETURNS call or an identifier bound once to one.
function returnsMemoized(fn) {
    if (fn.body.type !== 'BlockStatement') return STABLE_RETURNS.has(hookCallName(fn.body));
    const bound = new Map();
    for (const statement of fn.body.body) {
        if (statement.type !== 'VariableDeclaration') continue;
        for (const declarator of statement.declarations) if (declarator.id.type === 'Identifier') bound.set(declarator.id.name, declarator.init);
    }
    const returns = functionReturns(fn);
    return returns.length > 0 && returns.every((node) => {
        const value = node.argument;
        if (value?.type === 'CallExpression') return STABLE_RETURNS.has(hookCallName(value));
        return value?.type === 'Identifier' && STABLE_RETURNS.has(hookCallName(bound.get(value.name)));
    });
}

function indexHooks(files) {
    const index = new Map();
    for (const parsed of files) {
        walk(parsed.ast, (node) => {
            let name = null, fn = null;
            if (node.type === 'FunctionDeclaration' && node.id) { name = node.id.name; fn = node; }
            if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && /^(Arrow)?Function/.test(node.init?.type ?? '')) { name = node.id.name; fn = node.init; }
            if (!name || !HOOK_NAME.test(name)) return;
            const memoized = returnsMemoized(fn);
            index.set(name, index.has(name) ? { memoized: index.get(name).memoized && memoized, ambiguous: true } : { memoized });
        });
    }
    return index;
}

function guardFile(parsed, hookIndex, handleNames, relative) {
    const { ast, code, parents, scopeManager } = parsed;
    const handles = new Map();   // Variable -> kind
    const refTarget = new WeakMap();
    for (const scope of scopeManager.scopes) for (const ref of scope.references) refTarget.set(ref.identifier, ref.resolved);
    walk(ast, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
            const hook = hookCallName(node.init);
            if (hook && !REACT_HOOKS.has(hook) && !hookIndex.get(hook)?.memoized) for (const variable of scopeManager.getDeclaredVariables(node)) handles.set(variable, 'declared');
        }
        if (/Function/.test(node.type)) {
            for (const variable of scopeManager.getDeclaredVariables(node)) if (variable.defs[0]?.type === 'Parameter' && handleNames.has(variable.name)) handles.set(variable, 'received');
        }
    });
    const found = [];
    // A hook call without a name is identified by a digest of its dependency array, so adding another effect elsewhere does not rename it.
    const ownerOf = (call) => {
        const parent = parents.get(call);
        if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
        const deps = call.arguments[call.arguments.length - 1];
        return `anon:${hookCallName(call)}:${crypto.createHash('sha1').update(code.slice(deps.range[0], deps.range[1]).replace(/\s+/g, '')).digest('hex').slice(0, 8)}`;
    };
    const text = (node) => code.slice(node.range[0], node.range[1]).replace(/\s+/g, '').replace(/\?\./g, '.');
    walk(ast, (node) => {
        const hook = node.type === 'CallExpression' ? hookCallName(node) : null;
        if (!hook || !DEP_HOOKS.has(hook) || node.arguments.length < 2) return;
        const deps = node.arguments[node.arguments.length - 1];
        if (deps.type !== 'ArrayExpression') return;
        const owner = ownerOf(node);
        const entries = deps.elements.filter(Boolean).map(text);
        for (const element of deps.elements) {
            const variable = element?.type === 'Identifier' ? refTarget.get(element) : null;
            if (variable && handles.has(variable)) found.push({ kind: 'bare-handle-in-deps', handle: variable.name, member: '', owner, line: element.loc.start.line, hook });
        }
        const closure = node.arguments[0];
        if (!/Function/.test(closure?.type ?? '')) return;
        walk(closure, (id) => {
            const variable = id.type === 'Identifier' ? refTarget.get(id) : null;
            if (!variable || !handles.has(variable)) return;
            const def = variable.defs[0]?.name;
            if (def && def.range[0] >= closure.range[0] && def.range[1] <= closure.range[1]) return;   // declared inside the closure
            const parent = parents.get(id);
            const member = parent?.type === 'MemberExpression' && parent.object === id && !parent.computed ? parent.property.name : '';
            const handle = variable.name;
            // Covered when a dependency mentions the handle itself, or (for a member read) that member; conditional entries count.
            const mention = new RegExp(`(^|[^\\w$.])${handle.replace(/\$/g, '\\$')}${member ? `(\\.${member}\\b|(?![\\w$.]))` : '(?![\\w$.])'}`);
            const covered = entries.some((entry) => mention.test(entry));
            if (!covered) found.push({ kind: 'handle-read-in-narrow-deps', handle, member, owner, line: id.loc.start.line, hook });
        });
    });
    const unique = new Map();
    for (const item of found) {
        const key = `${relative}|${item.kind}|${item.handle}|${item.member}|${item.owner}`;
        if (!unique.has(key)) unique.set(key, { key, ...item, file: relative });
    }
    return { violations: [...unique.values()], handles: [...handles].map(([variable, kind]) => ({ name: variable.name, kind })) };
}

function runGuard(files, src, baselineFile) {
    const hookIndex = indexHooks(files);
    // Pass 1 finds handle names; pass 2 re-runs with them so a receiving file's parameters are handles too.
    const names = new Set();
    for (const parsed of files) for (const handle of guardFile(parsed, hookIndex, new Set(), '').handles) if (handle.kind === 'declared') names.add(handle.name);
    const violations = [], handles = [];
    for (const parsed of files) {
        const relative = path.relative(process.cwd(), parsed.file).split(path.sep).join('/');
        const result = guardFile(parsed, hookIndex, names, relative);
        violations.push(...result.violations);
        handles.push(...result.handles.map((handle) => ({ ...handle, file: relative })));
    }
    let baseline = [];
    if (baselineFile && fs.existsSync(baselineFile)) {
        const parsed = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.violations) || parsed.violations.some((entry) => !entry.key || !entry.reason)) fail(`${baselineFile}: invalid baseline (schemaVersion 1; every entry needs key and reason)`);
        baseline = parsed.violations;
    }
    const known = new Set(baseline.map((entry) => entry.key)), seen = new Set(violations.map((violation) => violation.key));
    return {
        violations, handles, handleNames: [...names].sort(),
        fresh: violations.filter((violation) => !known.has(violation.key)),
        baselined: violations.filter((violation) => known.has(violation.key)),
        stale: baseline.filter((entry) => !seen.has(entry.key)),
    };
}

try {
    const options = parseArgs(process.argv.slice(2));
    const src = path.resolve(options.src);
    if (!fs.existsSync(src)) fail(`source root not found: ${options.src}`);
    const dashboardFile = path.join(src, 'dashboard.jsx');
    const files = listSources(src).map((file) => parseSource(fs.readFileSync(file, 'utf8'), file));
    let metrics = null;
    if (!options.guardOnly) {
        if (!fs.existsSync(dashboardFile)) fail(`dashboard not found: ${dashboardFile}`);
        metrics = measure(src, dashboardFile);
    }
    const guard = runGuard(files, src, options.baseline);
    if (options.json) console.log(JSON.stringify({ metrics, guard: { violations: guard.violations, handles: guard.handles } }, null, 2));
    else {
        if (metrics) { printMetrics(metrics); console.log(''); }
        console.log(`handle guard: ${files.length} files; ${guard.handles.length} handle bindings (${guard.handleNames.length} distinct declared names)`);
        guard.baselined.forEach((violation) => console.log(`  baselined ${violation.kind}: ${violation.handle}${violation.member ? `.${violation.member}` : ''} in ${violation.owner} (${violation.file}:${violation.line})`));
        guard.fresh.forEach((violation) => console.log(`  VIOLATION ${violation.kind}: ${violation.handle}${violation.member ? `.${violation.member}` : ''} in ${violation.owner} (${violation.file}:${violation.line}) key: ${violation.key}`));
        guard.stale.forEach((entry) => console.log(`  STALE baseline entry (delete it, the baseline is shrink-only): ${entry.key}`));
        console.log(`handle guard problems: ${guard.fresh.length + guard.stale.length}; baselined: ${guard.baselined.length}`);
    }
    if (guard.fresh.length || guard.stale.length) process.exitCode = 1;
} catch (error) {
    console.error(error.toolError ? error.message : error.stack);
    process.exitCode = 2;
}
