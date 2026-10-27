const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const hookPath = path.join(root, 'frontend/src/epm/useEpmNavigationState.js');
const dashboardSource = fs.readFileSync(path.join(root, 'frontend/src/dashboard.jsx'), 'utf8');
const viewDataSource = fs.readFileSync(path.join(root, 'frontend/src/epm/useEpmViewData.js'), 'utf8');

// Minimal hook runtime: state slots, refs, and effects that run on demand with dependency comparison.
function createHarness(props) {
    const code = esbuild.buildSync({ entryPoints: [hookPath], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'] }).outputFiles[0].text;
    const slots = []; const effects = []; let cursor = 0; let pending = false;
    const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    const fakeReact = {
        useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, (next) => { const v = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(v, slots[i].value)) { slots[i].value = v; pending = true; } }]; },
        useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
        useCallback(fn, deps) { const i = cursor++; const held = slots[i]; if (held && same(held.deps, deps)) return held.fn; slots[i] = { fn, deps }; return fn; },
        useEffect(fn, deps) { const i = cursor++; const held = effects[i]; if (held && same(held.deps, deps)) return; effects[i] = { fn, deps, run: true, cleanup: held?.cleanup }; },
    };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, (name) => (name === 'react' ? fakeReact : require(name)));
    let result;
    const render = () => { cursor = 0; result = module.exports.useEpmNavigationState(props); effects.forEach((effect) => { if (effect && effect.run) { effect.run = false; effect.cleanup?.(); effect.cleanup = effect.fn(); } }); };
    const settle = async () => { for (let i = 0; i < 6; i += 1) { await new Promise((resolve) => setImmediate(resolve)); if (pending) { pending = false; render(); } } };
    render();
    return { get state() { return result; }, settle, render };
}

