// Check dashboard.jsx and the reachable scenario/, settings/, and epm/ modules.
// Each file uses its own imports and lexical bindings; nested hook/component contracts count.
// Spreads, non-literal call arguments, and props/defaulted component parameters remain unchecked.
import fs from 'node:fs';
import path from 'node:path';
import * as espree from 'espree';
import crypto from 'node:crypto';

const OWNER_DIRS = /^(scenario|settings|epm)[\\/]/;
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const baselineFile = flag('--baseline');
const manifestFile = flag('--manifest');
const writeInventory = flag('--write-inventory');
const repoRoot = path.resolve(flag('--repo-root') ?? '.');
const printReturns = args.indexOf('--print-returns');
const parse = (file) => espree.parse(fs.readFileSync(file, 'utf8'), {
    ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true,
});
const resolveImport = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec);
    for (const candidate of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile() && /\.(jsx?|mjs)$/.test(candidate)) return candidate;
    }
    return null;
};
function children(node) {
    return Object.entries(node).filter(([key]) => key !== 'loc').flatMap(([, value]) => (
        (Array.isArray(value) ? value : [value]).filter((child) => child && typeof child.type === 'string')
    ));
}
function walk(node, visit, skipFunctions = false) {
    if (!node || typeof node.type !== 'string') return;
    visit(node);
    for (const child of children(node)) if (!(skipFunctions && /Function/.test(child.type))) walk(child, visit, skipFunctions);
}
const keyName = (property) => property.computed ? undefined : property.key?.name ?? property.key?.value;
const cache = new Map();
function moduleAst(file) {
    if (!cache.has(file)) cache.set(file, parse(file));
    return cache.get(file);
}
function findFunction(file, exportedName) {
    const ast = moduleAst(file);
    const functions = new Map();
    let defaultName = null;
    for (const node of ast.body) {
        const decl = /^Export(Named|Default)Declaration$/.test(node.type) ? node.declaration : node;
        if (!decl) continue;
        if (decl.type === 'FunctionDeclaration') {
            if (decl.id) functions.set(decl.id.name, decl);
            if (node.type === 'ExportDefaultDeclaration') functions.set('default', decl);
        }
        if (decl.type === 'VariableDeclaration') {
            for (const d of decl.declarations) if (d.id.type === 'Identifier' && /Function/.test(d.init?.type)) functions.set(d.id.name, d.init);
        }
        if (node.type === 'ExportDefaultDeclaration') {
            if (decl.type === 'Identifier') defaultName = decl.name;
            else if (/Function/.test(decl.type)) functions.set('default', decl);
        }
    }
    return functions.get(exportedName === 'default' && defaultName ? defaultName : exportedName) ?? null;
}
function returnKeys(fn) {
    const keys = new Set();
    let unknown = false;
    let sawReturn = false;
    walk(fn.body, (node) => {
        if (node.type !== 'ReturnStatement') return;
        sawReturn = true;
        if (node.argument?.type !== 'ObjectExpression') { unknown = true; return; }
        for (const property of node.argument.properties) {
            const name = keyName(property);
            if (property.type === 'SpreadElement' || name === undefined) unknown = true;
            else keys.add(name);
        }
    }, true);
    return { keys, unknown: unknown || !sawReturn };
}
function paramInfo(fn, jsx = false) {
    const pattern = fn.params[0];
    // Preserve the documented limit: props and a defaulted first parameter are not checked.
    if (pattern?.type !== 'ObjectPattern') return null;
    const required = [];
    const accepted = new Set();
    let rest = false;
    for (const property of pattern.properties) {
        if (property.type === 'RestElement') { rest = true; continue; }
        const name = keyName(property);
        if (name === undefined) return null;
        accepted.add(name);
        if (property.value.type !== 'AssignmentPattern' && !(jsx && ['children', 'key', 'ref'].includes(name))) required.push(name);
    }
    return { required, accepted, rest };
}
if (printReturns !== -1) {
    const file = path.resolve(args[printReturns + 1]);
    const fn = findFunction(file, args[printReturns + 2] ?? 'default');
    if (!fn) { console.error('function not found'); process.exit(2); }
    const result = returnKeys(fn);
    if (result.unknown) console.error('warning: the return uses a spread or non-literal; only literal keys are listed');
    console.log([...result.keys].join('\n'));
    process.exit(0);
}
const entry = path.resolve(args[0]);
const sourceRoot = path.dirname(entry);
const owned = (file) => OWNER_DIRS.test(path.relative(sourceRoot, file));
const enforcedProblems = [];
const informational = [];
let checked = 0;
let filesChecked = 0;
// Keep the original enforcement boundary: contracts of shared components outside owner folders
// are informational, even when an owner module calls them (many props are intentionally optional).
const report = (caller, resolved, message) => (owned(resolved) ? enforcedProblems : informational).push(message);

