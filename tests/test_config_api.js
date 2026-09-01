import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCapacityConfigPayload } from '../frontend/src/api/configApi.js';

test('capacity save payload is scoped to editable fields and an integer revision', () => {
    assert.deepEqual(buildCapacityConfigPayload({
        project: 'CAP',
        fieldId: 'customfield_10001',
        fieldName: 'Capacity',
        baseRevision: 7,
        workspaceId: 'forbidden',
        siteUrl: 'forbidden',
        fieldSchemaType: 'number',
    }), {
        project: 'CAP',
        fieldId: 'customfield_10001',
        fieldName: 'Capacity',
        baseRevision: 7,
    });
    assert.deepEqual(buildCapacityConfigPayload({ project: 'CAP', fieldId: 'customfield_10001', fieldName: 'Capacity', baseRevision: '7' }), {
        project: 'CAP', fieldId: 'customfield_10001', fieldName: 'Capacity',
    });
});
