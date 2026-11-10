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

test('new (rnd_2027) model: the Allocation stamp decides Product/Tech over the project key', async () => {
    const { classifyCapacityIssue } = await loadUtils();
    const stamped = (key, epicKey, stamp) => ({ key, fields: { projectKey: 'TECH', epicKey, projectClassification: stamp } });

    assert.deepEqual(
        classifyCapacityIssue(stamped('PLAN-E2', 'EPIC-9', 'product'), { techProjectKeys, adHocEpicSet }),
        { projectType: 'product', capacityType: 'product', productSubtype: 'standard' }
    );
    assert.deepEqual(
        classifyCapacityIssue({ key: 'PLAN-E3', fields: { projectKey: 'PROD', epicKey: 'EPIC-9', projectClassification: 'tech' } }, { techProjectKeys, adHocEpicSet }),
        { projectType: 'tech', capacityType: 'tech', productSubtype: null }
    );
});

test('ad hoc follows the Initiative class in DELIVERY', async () => {
    const { classifyCapacityIssue } = await loadUtils();
    const stamped = (stamp) => ({ key: 'PLAN-E1', fields: { projectKey: 'PROD', epicKey: 'ADHOC-1', projectClassification: stamp } });

    assert.deepEqual(
        classifyCapacityIssue(stamped('tech'), { techProjectKeys, adHocEpicSet }),
        { projectType: 'tech', capacityType: 'ad_hoc', productSubtype: null }
    );
    assert.deepEqual(
        classifyCapacityIssue(stamped('none'), { techProjectKeys, adHocEpicSet }),
        { projectType: 'none', capacityType: 'ad_hoc', productSubtype: null }
    );
    assert.deepEqual(
        classifyCapacityIssue(stamped('product'), { techProjectKeys, adHocEpicSet }),
        { projectType: 'product', capacityType: 'ad_hoc', productSubtype: 'ad_hoc' }
    );
    // A Board child carries the stamp at the top level.
    assert.equal(classifyCapacityIssue({ key: 'ADHOC-1', projectClassification: 'tech' }, { techProjectKeys, adHocEpicSet }).projectType, 'tech');
});

test('unmapped stamp is No Allocation, never Product', async () => {
    const { classifyCapacityIssue, projectClassOf, isTechIssue } = await loadUtils();
    const unmapped = { key: 'PLAN-E4', fields: { projectKey: 'TECH', epicKey: 'EPIC-9', projectClassification: 'none' } };

    assert.deepEqual(
        classifyCapacityIssue(unmapped, { techProjectKeys, adHocEpicSet }),
        { projectType: 'none', capacityType: 'none', productSubtype: null }
    );
    assert.equal(projectClassOf(unmapped, techProjectKeys), 'none');
    assert.equal(projectClassOf({ key: 'PLAN-E5', projectClassification: 'none' }, new Set()), 'none');
    assert.equal(isTechIssue(unmapped, techProjectKeys), false);
    // Legacy (no stamp) is never 'none'; an unknown stamp (Legacy Board 'other') falls back to the project key.
    assert.equal(projectClassOf({ key: 'TECH-1', fields: {} }, techProjectKeys), 'tech');
    assert.equal(projectClassOf({ key: 'PROD-1', fields: {} }, techProjectKeys), 'product');
    assert.equal(projectClassOf({ key: 'TECH-2', projectClassification: 'other' }, techProjectKeys), 'tech');
    assert.equal(projectClassOf(null, techProjectKeys), 'product');
});

test('Legacy Ad Hoc in a Tech project is still Product', async () => {
    const { classifyCapacityIssue } = await loadUtils();

    assert.deepEqual(
        classifyCapacityIssue({ key: 'TECH-11', fields: { projectKey: 'TECH', epicKey: 'ADHOC-1' } }, { techProjectKeys, adHocEpicSet }),
        { projectType: 'product', capacityType: 'ad_hoc', productSubtype: 'ad_hoc' }
    );
});