// Build scopes before checking expressions, so imports/aliases cannot leak across shadowing bindings.
function lexicalScopes(ast, file) {
    const scopes = new WeakMap();
    const root = { parent: null, kind: 'Program', bindings: new Map() };
    function bind(pattern, scope, value = {}) {
        if (!pattern) return;
        if (pattern.type === 'Identifier') scope.bindings.set(pattern.name, value);
        else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope, value);
        else if (pattern.type === 'RestElement') bind(pattern.argument, scope, value);
        else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties) bind(p.type === 'RestElement' ? p.argument : p.value, scope, value);
        else if (pattern.type === 'ArrayPattern') for (const p of pattern.elements) bind(p, scope, value);
    }
    function visit(node, scope) {
        if (node.type === 'FunctionDeclaration' && node.id) bind(node.id, scope, { fn: node, resolved: file });
        if (/Function/.test(node.type)) {
            scope = { parent: scope, kind: 'Function', bindings: new Map() };
            if (node.id) bind(node.id, scope, { fn: node, resolved: file });
            for (const param of node.params) bind(param, scope);
        } else if (['BlockStatement', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement'].includes(node.type)) {
            scope = { parent: scope, kind: 'Block', bindings: new Map() };
            if (node.type === 'CatchClause') bind(node.param, scope);
        }
        scopes.set(node, scope);
        if (node.type === 'ImportDeclaration') {
            const resolved = node.source.value.startsWith('.') ? resolveImport(file, node.source.value) : null;
            for (const specifier of node.specifiers) {
                bind(specifier.local, scope, { resolved, exported: specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported?.name ?? specifier.imported?.value });
            }
        }
        if (node.type === 'VariableDeclaration') {
            let target = scope;
            if (node.kind === 'var') while (target.parent && target.kind === 'Block') target = target.parent;
            for (const d of node.declarations) bind(d.id, target, d.id.type === 'Identifier' ? { init: d.init, initScope: scope } : {});
        }
        if (node.type === 'ClassDeclaration' && node.id) bind(node.id, scope);
        for (const child of children(node)) visit(child, scope);
    }
    visit(ast, root);
    const binding = (name, scope) => {
        for (let current = scope; current; current = current.parent) if (current.bindings.has(name)) return current.bindings.get(name);
        return null;
    };
    function lookup(name, scope, seen = new Set()) {
        const value = binding(name, scope);
        if (!value || seen.has(value)) return null;
        seen.add(value);
        if (value.fn) return value;
        if (value.resolved && value.exported) {
            const fn = findFunction(value.resolved, value.exported);
            return fn ? { fn, resolved: value.resolved } : null;
        }
        if (value.init?.type === 'Identifier') return lookup(value.init.name, value.initScope, seen);
        if (/Function/.test(value.init?.type)) return { fn: value.init, resolved: file };
        return null;
    }
    function resultAlias(name, scope, seen = new Set()) {
        const value = binding(name, scope);
        if (!value || seen.has(value)) return null;
        seen.add(value);
        if (value.init?.type === 'Identifier') return resultAlias(value.init.name, value.initScope, seen);
        if (value.init?.type === 'CallExpression' && value.init.callee.type === 'Identifier' && /^use[A-Z]/.test(value.init.callee.name)) {
            const info = lookup(value.init.callee.name, value.initScope);
            return info ? { name: value.init.callee.name, info } : null;
        }
        return null;
    }
    return { scopes, lookup, resultAlias };
}
const queue = [entry];
const visited = new Set();
while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const ast = moduleAst(file);
    filesChecked += 1;
    for (const node of ast.body) {
        if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue;
        const resolved = resolveImport(file, node.source.value);
        if (resolved && owned(resolved)) queue.push(resolved);
    }
    const { scopes, lookup, resultAlias } = lexicalScopes(ast, file);
    const at = (node) => `${path.relative(sourceRoot, file)}:line ${node.loc.start.line}`;
    function checkDestructure(pattern, name, info, node) {
        const { keys, unknown } = returnKeys(info.fn);
        checked += 1;
        const wanted = pattern.properties.filter((p) => p.type === 'Property').map(keyName);
        const missing = wanted.filter((key) => !keys.has(key));
        if (missing.length && !unknown) report(file, info.resolved, `${name} (${at(node)}): destructured but not returned -> ${missing.join(', ')}`);
        else if (missing.length) report(file, info.resolved, `${name} (${at(node)}): return uses a spread or non-literal; cannot verify ${missing.length} names`);
    }
    function checkParams(name, info, passed, node, jsx = false, absent = false) {
        const params = paramInfo(info.fn, jsx);
        if (!params) return;
        if (absent && !params.required.length) {
            report(file, info.resolved, `${name} (${at(node)}): required input not passed -> first object argument`);
            return;
        }
        const missing = params.required.filter((key) => !passed.includes(key));
        const unknownKeys = params.rest ? [] : passed.filter((key) => !(jsx && ['key', 'ref'].includes(key)) && !params.accepted.has(key));
        if (missing.length) report(file, info.resolved, `${name} (${at(node)}): required input not passed -> ${missing.join(', ')}`);
        if (unknownKeys.length) report(file, info.resolved, `${name} (${at(node)}): passed but not accepted -> ${unknownKeys.join(', ')}`);
    }
    walk(ast, (node) => {
        const scope = scopes.get(node);
        if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init) {
            if (node.init.type === 'CallExpression' && node.init.callee.type === 'Identifier' && /^use[A-Z]/.test(node.init.callee.name)) {
                const info = lookup(node.init.callee.name, scope);
                if (info) checkDestructure(node.id, node.init.callee.name, info, node);
            } else if (node.init.type === 'Identifier') {
                const alias = resultAlias(node.init.name, scope);
                if (alias) checkDestructure(node.id, alias.name, alias.info, node);
            }
        }
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && /^use[A-Z]/.test(node.callee.name)) {
            const info = lookup(node.callee.name, scope);
            const first = node.arguments[0];
            if (info && !first) checkParams(node.callee.name, info, [], node, false, true);
            if (info && first?.type === 'ObjectExpression' && !first.properties.some((p) => p.type === 'SpreadElement' || p.computed)) {
                checkParams(node.callee.name, info, first.properties.map(keyName), node);
            }
        }
        if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier' && /^[A-Z]/.test(node.name.name)) {
            const info = lookup(node.name.name, scope);
            if (info && !node.attributes.some((a) => a.type === 'JSXSpreadAttribute')) {
                checkParams(node.name.name, info, node.attributes.map((a) => a.name.name), node, true);
            }
        }
    });
}

