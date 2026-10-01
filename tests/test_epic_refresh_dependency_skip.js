const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const helperPath = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'epicRefreshDependencySkip.js');
const source = fs.readFileSync(helperPath, 'utf8').replaceAll('export function ', 'function ');
const { createDependencySkip } = new Function(`${source}; return { createDependencySkip };`)();

test('a matching signature and epoch is consumed exactly once', () => {
    const skip = createDependencySkip();
    skip.arm('A|B', 4);
    assert.deepEqual(skip.peek(), { signature: 'A|B', epoch: 4 });
    assert.equal(skip.consume('A|B', 4), true);
    assert.equal(skip.peek(), null);
    assert.equal(skip.consume('A|B', 4), false);
});

test('consume without an armed entry is false', () => {
    assert.equal(createDependencySkip().consume('A', 0), false);
});

test('a wrong signature is rejected and the one-shot entry is disarmed', () => {
    const skip = createDependencySkip();
    skip.arm('A|B', 4);
    assert.equal(skip.consume('A', 4), false);
    assert.equal(skip.peek(), null);
    assert.equal(skip.consume('A|B', 4), false);
});

test('a department load between arm and consume rejects the stale entry', () => {
    const skip = createDependencySkip();
    skip.arm('A|B', 4);
    assert.equal(skip.consume('A|B', 5), false, 'epoch bumped by a department load');
    assert.equal(skip.peek(), null);
    assert.equal(skip.consume('A|B', 5), false);
});

test('disarm clears the entry and re-arming replaces it', () => {
    const skip = createDependencySkip();
    skip.arm('A', 1);
    skip.disarm();
    assert.equal(skip.peek(), null);
    assert.equal(skip.consume('A', 1), false);
    skip.arm('A', 1);
    skip.arm('B', 2);
    assert.equal(skip.consume('A', 1), false);
    skip.arm('B', 2);
    assert.equal(skip.consume('B', 2), true);
});
