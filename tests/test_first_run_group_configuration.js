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
    const guidePath = path.join(__dirname, '..', 'frontend', 'src', 'settings', 'FirstRunGroupConfigurationGuide.jsx');
    const source = fs.readFileSync(modulePath, 'utf8')
        .replaceAll('export const ', 'const ')
        .replaceAll('export function ', 'function ');
    const guideSource = fs.readFileSync(guidePath, 'utf8');
    const guideContracts = guideSource.slice(
        guideSource.indexOf('export const FIRST_RUN_CONFIGURATION_GUIDE_STEPS'),
        guideSource.indexOf('const COPY')
    ).replaceAll('export const ', 'const ').replaceAll('export function ', 'function ');
    return new Function(`${source}; ${guideContracts}; return {
        shouldShowFirstRunGroupSearch,
        buildFirstRunGroupDraft,
        buildPendingFirstRunGroupPreferencesDraft,
        beginFirstRunGroupConfiguration,
        createFirstRunConfigurationSession,
        firstRunConfigurationSessionReducer,
        FIRST_RUN_CONFIGURATION_GUIDE_STEPS,
        canAdvanceFirstRunConfigurationGuide,
        FIRST_RUN_ADMIN_SECTION_KEYS,
        buildFirstRunSettingsSaveOutcome,
        verifyFirstRunGroupsSaveSnapshot,
        mergeFirstRunAdminSections,
    };`)();
}

test('settings save outcomes deep-normalize every section and exact admin subsection', () => {
    const { FIRST_RUN_ADMIN_SECTION_KEYS, buildFirstRunSettingsSaveOutcome } = loadFirstRunGroupConfiguration();
    const paths = [
        {},
        { ok: true, committedSections: { groups: 1 }, committedAdminSections: { projects: 1, fieldConfigs: true } },
        { authRequired: true, pendingSections: { preference: 1 }, pendingAdminSections: { capacity: 1 } },
        { conflict: true, pendingSections: { admin: 1 }, pendingAdminSections: { board: 1 } },
        { inFlight: true },
        { error: 'failed', committedSections: { epm: true }, pendingSections: { groups: true } },
    ];
    for (const input of paths) {
        const outcome = buildFirstRunSettingsSaveOutcome(input);
        assert.deepEqual(Object.keys(outcome.committedSections), ['admin', 'groups', 'epm', 'preference']);
        assert.deepEqual(Object.keys(outcome.pendingSections), ['admin', 'groups', 'epm', 'preference']);
        assert.deepEqual(Object.keys(outcome.committedAdminSections), FIRST_RUN_ADMIN_SECTION_KEYS);
        assert.deepEqual(Object.keys(outcome.pendingAdminSections), FIRST_RUN_ADMIN_SECTION_KEYS);
        assert.equal(Object.hasOwn(outcome.committedAdminSections, 'fieldConfigs'), false);
        assert.equal(Object.hasOwn(outcome.pendingAdminSections, 'fieldConfigs'), false);
    }
});

test('admin progress merge never clears a committed subsection on retry', () => {
    const { FIRST_RUN_ADMIN_SECTION_KEYS, mergeFirstRunAdminSections } = loadFirstRunGroupConfiguration();
    const merged = mergeFirstRunAdminSections(
        { board: true },
        Object.fromEntries(FIRST_RUN_ADMIN_SECTION_KEYS.map(key => [key, key === 'capacity']))
    );
    assert.equal(merged.board, true);
    assert.equal(merged.capacity, true);
    assert.deepEqual(Object.keys(merged), FIRST_RUN_ADMIN_SECTION_KEYS);
});

