import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ADMIN_SETTINGS_GATE_PENDING,
    firstMissingAdminSettingsTab,
    resolveAdminSettingsGate,
} from '../frontend/src/settings/adminSettingsGate.js';

test('gate starts pending so ENG work waits for the configuration check', () => {
    assert.deepEqual(ADMIN_SETTINGS_GATE_PENDING, { status: 'pending', missing: [], contacts: [] });
});

test('configured and non-DB configs clear the gate', () => {
    assert.deepEqual(resolveAdminSettingsGate({ adminSettingsMissing: [] }), { status: 'clear', missing: [], contacts: [] });
    assert.deepEqual(resolveAdminSettingsGate({ authMode: 'basic' }), { status: 'clear', missing: [], contacts: [] });
});

test('missing sections block the gate and keep only known tabs and non-empty names', () => {
    assert.deepEqual(resolveAdminSettingsGate({
        adminSettingsMissing: ['scope', 'source', 'unknown'],
        adminContacts: ['Alice Admin', '', 7, 'Zed Admin'],
    }), { status: 'missing', missing: ['scope', 'source'], contacts: ['Alice Admin', 'Zed Admin'] });
});

test('first missing tab follows the Admin settings tab order', () => {
    assert.equal(firstMissingAdminSettingsTab(['source', 'scope']), 'scope');
    assert.equal(firstMissingAdminSettingsTab(['source']), 'source');
    assert.equal(firstMissingAdminSettingsTab([]), 'scope');
});
