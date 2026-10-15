const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const SRC = path.join(__dirname, '..', 'frontend', 'src');
const SHARE_VIEW = path.join(SRC, 'shareView');
const ORIGIN = 'https://app.test';
const LINK = '/?v=1&mode=planning&group=dept%2Fa&sprint=4182&teams=a%2Cb,c&perf=1&utm_x=a%20b#frag';

// Bundles store.js the way the app does. `codec` swaps ./codec.js for a stub source.
async function loadStore(codec) {
    const plugins = codec ? [{
        name: 'codec-stub',
        setup(build) {
            build.onResolve({ filter: /^\.\/codec\.js$/ }, () => ({ path: 'codec-stub', namespace: 'codec-stub' }));
            build.onLoad({ filter: /.*/, namespace: 'codec-stub' }, () => ({ contents: codec, loader: 'js' }));
        },
    }] : [];
    const result = await esbuild.build({
        stdin: { contents: "export * from './shareView/store.js';", resolveDir: SRC },
        bundle: true, write: false, format: 'cjs', platform: 'node', plugins,
    });
    const loaded = { exports: {} };
    new Function('module', 'exports', 'require', result.outputFiles[0].text)(loaded, loaded.exports, require);
    return loaded.exports;
}

// A window whose history.replaceState really rewrites location, and which records every call.
function fakeWindow(url, { onReplace } = {}) {
    const location = new URL(url, ORIGIN);
    const calls = [];
    const win = {
        location: {
            get search() { return location.search; },
            get pathname() { return location.pathname; },
            get hash() { return location.hash; },
        },
        history: {
            state: { marker: 'keep' },
            replaceState(state, title, next) {
                calls.push([state, title, next]);
                if (onReplace) onReplace(state, title, next);
                const target = new URL(next, location);
                location.pathname = target.pathname;
                location.search = target.search;
                location.hash = target.hash;
            },
        },
    };
    return { win, calls, current: () => `${location.pathname}${location.search}${location.hash}` };
}

const fields = (snap) => [snap.phase, snap.stage, snap.hold, snap.terminal];
const securityError = () => Object.assign(new Error('blocked'), { name: 'SecurityError' });

let store;
test.before(async () => { store = await loadStore(); });
test.beforeEach(() => store.resetShareViewForTests());

function pendingLink() {
    store.initShareViewFromLocation(fakeWindow(LINK).win);
    assert.equal(store.getShareViewSnapshot().phase, 'pending');
}

// --- Entry: read, strip, decode ----------------------------------------------------------------

test('the phases are the seven documented strings', () => {
    assert.deepEqual({ ...store.SHARE_VIEW_PHASES }, {
        ABSENT: 'absent', PENDING: 'pending', RUNNING: 'running', DONE: 'done',
        PARTIAL: 'partial', DROPPED: 'dropped', CANCELLED: 'cancelled',
    });
});

test('a URL without schema keys leaves the store absent and the address bar untouched', () => {
    for (const url of ['/', '/?perf=1', '/?x=1&y=2#top', '/?q=v']) {
        store.resetShareViewForTests();
        const page = fakeWindow(url);
        store.initShareViewFromLocation(page.win);
        const snap = store.getShareViewSnapshot();
        assert.deepEqual(fields(snap), ['absent', null, false, false], url);
        assert.equal(snap.entry, null);
        assert.equal(snap.notice, null);
        assert.equal(page.calls.length, 0, url);
    }
});

test('a link becomes pending with its decoded entry, holds, and is stripped from the URL', () => {
    const page = fakeWindow(LINK);
    store.initShareViewFromLocation(page.win);
    const snap = store.getShareViewSnapshot();
    assert.deepEqual(fields(snap), ['pending', null, true, false]);
    assert.equal(snap.notice, null);
    assert.equal(snap.entry.state.mode, 'planning');
    assert.equal(snap.entry.state.group, 'dept/a');
    assert.equal(snap.entry.state.sprint, '4182');
    assert.deepEqual(snap.entry.state.teams, ['a,b', 'c']);
    assert.deepEqual(snap.entry.reported, []);
    // Every schema key is gone; perf, the unknown param and the hash stay, and history.state is kept.
    assert.equal(page.calls.length, 1);
    assert.deepEqual(page.calls[0], [{ marker: 'keep' }, '', '/?perf=1&utm_x=a%20b#frag']);
    assert.equal(page.current(), '/?perf=1&utm_x=a%20b#frag');
});

