const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadFirstRunGroupConfiguration() {
    const modulePath = path.join(
        __dirname,
        '..',
        'frontend',
        'src',
        'settings',
        'firstRunGroupConfiguration.js'
    );
    assert.ok(fs.existsSync(modulePath), 'Expected frontend/src/settings/firstRunGroupConfiguration.js to exist');
    const source = fs.readFileSync(modulePath, 'utf8')
        .replaceAll('export const ', 'const ')
        .replaceAll('export function ', 'function ');
    return new Function(`${source}; return {
        shouldShowFirstRunGroupSearch,
        buildFirstRunGroupDraft,
        buildPendingFirstRunGroupPreferencesDraft,
        beginFirstRunGroupConfiguration,
        createFirstRunConfigurationSession,
        firstRunConfigurationSessionReducer,
        FIRST_RUN_CONFIGURATION_GUIDE_STEPS,
        canAdvanceFirstRunConfigurationGuide,
    };`)();
}

test('shouldShowFirstRunGroupSearch hides search for zero through three groups', () => {
    const { shouldShowFirstRunGroupSearch } = loadFirstRunGroupConfiguration();
    [0, 1, 2, 3].forEach(count => assert.equal(shouldShowFirstRunGroupSearch(count), false));
});

test('shouldShowFirstRunGroupSearch shows search for four and five groups', () => {
    const { shouldShowFirstRunGroupSearch } = loadFirstRunGroupConfiguration();
    [4, 5].forEach(count => assert.equal(shouldShowFirstRunGroupSearch(count), true));
});

test('beginFirstRunGroupConfiguration returns normalized controlled state', () => {
    const { beginFirstRunGroupConfiguration } = loadFirstRunGroupConfiguration();

    assert.deepEqual(beginFirstRunGroupConfiguration({ mode: 'duplicate', sourceGroupId: 'platform' }), {
        mode: 'duplicate',
        sourceGroupId: 'platform',
        removeTeams: false,
        removeComponents: false,
    });
    assert.deepEqual(beginFirstRunGroupConfiguration({ mode: 'repair', sourceGroupId: null }), {
        mode: 'repair',
        sourceGroupId: null,
        removeTeams: false,
        removeComponents: false,
    });
});

test('pending setup records a personal visible favorite without shared configuration fields', () => {
    const { buildPendingFirstRunGroupPreferencesDraft } = loadFirstRunGroupConfiguration();
    const visibleGroupIds = ['platform', 'platform'];

    const pending = buildPendingFirstRunGroupPreferencesDraft(visibleGroupIds, 'new-department');

    assert.deepEqual(pending, {
        visibleGroupIds: ['platform', 'new-department'],
        favoriteGroupId: 'new-department',
    });
    assert.deepEqual(visibleGroupIds, ['platform', 'platform']);
    assert.equal(Object.hasOwn(pending, 'defaultGroupId'), false);
    assert.equal(Object.hasOwn(pending, 'onboardingDone'), false);
});

test('duplicate draft preserves its source and copies unrelated fields', () => {
    const { buildFirstRunGroupDraft } = loadFirstRunGroupConfiguration();
    const sourceGroup = {
        id: 'source',
        name: 'Source',
        teamIds: ['team-a'],
        teamLabels: { 'team-a': 'Alpha' },
        missingInfoComponents: ['Backend'],
        excludedCapacityEpics: ['SYN-1'],
        board: { columns: [{ id: 'todo', name: 'To do' }] },
    };
    const before = structuredClone(sourceGroup);

    const draft = buildFirstRunGroupDraft({
        mode: 'duplicate',
        sourceGroup,
        existingGroups: [sourceGroup],
    });

    assert.deepEqual(sourceGroup, before);
    assert.notEqual(draft, sourceGroup);
    assert.deepEqual(draft.teamIds, ['team-a']);
    assert.deepEqual(draft.teamLabels, { 'team-a': 'Alpha' });
    assert.deepEqual(draft.missingInfoComponents, ['Backend']);
    assert.deepEqual(draft.excludedCapacityEpics, ['SYN-1']);
    assert.deepEqual(draft.board, sourceGroup.board);
    assert.equal(draft.name, 'Source Copy');
    assert.equal(draft.id, 'source-copy');
});

test('duplicate cleanup flags independently remove teams and components', () => {
    const { buildFirstRunGroupDraft } = loadFirstRunGroupConfiguration();
    const sourceGroup = {
        id: 'source',
        name: 'Source',
        teamIds: ['team-a'],
        teamLabels: { 'team-a': 'Alpha' },
        missingInfoComponents: ['Backend'],
    };
    const teamsRemoved = buildFirstRunGroupDraft({
        mode: 'duplicate', sourceGroup, existingGroups: [sourceGroup], removeTeams: true,
    });
    const componentsRemoved = buildFirstRunGroupDraft({
        mode: 'duplicate', sourceGroup, existingGroups: [sourceGroup], removeComponents: true,
    });
    const bothRemoved = buildFirstRunGroupDraft({
        mode: 'duplicate', sourceGroup, existingGroups: [sourceGroup], removeTeams: true, removeComponents: true,
    });

    assert.deepEqual(teamsRemoved.teamIds, []);
    assert.deepEqual(teamsRemoved.teamLabels, {});
    assert.deepEqual(teamsRemoved.missingInfoComponents, ['Backend']);
    assert.deepEqual(componentsRemoved.teamIds, ['team-a']);
    assert.deepEqual(componentsRemoved.teamLabels, { 'team-a': 'Alpha' });
    assert.deepEqual(componentsRemoved.missingInfoComponents, []);
    assert.deepEqual(bothRemoved.teamIds, []);
    assert.deepEqual(bothRemoved.teamLabels, {});
    assert.deepEqual(bothRemoved.missingInfoComponents, []);
});

