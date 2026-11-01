const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToString } = require('react-dom/server');

// closeSingleIssueStatusControl(onlyIfKey) must close the shared single-issue target only when it
// belongs to that key; the open options request is the observable (its signal aborts on close).

async function mountHook() {
    const module = await import('../frontend/src/eng/useEngStatusTransitions.js');
    module.clearTransitionOptionsCache();
    const signals = new Map();
    globalThis.fetch = (url, options) => {
        const keys = JSON.parse(options.body).issueKeys;
        signals.set(keys[0], options.signal);
        return new Promise(() => {});
    };
    let api = null;
    function Probe() {
        api = module.useEngStatusTransitions({ backendUrl: '', trackIssueStatusAction: () => {}, sourceSurface: 'board' });
        return null;
    }
    renderToString(React.createElement(Probe));
    return { api, signals };
}

const epic = (key) => ({ key, fields: { issuetype: { name: 'Epic' }, status: { name: 'In Progress' }, project: { key: 'PLAT' } } });

test("closeSingleIssueStatusControl('X') leaves an open target 'Y' open", async () => {
    const { api, signals } = await mountHook();
    api.openSingleIssueStatusControl(epic('PLAT-2'), 'Epic');
    assert.ok(signals.get('PLAT-2'), 'the options request for Y is in flight');
    api.closeSingleIssueStatusControl('PLAT-1');
    assert.equal(signals.get('PLAT-2').aborted, false, 'a different key must not close Y');
    api.closeSingleIssueStatusControl({ type: 'click' });
    assert.equal(signals.get('PLAT-2').aborted, true, 'a non-string argument behaves as the unkeyed close');
});

test("closeSingleIssueStatusControl('Y') and the unkeyed call both close target 'Y'", async () => {
    const first = await mountHook();
    first.api.openSingleIssueStatusControl(epic('PLAT-2'), 'Epic');
    first.api.closeSingleIssueStatusControl('PLAT-2');
    assert.equal(first.signals.get('PLAT-2').aborted, true);
    const second = await mountHook();
    second.api.openSingleIssueStatusControl(epic('PLAT-2'), 'Epic');
    second.api.closeSingleIssueStatusControl();
    assert.equal(second.signals.get('PLAT-2').aborted, true);
});
