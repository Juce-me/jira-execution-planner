const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountBundledHook } = require('./react_hook_harness');

function mountRecovery() {
    const originalWindow = global.window;
    const values = new Map();
    global.window = {
        sessionStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
        requestAnimationFrame: callback => callback(), scrollTo() {},
    };
    let terminalAuth = false, resolveRestore, restores = 0, releases = 0, selectedTeams = null;
    const recovery = { scope: { workspaceId: 'workspace-1', groupId: 'group-1', sprintId: '101', namespaceId: null }, selectedTeams: ['team-1'] };
    const record = { planning: recovery, scenario: null, view: { scrollX: 0, scrollY: 0 } };
    const pendingConnectionRecoveryRef = { current: record };
    const owner = mountBundledHook({ entry: path.resolve('frontend/src/eng/usePlanningAuthResumeRecovery.js'), exportName: 'usePlanningAuthResumeRecovery',
        modules: { '../api/authRequired.js': { readPendingAuthenticationRequired: () => terminalAuth } }, makeProps: () => ({}) });
    owner.render();
    owner.result.pendingPlanningAuthResumeRef.current = recovery;
    const input = {
        planningReview: { getPlanSnapshot: () => ({ scope: recovery.scope }), planReady: true, loading: false,
            restorePlanRecovery() { restores++; return new Promise(resolve => { resolveRestore = resolve; }); } },
        groupsLoading: false, sprintsLoading: false, tasksFetched: true, productTasksLoading: false, techTasksLoading: false,
        pendingConnectionRecoveryRef, releaseConnectionRecoveryOwnership: () => releases++, restoreSelectedTeams: teams => { selectedTeams = teams; },
    };
    return { owner, input, recovery, record, pendingConnectionRecoveryRef, values,
        resolve: value => resolveRestore(value), setTerminalAuth: value => { terminalAuth = value; },
        get restores() { return restores; }, get releases() { return releases; }, get selectedTeams() { return selectedTeams; },
        close() { owner.unmount(); global.window = originalWindow; } };
}

test('successful restore completes the original connection owner and restores teams', async () => {
    const h = mountRecovery();
    try {
        const result = h.owner.result.restorePlanningRecovery(h.input);
        h.resolve(true); await result; h.owner.render();
        assert.equal(h.pendingConnectionRecoveryRef.current, null);
        assert.equal(h.owner.result.pendingPlanningAuthResumeRef.current, null);
        assert.deepEqual(h.selectedTeams, ['team-1']);
        assert.equal(h.releases, 1);
        assert.equal(h.owner.result.planningAuthResumeLoadRevision, 1);
    } finally { h.close(); }
});

test('old completion cannot consume a replacement connection record containing the same draft', async () => {
    const h = mountRecovery();
    try {
        const result = h.owner.result.restorePlanningRecovery(h.input);
        const replacement = JSON.parse(JSON.stringify(h.record));
        h.pendingConnectionRecoveryRef.current = replacement;
        h.resolve(true); await result;
        assert.equal(h.pendingConnectionRecoveryRef.current, replacement);
        assert.equal(h.releases, 0);
    } finally { h.close(); }
});

test('replaced Planning draft survives old asynchronous completion', async () => {
    const h = mountRecovery();
    try {
        const result = h.owner.result.restorePlanningRecovery(h.input);
        const replacement = { ...h.recovery };
        h.owner.result.pendingPlanningAuthResumeRef.current = replacement;
        h.resolve(true); await result;
        assert.equal(h.owner.result.pendingPlanningAuthResumeRef.current, replacement);
        assert.equal(h.pendingConnectionRecoveryRef.current, h.record);
        assert.equal(h.selectedTeams, null);
    } finally { h.close(); }
});

