const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

async function loadModule() {
    return import('../frontend/src/onboarding/onboardingSteps.js');
}

async function loadTourModule() {
    return import('../frontend/src/onboarding/useOnboardingTour.js');
}

function element(rect, {
    display = 'block',
    visibility = 'visible',
    opacity = '1',
    disabled = false,
    ariaDisabled = null,
    ariaHidden = null,
    hidden = false,
    inert = false,
    inertAttribute = inert,
    parentElement = null,
    scrollIntoView = null,
    matchesDisabled = false,
} = {}) {
    const attributes = new Map();
    if (ariaDisabled !== null) attributes.set('aria-disabled', ariaDisabled);
    if (ariaHidden !== null) attributes.set('aria-hidden', ariaHidden);
    if (inertAttribute) attributes.set('inert', '');
    return {
        disabled,
        hidden,
        inert,
        parentElement,
        getBoundingClientRect: () => ({ ...rect }),
        getAttribute: (name) => attributes.get(name) ?? null,
        hasAttribute: (name) => attributes.has(name),
        matches: (selector) => selector === ':disabled' && matchesDisabled,
        scrollIntoView,
        ownerDocument: {
            defaultView: {
                getComputedStyle: () => ({ display, visibility, opacity }),
            },
        },
    };
}

function rootWith(selectors = {}) {
    return {
        querySelectorAll: (selector) => selectors[selector] || [],
    };
}

const VIEWPORT = { width: 1000, height: 700 };
const VISIBLE_RECT = { left: 100, top: 100, right: 220, bottom: 140, width: 120, height: 40 };
const FULL_AVAILABILITY = {
    group: true,
    teams: true,
    refresh: true,
    search: true,
    filters: true,
    'hierarchy-initiative': true,
    'hierarchy-epic': true,
    'hierarchy-story': true,
    'editing-priority': true,
    'editing-track': true,
    'editing-status': true,
    'jira-export': true,
    'launch-configuration': true,
    'launch-planning': true,
    'launch-board': true,
    'launch-statistics': true,
};

const ENG_STEP_IDS = [
    'hierarchy-initiative',
    'hierarchy-epic',
    'hierarchy-story',
    'editing-priority',
    'editing-track',
    'editing-status',
];

test('onboarding persistence is available only for Atlassian OAuth workspace DB mode', async () => {
    const { isOnboardingAvailable } = await loadModule();

    assert.equal(isOnboardingAvailable('atlassian_oauth', 'workspace_db'), true);
    assert.equal(isOnboardingAvailable('basic', 'workspace_db'), false);
    assert.equal(isOnboardingAvailable('local_basic', 'workspace_db'), false);
    assert.equal(isOnboardingAvailable('atlassian_oauth', 'jsonfile'), false);
    assert.equal(isOnboardingAvailable('atlassian_oauth', 'environment'), false);
    assert.equal(isOnboardingAvailable('', 'workspace_db'), false);
});

test('catch-up catalog keeps contextual module launchers between Jira export and completion', async () => {
    const { ONBOARDING_STEP_CATALOG } = await loadModule();
    assert.deepEqual(
        ONBOARDING_STEP_CATALOG.map((step) => [step.id, step.progression]),
        [
            ['sprint', 'manual'],
            ['group', 'manual'],
            ['teams', 'manual'],
            ['refresh', 'manual'],
            ['search', 'manual'],
            ['filters', 'manual'],
            ['hierarchy-initiative', 'manual'],
            ['hierarchy-epic', 'manual'],
            ['hierarchy-story', 'manual'],
            ['editing-priority', 'menu-preview'],
            ['editing-track', 'menu-preview'],
            ['editing-status', 'menu-preview'],
            ['jira-export', 'manual'],
            ['launch-configuration', 'module-launch'],
            ['launch-planning', 'module-launch'],
            ['launch-board', 'module-launch'],
            ['launch-statistics', 'module-launch'],
            ['complete', 'finish'],
        ]
    );
    const launchers = ONBOARDING_STEP_CATALOG.filter((step) => step.progression === 'module-launch');
    assert.deepEqual(
        launchers.map((step) => [step.id, step.moduleId]),
        [
            ['launch-configuration', 'configuration'],
            ['launch-planning', 'planning'],
            ['launch-board', 'board'],
            ['launch-statistics', 'statistics'],
        ]
    );
    launchers.forEach((step) => {
        assert.equal(step.interaction, 'target-reachable', step.id);
        assert.equal(step.requireEnabled, true, step.id);
        assert.match(step.fallbackBody, /unavailable|not available/i, step.id);
    });
    assert.equal(Object.isFrozen(ONBOARDING_STEP_CATALOG), true);
    const renderedCopy = ONBOARDING_STEP_CATALOG
        .flatMap((step) => [step.title, step.body, step.fallbackBody || ''])
        .join(' ');
    assert.doesNotMatch(renderedCopy, /data-onboarding-target|hierarchy-epic|editing-priority/);
});

