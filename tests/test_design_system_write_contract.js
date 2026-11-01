const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const registryDocument = fs.readFileSync(path.join(root, 'docs/design-system.md'), 'utf8');
const blocks = [...registryDocument.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
assert.equal(blocks.length, 1, 'The design map has exactly one JSON registry');
const registry = JSON.parse(blocks[0][1]);
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const normalizedSources = new Map();
const normalize = source => {
    if (!normalizedSources.has(source)) {
        const stripped = esbuild.transformSync(source, { loader: 'jsx', target: 'esnext', legalComments: 'none', minifyWhitespace: true }).code;
        normalizedSources.set(source, esbuild.transformSync(stripped, { loader: 'js', target: 'esnext', legalComments: 'none' }).code);
    }
    return normalizedSources.get(source);
};
const compact = source => source.replace(/\s+/g, '').replace(/,}/g, '}');
const filesUnder = directory => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(file) : /\.(js|jsx|mjs)$/.test(file) ? [file] : [];
});

// esbuild removes comments and parses JSX first. Balance strings and nested braces in its
// output rather than truncating at a nested JSX prop or a callback body.
function balanced(source, start, open = '{', close = '}') {
    let depth = 0;
    let quote = '';
    for (let index = start; index < source.length; index += 1) {
        const char = source[index];
        if (quote) {
            if (char === '\\') index += 1;
            else if (char === quote) quote = '';
            continue;
        }
        if (['"', "'", '`'].includes(char)) { quote = char; continue; }
        if (char === open) depth += 1;
        if (char === close && --depth === 0) return source.slice(start, index + 1);
    }
    throw new Error('Unbalanced contract source');
}

function elementProps(source, symbol) {
    const code = normalize(source);
    const expression = new RegExp(`(?:React\\.)?createElement\\(\\s*${symbol},\\s*`, 'g');
    return [...code.matchAll(expression)].map(match => {
        const start = match.index + match[0].length;
        assert.equal(code[start], '{', `${symbol} props must be explicit, not a variable/spread-only adapter`);
        return balanced(code, start);
    });
}

function moduleTarget(file, relative) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), relative));
    const candidates = [target, ...['.js', '.jsx', '.mjs', '/index.js', '/index.jsx', '/index.mjs'].map(extension => target + extension)];
    const registered = [...registry.apiEffects, ...registry.hooks, ...registry.components, registry.statusPill];
    return candidates.find(candidate => registered.some(entry => entry.path === candidate)) || target;
}