test('a link with only schema keys leaves a clean path and the hash', () => {
    const page = fakeWindow('/?v=1&mode=board&group=g1&sprint=4182#top');
    store.initShareViewFromLocation(page.win);
    assert.equal(page.current(), '/#top');
});

test('schema keys are stripped even when the URL is not a decodable link', () => {
    const page = fakeWindow('/?mode=board&v=1&perf=1');
    store.initShareViewFromLocation(page.win);
    assert.deepEqual(fields(store.getShareViewSnapshot()), ['absent', null, false, false]);
    assert.equal(page.current(), '/?perf=1');
});

test('a newer link is dropped at once with a newer notice and holds nothing', () => {
    const page = fakeWindow('/?v=2&mode=board&group=g1&sprint=4182');
    store.initShareViewFromLocation(page.win);
    const snap = store.getShareViewSnapshot();
    assert.deepEqual(fields(snap), ['dropped', null, false, true]);
    assert.deepEqual(snap.notice, { kind: 'newer', categories: [] });
    assert.equal(snap.entry, null);
    assert.equal(page.current(), '/');
});

test('an invalid link is dropped at once with an invalid notice and holds nothing', () => {
    for (const query of ['?v=01&mode=board', '?v=1.0', '?v=']) {
        store.resetShareViewForTests();
        const page = fakeWindow(`/${query}`);
        store.initShareViewFromLocation(page.win);
        const snap = store.getShareViewSnapshot();
        assert.deepEqual(fields(snap), ['dropped', null, false, true], query);
        assert.deepEqual(snap.notice, { kind: 'invalid', categories: [] }, query);
        assert.equal(page.current(), '/', query);
    }
});

test('the address bar is clean before the store publishes the link', () => {
    const page = fakeWindow('/?v=1&mode=board&group=g1&sprint=4182');
    const stripsSeenAtPublish = [];
    store.subscribeShareView(() => stripsSeenAtPublish.push(page.calls.length));
    store.initShareViewFromLocation(page.win);
    assert.deepEqual(stripsSeenAtPublish, [1]);
});

test('strip happens before parsing and even when decoding throws', async () => {
    globalThis.__shareViewCalls = [];
    try {
        const faulty = await loadStore(`
            export function stripShareViewParams() { globalThis.__shareViewCalls.push('strip'); return ''; }
            export function decodeShareView() { globalThis.__shareViewCalls.push('decode'); throw new Error('decoder fault'); }
        `);
        const page = fakeWindow('/?v=1&find=x#top');
        assert.doesNotThrow(() => faulty.initShareViewFromLocation(page.win));
        assert.deepEqual(globalThis.__shareViewCalls, ['strip', 'decode']);
        assert.equal(page.current(), '/#top');
        const snap = faulty.getShareViewSnapshot();
        assert.deepEqual(fields(snap), ['dropped', null, false, true]);
        assert.deepEqual(snap.notice, { kind: 'invalid', categories: [] });
    } finally {
        delete globalThis.__shareViewCalls;
    }
});

test('init never throws when the URL cannot be rewritten or read', () => {
    const blocked = fakeWindow('/?v=1&mode=board&group=g1&sprint=4182', { onReplace() { throw securityError(); } });
    assert.doesNotThrow(() => store.initShareViewFromLocation(blocked.win));
    assert.equal(blocked.calls.length, 1, 'the strip was attempted');
    assert.equal(store.getShareViewSnapshot().phase, 'pending', 'a failed strip does not drop the link');

    store.resetShareViewForTests();
    const unreadable = { get location() { throw securityError(); }, history: { replaceState() { throw new Error('unreachable'); } } };
    assert.doesNotThrow(() => store.initShareViewFromLocation(unreadable));
    assert.equal(store.getShareViewSnapshot().phase, 'absent');

    store.resetShareViewForTests();
    assert.doesNotThrow(() => store.initShareViewFromLocation(null));
    assert.equal(store.getShareViewSnapshot().phase, 'absent');
});