test('contextual module catalogs expose exact manually advanced reachable destinations', async () => {
    const { ONBOARDING_STEPS_BY_MODULE, resolveOnboardingSnapshot } = await loadModule();
    const expectedSteps = {
        configuration: {
            targetId: 'configuration-team-add',
            body: 'Add or remove Teams here to control which Jira work appears for this Department. No change is required to continue.',
        },
        planning: {
            targetId: 'planning-overview',
            body: 'Planning helps select sprint work, compare it with capacity, and hand a chosen issue set to Jira.',
        },
        board: {
            targetId: 'board-overview',
            body: 'Board groups scoped Epics into the Department\'s configured workflow columns.',
        },
        statistics: {
            targetId: 'statistics-overview',
            body: 'Statistics compares delivery, priority, lead-time, capacity, and collaboration views for the selected scope.',
        },
    };

    for (const [moduleId, expected] of Object.entries(expectedSteps)) {
        const catalog = ONBOARDING_STEPS_BY_MODULE[moduleId];
        assert.equal(catalog.length, 1, moduleId);
        const [step] = catalog;
        assert.equal(step.interaction, 'target-reachable', moduleId);
        assert.equal(step.progression, 'module-manual', moduleId);
        assert.deepEqual(step.selectors, [`[data-onboarding-target="${expected.targetId}"]`], moduleId);
        assert.equal(step.body, expected.body, moduleId);

        const destination = element(VISIBLE_RECT);
        const snapshot = resolveOnboardingSnapshot(
            rootWith({ [step.selectors[0]]: [destination] }),
            VIEWPORT,
            { catalog },
        );
        assert.equal(snapshot.targets[step.id], destination, moduleId);
        assert.deepEqual(snapshot.steps.map((entry) => entry.id), [step.id], moduleId);
    }
});