test('dashboard-owned Return capture and restoration cover every settings section', () => {
    const dashboard = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'), 'utf8');
    const captureStart = dashboard.indexOf('const captureFirstRunSettingsDrafts');
    const captureEnd = dashboard.indexOf('const configureFirstRunGroup', captureStart);
    const restoreStart = dashboard.indexOf('const restoreSettingsDraftsToCommittedBaselines');
    const restoreEnd = dashboard.indexOf('const returnFromFirstRunConfigurationRecovery', restoreStart);
    const capture = dashboard.slice(captureStart, captureEnd);
    const restore = dashboard.slice(restoreStart, restoreEnd);
    for (const key of [
        'projects', 'priorityWeights', 'board', 'capacity', 'sprintField', 'parentNameField',
        'storyPointsField', 'teamField', 'deliveryOwnerField', 'issueTypes', 'adminAccess',
    ]) {
        assert.match(capture, new RegExp(`\\b${key}:`));
        assert.ok(restore.includes(`committed.${key}`) || restore.includes(`restoreField('${key}'`));
    }
    assert.ok(capture.includes('shared: groupsConfig'));
    assert.ok(capture.includes('private: groupPreferences'));
    assert.ok(capture.includes('epm: epmConfigDraft'));
    assert.ok(restore.includes('latestNormalizedGroups') === false, 'group restoration belongs to the recovery caller');
    assert.ok(restore.includes('committedSections?.epm'));
    assert.ok(restore.includes('setGroupPreferences(capturedPrivate)'));
    assert.equal(dashboard.includes('restoreFieldConfigDrafts'), false);
    assert.equal(dashboard.includes('adminAccess.restoreDraft'), false);
});

test('group save snapshot verification compares every shared field but accepts set ordering', () => {
    const { verifyFirstRunGroupsSaveSnapshot } = loadFirstRunGroupConfiguration();
    const submitted = {
        version: 1,
        baseRevision: 3,
        defaultGroupId: '',
        groups: [{
            id: 'new-department', name: 'Growth', teamIds: ['b', 'a'], teamLabels: ['B', 'A'],
            missingInfoComponents: ['mobile', 'web'], excludedCapacityEpics: ['TWO', 'ONE'],
            adHocCapacityEpics: ['AD-2', 'AD-1'], board: { columns: [{ id: 'todo', statuses: ['Open', 'Ready'] }] },
        }],
    };
    const response = {
        version: 1,
        configRevision: 4,
        defaultGroupId: '',
        groups: [{
            id: 'new-department', name: 'Growth', teamIds: ['a', 'b'], teamLabels: ['A', 'B'],
            missingInfoComponents: ['web', 'mobile'], excludedCapacityEpics: ['ONE', 'TWO'],
            adHocCapacityEpics: ['AD-1', 'AD-2'], board: { columns: [{ id: 'todo', statuses: ['Ready', 'Open'] }] },
        }],
        source: 'workspace_db', preferences: { visibleGroupIds: [] },
    };
    assert.equal(verifyFirstRunGroupsSaveSnapshot(submitted, response, 'new-department').ok, true);
    for (const mutate of [
        value => { value.groups[0].name = 'Wrong'; },
        value => { value.groups[0].missingInfoComponents = ['wrong']; },
        value => { value.groups[0].board.columns[0].statuses = ['Wrong']; },
        value => { delete value.groups; },
    ]) {
        const mismatch = structuredClone(response);
        mutate(mismatch);
        assert.equal(verifyFirstRunGroupsSaveSnapshot(submitted, mismatch, 'new-department').ok, false);
    }
    for (const invalidCommit of [
        { ...response, configRevision: null },
        { ...response, configRevision: 3 },
        { ...response, source: 'jsonfile' },
    ]) {
        assert.equal(verifyFirstRunGroupsSaveSnapshot(submitted, invalidCommit, 'new-department').ok, false);
    }
    for (const invalidSubmittedRevision of [undefined, null, '', '3', 3.5]) {
        assert.equal(verifyFirstRunGroupsSaveSnapshot(
            { ...submitted, baseRevision: invalidSubmittedRevision },
            response,
            'new-department'
        ).ok, false);
    }
    for (const invalidResponseRevision of [undefined, '', '4', 4.5]) {
        assert.equal(verifyFirstRunGroupsSaveSnapshot(
            submitted,
            { ...response, configRevision: invalidResponseRevision },
            'new-department'
        ).ok, false);
    }
});

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
    const zeroCommitFailure = reduce(saving, { type: 'save_sections_failed', committedSections: {}, retryable: true });
    assert.equal(zeroCommitFailure.status, 'editing');
    assert.equal(zeroCommitFailure.recoveryAction, null);

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

