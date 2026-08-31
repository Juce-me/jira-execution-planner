const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/onboarding/onboardingSteps.js');
}

function element(rect, { display = 'block', visibility = 'visible', opacity = '1', disabled = false, ariaHidden = null } = {}) {
    return {
        disabled,
        getBoundingClientRect: () => ({ ...rect }),
        getAttribute: (name) => (name === 'aria-hidden' ? ariaHidden : null),
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
};

test('onboarding persistence is available only for Atlassian OAuth workspace DB mode', async () => {
    const { isOnboardingAvailable } = await loadModule();

    assert.equal(isOnboardingAvailable('atlassian_oauth', 'workspace_db'), true);
    assert.equal(isOnboardingAvailable('basic', 'workspace_db'), false);
    assert.equal(isOnboardingAvailable('local_basic', 'workspace_db'), false);
    assert.equal(isOnboardingAvailable('atlassian_oauth', 'jsonfile'), false);
    assert.equal(isOnboardingAvailable('atlassian_oauth', 'environment'), false);
    assert.equal(isOnboardingAvailable('', 'workspace_db'), false);
});

test('catalog contains the exact 14-step tour and interaction order', async () => {
    const { ONBOARDING_STEP_CATALOG } = await loadModule();
    assert.deepEqual(
        ONBOARDING_STEP_CATALOG.map((step) => [step.id, step.interaction]),
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
            ['complete', 'finish'],
        ]
    );
    assert.equal(Object.isFrozen(ONBOARDING_STEP_CATALOG), true);
    const renderedCopy = ONBOARDING_STEP_CATALOG
        .flatMap((step) => [step.title, step.body, step.fallbackBody || ''])
        .join(' ');
    assert.doesNotMatch(renderedCopy, /data-onboarding-target|hierarchy-epic|editing-priority/);
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

test('section skips navigate within the tour without producing Skip or Finish outcomes', async () => {
    const { buildVisibleOnboardingSteps, resolveSectionSkipTargetId } = await loadModule();
    const withJira = buildVisibleOnboardingSteps(FULL_AVAILABILITY);
    const withoutJira = buildVisibleOnboardingSteps({ ...FULL_AVAILABILITY, 'jira-export': false });

    for (const id of ['hierarchy-initiative', 'hierarchy-epic', 'hierarchy-story']) {
        assert.equal(resolveSectionSkipTargetId(withJira, id), 'editing-priority');
    }
    for (const id of ['editing-priority', 'editing-track', 'editing-status']) {
        assert.equal(resolveSectionSkipTargetId(withJira, id), 'jira-export');
        assert.equal(resolveSectionSkipTargetId(withoutJira, id), 'complete');
    }
    assert.equal(resolveSectionSkipTargetId(withJira, 'sprint'), '');
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
        assert.doesNotMatch(`${entry.body} ${entry.fallbackBody}`, /must|required to change|have to change/i);
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
    assert.deepEqual(buildTourProgress(steps, 2), { current: 3, total: 9, label: 'Step 3 of 9' });
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

test('target disappearance keeps the same step when it remains eligible', async () => {
    const { reconcileCurrentStepId } = await loadModule();
    const steps = [{ id: 'sprint' }, { id: 'refresh' }, { id: 'hierarchy' }];
    assert.equal(reconcileCurrentStepId({ previousSteps: steps, nextSteps: steps, currentStepId: 'refresh' }), 'refresh');
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
