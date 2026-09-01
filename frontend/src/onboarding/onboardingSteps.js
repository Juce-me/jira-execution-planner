const TARGET_PREFIX = '[data-onboarding-target=';

export function isOnboardingAvailable(authMode, groupsSource) {
    return authMode === 'atlassian_oauth' && groupsSource === 'workspace_db';
}

function target(name) {
    return `${TARGET_PREFIX}"${name}"]`;
}

function issueKindTarget(name, issueKind) {
    return `${target(name)}[data-issue-kind="${issueKind}"]`;
}

function freezeStep(step) {
    return Object.freeze({
        ...step,
        selectors: Object.freeze([...step.selectors]),
    });
}

export const ONBOARDING_PROGRESS_GROUPS = Object.freeze([
    'Dashboard basics',
    'Work hierarchy',
    'Field previews',
    'Continue in Jira',
]);

const DASHBOARD_BASICS = ONBOARDING_PROGRESS_GROUPS[0];
const WORK_HIERARCHY = ONBOARDING_PROGRESS_GROUPS[1];
const FIELD_PREVIEWS = ONBOARDING_PROGRESS_GROUPS[2];
const CONTINUE_IN_JIRA = ONBOARDING_PROGRESS_GROUPS[3];
const HIERARCHY_STEP_IDS = Object.freeze([
    'hierarchy-initiative',
    'hierarchy-epic',
    'hierarchy-story',
]);
const EDITING_STEP_IDS = Object.freeze([
    'editing-priority',
    'editing-track',
    'editing-status',
]);
const ENG_DATA_STEP_IDS = new Set([...HIERARCHY_STEP_IDS, ...EDITING_STEP_IDS]);

export function deriveOnboardingEngReadiness({
    tasksFetched = false,
    loading = false,
    productTasksLoading = false,
    techTasksLoading = false,
    displayedEngError = '',
} = {}) {
    if (!tasksFetched || loading || productTasksLoading || techTasksLoading) return 'loading';
    if (String(displayedEngError || '')) return 'terminal-error';
    return 'settled';
}

export function isOnboardingEngDataStep(stepOrId) {
    const id = typeof stepOrId === 'string' ? stepOrId : stepOrId?.id;
    return ENG_DATA_STEP_IDS.has(id);
}