test('first-run session tracks exact committed and pending admin subsections', () => {
    const { createFirstRunConfigurationSession, firstRunConfigurationSessionReducer } = loadFirstRunGroupConfiguration();
    const started = createFirstRunConfigurationSession({ status: 'saving_sections' });
    const progressed = firstRunConfigurationSessionReducer(started, {
        type: 'sections_progress',
        committedSections: { admin: true },
        committedAdminSections: { projects: true, priorityWeights: true },
    });
    const failed = firstRunConfigurationSessionReducer(progressed, {
        type: 'save_sections_failed',
        committedSections: { admin: true },
        committedAdminSections: { projects: true, priorityWeights: true },
        pendingAdminSections: { board: true, capacity: true },
        error: 'Synthetic failure',
    });
    assert.equal(failed.committedAdminSections.projects, true);
    assert.equal(failed.committedAdminSections.priorityWeights, true);
    assert.equal(failed.pendingAdminSections.board, true);
    assert.equal(failed.pendingAdminSections.capacity, true);
    assert.equal(Object.hasOwn(failed.committedAdminSections, 'fieldConfigs'), false);
    assert.equal(failed.status, 'sections_pending');
});

test('Task 2 session contracts live with the guide and expose no generic discard transition', () => {
    const configurationSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'settings', 'firstRunGroupConfiguration.js'), 'utf8');
    const guideSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'settings', 'FirstRunGroupConfigurationGuide.jsx'), 'utf8');
    assert.equal(configurationSource.includes('firstRunConfigurationSessionReducer'), false);
    assert.equal(configurationSource.includes('FIRST_RUN_CONFIGURATION_GUIDE_STEPS'), false);
    assert.ok(guideSource.includes('firstRunConfigurationSessionReducer'));
    assert.equal(guideSource.includes("case 'discard'"), false);
});

