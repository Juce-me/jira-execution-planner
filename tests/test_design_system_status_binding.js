const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountBundledHook, createRuntime } = require('./react_hook_harness');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');

test('the real status menu forwards its exact issue prop, independent of another active issue', () => {
    const runtime = createRuntime();
    runtime.react.useId = () => 'synthetic-id';
    runtime.react.createElement = (type, props, ...children) => ({ type, props: { ...props, children } });
    const externals = ['react', '../ui/StatusPill.jsx', './IssueFieldOptionMenu.jsx', './StatusColourContext.jsx'];
    const code = esbuild.buildSync({ entryPoints: [path.join(root, 'frontend/src/issues/StatusTransitionMenu.jsx')], bundle: true, write: false, platform: 'node', format: 'cjs', external: externals }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, name => {
        if (name === 'react') return runtime.react;
        if (name === './StatusColourContext.jsx') return { useStatusColourStyle: () => () => ({}) };
        return { default: name };
    });
    const ownIssue = { key: 'SYNTH-1', children: [{ key: 'SYNTH-CHILD' }] };
    const calls = [];
    runtime.begin();
    const tree = module.exports.default({ issue: ownIssue, isOpen: true, statusLabel: 'To Do', options: { targetStatuses: [{ name: 'Done' }] }, activeIssue: { key: 'SYNTH-OTHER' }, onSubmit: (...args) => calls.push(args) });
    tree.props.children[1].props.onSelect({ name: 'Done' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'Done');
    assert.strictEqual(calls[0][1], ownIssue);
});

for (const [label, key] of [['array', ['SYNTH-1', 'SYNTH-2']], ['object', { key: 'SYNTH-1' }], ['number', 123], ['null', null], ['blank', '   '], ['coercible object', { toString() { throw new Error('must not coerce'); } }]]) {
    test(`the real status hook refuses ${label} before reservation, queue, analytics or write`, async () => {
        const calls = [];
        const mounted = mountBundledHook({
            entry: path.join(root, 'frontend/src/eng/useEngStatusTransitions.js'), exportName: 'useEngStatusTransitions',
            modules: {
                '../api/authRequired.js': { isAuthenticationRequiredError: () => false, readPendingAuthenticationRequired: () => false },
                '../api/jiraIssueApi.js': { fetchIssueTransitionOptions: async () => ({}), transitionIssues: async () => { calls.push('write'); return {}; } },
                './engIssueMutationQueue.js': { enqueueEngIssueMutation: () => calls.push('enqueue'), enqueueEngIssueMutations: () => calls.push('enqueue') },
            },
            makeProps: () => ({ backendUrl: 'https://synthetic.invalid', sourceSurface: 'planning', issueEditState: { planningPhase: () => null, reservePlanningEdit: () => { calls.push('reserve'); return null; } }, trackIssueStatusAction: () => calls.push('analytics'), onApplyLocalStatus: () => calls.push('optimistic') }),
        });
        mounted.render();
        assert.equal(await mounted.result.submitStatusTransition('Done', key), null);
        assert.deepEqual(calls, []);
        mounted.unmount();
    });
}

test('a valid explicit string still reserves, queues and writes exactly that issue', async () => {
    const calls = [];
    const mounted = mountBundledHook({
        entry: path.join(root, 'frontend/src/eng/useEngStatusTransitions.js'), exportName: 'useEngStatusTransitions',
        modules: {
            '../api/authRequired.js': { isAuthenticationRequiredError: () => false, readPendingAuthenticationRequired: () => false },
            '../api/jiraIssueApi.js': { fetchIssueTransitionOptions: async () => ({}), transitionIssues: async (_url, body) => { calls.push(['write', body]); return { targetStatus: 'Done', results: [{ key: 'SYNTH-1', result: 'success', toStatus: 'Done' }] }; } },
            './engIssueMutationQueue.js': { enqueueEngIssueMutation: async (_key, run) => run(), enqueueEngIssueMutations: async (keys, run) => { calls.push(['enqueue', keys]); return run(); } },
        },
        makeProps: () => ({ backendUrl: 'https://synthetic.invalid', sourceSurface: 'planning', storySubtasksByKey: {}, trackIssueStatusAction: () => {} }),
    });
    mounted.render();
    await mounted.result.submitStatusTransition('Done', 'SYNTH-1');
    assert.deepEqual(calls, [['enqueue', ['SYNTH-1']], ['write', { issueKeys: ['SYNTH-1'], targetStatus: 'Done' }]]);
    mounted.unmount();
});
