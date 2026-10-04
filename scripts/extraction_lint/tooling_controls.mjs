// Additional extraction controls, using only Node builtins. Run after run.sh copied tools to tmp/lint:
// EXTRACTION_TOOL_DIR=tmp/lint node scripts/extraction_lint/tooling_controls.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const toolDir = path.resolve(process.env.EXTRACTION_TOOL_DIR ?? path.dirname(fileURLToPath(import.meta.url)));
const root = path.resolve(process.env.EXTRACTION_CONTROL_ROOT ?? 'tmp/negative-controls/tooling');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const write = (relative, code) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, code);
    return file;
};
let passed = 0;
function run(name, script, args, status, patterns) {
    const result = spawnSync(process.execPath, [path.join(toolDir, script), ...args], { encoding: 'utf8' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.status, status, `${name}: expected exit ${status}, got ${result.status}\n${output}`);
    for (const pattern of patterns) assert.match(output, pattern, `${name}: expected ${pattern}\n${output}`);
    console.log(`ok    ${name}`);
    passed += 1;
}
const dashboard = write('interfaces/dashboard.jsx', 'import { useOuter } from "./scenario/useOuter.js"; function App() { const { actual } = useOuter({ required: 1 }); return null; }\n');
const outer = write('interfaces/scenario/useOuter.js', 'import { useInner } from "./useInner.js"; export function useOuter({ required }) { const state = useInner({ required }); const alias = state; const { actual } = alias; return { actual }; }\n');
const inner = write('interfaces/scenario/useInner.js', 'export function useInner({ required }) { return { actual: required }; }\n');
const check = (name, status, patterns) => run(name, 'check_hook_interfaces.mjs', [dashboard], status, patterns);
check('nested-interface-clean', 0, [/checked 2 destructure sites in 3 modules/, /enforced problems: 0/]);
fs.writeFileSync(outer, 'import { useInner } from "./useInner.js"; export function useOuter({ required }) { const state = useInner({}); const alias = state; const { missing } = alias; return { actual: missing }; }\n');
check('nested-interface-missing-return-and-input', 1, [/destructured but not returned -> missing/, /required input not passed -> required/]);
fs.writeFileSync(outer, 'import { useInner } from "./useInner.js"; export function useOuter({ required }) { const { actual } = useInner(); return { actual }; }\n');
check('nested-interface-absent-object-argument', 1, [/required input not passed -> required/]);
fs.writeFileSync(outer, 'import { useInner } from "./useInner.js"; export function useOuter({ required }) { const state = useInner({ required }); { const state = {}; const { missing } = state; void missing; } function deferred(useInner) { const { unrelated } = useInner(); return unrelated; } const { actual } = state; return { actual }; }\n');
check('nested-interface-lexical-shadowing', 0, [/enforced problems: 0/]);
fs.writeFileSync(outer, 'import { useInner } from "./useInner.js"; import Panel from "./Panel.jsx"; export function useOuter({ required }) { const { actual } = useInner({ required }); return { actual }; } export function View() { return <Panel />; }\n');
write('interfaces/scenario/Panel.jsx', 'export default function Panel({ required }) { return <div>{required}</div>; }\n');
check('nested-component-missing-prop', 1, [/Panel .*required input not passed -> required/]);
fs.writeFileSync(outer, 'import { useInner } from "./useInner.js"; export function useOuter({ required }) { const { actual } = useInner({ ...{ required } }); return { actual }; }\n');
check('spread-input-documented-limit', 0, [/enforced problems: 0/]);
fs.writeFileSync(outer, 'import { useInner } from "./useInner.js"; export function useOuter({ required }) { const { actual } = useInner(); return { actual }; }\n');
fs.writeFileSync(inner, 'export function useInner({ required } = {}) { return { actual: required }; }\n');
check('defaulted-parameter-documented-limit', 0, [/enforced problems: 0/]);

const beforeDashboard = write('conservation/before.jsx', 'import { usePlanner } from "./scenario/usePlanner.js"; function App() { const result = usePlanner(); }\n');
const afterDashboard = write('conservation/dashboard.jsx', fs.readFileSync(beforeDashboard, 'utf8'));
const beforePlanner = write('conservation/base/usePlanner.js', 'export function usePlanner() { retain(); useEffect(() => first(), []); useEffect(() => second(), []); return {}; }\n');
const planner = write('conservation/scenario/usePlanner.js', fs.readFileSync(beforePlanner, 'utf8'));
const conserveArgs = ['--base-file', beforeDashboard, '--dashboard', afterDashboard, '--base-hook', `${planner}=${beforePlanner}`, planner];
const conserve = (name, status, patterns, extra = []) => run(name, 'check_move_conservation.mjs', [...conserveArgs, ...extra], status, patterns);
conserve('existing-hook-clean', 0, [/removed and not found in a hook: 0; new statements: 0/, /identical \(2 top-level effects\)/]);
fs.writeFileSync(planner, 'export function usePlanner() { useEffect(() => first(), []); useEffect(() => second(), []); return {}; }\n');
conserve('existing-hook-dropped-statement-reported', 0, [/removed and not found in a hook: 1; new statements: 0/, /retain\(\);/]);
fs.writeFileSync(planner, 'export function usePlanner() { retain(); retain(); useEffect(() => first(), []); useEffect(() => second(), []); return {}; }\n');
conserve('existing-hook-duplicated-statement-reported', 0, [/removed and not found in a hook: 0; new statements: 1/, /retain\(\);/]);
fs.writeFileSync(planner, 'export function usePlanner() { retain(); useEffect(() => second(), []); useEffect(() => first(), []); return {}; }\n');
conserve('existing-hook-effect-reorder-fails', 1, [/removed and not found in a hook: 0; new statements: 0/, /effect order: DIFFERS/]);
const slice = write('conservation/scenario/useSlice.js', 'export function useSlice() { retain(); useEffect(() => first(), []); return {}; }\n');
fs.writeFileSync(planner, 'import { useSlice } from "./useSlice.js"; export function usePlanner() { const slice = useSlice(); useEffect(() => second(), []); return {}; }\n');
conserve('existing-hook-split-created-child-clean', 0, [/identical \(2 top-level effects\)/], ['--created-hook', slice]);
const deleted = path.join(root, 'conservation/scenario/useDeleted.js');
const deletedBase = write('conservation/base/useDeleted.js', 'export function useDeleted() { useEffect(() => first(), []); return {}; }\n');
fs.writeFileSync(beforeDashboard, 'import { useDeleted } from "./scenario/useDeleted.js"; function App() { const result = useDeleted(); }\n');
fs.writeFileSync(afterDashboard, 'import { useSlice } from "./scenario/useSlice.js"; function App() { const result = useSlice(); }\n');
run('explicit-created-and-deleted-hooks', 'check_move_conservation.mjs', ['--base-file', beforeDashboard, '--dashboard', afterDashboard, '--base-hook', `${deleted}=${deletedBase}`, '--deleted-hook', deleted, '--created-hook', slice], 0, [/identical \(1 top-level effects\)/]);
const literalBefore = write('literal/before.jsx', 'function App() { const label = "two words"; }\n');
const literalAfter = write('literal/after.jsx', 'function App() { const label = "two  words"; }\n');
run('literal-whitespace-change-reported', 'check_move_conservation.mjs', ['--base-file', literalBefore, '--dashboard', literalAfter], 0, [/removed and not found in a hook: 1; new statements: 1/]);


// Check physical accounting independently of the AST contract gate.
const budgetRoot = path.join(root, 'budgets');
const sourceRoot = 'frontend/src';
write('budgets/frontend/src/dashboard.jsx', 'function App() {\n    return null;\n}\n');
write('budgets/frontend/src/scenario/useOwner.js', 'export function useOwner({ value }) {\n    return { value };\n}\n');
write('budgets/frontend/src/settings/helper.js', 'export const shared = 1;\n');
const budgetManifestFile = path.join(budgetRoot, 'owner_budgets.json');
const budgetManifest = () => ({
    schemaVersion: 1, baseSha: 'synthetic-base', checkpointId: 'synthetic-checkpoint', sourceRoot,
    ownerRoots: ['scenario', 'settings'], exclusions: { generated: ['frontend/dist'], tests: ['tests'], sharedImports: 'outside declared roots' },
    dashboard: { path: `${sourceRoot}/dashboard.jsx`, lineCount: 3, lineCeiling: 3 },
    modules: [
        { id: 'owner', path: `${sourceRoot}/scenario/useOwner.js`, features: ['scenario'], exports: ['useOwner'], lineCount: 3, lineCeiling: 3, interfaces: [] },
        { id: 'helper', path: `${sourceRoot}/settings/helper.js`, features: ['scenario', 'settings'], exports: ['shared'], lineCount: 1, lineCeiling: 1, interfaces: [] },
    ],
    aggregates: { scenario: { measured: 4, ceiling: 4 }, settings: { measured: 1, ceiling: 1 }, uniqueOwners: { measured: 4, ceiling: 4 }, appPlusOwners: { measured: 7, ceiling: 7 } },
    transfer: { incomingRanges: [], scaffoldingAllowance: 0 },
});
function budget(name, manifest, status, pattern) {
    fs.writeFileSync(budgetManifestFile, JSON.stringify(manifest));
    const result = spawnSync(process.env.JEP_TEST_PYTHON ?? '.venv/bin/python', ['tests/test_codebase_structure_budgets.py', '--manifest', budgetManifestFile, '--repo-root', budgetRoot], { encoding: 'utf8' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.status, status, `${name}: expected exit ${status}, got ${result.status}\n${output}`);
    assert.match(output, pattern);
    console.log(`ok    ${name}`); passed += 1;
}
budget('owner-budget-clean-shared-helper-unique', budgetManifest(), 0, /owner budgets: 0 problems/);
let manifest = budgetManifest(); manifest.modules[0].lineCeiling = 2;
budget('oversized-owner-fails', manifest, 1, /exceeds owner ceiling/);
manifest = budgetManifest(); manifest.modules.pop();
budget('unregistered-helper-fails', manifest, 1, /unregistered owner source/);
manifest = budgetManifest(); manifest.aggregates.uniqueOwners.measured = 5; manifest.aggregates.appPlusOwners.measured = 8;
budget('shared-helper-double-count-fails', manifest, 1, /differs from unique actual/);
manifest = budgetManifest(); manifest.modules.push({ ...manifest.modules[1], id: 'alias', path: `${sourceRoot}/settings/./helper.js` });
budget('physical-path-alias-fails', manifest, 1, /invalid repository-relative path/);
manifest = budgetManifest(); manifest.modules.push({ ...manifest.modules[1] });
budget('duplicate-registration-fails', manifest, 1, /duplicate module ID\/path/);
manifest = budgetManifest(); manifest.schemaVersion = 99;
budget('invalid-schema-fails', manifest, 1, /unsupported schemaVersion/);
manifest = budgetManifest(); manifest.aggregates = [];
budget('invalid-aggregate-schema-fails', manifest, 1, /invalid aggregates schema/);
manifest = budgetManifest(); manifest.sourceRoot = '../frontend/src';
budget('traversal-source-root-fails', manifest, 1, /invalid sourceRoot path/);
manifest = budgetManifest(); manifest.ownerRoots = [];
budget('empty-owner-roots-fails', manifest, 1, /invalid sourceRoot\/ownerRoots schema/);
manifest = budgetManifest(); manifest.dashboard.path = '../dashboard.jsx';
budget('traversal-dashboard-path-fails', manifest, 1, /invalid dashboard path/);
// Simulate an authorized transfer: two App lines become owner lines, so combined cap stays 7.
write('budgets/frontend/src/dashboard.jsx', 'function App() {}\n');
write('budgets/frontend/src/scenario/useOwner.js', 'export function useOwner({ value }) {\n    const retained = value;\n    const moved = retained;\n    return { value: moved };\n}\n');
manifest = budgetManifest(); manifest.dashboard.lineCount = 1; manifest.dashboard.lineCeiling = 1;
manifest.modules[0].lineCount = 5; manifest.modules[0].lineCeiling = 5;
manifest.aggregates.scenario = { measured: 6, ceiling: 6 }; manifest.aggregates.uniqueOwners = { measured: 6, ceiling: 6 };
manifest.transfer.incomingRanges = [{ from: 'App', to: 'useOwner', startAnchor: 'retained', endAnchor: 'moved', lines: 2 }];
budget('authorized-app-to-owner-transfer-clean', manifest, 0, /owner budgets: 0 problems/);
write('budgets/frontend/src/settings/helper.js', 'export const shared = 1;\nexport const growth = 2;\n');
manifest.modules[1].lineCount = 2; manifest.modules[1].lineCeiling = 2;
manifest.aggregates.scenario = { measured: 7, ceiling: 7 }; manifest.aggregates.settings = { measured: 2, ceiling: 2 }; manifest.aggregates.uniqueOwners = { measured: 7, ceiling: 7 }; manifest.aggregates.appPlusOwners.measured = 8;
budget('unaccounted-combined-growth-fails', manifest, 1, /appPlusOwners: 8 exceeds aggregate ceiling 7/);
manifest.aggregates.appPlusOwners.ceiling = 8; manifest.aggregates.uniqueOwners.ceiling = 6;
budget('aggregate-growth-despite-app-shrink-fails', manifest, 1, /uniqueOwners: 7 exceeds aggregate ceiling 6/);


const contractRoot = path.join(root, 'contracts');
const contractDashboard = write('contracts/frontend/src/dashboard.jsx', 'import { useOwner } from "./scenario/useOwner.js"; function App() { const { value } = useOwner({ bag: { value: 1 } }); return null; }\n');
const contractOwner = write('contracts/frontend/src/scenario/useOwner.js', 'export function useOwner({ bag }) { return { value: bag.value }; }\n');
fs.mkdirSync(path.join(contractRoot, 'frontend/src/settings'), { recursive: true });
fs.mkdirSync(path.join(contractRoot, 'frontend/src/epm'), { recursive: true });
const contractManifest = path.join(contractRoot, 'owner_budgets.json');
run('interface-inventory-clean-generation', 'check_hook_interfaces.mjs', ['--repo-root', contractRoot, '--write-inventory', contractManifest, contractDashboard], 0, [/owner inventory written: 1 modules/]);
const contracts = (name, status, pattern) => run(name, 'check_hook_interfaces.mjs', ['--repo-root', contractRoot, '--manifest', contractManifest, contractDashboard], status, Array.isArray(pattern) ? pattern : [pattern]);
contracts('interface-budget-clean', 0, [/owner budgets: 1 modules; problems: 0/]);
fs.writeFileSync(contractOwner, 'export function useOwner({ bag }) { return { value: bag.value, added: bag.hidden }; }\n');
contracts('hidden-bag-member-and-return-growth-fails', 1, [/interface members added.*expandedInputNames.*bag.hidden/, /interface members added.*returnNames.*added/]);
fs.writeFileSync(contractOwner, 'export function useOwner({ bag, added }) { return { value: bag.value }; }\n');
contracts('input-interface-growth-fails', 1, [/interface members added.*inputNames.*added/]);
fs.writeFileSync(contractOwner, 'export function useOwner({ bag }) { const inner = bag.inner; return { value: inner.hidden }; }\n');
contracts('member-derived-alias-growth-fails', 1, [/interface members added.*expandedInputNames|unresolved inventory/]);
fs.writeFileSync(contractOwner, 'export function useOwner({ bag }) { const alias = bag; return { value: alias.hidden }; }\n');
contracts('direct-bag-alias-growth-fails', 1, [/interface members added.*expandedInputNames|unresolved inventory/]);
fs.writeFileSync(contractOwner, 'export function useOwner({ bag }) { return { value: bag.inner.hidden }; }\n');
contracts('deep-bag-member-growth-fails', 1, [/interface members added.*expandedInputNames|unresolved inventory/]);
fs.writeFileSync(contractOwner, 'export function useOwner({ bag }) { const { inner: { hidden } } = bag; return { value: hidden }; }\n');
contracts('nested-bag-destructure-unreviewed-fails', 1, [/unresolved inventory|interface members added.*expandedInputNames/]);
fs.writeFileSync(contractOwner, 'import "../dashboard.jsx"; export function useOwner({ bag }) { return { value: bag.value }; }\n');
contracts('owner-to-app-dependency-fails', 1, [/dependency direction: owner imports dashboard.jsx/]);
write('contracts/frontend/src/analytics/dashboardAnalytics.js', 'export const analytics = 1;\n');
fs.writeFileSync(contractOwner, 'import "../analytics/dashboardAnalytics.js"; export function useOwner({ bag }) { return { value: bag.value }; }\n');
contracts('owner-dashboard-analytics-dependency-clean', 0, [/owner budgets: 1 modules; problems: 0/]);
fs.writeFileSync(contractOwner, 'export * from "../dashboard.jsx"; export function useOwner({ bag }) { return { value: bag.value }; }\n');
contracts('owner-to-app-star-reexport-fails', 1, [/dependency direction: owner re-exports dashboard/]);
fs.writeFileSync(contractOwner, 'export { App } from "../dashboard.jsx"; export function useOwner({ bag }) { return { value: bag.value }; }\n');
contracts('owner-to-app-named-reexport-fails', 1, [/dependency direction: owner re-exports dashboard/]);
fs.writeFileSync(contractOwner, 'export function useOwner({ bag }) { return { value: bag.value }; }\n');
write('contracts/frontend/src/scenario/unregistered.js', 'export const hidden = 1;\n');
contracts('ast-unregistered-module-fails', 1, [/unregistered owner module/]);
fs.unlinkSync(path.join(contractRoot, 'frontend/src/scenario/unregistered.js'));
fs.writeFileSync(contractOwner, 'export function useRenamed({ bag }) { return { value: bag.value }; }\n');
contracts('missing-export-registration-fails', 1, [/exports changed/]);

// A reviewed opaque alias is tied to its exact source revision; edits reopen review.
fs.writeFileSync(contractOwner, 'export function useOwner({ bag }) { const inner = bag.inner; return { value: inner.hidden }; }\n');
run('opaque-alias-inventory-generation', 'check_hook_interfaces.mjs', ['--repo-root', contractRoot, '--write-inventory', contractManifest, contractDashboard], 0, [/owner inventory written/]);
const opaque = JSON.parse(fs.readFileSync(contractManifest, 'utf8'));
const opaqueInterface = opaque.modules[0].interfaces[0];
opaqueInterface.inventory.reviewed = true;
opaqueInterface.inventory.rationale = 'Synthetic member-derived alias complete inventory';
opaqueInterface.inventory.memberNames = ['bag.inner.hidden'];
opaqueInterface.expandedInputNames = [...new Set([...opaqueInterface.expandedInputNames, 'bag.inner.hidden'])].sort();
opaqueInterface.expandedInputCount = opaqueInterface.expandedInputNames.length;
opaqueInterface.expandedInputCeiling = opaqueInterface.expandedInputNames.length;
fs.writeFileSync(contractManifest, JSON.stringify(opaque));
contracts('reviewed-opaque-alias-clean', 0, [/owner budgets: 1 modules; problems: 0/]);
fs.writeFileSync(contractOwner, 'export function useOwner({ bag }) { const inner = bag.inner; return { value: inner.changed }; }\n');
contracts('reviewed-opaque-alias-source-change-fails', 1, [/unresolved inventory/]);

// Caller, reader and getter metadata must be complete and reviewed, never cosmetic.
fs.writeFileSync(contractOwner, 'export function useOwner({ bag }) { return { value: bag.value }; }\n');
fs.writeFileSync(contractDashboard, 'import { useOwner } from "./scenario/useOwner.js"; function App() { const { value } = useOwner({ bag: () => later }); const later = 1; return value; }\n');
run('metadata-inventory-generation', 'check_hook_interfaces.mjs', ['--repo-root', contractRoot, '--write-inventory', contractManifest, contractDashboard], 0, [/owner inventory written/]);
const metadata = JSON.parse(fs.readFileSync(contractManifest, 'utf8'));
for (const getter of metadata.modules[0].interfaces[0].getters) { getter.phase = 'event handler'; getter.evidence = 'Synthetic deferred getter control'; }
const resetMetadata = () => fs.writeFileSync(contractManifest, JSON.stringify(metadata));
resetMetadata();
contracts('reviewed-metadata-clean', 0, [/owner budgets: 1 modules; problems: 0/]);
for (const field of ['callers', 'remainingAppReaders', 'getters']) {
    const missing = JSON.parse(JSON.stringify(metadata)); delete missing.modules[0].interfaces[0][field];
    fs.writeFileSync(contractManifest, JSON.stringify(missing));
    contracts(`missing-${field}-ledger-fails`, 1, [/missing ledger/]);
}
resetMetadata();
fs.writeFileSync(contractDashboard, 'import { useOwner, useOwner as useAlias } from "./scenario/useOwner.js"; function App() { const { value } = useOwner({ bag: () => later }); const second = useAlias({ bag: {} }); const later = 1; return value; }\n');
contracts('new-caller-metadata-fails', 1, [/unregistered callers/]);
fs.writeFileSync(contractDashboard, 'import { useOwner } from "./scenario/useOwner.js"; function App() { const { value, value: extra } = useOwner({ bag: () => later }); const later = 1; return value + extra; }\n');
contracts('new-app-reader-metadata-fails', 1, [/unregistered remainingAppReaders/]);
fs.writeFileSync(contractDashboard, 'import { useOwner } from "./scenario/useOwner.js"; function App() { const { value } = useOwner({ bag: () => later }); const later = 1; return value; }\n');
let brokenMetadata = JSON.parse(JSON.stringify(metadata)); brokenMetadata.modules[0].interfaces[0].getters[0].phase = 'unknown';
fs.writeFileSync(contractManifest, JSON.stringify(brokenMetadata));
contracts('invalid-getter-phase-fails', 1, [/unresolved getter phase/]);
brokenMetadata = JSON.parse(JSON.stringify(metadata)); delete brokenMetadata.modules[0].interfaces[0].getters[0].evidence;
fs.writeFileSync(contractManifest, JSON.stringify(brokenMetadata));
contracts('missing-getter-phase-evidence-fails', 1, [/unresolved getter phase/]);
resetMetadata();
fs.writeFileSync(contractDashboard, 'import { useOwner } from "./scenario/useOwner.js"; function App() { const { value } = useOwner({ bag: () => changed }); const changed = 1; return value; }\n');
contracts('getter-captured-binding-change-fails', 1, [/getter captures changed/]);
fs.writeFileSync(contractDashboard, 'import { useOwner } from "./scenario/useOwner.js"; function App() { const { value } = useOwner({ bag: () => later }); const later = 1; return value; }\n');
for (const field of ['callers', 'remainingAppReaders', 'getters']) {
    const invalid = JSON.parse(JSON.stringify(metadata));
    invalid.modules[0].interfaces[0][field][0] = field === 'callers' ? { path: '', symbol: 7, line: 0, phase: 'unknown' } : field === 'remainingAppReaders' ? { name: 'not an identifier', lines: ['wrong'] } : { caller: '', name: 7, line: -1, capturedBindings: [42], phase: 'event handler', evidence: 'synthetic' };
    fs.writeFileSync(contractManifest, JSON.stringify(invalid));
    contracts(`invalid-${field}-ledger-shape-fails`, 1, [/invalid ledger/]);
}
resetMetadata();
fs.writeFileSync(contractDashboard, 'import { useOwner } from "./scenario/useOwner.js"; function App() { const { value } = useOwner({ bag: () => later, other: () => later }); const later = 1; return value; }\n');
contracts('new-getter-metadata-fails', 1, [/unregistered getters/]);

// Exported hooks and containers can also have same-module callers.
fs.writeFileSync(contractOwner, 'export function useOwner({ bag }) { return { value: bag.value }; } export function useOuter({ bag }) { const { value } = useOwner({ bag }); return { value }; } export function Panel({ value }) { return <div>{value}</div>; } export function Tree({ value }) { return <Panel value={value} />; }\n');
fs.writeFileSync(contractDashboard, 'import { useOuter, Tree } from "./scenario/useOwner.js"; function App() { const { value } = useOuter({ bag: { value: 1 } }); return <Tree value={value} />; }\n');
run('local-caller-inventory-generation', 'check_hook_interfaces.mjs', ['--repo-root', contractRoot, '--write-inventory', contractManifest, contractDashboard], 0, [/owner inventory written/]);
const localMetadata = JSON.parse(fs.readFileSync(contractManifest, 'utf8'));
const localHook = localMetadata.modules[0].interfaces.find(item => item.exportName === 'useOwner');
const localPanel = localMetadata.modules[0].interfaces.find(item => item.exportName === 'Panel');
assert.ok(localHook.callers.some(item => item.symbol === 'useOwner' && item.path.endsWith('/scenario/useOwner.js')), 'local hook caller must be inventoried');
assert.ok(localPanel.callers.some(item => item.symbol === 'Panel' && item.path.endsWith('/scenario/useOwner.js')), 'local component caller must be inventoried');
contracts('local-caller-ledgers-clean', 0, [/owner budgets: 1 modules; problems: 0/]);
let missingLocal = JSON.parse(JSON.stringify(localMetadata));
missingLocal.modules[0].interfaces.find(item => item.exportName === 'useOwner').callers = [];
fs.writeFileSync(contractManifest, JSON.stringify(missingLocal));
contracts('missing-local-hook-caller-fails', 1, [/unregistered callers/]);
missingLocal = JSON.parse(JSON.stringify(localMetadata));
missingLocal.modules[0].interfaces.find(item => item.exportName === 'Panel').callers = [];
fs.writeFileSync(contractManifest, JSON.stringify(missingLocal));
contracts('missing-local-component-caller-fails', 1, [/unregistered callers/]);

// The strict scan deliberately flags both render and deferred captures. The phase ledger
// distinguishes their safety; an empty/default scan must not be mistaken for that review.
function timing(name, code, wanted, fatal = false) {
    const file = write(`timing/${name}.js`, code);
    const common = ['--no-config-lookup', '-c', path.join(toolDir, 'eslint.config.mjs'), '--format', 'json'];
    const eslint = path.join(toolDir, 'node_modules/eslint/bin/eslint.js');
    const defaultResult = spawnSync(process.execPath, [eslint, ...common, file], { encoding: 'utf8' });
    const strictResult = spawnSync(process.execPath, [eslint, ...common, '--rule', '{"no-use-before-define":["error",{"functions":false,"classes":false,"variables":true}]}', file], { encoding: 'utf8' });
    assert.ok(strictResult.status <= 1, `${name}: tooling failure ${strictResult.stderr}`);
    const diagnostics = JSON.parse(strictResult.stdout);
    assert.ok(diagnostics.length);
    const messages = diagnostics.flatMap(result => result.messages);
    if (fatal) {
        assert.ok(messages.some(message => message.fatal || message.ruleId == null), 'fatal parse diagnostics must block scan');
    } else {
        const defaultMessages = JSON.parse(defaultResult.stdout).flatMap(result => result.messages);
        assert.ok(!defaultMessages.some(message => message.ruleId === 'no-use-before-define' && message.message.includes(`'${wanted}'`)));
        assert.ok(messages.some(message => message.ruleId === 'no-use-before-define' && message.message.includes(`'${wanted}'`)), `${name}: ${strictResult.stdout}`);
    }
    console.log(`ok    ${name}`); passed += 1;
}
write('timing/useInner.js', 'export function useInner() { return { value: 1 }; }\n');
timing('nested-useMemo-later-hook-result-strict-scan', 'import React from \"react\"; import { useInner } from \"./useInner.js\"; export function useOuter() { const getter = () => laterResult; const earlier = React.useMemo(() => getter(), []); const laterResult = useInner(); return { earlier, laterResult }; }\n', 'laterResult');
timing('nested-deferred-effect-later-hook-result-strict-scan', 'import React from \"react\"; import { useInner } from \"./useInner.js\"; export function useOuter() { const getter = () => laterResult; React.useEffect(() => { getter(); }, []); const laterResult = useInner(); return { laterResult }; }\n', 'laterResult');
timing('strict-scan-fatal-diagnostic-blocks', 'export function broken( {\n', null, true);
console.log(`tooling controls passed: ${passed}`);