test('recovery states remain renderable after the guide is complete', () => {
    const dashboard = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'), 'utf8');
    assert.equal(dashboard.includes('firstRunConfigurationActive && !firstRunConfigurationSession.guideComplete && activeGroupDraft'), false);
    assert.ok(dashboard.includes("['sections_pending', 'preference_pending'].includes(firstRunConfigurationSession.status)"));
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

test('Department editor exposes one canonical row favorite and ordered preference actions', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'settings', 'TeamGroupsSettings.jsx'), 'utf8');
    assert.ok(source.includes('className="group-list-name-input"'));
    assert.ok(source.includes('data-first-run-guide-target="name"'));
    assert.ok(source.includes('data-first-run-guide-target="teams"'));
    assert.ok(source.includes('data-first-run-guide-target="components"'));
    assert.ok(source.includes('data-first-run-guide-target="favorite"'));
    assert.ok(source.includes('data-first-run-guide-target="visibility"'));
    assert.ok(source.includes('Show in Department selector'));
    assert.ok(source.includes('Favorite Departments are always shown.'));
    assert.ok(source.includes('aria-label="Favorite Department, selected pending save"'));
    assert.ok(source.includes('aria-label="Show in Department selector, checked. Favorite Departments are always shown"'));
    assert.match(source, /type="checkbox"[\s\S]*aria-describedby=\{visibilityDescriptionIds\}/);
    assert.match(source, /firstRunConfigurationActive && isActive[\s\S]*className="group-list-star group-list-star-status"[\s\S]*data-first-run-guide-target="favorite"[\s\S]*role="status"[\s\S]*aria-label="Favorite Department, selected pending save"/);
    assert.match(source, /<button[\s\S]*type="button"[\s\S]*className="group-list-star"[\s\S]*aria-pressed=\{isDefault\}[\s\S]*onClick=\{\(event\) => \{[\s\S]*event\.stopPropagation\(\);[\s\S]*setFavoriteGroupDraft\(group\.id\)[\s\S]*toggleDefaultGroupDraft\(group\.id\)[\s\S]*disabled=\{groupVisibilitySaving \|\| !\(group\.teamIds \|\| \[\]\)\.some/);
    assert.equal(source.includes('className="group-star-button'), false);
    assert.equal(source.includes('Controls whether this Department appears in the dashboard Department menu.'), false);
    assert.equal(source.includes('Your favorite Department is always shown'), false);
    assert.equal(source.includes('className="group-editor-header"'), false);
    assert.equal(source.includes('className="group-editor-name"'), false);
    assert.ok(source.includes('>♥</span>'));
    assert.ok(source.includes("{isDefault ? '♥' : '♡'}</button>"));
    const preferenceIndex = source.indexOf('<div className="group-preference-row">');
    const actionsIndex = source.indexOf('<div className="group-editor-actions">', preferenceIndex);
    const teamsIndex = source.indexOf('className="team-selector"', actionsIndex);
    assert.ok(preferenceIndex >= 0 && preferenceIndex < actionsIndex && actionsIndex < teamsIndex);
    assert.match(source.slice(actionsIndex, teamsIndex), /className="group-editor-actions"[\s\S]*>\s*Duplicate\s*<\/button>/);
    assert.equal((source.match(/className="group-name-input"/g) || []).length, 0);
    assert.equal(source.includes('Show in my controls'), false);
});

test('Department Team search exposes the configuration onboarding destination only on the native input', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'settings', 'TeamGroupsSettings.jsx'), 'utf8');
    assert.match(
        source,
        /<input\s+data-onboarding-target="configuration-team-add"\s+type="text"\s+className="team-search-input"/s,
    );
    assert.equal((source.match(/data-onboarding-target="configuration-team-add"/g) || []).length, 1);
    assert.match(
        source,
        /className="team-selector"[\s\S]*data-onboarding-configuration-team-count=\{\(activeGroupDraft\.teamIds \|\| \[\]\)\.length\}[\s\S]*data-onboarding-configuration-team-catalog-unavailable=\{availableTeams\.length === 0 && !loadingTeams \? 'true' : 'false'\}/,
    );
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
    assert.ok(dashboard.includes('saveAllSettingsOnce = async ({ rebaseOnto = null, firstRunSession = null } = {})'));
    assert.ok(dashboard.includes('if (settingsSaveInFlightRef.current) return buildSettingsSaveOutcome({ inFlight: true })'));
    assert.ok(dashboard.includes('saveFirstRunGroupPreferences({'));
    assert.equal(dashboard.includes("document.querySelector('.group-modal .group-editor .group-name-input')"), false);
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
    assert.match(saveGroupsSource, /return buildSettingsSaveOutcome\(\{\s*ok: true,\s*normalizedGroups: normalized,/);
    assert.doesNotMatch(
        dashboard.slice(dashboard.indexOf('const filteredRows = rows.filter'), saveGroupsStart),
        /normalizedGroups: normalized/
    );
    assert.ok(saveGroupsSource.includes('authRequired: true'));
    assert.ok(saveGroupsSource.includes('committedSections'));
    assert.ok(saveGroupsSource.includes('pendingSections'));
    assert.ok(saveGroupsSource.includes('admin: Object.values(pendingAdminSections).some(Boolean)'));
    assert.ok(saveGroupsSource.includes('verifyFirstRunGroupsSaveSnapshot('));
    assert.equal(saveGroupsSource.includes('isAuthenticationRequiredError(err)) return false'), false);
});

test('conflict exits preserve the first-run session through Keep and Discard', () => {
    const dashboard = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'), 'utf8');
    const keepStart = dashboard.indexOf('const keepMineOnGroupsConfigConflict');
    const discardEnd = dashboard.indexOf('const keepMineOnWorkspaceConfigConflict', keepStart);
    const conflictSource = dashboard.slice(keepStart, discardEnd);
    assert.ok(conflictSource.includes('firstRunSession: firstRunConfigurationActive ? firstRunConfigurationSession : null'));
    assert.ok(conflictSource.includes('returnFromFirstRunConfigurationRecovery'));
});

test('first-run save validates the pending name and teams immediately before writes', () => {
    const dashboard = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'), 'utf8');
    const saveStart = dashboard.indexOf('const saveAllSettingsOnce = async');
    const saveEnd = dashboard.indexOf('const keepMineOnGroupsConfigConflict', saveStart);
    const source = dashboard.slice(saveStart, saveEnd);
    assert.ok(source.includes('validateFirstRunPendingGroup'));
    assert.ok(source.indexOf('validateFirstRunPendingGroup') < source.indexOf('saveGroupsConfig('));
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

test('analytics contract retains contextual-module events and forbids raw onboarding data', () => {
    const analytics = fs.readFileSync(path.join(__dirname, '..', 'docs', 'README_ANALYTICS.md'), 'utf8');
    assert.match(analytics, /launcher\/view and option-open events remain existing canonical events/i);
    assert.match(analytics, /module navigation.*no-new-event.*no independent product outcome/i);
    assert.match(analytics, /raw target\/step\/Department\/Team\/issue data is forbidden/i);
});

test('Department configuration source retains the canonical favorite control', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'settings', 'TeamGroupsSettings.jsx'), 'utf8');
    assert.equal(source.includes('group-star-button'), false);
});