export const ONBOARDING_STEP_CATALOG = Object.freeze([
    freezeStep({
        id: 'sprint',
        presence: 'required',
        progression: 'manual',
        group: DASHBOARD_BASICS,
        selectors: [target('sprint')],
        title: 'Choose a sprint',
        body: 'Use Sprint to choose the delivery window shown across the dashboard.',
        fallbackBody: 'Sprint selection sets the delivery window shown across the dashboard.',
    }),
    freezeStep({
        id: 'group',
        presence: 'conditional',
        progression: 'manual',
        group: DASHBOARD_BASICS,
        selectors: [target('group')],
        title: 'Set your Department scope',
        body: 'Switch the Department in view without changing your saved favorite.',
    }),
    freezeStep({
        id: 'teams',
        presence: 'conditional',
        progression: 'manual',
        group: DASHBOARD_BASICS,
        selectors: [target('teams')],
        title: 'Narrow to teams',
        body: 'Focus the current Department view on one or more teams.',
    }),
    freezeStep({
        id: 'refresh',
        presence: 'required',
        progression: 'manual',
        group: DASHBOARD_BASICS,
        selectors: [target('refresh')],
        title: 'Request fresh data',
        body: 'Refresh asks the dashboard for the latest available Jira data.',
        fallbackBody: 'Refreshing asks the dashboard for the latest available Jira data.',
    }),
    freezeStep({
        id: 'search',
        presence: 'conditional',
        progression: 'manual',
        group: DASHBOARD_BASICS,
        selectors: [target('search')],
        title: 'Find work across the hierarchy',
        body: 'Search by key or summary across Initiatives, Epics, and Stories. Assignee search covers Epics and Stories, not Initiatives.',
    }),
    freezeStep({
        id: 'filters',
        presence: 'conditional',
        progression: 'manual',
        group: DASHBOARD_BASICS,
        selectors: [target('filters')],
        title: 'Focus the view',
        body: 'Use the available Show only and Display controls to focus what is on screen.',
    }),
    freezeStep({
        id: 'hierarchy-initiative',
        presence: 'hierarchy',
        progression: 'manual',
        group: WORK_HIERARCHY,
        selectors: [target('hierarchy-initiative')],
        title: 'Start with the Initiative',
        body: 'An Initiative groups related Epics around a broader outcome.',
        loadingBody: 'Loading Initiative data for this dashboard view.',
        fallbackBody: 'Initiatives sit above Epics in the work hierarchy, even when no Initiative is visible in the current result set.',
    }),
    freezeStep({
        id: 'hierarchy-epic',
        presence: 'hierarchy',
        progression: 'manual',
        group: WORK_HIERARCHY,
        selectors: [target('hierarchy-epic')],
        title: 'Follow the Epic',
        body: 'An Epic groups the Stories that contribute to a larger delivery outcome.',
        loadingBody: 'Loading Epic data for this dashboard view.',
        fallbackBody: 'Epics connect Initiatives to delivery Stories, even when no Epic is visible in the current result set.',
    }),
    freezeStep({
        id: 'hierarchy-story',
        presence: 'hierarchy',
        progression: 'manual',
        group: WORK_HIERARCHY,
        selectors: [target('hierarchy-story')],
        title: 'See the delivery Stories',
        body: 'Stories are the delivery work grouped under an Epic.',
        loadingBody: 'Loading Story data for this dashboard view.',
        fallbackBody: 'Stories are the delivery level beneath Epics, even when no Story is visible in the current result set.',
    }),
    freezeStep({
        id: 'editing-priority',
        presence: 'fallback',
        progression: 'menu-preview',
        group: FIELD_PREVIEWS,
        requireEnabled: true,
        selectors: [
            issueKindTarget('editing-priority', 'epic'),
            issueKindTarget('editing-priority', 'story'),
        ],
        title: 'Preview Priority options',
        body: 'Open an Epic or Story Priority menu to preview the available options; you can close it without changing the value.',
        loadingBody: 'Loading Priority controls for this dashboard view.',
        fallbackBody: 'Priority menus appear on editable Epics and Stories when the current view and your permissions make them available. No value change is required.',
    }),
    freezeStep({
        id: 'editing-track',
        presence: 'fallback',
        progression: 'menu-preview',
        group: FIELD_PREVIEWS,
        requireEnabled: true,
        selectors: [target('editing-track')],
        title: 'Preview Project Track options',
        body: 'Open an Epic Project Track menu to preview the available options; you can close it without changing the value.',
        loadingBody: 'Loading Project Track controls for this dashboard view.',
        fallbackBody: 'Project Track menus appear on editable Epics when the current view and your permissions make them available. No value change is required.',
    }),
    freezeStep({
        id: 'editing-status',
        presence: 'fallback',
        progression: 'menu-preview',
        group: FIELD_PREVIEWS,
        requireEnabled: true,
        selectors: [
            issueKindTarget('editing-status', 'epic'),
            issueKindTarget('editing-status', 'story'),
        ],
        title: 'Preview Status options',
        body: 'Open an Epic or Story Status menu to preview the available transitions; you can close it without changing the value.',
        loadingBody: 'Loading Status controls for this dashboard view.',
        fallbackBody: 'Status menus appear on editable Epics and Stories when the current view and your permissions make them available. No value change is required.',
    }),
    freezeStep({
        id: 'jira-export',
        presence: 'conditional',
        progression: 'manual',
        group: CONTINUE_IN_JIRA,
        requireEnabled: true,
        selectors: [target('jira-export')],
        title: 'Continue in Jira',
        body: 'Open the current issue set in Jira when you need its full issue tools.',
    }),
    freezeStep({
        id: 'complete',
        presence: 'required',
        progression: 'finish',
        group: CONTINUE_IN_JIRA,
        selectors: [],
        title: 'Tour complete',
        body: 'Finish the tour to return to the dashboard.',
    }),
]);