async function withFetch(handler, run) {
    const prior = global.fetch; const calls = [];
    global.fetch = async (url, options) => { calls.push(String(url)); return handler(String(url), options); };
    try { await run(calls); } finally { global.fetch = prior; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const accessCalls = (calls) => calls.filter((url) => url.includes('/api/epm/access'));
const config = (extra = {}) => ({ authMode: 'atlassian_oauth', epmViewEnabled: true, epmHomeReadAvailable: true, epmHomeReadLoginUrl: '', ...extra });

test('navigation is hidden and not ready until the capability fields arrive; missing or mistyped fields fail closed with no access read', async () => {
    await withFetch(() => json({ state: 'available' }), async (calls) => {
        const harness = createHarness({ backendUrl: 'http://synthetic' });
        assert.equal(harness.state.showEpmNavigation, false);
        assert.equal(harness.state.epmReadReady, false);
        for (const bad of [{ authMode: 'atlassian_oauth' }, config({ epmViewEnabled: 'true' }), config({ epmHomeReadAvailable: 1 })]) {
            harness.state.applyEpmCapabilityConfig(bad);
            await harness.settle();
            assert.equal(harness.state.showEpmNavigation, false);
            assert.equal(harness.state.epmReadReady, true, 'resolved: no access read is owed');
        }
        assert.equal(calls.length, 0);
    });
});

test('disabled, missing-scope and Basic users make no access request; Basic stays visible', async () => {
    await withFetch(() => json({ state: 'available' }), async (calls) => {
        const harness = createHarness({ backendUrl: 'http://synthetic' });
        for (const next of [config({ epmViewEnabled: false }), config({ epmHomeReadAvailable: false, epmHomeReadLoginUrl: '/login?reason=missing_scope' })]) {
            harness.state.applyEpmCapabilityConfig(next);
            await harness.settle();
            assert.equal(harness.state.showEpmNavigation, false);
            assert.equal(harness.state.epmReadReady, true);
        }
        harness.state.applyEpmCapabilityConfig({ authMode: 'basic' });
        await harness.settle();
        assert.equal(harness.state.showEpmNavigation, true);
        assert.equal(harness.state.epmReadReady, true);
        assert.equal(calls.length, 0);
    });
});

test('enabled scoped users read access once; repeated identical config ingestion does not refetch; explicit refresh does', async () => {
    await withFetch(() => json({ state: 'available', epmHomeReadAvailable: true }), async (calls) => {
        const harness = createHarness({ backendUrl: 'http://synthetic' });
        harness.state.applyEpmCapabilityConfig(config());
        await harness.settle();
        assert.equal(harness.state.epmReadReady, true);
        assert.equal(harness.state.showEpmNavigation, true);
        assert.equal(accessCalls(calls).length, 1);
        harness.state.applyEpmCapabilityConfig(config());
        await harness.settle();
        assert.equal(accessCalls(calls).length, 1);
        harness.state.refreshEpmAccess();
        await harness.settle();
        assert.equal(accessCalls(calls).length, 2);
        assert.equal(harness.state.showEpmNavigation, true, 'the held decision stays while refreshing');
    });
});

test('empty, denied and failed access hide navigation; the readiness gate still resolves without a terminal lock', async () => {
    for (const [reply, expected] of [[() => json({ state: 'empty' }), 'empty'], [() => json({ state: 'denied' }), 'denied'], [() => json({ error: 'home_read_failed' }, 502), 'unavailable'], [() => json({ state: 'bogus' }), 'unavailable']]) {
        await withFetch(reply, async () => {
            const harness = createHarness({ backendUrl: 'http://synthetic' });
            harness.state.applyEpmCapabilityConfig(config());
            await harness.settle();
            assert.equal(harness.state.showEpmNavigation, false);
            assert.equal(harness.state.epmReadReady, true);
            assert.equal(harness.state.epmAccess.state, expected);
        });
    }
});

test('home_access_denied from a read invalidates availability and retires an in-flight access decision', async () => {
    let release;
    await withFetch(() => new Promise((resolve) => { release = () => resolve(json({ state: 'available' })); }), async () => {
        const harness = createHarness({ backendUrl: 'http://synthetic' });
        harness.state.applyEpmCapabilityConfig(config());
        await harness.settle();
        harness.state.invalidateHomeAvailability();
        release();
        await harness.settle();
        assert.equal(harness.state.epmAccess.state, 'denied');
        assert.equal(harness.state.showEpmNavigation, false);
    });
});

test('a disabled user after enablement drops the held access decision', async () => {
    await withFetch(() => json({ state: 'available' }), async () => {
        const harness = createHarness({ backendUrl: 'http://synthetic' });
        harness.state.applyEpmCapabilityConfig(config());
        await harness.settle();
        assert.equal(harness.state.showEpmNavigation, true);
        harness.state.applyEpmCapabilityConfig(config({ epmViewEnabled: false }));
        await harness.settle();
        assert.equal(harness.state.epmAccess, null);
        assert.equal(harness.state.showEpmNavigation, false);
    });
});

test('dashboard source: no Home token gating, no startup token status fetch, three ingestion call sites, one navigation owner', () => {
    assert.equal(/onHomeTokenRequired|markHomeTokenRequired|homeTokenConnection|fetchHomeTokenConnection|isActiveHomeTokenConnection/.test(dashboardSource), false);
    assert.equal(/onHomeTokenRequired|home_user_token_required/.test(viewDataSource), false);
    assert.ok(dashboardSource.includes('} = useEpmNavigationState({ backendUrl: BACKEND_URL });'));
    assert.equal(dashboardSource.includes('const showEpmNavigation ='), false, 'navigation comes only from the navigation hook');
    assert.ok(dashboardSource.includes('applyEpmCapabilityConfig(config);'), 'bootstrap/refresh ingestion');
    assert.ok(/useSharedConfigSave\(\{[\s\S]*?\n\s+applyEpmCapabilityConfig,/.test(dashboardSource), 'post-save ingestion is wired');
    assert.ok(dashboardSource.includes('onHomeAccessDenied: invalidateEpmHomeAvailability'));
    assert.ok(dashboardSource.includes('refreshEpmAccess,'));
});
