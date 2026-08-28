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

test('catalog contains the required product steps in deterministic order', async () => {
    const { ONBOARDING_STEP_CATALOG } = await loadModule();
    assert.deepEqual(
        ONBOARDING_STEP_CATALOG.map((step) => step.id),
        ['sprint', 'group', 'teams', 'search', 'jira-export', 'refresh', 'filters', 'hierarchy', 'editing']
    );
    assert.equal(Object.isFrozen(ONBOARDING_STEP_CATALOG), true);
    const renderedCopy = ONBOARDING_STEP_CATALOG
        .flatMap((step) => [step.title, step.body, step.fallbackBody || ''])
        .join(' ');
    assert.doesNotMatch(renderedCopy, /data-onboarding-target|hierarchy-epic|editing-priority/);
});

test('conditional steps are omitted while required and fallback-capable steps remain', async () => {
    const { buildVisibleOnboardingSteps } = await loadModule();
    const steps = buildVisibleOnboardingSteps({
        sprint: true,
        group: false,
        teams: false,
        search: false,
        'jira-export': false,
        refresh: true,
        filters: false,
        hierarchy: false,
        editing: false,
    });
    assert.deepEqual(steps.map((step) => step.id), ['sprint', 'refresh', 'hierarchy', 'editing']);
});

test('conditional steps are included in catalog order when eligible', async () => {
    const { buildVisibleOnboardingSteps } = await loadModule();
    const steps = buildVisibleOnboardingSteps({
        group: true,
        teams: true,
        search: true,
        'jira-export': true,
        filters: true,
    });
    assert.deepEqual(
        steps.map((step) => step.id),
        ['sprint', 'group', 'teams', 'search', 'jira-export', 'refresh', 'filters', 'hierarchy', 'editing']
    );
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

test('hierarchy and editing resolve the first visible candidate selector in preference order', async () => {
    const { ONBOARDING_STEP_CATALOG, resolveStepTarget } = await loadModule();
    const hierarchy = ONBOARDING_STEP_CATALOG.find((step) => step.id === 'hierarchy');
    const editing = ONBOARDING_STEP_CATALOG.find((step) => step.id === 'editing');
    const epic = element(VISIBLE_RECT);
    const track = element({ left: 300, top: 200, right: 360, bottom: 240, width: 60, height: 40 });
    const root = rootWith({
        '[data-onboarding-target="hierarchy-epic"]': [epic],
        '[data-onboarding-target="editing-track"]': [track],
    });
    assert.equal(resolveStepTarget(hierarchy, root, VIEWPORT), epic);
    assert.equal(resolveStepTarget(editing, root, VIEWPORT), track);
});

test('progress is renumbered from the filtered visible list', async () => {
    const { buildVisibleOnboardingSteps, buildTourProgress } = await loadModule();
    const steps = buildVisibleOnboardingSteps({ group: false, teams: true, search: false, filters: true });
    assert.deepEqual(buildTourProgress(steps, 2), { current: 3, total: 6, label: 'Step 3 of 6' });
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

test('fallback-capable steps return explanatory cards without claiming unavailable editing', async () => {
    const { ONBOARDING_STEP_CATALOG, buildStepPresentation } = await loadModule();
    const hierarchy = ONBOARDING_STEP_CATALOG.find((step) => step.id === 'hierarchy');
    const editing = ONBOARDING_STEP_CATALOG.find((step) => step.id === 'editing');
    assert.equal(buildStepPresentation(hierarchy, null).fallback, true);
    const editingFallback = buildStepPresentation(editing, null);
    assert.equal(editingFallback.fallback, true);
    assert.doesNotMatch(editingFallback.body, /you can edit|edit here|change this field/i);
});

test('editing copy describes editing only when an editable control is visible', async () => {
    const { ONBOARDING_STEP_CATALOG, buildStepPresentation } = await loadModule();
    const editing = ONBOARDING_STEP_CATALOG.find((step) => step.id === 'editing');
    const presentation = buildStepPresentation(editing, element(VISIBLE_RECT));
    assert.equal(presentation.fallback, false);
    assert.match(presentation.body, /change/i);
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