const HIERARCHY_FALLBACK_STEP = freezeStep({
    id: 'hierarchy',
    presence: 'fallback',
    progression: 'manual',
    group: WORK_HIERARCHY,
    selectors: [target('hierarchy')],
    title: 'Follow work from goal to delivery',
    body: 'Work is organized from Initiatives to Epics and then to the Stories that deliver them.',
    fallbackBody: 'Work is organized from Initiatives to Epics and then to the Stories that deliver them. This structure appears when issue data is available.',
    terminalErrorBody: 'Hierarchy examples could not be loaded for this dashboard view. Continue with the tour or retry the dashboard later.',
});

const EDITING_FALLBACK_STEP = freezeStep({
    id: 'editing',
    presence: 'fallback',
    progression: 'manual',
    group: FIELD_PREVIEWS,
    selectors: [target('editing')],
    title: 'Preview Jira fields safely',
    body: 'Priority, Project Track, and Status previews appear when matching editable work is available. No value change is required.',
    fallbackBody: 'Priority, Project Track, and Status previews appear when matching editable work is available. No value change is required.',
    terminalErrorBody: 'Field previews could not be loaded for this dashboard view. Continue with the tour or retry the dashboard later.',
});

export function buildVisibleOnboardingSteps(availability = {}, { engReadiness = 'settled' } = {}) {
    const engLoading = engReadiness === 'loading';
    const hasVisibleHierarchy = HIERARCHY_STEP_IDS.some((id) => availability[id] === true);
    const hasVisibleEditing = EDITING_STEP_IDS.some((id) => availability[id] === true);
    const steps = [];
    ONBOARDING_STEP_CATALOG.forEach((step) => {
        if (step.presence === 'hierarchy') {
            if (engLoading || hasVisibleHierarchy) {
                steps.push(step);
            } else if (step.id === HIERARCHY_STEP_IDS[0]) {
                steps.push(HIERARCHY_FALLBACK_STEP);
            }
            return;
        }
        if (EDITING_STEP_IDS.includes(step.id)) {
            if (engLoading || hasVisibleEditing) {
                steps.push(step);
            } else if (step.id === EDITING_STEP_IDS[0]) {
                steps.push(EDITING_FALLBACK_STEP);
            }
            return;
        }
        if (step.presence !== 'conditional' || availability[step.id] === true) {
            steps.push(step);
        }
    });
    return steps;
}

export function resolveSectionSkipTargetId(steps = [], currentStepId = '') {
    const current = steps.find((step) => step.id === currentStepId);
    if (current?.group === WORK_HIERARCHY) {
        return steps.find((step) => step.group === FIELD_PREVIEWS)?.id || '';
    }
    if (current?.group === FIELD_PREVIEWS) {
        return steps.find((step) => step.id === 'jira-export')?.id
            || steps.find((step) => step.id === 'complete')?.id
            || '';
    }
    return '';
}

function viewportSize(viewport = {}) {
    return {
        width: Math.max(0, Number(viewport.width) || 0),
        height: Math.max(0, Number(viewport.height) || 0),
    };
}

export function isVisibleViewportTarget(node, viewport, options = {}) {
    if (!isRenderableTarget(node, options)) return false;
    const rect = node.getBoundingClientRect();
    const size = viewportSize(viewport);
    return rect.right > 0
        && rect.bottom > 0
        && rect.left < size.width
        && rect.top < size.height;
}

function isDisabledTarget(node) {
    if (node.disabled || node.getAttribute?.('aria-disabled') === 'true') return true;
    if (typeof node.matches !== 'function') return false;
    try {
        return node.matches(':disabled');
    } catch (_error) {
        return true;
    }
}

function suppressionOwnership(node, records) {
    return (records || []).find((record) => record?.node === node)?.owned || {};
}

export function queueTourOwnedSuppressionMutation(pendingWrites, node, attributeName) {
    if (!Array.isArray(pendingWrites) || !node || !attributeName) return;
    pendingWrites.push({ node, attributeName });
}

export function consumeTourOwnedSuppressionMutation(record, pendingWrites = []) {
    if (record?.type !== 'attributes' || !Array.isArray(pendingWrites)) return false;
    const index = pendingWrites.findIndex((entry) => (
        entry.node === record.target && entry.attributeName === record.attributeName
    ));
    if (index < 0) return false;
    pendingWrites.splice(index, 1);
    return true;
}

