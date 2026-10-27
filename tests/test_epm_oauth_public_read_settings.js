const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { mountBundledHook } = require('./react_hook_harness');

const root = path.join(__dirname, '..', 'frontend', 'src');

// epmApi against a stubbed fetch: the real http.js, so real 401 detection stays in apiFetch.
function loadEpmApi() {
    const code = esbuild.buildSync({
        entryPoints: [path.join(root, 'api', 'epmApi.js')], bundle: true, write: false, platform: 'node', format: 'cjs',
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports;
}
const epmApi = loadEpmApi();

const response = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    body: null,
    clone() { return this; },
    json: async () => body,
});
async function withFetch(handler, run) {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options = {}) => { calls.push({ url: String(url), options }); return handler(String(url), options, calls); };
    try { return await run(calls); } finally { globalThis.fetch = original; }
}

test('Retry-After parsing: whole seconds capped at 30, invalid, negative, zero and date values are no hint', () => {
    const parse = epmApi.parseRetryAfterSeconds;
    assert.equal(parse('5'), 5);
    assert.equal(parse('30'), 30);
    assert.equal(parse('120'), 30);
    for (const bad of ['-3', '0', '1.5', 'abc', 'Wed, 21 Oct 2026 07:28:00 GMT', '', null, undefined]) assert.equal(parse(bad), undefined, String(bad));
    assert.equal(parse(null, 7), 7, 'the typed body value is the fallback');
    assert.equal(parse('4', 9), 4, 'the header wins over the body');
});

test('every EPM read error carries status, category, loginUrl and capped retryAfterSeconds', async () => {
    const cases = [
        [() => epmApi.fetchEpmGoals('http://b'), 503, { error: 'home_rate_limited', message: 'slow down', retryAfterSeconds: 99 }, { 'Retry-After': '12' }, { status: 503, category: 'home_rate_limited', retryAfterSeconds: 12 }],
        [() => epmApi.fetchEpmScope('http://b'), 409, { error: 'epm_scope_required', loginUrl: '/login?reason=missing_scope', message: 'scope' }, {}, { status: 409, category: 'epm_scope_required', retryAfterSeconds: undefined, loginUrl: '/login?reason=missing_scope' }],
        [() => epmApi.fetchEpmProjects('http://b', { tab: 'active' }), 403, { error: 'home_access_denied', message: 'no' }, {}, { status: 403, category: 'home_access_denied' }],
        [() => epmApi.fetchEpmAllProjectsRollup('http://b', { tab: 'active' }), 503, { error: 'jira_rate_limited' }, { 'Retry-After': '300' }, { status: 503, category: 'jira_rate_limited', retryAfterSeconds: 30 }],
        [() => epmApi.fetchEpmProjectRollup('http://b', 'p1', { tab: 'active' }), 502, { error: 'jira_read_failed' }, { 'Retry-After': '-4' }, { status: 502, category: 'jira_read_failed', retryAfterSeconds: undefined }],
        [() => epmApi.fetchEpmAccess('http://b'), 503, { error: 'config_storage_unavailable' }, {}, { status: 503, category: 'config_storage_unavailable' }],
    ];
    for (const [call, status, body, headers, expected] of cases) {
        await withFetch(async () => response(status, body, headers), async () => {
            await assert.rejects(call(), (error) => {
                for (const [key, value] of Object.entries(expected)) assert.equal(error[key], value, `${status} ${key}`);
                assert.equal(error.code, expected.category);
                return true;
            });
        });
    }
});

test('a real 401 on an EPM read still belongs to apiFetch (terminal lock error), not an EPM error shape', async () => {
    await withFetch(async () => response(401, { error: 'auth_required', loginUrl: '/login' }), async (calls) => {
        await assert.rejects(epmApi.fetchEpmGoals('http://b'), (error) => error.name === 'AuthenticationRequiredError');
        assert.equal(calls.length, 1, 'no replay');
    });
});

test('saveEpmPreferences posts exactly { viewEnabled } with the token-bound CSRF and requested-with headers', async () => {
    await withFetch(async (url) => (url.endsWith('/api/auth/csrf') ? response(200, { csrfToken: 'tok' }) : response(200, { epmViewEnabled: true })), async (calls) => {
        assert.deepEqual(await epmApi.saveEpmPreferences('http://b', { viewEnabled: true, token: 'x', apiToken: 'y' }), { epmViewEnabled: true });
        const post = calls.find((call) => call.url.endsWith('/api/epm/preferences'));
        assert.equal(post.options.method, 'POST');
        assert.equal(post.options.headers['X-CSRF-Token'], 'tok');
        assert.equal(post.options.headers['X-Requested-With'], 'jira-execution-planner');
        assert.deepEqual(JSON.parse(post.options.body), { viewEnabled: true });
    });
    await withFetch(async (url) => (url.endsWith('/api/auth/csrf') ? response(200, { csrfToken: 't' }) : response(400, { error: 'invalid_epm_preferences' })), async (calls) => {
        await assert.rejects(epmApi.saveEpmPreferences('http://b', { viewEnabled: 'yes' }), (error) => error.status === 400 && error.category === 'invalid_epm_preferences');
        assert.deepEqual(JSON.parse(calls.find((call) => call.url.endsWith('/api/epm/preferences')).options.body), { viewEnabled: false }, 'only a strict true enables');
    });
});

