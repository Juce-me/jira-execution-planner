const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountBundledHook } = require('./react_hook_harness');

function mountRecovery({ storageWorks = true, identityChanged = false, captureThrows = false } = {}) {
    const oldWindow = global.window, oldDocument = global.document, values = new Map();
    const principal = { workspaceId: 'workspace-1', viewConfigId: 'view-1' };
    let reloads = 0;
    const win = new EventTarget();
    win.sessionStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => { if (!storageWorks) throw new Error('quota'); values.set(key, value); }, removeItem: key => values.delete(key) };
    win.setTimeout = setTimeout; win.clearTimeout = clearTimeout; win.location = { reload: () => reloads++ };
    global.window = win; global.document = new EventTarget(); document.visibilityState = 'visible';
    const snapshot = {
        principal, outage: { id: '' }, view: { selectedView: 'eng', activeGroupId: 'group-1', selectedSprint: '101', engMode: 'statistics', scrollX: 0, scrollY: 0 }, droppedSettings: false, scenario: null,
        planning: { scope: { workspaceId: 'workspace-1', groupId: 'group-1', sprintId: '101', namespaceId: null }, selectedTeams: [], submission: null,
            draft: { inclusionChanges: [{ issueId: '8101', included: true, baseRevision: 0 }], initializePlan: true, basePlanRevision: 0, baseScopeProof: 'synthetic-proof', baseSchemaRevision: 0, baseViewRevision: 0, schemaChanges: [], cellChanges: [] } },
    };
    const owner = mountBundledHook({ entry: path.resolve('frontend/src/api/useConnectionRecovery.js'), exportName: 'useConnectionRecovery', modules: {
        './configApi.js': { fetchAppConfig: async () => ({ viewConfig: identityChanged ? { ...principal, workspaceId: 'other' } : principal }) },
        './authRequired.js': { isAuthenticationRequiredError: () => false, readPendingAuthenticationRequired: () => null },
        './http.js': { hasPendingMutations: () => false, waitForPendingMutations: async () => {} },
        '../dashboardRuntime.js': { getServerConnectionErrorMessage: () => 'unavailable', isBackendConnectionFailure: () => true },
    }, makeProps: () => ({ backendUrl: '', principalRef: { current: principal }, snapshotRef: { current: () => { if (captureThrows) throw new Error('must not be exposed'); return snapshot; } }, setServerConnectionError() {} }) });
    owner.render(); owner.result.reportServerConnectionError(new Error('synthetic outage')); owner.render();
    return { owner, values, get reloads() { return reloads; }, close() { owner.unmount(); global.window = oldWindow; global.document = oldDocument; } };
}

test('outage reload retains dirty Planning even when Statistics is open', async () => {
    const h = mountRecovery();
    try {
        await h.owner.result.recover({ manual: true });
        assert.equal(h.reloads, 1);
        const stored = JSON.parse(h.values.get('jira_dashboard_connection_recovery_v1'));
        assert.equal(stored.view.engMode, 'statistics');
        assert.equal(stored.planning.draft.inclusionChanges[0].issueId, '8101');
    } finally { h.close(); }
});

test('failed Planning retention keeps the mounted page until explicit discard', async () => {
    const h = mountRecovery({ storageWorks: false });
    try {
        await h.owner.result.recover({ manual: true }); h.owner.render();
        assert.equal(h.reloads, 0);
        assert.equal(h.owner.result.notice.kind, 'preservation_failed');
        await h.owner.result.recover({ manual: true, discardUnsaved: true });
        assert.equal(h.reloads, 1);
    } finally { h.close(); }
});

test('a changed principal requires explicit discard of Planning', async () => {
    const h = mountRecovery({ identityChanged: true });
    try {
        await h.owner.result.recover({ manual: true }); h.owner.render();
        assert.equal(h.reloads, 0);
        assert.equal(h.owner.result.notice.kind, 'discard_required');
        await h.owner.result.recover({ manual: true, discardUnsaved: true });
        assert.equal(h.reloads, 1);
        assert.equal(h.values.has('jira_dashboard_connection_recovery_v1'), false);
    } finally { h.close(); }
});

test('an unavailable capture fails closed with sanitized feedback', async () => {
    const h = mountRecovery({ captureThrows: true });
    try {
        await h.owner.result.recover({ manual: true }); h.owner.render();
        assert.equal(h.reloads, 0);
        assert.equal(h.owner.result.notice.kind, 'preservation_failed');
        assert.doesNotMatch(h.owner.result.notice.message, /must not be exposed/);
        await h.owner.result.recover({ manual: true, discardUnsaved: true });
        assert.equal(h.reloads, 1);
    } finally { h.close(); }
});

test('preservation failure exposes an explicit Reload and discard action', () => {
    const esbuild = require('esbuild');
    const code = esbuild.buildSync({ entryPoints: [path.resolve('frontend/src/components/ConnectionRecoveryNotice.jsx')], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'] }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, () => ({ createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }));
    let discards = 0;
    const tree = module.exports.default({ notice: { kind: 'preservation_failed', message: 'Could not preserve work.' }, onReloadDiscard: () => discards++ });
    const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children || []).flat(Infinity).flatMap(nodes)];
    const action = nodes(tree).find(node => node.type === 'button' && node.props.children.join('') === 'Reload and discard');
    assert.ok(action);
    assert.equal(discards, 0);
    action.props.onClick();
    assert.equal(discards, 1);
});
