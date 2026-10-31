const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

async function loadEvents() {
    return import('../frontend/src/analytics/events.js');
}

test('the Project configuration editor reuses settings_action with section work_configurations', async () => {
    const { sanitizeAnalyticsParams } = await loadEvents();
    for (const workflowAction of ['open', 'save', 'save_result']) {
        assert.deepEqual(
            sanitizeAnalyticsParams({
                feature_name: 'settings',
                section: 'work_configurations',
                workflow_action: workflowAction,
                source_surface: 'settings',
                result: 'success',
                dirty_state: 'dirty',
                validation_count_bucket: '1_5',
            }, 'settings_action'),
            {
                feature_name: 'settings',
                section: 'work_configurations',
                workflow_action: workflowAction,
                source_surface: 'settings',
                result: 'success',
                dirty_state: 'dirty',
                validation_count_bucket: '1_5',
            });
    }
    assert.deepEqual(
        sanitizeAnalyticsParams({
            feature_name: 'settings', section: 'work_configurations', workflow_action: 'save_result',
            result: 'failure', conflict_state: 'remote', conflict_count_bucket: '1_5',
        }, 'settings_action').conflict_state, 'remote');
});

test('native Initiative work uses the existing safe kinds and no new vocabulary is needed', async () => {
    const { sanitizeAnalyticsParams } = await loadEvents();
    for (const kind of ['initiative', 'epic', 'story', 'mixed']) {
        assert.equal(sanitizeAnalyticsParams({ feature_name: 'external_links', issue_kind: kind }, 'external_link_opened').issue_kind, kind);
    }
    assert.equal(sanitizeAnalyticsParams({
        feature_name: 'eng_status_transitions', workflow_action: 'status_change_submit', source_surface: 'planning',
        issue_type_mix: 'initiatives',
    }, 'issue_status_action').issue_type_mix, 'initiatives');
});

test('configuration identity can never ride an analytics parameter', async () => {
    const { sanitizeAnalyticsParams } = await loadEvents();
    for (const name of ['configuration_id', 'configuration_revision', 'configuration_digest', 'quarter', 'jql',
        'field_id', 'board_id', 'project_key']) {
        assert.throws(
            () => sanitizeAnalyticsParams({ feature_name: 'settings', [name]: 'x' }, 'settings_action'),
            /unsupported analytics parameter/, name);
    }
    for (const value of ['cfg:legacy:1:abc', 'PLAN-12', 'project in (PLAN)', 'customfield_10101 = 5',
        'Legacy 2026', 'https://example.test/browse/PLAN-1']) {
        assert.throws(
            () => sanitizeAnalyticsParams({ feature_name: 'settings', section: value }, 'settings_action'),
            /unsafe analytics value/, value);
    }
});

test('work configuration adds no event name and no standalone auto-load event', async () => {
    const source = read('frontend/src/analytics/events.js');
    const names = source.slice(source.indexOf('EVENT_NAMES = new Set(['), source.indexOf(']);', source.indexOf('EVENT_NAMES')));
    assert.doesNotMatch(names, /work_config|configuration|quarter/i);
    const { sanitizeAnalyticsParams } = await loadEvents();
    for (const eventName of ['work_configuration_loaded', 'quarter_changed', 'work_configurations_action']) {
        assert.throws(() => sanitizeAnalyticsParams({ feature_name: 'settings' }, eventName), /unsupported analytics event_name/);
    }
});

test('the taxonomy documents the contract exactly once and keeps identity out', () => {
    const doc = read('docs/README_ANALYTICS.md');
    const marker = 'Quarterly work configuration: Project configuration Settings editor';
    assert.equal(doc.split(marker).length - 1, 1);
    const row = doc.split('\n').find(line => line.includes(marker));
    assert.ok(row.includes('`section=work_configurations`'));
    assert.ok(row.includes('`issue_kind=initiative`'));
    assert.ok(row.includes('no new standalone auto-load event'));
    assert.ok(row.includes('No GA4 admin or runbook change'));
    assert.match(row, /Never send configuration names or ids, revisions, digests/);
});

test('editor, context hook and request builders never forward configuration identity to analytics', () => {
    const files = [
        'frontend/src/settings/WorkConfigurationsEditor.jsx',
        'frontend/src/settings/useWorkConfigurationSettings.js',
        'frontend/src/workStructure/useActiveWorkContext.js',
        'frontend/src/api/statsApi.js',
        'frontend/src/api/epmApi.js',
    ];
    const call = /\btrack(?:ProductEvent|SettingsAction|StatsAction|EpmAction|Event|AppError|ApiResult)\s*\(([\s\S]{0,600}?)\)\s*;/g;
    const identity = /configuration(?:Id|Revision|Digest|Name)|\bdigest\b|\brevision\b|fieldId|fieldName|\bjql\b|projectKey|boardId|quarter/i;
    for (const relative of files) {
        const full = path.join(ROOT, relative);
        if (!fs.existsSync(full)) continue;
        const source = fs.readFileSync(full, 'utf8');
        for (const match of source.matchAll(call)) {
            assert.doesNotMatch(match[1], identity, `${relative}: ${match[0].slice(0, 120)}`);
        }
    }
});