test('fetchEpmAccess reads the access route once with no-cache', async () => {
    await withFetch(async () => response(200, { state: 'available', epmHomeReadAvailable: true }), async (calls) => {
        assert.equal((await epmApi.fetchEpmAccess('http://b')).state, 'available');
        assert.equal(calls.length, 1);
        assert.match(calls[0].url, /\/api\/epm\/access$/);
        assert.equal(calls[0].options.cache, 'no-cache');
    });
});

function mountPreference({ savedViewEnabled = false, save } = {}) {
    const events = [];
    const mounted = mountBundledHook({
        entry: path.join(root, 'settings', 'useEpmViewPreference.js'),
        exportName: 'useEpmViewPreference',
        modules: {
            '../api/epmApi.js': { saveEpmPreferences: save || (async (_url, body) => ({ epmViewEnabled: body.viewEnabled })) },
            '../api/authRequired.js': { isAuthenticationRequiredError: (error) => error?.name === 'AuthenticationRequiredError' },
        },
        makeProps: () => ({ BACKEND_URL: 'http://b', savedViewEnabled, trackSettingsAction: (...args) => events.push(args) }),
    });
    mounted.render();
    return { mounted, events };
}

test('preference draft: dirty only when it differs from the saved value; Discard restores the saved value', () => {
    const { mounted } = mountPreference({ savedViewEnabled: false });
    assert.deepEqual([mounted.result.checked, mounted.result.isDirty], [false, false]);
    mounted.result.setChecked(true); mounted.render();
    assert.deepEqual([mounted.result.checked, mounted.result.isDirty], [true, true]);
    mounted.result.setChecked(false); mounted.render();
    assert.deepEqual([mounted.result.checked, mounted.result.isDirty], [false, false], 'toggling back is clean');
    mounted.result.setChecked(true); mounted.render();
    mounted.result.discard(); mounted.render();
    assert.deepEqual([mounted.result.checked, mounted.result.isDirty], [false, false]);
});

test('preference save: posts only viewEnabled, adopts the response, emits settings_action success without the value', async () => {
    const posted = [];
    const { mounted, events } = mountPreference({ save: async (url, body) => { posted.push([url, body]); return { epmViewEnabled: true }; } });
    mounted.result.setChecked(true); mounted.render();
    assert.deepEqual(await mounted.result.save(), { ok: true });
    mounted.render();
    assert.deepEqual(posted, [['http://b', { viewEnabled: true }]]);
    assert.deepEqual([mounted.result.savedEnabled, mounted.result.checked, mounted.result.isDirty], [true, true, false]);
    assert.deepEqual(events, [['epm', 'save_result', { result: 'success' }]]);
    assert.deepEqual(await mounted.result.save(), { ok: true }, 'a clean save is a no-op');
    assert.equal(posted.length, 1);
});

test('preference save failure keeps the draft and the message; Discard then restores the saved value; auth loss rethrows', async () => {
    const failure = Object.assign(new Error('Settings storage is unavailable.'), { status: 503 });
    const { mounted, events } = mountPreference({ save: async () => { throw failure; } });
    mounted.result.setChecked(true); mounted.render();
    assert.deepEqual(await mounted.result.save(), { ok: false, error: 'Settings storage is unavailable.' });
    mounted.render();
    assert.deepEqual([mounted.result.checked, mounted.result.isDirty, mounted.result.error], [true, true, 'Settings storage is unavailable.']);
    assert.deepEqual(events, [['epm', 'save_result', { result: 'failure' }]]);
    mounted.result.discard(); mounted.render();
    assert.deepEqual([mounted.result.checked, mounted.result.isDirty, mounted.result.error], [false, false, '']);
    const lost = mountPreference({ save: async () => { const error = new Error('locked'); error.name = 'AuthenticationRequiredError'; throw error; } });
    lost.mounted.result.setChecked(true); lost.mounted.render();
    await assert.rejects(lost.mounted.result.save(), (error) => error.name === 'AuthenticationRequiredError');
    assert.deepEqual(lost.events, [], 'an authentication loss is not a preference failure event');
});

test('preference follows the refreshed saved value from config', () => {
    const { mounted } = mountPreference({ savedViewEnabled: false });
    mounted.render({ savedViewEnabled: true });
    mounted.render({ savedViewEnabled: true });
    assert.equal(mounted.result.savedEnabled, true);
    assert.equal(mounted.result.checked, true);
});