test('a reload with the stripped URL yields absent', async () => {
    const page = fakeWindow(LINK);
    store.initShareViewFromLocation(page.win);
    assert.equal(store.getShareViewSnapshot().phase, 'pending');
    const reloaded = await loadStore(); // a reload evaluates the bundle, and so the store, again
    reloaded.initShareViewFromLocation(page.win);
    assert.deepEqual(fields(reloaded.getShareViewSnapshot()), ['absent', null, false, false]);
    assert.equal(page.calls.length, 1, 'nothing was left to strip');
});

// --- Phases, hold, notice ----------------------------------------------------------------------

test('stages run the link: the hold lasts until the scope commits, and a terminal result ends it', () => {
    pendingLink();
    assert.deepEqual(fields(store.getShareViewSnapshot()), ['pending', null, true, false]);
    store.beginShareViewStage('A');
    assert.deepEqual(fields(store.getShareViewSnapshot()), ['running', 'A', true, false]);
    store.markShareViewScopeCommitted();
    assert.deepEqual(fields(store.getShareViewSnapshot()), ['running', 'A', false, false]);
    for (const stage of ['B', 'C', 'D']) {
        store.beginShareViewStage(stage);
        assert.deepEqual(fields(store.getShareViewSnapshot()), ['running', stage, false, false]);
    }
    assert.equal(store.finishShareView('done'), true);
    const snap = store.getShareViewSnapshot();
    assert.deepEqual(fields(snap), ['done', 'D', false, true]);
    assert.equal(snap.notice, null);
});

test('a same-scope link releases the hold without ever running Stage A', () => {
    pendingLink();
    store.markShareViewScopeCommitted();
    assert.deepEqual(fields(store.getShareViewSnapshot()), ['pending', null, false, false]);
});

test('a terminal result releases the hold even when the scope never committed', () => {
    for (const result of ['done', 'partial', 'dropped', 'cancelled']) {
        store.resetShareViewForTests();
        pendingLink();
        assert.equal(store.getShareViewSnapshot().hold, true);
        assert.equal(store.finishShareView(result, ['group']), true, result);
        const snap = store.getShareViewSnapshot();
        assert.deepEqual([snap.phase, snap.hold, snap.terminal], [result, false, true], result);
    }
});

test('partial and dropped results carry a notice with their categories; done and cancelled carry none', () => {
    for (const [result, notice] of [
        ['partial', { kind: 'partial', categories: ['filters', 'teams'] }],
        ['dropped', { kind: 'dropped', categories: ['filters', 'teams'] }],
        ['done', null],
        ['cancelled', null],
    ]) {
        store.resetShareViewForTests();
        pendingLink();
        store.finishShareView(result, ['filters', 'teams', 'filters']);
        assert.deepEqual(store.getShareViewSnapshot().notice, notice, result);
    }
    store.resetShareViewForTests();
    pendingLink();
    store.finishShareView('partial');
    assert.deepEqual(store.getShareViewSnapshot().notice, { kind: 'partial', categories: [] });
});

test('only the first terminal result counts, and stages after it change nothing', () => {
    pendingLink();
    assert.equal(store.finishShareView('partial', ['filters']), true);
    const ended = store.getShareViewSnapshot();
    assert.equal(store.finishShareView('dropped', ['group']), false);
    store.beginShareViewStage('A');
    store.markShareViewScopeCommitted();
    assert.equal(store.getShareViewSnapshot(), ended);
    assert.deepEqual(ended.notice, { kind: 'partial', categories: ['filters'] });
});

test('finish and the stage calls ignore an absent link and an unknown result', () => {
    const initial = store.getShareViewSnapshot();
    assert.equal(store.finishShareView('done'), false);
    store.beginShareViewStage('A');
    store.markShareViewScopeCommitted();
    assert.equal(store.getShareViewSnapshot(), initial);
    pendingLink();
    assert.equal(store.finishShareView('finished'), false);
    assert.equal(store.finishShareView(undefined), false);
    assert.equal(store.getShareViewSnapshot().phase, 'pending');
});

