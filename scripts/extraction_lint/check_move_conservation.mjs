// Compare App() plus registered hook and explicit pure/component bodies at BOTH revisions. Full residual statements need
// human review; only effect-order divergence determines exit 1. Parse/coverage errors exit 2.
// Git: --base REF [--created-hook FILE] [--deleted-hook FILE] EXISTING_HOOK_FILES...
// Scratch: --base-file DASHBOARD --dashboard DASHBOARD --base-hook CURRENT_FILE=BASE_FILE ...
// Newly created/deleted files must be explicit; hook paths form the same union on both sides.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as espree from 'espree';
import crypto from 'node:crypto';

try {
    const args = process.argv.slice(2);
    const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const v = args[i + 1]; if (!v || v.startsWith('--')) throw new Error(`${name} requires a value`); args.splice(i, 2); return v; };
    const many = (name) => { const values = []; while (args.includes(name)) values.push(flag(name)); return values; };
    const baseRef = flag('--base') ?? 'HEAD';
    const baseFile = flag('--base-file');
    const dashboard = flag('--dashboard') ?? 'frontend/src/dashboard.jsx';
    const created = new Set(many('--created-hook').map((file) => path.resolve(file)));
    const deleted = new Set(many('--deleted-hook').map((file) => path.resolve(file)));
    const baselineHooks = new Map(many('--base-hook').map((value) => {
        const separator = value.indexOf('=');
        if (separator < 1) throw new Error('--base-hook requires CURRENT_FILE=BASE_FILE');
        return [path.resolve(value.slice(0, separator)), value.slice(separator + 1)];
    }));
    const ownerFunctions = new Map();
    const ownerKey = (value) => {
        const match = /^(.*)#([A-Za-z_$][\w$]*)$/.exec(value);
        if (!match) throw new Error(`invalid named owner: ${value}`);
        return `${path.resolve(match[1])}:${match[2]}`;
    };
    for (const value of many('--owner-function')) {
        const key = ownerKey(value);
        if (ownerFunctions.has(key)) throw new Error(`duplicate owner function: ${value}`);
        ownerFunctions.set(key, value);
    }
    const allowances = many('--allow-effect-move').map(value => {
        const match = /^(.*?)=>(.*?)@([a-f0-9]{64})$/.exec(value);
        if (!match) throw new Error(`invalid effect move allowance: ${value}`);
        return { from: ownerKey(match[1]), to: ownerKey(match[2]), digest: match[3], value };
    });
    if (new Set(allowances.map(item => `${item.from}:${item.digest}`)).size !== allowances.length) throw new Error('duplicate effect move allowance');
    if (args.some((arg) => arg.startsWith('--'))) throw new Error(`unknown option: ${args.find((arg) => arg.startsWith('--'))}`);
    const hookFiles = [...new Set([...args.map((file) => path.resolve(file)), ...created, ...deleted, ...baselineHooks.keys(), ...[...ownerFunctions.keys()].map(key => key.slice(0, key.lastIndexOf(':')))])].filter(file => file !== path.resolve(dashboard));
    for (const file of hookFiles) if (created.has(file) && deleted.has(file)) throw new Error(`${file} cannot be both created and deleted`);
    const gitRoot = baseFile ? null : execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    if (!baseFile) execFileSync('git', ['rev-parse', '--verify', `${baseRef}^{commit}`], { stdio: 'ignore' });
    const gitPath = (file) => path.relative(gitRoot, path.resolve(file)).split(path.sep).join('/');
    const gitExists = (file) => {
        try { execFileSync('git', ['cat-file', '-e', `${baseRef}:${gitPath(file)}`], { stdio: 'ignore' }); return true; }
        catch { return false; }
    };
    const gitRead = (file) => execFileSync('git', ['show', `${baseRef}:${gitPath(file)}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const parse = (code) => espree.parse(code, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true, range: true, tokens: true });
    function module(code, file) {
        const ast = parse(code);
        const functions = new Map();
        const exports = new Map();
        const addFunction = (name, fn) => { if (functions.has(name)) throw new Error(`ambiguous owner symbol ${file}#${name}`); functions.set(name, fn); };
        const imports = new Map();
        for (const node of ast.body) {
            if (node.type === 'ImportDeclaration' && node.source.value.startsWith('.')) {
                for (const specifier of node.specifiers) imports.set(specifier.local.name, { spec: node.source.value, exported: specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported?.name });
            }
            if (node.type === 'ExportNamedDeclaration' && !node.source) for (const specifier of node.specifiers) exports.set(specifier.exported.name, specifier.local.name);
            const decl = /^Export(Named|Default)Declaration$/.test(node.type) ? node.declaration : node;
            if (!decl) continue;
            if (decl.type === 'FunctionDeclaration' && decl.id) addFunction(decl.id.name, decl);
            if (decl.type === 'VariableDeclaration') for (const d of decl.declarations) if (d.id.type === 'Identifier' && /Function/.test(d.init?.type)) addFunction(d.id.name, d.init);
            if (node.type === 'ExportNamedDeclaration' && decl.type === 'FunctionDeclaration') exports.set(decl.id.name, decl.id.name);
            if (node.type === 'ExportNamedDeclaration' && decl.type === 'VariableDeclaration') for (const d of decl.declarations) if (d.id.type === 'Identifier') exports.set(d.id.name, d.id.name);
            if (node.type === 'ExportDefaultDeclaration') exports.set('default', decl.type === 'Identifier' ? decl.name : decl.id?.name);
        }
        const statements = (fn) => {
            if (fn.body.type !== 'BlockStatement') throw new Error(`${file}: hook bodies must use a block`);
            return fn.body.body.map((node) => ({
                node, file, line: node.loc.start.line, text: code.slice(node.range[0], node.range[1]),
                // Ignore only inter-token whitespace; preserve string/template/JSX literal contents.
                signature: JSON.stringify(ast.tokens.filter((token) => token.range[0] >= node.range[0] && token.range[1] <= node.range[1]).map((token) => [token.type, code.slice(token.range[0], token.range[1])])),
            }));
        };
        return { functions, exports, imports, statements };
    }
    const dashboardPath = path.resolve(dashboard);
    const beforeModules = new Map([[dashboardPath, module(baseFile ? fs.readFileSync(baseFile, 'utf8') : gitRead(dashboard), dashboardPath)]]);
    const afterModules = new Map([[dashboardPath, module(fs.readFileSync(dashboard, 'utf8'), dashboardPath)]]);
    for (const file of hookFiles) {
        const currentExists = fs.existsSync(file);
        const beforeExists = baselineHooks.has(file) ? fs.existsSync(baselineHooks.get(file)) : baseFile ? false : gitExists(file);
        if (created.has(file)) {
            if (beforeExists || baselineHooks.has(file)) throw new Error(`created hook exists at baseline: ${file}`);
            if (!currentExists) throw new Error(`created hook missing from current tree: ${file}`);
        } else if (!beforeExists) {
            throw new Error(`baseline hook missing: ${file}; mark --created-hook or supply --base-hook CURRENT_FILE=BASE_FILE`);
        }
        if (deleted.has(file)) {
            if (currentExists) throw new Error(`deleted hook still exists in current tree: ${file}`);
        } else if (!currentExists) {
            throw new Error(`current hook missing: ${file}; mark --deleted-hook`);
        }
        if (beforeExists) beforeModules.set(file, module(baselineHooks.has(file) ? fs.readFileSync(baselineHooks.get(file), 'utf8') : gitRead(file), file));
        if (currentExists) afterModules.set(file, module(fs.readFileSync(file, 'utf8'), file));
    }
    function collect(modules) {
        const appModule = modules.get(dashboardPath);
        const app = appModule.functions.get('App');
        if (!app) throw new Error('App() not found');
        const appStatements = appModule.statements(app).map(statement => ({ ...statement, owner: `${dashboardPath}:App` }));
        const bodies = new Map();
        const all = [...appStatements];
        for (const [file, owner] of modules) {
            const named = [...ownerFunctions.keys()].filter(key => key.startsWith(`${file}:`)).map(key => key.slice(file.length + 1));
            for (const name of named) if (!owner.functions.has(name)) throw new Error(`missing owner symbol ${file}#${name}`);
            if (file === dashboardPath && !named.length) continue;
            const hooks = [...owner.functions].filter(([name]) => file === dashboardPath ? name !== 'App' && named.includes(name) : /^use[A-Z]/.test(name) || named.includes(name));
            if (!hooks.length && !(file === dashboardPath && named.includes('App'))) throw new Error(`no hook function found in ${file}; name pure/component owners with --owner-function`);
            for (const [exported, name] of owner.exports) if (file !== dashboardPath && (created.has(file) || named.some(symbol => !/^use[A-Z]/.test(symbol))) && owner.functions.has(name) && !/^use[A-Z]/.test(name) && !named.includes(name)) throw new Error(`omitted exported owner function ${file}#${exported}`);
            for (const [name, fn] of hooks) {
                const body = owner.statements(fn).map(statement => ({ ...statement, owner: `${file}:${name}` }));
                bodies.set(`${file}:${name}`, body);
                all.push(...body);
            }
        }
        function lookup(file, name) {
            if (bodies.has(`${file}:${name}`)) return `${file}:${name}`;
            const imported = modules.get(file).imports.get(name);
            if (!imported) return null;
            const base = path.resolve(path.dirname(file), imported.spec);
            const resolved = [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`].find((candidate) => modules.has(candidate));
            if (!resolved) return null; // Unchanged hooks outside the named ownership set stay opaque on BOTH sides.
            const owner = modules.get(resolved);
            const target = owner.exports.get(imported.exported) ?? imported.exported;
            return bodies.has(`${resolved}:${target}`) ? `${resolved}:${target}` : null;
        }
        const calls = (node) => {
            if (node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression') return [node.expression];
            if (node.type === 'VariableDeclaration') return node.declarations.map((d) => d.init).filter((init) => init?.type === 'CallExpression');
            return [];
        };
        const effectName = (callee) => callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' && !callee.computed && callee.object.name === 'React' ? callee.property.name : '';
        function effects(list, stack = []) {
            return list.flatMap((statement) => calls(statement.node).flatMap((call) => {
                if (/^use(Layout)?Effect$/.test(effectName(call.callee))) return [statement];
                if (call.callee.type !== 'Identifier') return [];
                const key = lookup(statement.file, call.callee.name);
                if (!key || !/^use[A-Z]/.test(key.slice(key.lastIndexOf(':') + 1))) return [];
                if (stack.includes(key)) throw new Error(`recursive hook call: ${key}`);
                return effects(bodies.get(key), [...stack, key]);
            }));
        }
        const lifecycles = new Map([[`${dashboardPath}:App`, effects(appStatements)]]);
        for (const [key, body] of bodies) if (!/^use[A-Z]/.test(key.slice(key.lastIndexOf(':') + 1))) lifecycles.set(key, effects(body));
        const occurrences = new Map();
        for (const [key, body] of [[`${dashboardPath}:App`, appStatements], ...bodies]) occurrences.set(key, body.flatMap(statement => calls(statement.node).some(call => /^use(Layout)?Effect$/.test(effectName(call.callee))) ? [statement] : []));
        return { all, lifecycles, occurrences };
    }
    const before = collect(beforeModules);
    const after = collect(afterModules);
    const tally = (list) => {
        const counts = new Map();
        for (const s of list) counts.set(s.signature, (counts.get(s.signature) ?? 0) + 1);
        return counts;
    };
    const unmatched = (list, otherCounts) => {
        const seen = new Map();
        return list.filter((s) => {
            const n = (seen.get(s.signature) ?? 0) + 1;
            seen.set(s.signature, n);
            return n > (otherCounts.get(s.signature) ?? 0);
        });
    };
    const removed = unmatched(before.all, tally(after.all));
    const added = unmatched(after.all, tally(before.all));
    console.log(`App + named hook statements before: ${before.all.length}; after: ${after.all.length}`);
    console.log(`removed and not found in a hook: ${removed.length}; new statements: ${added.length}`);
    removed.forEach((s) => console.log(`- (base ${path.relative(process.cwd(), s.file)} line ${s.line})\n${s.text}`));
    added.forEach((s) => console.log(`+ (${path.relative(process.cwd(), s.file)} line ${s.line})\n${s.text}`));
    const digest = statement => crypto.createHash('sha256').update(statement.signature).digest('hex');
    const approvedBefore = new Set(), approvedAfter = new Set();
    for (const allowance of allowances) {
        const matching = (snapshot, key) => (snapshot.occurrences.get(key) ?? []).filter(statement => digest(statement) === allowance.digest);
        const sourceBefore = matching(before, allowance.from), sourceAfter = matching(after, allowance.from);
        const targetBefore = matching(before, allowance.to), targetAfter = matching(after, allowance.to);
        if (sourceBefore.length !== 1 || sourceAfter.length !== 0 || targetBefore.length !== 0 || targetAfter.length !== 1 || sourceBefore[0].signature !== targetAfter[0].signature) throw new Error(`invalid effect relocation: ${allowance.value}; expected source 1->0 and destination 0->1 unchanged`);
        if (approvedBefore.has(sourceBefore[0]) || approvedAfter.has(targetAfter[0])) throw new Error(`effect relocation occurrence reused: ${allowance.value}`);
        approvedBefore.add(sourceBefore[0]); approvedAfter.add(targetAfter[0]);
        console.log(`approved effect relocation: ${allowance.value}`);
    }
    let identical = true;
    for (const key of new Set([...before.lifecycles.keys(), ...after.lifecycles.keys()])) {
        const prior = (before.lifecycles.get(key) ?? []).filter(statement => !approvedBefore.has(statement));
        const next = (after.lifecycles.get(key) ?? []).filter(statement => !approvedAfter.has(statement));
        let diverge = -1;
        for (let i = 0; i < Math.max(prior.length, next.length); i += 1) if (prior[i]?.signature !== next[i]?.signature) { diverge = i; break; }
        if (diverge !== -1) {
            identical = false;
            console.log(`effect order: DIFFERS at effect ${diverge + 1} in ${key} (before ${prior.length}, after ${next.length})`);
            console.log(`  before: ${prior[diverge]?.text ?? '(none)'}`);
            console.log(`  after: ${next[diverge]?.text ?? '(none)'}`);
            process.exitCode = 1;
        }
    }
    if (identical) console.log(`effect order: identical (${before.lifecycles.get(`${dashboardPath}:App`).filter(statement => !approvedBefore.has(statement)).length} top-level effects)`);

} catch (error) {
    console.error(error.message);
    process.exitCode = 2;
}