test('shell and source readiness defer restore; only one restore can run at a time', async () => {
    const h = mountRecovery();
    try {
        h.owner.result.pendingShellAuthResumeRef.current = {};
        assert.equal(h.owner.result.restorePlanningRecovery(h.input), undefined);
        h.owner.result.pendingShellAuthResumeRef.current = null;
        assert.equal(h.owner.result.restorePlanningRecovery({ ...h.input, tasksFetched: false }), undefined);
        assert.equal(h.restores, 0);
        const result = h.owner.result.restorePlanningRecovery(h.input);
        assert.equal(h.owner.result.restorePlanningRecovery(h.input), undefined);
        assert.equal(h.restores, 1);
        h.resolve(false); await result; h.owner.render();
        assert.equal(h.owner.result.pendingPlanningAuthResumeRef.current, h.recovery);
        assert.match(h.owner.result.planningRecoveryError, /could not finish/);
        const retry = h.owner.result.restorePlanningRecovery(h.input);
        assert.equal(h.restores, 2);
        h.resolve(true); await retry;
    } finally { h.close(); }
});

test('capsule cleanup waits for both owners and terminal authentication', () => {
    const h = mountRecovery();
    try {
        const key = 'jira_dashboard_auth_resume_v1';
        h.values.set(key, 'backup');
        h.owner.result.clearAuthResumeWhenSettled();
        assert.equal(h.values.get(key), 'backup');
        h.owner.result.pendingPlanningAuthResumeRef.current = null;
        h.owner.result.pendingShellAuthResumeRef.current = {};
        h.owner.result.clearAuthResumeWhenSettled();
        assert.equal(h.values.get(key), 'backup');
        h.owner.result.pendingShellAuthResumeRef.current = null;
        h.setTerminalAuth(true);
        h.owner.result.clearAuthResumeWhenSettled();
        assert.equal(h.values.get(key), 'backup');
        h.setTerminalAuth(false);
        h.owner.result.clearAuthResumeWhenSettled();
        assert.equal(h.values.has(key), false);
    } finally { h.close(); }
});

test('staging prefers auth intent, preserves connection progress, and exposes the restore guard', async () => {
    const h = mountRecovery();
    try {
        const authView = { activeGroupId: 'auth-group' };
        h.owner.result.stageAuthResume({ version: 2, view: authView, planning: h.recovery }, h.record);
        h.owner.render();
        assert.equal(h.owner.result.pendingShellAuthResumeRef.current, authView);
        assert.equal(h.owner.result.pendingPlanningAuthResumeRef.current, h.recovery);
        assert.equal(h.owner.result.authResumeStagedRevision, 1);
        h.owner.result.pendingShellAuthResumeRef.current = null;
        h.owner.result.stageAuthResume(null, h.record);
        h.owner.render();
        assert.equal(h.owner.result.pendingShellAuthResumeRef.current, null);
        assert.equal(h.owner.result.authResumeStagedRevision, 1);
        assert.equal(h.owner.result.planningRecoveryRestoringRef.current, false);
        const result = h.owner.result.restorePlanningRecovery(h.input);
        assert.equal(h.owner.result.planningRecoveryRestoringRef.current, true);
        h.resolve(true); await result;
        assert.equal(h.owner.result.planningRecoveryRestoringRef.current, false);
    } finally { h.close(); }
});

test('dashboard consumes every recovery hook interface member including the JSX restore guard', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(path.resolve('frontend/src/dashboard.jsx'), 'utf8');
    const binding = source.match(/const \{([^{}]+)\} = usePlanningAuthResumeRecovery\(\);/);
    assert.ok(binding);
    const h = mountRecovery();
    try {
        const consumed = binding[1].split(',').map(name => name.trim()).filter(Boolean);
        for (const name of consumed) assert.ok(Object.hasOwn(h.owner.result, name), `missing recovery interface ${name}`);
        assert.ok(consumed.includes('planningRecoveryRestoringRef'));
        assert.ok(/disabled=\{planningRecoveryRestoringRef\.current \|\|/.test(source), 'recovery discard consumes the restore guard');
    } finally { h.close(); }
});
