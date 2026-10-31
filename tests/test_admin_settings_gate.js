import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ADMIN_SETTINGS_GATE_PENDING,
    firstMissingAdminSettingsTab,
    resolveAdminSettingsGate,
    resolveMissingByConfiguration,
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

test('after promotion per-configuration missing setup never feeds the flat auto-open gate', () => {
    assert.deepEqual(resolveAdminSettingsGate({
        workConfigurationsPromoted: true,
        adminSettingsMissing: ['scope', 'source'],
        adminSettingsMissingByConfiguration: { delivery: ['Jira project'] },
        adminContacts: ['Alice Admin'],
    }), { status: 'clear', missing: [], contacts: ['Alice Admin'] });
    // Unpromoted workspaces keep the flat gate even when the feature flag is on.
    assert.equal(resolveAdminSettingsGate({ workConfigurationsEnabled: true, workConfigurationsPromoted: false, adminSettingsMissing: ['scope'] }).status, 'missing');
});

test('per-configuration missing lists keep only string entries and ignore malformed shapes', () => {
    assert.deepEqual(resolveMissingByConfiguration({ adminSettingsMissingByConfiguration: { delivery: ['Jira project', 4], legacy: 'x' } }), { delivery: ['Jira project'] });
    assert.deepEqual(resolveMissingByConfiguration({ adminSettingsMissingByConfiguration: [] }), {});
    assert.deepEqual(resolveMissingByConfiguration(null), {});
});
