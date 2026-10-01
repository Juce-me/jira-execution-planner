import test from 'node:test';
import assert from 'node:assert/strict';
import { GLARE_CAP, glareDelayMs, selectGlareKeys } from '../frontend/src/eng/epicRefreshGlare.js';

const rect = (top, height = 60) => ({ top, bottom: top + height });
const viewport = { top: 100, bottom: 700 };

test('selects only mounted, in-viewport keys below the sticky stack, top first', () => {
    const rects = new Map([['A', rect(300)], ['B', rect(120)], ['C', rect(40)], ['D', rect(800)]]);
    const keys = selectGlareKeys({ changedKeys: ['A', 'B', 'C', 'D', 'E'], rects, viewport });
    assert.deepEqual(keys, ['B', 'A']);
});

test('suppressed keys never glint and the cap is 8', () => {
    const rects = new Map(Array.from({ length: 12 }, (_, i) => [`K${i}`, rect(110 + i * 20)]));
    const keys = selectGlareKeys({ changedKeys: [...rects.keys()], rects, viewport, suppressed: new Set(['K0']) });
    assert.equal(GLARE_CAP, 8);
    assert.equal(keys.length, 8);
    assert.ok(!keys.includes('K0'));
});

test('delay grows with distance below the viewport top', () => {
    assert.equal(glareDelayMs(100, 100), 0);
    assert.equal(glareDelayMs(600, 100), 200);
    assert.equal(glareDelayMs(50, 100), 0);
});

test('cap keeps the topmost 8 when candidates arrive bottom-first', () => {
    const rects = new Map(Array.from({ length: 12 }, (_, i) => [`K${i}`, rect(110 + i * 20)]));
    const changedKeys = [...rects.keys()].reverse();
    const keys = selectGlareKeys({ changedKeys, rects, viewport });
    assert.deepEqual(keys, ['K0', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7']);
});
