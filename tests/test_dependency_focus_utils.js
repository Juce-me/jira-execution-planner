const test = require('node:test');
const assert = require('node:assert/strict');

async function loadUtils() {
    return import('../frontend/src/issues/dependencyFocusUtils.js');
}

test('buildDependencyKeySignature returns sorted unique issue keys', async () => {
    const { buildDependencyKeySignature } = await loadUtils();

    assert.equal(
        buildDependencyKeySignature([
            { key: 'TECH-2' },
            { key: '' },
            { key: 'PROD-1' },
            { key: 'TECH-2' },
            {}
        ]),
        'PROD-1|TECH-2'
    );
});

test('buildIssueByKey maps keyed tasks and preserves the latest duplicate', async () => {
    const { buildIssueByKey } = await loadUtils();
    const first = { key: 'PROD-1', summary: 'first' };
    const second = { key: 'PROD-1', summary: 'second' };
    const map = buildIssueByKey([first, {}, second]);

    assert.equal(map.size, 1);
    assert.equal(map.get('PROD-1'), second);
});

test('buildDependencyKeys filters by action direction and de-duplicates key-direction pairs', async () => {
    const { buildDependencyKeys } = await loadUtils();
    const dependencyData = {
        'PROD-1': [
            { key: 'PROD-2', category: 'dependency', direction: 'outward' },
            { key: 'PROD-2', category: 'dependency', direction: 'outward' },
            { key: 'PROD-3', category: 'dependency', direction: 'inward' },
            { key: 'PROD-4', category: 'block', direction: 'outward' },
        ]
    };

    assert.deepEqual(buildDependencyKeys(dependencyData, 'PROD-1', 'depends-on'), ['PROD-2']);
    assert.deepEqual(buildDependencyKeys(dependencyData, 'PROD-1', 'dependents'), ['PROD-3']);
});

test('buildBlockLinkBuckets resolves block direction and unique keys', async () => {
    const { buildBlockLinkBuckets } = await loadUtils();

    assert.deepEqual(
        buildBlockLinkBuckets([
            { key: 'PROD-2', category: 'block', prereqKey: 'PROD-2', dependentKey: 'PROD-1' },
            { key: 'PROD-2', category: 'block', prereqKey: 'PROD-2', dependentKey: 'PROD-1' },
            { key: 'PROD-1', category: 'block', prereqKey: 'PROD-1', dependentKey: 'PROD-3' },
            { key: 'PROD-4', category: 'block', direction: 'inward' },
            { key: 'PROD-5', category: 'block', direction: 'outward' },
        ], 'PROD-1'),
        {
            blockedBy: ['PROD-2', 'PROD-4'],
            blocks: ['PROD-3', 'PROD-5']
        }
    );
});

test('buildDependencyFocusPayload includes related and missing keys', async () => {
    const { buildDependencyFocusPayload } = await loadUtils();
    const dependencyData = {
        'PROD-1': [
            { key: 'PROD-2', category: 'dependency', direction: 'outward' },
            { key: 'PROD-3', category: 'dependency', direction: 'outward' },
        ]
    };
    const issueByKey = new Map([['PROD-1', {}], ['PROD-2', {}]]);

    assert.deepEqual(
        buildDependencyFocusPayload({
            taskKey: 'PROD-1',
            action: 'depends-on',
            dependencyData,
            issueByKey
        }),
        {
            taskKey: 'PROD-1',
            action: 'depends-on',
            relatedKeys: ['PROD-1', 'PROD-2', 'PROD-3'],
            dependencyKeys: ['PROD-2', 'PROD-3'],
            missingKeys: ['PROD-3']
        }
    );
});

test('buildDependencyFocusWithScreenState records loaded dependencies outside the viewport', async () => {
    const { buildDependencyFocusWithScreenState } = await loadUtils();
    const nodes = new Map([
        ['PROD-2', { getBoundingClientRect: () => ({ top: 20, bottom: 60 }) }],
        ['PROD-3', { getBoundingClientRect: () => ({ top: 110, bottom: 150 }) }],
        ['PROD-4', { getBoundingClientRect: () => ({ top: -60, bottom: -10 }) }],
    ]);
    const documentRef = {
        querySelector: (selector) => {
            const match = selector.match(/data-issue-key="([^"]+)"/);
            return match ? nodes.get(match[1]) || null : null;
        },
    };
    const payload = {
        taskKey: 'PROD-1',
        action: 'blocked-by',
        relatedKeys: ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4', 'PROD-5'],
        dependencyKeys: ['PROD-2', 'PROD-3', 'PROD-4', 'PROD-5'],
        missingKeys: ['PROD-5'],
    };

    assert.deepEqual(
        buildDependencyFocusWithScreenState(payload, {
            documentRef,
            cssRef: { escape: value => value },
            viewportHeight: 100,
        }),
        {
            ...payload,
            offscreenKeys: ['PROD-3', 'PROD-4'],
        }
    );
});