// Owner accounting is separate from call-site checks: discover all declared owner files,
// including helpers that are not yet reachable from App, and freeze symbol-level interfaces.
function sourceFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
        const file = path.join(dir, item.name);
        return item.isDirectory() ? sourceFiles(file) : /\.(jsx?|mjs)$/.test(file) ? [file] : [];
    });
}
function exportsOf(file) {
    const names = [];
    for (const node of moduleAst(file).body) {
        if (node.type === 'ExportDefaultDeclaration') names.push('default');
        if (node.type !== 'ExportNamedDeclaration') continue;
        if (node.declaration?.id) names.push(node.declaration.id.name);
        for (const d of node.declaration?.declarations ?? []) if (d.id.type === 'Identifier') names.push(d.id.name);
        for (const spec of node.specifiers) names.push(spec.exported.name ?? spec.exported.value);
    }
    return [...new Set(names)].sort();
}
function contractOf(file, exportName) {
    const fn = findFunction(file, exportName);
    if (!fn) return null;
    let jsx = false;
    walk(fn.body, node => { if (node.type === 'JSXElement' || node.type === 'JSXFragment') jsx = true; });
    const localName = fn.id?.name ?? exportName;
    const hook = /^use[A-Z]/.test(localName);
    if (!jsx && !hook) return null;
    const names = [], expanded = [], unresolved = [];
    function pattern(node, prefix = '') {
        if (node?.type === 'AssignmentPattern') return pattern(node.left, prefix);
        if (node?.type === 'Identifier') {
            let found = false;
            walk(fn.body, item => {
                if (item.type === 'VariableDeclarator' && item.id.type === 'ObjectPattern' && item.init?.type === 'Identifier' && item.init.name === node.name) { found = true; pattern(item.id, prefix); }
            });
            if (!found) unresolved.push(`parameter ${prefix || node.name}`);
            return;
        }
        if (node?.type !== 'ObjectPattern') { if (node) unresolved.push(`parameter ${prefix || node.type}`); return; }
        for (const property of node.properties) {
            const key = keyName(property);
            if (property.type === 'RestElement' || key === undefined) { unresolved.push(`rest/computed ${prefix}`); continue; }
            const full = prefix ? `${prefix}.${key}` : String(key);
            if (!prefix) names.push(String(key));
            const value = property.value.type === 'AssignmentPattern' ? property.value.left : property.value;
            if (value.type === 'ObjectPattern') pattern(value, full);
            else {
                expanded.push(full);
                // Explicit destructures/member reads expose bags even when renamed.
                const members = new Set();
                if (value.type === 'Identifier') {
                    const aliases = new Set([value.name]);
                    let grew = true;
                    while (grew) {
                        grew = false;
                        walk(fn.body, node => {
                            if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init?.type === 'Identifier' && aliases.has(node.init.name) && !aliases.has(node.id.name)) { aliases.add(node.id.name); grew = true; }
                        });
                    }
                    walk(fn.body, node => {
                        if (node.type === 'VariableDeclarator' && node.init?.type === 'MemberExpression') {
                            let root = node.init;
                            while (root.type === 'MemberExpression') root = root.object;
                            if (root.type === 'Identifier' && aliases.has(root.name)) unresolved.push(`bag ${full} member alias ${node.id.name ?? node.id.type}`);
                        }
                        if (node.type === 'VariableDeclarator' && node.init?.type === 'Identifier' && aliases.has(node.init.name) && node.id.type === 'ObjectPattern') {
                            for (const prop of node.id.properties) {
                                const member = keyName(prop);
                                if (member === undefined) unresolved.push(`bag ${full} spread/computed`);
                                else { members.add(String(member)); if (prop.value?.type === 'ObjectPattern') unresolved.push(`bag ${full}.${member} nested destructure`); }
                            }
                        }
                        if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && aliases.has(node.object.name)) {
                            if (!node.computed) members.add(node.property.name);
                            else if (node.property.type === 'Literal') members.add(String(node.property.value));
                            else unresolved.push(`bag ${full} dynamic member`);
                        }
                        if (node.type === 'MemberExpression') {
                            let cursor = node, parts = [], dynamic = false;
                            while (cursor.type === 'MemberExpression') {
                                if (!cursor.computed) parts.unshift(cursor.property.name);
                                else if (cursor.property.type === 'Literal') parts.unshift(String(cursor.property.value));
                                else { parts.unshift('[dynamic]'); dynamic = true; }
                                cursor = cursor.object;
                            }
                            if (cursor.type === 'Identifier' && aliases.has(cursor.name)) {
                                if (dynamic) unresolved.push(`bag ${full} dynamic deep member`);
                                else members.add(parts.join('.'));
                            }
                        }
                        if (node.type === 'CallExpression' && node.arguments.some(arg => arg.type === 'Identifier' && aliases.has(arg.name))) unresolved.push(`forwarded input ${full}`);
                        if (node.type === 'SpreadElement' && node.argument.type === 'Identifier' && aliases.has(node.argument.name)) unresolved.push(`spread input ${full}`);
                    });
                }
                for (const member of members) expanded.push(`${full}.${member}`);
            }
        }
    }
    for (const param of fn.params) pattern(param);
    const returns = hook ? returnKeys(fn) : { keys: new Set(), unknown: false };
    if (returns.unknown) {
        const topReturns = [];
        walk(fn.body, node => { if (node.type === 'ReturnStatement' && node.argument) topReturns.push(node.argument); }, true);
        if (!topReturns.length) returns.unknown = false;
        else if (topReturns.every(node => node.type === 'ArrayExpression' && node.elements.every(item => item?.type === 'Identifier'))) {
            returns.keys = new Set(topReturns.flatMap(node => node.elements.map((item,index) => `${index}:${item.name}`))); returns.unknown = false;
        }
        if (returns.unknown) unresolved.push('return spread/dynamic');
    }
    const inputNames = jsx ? [] : [...new Set(names)].sort();
    const propNames = jsx ? [...new Set(names)].sort() : [];
    const returnNames = [...returns.keys].sort();
    const expandedInputNames = [...new Set(expanded)].sort();
    const source = fs.readFileSync(file, 'utf8');
    return { exportName, inputNames, returnNames, propNames, expandedInputNames,
        outerParameterCount: fn.params.length, expandedInputCount: expandedInputNames.length,
        returnCount: returnNames.length, propCount: propNames.length,
        outerParameterCeiling: fn.params.length, expandedInputCeiling: expandedInputNames.length,
        returnCeiling: returnNames.length, propCeiling: propNames.length,
        unresolved: [...new Set(unresolved)],
        inventory: { source: `${path.relative(repoRoot, file)}:${fn.loc.start.line}`, sourceDigest: crypto.createHash('sha256').update(source).digest('hex') },
        callers: [], remainingAppReaders: [], getters: [],
    };
}
const canonicalManifest = path.resolve('scripts/extraction_lint/owner_budgets.json');
const manifestPath = manifestFile ? path.resolve(manifestFile) : entry === path.resolve('frontend/src/dashboard.jsx') && fs.existsSync(canonicalManifest) ? canonicalManifest : null;
if (manifestPath || writeInventory) {
    const manifest = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
    const roots = manifest?.ownerRoots ?? ['scenario', 'settings', 'epm'];
    const files = [...new Set(roots.flatMap(root => sourceFiles(path.resolve(sourceRoot, root))))].sort();
    const measured = files.map(file => {
        const relative = path.relative(repoRoot, file).split(path.sep).join('/');
        const features = /^scenario\//.test(path.relative(sourceRoot, file)) ? ['scenario'] : ['settings'];
        const exports = exportsOf(file);
        const lineCount = fs.readFileSync(file, 'utf8').split('\n').length - (fs.readFileSync(file, 'utf8').endsWith('\n') ? 1 : 0);
        return { id: path.relative(sourceRoot, file).replace(/\.(jsx?|mjs)$/, '').replaceAll('/', '.'), path: relative, features,
            exports, lineCount, lineCeiling: lineCount, interfaces: exports.map(name => contractOf(file, name)).filter(Boolean) };
    });
    const ledgerScopes = new Map();
    const appIdentifierLines = new Map();
    walk(moduleAst(entry), node => { if (node.type === 'Identifier') { const lines = appIdentifierLines.get(node.name) ?? []; lines.push(node.loc.start.line); appIdentifierLines.set(node.name, lines); } });
    for (const module of measured) for (const contract of module.interfaces) {
        const target = path.resolve(repoRoot, module.path);
        for (const callerFile of [entry, ...files]) {
            const ast = moduleAst(callerFile);
            const imported = new Set();
            if (callerFile === target) { const fn = findFunction(target, contract.exportName); const name = fn?.id?.name ?? (contract.exportName === 'default' ? null : contract.exportName); if (name) imported.add(name); }
            if (!ledgerScopes.has(callerFile)) ledgerScopes.set(callerFile, lexicalScopes(ast, callerFile));
            const callerScopes = ledgerScopes.get(callerFile);
            for (const node of ast.body) if (node.type === 'ImportDeclaration' && node.source.value.startsWith('.') && resolveImport(callerFile, node.source.value) === target) {
                for (const spec of node.specifiers) if ((spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.imported?.name) === contract.exportName) imported.add(spec.local.name);
            }
            walk(ast, node => {
                const name = node.type === 'CallExpression' && node.callee.type === 'Identifier' ? node.callee.name : node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier' ? node.name.name : null;
                if (!imported.has(name)) return;
                const resolvedBinding = callerScopes.lookup(name, callerScopes.scopes.get(node));
                if (!resolvedBinding || resolvedBinding.resolved !== target || resolvedBinding.fn !== findFunction(target, contract.exportName)) return;
                contract.callers.push({ path: path.relative(repoRoot, callerFile), symbol: name, line: node.loc.start.line, phase: node.type === 'JSXOpeningElement' ? 'render' : /^use[A-Z]/.test(name) ? 'hook execution' : 'requires phase review' });
                for (const argument of node.arguments ?? []) if (argument.type === 'ObjectExpression') for (const property of argument.properties) {
                    if (property.type === 'Property' && /Function/.test(property.value.type)) {
                        const parameterNames = new Set(property.value.params.filter(param => param.type === 'Identifier').map(param => param.name));
                        const captured = new Set();
                        walk(property.value.body, item => { if (item.type === 'Identifier' && !parameterNames.has(item.name)) captured.add(item.name); });
                        contract.getters.push({ caller: path.relative(repoRoot, callerFile), name: keyName(property), line: property.loc.start.line, capturedBindings: [...captured].sort(), phase: 'requires transitive invocation review' });
                    }
                }
            });
            if (callerFile === entry) walk(ast, node => {
                if (node.type !== 'VariableDeclarator' || !['ObjectPattern','ArrayPattern','Identifier'].includes(node.id.type) || node.init?.type !== 'CallExpression' || !imported.has(node.init.callee.name)) return;
                const readerBindings = node.id.type === 'ObjectPattern' ? node.id.properties.filter(p => p.type === 'Property' && p.value.type === 'Identifier').map(p => p.value) : node.id.type === 'ArrayPattern' ? node.id.elements.filter(p => p?.type === 'Identifier') : [node.id];
                for (const binding of readerBindings) {
                    const property = { value: binding };
                    const readers = (appIdentifierLines.get(property.value.name) ?? []).filter(line => line !== property.value.loc.start.line);
                    contract.remainingAppReaders.push({ name: property.value.name, lines: [...new Set(readers)] });
                }
            });
        }
    }
    if (writeInventory) {
        const dashboardLines = fs.readFileSync(entry, 'utf8').split('\n').length - 1;
        const totals = { scenario: measured.filter(m => m.features.includes('scenario')).reduce((n,m) => n+m.lineCount,0), settings: measured.filter(m => m.features.includes('settings')).reduce((n,m) => n+m.lineCount,0) };
        totals.uniqueOwners = measured.reduce((n,m) => n+m.lineCount,0); totals.appPlusOwners = dashboardLines + totals.uniqueOwners;
        fs.writeFileSync(writeInventory, JSON.stringify({ schemaVersion: 1, baseSha: 'REQUIRES_VERIFIED_BASE', checkpointId: 'PR0-current-base', sourceRoot: path.relative(repoRoot, sourceRoot), ownerRoots: roots,
            exclusions: { generated: ['frontend/dist'], tests: ['tests'], sharedImports: 'Imported files outside owner roots excluded' },
            dashboard: { path: path.relative(repoRoot, entry), lineCount: dashboardLines, lineCeiling: dashboardLines }, modules: measured,
            aggregates: Object.fromEntries(Object.entries(totals).map(([key,value]) => [key,{ measured:value, ceiling:value }])), transfer: { incomingRanges: [], scaffoldingAllowance: 0 } }, null, 2)+'\n');
        console.log(`owner inventory written: ${measured.length} modules`);
    }
    if (manifest) {
        const problems = [];
        const bad = message => problems.push(message);
        if (manifest.schemaVersion !== 1 || !manifest.baseSha || !manifest.checkpointId) bad('invalid manifest schema/header');
        const ids = new Set(), paths = new Set();
        for (const item of manifest.modules ?? []) {
            if (ids.has(item.id) || paths.has(item.path)) bad(`duplicate module id/path ${item.id}`);
            ids.add(item.id); paths.add(item.path);
            if (!fs.existsSync(path.resolve(repoRoot, item.path))) bad(`missing module ${item.path}`);
        }
        for (const module of measured) {
            const registered = manifest.modules?.find(item => path.resolve(repoRoot, item.path) === path.resolve(repoRoot, module.path));
            if (!registered) { bad(`unregistered owner module ${module.path}`); continue; }
            if (JSON.stringify(module.exports) !== JSON.stringify([...registered.exports].sort())) bad(`exports changed ${module.path}`);
            for (const name of module.exports) if (/^use[A-Z]/.test(name) && !module.interfaces.some(contract => contract.exportName === name)) bad(`unresolved exported hook ${module.path}:${name}`);
            for (const actual of module.interfaces) {
                const frozen = registered.interfaces?.find(item => item.exportName === actual.exportName);
                if (!frozen) { bad(`unregistered owner interface ${module.path}:${actual.exportName}`); continue; }
                if (actual.unresolved.length && frozen.inventory?.reviewed === true && frozen.inventory.sourceDigest === actual.inventory.sourceDigest && Array.isArray(frozen.inventory.memberNames)) {
                    actual.expandedInputNames = [...new Set([...actual.expandedInputNames, ...frozen.inventory.memberNames])].sort();
                    actual.expandedInputCount = actual.expandedInputNames.length;
                }
                for (const field of ['callers','remainingAppReaders','getters']) {
                    if (!Array.isArray(frozen[field])) { bad(`missing ledger ${module.path}:${actual.exportName}:${field}`); continue; }
                    const identifier = value => typeof value === 'string' && /^[A-Za-z_$][\w$]*$/.test(value);
                    const relativePath = value => typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
                    for (const item of frozen[field]) {
                        const valid = item && typeof item === 'object' && (field === 'callers'
                            ? relativePath(item.path) && identifier(item.symbol) && Number.isInteger(item.line) && item.line > 0 && ['render','hook execution','effect','event handler','deferred callback'].includes(item.phase)
                            : field === 'remainingAppReaders' ? identifier(item.name) && Array.isArray(item.lines) && item.lines.every(line => Number.isInteger(line) && line > 0)
                            : relativePath(item.caller) && identifier(item.name) && Number.isInteger(item.line) && item.line > 0 && Array.isArray(item.capturedBindings) && item.capturedBindings.every(identifier));
                        if (!valid) bad(`invalid ledger ${module.path}:${actual.exportName}:${field}`);
                    }
                    const key = item => field === 'callers' ? `${item.path}:${item.symbol}` : field === 'getters' ? `${item.caller}:${item.name}` : item.name;
                    if (field !== 'remainingAppReaders') {
                        const tally = items => { const counts = new Map(); for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0)+1); return counts; };
                        const beforeCounts = tally(frozen[field]), afterCounts = tally(actual[field]);
                        for (const name of new Set([...beforeCounts.keys(),...afterCounts.keys()])) if (beforeCounts.has(name) && afterCounts.has(name) && beforeCounts.get(name) !== afterCounts.get(name)) bad(`changed ledger site count ${module.path}:${actual.exportName}:${field}:${name}`);
                    }
                    const expected = new Set(frozen[field].map(key));
                    for (const item of actual[field]) if (!expected.has(key(item))) bad(`unregistered ${field} ${module.path}:${actual.exportName}:${key(item)}`);
                    const current = new Set(actual[field].map(key));
                    for (const item of frozen[field]) if (!current.has(key(item))) bad(`stale ${field} ${module.path}:${actual.exportName}:${key(item)}`);
                    if (field === 'getters') for (const item of actual[field]) { const old = frozen[field].find(prior => key(prior) === key(item)); if (old && JSON.stringify(old.capturedBindings) !== JSON.stringify(item.capturedBindings)) bad(`getter captures changed ${module.path}:${actual.exportName}:${key(item)}`); }
                    if (field === 'getters') for (const item of frozen[field]) if (!['render','effect','event handler','deferred callback'].includes(item.phase) || !item.evidence) bad(`unresolved getter phase ${module.path}:${actual.exportName}:${key(item)}`);
                }
                for (const field of ['inputNames','returnNames','propNames','expandedInputNames']) {
                    if (!Array.isArray(frozen[field])) { bad(`missing inventory ${module.path}:${actual.exportName}:${field}`); continue; }
                    const added = actual[field].filter(name => !frozen[field].includes(name));
                    if (added.length) bad(`interface members added ${module.path}:${actual.exportName}:${field}: ${added.join(', ')}`);
                }
                for (const [count,ceiling] of [['outerParameterCount','outerParameterCeiling'],['expandedInputCount','expandedInputCeiling'],['returnCount','returnCeiling'],['propCount','propCeiling']]) {
                    if (!Number.isInteger(frozen[ceiling]) || actual[count] > frozen[ceiling]) bad(`interface ceiling exceeded ${module.path}:${actual.exportName}:${ceiling}`);
                    if (!Number.isInteger(frozen[count]) || frozen[count] !== actual[count]) bad(`stale interface measurement ${module.path}:${actual.exportName}:${count}`);
                }
                if (actual.unresolved.length && !(frozen.inventory?.reviewed === true && frozen.inventory.sourceDigest === actual.inventory.sourceDigest && frozen.inventory.rationale && frozen.inventory.memberNames?.length)) bad(`unresolved inventory ${module.path}:${actual.exportName}: ${actual.unresolved.join(', ')}`);
                if (actual.unresolved.length && frozen.expandedInputCeiling < frozen.inventory?.memberNames?.length) bad(`reviewed bag inventory exceeds ceiling ${module.path}:${actual.exportName}`);
            }
            for (const node of moduleAst(path.resolve(repoRoot, module.path)).body) {
                if (node.type === 'ImportDeclaration' && node.source.value.startsWith('.')) {
                    const target = resolveImport(path.resolve(repoRoot, module.path), node.source.value);
                    if (target === entry) bad(`dependency direction: owner imports dashboard.jsx ${module.path}`);
                }
                if (['ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source?.value?.startsWith('.')) {
                    const target = resolveImport(path.resolve(repoRoot, module.path), node.source.value);
                    if (target === entry) bad(`dependency direction: owner re-exports dashboard ${module.path}`);
                }
            }
        }
        for (const registered of manifest.modules ?? []) if (!measured.some(module => path.resolve(repoRoot, module.path) === path.resolve(repoRoot, registered.path))) bad(`registered module outside owner roots ${registered.path}`);
        problems.forEach(message => enforcedProblems.push(`owner budget: ${message}`));
        console.log(`owner budgets: ${measured.length} modules; problems: ${problems.length}`);
    }
}
const baseline = baselineFile && fs.existsSync(baselineFile) ? new Set(fs.readFileSync(baselineFile, 'utf8').split('\n').filter(Boolean)) : new Set();
const strip = (message) => message.replace(/:line \d+/, '');
const newProblems = enforcedProblems.filter((message) => !baseline.has(strip(message)));
console.log(`checked ${checked} destructure sites in ${filesChecked} modules; enforced problems: ${newProblems.length}; informational: ${informational.length}; baselined: ${enforcedProblems.length - newProblems.length}`);
newProblems.forEach((message) => console.log(`  ENFORCED ${message}`));
if (process.env.CHECKER_VERBOSE) informational.forEach((message) => console.log(`  info ${message}`));
if (process.env.CHECKER_WRITE_BASELINE) fs.writeFileSync(process.env.CHECKER_WRITE_BASELINE, `${enforcedProblems.map(strip).join('\n')}\n`);
process.exitCode = newProblems.length ? 1 : 0;
