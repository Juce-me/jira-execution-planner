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
        groupPreferencesSignature,
        safeAppLoginUrl: typeof safeAppLoginUrl === 'function' ? safeAppLoginUrl : undefined
    };`)();
}

function loadGroupConfigUtils() {
    const visibilityPath = path.join(__dirname, '..', 'frontend', 'src', 'settings', 'groupVisibilityUtils.js');
    const configPath = path.join(__dirname, '..', 'frontend', 'src', 'settings', 'groupConfigUtils.js');
    assert.ok(fs.existsSync(configPath), 'Expected frontend/src/settings/groupConfigUtils.js to exist');
    const visibilitySource = fs.readFileSync(visibilityPath, 'utf8')
        .replaceAll('export const ', 'const ')
        .replaceAll('export function ', 'function ');
    const configSource = fs.readFileSync(configPath, 'utf8')
        .replace(/import .*groupVisibilityUtils\.js';\n/, '')
        .replaceAll('export function ', 'function ');
    return new Function(`${visibilitySource}\n${configSource}; return { applyLocalGroupPreferences };`)();
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

test('workspace DB visibility never injects the shared default', () => {
    const { effectiveVisibleGroupIds, visibleGroupsForControls } = loadGroupVisibilityUtils();
    const config = {
        source: 'workspace_db',
        groups: [{ id: 'default' }, { id: 'platform' }],
        defaultGroupId: 'default',
    };
    const preferences = {
        customized: true,
        onboardingRequired: false,
        visibleGroupIds: ['platform'],
        activeGroupId: 'platform',
    };

    assert.deepEqual(effectiveVisibleGroupIds(config, preferences), ['platform']);
    assert.deepEqual(visibleGroupsForControls(config, preferences), [{ id: 'platform' }]);
});

test('workspace DB current scope falls back to the personal favorite before any shared default', () => {
    const { resolveVisibleActiveGroupId } = loadGroupVisibilityUtils();
    const config = {
        source: 'workspace_db',
        groups: [{ id: 'default' }, { id: 'platform' }, { id: 'mobile' }],
        defaultGroupId: 'default',
        preferences: { activeGroupId: 'mobile' },
    };

    assert.equal(resolveVisibleActiveGroupId(config, ['platform', 'mobile'], 'missing'), 'mobile');
    assert.equal(resolveVisibleActiveGroupId(config, ['platform'], 'missing'), 'platform');
});

test('file visibility and active-scope fallbacks retain shared-default behavior', () => {
    const { effectiveVisibleGroupIds, resolveVisibleActiveGroupId } = loadGroupVisibilityUtils();
    for (const source of ['file', 'env', 'auto']) {
        const config = {
            source,
            groups: [{ id: 'default' }, { id: 'platform' }],
            defaultGroupId: 'default',
        };
        assert.deepEqual(
            effectiveVisibleGroupIds(config, { customized: true, visibleGroupIds: ['platform'] }),
            ['default', 'platform']
        );
        assert.equal(resolveVisibleActiveGroupId(config, ['default', 'platform'], 'missing'), 'default');
    }
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
        buildFirstRunGroupPreferencesPayload('mobile'),
        { visibleGroupIds: ['mobile'], activeGroupId: 'mobile' }
    );
    assert.deepEqual(
        buildFirstRunGroupPreferencesPayload(''),
        { visibleGroupIds: [], activeGroupId: null }
    );
});

test('group visibility utilities do not own authentication recovery URLs', () => {
    const { safeAppLoginUrl } = loadGroupVisibilityUtils();
    assert.equal(safeAppLoginUrl, undefined);
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
            onboardingDone: false,
            visibleGroupIds: ['platform'],
            effectiveVisibleGroupIds: ['default', 'platform'],
            activeGroupId: 'platform',
        },
    });

    assert.equal(normalized.configRevision, 4);
    assert.equal(normalized.source, 'database');
    assert.deepEqual(normalized.preferences, {
        preferenceExists: true,
        customized: true,
        onboardingRequired: false,
        onboardingDone: false,
        visibleGroupIds: ['platform'],
        effectiveVisibleGroupIds: ['default', 'platform'],
        activeGroupId: 'platform',
    });
});

test('normalizeGroupPreferences defaults missing onboarding state to complete', () => {
    const { normalizeGroupPreferences } = loadGroupVisibilityUtils();

    assert.equal(normalizeGroupPreferences({ preferences: {} }).preferences.onboardingDone, true);
});

test('groupPreferencesSignature is stable for duplicate and unsorted visible ids', () => {
    const { groupPreferencesSignature } = loadGroupVisibilityUtils();

    assert.equal(
        groupPreferencesSignature({ visibleGroupIds: ['mobile', 'platform', 'mobile'], activeGroupId: 'platform' }),
        groupPreferencesSignature({ visibleGroupIds: ['platform', 'mobile'], activeGroupId: 'platform' })
    );
});

test('applyLocalGroupPreferences overlays browser visibility only for JSON sources', () => {
    const { applyLocalGroupPreferences } = loadGroupConfigUtils();
    const config = {
        version: 1,
        source: 'file',
        groups: [{ id: 'default', name: 'Default' }, { id: 'platform', name: 'Platform' }],
        defaultGroupId: 'default',
    };
    const normalized = applyLocalGroupPreferences(config, {
        groupVisibilityPreferences: {
            visibleGroupIds: ['platform'],
            activeGroupId: 'platform',
        },
    });

    assert.deepEqual(normalized.preferences.visibleGroupIds, ['platform']);
    assert.deepEqual(normalized.preferences.effectiveVisibleGroupIds, ['default', 'platform']);
    assert.equal(normalized.preferences.activeGroupId, 'platform');
    assert.equal(normalized.preferences.onboardingDone, true);

    const dbConfig = applyLocalGroupPreferences({ ...config, source: 'workspace_db' }, {
        groupVisibilityPreferences: { visibleGroupIds: ['platform'], activeGroupId: 'platform' },
    });
    assert.equal(dbConfig.preferences.customized, false);
});
