const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadGroupVisibilityUtils() {
    const modulePath = path.join(__dirname, '..', 'frontend', 'src', 'settings', 'groupVisibilityUtils.js');
    assert.ok(fs.existsSync(modulePath), 'Expected frontend/src/settings/groupVisibilityUtils.js to exist');
    const source = fs.readFileSync(modulePath, 'utf8')
        .replaceAll('export const ', 'const ')
        .replaceAll('export function ', 'function ');
    return new Function(`${source}; return {
        normalizeGroupPreferences,
        effectiveVisibleGroupIds,
        visibleGroupsForControls,
        resolveVisibleActiveGroupId,
        buildGroupPreferencesPayload,
        buildFirstRunGroupPreferencesPayload,
        buildSharedGroupsPayload,
        groupPreferencesSignature
    };`)();
}

test('effectiveVisibleGroupIds shows all groups before customization', () => {
    const { effectiveVisibleGroupIds } = loadGroupVisibilityUtils();
    const groups = [{ id: 'default' }, { id: 'platform' }];

    assert.deepEqual(
        effectiveVisibleGroupIds({ groups, defaultGroupId: 'default' }, { customized: false, onboardingRequired: false }),
        ['default', 'platform']
    );
});

test('effectiveVisibleGroupIds returns no dashboard groups while first-run selection is required', () => {
    const { effectiveVisibleGroupIds } = loadGroupVisibilityUtils();
    const groups = [{ id: 'default' }, { id: 'platform' }];

    assert.deepEqual(
        effectiveVisibleGroupIds({ groups, defaultGroupId: 'default' }, { customized: false, onboardingRequired: true }),
        []
    );
});

test('effectiveVisibleGroupIds keeps default when user customizes', () => {
    const { effectiveVisibleGroupIds } = loadGroupVisibilityUtils();
    const groups = [{ id: 'default' }, { id: 'platform' }, { id: 'mobile' }];

    assert.deepEqual(
        effectiveVisibleGroupIds({ groups, defaultGroupId: 'default' }, { customized: true, visibleGroupIds: ['mobile'] }),
        ['default', 'mobile']
    );
});

test('effectiveVisibleGroupIds filters unknown customized visible ids', () => {
    const { effectiveVisibleGroupIds } = loadGroupVisibilityUtils();
    const groups = [{ id: 'default' }, { id: 'platform' }];

    assert.deepEqual(
        effectiveVisibleGroupIds({ groups, defaultGroupId: 'default' }, {
            customized: true,
            visibleGroupIds: ['missing', 'platform', 'platform']
        }),
        ['default', 'platform']
    );
});

test('visibleGroupsForControls returns shared group records for effective ids', () => {
    const { visibleGroupsForControls } = loadGroupVisibilityUtils();
    const groups = [
        { id: 'default', name: 'Default' },
        { id: 'platform', name: 'Platform' },
        { id: 'mobile', name: 'Mobile' },
    ];

    assert.deepEqual(
        visibleGroupsForControls({ groups, defaultGroupId: 'default' }, { customized: true, visibleGroupIds: ['mobile'] }),
        [
            { id: 'default', name: 'Default' },
            { id: 'mobile', name: 'Mobile' },
        ]
    );
});

test('resolveVisibleActiveGroupId falls back from hidden or missing active group', () => {
    const { resolveVisibleActiveGroupId } = loadGroupVisibilityUtils();
    const groups = [{ id: 'default' }, { id: 'platform' }];

    assert.equal(
        resolveVisibleActiveGroupId({ groups, defaultGroupId: 'default' }, ['default'], 'platform'),
        'default'
    );
});

test('resolveVisibleActiveGroupId falls back to first visible group then null', () => {
    const { resolveVisibleActiveGroupId } = loadGroupVisibilityUtils();
    const groups = [{ id: 'platform' }, { id: 'mobile' }];

    assert.equal(
        resolveVisibleActiveGroupId({ groups, defaultGroupId: 'default' }, ['mobile'], 'platform'),
        'mobile'
    );
    assert.equal(
        resolveVisibleActiveGroupId({ groups, defaultGroupId: 'default' }, [], 'platform'),
        null
    );
});

test('buildSharedGroupsPayload includes loaded base revision', () => {
    const { buildSharedGroupsPayload } = loadGroupVisibilityUtils();
    const draft = { version: 1, configRevision: 7, groups: [{ id: 'platform' }], defaultGroupId: 'platform' };

    assert.deepEqual(buildSharedGroupsPayload(draft), {
        version: 1,
        baseRevision: 7,
        groups: [{ id: 'platform' }],
        defaultGroupId: 'platform'
    });
});

test('group preferences payloads use visibleGroupIds and activeGroupId', () => {
    const {
        buildGroupPreferencesPayload,
        buildFirstRunGroupPreferencesPayload,
    } = loadGroupVisibilityUtils();

    assert.deepEqual(
        buildGroupPreferencesPayload(['platform', 'platform', ''], 'platform'),
        { visibleGroupIds: ['platform'], activeGroupId: 'platform' }
    );
    assert.deepEqual(
        buildFirstRunGroupPreferencesPayload(['mobile'], 'default'),
        { visibleGroupIds: ['default', 'mobile'], activeGroupId: 'mobile' }
    );
    assert.deepEqual(
        buildFirstRunGroupPreferencesPayload([], 'default'),
        { visibleGroupIds: ['default'], activeGroupId: 'default' }
    );
});

test('normalizeGroupPreferences preserves backend metadata and nested preferences', () => {
    const { normalizeGroupPreferences } = loadGroupVisibilityUtils();
    const normalized = normalizeGroupPreferences({
        configRevision: 4,
        source: 'database',
        groups: [{ id: 'default' }],
        defaultGroupId: 'default',
        preferences: {
            preferenceExists: true,
            customized: true,
            onboardingRequired: false,
            visibleGroupIds: ['platform'],
            activeGroupId: 'platform',
        },
    });

    assert.equal(normalized.configRevision, 4);
    assert.equal(normalized.source, 'database');
    assert.deepEqual(normalized.preferences, {
        preferenceExists: true,
        customized: true,
        onboardingRequired: false,
        visibleGroupIds: ['platform'],
        activeGroupId: 'platform',
    });
});

test('groupPreferencesSignature is stable for duplicate and unsorted visible ids', () => {
    const { groupPreferencesSignature } = loadGroupVisibilityUtils();

    assert.equal(
        groupPreferencesSignature({ visibleGroupIds: ['mobile', 'platform', 'mobile'], activeGroupId: 'platform' }),
        groupPreferencesSignature({ visibleGroupIds: ['platform', 'mobile'], activeGroupId: 'platform' })
    );
});
