const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const { createRuntime } = require('./react_hook_harness');

function mountGate({ stores = true, role = 'leader', success = false, preserved = false } = {}) {
    const runtime = createRuntime(), priorWindow = global.window, priorDocument = global.document;
    const win = new EventTarget(), doc = new EventTarget(), destinations = [];
    win.location = { assign: target => destinations.push(target) };
    global.window = win; global.document = doc;
    const auth = { loginUrl: '/login?reason=session_expired', requestStartedAt: 10 };
    let consumed = 0, captures = 0, claims = 0;
    const modules = {
        react: { ...runtime.react, Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
        '../analytics/analytics.js': { trackAuthRequiredLock() {} },
        '../api/authRequired.js': { AUTH_REQUIRED_EVENT: 'required', readPendingAuthenticationRequired: () => auth, sanitizeLoginUrl: value => value },
        '../api/authRecoveryCoordinator.js': {
            captureAuthResumeBeforeNavigation: () => { captures++; return preserved; },
            getAuthRecoveryStores: () => stores ? { sharedStorage: {}, tabStorage: {} } : null,
            readLiveAuthRecoveryLease: () => null,
            readPendingAuthRecoverySuccess: () => success ? { completedAt: 20 } : null,
            consumeAuthRecoverySuccess: () => { consumed++; return success ? { completedAt: 20 } : null; },
            claimAuthRecovery: async () => { claims++; return { role }; },
        },
    };
    const code = esbuild.buildSync({ entryPoints: [path.resolve('frontend/src/components/AuthRequiredGate.jsx')], bundle: true, write: false, format: 'cjs', platform: 'node', external: Object.keys(modules) }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, name => modules[name]);
    let tree;
    const render = () => { runtime.begin(); tree = module.exports.default({ children: 'mounted draft' }); runtime.commit(); return tree; };
    const nodes = (node = tree) => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children || []).flat(Infinity).flatMap(child => nodes(child))];
    const action = label => nodes().find(node => node.type === 'a' && node.props.children.flat(Infinity).join('') === label);
    render();
    return { render, nodes, action, destinations, get consumed() { return consumed; }, get captures() { return captures; }, get claims() { return claims; },
        close() { runtime.unmount(); global.window = priorWindow; global.document = priorDocument; } };
}

for (const [name, options] of [['no stores', { stores: false }], ['leader', { role: 'leader' }], ['resume', { role: 'resume' }]]) {
    test(`auth gate preserves mounted work before ${name} navigation and permits explicit departure`, async () => {
        const gate = mountGate(options);
        try {
            await gate.action('Sign in again').props.onClick({ preventDefault() {} }); gate.render();
            assert.deepEqual(gate.destinations, []);
            assert.ok(gate.nodes().some(node => node.props.role === 'alert'));
            await gate.action('Continue without preserving changes').props.onClick({ preventDefault() {} });
            assert.deepEqual(gate.destinations, [options.role === 'resume' ? '/' : '/login?reason=session_expired']);
        } finally { gate.close(); }
    });
}

test('follower success is not consumed until work is retained or explicitly abandoned', async () => {
    const gate = mountGate({ success: true });
    try {
        gate.render();
        assert.equal(gate.consumed, 0);
        assert.deepEqual(gate.destinations, []);
        await gate.action('Continue without preserving changes').props.onClick({ preventDefault() {} });
        assert.deepEqual(gate.destinations, ['/']);
        assert.equal(gate.consumed, 1);
    } finally { gate.close(); }
});

test('successful retention allows normal sign-in and follower document recovery', async () => {
    for (const success of [false, true]) {
        const gate = mountGate({ preserved: true, success });
        try {
            if (!success) await gate.action('Sign in again').props.onClick({ preventDefault() {} });
            assert.deepEqual(gate.destinations, [success ? '/' : '/login?reason=session_expired']);
            assert.ok(gate.captures > 0);
        } finally { gate.close(); }
    }
});