test('Configuration fallback reads the real Team selector metadata and retains manual Next', async () => {
    const { ONBOARDING_STEPS_BY_MODULE, buildStepPresentation } = await loadModule();
    const [configurationStep] = ONBOARDING_STEPS_BY_MODULE.configuration;
    const previousDocument = globalThis.document;
    const selector = '[data-onboarding-configuration-team-count]';
    const presentationFromTeamSelector = (teamCount, catalogUnavailable) => {
        globalThis.document = {
            querySelector: (candidate) => candidate === selector ? {
                getAttribute: (name) => ({
                    'data-onboarding-configuration-team-count': String(teamCount),
                    'data-onboarding-configuration-team-catalog-unavailable': String(catalogUnavailable),
                })[name] || null,
            } : null,
        };
        return buildStepPresentation(configurationStep, null);
    };

    try {
        assert.equal(
            presentationFromTeamSelector(12, false).body,
            'The Team search is unavailable because this Department has reached the Team limit. You can continue with Next without making a change.',
        );
        assert.equal(
            presentationFromTeamSelector(12, true).body,
            'The Team search is unavailable because the Team catalog is unavailable. You can continue with Next without making a change.',
        );
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

test('contextual launcher and destination source contracts preserve native controls', () => {
    const dashboard = readFileSync(new URL('../frontend/src/dashboard.jsx', `file://${__filename}`), 'utf8');
    const modeControl = readFileSync(new URL('../frontend/src/eng/EngModeControl.jsx', `file://${__filename}`), 'utf8');
    const segmentedControl = readFileSync(new URL('../frontend/src/ui/SegmentedControl.jsx', `file://${__filename}`), 'utf8');
    const board = readFileSync(new URL('../frontend/src/eng/EngBoardView.jsx', `file://${__filename}`), 'utf8');

    assert.ok(dashboard.includes('data-onboarding-target="settings-launcher"'));
    assert.ok(modeControl.includes("'data-onboarding-target': 'planning-launcher'"));
    assert.ok(modeControl.includes("'data-onboarding-target': 'board-launcher'"));
    assert.ok(modeControl.includes("'data-onboarding-target': 'statistics-launcher'"));
    assert.match(segmentedControl, /<button\s+\{\.\.\.\(option\.domProps \|\| \{\}\)\}/);
    assert.equal((segmentedControl.match(/\{\.\.\.\(option\.domProps \|\| \{\}\)\}/g) || []).length, 1);
    assert.ok(dashboard.includes('data-onboarding-target="planning-overview"'));
    assert.ok(dashboard.includes('data-onboarding-target="statistics-overview"'));
    assert.ok(board.includes('data-onboarding-target="board-overview"'));
});

test('all eligible steps are included in catalog order', async () => {
    const { buildVisibleOnboardingSteps, ONBOARDING_STEP_CATALOG } = await loadModule();
    const steps = buildVisibleOnboardingSteps(FULL_AVAILABILITY);
    assert.deepEqual(
        steps.map((step) => step.id),
        ONBOARDING_STEP_CATALOG.map((step) => step.id)
    );
});

test('seven non-empty hierarchy combinations preserve all three ordered catalog steps with distinct fallbacks', async () => {
    const { buildStepPresentation, buildVisibleOnboardingSteps } = await loadModule();
    const hierarchyIds = ['hierarchy-initiative', 'hierarchy-epic', 'hierarchy-story'];

    for (let mask = 1; mask < 8; mask += 1) {
        const availability = {
            ...FULL_AVAILABILITY,
            'hierarchy-initiative': Boolean(mask & 4),
            'hierarchy-epic': Boolean(mask & 2),
            'hierarchy-story': Boolean(mask & 1),
        };
        const hierarchySteps = buildVisibleOnboardingSteps(availability)
            .filter((step) => step.id.startsWith('hierarchy'));
        assert.deepEqual(hierarchySteps.map((step) => step.id), hierarchyIds, `mask ${mask}`);
        hierarchySteps.forEach((step) => {
            const hasTarget = availability[step.id];
            const presentation = buildStepPresentation(step, hasTarget ? element(VISIBLE_RECT) : null);
            assert.equal(presentation.fallback, !hasTarget, `${step.id} mask ${mask}`);
        });
        assert.equal(new Set(hierarchySteps.map((step) => step.fallbackBody)).size, 3);
    }
});

test('all-absent hierarchy compacts to one aggregate fallback before field previews', async () => {
    const { buildVisibleOnboardingSteps } = await loadModule();
    const steps = buildVisibleOnboardingSteps({
        ...FULL_AVAILABILITY,
        'hierarchy-initiative': false,
        'hierarchy-epic': false,
        'hierarchy-story': false,
        'jira-export': false,
        'launch-configuration': false,
        'launch-planning': false,
        'launch-board': false,
        'launch-statistics': false,
    });
    assert.deepEqual(
        steps.map((step) => step.id),
        [
            'sprint', 'group', 'teams', 'refresh', 'search', 'filters',
            'hierarchy',
            'editing-priority', 'editing-track', 'editing-status',
            'complete',
        ]
    );
});

test('readiness enum uses only the exact ENG loading flags and terminal error', async () => {
    const { deriveOnboardingEngReadiness } = await loadModule();
    const settled = {
        tasksFetched: true,
        loading: false,
        productTasksLoading: false,
        techTasksLoading: false,
        displayedEngError: '',
    };
    assert.equal(deriveOnboardingEngReadiness(settled), 'settled');
    for (const key of ['loading', 'productTasksLoading', 'techTasksLoading']) {
        assert.equal(deriveOnboardingEngReadiness({ ...settled, [key]: true }), 'loading', key);
    }
    assert.equal(deriveOnboardingEngReadiness({ ...settled, tasksFetched: false }), 'loading');
    assert.equal(deriveOnboardingEngReadiness({ ...settled, tasksFetched: false, displayedEngError: 'failed' }), 'loading');
    assert.equal(deriveOnboardingEngReadiness({ ...settled, displayedEngError: 'failed' }), 'terminal-error');
    assert.equal(deriveOnboardingEngReadiness({ ...settled, displayedEngError: '   ' }), 'terminal-error');
});

test('dashboard derives and passes the exact onboarding ENG readiness without adding a fetch', () => {
    const source = readFileSync(
        new URL('../frontend/src/dashboard.jsx', `file://${__filename}`),
        'utf8'
    );
    assert.match(source, /deriveOnboardingEngReadiness\(\{\s*tasksFetched,\s*loading,\s*productTasksLoading,\s*techTasksLoading,\s*displayedEngError\s*\}\)/s);
    assert.match(source, /<OnboardingTour[\s\S]*?engReadiness=\{onboardingEngReadiness\}/);
    const readinessBlock = source.match(/const onboardingEngReadiness = deriveOnboardingEngReadiness\([\s\S]*?\);/)?.[0] || '';
    assert.doesNotMatch(readinessBlock, /\b(?:fetchTasks|request[A-Z]\w*)\s*\(/);
});

test('offscreen onboarding targets use exact instant centered scrolling', () => {
    const source = readFileSync(
        new URL('../frontend/src/onboarding/OnboardingTour.jsx', `file://${__filename}`),
        'utf8'
    );
    assert.match(source, /scrollIntoView\?\.\(\{ behavior: 'instant', block: 'center', inline: 'nearest' \}\)/);
    assert.doesNotMatch(source, /scrollIntoView\?\.\(\{ behavior: 'auto'/);
});

test('loading retains every hierarchy and editing step while settled matrices compact only all-absent groups', async () => {
    const { buildVisibleOnboardingSteps } = await loadModule();
    const loadingIds = buildVisibleOnboardingSteps({}, { engReadiness: 'loading' }).map((step) => step.id);
    ENG_STEP_IDS.forEach((id) => assert.equal(loadingIds.includes(id), true, id));

    for (let mask = 0; mask < 8; mask += 1) {
        const hierarchyAvailability = {
            'hierarchy-initiative': Boolean(mask & 4),
            'hierarchy-epic': Boolean(mask & 2),
            'hierarchy-story': Boolean(mask & 1),
        };
        const hierarchyIds = buildVisibleOnboardingSteps(hierarchyAvailability)
            .map((step) => step.id)
            .filter((id) => id.startsWith('hierarchy'));
        assert.deepEqual(
            hierarchyIds,
            mask ? ['hierarchy-initiative', 'hierarchy-epic', 'hierarchy-story'] : ['hierarchy'],
            `hierarchy mask ${mask}`
        );

        const editingAvailability = {
            'editing-priority': Boolean(mask & 4),
            'editing-track': Boolean(mask & 2),
            'editing-status': Boolean(mask & 1),
        };
        const editingIds = buildVisibleOnboardingSteps(editingAvailability)
            .map((step) => step.id)
            .filter((id) => id.startsWith('editing'));
        assert.deepEqual(
            editingIds,
            mask ? ['editing-priority', 'editing-track', 'editing-status'] : ['editing'],
            `editing mask ${mask}`
        );
    }
});

test('every hierarchy and editing step resolves loading, visible, offscreen, missing, disabled, and terminal-error states', async () => {
    const {
        ONBOARDING_STEP_CATALOG,
        buildStepPresentation,
        resolveOnboardingSnapshot,
    } = await loadModule();
    for (const id of ENG_STEP_IDS) {
        const step = ONBOARDING_STEP_CATALOG.find((entry) => entry.id === id);
        const selector = step.selectors[0];
        const visible = element(VISIBLE_RECT);
        const offscreen = element({ left: 100, top: 1400, right: 220, bottom: 1440, width: 120, height: 40 });
        const disabled = element(VISIBLE_RECT, { disabled: true });
        const inheritedDisabled = element(VISIBLE_RECT, { matchesDisabled: true });

        const loading = resolveOnboardingSnapshot(rootWith({ [selector]: [visible] }), VIEWPORT, { engReadiness: 'loading' });
        assert.equal(loading.targets[id], null, `${id} loading target`);
        assert.equal(loading.steps.some((entry) => entry.id === id), true, `${id} retained while loading`);
        assert.equal(buildStepPresentation(step, null, { engReadiness: 'loading' }).loading, true, `${id} loading presentation`);

        const visibleSnapshot = resolveOnboardingSnapshot(rootWith({ [selector]: [visible] }), VIEWPORT, { engReadiness: 'settled' });
        assert.equal(visibleSnapshot.targets[id], visible, `${id} visible`);
        const offscreenSnapshot = resolveOnboardingSnapshot(rootWith({ [selector]: [offscreen] }), VIEWPORT, { engReadiness: 'settled' });
        assert.equal(offscreenSnapshot.targets[id], offscreen, `${id} offscreen-rendered`);
        const missing = resolveOnboardingSnapshot(rootWith({}), VIEWPORT, { engReadiness: 'settled' });
        assert.equal(missing.targets[id], null, `${id} missing`);

        if (step.requireEnabled) {
            const preDisabled = resolveOnboardingSnapshot(rootWith({ [selector]: [disabled] }), VIEWPORT, { engReadiness: 'settled' });
            assert.equal(preDisabled.targets[id], null, `${id} pre-disabled`);
            const fieldsetDisabled = resolveOnboardingSnapshot(rootWith({ [selector]: [inheritedDisabled] }), VIEWPORT, { engReadiness: 'settled' });
            assert.equal(fieldsetDisabled.targets[id], null, `${id} inherited pre-disabled`);
        }

        const terminal = resolveOnboardingSnapshot(rootWith({ [selector]: [visible] }), VIEWPORT, { engReadiness: 'terminal-error' });
        assert.equal(terminal.targets[id], null, `${id} terminal error`);
    }
});

test('attribute-level tour suppression ignores only owned values and always enforces hidden styles', async () => {
    const { resolveOnboardingSnapshot } = await loadModule();
    const selector = '[data-onboarding-target="editing-priority"][data-issue-kind="epic"]';
    const ownedSuppressedSubtree = element(VISIBLE_RECT, { inert: true, ariaHidden: 'true' });
    const futureTarget = element(VISIBLE_RECT, { parentElement: ownedSuppressedSubtree });
    const allOwnedRecord = {
        node: ownedSuppressedSubtree,
        owned: { inertAttribute: true, inertProperty: true, ariaHidden: true },
    };

    const retained = resolveOnboardingSnapshot(rootWith({ [selector]: [futureTarget] }), VIEWPORT, {
        engReadiness: 'settled',
        tourOwnedSuppressionRecords: [allOwnedRecord],
    });
    assert.equal(retained.targets['editing-priority'], futureTarget);

    const mixedAria = resolveOnboardingSnapshot(rootWith({ [selector]: [futureTarget] }), VIEWPORT, {
        engReadiness: 'settled',
        tourOwnedSuppressionRecords: [{
            node: ownedSuppressedSubtree,
            owned: { inertAttribute: true, inertProperty: true, ariaHidden: false },
        }],
    });
    assert.equal(mixedAria.targets['editing-priority'], null, 'pre-existing aria-hidden remains disqualifying');

    const mixedInert = resolveOnboardingSnapshot(rootWith({ [selector]: [futureTarget] }), VIEWPORT, {
        engReadiness: 'settled',
        tourOwnedSuppressionRecords: [{
            node: ownedSuppressedSubtree,
            owned: { inertAttribute: false, inertProperty: false, ariaHidden: true },
        }],
    });
    assert.equal(mixedInert.targets['editing-priority'], null, 'pre-existing inert remains disqualifying');

    const hiddenOwnedSubtree = element(VISIBLE_RECT, { display: 'none', inert: true, ariaHidden: 'true' });
    const hiddenTarget = element(VISIBLE_RECT, { parentElement: hiddenOwnedSubtree });
    const hidden = resolveOnboardingSnapshot(rootWith({ [selector]: [hiddenTarget] }), VIEWPORT, {
        engReadiness: 'settled',
        tourOwnedSuppressionRecords: [{
            node: hiddenOwnedSubtree,
            owned: { inertAttribute: true, inertProperty: true, ariaHidden: true },
        }],
    });
    assert.equal(hidden.targets['editing-priority'], null, 'owned suppression never bypasses hidden style');
});

test('mutation filtering ignores only the exact tour-owned suppression attribute', async () => {
    const {
        consumeTourOwnedSuppressionMutation,
        queueTourOwnedSuppressionMutation,
        revokeTourOwnedSuppressionForMutation,
    } = await loadModule();
    const node = element(VISIBLE_RECT);
    const other = element(VISIBLE_RECT);
    const ownershipRecords = [{
        node,
        owned: { inertAttribute: true, inertProperty: true, ariaHidden: false },
    }];
    const pendingWrites = [];

    queueTourOwnedSuppressionMutation(pendingWrites, node, 'inert');
    assert.equal(consumeTourOwnedSuppressionMutation({ type: 'attributes', target: node, attributeName: 'inert' }, pendingWrites), true);
    assert.equal(consumeTourOwnedSuppressionMutation({ type: 'attributes', target: node, attributeName: 'inert' }, pendingWrites), false);

    queueTourOwnedSuppressionMutation(pendingWrites, node, 'aria-hidden');
    assert.equal(consumeTourOwnedSuppressionMutation({ type: 'attributes', target: other, attributeName: 'aria-hidden' }, pendingWrites), false);
    assert.equal(consumeTourOwnedSuppressionMutation({ type: 'attributes', target: node, attributeName: 'aria-hidden' }, pendingWrites), true);

    revokeTourOwnedSuppressionForMutation({ type: 'attributes', target: node, attributeName: 'aria-hidden' }, ownershipRecords);
    assert.equal(ownershipRecords[0].owned.inertAttribute, true);
    assert.equal(ownershipRecords[0].owned.ariaHidden, false);
    revokeTourOwnedSuppressionForMutation({ type: 'attributes', target: node, attributeName: 'inert' }, ownershipRecords);
    assert.deepEqual(ownershipRecords[0].owned, {
        inertAttribute: false,
        inertProperty: false,
        ariaHidden: false,
    });
});

test('renderable resolution prefers a later visible duplicate without crossing selector priority', async () => {
    const { resolveRenderableTarget } = await loadModule();
    const epicSelector = '[data-onboarding-target="editing-priority"][data-issue-kind="epic"]';
    const storySelector = '[data-onboarding-target="editing-priority"][data-issue-kind="story"]';
    const offscreenEpic = element({ left: 50, top: 1200, right: 170, bottom: 1240, width: 120, height: 40 });
    const visibleEpic = element(VISIBLE_RECT);
    const visibleStory = element({ left: 300, top: 100, right: 420, bottom: 140, width: 120, height: 40 });

    assert.equal(
        resolveRenderableTarget(
            [epicSelector, storySelector],
            rootWith({ [epicSelector]: [offscreenEpic, visibleEpic], [storySelector]: [visibleStory] }),
            VIEWPORT
        ),
        visibleEpic,
        'visible duplicate wins inside the preferred Epic selector'
    );
    assert.equal(
        resolveRenderableTarget(
            [epicSelector, storySelector],
            rootWith({ [epicSelector]: [offscreenEpic], [storySelector]: [visibleStory] }),
            VIEWPORT
        ),
        offscreenEpic,
        'Epic selector priority still wins over a visible Story fallback'
    );
});

test('renderable candidate resolution rejects hidden and zero nodes before accepting an offscreen node', async () => {
    const { resolveRenderableTarget } = await loadModule();
    const selector = '[data-onboarding-target="hierarchy-story"]';
    const hidden = element(VISIBLE_RECT, { visibility: 'hidden' });
    const zero = element({ left: 10, top: 10, right: 10, bottom: 10, width: 0, height: 0 });
    const inertParent = element(VISIBLE_RECT, { inert: true });
    const inert = element(VISIBLE_RECT, { parentElement: inertParent });
    const offscreen = element({ left: 80, top: 1600, right: 200, bottom: 1640, width: 120, height: 40 });
    assert.equal(resolveRenderableTarget([selector], rootWith({ [selector]: [hidden, zero, inert, offscreen] })), offscreen);
});

test('every hierarchy and editing step resolves disappearance and replacement without changing target preference', async () => {
    const { ONBOARDING_STEP_CATALOG, resolveOnboardingSnapshot } = await loadModule();
    for (const id of ENG_STEP_IDS) {
        const step = ONBOARDING_STEP_CATALOG.find((entry) => entry.id === id);
        const selector = step.selectors[0];
        const original = element(VISIBLE_RECT);
        const replacement = element({ left: 260, top: 900, right: 380, bottom: 940, width: 120, height: 40 });
        assert.equal(
            resolveOnboardingSnapshot(rootWith({ [selector]: [original] }), VIEWPORT, { engReadiness: 'settled' }).targets[id],
            original,
            `${id} original`
        );
        assert.equal(
            resolveOnboardingSnapshot(rootWith({ [selector]: [] }), VIEWPORT, { engReadiness: 'settled' }).targets[id],
            null,
            `${id} disappeared`
        );
        assert.equal(
            resolveOnboardingSnapshot(rootWith({ [selector]: [replacement] }), VIEWPORT, { engReadiness: 'settled' }).targets[id],
            replacement,
            `${id} replacement`
        );
    }
});

test('complete is always present while optional dashboard and Jira controls can be omitted', async () => {
    const { buildVisibleOnboardingSteps } = await loadModule();
    const ids = buildVisibleOnboardingSteps({}).map((step) => step.id);
    assert.equal(ids.at(-1), 'complete');
    assert.equal(ids.includes('group'), false);
    assert.equal(ids.includes('jira-export'), false);
});

test('hierarchy and field selectors encode exact and deterministic target preference', async () => {
    const { ONBOARDING_STEP_CATALOG } = await loadModule();
    const step = (id) => ONBOARDING_STEP_CATALOG.find((entry) => entry.id === id);
    assert.deepEqual(step('hierarchy-initiative').selectors, ['[data-onboarding-target="hierarchy-initiative"]']);
    assert.deepEqual(step('hierarchy-epic').selectors, ['[data-onboarding-target="hierarchy-epic"]']);
    assert.deepEqual(step('hierarchy-story').selectors, ['[data-onboarding-target="hierarchy-story"]']);
    assert.deepEqual(step('editing-priority').selectors, [
        '[data-onboarding-target="editing-priority"][data-issue-kind="epic"]',
        '[data-onboarding-target="editing-priority"][data-issue-kind="story"]',
    ]);
    assert.deepEqual(step('editing-track').selectors, ['[data-onboarding-target="editing-track"]']);
    assert.deepEqual(step('editing-status').selectors, [
        '[data-onboarding-target="editing-status"][data-issue-kind="epic"]',
        '[data-onboarding-target="editing-status"][data-issue-kind="story"]',
    ]);
});

test('catalog exposes four ordered progress groups', async () => {
    const { ONBOARDING_PROGRESS_GROUPS, ONBOARDING_STEP_CATALOG } = await loadModule();
    assert.deepEqual(ONBOARDING_PROGRESS_GROUPS, [
        'Dashboard basics',
        'Work hierarchy',
        'Field previews',
        'Continue in Jira',
    ]);
    assert.deepEqual(
        [...new Set(ONBOARDING_STEP_CATALOG.map((step) => step.group))],
        ONBOARDING_PROGRESS_GROUPS
    );
});

test('section skip resolver returns pure in-tour destinations', async () => {
    const { buildVisibleOnboardingSteps, resolveSectionSkipTargetId } = await loadModule();
    const withJira = buildVisibleOnboardingSteps(FULL_AVAILABILITY);
    const withoutJira = buildVisibleOnboardingSteps({ ...FULL_AVAILABILITY, 'jira-export': false });
    const calls = { skip: 0, finish: 0 };
    const persistenceCallbacks = {
        onSkip: () => { calls.skip += 1; },
        onFinish: () => { calls.finish += 1; },
    };

    for (const id of ['hierarchy-initiative', 'hierarchy-epic', 'hierarchy-story']) {
        assert.equal(resolveSectionSkipTargetId(withJira, id, persistenceCallbacks), 'editing-priority');
    }
    for (const id of ['editing-priority', 'editing-track', 'editing-status']) {
        assert.equal(resolveSectionSkipTargetId(withJira, id, persistenceCallbacks), 'jira-export');
        assert.equal(resolveSectionSkipTargetId(withoutJira, id, persistenceCallbacks), 'complete');
    }
    assert.equal(resolveSectionSkipTargetId(withJira, 'sprint', persistenceCallbacks), '');
    assert.deepEqual(calls, { skip: 0, finish: 0 });
    // Task 6 owns browser coverage proving section skips do not persist Skip or Finish.
});

test('coachmark action hierarchy uses stable role classes and a 560px placement default', () => {
    const source = readFileSync(
        new URL('../frontend/src/onboarding/OnboardingTour.jsx', `file://${__filename}`),
        'utf8'
    );
    const styles = readFileSync(
        new URL('../frontend/src/styles/settings/onboarding-tour.css', `file://${__filename}`),
        'utf8'
    );

    assert.match(source, /DEFAULT_COACHMARK_SIZE = \{ width: 560, height: 250 \}/);
    assert.match(source, /className="secondary onboarding-tour-action-skip-all"[\s\S]*?>\s*Skip onboarding/);
    assert.match(source, /className="secondary onboarding-tour-action-back"[\s\S]*?>\s*Back/);
    assert.match(source, /className="secondary onboarding-tour-action-skip-section"[\s\S]*?>\s*Skip this section/);
    assert.match(source, /className="primary onboarding-tour-action-next"[\s\S]*?>Next<\/button>/);
    assert.match(styles, /\.onboarding-tour-card\s*\{[\s\S]*?width:\s*min\(560px, calc\(100vw - 32px\)\)/);
    assert.match(styles, /\.onboarding-tour-actions\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-columns:\s*max-content 1fr/);
    assert.match(styles, /\.onboarding-tour-navigation\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-wrap:\s*nowrap/);
    assert.match(styles, /\.onboarding-tour-card button:focus-visible\s*\{[\s\S]*?outline:\s*2px solid #1d39c4/);
    assert.match(styles, /\.onboarding-tour-action-next:disabled\s*\{[\s\S]*?opacity:\s*1/);
});

test('search and field preview copy states the exact supported scope without requiring a change', async () => {
    const { ONBOARDING_STEP_CATALOG } = await loadModule();
    const step = (id) => ONBOARDING_STEP_CATALOG.find((entry) => entry.id === id);
    assert.match(step('search').body, /key or summary/i);
    assert.match(step('search').body, /Initiatives, Epics, and Stories/i);
    assert.match(step('search').body, /assignee.*Epics and Stories/i);
    assert.match(step('search').body, /not Initiatives/i);

    const priority = step('editing-priority');
    const track = step('editing-track');
    const status = step('editing-status');
    assert.match(priority.body, /Priority/i);
    assert.match(priority.fallbackBody, /Priority/i);
    assert.match(track.body, /Project Track/i);
    assert.match(track.body, /Epic/i);
    assert.match(track.fallbackBody, /Project Track/i);
    assert.match(status.body, /Status/i);
    assert.match(status.fallbackBody, /Status/i);
    [priority, track, status].forEach((entry) => {
        assert.match(entry.body, /no value change is required|without changing/i, `${entry.id} body`);
        assert.match(entry.fallbackBody, /no value change is required|without changing/i, `${entry.id} fallback`);
        assert.doesNotMatch(
            `${entry.body} ${entry.fallbackBody}`,
            /change (?:the|a|this) value to (?:continue|proceed|finish)|must change|have to change|required to change/i
        );
        for (const copy of [entry.body, entry.fallbackBody]) {
            assert.ok((copy.match(/[.!?](?:\s|$)/g) || []).length <= 2, `${entry.id} compact copy`);
        }
    });
});

test('visible target resolution chooses the intersecting duplicate instead of the off-screen first match', async () => {
    const { resolveVisibleTarget } = await loadModule();
    const selector = '[data-onboarding-target="sprint"]';
    const offscreen = element({ left: -300, top: 10, right: -200, bottom: 50, width: 100, height: 40 });
    const onscreen = element(VISIBLE_RECT);
    assert.equal(resolveVisibleTarget([selector], rootWith({ [selector]: [offscreen, onscreen] }), VIEWPORT), onscreen);
});

test('visible target resolution rejects hidden, zero-sized, and disabled controls', async () => {
    const { resolveVisibleTarget } = await loadModule();
    const selector = '[data-onboarding-target="jira-export"]';
    const hidden = element(VISIBLE_RECT, { display: 'none' });
    const zero = element({ left: 10, top: 10, right: 10, bottom: 10, width: 0, height: 0 });
    const disabled = element(VISIBLE_RECT, { disabled: true });
    assert.equal(resolveVisibleTarget([selector], rootWith({ [selector]: [hidden, zero, disabled] }), VIEWPORT, { requireEnabled: true }), null);
});

test('visible target resolution skips a positive-rect duplicate hidden by an ancestor', async () => {
    const { resolveVisibleTarget } = await loadModule();
    const selector = '[data-onboarding-target="sprint"]';
    const hiddenParent = element(VISIBLE_RECT, { display: 'none' });
    hiddenParent.parentElement = null;
    const hiddenChild = element(VISIBLE_RECT);
    hiddenChild.parentElement = hiddenParent;
    const visible = element({ left: 300, top: 100, right: 420, bottom: 140, width: 120, height: 40 });
    visible.parentElement = null;
    assert.equal(resolveVisibleTarget([selector], rootWith({ [selector]: [hiddenChild, visible] }), VIEWPORT), visible);
});

test('field previews resolve Epic controls before Story fallbacks', async () => {
    const { ONBOARDING_STEP_CATALOG, resolveStepTarget } = await loadModule();
    const priority = ONBOARDING_STEP_CATALOG.find((step) => step.id === 'editing-priority');
    const epicPriority = element(VISIBLE_RECT);
    const storyPriority = element({ left: 300, top: 200, right: 360, bottom: 240, width: 60, height: 40 });
    const root = rootWith({
        '[data-onboarding-target="editing-priority"][data-issue-kind="epic"]': [epicPriority],
        '[data-onboarding-target="editing-priority"][data-issue-kind="story"]': [storyPriority],
    });
    assert.equal(resolveStepTarget(priority, root, VIEWPORT), epicPriority);
});

test('progress is renumbered from the filtered visible list', async () => {
    const { buildVisibleOnboardingSteps, buildTourProgress } = await loadModule();
    const steps = buildVisibleOnboardingSteps({ group: false, teams: true, search: false, filters: true });
    assert.deepEqual(buildTourProgress(steps, 2), { current: 3, total: 7, label: 'Step 3 of 7' });
});

test('placement below a target remains viewport bounded', async () => {
    const { computeCoachmarkPlacement } = await loadModule();
    assert.deepEqual(
        computeCoachmarkPlacement({ targetRect: VISIBLE_RECT, coachmarkSize: { width: 320, height: 180 }, viewport: VIEWPORT }),
        { mode: 'target', side: 'bottom', left: 100, top: 152 }
    );
});

test('placement flips above near the bottom viewport edge', async () => {
    const { computeCoachmarkPlacement } = await loadModule();
    const result = computeCoachmarkPlacement({
        targetRect: { left: 300, top: 640, right: 440, bottom: 680, width: 140, height: 40 },
        coachmarkSize: { width: 320, height: 180 },
        viewport: VIEWPORT,
    });
    assert.deepEqual(result, { mode: 'target', side: 'top', left: 300, top: 448 });
});

test('placement uses the right side near the left viewport edge when vertical sides are unsafe', async () => {
    const { computeCoachmarkPlacement } = await loadModule();
    const result = computeCoachmarkPlacement({
        targetRect: { left: 4, top: 250, right: 64, bottom: 330, width: 60, height: 80 },
        coachmarkSize: { width: 320, height: 420 },
        viewport: VIEWPORT,
    });
    assert.deepEqual(result, { mode: 'target', side: 'right', left: 76, top: 140 });
});

test('placement uses the left side near the right viewport edge when vertical sides are unsafe', async () => {
    const { computeCoachmarkPlacement } = await loadModule();
    const result = computeCoachmarkPlacement({
        targetRect: { left: 930, top: 250, right: 990, bottom: 330, width: 60, height: 80 },
        coachmarkSize: { width: 320, height: 420 },
        viewport: VIEWPORT,
    });
    assert.deepEqual(result, { mode: 'target', side: 'left', left: 598, top: 140 });
});

test('placement centers a fallback when no side can safely contain the coachmark', async () => {
    const { computeCoachmarkPlacement } = await loadModule();
    assert.deepEqual(
        computeCoachmarkPlacement({
            targetRect: { left: 470, top: 330, right: 530, bottom: 370, width: 60, height: 40 },
            coachmarkSize: { width: 920, height: 640 },
            viewport: VIEWPORT,
        }),
        { mode: 'fallback', side: 'center', left: 40, top: 30 }
    );
});

test('placement centers a bounded fallback when the target is absent', async () => {
    const { computeCoachmarkPlacement } = await loadModule();
    assert.deepEqual(
        computeCoachmarkPlacement({ targetRect: null, coachmarkSize: { width: 320, height: 180 }, viewport: VIEWPORT }),
        { mode: 'fallback', side: 'center', left: 340, top: 260 }
    );
});

test('interactive coachmarks downgrade to manual mode when placement falls back', async () => {
    const { shouldUseInteractiveCoachmark } = await loadModule();
    assert.equal(shouldUseInteractiveCoachmark(true, { mode: 'target' }), true);
    assert.equal(shouldUseInteractiveCoachmark(true, { mode: 'fallback' }), false);
    assert.equal(shouldUseInteractiveCoachmark(false, { mode: 'target' }), false);

    const source = readFileSync(
        new URL('../frontend/src/onboarding/OnboardingTour.jsx', `file://${__filename}`),
        'utf8'
    );
    assert.match(source, /shouldUseInteractiveCoachmark\(interactiveEligible, rawPlacement\)/);
});

test('target disappearance keeps the same step when it remains eligible', async () => {
    const { reconcileCurrentStepId } = await loadModule();
    const steps = [{ id: 'sprint' }, { id: 'refresh' }, { id: 'hierarchy' }];
    assert.equal(reconcileCurrentStepId({ previousSteps: steps, nextSteps: steps, currentStepId: 'refresh' }), 'refresh');
});

test('readiness compaction keeps the current hierarchy or field section instead of jumping ahead', async () => {
    const { buildStepPresentation, buildVisibleOnboardingSteps, reconcileCurrentStepId } = await loadModule();
    const previousSteps = buildVisibleOnboardingSteps(FULL_AVAILABILITY);
    const nextSteps = buildVisibleOnboardingSteps({}, { engReadiness: 'terminal-error' });
    assert.equal(reconcileCurrentStepId({ previousSteps, nextSteps, currentStepId: 'hierarchy-epic' }), 'hierarchy');
    assert.equal(reconcileCurrentStepId({ previousSteps, nextSteps, currentStepId: 'editing-priority' }), 'editing');
    for (const id of ['hierarchy', 'editing']) {
        const presentation = buildStepPresentation(
            nextSteps.find((step) => step.id === id),
            null,
            { engReadiness: 'terminal-error' }
        );
        assert.match(presentation.body, /could not be loaded/i, id);
        assert.equal(presentation.fallback, true, id);
    }
});

test('target disappearance advances to the item at the old index, then clamps at the end', async () => {
    const { reconcileCurrentStepId } = await loadModule();
    const previous = [{ id: 'sprint' }, { id: 'search' }, { id: 'refresh' }];
    assert.equal(
        reconcileCurrentStepId({ previousSteps: previous, nextSteps: [{ id: 'sprint' }, { id: 'refresh' }], currentStepId: 'search' }),
        'refresh'
    );
    assert.equal(
        reconcileCurrentStepId({ previousSteps: previous, nextSteps: [{ id: 'sprint' }], currentStepId: 'refresh' }),
        'sprint'
    );
});

test('fallback-capable hierarchy and field steps return explanatory cards', async () => {
    const { ONBOARDING_STEP_CATALOG, buildStepPresentation } = await loadModule();
    for (const id of [
        'hierarchy-initiative', 'hierarchy-epic', 'hierarchy-story',
        'editing-priority', 'editing-track', 'editing-status',
    ]) {
        const presentation = buildStepPresentation(
            ONBOARDING_STEP_CATALOG.find((step) => step.id === id),
            null
        );
        assert.equal(presentation.fallback, true, id);
        assert.ok(presentation.body, id);
    }
});

test('navigation clamps bounds and exposes Back, Next, and Finish states', async () => {
    const { deriveTourNavigationState } = await loadModule();
    assert.deepEqual(
        deriveTourNavigationState({ run: true, onboardingDone: false, currentIndex: -4, totalSteps: 3 }),
        { isOpen: true, index: 0, canGoBack: false, canGoNext: true, isLast: false }
    );
    assert.deepEqual(
        deriveTourNavigationState({ run: true, onboardingDone: false, currentIndex: 99, totalSteps: 3 }),
        { isOpen: true, index: 2, canGoBack: true, canGoNext: false, isLast: true }
    );
});

test('navigation does not open before run, after completion, or without steps', async () => {
    const { deriveTourNavigationState } = await loadModule();
    assert.equal(deriveTourNavigationState({ run: false, onboardingDone: false, currentIndex: 0, totalSteps: 2 }).isOpen, false);
    assert.equal(deriveTourNavigationState({ run: true, onboardingDone: true, currentIndex: 0, totalSteps: 2 }).isOpen, false);
    assert.equal(deriveTourNavigationState({ run: true, onboardingDone: false, currentIndex: 0, totalSteps: 0 }).isOpen, false);
});

test('preview Next unlock accepts only the active menu-preview session and step', async () => {
    const tourModule = await loadTourModule();
    assert.equal(typeof tourModule.updateOnboardingStepUnlock, 'function');
    const { updateOnboardingStepUnlock } = tourModule;
    const active = {
        activeSessionId: 4,
        activeStepId: 'editing-priority',
        activeProgression: 'menu-preview',
    };

    const unlocked = updateOnboardingStepUnlock(null, {
        type: 'unlock',
        sessionId: 4,
        stepId: 'editing-priority',
        ...active,
    });
    assert.deepEqual(unlocked, { sessionId: 4, stepId: 'editing-priority' });
    assert.equal(updateOnboardingStepUnlock(unlocked, {
        type: 'unlock',
        sessionId: 4,
        stepId: 'editing-priority',
        ...active,
    }), unlocked, 'duplicate close is one-shot');

    for (const request of [
        { sessionId: 3, stepId: 'editing-priority' },
        { sessionId: 4, stepId: 'editing-track' },
        { sessionId: 4, stepId: 'editing-priority', activeProgression: 'manual' },
    ]) {
        assert.equal(updateOnboardingStepUnlock(null, {
            type: 'unlock',
            ...active,
            ...request,
        }), null);
    }
    assert.equal(updateOnboardingStepUnlock(unlocked, { type: 'clear' }), null);
});

test('a new effective-open session resets synchronously to the first eligible step', async () => {
    const { reconcileTourSessionState } = await loadModule();
    const steps = [{ id: 'sprint' }, { id: 'group' }, { id: 'refresh' }];
    const navigated = { sessionOpen: true, currentStepId: 'refresh' };
    const closed = reconcileTourSessionState(navigated, { isOpen: false, steps });
    assert.deepEqual(closed, { sessionOpen: false, currentStepId: 'refresh' });
    assert.deepEqual(
        reconcileTourSessionState(closed, { isOpen: true, steps }),
        { sessionOpen: true, currentStepId: 'sprint' }
    );
});
