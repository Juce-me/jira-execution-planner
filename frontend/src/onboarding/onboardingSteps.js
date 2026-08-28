const TARGET_PREFIX = '[data-onboarding-target=';

function target(name) {
    return `${TARGET_PREFIX}"${name}"]`;
}

function freezeStep(step) {
    return Object.freeze({
        ...step,
        selectors: Object.freeze([...step.selectors]),
    });
}

export const ONBOARDING_STEP_CATALOG = Object.freeze([
    freezeStep({
        id: 'sprint',
        presence: 'required',
        selectors: [target('sprint')],
        title: 'Choose a sprint',
        body: 'Use Sprint to choose the delivery window shown across the dashboard.',
        fallbackBody: 'Sprint selection sets the delivery window shown across the dashboard.',
    }),
    freezeStep({
        id: 'group',
        presence: 'conditional',
        selectors: [target('group')],
        title: 'Set your Department scope',
        body: 'Switch the Department in view without changing your saved favorite.',
    }),
    freezeStep({
        id: 'teams',
        presence: 'conditional',
        selectors: [target('teams')],
        title: 'Narrow to teams',
        body: 'Focus the current Department view on one or more teams.',
    }),
    freezeStep({
        id: 'search',
        presence: 'conditional',
        selectors: [target('search')],
        title: 'Find an issue',
        body: 'Search the current view by supported issue key or summary text.',
    }),
    freezeStep({
        id: 'jira-export',
        presence: 'conditional',
        requireEnabled: true,
        selectors: [target('jira-export')],
        title: 'Continue in Jira',
        body: 'Open the current issue set in Jira when you need its full issue tools.',
    }),
    freezeStep({
        id: 'refresh',
        presence: 'required',
        selectors: [target('refresh')],
        title: 'Request fresh data',
        body: 'Refresh asks the dashboard for the latest available Jira data.',
        fallbackBody: 'Refreshing asks the dashboard for the latest available Jira data.',
    }),
    freezeStep({
        id: 'filters',
        presence: 'conditional',
        selectors: [target('filters')],
        title: 'Focus the view',
        body: 'Use the available Show only and Display controls to focus what is on screen.',
    }),
    freezeStep({
        id: 'hierarchy',
        presence: 'fallback',
        selectors: [
            target('hierarchy-initiative'),
            target('hierarchy-epic'),
            target('hierarchy-story'),
            target('hierarchy'),
        ],
        title: 'Follow work from goal to delivery',
        body: 'The visible work connects Initiatives to Epics and the Stories that deliver them.',
        fallbackBody: 'Work is organized from Initiatives to Epics and then to the Stories that deliver them. This structure appears when issue data is available.',
    }),
    freezeStep({
        id: 'editing',
        presence: 'fallback',
        requireEnabled: true,
        selectors: [
            target('editing-priority'),
            target('editing-track'),
            target('editing-status'),
            target('editing'),
        ],
        title: 'Keep delivery details current',
        body: 'When an editable control is available, you can change its priority, Product Track, or status here.',
        fallbackBody: 'Priority, Product Track, and status controls appear only where the current view and your permissions allow changes.',
    }),
]);

export function buildVisibleOnboardingSteps(availability = {}) {
    return ONBOARDING_STEP_CATALOG.filter((step) => (
        step.presence !== 'conditional' || availability[step.id] === true
    ));
}

function viewportSize(viewport = {}) {
    return {
        width: Math.max(0, Number(viewport.width) || 0),
        height: Math.max(0, Number(viewport.height) || 0),
    };
}

export function isVisibleViewportTarget(node, viewport, { requireEnabled = false, ignoredAncestors = [] } = {}) {
    if (!node || typeof node.getBoundingClientRect !== 'function') return false;
    if (requireEnabled && (node.disabled || node.getAttribute?.('aria-disabled') === 'true')) return false;
    if (typeof node.checkVisibility === 'function') {
        try {
            if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        } catch (_error) {
            // Older engines may expose checkVisibility without accepting its options.
        }
    }

    const ignored = new Set(ignoredAncestors);
    let current = node;
    while (current) {
        if (!ignored.has(current)) {
            if (current.hidden
                || current.inert
                || current.hasAttribute?.('inert')
                || current.getAttribute?.('aria-hidden') === 'true') {
                return false;
            }
            const style = current.ownerDocument?.defaultView?.getComputedStyle?.(current);
            if (style && (
                style.display === 'none'
                || style.visibility === 'hidden'
                || style.visibility === 'collapse'
                || Number(style.opacity) === 0
            )) {
                return false;
            }
        }
        current = current.parentElement;
    }

    const rect = node.getBoundingClientRect();
    const size = viewportSize(viewport);
    return rect.width > 0
        && rect.height > 0
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < size.width
        && rect.top < size.height;
}

export function resolveVisibleTarget(selectors, root, viewport, options = {}) {
    if (!root || typeof root.querySelectorAll !== 'function') return null;
    for (const selector of selectors || []) {
        const candidates = Array.from(root.querySelectorAll(selector) || []);
        const visible = candidates.find((node) => isVisibleViewportTarget(node, viewport, options));
        if (visible) return visible;
    }
    return null;
}