function renderConnections(epmViewPreference) {
    const code = esbuild.buildSync({
        entryPoints: [path.join(root, 'settings', 'UserConnectionsSettings.jsx')], bundle: true, write: false, platform: 'node', format: 'cjs',
        external: ['react', '../analytics/analytics.js', '../api/authRequired.js', '../api/authApi.js'], loader: { '.jsx': 'jsx' }, jsx: 'transform',
    }).outputFiles[0].text;
    const module = { exports: {} };
    const stubs = {
        '../analytics/analytics.js': { trackEvent() {} },
        '../api/authRequired.js': { isAuthenticationRequiredError: () => false },
        '../api/authApi.js': {},
    };
    new Function('module', 'exports', 'require', code)(module, module.exports, (name) => stubs[name] || require(name));
    return renderToStaticMarkup(React.createElement(module.exports.default, { backendUrl: 'http://b', epmViewPreference }));
}

test('Connections: no preference prop renders only the existing token card', () => {
    const html = renderConnections(null);
    assert.ok(html.includes('home-token-title'));
    assert.equal(html.includes('Enable EPM view'), false);
});

test('Connections: the registered checkbox reuses the private-preference hooks and keeps the token card', () => {
    const html = renderConnections({ checked: true, savedEnabled: false, onChange() {}, saving: false, error: '', access: null, loginUrl: '' });
    assert.ok(html.includes('class="group-visible-control"'));
    assert.ok(html.includes('class="group-preference-row"'));
    assert.ok(html.includes('class="group-visible-helper"'));
    assert.match(html, /<input[^>]*type="checkbox"[^>]*checked=""/);
    assert.ok(html.includes('Enable EPM view'));
    assert.ok(html.includes('home-token-title'), 'the token-management card stays');
    assert.equal(html.includes('Update Atlassian permissions'), false, 'checking the box is not evidence of consent or access');
    assert.ok(html.includes('user-connection-status muted">Off<'));
});

test('Connections: saved state shows the access message and the same-tab scope link only when permission is missing', () => {
    const scope = renderConnections({ checked: true, savedEnabled: true, onChange() {}, access: { state: 'scope_missing', loginUrl: '/login?reason=missing_scope', message: 'RAW' }, loginUrl: '/login?reason=missing_scope' });
    assert.ok(scope.includes('href="/login?reason=missing_scope"'));
    assert.ok(scope.includes('Permission needed'));
    assert.equal(scope.includes('RAW'), false, 'provider or server payload text is never echoed');
    assert.equal(scope.includes('target='), false, 'same tab');
    for (const [state, copy] of [['denied', 'did not grant access'], ['empty', 'No accessible Atlassian Home goal'], ['unavailable', 'could not be checked']]) {
        const html = renderConnections({ checked: true, savedEnabled: true, onChange() {}, access: { state }, loginUrl: '' });
        assert.ok(html.includes(copy), state);
        assert.equal(html.includes('Update Atlassian permissions'), false, state);
    }
    const ok = renderConnections({ checked: true, savedEnabled: true, onChange() {}, access: { state: 'available', loginUrl: '/login?reason=missing_scope' }, loginUrl: '/login?reason=missing_scope' });
    assert.ok(ok.includes('Available'));
    assert.equal(ok.includes('Update Atlassian permissions'), false);
});

test('Connections: a failed save shows its alert and the box is disabled while saving', () => {
    const html = renderConnections({ checked: true, savedEnabled: false, onChange() {}, saving: true, error: 'Settings storage is unavailable.', access: null });
    assert.ok(html.includes('role="alert"'));
    assert.ok(html.includes('Settings storage is unavailable.'));
    assert.match(html, /<input[^>]*type="checkbox"[^>]*disabled=""/);
});

test('source guard: the preference path never touches token fields or sends the value to analytics', () => {
    const fs = require('node:fs');
    const hook = fs.readFileSync(path.join(root, 'settings', 'useEpmViewPreference.js'), 'utf8');
    const api = fs.readFileSync(path.join(root, 'api', 'epmApi.js'), 'utf8');
    const connections = fs.readFileSync(path.join(root, 'settings', 'UserConnectionsSettings.jsx'), 'utf8');
    assert.equal(/apiToken|credentialSubject|connectHomeTokenConnection|home-token/i.test(hook), false);
    const saveBody = api.slice(api.indexOf('export async function saveEpmPreferences'), api.indexOf('export const fetchEpmAccess'));
    assert.ok(saveBody.includes('JSON.stringify({ viewEnabled: viewEnabled === true })'));
    assert.equal(/apiToken|email/i.test(saveBody), false);
    for (const call of hook.match(/trackSettingsAction\?\.\([^)]*\)/g) || []) assert.equal(/viewEnabled|draft|saved/.test(call), false, call);
    assert.ok(connections.includes('epmViewPreference.onChange(event.target.checked)'));
    const tokenConnect = connections.slice(connections.indexOf('const connect = async'), connections.indexOf('const revoke = async'));
    assert.equal(/epmViewPreference/.test(tokenConnect), false, 'the token save path never reads the preference');
});
