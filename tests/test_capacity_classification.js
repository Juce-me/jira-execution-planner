const test = require('node:test');
const assert = require('node:assert/strict');

async function loadUtils() {
    return import('../frontend/src/capacityClassification.mjs');
}

const techProjectKeys = new Set(['TECH']);
const adHocEpicSet = new Set(['ADHOC-1']);

test('Tech-project Ad Hoc story is reclassified as Product', async () => {
    const { classifyCapacityIssue } = await loadUtils();

    assert.deepEqual(
        classifyCapacityIssue(
            { key: 'TECH-10', fields: { projectKey: 'TECH', epicKey: 'adhoc-1' } },
            { techProjectKeys, adHocEpicSet }
        ),
        { projectType: 'product', capacityType: 'ad_hoc', productSubtype: 'ad_hoc' }
    );
});

test('ordinary Product story stays Product/standard', async () => {
    const { classifyCapacityIssue } = await loadUtils();

    assert.deepEqual(
        classifyCapacityIssue(
            { key: 'PROD-1', fields: { projectKey: 'PROD', epicKey: 'EPIC-9' } },
            { techProjectKeys, adHocEpicSet }
        ),
        { projectType: 'product', capacityType: 'product', productSubtype: 'standard' }
    );
});

test('ordinary Tech story stays Tech', async () => {
    const { classifyCapacityIssue } = await loadUtils();

    assert.deepEqual(
        classifyCapacityIssue(
            { key: 'TECH-2', fields: { projectKey: 'TECH', epicKey: 'EPIC-9' } },
            { techProjectKeys, adHocEpicSet }
        ),
        { projectType: 'tech', capacityType: 'tech', productSubtype: null }
    );
});

test('story without explicit projectKey falls back to key prefix and parentKey', async () => {
    const { classifyCapacityIssue } = await loadUtils();

    assert.deepEqual(
        classifyCapacityIssue(
            { key: 'TECH-3', fields: { parentKey: 'adhoc-1' } },
            { techProjectKeys, adHocEpicSet }
        ),
        { projectType: 'product', capacityType: 'ad_hoc', productSubtype: 'ad_hoc' }
    );
});

test('blank or missing keys classify as standard Product', async () => {
    const { classifyCapacityIssue } = await loadUtils();

    assert.deepEqual(
        classifyCapacityIssue({ fields: {} }, { techProjectKeys, adHocEpicSet }),
        { projectType: 'product', capacityType: 'product', productSubtype: 'standard' }
    );
    assert.deepEqual(
        classifyCapacityIssue({}, { techProjectKeys, adHocEpicSet }),
        { projectType: 'product', capacityType: 'product', productSubtype: 'standard' }
    );
    assert.deepEqual(
        classifyCapacityIssue(null, { techProjectKeys, adHocEpicSet }),
        { projectType: 'product', capacityType: 'product', productSubtype: 'standard' }
    );
});

test('Epic-level cohort record matches Ad Hoc by its own key', async () => {
    const { classifyCapacityIssue } = await loadUtils();

    assert.deepEqual(
        classifyCapacityIssue(
            { key: 'adhoc-1', projectKey: 'TECH' },
            { techProjectKeys, adHocEpicSet }
        ),
        { projectType: 'product', capacityType: 'ad_hoc', productSubtype: 'ad_hoc' }
    );
});

test('empty Ad Hoc set leaves Tech story as Tech', async () => {
    const { classifyCapacityIssue } = await loadUtils();

    assert.deepEqual(
        classifyCapacityIssue(
            { key: 'TECH-10', fields: { projectKey: 'TECH', epicKey: 'adhoc-1' } },
            { techProjectKeys, adHocEpicSet: new Set() }
        ),
        { projectType: 'tech', capacityType: 'tech', productSubtype: null }
    );
});