test('a terminal link from the entry cannot be finished again', () => {
    store.initShareViewFromLocation(fakeWindow('/?v=2&mode=board').win);
    assert.equal(store.finishShareView('dropped', ['group']), false);
    assert.deepEqual(store.getShareViewSnapshot().notice, { kind: 'newer', categories: [] });
});

test('dismissing the notice clears it and nothing else', () => {
    store.initShareViewFromLocation(fakeWindow('/?v=1.0').win);
    store.dismissShareViewNotice();
    const snap = store.getShareViewSnapshot();
    assert.deepEqual(fields(snap), ['dropped', null, false, true]);
    assert.equal(snap.notice, null);
    store.dismissShareViewNotice();
    assert.equal(store.getShareViewSnapshot(), snap, 'dismissing with no notice changes nothing');
});

// --- useSyncExternalStore contract -------------------------------------------------------------

test('the snapshot is stable and frozen until something changes, and listeners hear each change once', () => {
    const initial = store.getShareViewSnapshot();
    assert.equal(store.getShareViewSnapshot(), initial);
    assert.equal(Object.isFrozen(initial), true);
    const heard = [];
    const unsubscribe = store.subscribeShareView(() => heard.push(store.getShareViewSnapshot()));
    pendingLink();
    assert.equal(heard.length, 1);
    assert.notEqual(heard[0], initial);
    assert.equal(heard[0], store.getShareViewSnapshot());
    store.dismissShareViewNotice();
    assert.equal(heard.length, 1, 'no notice, no change');
    store.beginShareViewStage('A');
    store.beginShareViewStage('A');
    assert.equal(heard.length, 2, 'the same stage twice is one change');
    store.markShareViewScopeCommitted();
    store.markShareViewScopeCommitted();
    assert.equal(heard.length, 3, 'the same commit twice is one change');
    unsubscribe();
    store.beginShareViewStage('B');
    assert.equal(heard.length, 3, 'an unsubscribed listener is not called');
    const frozen = store.getShareViewSnapshot();
    frozen.phase = 'tampered';
    assert.equal(store.getShareViewSnapshot().phase, 'running');
});

test('a listener may unsubscribe while the store notifies', () => {
    const calls = [];
    const first = store.subscribeShareView(() => { calls.push('first'); first(); });
    store.subscribeShareView(() => calls.push('second'));
    pendingLink();
    store.beginShareViewStage('A');
    assert.deepEqual(calls, ['first', 'second', 'second']);
});

// --- Planning row seed and test reset ----------------------------------------------------------

test('the Planning row seed is one-shot and takes only epic or story', () => {
    assert.equal(store.takeInitialPlanningRowMode(), null);
    store.setPendingPlanningRowMode('story');
    assert.equal(store.takeInitialPlanningRowMode(), 'story');
    assert.equal(store.takeInitialPlanningRowMode(), null);
    store.setPendingPlanningRowMode('epic');
    store.setPendingPlanningRowMode('stories');
    assert.equal(store.takeInitialPlanningRowMode(), null, 'an invalid mode clears the seed');
    store.setPendingPlanningRowMode('epic');
    assert.equal(store.takeInitialPlanningRowMode(), 'epic');
});

test('the seed is not part of the snapshot and survives the end of the apply', () => {
    pendingLink();
    store.setPendingPlanningRowMode('story');
    store.finishShareView('cancelled');
    assert.equal(store.takeInitialPlanningRowMode(), 'story', 'a table that mounts after a cancel still takes its seed');
});

test('the test reset restores the absent store and drops listeners and the seed', () => {
    const heard = [];
    store.subscribeShareView(() => heard.push('heard'));
    pendingLink();
    store.setPendingPlanningRowMode('epic');
    store.markShareViewScopeCommitted();
    heard.length = 0;
    store.resetShareViewForTests();
    assert.deepEqual(fields(store.getShareViewSnapshot()), ['absent', null, false, false]);
    assert.equal(store.takeInitialPlanningRowMode(), null);
    pendingLink();
    assert.equal(store.getShareViewSnapshot().hold, true, 'the commit flag was reset');
    assert.deepEqual(heard, [], 'listeners were dropped');
});