export function resolveStepTarget(step, root, viewport) {
    if (!step) return null;
    return resolveVisibleTarget(step.selectors, root, viewport, { requireEnabled: step.requireEnabled === true });
}

export function resolveOnboardingSnapshot(root, viewport, options = {}) {
    const targets = {};
    const availability = {};
    ONBOARDING_STEP_CATALOG.forEach((step) => {
        const resolved = resolveVisibleTarget(step.selectors, root, viewport, {
            ...options,
            requireEnabled: step.requireEnabled === true,
        });
        targets[step.id] = resolved;
        availability[step.id] = Boolean(resolved);
    });
    return {
        steps: buildVisibleOnboardingSteps(availability),
        targets,
    };
}

export function buildTourProgress(steps, currentIndex) {
    const total = Array.isArray(steps) ? steps.length : 0;
    const index = total ? Math.min(Math.max(0, Number(currentIndex) || 0), total - 1) : 0;
    const current = total ? index + 1 : 0;
    return { current, total, label: `Step ${current} of ${total}` };
}

function centeredFallback(width, height, viewport) {
    return {
        mode: 'fallback',
        side: 'center',
        left: Math.max(0, Math.round((viewport.width - width) / 2)),
        top: Math.max(0, Math.round((viewport.height - height) / 2)),
    };
}

export function computeCoachmarkPlacement({
    targetRect,
    coachmarkSize = {},
    viewport: rawViewport = {},
    gap = 12,
    edgeGap = 12,
} = {}) {
    const viewport = viewportSize(rawViewport);
    const width = Math.min(Math.max(0, Number(coachmarkSize.width) || 0), viewport.width);
    const height = Math.min(Math.max(0, Number(coachmarkSize.height) || 0), viewport.height);
    const fallback = centeredFallback(width, height, viewport);
    if (!targetRect || !width || !height) return fallback;

    const clampLeft = (left) => Math.round(Math.min(
        Math.max(edgeGap, left),
        Math.max(edgeGap, viewport.width - edgeGap - width)
    ));
    const clampTop = (top) => Math.round(Math.min(
        Math.max(edgeGap, top),
        Math.max(edgeGap, viewport.height - edgeGap - height)
    ));
    const horizontalLeft = clampLeft(targetRect.left);

    if (viewport.height - edgeGap - targetRect.bottom - gap >= height) {
        return { mode: 'target', side: 'bottom', left: horizontalLeft, top: Math.round(targetRect.bottom + gap) };
    }
    if (targetRect.top - gap - edgeGap >= height) {
        return { mode: 'target', side: 'top', left: horizontalLeft, top: Math.round(targetRect.top - gap - height) };
    }
    if (viewport.width - edgeGap - targetRect.right - gap >= width && height <= viewport.height - edgeGap * 2) {
        return { mode: 'target', side: 'right', left: Math.round(targetRect.right + gap), top: clampTop((viewport.height - height) / 2) };
    }
    if (targetRect.left - gap - edgeGap >= width && height <= viewport.height - edgeGap * 2) {
        return { mode: 'target', side: 'left', left: Math.round(targetRect.left - gap - width), top: clampTop((viewport.height - height) / 2) };
    }
    return fallback;
}

export function reconcileCurrentStepId({ previousSteps = [], nextSteps = [], currentStepId = '' } = {}) {
    if (!nextSteps.length) return '';
    if (nextSteps.some((step) => step.id === currentStepId)) return currentStepId;
    const previousIndex = Math.max(0, previousSteps.findIndex((step) => step.id === currentStepId));
    return nextSteps[Math.min(previousIndex, nextSteps.length - 1)].id;
}

export function reconcileTourSessionState(state = {}, { isOpen = false, steps = [] } = {}) {
    const sessionOpen = Boolean(state.sessionOpen);
    const currentStepId = state.currentStepId || '';
    if (isOpen && !sessionOpen) {
        return { sessionOpen: true, currentStepId: steps[0]?.id || '' };
    }
    if (!isOpen && sessionOpen) {
        return { sessionOpen: false, currentStepId };
    }
    return state;
}

export function buildStepPresentation(step, targetNode) {
    const fallback = !targetNode;
    return {
        title: step?.title || '',
        body: fallback ? (step?.fallbackBody || step?.body || '') : (step?.body || ''),
        fallback,
    };
}

export function deriveTourNavigationState({ run = false, onboardingDone = true, currentIndex = 0, totalSteps = 0 } = {}) {
    const total = Math.max(0, Number(totalSteps) || 0);
    const index = total ? Math.min(Math.max(0, Number(currentIndex) || 0), total - 1) : 0;
    const isOpen = Boolean(run && !onboardingDone && total);
    const isLast = Boolean(total && index === total - 1);
    return {
        isOpen,
        index,
        canGoBack: isOpen && index > 0,
        canGoNext: isOpen && !isLast,
        isLast,
    };
}