test('duplicate draft chooses collision-free Source Copy N names and ids', () => {
    const { buildFirstRunGroupDraft } = loadFirstRunGroupConfiguration();
    const sourceGroup = { id: 'source', name: 'Source', teamIds: ['team-a'] };
    const existingGroups = [
        sourceGroup,
        { id: 'source-copy', name: 'Source Copy' },
        { id: 'source-copy-2', name: 'Source Copy 2' },
    ];

    const draft = buildFirstRunGroupDraft({ mode: 'duplicate', sourceGroup, existingGroups });

    assert.equal(draft.name, 'Source Copy 3');
    assert.equal(draft.id, 'source-copy-3');
});

test('create draft starts clean and avoids existing name and id collisions', () => {
    const { buildFirstRunGroupDraft } = loadFirstRunGroupConfiguration();
    const draft = buildFirstRunGroupDraft({
        mode: 'create',
        existingGroups: [
            { id: 'new-department', name: 'New Department' },
            { id: 'new-department-2', name: 'New Department 2' },
        ],
    });

    assert.deepEqual(draft, {
        id: 'new-department-3',
        name: 'New Department 3',
        teamIds: [],
        missingInfoComponents: [],
        excludedCapacityEpics: [],
    });
});

test('first-run configuration session follows the exact save recovery states', () => {
    const {
        createFirstRunConfigurationSession,
        firstRunConfigurationSessionReducer,
    } = loadFirstRunGroupConfiguration();
    const reduce = (state, action) => firstRunConfigurationSessionReducer(state, action);
    const started = reduce(createFirstRunConfigurationSession(), {
        type: 'start',
        mode: 'create',
        pendingGroupId: 'new-department',
        drafts: { shared: { groups: [] }, private: { visibleGroupIds: [] }, activeGroupId: 'old' },
    });

    assert.equal(started.status, 'editing');
    assert.equal(started.guideStep, 'name');
    assert.deepEqual(started.committedSections, { admin: false, groups: false, epm: false, preference: false });

    const saving = reduce(started, { type: 'save_sections_started' });
    assert.equal(saving.status, 'saving_sections');
    assert.equal(reduce(saving, { type: 'save_sections_failed', committedSections: {} }).status, 'editing');

    const partial = reduce(saving, {
        type: 'save_sections_failed',
        committedSections: { groups: true },
        error: 'EPM failed',
    });
    assert.equal(partial.status, 'sections_pending');
    assert.equal(partial.committedSections.groups, true);
    assert.equal(reduce(partial, { type: 'retry_sections' }).status, 'saving_sections');
    assert.equal(reduce(partial, { type: 'return_after_sections' }).status, 'idle');

    const preferencePending = reduce(saving, {
        type: 'sections_saved',
        committedSections: { groups: true, epm: true },
        normalizedGroups: { groups: [{ id: 'new-department', name: 'New Department', teamIds: ['a'] }] },
    });
    assert.equal(preferencePending.status, 'preference_pending');
    assert.equal(preferencePending.committedSections.groups, true);
    assert.equal(reduce(preferencePending, { type: 'preference_saved' }).status, 'complete');
});

test('first-run session keeps committed flags and rebased snapshot across recovery', () => {
    const { createFirstRunConfigurationSession, firstRunConfigurationSessionReducer } = loadFirstRunGroupConfiguration();
    const original = createFirstRunConfigurationSession({
        status: 'sections_pending',
        mode: 'repair',
        pendingGroupId: 'platform',
        guideStep: 'teams',
        committedSections: { groups: true },
    });
    const rebased = firstRunConfigurationSessionReducer(original, {
        type: 'rebase',
        normalizedGroups: { configRevision: 8, groups: [{ id: 'platform', teamIds: ['a'] }] },
    });

    assert.equal(rebased.status, 'sections_pending');
    assert.equal(rebased.guideStep, 'teams');
    assert.equal(rebased.committedSections.groups, true);
    assert.equal(rebased.latestNormalizedGroups.configRevision, 8);
    assert.equal(firstRunConfigurationSessionReducer(rebased, { type: 'discard' }), rebased);
});