// --- Guard: no browser storage, cookies or network ---------------------------------------------

test('the store and entry never use browser storage, cookies or the network', () => {
    for (const file of ['store.js', 'entry.js']) {
        const source = fs.readFileSync(path.join(SHARE_VIEW, file), 'utf8');
        assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|\bfetch\s*\(|XMLHttpRequest/, file);
    }
});

// --- Guards: the entry module runs first -------------------------------------------------------

test('dashboard.jsx imports the share-view entry module first, and only there', () => {
    const source = fs.readFileSync(path.join(SRC, 'dashboard.jsx'), 'utf8');
    const firstStatement = source.split('\n').find((line) => line.trim() && !line.trim().startsWith('//'));
    assert.equal(firstStatement, "import './shareView/entry.js';");
    assert.equal(source.split("'./shareView/entry.js'").length - 1, 1);
});

test('in the real dashboard bundle only the entry dependencies are evaluated before the entry', async () => {
    // The same options as scripts/build_dashboard.mjs: lazy views are split out of the main file.
    const result = await esbuild.build({
        entryPoints: [path.join(SRC, 'dashboard.jsx')],
        absWorkingDir: path.join(__dirname, '..'),
        bundle: true, write: false, metafile: true, format: 'esm', splitting: true, outdir: 'dist', logLevel: 'silent',
        loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"development"' },
    });
    const main = result.outputFiles.find((file) => path.basename(file.path) === 'dashboard.js');
    // esbuild writes a "// path" marker before each module of the main file, in evaluation order.
    const evaluated = [...main.text.matchAll(/^\/\/ (frontend\/src\/[^\n]+)$/gm)].map((match) => match[1]);
    const entry = 'frontend/src/shareView/entry.js';
    const dependencies = new Set();
    const visit = (file) => {
        if (dependencies.has(file)) return;
        dependencies.add(file);
        (result.metafile.inputs[file]?.imports || []).filter((edge) => edge.kind === 'import-statement').forEach((edge) => visit(edge.path));
    };
    visit(entry);
    const at = evaluated.indexOf(entry);
    assert.ok(at >= 0, 'the entry module is part of the dashboard bundle');
    assert.deepEqual(evaluated.slice(0, at).filter((file) => !dependencies.has(file)), []);
    assert.equal(evaluated.slice(at + 1).some((file) => dependencies.has(file)), false);
});

test('the bundle evaluates the entry module, and so strips the URL, before any module imported after it', async () => {
    const order = [];
    const probes = {
        name: 'probes',
        setup(build) {
            build.onResolve({ filter: /^probe:/ }, ({ path: id }) => ({ path: id, namespace: 'probes' }));
            build.onLoad({ filter: /.*/, namespace: 'probes' }, ({ path: id }) => ({
                contents: `globalThis.__order.push(${JSON.stringify(id)});`, loader: 'js',
            }));
        },
    };
    const result = await esbuild.build({
        stdin: {
            contents: [
                "import './shareView/entry.js';",
                "import 'probe:first';",
                "import 'probe:second';",
                "export * from './shareView/store.js';",
            ].join('\n'),
            resolveDir: SRC,
        },
        bundle: true, write: false, format: 'iife', globalName: 'bundle', platform: 'browser', plugins: [probes],
    });
    const page = fakeWindow('/?v=1&mode=board&group=g1&sprint=4182&perf=1', { onReplace: () => order.push('strip') });
    const context = vm.createContext({ window: page.win, __order: order });
    vm.runInContext(result.outputFiles[0].text, context);
    assert.deepEqual(order, ['strip', 'probe:first', 'probe:second']);
    const snap = vm.runInContext('bundle.getShareViewSnapshot()', context);
    assert.equal(snap.phase, 'pending');
    assert.equal(snap.entry.state.mode, 'board');
    assert.equal(page.current(), '/?perf=1');
});