function directWriterReferencePolicy(code, symbol) {
    const references = [...code.matchAll(new RegExp(`\\b${symbol}\\b`, 'g'))];
    assert.equal(references.length, 1, `${symbol}: exactly one registered writer reference; alias/repeated dispatch forbidden`);
    const reference = references[0];
    assert.match(code.slice(reference.index + symbol.length), /^\s*\(/, `${symbol}: writer must be dispatched directly, never aliased`);
    assert.doesNotMatch(code.slice(0, reference.index), /\.\s*$/, `${symbol}: registered direct dispatch only`);
}

function writerReferencePolicy(file, source) {
    let code = normalize(source).replace(/import\s+[\s\S]*?\s+from\s+["'][^"']+["'];/g, '');
    for (const entry of registry.apiEffects.filter(entry => entry.effect === 'jira-write' && entry.owners.includes(file))) {
        if (entry.symbol === registry.editors.api) {
            const seam = 'const updateField = options.updateField || updateIssueField;';
            assert.equal(code.split(seam).length - 1, 1, 'Controller retains its one documented test seam');
            code = code.replace(seam, '');
            assert.doesNotMatch(code, /\bupdateIssueField\b/, 'Field API references are confined to the documented controller seam');
            directWriterReferencePolicy(code, 'updateField');
        } else directWriterReferencePolicy(code, entry.symbol);
    }
}

function importPolicy(file, source) {
    const code = normalize(source);
    const classifiedPaths = new Set(registry.apiEffects.map(entry => entry.path));
    const importedPresentations = new Set();
    const importedHooks = new Set();
    for (const match of code.matchAll(/(?:import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];/g)) {
        const target = moduleTarget(file, match[2]);
        if (registry.components.some(entry => entry.path === target) || target === registry.statusPill.path) {
            assert.doesNotMatch(match[1], /\bas\b|\*/, `${file}: presentational alias/namespace bypass`);
            const symbol = registry.components.find(entry => entry.path === target)?.symbol || registry.statusPill.symbol;
            assert.equal(match[1].trim(), symbol, `${file}: presentational alias bypass; imports retain canonical symbols`);
            importedPresentations.add(symbol);
        }
    }
    for (const match of code.matchAll(/(?:import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];/g)) {
        const [, specifiers, relative] = match;
        const target = moduleTarget(file, relative);
        if (!classifiedPaths.has(target) && !registry.hooks.some(hook => hook.path === target)) continue;
        assert.ok(!specifiers.includes('*'), `${file}: namespace/re-export bypass for ${target}`);
        assert.match(specifiers.trim(), /^\{[\s\S]*\}$/, `${file}: only named classified imports allowed`);
        for (const item of specifiers.replace(/[{}]/g, '').split(',').map(value => value.trim()).filter(Boolean)) {
            const [symbol, alias] = item.split(/\s+as\s+/);
            const effect = registry.apiEffects.find(entry => entry.path === target && entry.symbol === symbol);
            const hook = registry.hooks.find(entry => entry.path === target && entry.symbol === symbol);
            if (effect) {
                assert.ok(effect.owners.includes(file), `${file}: ${symbol} is owned by ${effect.owners.join(', ')}`);
                assert.ok(!alias || (effect.effect === 'read' && effect.aliases?.[file] === alias), `${file}: unregistered API alias bypass`);
            } else if (hook) {
                assert.equal(file, hook.host, `${symbol} may be imported only by its registered host`);
                assert.ok(!alias, `${symbol}: hook alias bypass`);
                importedHooks.add(symbol);
            } else {
                // A helper export does not confer permission to import the writer module elsewhere.
                assert.ok(registry.hooks.some(entry => entry.path === target && entry.host === file), `${file}: unregistered import ${symbol}`);
            }
        }
        assert.ok(match[0].trim().startsWith('import'), `${file}: re-export bypass`);
    }
    const localCode = code.replace(/import\s+[\s\S]*?\s+from\s+["'][^"']+["'];/g, '');
    for (const symbol of importedHooks) directWriterReferencePolicy(localCode, symbol);
    for (const symbol of importedPresentations) {
        // JSX has already become canonical createElement calls. Every other reference
        // can transfer the component to an alias and hide its props from the site guards.
        const withoutElements = localCode.replace(new RegExp(`(?:React\\.)?createElement\\(\\s*${symbol},\\s*`, 'g'), 'registeredElement(');
        assert.doesNotMatch(withoutElements, new RegExp(`\\b${symbol}\\b`), `${file}: ${symbol} local alias/reference bypass; registered JSX only`);
    }
    assert.doesNotMatch(code, /(?:import\s*\(|require\s*\()[^;\n]*(?:jiraIssueApi|capacityApi|useEng(?:StatusTransitions|PriorityTransitions|ProjectTrackTransitions|IssueFieldEdits))/, `${file}: dynamic import bypass`);
    if (file !== 'frontend/src/components/lazyViewLoaders.js') assert.doesNotMatch(code, /(?:import|require)\s*\(\s*(?!["'])/, `${file}: nonliteral dynamic import bypass`);
    assert.doesNotMatch(code, /(?:import|require)\s*\(\s*["'][^"']*["']\s*\+/, `${file}: computed dynamic import bypass`);
    for (const match of code.matchAll(/(?:import|require)\s*\(\s*["']([^"']+)["']/g)) {
        const target = moduleTarget(file, match[1]);
        assert.ok(![...registry.apiEffects, ...registry.hooks, ...registry.components, registry.statusPill].some(entry => entry.path === target), `${file}: registered module dynamic import bypass`);
    }
    if (file !== 'frontend/src/eng/useEngIssueFieldEdits.js') {
        assert.doesNotMatch(code, /\bupdateField\b|["']updateField["']|createEngIssueFieldEditController/, `${file}: production writer injection is forbidden`);
        for (const match of code.matchAll(/\buseEngIssueFieldEdits\s*\(/g)) {
            const start = match.index + match[0].length;
            const args = code.slice(start).trimStart();
            assert.equal(args[0], '{', `${file}: field hook injection options must be explicit`);
            const options = balanced(args, 0);
            assert.doesNotMatch(options, /\.\.\.|(?:^|[,{])\s*\[/, `${file}: field hook injection options cannot contain spreads/computed keys`);
        }
    }
    writerReferencePolicy(file, source);
    return code;
}

function presentationalPolicy(file, source) {
    const code = normalize(source);
    assert.doesNotMatch(code, /from\s+["'][^"']*(?:\/api\/|useEng(?:StatusTransitions|PriorityTransitions|ProjectTrackTransitions|IssueFieldEdits))/, `${file}: presentational imports`);
    assert.doesNotMatch(code, /\b(?:fetch|trackedFetch|apiFetch)\s*\(/, `${file}: presentational components cannot dispatch transport`);
}

function statusSitePolicy(file, source, site) {
    const elements = elementProps(source, 'StatusTransitionMenu');
    assert.equal(elements.length, site?.issues.length || 0, `${file}: status site count`);
    elements.forEach((props, index) => {
        assert.doesNotMatch(props, /\.\.\./, `${file}: status props cannot hide a handler or issue`);
        assert.match(props, new RegExp(`\\bonSubmit:\\s*${site.handler}\\s*[,}]`), `${file}: status handler must be bare`);
        const issueMatch = props.match(/\bissue:\s*/);
        assert.ok(issueMatch, `${file}: missing own issue prop`);
        const start = issueMatch.index + issueMatch[0].length;
        const issue = props[start] === '{' ? balanced(props, start) : props.slice(start).match(/^[\w.]+/)[0];
        assert.equal(compact(issue), compact(site.issues[index]), `${file}: wrong displayed issue binding`);
    });
}

function passivePillPolicy(file, source) {
    elementProps(source, 'StatusPill').forEach(props => {
        assert.doesNotMatch(props, /\.\.\./, `${file}: StatusPill props spread can hide a writer`);
        const handlers = [...props.matchAll(/\b(on[A-Z]\w*)\s*:/g)].map(match => match[1]);
        if (file === registry.statusPill.interactiveOwner) {
            assert.deepEqual(handlers.sort(), [...registry.statusPill.handlers].sort(), 'Interactive pill handlers are explicitly registered');
        } else {
            assert.deepEqual(handlers, [], `${file}: passive StatusPill cannot receive event handlers`);
            assert.doesNotMatch(props, /interactive:\s*true/, `${file}: passive StatusPill cannot become interactive`);
        }
    });
}

function callbackBody(source, symbol) {
    const code = normalize(source);
    const match = code.match(new RegExp(`(?:const|let) ${symbol} = (?:React\\.)?useCallback\\((?:async )?\\([^)]*\\) => \\{`));
    assert.ok(match, `${symbol} callback exists`);
    return balanced(code, match.index + match[0].length - 1);
}

function statusHandlerPolicy(source) {
    const body = callbackBody(source, registry.status.handler);
    assert.doesNotMatch(body, /\b(?:for|while)\s*\(|\.(?:map|flatMap|forEach|reduce)\s*\(|\b(?:selectedTasks|selectedStories|children|childTasks|tasks|stories)\b/, 'Status handler cannot widen an Epic into children or selection');
    const calls = [...body.matchAll(/submitStatusTransition\(([^)]*)\)/g)];
    assert.equal(calls.length, 1, 'App has one own-key path for every surface');
    // An optional trailing `options` (the Board panel's onSettled) may follow; the key stays `issue.key` alone.
    calls.forEach(call => assert.ok(['targetStatus,issue.key', 'targetStatus,issue.key,options'].includes(compact(call[1])), 'App forwards displayed issue key only'));
}

function singletonWriterPolicy(source, api, property, key) {
    const code = normalize(source);
    const match = code.match(new RegExp(`\\b${api}\\(backendUrl,\\s*\\{`));
    assert.ok(match, `${api} direct mutation exists`);
    const payload = balanced(code, match.index + match[0].length - 1);
    assert.match(payload, new RegExp(`\\b${property}:\\s*${property === 'issueKeys' ? `\\[${key}\\]` : key}\\s*[,}]`), `${api}: own-key payload only`);
    assert.doesNotMatch(payload, /\.\.\.|\.(?:map|flatMap|filter|reduce)\s*\(/, `${api}: no target iteration/spread`);
}

function apiExports(source) {
    const result = esbuild.buildSync({ stdin: { contents: source, loader: 'js', resolveDir: root }, write: false, format: 'esm', metafile: true, logLevel: 'silent' });
    return Object.values(result.metafile.outputs).flatMap(output => output.exports);
}

function mutationTargetPolicy(source, kind) {
    const hook = { status: 'useEngStatusTransitions', priority: 'useEngPriorityTransitions', track: 'useEngProjectTrackTransitions', field: 'useEngIssueFieldEdits' }[kind];
    writerReferencePolicy(`frontend/src/eng/${hook}.js`, source);
    const code = normalize(source);
    if (kind === 'field') {
        assert.match(code, /issueKey: normalizedIssueKey\(descriptor\?\.issueKey\)/, 'Editor identity comes only from its open descriptor');
        assert.equal([...code.matchAll(/\bupdateField\(/g)].length, 1, 'One controller field dispatch');
        const match = code.match(/const submit = async \(value\) => \{/);
        assert.ok(match);
        const body = balanced(code, match.index + match[0].length - 1);
        assert.match(body, /const editor = state\.activeEditor;/);
        assert.doesNotMatch(body, /editor\.issueKey\s*=|\b(?:for|while)\s*\(|\.(?:map|flatMap|forEach|reduce)\s*\(/, 'Field target cannot widen or repeat dispatch');
        return;
    }
    const definitions = {
        status: ['submitStatusTransition', 'transitionIssues', 'explicitTargetKey'],
        priority: ['submitPriorityChange', 'updateIssuePriorities', 'issueKey'],
        track: ['submitProjectTrackChange', 'updateIssueProjectTrack', 'epicKey'],
    };
    const [handler, api, input] = definitions[kind];
    const body = callbackBody(source, handler);
    assert.equal([...body.matchAll(new RegExp(`\\b${api}\\(`, 'g'))].length, 1, 'One issue mutation dispatch');
    const prefix = body.slice(0, body.indexOf('const response ='));
    assert.ok(prefix.includes('const runMutation ='), 'Dispatch boundary exists');
    const key = kind === 'status' ? 'explicitKey' : 'key';
    assert.match(prefix, new RegExp(`const ${key} = String\\(${input} \\|\\| ""\\)\\.trim\\(\\);`), 'Own key is derived only from explicit input');
    assert.equal([...prefix.matchAll(new RegExp(`(?<![.\\w])${key}\\s*=(?![=>])`, 'g'))].length, 1, 'Own-key alias cannot be reassigned');
    if (kind === 'status') {
        assert.match(prefix, /const singleIssueTarget = targets\[0\];/);
        assert.match(prefix, /const singleIssueKey = singleIssueTarget\.key;/);
        assert.equal([...prefix.matchAll(/(?<![.\w])singleIssueKey\s*=(?![=>])/g)].length, 1, 'Status key cannot be reassigned');
        const targets = prefix.slice(prefix.indexOf('const targets ='), prefix.indexOf('const analyticsBaseParams'));
        assert.equal(compact(targets), 'consttargets=[activeSingleIssueTarget&&activeSingleIssueTarget.key===explicitKey?activeSingleIssueTarget:{key:explicitKey,issueType:"",currentStatus:"",summary:""}];', 'Status target is exactly the own-key singleton');
    }
    // Option reads, queue cancellation and confirmed-result cache invalidation may iterate.
    // In the dispatch prefix only the existing singleton projection is allowed to iterate.
    const dispatch = prefix.replace(/targets\.map\(\(target\) => target\.key\)/g, 'ownKeyProjection');
    assert.doesNotMatch(dispatch, /\b(?:for|while)\s*\(|\.(?:map|flatMap|forEach|reduce)\s*\(|\b(?:selectedTasks|selectedStories|children|childTasks)\b/, 'Mutation construction cannot widen or repeat the write');
}

function siblingSitePolicy(file, source, binding) {
    const elements = elementProps(source, binding.symbol);
    const sites = binding.callSites.filter(site => site.path === file);
    assert.equal(elements.length, sites.length, `${binding.symbol}: registered call-site count`);
    elements.forEach((props, index) => {
        const site = sites[index];
        assert.doesNotMatch(props, /\.\.\./, 'Menu props cannot hide ownership');
        assert.ok(compact(props).includes(`onSubmit:${site.handler},`) || compact(props).endsWith(`onSubmit:${site.handler}}`), `${binding.symbol}: bare handler`);
        if (site.key) assert.ok(compact(props).includes(`epicKey:${site.key},`) || (site.key === 'epicKey' && /\bepicKey\s*[,}]/.test(props)), 'Project Track receives displayed Epic key');
        else {
            const match = props.match(/\bissue:\s*/);
            if (!match) { assert.equal(site.issue, 'issue'); assert.match(props, /\bissue\s*[,}]/); return; }
            const start = match.index + match[0].length;
            const issue = props[start] === '{' ? balanced(props, start) : props.slice(start).match(/^[\w.]+/)[0];
            assert.equal(compact(issue), compact(site.issue), 'Priority receives displayed issue');
        }
    });
}

const productionFiles = filesUnder('frontend/src');
const sources = new Map(productionFiles.map(file => [file, read(file)]));

test('registry paths, symbols and all Jira issue/capacity API exports resolve by effect', () => {
    assert.equal(registry.hooks.length, 4);
    for (const entry of [...registry.hooks, ...registry.components, ...registry.apiEffects, registry.boardDrop, registry.capacity, registry.statusPill, ...registry.exemptions]) {
        assert.ok(fs.existsSync(path.join(root, entry.path)), entry.path);
        if (entry.symbol) assert.match(normalize(read(entry.path)), new RegExp(`\\b${entry.symbol}\\b`), `${entry.path}: ${entry.symbol}`);
    }
    for (const file of new Set(registry.apiEffects.map(entry => entry.path))) {
        const exports = apiExports(read(file));
        const entries = registry.apiEffects.filter(entry => entry.path === file);
        assert.deepEqual(exports.sort(), entries.map(entry => entry.symbol).sort(), `${file}: unclassified or stale export`);
        entries.forEach(entry => assert.ok(['read', 'jira-write'].includes(entry.effect), 'Known API effects only'));
    }
    assert.equal(new Set(registry.classHooks).size, registry.classHooks.length);
    assert.ok(registry.classHooks.length > 0);
    registry.exemptions.forEach(entry => assert.ok(entry.reason.length > 30, 'Storage exemptions need a reason'));
    assert.deepEqual(registry.classHookMap.map(entry => entry.class), registry.classHooks);
    registry.classHookMap.forEach(entry => entry.paths.forEach(file => { assert.ok(fs.existsSync(path.join(root, file))); assert.ok(read(file).includes(`.${entry.class}`), `${entry.class}: stylesheet symbol resolves`); }));
});

test('production imports obey API owners, hook hosts and presentational boundaries', () => {
    for (const [file, source] of sources) importPolicy(file, source);
    for (const component of registry.components) {
        presentationalPolicy(component.path, read(component.path));
    }
    assert.match(read('frontend/src/eng/useEngIssueFieldEdits.js'), /const updateField = options\.updateField \|\| updateIssueField;/, 'Controller test seam remains available');
});

test('four mutation hooks each have exactly one production call in App', () => {
    for (const hook of registry.hooks) {
        let calls = 0;
        for (const [file, source] of sources) {
            const code = normalize(source).replace(new RegExp(`function ${hook.symbol}\\s*\\(`, 'g'), 'function declaredHook(');
            const found = [...code.matchAll(new RegExp(`\\b${hook.symbol}\\s*\\(`, 'g'))].length;
            if (found) assert.equal(file, hook.host, `${hook.symbol}: host mismatch`);
            calls += found;
        }
        assert.equal(calls, hook.calls, `${hook.symbol}: registered host count`);
        assert.match(normalize(read(hook.host)), new RegExp(`function ${hook.hostSymbol}\\(`));
    }
});

test('six status sites use bare handlers and preserve the exact displayed issue', () => {
    assert.equal(registry.status.callSites.reduce((sum, site) => sum + site.issues.length, 0), 6);
    for (const [file, source] of sources) statusSitePolicy(file, source, registry.status.callSites.find(site => site.path === file));
    assert.ok(compact(normalize(read(registry.status.component))).includes(compact(registry.status.forward)), 'Menu forwards its own issue, never active target/children');
    statusHandlerPolicy(read(registry.status.handlerPath));
    assert.ok(compact(normalize(read(registry.boardDrop.path))).includes(compact(registry.boardDrop.forward)), 'Board drop retains dragged Epic own-key handoff');
});

test('mutation payloads and editor/capacity adapters retain singleton own-key targets', () => {
    for (const [kind, hook] of [['status', 'useEngStatusTransitions'], ['priority', 'useEngPriorityTransitions'], ['track', 'useEngProjectTrackTransitions'], ['field', 'useEngIssueFieldEdits']]) mutationTargetPolicy(read(`frontend/src/eng/${hook}.js`), kind);
    for (const binding of registry.bindings) for (const [file, source] of sources) siblingSitePolicy(file, source, binding);
    const statusSource = read('frontend/src/eng/useEngStatusTransitions.js');
    const statusCode = normalize(statusSource);
    assert.equal([...statusCode.matchAll(/\btransitionIssues\(/g)].length, 1, 'The status hook keeps one transitionIssues( call');
    assert.match(statusCode, /issueKeys: targets\.map\(\(target\) => target\.key\)/);
    singletonWriterPolicy(read('frontend/src/eng/useEngPriorityTransitions.js'), 'updateIssuePriorities', 'issueKeys', 'key');
    singletonWriterPolicy(read('frontend/src/eng/useEngProjectTrackTransitions.js'), 'updateIssueProjectTrack', 'issueKey', 'key');
    const status = callbackBody(read('frontend/src/eng/useEngStatusTransitions.js'), 'submitStatusTransition');
    assert.match(status, /typeof explicitTargetKey !== "string"/);
    assert.match(status, /const explicitKey = String\(explicitTargetKey \|\| ""\)\.trim\(\)/);
    const start = status.indexOf('const targets =');
    const end = status.indexOf('const analyticsBaseParams');
    const targets = status.slice(start, end);
    assert.match(targets, /const targets = \[/);
    assert.doesNotMatch(targets, /\.\.\.|\.(?:map|flatMap|forEach|reduce)\s*\(|selected|children|stories|tasks/);
    assert.match(targets, /key: explicitKey/);
    for (const binding of registry.bindings) assert.ok(compact(normalize(read(binding.component))).includes(compact(binding.forward)), `${binding.symbol}: own-key forwarding`);
    for (const site of registry.editors.openSites) {
        const code = compact(normalize(read(site.path)));
        assert.ok(code.includes(`openEditor({issueKey:${site.key},`), `${site.path}: editor opens its displayed key`);
    }
    const editor = compact(normalize(read('frontend/src/eng/useEngIssueFieldEdits.js')));
    assert.ok(editor.includes('enqueueMutation([editor.issueKey],'));
    assert.ok(editor.includes('updateField(frozen.backendUrl,editor.issueKey,'));
    assert.ok(compact(normalize(read(registry.capacity.path))).includes('updateCapacityRequest(candidate.issueKey,'));
    assert.ok(compact(normalize(read(registry.capacity.host))).includes('updateCapacity(BACKEND_URL,issueKey,payload,options)'));
});

test('StatusPill event handlers are restricted to its registered menu', () => {
    for (const [file, source] of sources) passivePillPolicy(file, source);
});

test('adversarial imports and production injected writers fail while comments do not grant authority', () => {
    const intruder = 'frontend/src/issues/Intruder.jsx';
    for (const source of [
        "import { transitionIssues as mutate } from '../api/jiraIssueApi.js'; mutate();",
        "import * as api from '../api/jiraIssueApi.js'; api.transitionIssues();",
        "const api = await import('../api/jiraIssueApi.js'); api.transitionIssues();",
        "const api = require('../api/jiraIssueApi.js'); api['transitionIssues']();",
        "const modulePath = '../api/jiraIssueApi.js'; const api = await import(modulePath);",
        "const api = await import('../api/' + 'jiraIssueApi.js');",
        "import Pill from '../ui/StatusPill.jsx'; <Pill onClick={write} />;",
        "import Menu from './StatusTransitionMenu.jsx'; <Menu onSubmit={write} />;",
        "export { transitionIssues } from '../api/jiraIssueApi.js';",
        "import { useEngStatusTransitions as hook } from '../eng/useEngStatusTransitions.js'; hook({});",
        "useEngIssueFieldEdits({ updateField: injectedWriter });",
        "const options = { ['updateField']: injectedWriter }; useEngIssueFieldEdits(options);",
        "useEngIssueFieldEdits({ ['update' + 'Field']: injectedWriter });",
        "useEngIssueFieldEdits({ ...hiddenWriter });",
        "const { default: Pill } = await import('../ui/StatusPill.jsx'); <Pill onClick={write} interactive />;",
        "const { default: Menu } = require('./StatusTransitionMenu.jsx'); <Menu onSubmit={write} />;",
        "const { default: Menu } = await import('./StatusTransitionMenu.jsx'); <Menu onSubmit={write} />;",
        "import { transitionIssues } from '../api/jiraIssueApi'; transitionIssues();",
        "import * as api from '../api/jiraIssueApi'; api.transitionIssues();",
        "import Pill from '../ui/StatusPill'; <Pill onClick={write} />;",
        "const { default: Pill } = await import('../ui/StatusPill'); <Pill onClick={write} />;",
    ]) assert.throws(() => importPolicy(intruder, source), /bypass|owned|registered|host|injection|alias/);
    assert.doesNotThrow(() => importPolicy(intruder, '// transitionIssues updateField\nexport const display = 1;'));
});

test('adversarial Epic child/selection closures and bare-handler widening fail', () => {
    const site = registry.status.callSites.find(entry => entry.path.endsWith('EpicBlock.jsx'));
    const issue = site.issues[0];
    for (const handler of [
        'targetStatus => handleSubmitStatusTransition(targetStatus, epicGroup.children)',
        'targetStatus => epicGroup.children.forEach(child => handleSubmitStatusTransition(targetStatus, child))',
        'targetStatus => handleSubmitStatusTransition(targetStatus, selectedTasks)',
    ]) assert.throws(() => statusSitePolicy(site.path, `<StatusTransitionMenu issue={${issue}} onSubmit={${handler}} />`, site), /bare/);
    const original = read(registry.status.handlerPath);
    const forwarded = 'submitStatusTransition(targetStatus, issue.key, options)';
    assert.ok(original.includes(forwarded));
    assert.doesNotThrow(() => statusHandlerPolicy(original));
    assert.doesNotThrow(() => statusHandlerPolicy(original.replace(forwarded, 'submitStatusTransition(targetStatus, issue.key)')));
    for (const widened of [
        'submitStatusTransition(targetStatus, issue.children.map(child => child.key))',
        'submitStatusTransition(targetStatus, issue.key, selectedKeys)',
        'submitStatusTransition(targetStatus, issue.key, options, issue.children)',
        'submitStatusTransition(targetStatus, selectedKey, options)',
    ]) assert.throws(() => statusHandlerPolicy(original.replace(forwarded, widened)), /widen|key/);
    assert.throws(() => singletonWriterPolicy("transitionIssues(backendUrl, { issueKeys: epic.children.map(child => child.key), targetStatus: 'Done' });", 'transitionIssues', 'issueKeys', 'singleIssueKey'), /own-key/);
    assert.throws(() => singletonWriterPolicy("transitionIssues(backendUrl, { issueKeys: [singleIssueKey, ...selectedKeys] });", 'transitionIssues', 'issueKeys', 'singleIssueKey'), /own-key|iteration/);
    assert.doesNotThrow(() => singletonWriterPolicy("const options = rows.map(row => row.option); queue.forEach(job => job.abort()); transitionIssues(backendUrl, { issueKeys: [singleIssueKey] });", 'transitionIssues', 'issueKeys', 'singleIssueKey'));
});

test('adversarial passive-pills and hidden status props fail', () => {
    for (const source of ['<StatusPill onClick={write} />', '<StatusPill {...hidden} />', '<StatusPill onPointerDown={write} />', '<StatusPill interactive />']) {
        assert.throws(() => passivePillPolicy('frontend/src/epm/Passive.jsx', source), /passive|spread/);
    }
    const site = registry.status.callSites[0];
    assert.throws(() => statusSitePolicy(site.path, '<><StatusTransitionMenu {...hidden} /><StatusTransitionMenu {...hidden} /></>', site), /hide/);
});


test('adversarial hook aliases and repeated dispatch fail without banning option iteration', () => {
    for (const [kind, hook, originalKey, widenedKey] of [
        ['status', 'useEngStatusTransitions', 'const singleIssueKey = singleIssueTarget.key;', 'const singleIssueKey = epic.children.map(child => child.key);'],
        ['priority', 'useEngPriorityTransitions', "const key = String(issueKey || '').trim();", 'const key = selectedStories.map(story => story.key);'],
        ['track', 'useEngProjectTrackTransitions', "const key = String(epicKey || '').trim();", 'const key = epic.children.map(story => story.key);'],
        ['field', 'useEngIssueFieldEdits', 'const editor = state.activeEditor;', 'const editor = selectedStories[0];'],
    ]) {
        const source = read(`frontend/src/eng/${hook}.js`);
        assert.ok(source.includes(originalKey), `${hook}: adversarial insertion point`);
        assert.throws(() => mutationTargetPolicy(source.replaceAll(originalKey, widenedKey), kind), /key|target|editor|Editor/);
    }
    const source = read('frontend/src/eng/useEngPriorityTransitions.js');
    assert.throws(() => mutationTargetPolicy(source.replace('return updateIssuePriorities(backendUrl, {', 'for (const child of epic.children) updateIssuePriorities(backendUrl, { issueKeys: [child.key] }); return updateIssuePriorities(backendUrl, {'), 'priority'), /dispatch/);
    assert.doesNotThrow(() => mutationTargetPolicy(source, 'priority'));
});

test('local writer references cannot alias, escape or add a second dispatch', () => {
    for (const [kind, hook, api] of [
        ['status', 'useEngStatusTransitions', 'transitionIssues'],
        ['priority', 'useEngPriorityTransitions', 'updateIssuePriorities'],
        ['track', 'useEngProjectTrackTransitions', 'updateIssueProjectTrack'],
        ['field', 'useEngIssueFieldEdits', 'updateField'],
    ]) {
        const file = `frontend/src/eng/${hook}.js`;
        const source = read(file);
        const insertion = kind === 'field' ? 'const editor = state.activeEditor;' : 'const runMutation =';
        assert.ok(source.includes(insertion), `${hook}: adversarial insertion point`);
        for (const extra of [
            `const writeAnother = ${api}; writeAnother(backendUrl, { issueKeys: ['CHILD-1'], priorityId: targetPriorityId });`,
            `const writers = { write: ${api} }; writers.write(backendUrl, { issueKeys: ['CHILD-1'] });`,
            `queueMicrotask(${api});`,
            `${api}(backendUrl, { issueKeys: ['CHILD-1'] });`,
            `${api}.call(null, backendUrl, { issueKeys: ['CHILD-1'] });`,
        ]) {
            const altered = source.replace(insertion, extra + insertion);
            assert.throws(() => importPolicy(file, altered), /writer reference|Field API/);
            assert.throws(() => mutationTargetPolicy(altered, kind), /writer reference|Field API/);
        }
        const aliasedDispatch = source.replace(`${api}(`, 'writeAnother(').replace(insertion, `const writeAnother = ${api};${insertion}`);
        assert.throws(() => importPolicy(file, aliasedDispatch), /dispatched directly/);
        assert.throws(() => mutationTargetPolicy(aliasedDispatch, kind), /dispatched directly/);
        assert.doesNotThrow(() => importPolicy(file, source));
        assert.doesNotThrow(() => mutationTargetPolicy(source, kind));
    }
    const file = 'frontend/src/eng/useEngIssueFieldEdits.js';
    const source = read(file);
    assert.throws(() => importPolicy(file, source + '\nconst leaked = updateIssueField;'), /Field API/);
    assert.doesNotThrow(() => importPolicy(file, source));
    const host = registry.capacity.host;
    assert.throws(() => importPolicy(host, read(host) + '\nconst leaked = updateCapacity;'), /writer reference/);
});

test('local hook and presentation aliases cannot hide calls or rendered write props', () => {
    const host = registry.hooks[0].host;
    const app = read(host);
    for (const hook of registry.hooks) {
        for (const extra of [
            `const extraHook = ${hook.symbol}; extraHook({});`,
            `const hooks = { extra: ${hook.symbol} }; hooks.extra({});`,
            `queueMicrotask(${hook.symbol});`,
        ]) assert.throws(() => importPolicy(host, app + '\n' + extra), /writer reference/);
    }
    const intruder = 'frontend/src/issues/Intruder.jsx';
    for (const component of [...registry.components, registry.statusPill]) {
        const relative = path.posix.relative(path.posix.dirname(intruder), component.path);
        const modulePath = relative.startsWith('.') ? relative : `./${relative}`;
        const imported = `import ${component.symbol} from '${modulePath}';`;
        for (const extra of [
            `const Alias = ${component.symbol}; <Alias interactive onClick={writeChildren} onSubmit={status => children.forEach(child => write(status, child))} />;`,
            `const components = { Alias: ${component.symbol} }; <components.Alias interactive onClick={writeChildren} />;`,
            `renderIndirect(${component.symbol});`,
        ]) assert.throws(() => importPolicy(intruder, imported + extra), /local alias\/reference/);
        assert.doesNotThrow(() => importPolicy(intruder, imported + `<${component.symbol} />;`));
    }
    assert.doesNotThrow(() => importPolicy(host, app));
});


test('effect inventory detects const, default, aliases and class exports without executing API code', () => {
    assert.deepEqual(apiExports('export const write = () => {}; export class Writer {}; export default function mutate() {};'), ['Writer', 'default', 'write']);
    const source = read('frontend/src/api/jiraIssueApi.js') + '\nexport const rogueWrite = () => {};';
    assert.throws(() => assert.deepEqual(apiExports(source).sort(), registry.apiEffects.filter(entry => entry.path === 'frontend/src/api/jiraIssueApi.js').map(entry => entry.symbol).sort()), /rogueWrite/);
});


test('presentational components reject direct transport bypasses', () => {
    for (const transport of ['fetch', 'trackedFetch', 'apiFetch']) assert.throws(() => presentationalPolicy('frontend/src/issues/StatusTransitionMenu.jsx', `${transport}('/api/issues/transitions', { method: 'POST' });`), /transport/);
    assert.doesNotThrow(() => presentationalPolicy('frontend/src/issues/StatusTransitionMenu.jsx', '// fetch is forbidden here\nexport const display = 1;'));
});