test('configuration guide has exact steps and validates only name and teams', () => {
    const { FIRST_RUN_CONFIGURATION_GUIDE_STEPS, canAdvanceFirstRunConfigurationGuide } = loadFirstRunGroupConfiguration();
    assert.deepEqual(FIRST_RUN_CONFIGURATION_GUIDE_STEPS, ['name', 'teams', 'components', 'favorite', 'visibility']);
    assert.equal(canAdvanceFirstRunConfigurationGuide('name', { name: '  Growth  ', teamIds: [] }, []), true);
    assert.equal(canAdvanceFirstRunConfigurationGuide('name', { id: 'a', name: ' Growth ' }, [{ id: 'b', name: 'growth' }]), false);
    assert.equal(canAdvanceFirstRunConfigurationGuide('teams', { teamIds: [] }, []), false);
    assert.equal(canAdvanceFirstRunConfigurationGuide('teams', { teamIds: ['team-a'] }, []), true);
    assert.equal(canAdvanceFirstRunConfigurationGuide('components', { missingInfoComponents: [] }, []), true);
});

test('configuration guide is a non-modal anchored coachmark with real-target focus ownership', () => {
    const guidePath = path.join(__dirname, '..', 'frontend', 'src', 'settings', 'FirstRunGroupConfigurationGuide.jsx');
    assert.ok(fs.existsSync(guidePath), 'Expected FirstRunGroupConfigurationGuide.jsx');
    const source = fs.readFileSync(guidePath, 'utf8');
    assert.ok(source.includes('role="status"'));
    assert.equal(source.includes('aria-modal="true"'), false);
    assert.ok(source.includes('data-first-run-guide-target'));
    assert.ok(source.includes("getAttribute('aria-describedby')"));
    assert.ok(source.includes("setAttribute('aria-describedby'"));
    assert.ok(source.includes('scrollIntoView'));
    assert.ok(source.includes('visualViewport'));
    assert.ok(source.includes('Back'));
    assert.ok(source.includes('Continue without components'));
});

test('Department editor exposes one canonical inline name and guide targets', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'settings', 'TeamGroupsSettings.jsx'), 'utf8');
    assert.ok(source.includes('className="group-list-name-input"'));
    assert.ok(source.includes('data-first-run-guide-target="name"'));
    assert.ok(source.includes('data-first-run-guide-target="teams"'));
    assert.ok(source.includes('data-first-run-guide-target="components"'));
    assert.ok(source.includes('data-first-run-guide-target="favorite"'));
    assert.ok(source.includes('data-first-run-guide-target="visibility"'));
    assert.ok(source.includes('Show in Department selector'));
    assert.ok(source.includes('Your favorite Department is always shown'));
    assert.equal((source.match(/className="group-name-input"/g) || []).length, 0);
    assert.equal(source.includes('Show in my controls'), false);
});

test('SettingsModal owns the replay header action slot', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'settings', 'SettingsModal.jsx'), 'utf8');
    assert.ok(source.includes('headerAction'));
    assert.ok(source.includes('group-modal-header-action'));
});

test('dashboard owns one reducer session and ordered first-run preference handoff', () => {
    const dashboard = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'), 'utf8');
    const preferences = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'settings', 'useGroupVisibilityPreferences.js'), 'utf8');
    assert.match(dashboard, /React\.useReducer\(\s*firstRunConfigurationSessionReducer/);
    assert.ok(dashboard.includes('saveAllSettings = async ({ rebaseOnto = null, firstRunSession = null } = {})'));
    assert.ok(dashboard.includes('saveFirstRunGroupPreferences({'));
    assert.ok(dashboard.includes('groupsSnapshot:'));
    assert.ok(dashboard.includes('selectedGroupId: firstRunSession.pendingGroupId'));
    assert.ok(preferences.includes('saveFirstRunGroupPreferences = React.useCallback(async ({ groupsSnapshot = groupsConfig, selectedGroupId = firstRunFavoriteGroupId } = {})'));
    assert.equal(preferences.includes('const [firstRunConfigurationActive'), false);
});

test('group save returns the normalized committed snapshot to first-run preference save', () => {
    const dashboard = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'), 'utf8');
    const saveGroupsStart = dashboard.indexOf('const saveGroupsConfig = async');
    const saveAllStart = dashboard.indexOf('const saveAllSettings = async');
    const saveGroupsSource = dashboard.slice(saveGroupsStart, saveAllStart);

    assert.ok(saveGroupsStart >= 0 && saveAllStart > saveGroupsStart);
    assert.match(saveGroupsSource, /return \{\s*ok: true,\s*normalizedGroups: normalized,/);
    assert.doesNotMatch(
        dashboard.slice(dashboard.indexOf('const filteredRows = rows.filter'), saveGroupsStart),
        /normalizedGroups: normalized/
    );
});

test('first-run and compact controls declare keyboard-safe 44px target geometry', () => {
    const firstRunCss = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'styles', 'settings', 'first-run.css'), 'utf8');
    const groupCss = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'styles', 'settings', 'team-groups.css'), 'utf8');
    const selectorCss = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'styles', 'settings', 'team-selector.css'), 'utf8');
    assert.ok(firstRunCss.includes('.first-run-configuration-guide'));
    assert.ok(firstRunCss.includes('min-height: 44px'));
    assert.ok(firstRunCss.includes('max-width: min(360px'));
    assert.ok(selectorCss.includes('.group-list-name-input'));
    assert.ok(groupCss.includes('.settings-onboarding-replay'));
});
