const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../frontend/src/eng/planningRowModeChannel.js');

// A stand-in table: its quiet setter re-publishes the new mode, as the table's layout effect does after the render.
async function fixture() {
    const channel = await load();
    channel.resetPlanningRowModeForTests();
    const calls = { switches: [], collapses: 0 };
    const table = {
        // `seeded`: a link's rows; a plain mount starts in the Epics default, which is no choice.
        mount(mode = 'epic', { seeded = false } = {}) { channel.publishPlanningRowMode(mode, { setter: table.quiet, chosen: seeded }); },
        quiet(next) { calls.switches.push(next); channel.publishPlanningRowMode(next, { setter: table.quiet }); },
        user(next) { channel.publishPlanningRowMode(next, { setter: table.quiet, chosen: true }); },
        unmount() { channel.publishPlanningRowMode(null); },
    };
    const sync = channel.createStripRowModeSync({ collapse: () => { calls.collapses += 1; } });
    const disconnect = sync.connect();
    return { channel, calls, table, sync, disconnect };
}

test('expanding the strip from its header switches Epics to Stories once, never while open or on collapse (#323)', async () => {
    const { channel, calls, table, sync } = await fixture();
    table.mount('epic');
    sync.setOpen(true, { byUser: true });
    assert.deepEqual(calls.switches, ['story']);
    assert.equal(channel.getPlanningRowMode(), 'story');
    // The layout effect reports the same expansion again: nothing more happens.
    sync.setOpen(true);
    assert.deepEqual(calls.switches, ['story']);
    assert.equal(calls.collapses, 0, 'the switch to Stories does not collapse the strip');
    // Collapsing does not switch back, and re-expanding with Stories active changes nothing.
    sync.setOpen(false);
    sync.setOpen(true, { byUser: true });
    assert.deepEqual(calls.switches, ['story']);
    assert.equal(channel.getPlanningRowMode(), 'story');
});

test('switching to Epics while the strip is open collapses it once; re-expanding switches again (#323)', async () => {
    const { calls, table, sync } = await fixture();
    table.mount('story');
    sync.setOpen(true, { byUser: true });
    assert.deepEqual(calls.switches, [], 'Stories already active: no switch');
    table.user('epic');
    assert.equal(calls.collapses, 1);
    sync.setOpen(false);   // the strip re-renders collapsed
    table.user('story'); table.user('epic');
    assert.equal(calls.collapses, 1, 'a collapsed strip ignores later switches');
    sync.setOpen(true, { byUser: true });
    assert.deepEqual(calls.switches, ['story']);
    assert.equal(calls.collapses, 1, 'no ping-pong: the switch to Stories never collapses');
});

test('a strip shown expanded without the toggle: a chosen Epics collapses it, the mount default yields Stories, once (#323)', async () => {
    // A link chose Epics and the table mounted first; then the strip appears expanded from its preference.
    let { calls, table, sync } = await fixture();
    table.mount('epic', { seeded: true });
    sync.setOpen(true);
    assert.equal(calls.collapses, 1);
    assert.deepEqual(calls.switches, [], 'the chosen rows stay Epics');
    // The strip is already open when the table (re)mounts for a restored link in Epics.
    ({ calls, table, sync } = await fixture());
    sync.setOpen(true);
    assert.equal(calls.collapses, 0, 'no table yet');
    table.mount('epic', { seeded: true });
    assert.equal(calls.collapses, 1);
    // A clicked Epics, then a Team change shows the strip expanded again: still a choice, so it collapses.
    ({ calls, table, sync } = await fixture());
    table.mount('story'); table.user('epic');
    sync.setOpen(true);
    assert.equal(calls.collapses, 1);
    assert.deepEqual(calls.switches, []);
    // A reload or a Sprint switch remounts the table in its Epics default while the strip is open: Stories, once.
    ({ calls, table, sync } = await fixture());
    table.mount('epic');
    sync.setOpen(true);
    assert.deepEqual(calls.switches, ['story']);
    table.unmount(); table.mount('epic');
    assert.deepEqual(calls.switches, ['story', 'story'], 'each remount switches once');
    assert.equal(calls.collapses, 0);
    // A table mounted in Stories keeps the strip expanded and the rows untouched.
    ({ calls, table, sync } = await fixture());
    table.mount('story', { seeded: true });
    sync.setOpen(true);
    table.unmount(); table.mount('story');
    assert.equal(calls.collapses, 0);
    assert.deepEqual(calls.switches, []);
});

test('without a mounted table, a header expansion asks nothing; a disconnected strip hears nothing (#323)', async () => {
    const { channel, calls, table, sync, disconnect } = await fixture();
    sync.setOpen(true, { byUser: true });
    assert.deepEqual(calls.switches, []);
    table.mount('story'); table.unmount();
    assert.equal(channel.getPlanningRowMode(), null);
    disconnect();
    table.mount('epic');
    assert.equal(calls.collapses, 0);
});