export function revokeTourOwnedSuppressionForMutation(record, suppressionRecords = []) {
    if (record?.type !== 'attributes') return;
    const owned = suppressionOwnership(record.target, suppressionRecords);
    if (record.attributeName === 'aria-hidden') owned.ariaHidden = false;
    if (record.attributeName === 'inert') {
        owned.inertAttribute = false;
        owned.inertProperty = false;
    }
}

export function isRenderableTarget(node, { requireEnabled = false, tourOwnedSuppressionRecords = [] } = {}) {
    if (!node || typeof node.getBoundingClientRect !== 'function') return false;
    if (requireEnabled && isDisabledTarget(node)) return false;
    if (typeof node.checkVisibility === 'function') {
        try {
            if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        } catch (_error) {
            // Older engines may expose checkVisibility without accepting its options.
        }
    }

    let current = node;
    while (current) {
        const owned = suppressionOwnership(current, tourOwnedSuppressionRecords);
        if (current.hidden
            || (current.inert && owned.inertProperty !== true)
            || (current.hasAttribute?.('inert') && owned.inertAttribute !== true)
            || (current.getAttribute?.('aria-hidden') === 'true' && owned.ariaHidden !== true)) {
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
        current = current.parentElement;
    }

    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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

export function resolveRenderableTarget(selectors, root, viewport, options = {}) {
    if (!root || typeof root.querySelectorAll !== 'function') return null;
    for (const selector of selectors || []) {
        const candidates = Array.from(root.querySelectorAll(selector) || []);
        const visible = candidates.find((node) => isVisibleViewportTarget(node, viewport, options));
        if (visible) return visible;
        const renderable = candidates.find((node) => isRenderableTarget(node, options));
        if (renderable) return renderable;
    }
    return null;
}

export function resolveStepTarget(step, root, viewport) {
    if (!step) return null;
    return resolveVisibleTarget(step.selectors, root, viewport, { requireEnabled: step.requireEnabled === true });
}

export function resolveOnboardingSnapshot(root, viewport, options = {}) {
    const engReadiness = options.engReadiness || 'settled';
    const targets = {};
    const availability = {};
    ONBOARDING_STEP_CATALOG.forEach((step) => {
        const targetOptions = {
            ...options,
            requireEnabled: step.requireEnabled === true,
        };
        let resolved;
        if (isOnboardingEngDataStep(step)) {
            resolved = engReadiness === 'settled'
                ? resolveRenderableTarget(step.selectors, root, viewport, targetOptions)
                : null;
        } else {
            resolved = resolveVisibleTarget(step.selectors, root, viewport, targetOptions);
        }
        targets[step.id] = resolved;
        availability[step.id] = Boolean(resolved);
    });
    return {
        steps: buildVisibleOnboardingSteps(availability, { engReadiness }),
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

export function shouldUseInteractiveCoachmark(eligible, placement) {
    return Boolean(eligible && placement?.mode === 'target');
}

export function reconcileCurrentStepId({ previousSteps = [], nextSteps = [], currentStepId = '' } = {}) {
    if (!nextSteps.length) return '';
    if (nextSteps.some((step) => step.id === currentStepId)) return currentStepId;
    if (currentStepId.startsWith('hierarchy-') && nextSteps.some((step) => step.id === 'hierarchy')) {
        return 'hierarchy';
    }
    if (currentStepId.startsWith('editing-') && nextSteps.some((step) => step.id === 'editing')) {
        return 'editing';
    }
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

export function buildStepPresentation(step, targetNode, { engReadiness = 'settled' } = {}) {
    const loading = engReadiness === 'loading' && isOnboardingEngDataStep(step);
    if (loading) {
        return {
            title: step?.title || '',
            body: step?.loadingBody || 'Loading dashboard data.',
            fallback: false,
            loading: true,
        };
    }
    if (engReadiness === 'terminal-error' && step?.terminalErrorBody) {
        return {
            title: step.title || '',
            body: step.terminalErrorBody,
            fallback: true,
            loading: false,
        };
    }
    const fallback = !targetNode;
    return {
        title: step?.title || '',
        body: fallback ? (step?.fallbackBody || step?.body || '') : (step?.body || ''),
        fallback,
        loading: false,
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
