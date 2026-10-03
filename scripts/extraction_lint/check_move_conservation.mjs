// Compare App() plus all named owner-hook bodies at BOTH revisions. Full residual statements need
// human review; only effect-order divergence determines exit 1. Parse/coverage errors exit 2.
// Git: --base REF [--created-hook FILE] [--deleted-hook FILE] EXISTING_HOOK_FILES...
// Scratch: --base-file DASHBOARD --dashboard DASHBOARD --base-hook CURRENT_FILE=BASE_FILE ...
// Newly created/deleted files must be explicit; hook paths form the same union on both sides.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as espree from 'espree';

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
    if (args.some((arg) => arg.startsWith('--'))) throw new Error(`unknown option: ${args.find((arg) => arg.startsWith('--'))}`);
    const hookFiles = [...new Set([...args.map((file) => path.resolve(file)), ...created, ...deleted, ...baselineHooks.keys()])];
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
        const imports = new Map();
        for (const node of ast.body) {
            if (node.type === 'ImportDeclaration' && node.source.value.startsWith('.')) {
                for (const specifier of node.specifiers) imports.set(specifier.local.name, { spec: node.source.value, exported: specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported?.name });
            }
            const decl = /^Export(Named|Default)Declaration$/.test(node.type) ? node.declaration : node;
            if (!decl) continue;
            if (decl.type === 'FunctionDeclaration' && decl.id) functions.set(decl.id.name, decl);
            if (decl.type === 'VariableDeclaration') for (const d of decl.declarations) if (d.id.type === 'Identifier' && /Function/.test(d.init?.type)) functions.set(d.id.name, d.init);
            if (node.type === 'ExportDefaultDeclaration') exports.set('default', decl.type === 'Identifier' ? decl.name : decl.id?.name);
            if (node.type === 'ExportNamedDeclaration' && !node.source) for (const specifier of node.specifiers) exports.set(specifier.exported.name, specifier.local.name);
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
        const appStatements = appModule.statements(app);
        const bodies = new Map();
        const all = [...appStatements];
        for (const [file, owner] of modules) {
            if (file === dashboardPath) continue;
            const hooks = [...owner.functions].filter(([name]) => /^use[A-Z]/.test(name));
            if (!hooks.length) throw new Error(`no hook function found in ${file}`);
            for (const [name, fn] of hooks) {
                const body = owner.statements(fn);
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
                if (!key) return [];
                if (stack.includes(key)) throw new Error(`recursive hook call: ${key}`);
                return effects(bodies.get(key), [...stack, key]);
            }));
        }
        return { all, effects: effects(appStatements) };
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
    let diverge = -1;
    for (let i = 0; i < Math.max(before.effects.length, after.effects.length); i += 1) {
        if (before.effects[i]?.signature !== after.effects[i]?.signature) { diverge = i; break; }
    }
    if (diverge === -1) console.log(`effect order: identical (${before.effects.length} top-level effects)`);
    else {
        console.log(`effect order: DIFFERS at effect ${diverge + 1} (before ${before.effects.length}, after ${after.effects.length})`);
        console.log(`  before: ${before.effects[diverge]?.text ?? '(none)'}`);
        console.log(`  after: ${after.effects[diverge]?.text ?? '(none)'}`);
        process.exitCode = 1;
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 2;
}
