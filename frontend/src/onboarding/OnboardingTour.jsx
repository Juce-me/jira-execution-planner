import * as React from 'react';
import { createPortal } from 'react-dom';
import {
    ONBOARDING_STEP_CATALOG,
    buildStepPresentation,
    buildTourProgress,
    buildVisibleOnboardingSteps,
    computeCoachmarkPlacement,
    consumeTourOwnedSuppressionMutation,
    isVisibleViewportTarget,
    queueTourOwnedSuppressionMutation,
    resolveSectionSkipTargetId,
    resolveOnboardingSnapshot,
    revokeTourOwnedSuppressionForMutation,
    shouldUseInteractiveCoachmark,
    ONBOARDING_STEPS_BY_MODULE,
} from './onboardingSteps.js';
import {
    appendAriaDescribedByToken,
    collectInteractionIsolationTargets,
    isExactMenuButtonTrigger,
    restoreInteractionSuppression,
    suppressForInteraction,
} from './onboardingInteraction.js';
import useOnboardingTour from './useOnboardingTour.js';
import { AUTH_REQUIRED_EVENT } from '../api/authRequired.js';

const FOCUSABLE = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');
const DEFAULT_COACHMARK_SIZE = { width: 380, height: 250 };
const SPOTLIGHT_PADDING = 6;
const DASHBOARD_MOBILE_QUERY = '(max-width: 760px)';
const PREVIEW_STATES = new Set(['loading', 'ready', 'empty', 'error']);
const PROGRESS_CLOSE_REASONS = new Set(['same_trigger', 'escape']);

function descriptorsMatch(left, right) {
    return Boolean(left && right
        && left.sessionId === right.sessionId
        && left.stepId === right.stepId
        && left.fieldKind === right.fieldKind
        && left.issueKey === right.issueKey
        && left.targetIdentity === right.targetIdentity);
}

function fieldKindForStep(stepId) {
    if (stepId === 'editing-priority') return 'priority';
    if (stepId === 'editing-track') return 'track';
    if (stepId === 'editing-status') return 'status';
    return '';
}

function buildPreviewDescriptor(sessionId, step, target) {
    const fieldKind = fieldKindForStep(step?.id);
    const issueKey = String(target?.getAttribute?.('data-issue-key') || '').trim();
    const targetIdentity = String(target?.getAttribute?.('data-onboarding-target-identity') || '').trim();
    if (!sessionId || !fieldKind || !issueKey || !targetIdentity) return null;
    return { sessionId, stepId: step.id, fieldKind, issueKey, targetIdentity };
}

function matchesStepSelector(target, step) {
    if (!target || !step) return false;
    return step.selectors.some((selector) => {
        try {
            return target.matches(selector);
        } catch (_error) {
            return false;
        }
    });
}

function matchesExactStepTarget(target, step) {
    return target?.getAttribute?.('data-onboarding-target') === step?.id
        && matchesStepSelector(target, step);
}

function rectUnion(first, second) {
    if (!first) return second;
    if (!second) return first;
    const left = Math.min(first.left, second.left);
    const top = Math.min(first.top, second.top);
    const right = Math.max(first.right, second.right);
    const bottom = Math.max(first.bottom, second.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function translateRect(rect, deltaLeft, deltaTop) {
    if (!rect) return null;
    return {
        left: rect.left + deltaLeft,
        top: rect.top + deltaTop,
        right: rect.right + deltaLeft,
        bottom: rect.bottom + deltaTop,
        width: rect.width,
        height: rect.height,
    };
}

function lockOverflow(node) {
    const properties = ['overflow', 'overflow-x', 'overflow-y'].map((property) => ({
        property,
        value: node.style.getPropertyValue(property),
        priority: node.style.getPropertyPriority(property),
    }));
    const record = {
        node,
        properties,
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
    };
    node.style.setProperty('overflow', 'hidden', 'important');
    return record;
}

function restoreOverflow(record) {
    if (!record) return;
    const { node, properties, scrollLeft, scrollTop } = record;
    properties.forEach(({ property }) => node.style.removeProperty(property));
    properties.forEach(({ property, value, priority }) => {
        if (value) node.style.setProperty(property, value, priority);
    });
    node.scrollLeft = scrollLeft;
    node.scrollTop = scrollTop;
}

function lockTargetAncestorScroll(target) {
    const records = [];
    let ancestor = target?.parentElement || null;
    while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
        const computed = window.getComputedStyle(ancestor);
        if (/(?:auto|scroll|overlay)/.test(`${computed.overflowX} ${computed.overflowY}`)) {
            records.push(lockOverflow(ancestor));
        }
        ancestor = ancestor.parentElement;
    }
    return records;
}

function restoreTargetAncestorScroll(records) {
    records.slice().reverse().forEach(restoreOverflow);
}

function exactTargetHitTest(target, viewport = viewportSize()) {
    const rect = target?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const points = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + 1, rect.top + rect.height / 2],
        [rect.right - 1, rect.top + rect.height / 2],
        [rect.left + rect.width / 2, rect.top + 1],
        [rect.left + rect.width / 2, rect.bottom - 1],
    ];
    return points.every(([x, y]) => {
        if (x < viewport.left || x > viewport.right || y < viewport.top || y > viewport.bottom) return false;
        const hit = document.elementFromPoint(x, y);
        return hit === target || target.contains(hit);
    });
}

function viewportSize() {
    const visualViewport = window.visualViewport;
    const left = Math.max(0, Number(visualViewport?.offsetLeft) || 0);
    const top = Math.max(0, Number(visualViewport?.offsetTop) || 0);
    const width = Math.max(0, Number(visualViewport?.width) || document.documentElement.clientWidth);
    const height = Math.max(0, Number(visualViewport?.height) || window.innerHeight);
    return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
    };
}

function isDashboardMobileViewport() {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.(DASHBOARD_MOBILE_QUERY).matches ?? window.innerWidth <= 760;
}

function isVisibleInViewport(node, viewport, options) {
    if (!isVisibleViewportTarget(node, { width: viewport.right, height: viewport.bottom }, options)) return false;
    const rect = node.getBoundingClientRect();
    return rect.right > viewport.left
        && rect.bottom > viewport.top
        && rect.left < viewport.right
        && rect.top < viewport.bottom;
}

function sameSnapshot(left, right) {
    if (left.steps.length !== right.steps.length) return false;
    if ((left.catchUpSteps || []).length !== (right.catchUpSteps || []).length) return false;
    return left.steps.every((step, index) => (
        step.id === right.steps[index]?.id && left.targets[step.id] === right.targets[step.id]
    )) && (left.catchUpSteps || []).every((step, index) => step.id === right.catchUpSteps[index]?.id);
}

function sameRect(left, right) {
    if (left === right) return true;
    if (!left || !right) return false;
    return left.left === right.left
        && left.top === right.top
        && left.right === right.right
        && left.bottom === right.bottom
        && left.width === right.width
        && left.height === right.height;
}

function sameGeometry(left, right) {
    return left.target === right.target
        && sameRect(left.targetRect, right.targetRect)
        && sameRect(left.previewRect, right.previewRect)
        && left.viewport?.left === right.viewport?.left
        && left.viewport?.top === right.viewport?.top
        && left.viewport?.width === right.viewport?.width
        && left.viewport?.height === right.viewport?.height
        && left.viewport?.right === right.viewport?.right
        && left.viewport?.bottom === right.viewport?.bottom
        && left.coachmarkSize.width === right.coachmarkSize.width
        && left.coachmarkSize.height === right.coachmarkSize.height;
}

function includeModuleLaunchSteps(steps, catalog) {
    const launchSteps = catalog.filter((step) => step.progression === 'module-launch');
    if (!launchSteps.length) return steps;
    const withoutLaunchers = steps.filter((step) => step.progression !== 'module-launch');
    const completeIndex = withoutLaunchers.findIndex((step) => step.id === 'complete');
    if (completeIndex < 0) return [...withoutLaunchers, ...launchSteps];
    return [
        ...withoutLaunchers.slice(0, completeIndex),
        ...launchSteps,
        ...withoutLaunchers.slice(completeIndex),
    ];
}

function readSnapshot(eligibleTargets, engReadiness, tourOwnedSuppressionRecords = [], catalog = ONBOARDING_STEP_CATALOG) {
    const viewport = viewportSize();
    const raw = resolveOnboardingSnapshot(document, { width: viewport.right, height: viewport.bottom }, {
        engReadiness,
        tourOwnedSuppressionRecords,
        catalog,
    });
    if (!eligibleTargets) return { ...raw, steps: includeModuleLaunchSteps(raw.steps, catalog) };
    const availability = {};
    catalog.forEach((step) => {
        const explicitlyEligible = eligibleTargets[step.id] !== false;
        availability[step.id] = explicitlyEligible && Boolean(raw.targets[step.id]);
    });
    return {
        steps: includeModuleLaunchSteps(
            buildVisibleOnboardingSteps(availability, { engReadiness, catalog }),
            catalog,
        ),
        targets: raw.targets,
    };
}

export default function OnboardingTour({
    run = false,
    onboardingDone = true,
    eligibleTargets = null,
    onSkip,
    onFinish,
    actionPending = false,
    actionError = '',
    returnFocusRef = null,
    engReadiness = 'settled',
    previewSession = null,
    onPreviewTargetChange,
    onRequestPreviewClose,
    activeSurface = 'catch-up',
    moduleRequest = null,
    onModuleRequestConsumed,
    settingsDirty = false,
    settingsSaving = false,
} = {}) {
    const [snapshot, setSnapshot] = React.useState(() => (
        typeof document === 'undefined'
            ? (() => {
                const steps = buildVisibleOnboardingSteps({}, { engReadiness });
                return { steps, catchUpSteps: steps, targets: {} };
            })()
            : (() => {
                const initialSnapshot = readSnapshot(eligibleTargets, engReadiness);
                return { ...initialSnapshot, catchUpSteps: initialSnapshot.steps };
            })()
    ));
    const tour = useOnboardingTour({
        steps: snapshot.catchUpSteps,
        run,
        onboardingDone,
        onSkip,
        onFinish,
        activeSurface,
        moduleRequest,
        onModuleRequestConsumed,
    });
    const skipTour = tour.skip;
    const panelRef = React.useRef(null);
    const layerRef = React.useRef(null);
    const shieldRefs = React.useRef([]);
    const backButtonRef = React.useRef(null);
    const sectionSkipButtonRef = React.useRef(null);
    const skipButtonRef = React.useRef(null);
    const nextButtonRef = React.useRef(null);
    const priorFocusRef = React.useRef(null);
    const tourOwnedSuppressionRef = React.useRef([]);
    const pendingOwnedMutationsRef = React.useRef([]);
    const scrollEntryRef = React.useRef({ stepId: '', target: null });
    const previewDescriptorRef = React.useRef(null);
    const previewSettledStateRef = React.useRef('');
    const previewFocusedRef = React.useRef(false);
    const cleanupLatchRef = React.useRef(false);
    const progressCloseLatchRef = React.useRef(false);
    const requestPreviewCloseRef = React.useRef(onRequestPreviewClose);
    requestPreviewCloseRef.current = onRequestPreviewClose;
    const [previewFallbackStepId, setPreviewFallbackStepId] = React.useState('');
    const [previewFallbackTargetIdentity, setPreviewFallbackTargetIdentity] = React.useState('');
    const [unsafeTargetIdentity, setUnsafeTargetIdentity] = React.useState('');
    const [authLocked, setAuthLocked] = React.useState(false);
    const [mobileSuppressed, setMobileSuppressed] = React.useState(isDashboardMobileViewport);
    const [geometry, setGeometry] = React.useState({
        target: null,
        targetRect: null,
        previewRect: null,
        viewport: null,
        coachmarkSize: DEFAULT_COACHMARK_SIZE,
    });
    const headingId = React.useId();
    const descriptionId = `${headingId}-description`;

    React.useEffect(() => () => {
        tour.clearStepUnlock();
        if (!previewDescriptorRef.current) return;
        const descriptor = previewDescriptorRef.current;
        cleanupLatchRef.current = true;
        previewDescriptorRef.current = null;
        requestPreviewCloseRef.current?.(descriptor, 'unmount');
    }, [tour.clearStepUnlock]);

    React.useEffect(() => {
        const media = window.matchMedia?.(DASHBOARD_MOBILE_QUERY);
        const update = () => setMobileSuppressed(media?.matches ?? window.innerWidth <= 760);
        update();
        if (typeof media?.addEventListener === 'function') {
            media.addEventListener('change', update);
            return () => media.removeEventListener('change', update);
        }
        media?.addListener?.(update);
        return () => media?.removeListener?.(update);
    }, []);

    React.useEffect(() => {
        if (!tour.isOpen) return undefined;
        const handleAuthenticationRequired = () => {
            cleanupLatchRef.current = true;
            const descriptor = previewDescriptorRef.current;
            if (descriptor) requestPreviewCloseRef.current?.(descriptor, 'auth_required');
            previewDescriptorRef.current = null;
            previewSettledStateRef.current = '';
            previewFocusedRef.current = false;
            progressCloseLatchRef.current = false;
            onPreviewTargetChange?.(null);
            tour.clearStepUnlock();
            setAuthLocked(true);
            tour.resetSession();
        };
        window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthenticationRequired);
        return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthenticationRequired);
    }, [onPreviewTargetChange, tour.clearStepUnlock, tour.isOpen, tour.resetSession]);

    React.useEffect(() => {
        if (!mobileSuppressed || !tour.isOpen) return;
        cleanupLatchRef.current = true;
        const descriptor = previewDescriptorRef.current;
        if (descriptor) requestPreviewCloseRef.current?.(descriptor, 'target_loss');
        previewDescriptorRef.current = null;
        previewSettledStateRef.current = '';
        previewFocusedRef.current = false;
        progressCloseLatchRef.current = false;
        onPreviewTargetChange?.(null);
        tour.clearStepUnlock();
    }, [mobileSuppressed, onPreviewTargetChange, tour.clearStepUnlock, tour.isOpen]);

    const measure = React.useCallback(() => {
        if (!tour.isOpen || !tour.currentStep || tour.suspended || authLocked || mobileSuppressed) return;
        const tourOwnedSuppressionRecords = tourOwnedSuppressionRef.current;
        const catalog = tour.moduleSession.activeModule === 'catch-up'
            ? ONBOARDING_STEP_CATALOG
            : (ONBOARDING_STEPS_BY_MODULE[tour.moduleSession.activeModule] || []);
        const nextSnapshot = readSnapshot(eligibleTargets, engReadiness, tourOwnedSuppressionRecords, catalog);
        setSnapshot((current) => {
            const activeSnapshot = tour.currentStep?.progression === 'menu-preview'
                && tourOwnedSuppressionRecords.length
                ? { ...nextSnapshot, steps: current.steps }
                : nextSnapshot;
            const reconciledSnapshot = {
                ...activeSnapshot,
                catchUpSteps: tour.moduleSession.activeModule === 'catch-up'
                    ? activeSnapshot.steps
                    : current.catchUpSteps,
            };
            return sameSnapshot(current, reconciledSnapshot) ? current : reconciledSnapshot;
        });

        const entryViewport = viewportSize();
        const candidate = nextSnapshot.targets[tour.currentStep.id] || null;
        const targetOptions = {
            tourOwnedSuppressionRecords,
            requireEnabled: tour.currentStep.requireEnabled === true,
        };
        const priorEntry = scrollEntryRef.current;
        const isNewEntry = priorEntry.stepId !== tour.currentStep.id || priorEntry.target !== candidate;
        if (isNewEntry) {
            scrollEntryRef.current = { stepId: tour.currentStep.id, target: candidate };
            if (candidate && !isVisibleInViewport(candidate, entryViewport, targetOptions)) {
                candidate.scrollIntoView?.({ behavior: 'instant', block: 'center', inline: 'nearest' });
            }
        }
        const measuredViewport = viewportSize();
        const target = candidate && isVisibleInViewport(candidate, measuredViewport, targetOptions)
            ? candidate
            : null;
        const rect = target?.getBoundingClientRect?.() || null;
        const previewMenu = previewDescriptorRef.current
            ? document.querySelector(`[data-onboarding-preview-owner="${CSS.escape(previewDescriptorRef.current.targetIdentity)}"]`)
            : null;
        const previewRect = previewMenu?.getBoundingClientRect?.() || null;
        const panelRect = panelRef.current?.getBoundingClientRect?.();
        const nextGeometry = {
            target,
            targetRect: rect,
            previewRect,
            viewport: measuredViewport,
            coachmarkSize: panelRect?.width && panelRect?.height
                ? { width: panelRect.width, height: panelRect.height }
                : DEFAULT_COACHMARK_SIZE,
        };
        setGeometry((current) => sameGeometry(current, nextGeometry) ? current : nextGeometry);
    }, [authLocked, eligibleTargets, engReadiness, mobileSuppressed, tour.currentStep, tour.isOpen, tour.moduleSession.activeModule, tour.suspended]);

    React.useLayoutEffect(() => {
        if (!tour.isOpen || tour.suspended || authLocked || mobileSuppressed) return undefined;
        measure();
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        window.visualViewport?.addEventListener('resize', measure);
        window.visualViewport?.addEventListener('scroll', measure);

        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(measure)
            : null;
        if (geometry.target) resizeObserver?.observe(geometry.target);
        if (panelRef.current) resizeObserver?.observe(panelRef.current);

        const mutationRoot = document.getElementById('root') || document.body;
        const mutationObserver = typeof MutationObserver !== 'undefined'
            ? new MutationObserver((records) => {
                const owned = tourOwnedSuppressionRef.current;
                const provenance = records.map((record) => {
                    const tourOwned = consumeTourOwnedSuppressionMutation(
                        record,
                        pendingOwnedMutationsRef.current
                    );
                    if (!tourOwned) revokeTourOwnedSuppressionForMutation(record, owned);
                    return tourOwned;
                });
                const onlyTourOwnedSuppression = provenance.length > 0 && provenance.every(Boolean);
                if (!onlyTourOwnedSuppression) measure();
            })
            : null;
        mutationObserver?.observe(mutationRoot, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'disabled', 'inert', 'aria-hidden', 'aria-disabled'],
        });

        return () => {
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
            window.visualViewport?.removeEventListener('resize', measure);
            window.visualViewport?.removeEventListener('scroll', measure);
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
        };
    }, [authLocked, geometry.target, measure, mobileSuppressed, tour.isOpen, tour.suspended]);

    const target = geometry.target;
    const basePresentation = tour.currentStep
        ? buildStepPresentation(tour.currentStep, target, { engReadiness })
        : { fallback: true, loading: false, title: '', body: '' };
    const previewStep = tour.currentStep?.progression === 'menu-preview';
    const targetReachableStep = tour.currentStep?.interaction === 'target-reachable';
    const settingsContextStep = tour.moduleSession.activeModule === 'configuration'
        && tour.currentStep?.progression === 'module-manual';
    const targetIdentity = target?.getAttribute?.('data-onboarding-target-identity') || '';
    const exactPreviewTarget = previewStep
        && matchesExactStepTarget(target, tour.currentStep)
        && isExactMenuButtonTrigger(target, target)
        && targetIdentity !== unsafeTargetIdentity;
    const previewForcedFallback = previewFallbackStepId === tour.currentStep?.id
        && previewFallbackTargetIdentity === targetIdentity;
    const unsafeForcedFallback = Boolean(targetIdentity && unsafeTargetIdentity === targetIdentity);
    const viewport = geometry.viewport || (typeof document === 'undefined'
        ? { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
        : viewportSize());
    const rawPlacement = computeCoachmarkPlacement({
        targetRect: translateRect(rectUnion(geometry.targetRect, geometry.previewRect), -viewport.left, -viewport.top),
        coachmarkSize: geometry.coachmarkSize,
        viewport,
    });
    const placement = {
        ...rawPlacement,
        left: rawPlacement.left + viewport.left,
        top: rawPlacement.top + viewport.top,
    };
    const exactReachableTarget = targetReachableStep && matchesStepSelector(target, tour.currentStep);
    const interactiveEligible = Boolean((exactPreviewTarget || exactReachableTarget)
        && !authLocked
        && !mobileSuppressed
        && !basePresentation.loading
        && !basePresentation.fallback
        && !previewForcedFallback);
    const interactive = shouldUseInteractiveCoachmark(interactiveEligible, rawPlacement);
    const presentation = previewForcedFallback || unsafeForcedFallback || rawPlacement.mode === 'fallback'
        ? buildStepPresentation(tour.currentStep, null, { engReadiness })
        : basePresentation;
    const matchedPreviewSession = descriptorsMatch(previewDescriptorRef.current, previewSession)
        ? previewSession
        : null;
    const previewState = matchedPreviewSession?.state || 'closed';
    const previewOpen = PREVIEW_STATES.has(previewState);

    React.useEffect(() => {
        if (!tour.isOpen || authLocked || mobileSuppressed) return undefined;
        const preferredReturnFocus = returnFocusRef?.current;
        priorFocusRef.current = preferredReturnFocus?.isConnected
            ? preferredReturnFocus
            : document.activeElement;
        return () => {
            const priorFocus = priorFocusRef.current;
            if (priorFocus?.isConnected && typeof priorFocus.focus === 'function') priorFocus.focus();
        };
    }, [authLocked, mobileSuppressed, returnFocusRef, tour.isOpen]);

    React.useLayoutEffect(() => {
        if (!tour.isOpen || !tour.currentStep || tour.suspended || authLocked || mobileSuppressed) return undefined;
        const appRoot = document.getElementById('root');
        if (!appRoot) return undefined;

        const records = [];
        const recordOwnedMutation = (node, attributeName) => {
            queueTourOwnedSuppressionMutation(pendingOwnedMutationsRef.current, node, attributeName);
        };
        const suppress = (node) => {
            records.push(suppressForInteraction(node, recordOwnedMutation));
        };
        let describedBySnapshot = null;
        let targetAncestorScrollRecords = [];
        let htmlOverflowRecord = null;
        let bodyOverflowRecord = null;
        if (interactive && !settingsContextStep) {
            const ownedPortal = previewDescriptorRef.current
                ? document.querySelector(`[data-onboarding-preview-portal="${CSS.escape(previewDescriptorRef.current.targetIdentity)}"]`)
                : null;
            const isolationTargets = collectInteractionIsolationTargets({
                target,
                root: appRoot,
                body: document.body,
                coachmark: layerRef.current,
                shields: shieldRefs.current,
                ownedPreviewPortal: ownedPortal,
            });
            isolationTargets.forEach(suppress);
            describedBySnapshot = {
                present: target.hasAttribute('aria-describedby'),
                value: target.getAttribute('aria-describedby'),
            };
            target.setAttribute('aria-describedby', appendAriaDescribedByToken(describedBySnapshot.value, descriptionId));
            htmlOverflowRecord = lockOverflow(document.documentElement);
            bodyOverflowRecord = lockOverflow(document.body);
            targetAncestorScrollRecords = lockTargetAncestorScroll(target);
        } else if (!interactive) {
            suppress(appRoot);
        } else {
            describedBySnapshot = {
                present: target.hasAttribute('aria-describedby'),
                value: target.getAttribute('aria-describedby'),
            };
            target.setAttribute('aria-describedby', appendAriaDescribedByToken(describedBySnapshot.value, descriptionId));
        }
        tourOwnedSuppressionRef.current = records;

        return () => {
            records.slice().reverse().forEach((record) => {
                restoreInteractionSuppression(record, recordOwnedMutation);
            });
            if (describedBySnapshot && target) {
                if (describedBySnapshot.present) target.setAttribute('aria-describedby', describedBySnapshot.value);
                else target.removeAttribute('aria-describedby');
                restoreTargetAncestorScroll(targetAncestorScrollRecords);
                restoreOverflow(bodyOverflowRecord);
                restoreOverflow(htmlOverflowRecord);
            }
            if (tourOwnedSuppressionRef.current === records) tourOwnedSuppressionRef.current = [];
        };
    }, [
        descriptionId,
        authLocked,
        mobileSuppressed,
        interactive,
        interactive ? previewState : '',
        interactive ? target : null,
        interactive ? tour.currentStep : null,
        settingsContextStep,
        tour.isOpen,
        tour.suspended,
    ]);

    React.useEffect(() => {
        if (previewFallbackStepId === tour.currentStep?.id
            && previewFallbackTargetIdentity
            && previewFallbackTargetIdentity !== targetIdentity) {
            tour.clearStepUnlock();
        }
        if (!interactive || !target || !tour.currentStep) {
            if (previewDescriptorRef.current) {
                cleanupLatchRef.current = true;
                tour.clearStepUnlock();
                onRequestPreviewClose?.(previewDescriptorRef.current, 'target_loss');
                previewDescriptorRef.current = null;
                onPreviewTargetChange?.(null);
            }
            return undefined;
        }
        const descriptor = buildPreviewDescriptor(tour.sessionId, tour.currentStep, target);
        if (!descriptor) return undefined;
        if (!descriptorsMatch(previewDescriptorRef.current, descriptor)) {
            if (previewDescriptorRef.current) {
                cleanupLatchRef.current = true;
                tour.clearStepUnlock();
                onRequestPreviewClose?.(previewDescriptorRef.current, 'target_loss');
            }
            previewSettledStateRef.current = '';
            previewFocusedRef.current = false;
            cleanupLatchRef.current = false;
            progressCloseLatchRef.current = false;
            previewDescriptorRef.current = descriptor;
            onPreviewTargetChange?.(descriptor);
        }
        return undefined;
    }, [interactive, onPreviewTargetChange, onRequestPreviewClose, previewFallbackStepId, previewFallbackTargetIdentity, target, targetIdentity, tour.clearStepUnlock, tour.currentStep, tour.sessionId]);

    React.useEffect(() => {
        if (!matchedPreviewSession || !previewDescriptorRef.current) return;
        if (previewState === 'auth_required') {
            if (cleanupLatchRef.current) return;
            cleanupLatchRef.current = true;
            requestPreviewCloseRef.current?.(previewDescriptorRef.current, 'auth_required');
            return;
        }
        if (previewState === 'ready' || previewState === 'empty') {
            previewSettledStateRef.current = previewState;
            const menu = document.querySelector(`[data-onboarding-preview-owner="${CSS.escape(matchedPreviewSession.targetIdentity)}"]`);
            previewFocusedRef.current = previewFocusedRef.current || document.activeElement === menu;
            window.requestAnimationFrame(() => {
                const currentMenu = document.querySelector(`[data-onboarding-preview-owner="${CSS.escape(matchedPreviewSession.targetIdentity)}"]`);
                if (document.activeElement === currentMenu) previewFocusedRef.current = true;
            });
            measure();
            return;
        }
        if (previewState === 'error') {
            previewSettledStateRef.current = 'error';
            measure();
            return;
        }
        if (previewState !== 'closed') return;
        progressCloseLatchRef.current = false;
        const reason = matchedPreviewSession.reason || '';
        if (cleanupLatchRef.current || !PROGRESS_CLOSE_REASONS.has(reason)) {
            cleanupLatchRef.current = false;
            previewSettledStateRef.current = '';
            previewFocusedRef.current = false;
            return;
        }
        if (previewSettledStateRef.current === 'error') {
            const descriptor = previewDescriptorRef.current;
            const closedTargetIdentity = descriptor.targetIdentity;
            previewDescriptorRef.current = null;
            onPreviewTargetChange?.(null);
            setPreviewFallbackStepId(tour.currentStepId);
            setPreviewFallbackTargetIdentity(closedTargetIdentity);
            tour.unlockStep({ sessionId: descriptor.sessionId, stepId: descriptor.stepId });
        } else if ((previewSettledStateRef.current === 'ready' || previewSettledStateRef.current === 'empty')
            && previewFocusedRef.current) {
            const descriptor = previewDescriptorRef.current;
            target?.focus?.();
            tour.unlockStep({ sessionId: descriptor.sessionId, stepId: descriptor.stepId });
        }
        previewSettledStateRef.current = '';
        previewFocusedRef.current = false;
    }, [matchedPreviewSession, measure, onPreviewTargetChange, previewState, target, tour.currentStepId, tour.unlockStep]);

    React.useEffect(() => {
        setPreviewFallbackStepId('');
        setPreviewFallbackTargetIdentity('');
        setUnsafeTargetIdentity('');
    }, [tour.currentStepId]);

    React.useEffect(() => {
        if (!tour.isOpen || !tour.currentStep || tour.suspended || authLocked || mobileSuppressed) return undefined;
        if (interactive) target?.focus?.();
        else panelRef.current?.focus();
        return undefined;
    }, [authLocked, interactive, mobileSuppressed, target, tour.currentStep, tour.isOpen, tour.suspended]);

    React.useLayoutEffect(() => {
        if (!interactive || !target) return;
        const frame = window.requestAnimationFrame(() => {
            if (!exactTargetHitTest(target, viewportSize())) setUnsafeTargetIdentity(targetIdentity);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [interactive, target, targetIdentity]);

    React.useLayoutEffect(() => {
        if (!interactive || !target || !window.matchMedia?.('(pointer: coarse)').matches) return undefined;
        const initialRect = target.getBoundingClientRect();
        if (initialRect.width >= 44 && initialRect.height >= 44) return undefined;
        const styleSnapshot = target.getAttribute('style');
        const widthDelta = Math.max(0, 44 - initialRect.width);
        const heightDelta = Math.max(0, 44 - initialRect.height);
        target.classList.add('onboarding-tour-coarse-target');
        target.style.marginLeft = `${-widthDelta / 2}px`;
        target.style.marginRight = `${-widthDelta / 2}px`;
        target.style.marginTop = `${-heightDelta / 2}px`;
        target.style.marginBottom = `${-heightDelta / 2}px`;
        const expandedRect = target.getBoundingClientRect();
        const root = document.getElementById('root');
        const overlapsControl = Array.from(root?.querySelectorAll('button, a[href], input, select, textarea, [role="button"]') || [])
            .some((node) => {
                if (node === target || target.contains(node) || node.contains(target)) return false;
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0
                    && expandedRect.left < rect.right
                    && expandedRect.right > rect.left
                    && expandedRect.top < rect.bottom
                    && expandedRect.bottom > rect.top;
            });
        const viewport = viewportSize();
        const outsideViewport = expandedRect.left < viewport.left || expandedRect.top < viewport.top
            || expandedRect.right > viewport.right || expandedRect.bottom > viewport.bottom;
        if (overlapsControl || outsideViewport) {
            target.classList.remove('onboarding-tour-coarse-target');
            if (styleSnapshot === null) target.removeAttribute('style');
            else target.setAttribute('style', styleSnapshot);
            setUnsafeTargetIdentity(targetIdentity);
            return undefined;
        }
        measure();
        return () => {
            target.classList.remove('onboarding-tour-coarse-target');
            if (styleSnapshot === null) target.removeAttribute('style');
            else target.setAttribute('style', styleSnapshot);
        };
    }, [interactive, measure, target, targetIdentity]);

    React.useEffect(() => {
        if (!tour.isOpen || tour.suspended || !interactive || settingsContextStep) return undefined;
        const getIsland = () => {
            const menu = previewOpen && previewDescriptorRef.current
                ? document.querySelector(`[data-onboarding-preview-owner="${CSS.escape(previewDescriptorRef.current.targetIdentity)}"]`)
                : null;
            const controls = [backButtonRef.current, sectionSkipButtonRef.current, nextButtonRef.current, skipButtonRef.current]
                .filter((node) => node && !node.disabled);
            const ordered = previewOpen ? [menu, target, ...controls] : [target, ...controls];
            return ordered.filter((node, index, all) => node && all.indexOf(node) === index);
        };
        const handleFocusIn = (event) => {
            if (event.target?.getAttribute?.('data-onboarding-preview-owner') === previewDescriptorRef.current?.targetIdentity) {
                previewFocusedRef.current = true;
            }
            const island = getIsland();
            if (!island.some((node) => node === event.target || node.contains?.(event.target))) {
                island[0]?.focus?.();
            }
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                if (event.defaultPrevented) return;
                if (previewOpen) {
                    event.preventDefault();
                    event.stopPropagation();
                    const descriptor = previewDescriptorRef.current;
                    if (descriptor && !progressCloseLatchRef.current) {
                        progressCloseLatchRef.current = true;
                        requestPreviewCloseRef.current?.(descriptor, 'escape');
                    }
                    return;
                }
                if (!actionPending) {
                    event.preventDefault();
                    skipTour();
                }
                return;
            }
            if (event.key !== 'Tab') return;
            const island = getIsland();
            const currentIndex = island.indexOf(document.activeElement);
            if (currentIndex < 0) return;
            event.preventDefault();
            const delta = event.shiftKey ? -1 : 1;
            island[(currentIndex + delta + island.length) % island.length]?.focus?.();
        };
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [actionPending, interactive, previewOpen, settingsContextStep, skipTour, target, tour.isOpen, tour.suspended]);

    React.useEffect(() => {
        if (tour.isOpen) return;
        scrollEntryRef.current = { stepId: '', target: null };
        tourOwnedSuppressionRef.current = [];
        pendingOwnedMutationsRef.current = [];
        previewDescriptorRef.current = null;
        previewSettledStateRef.current = '';
        previewFocusedRef.current = false;
        cleanupLatchRef.current = false;
        progressCloseLatchRef.current = false;
        onPreviewTargetChange?.(null);
        tour.clearStepUnlock();
    }, [onPreviewTargetChange, tour.clearStepUnlock, tour.isOpen]);

    if (!tour.isOpen || !tour.currentStep || tour.suspended || authLocked || mobileSuppressed || typeof document === 'undefined') return null;

    const progress = buildTourProgress(tour.steps, tour.index);
    const spotlightBounds = geometry.targetRect ? {
        left: Math.max(viewport.left, geometry.targetRect.left - SPOTLIGHT_PADDING),
        top: Math.max(viewport.top, geometry.targetRect.top - SPOTLIGHT_PADDING),
        right: Math.min(viewport.right, geometry.targetRect.right + SPOTLIGHT_PADDING),
        bottom: Math.min(viewport.bottom, geometry.targetRect.bottom + SPOTLIGHT_PADDING),
    } : null;
    const spotlightStyle = spotlightBounds ? {
        left: spotlightBounds.left,
        top: spotlightBounds.top,
        width: Math.max(0, spotlightBounds.right - spotlightBounds.left),
        height: Math.max(0, spotlightBounds.bottom - spotlightBounds.top),
    } : null;
    const exactRect = geometry.targetRect;
    const shieldStyles = exactRect && !settingsContextStep ? [
        { left: viewport.left, top: viewport.top, width: viewport.width, height: Math.max(0, exactRect.top - viewport.top) },
        { left: viewport.left, top: exactRect.top, width: Math.max(0, exactRect.left - viewport.left), height: exactRect.height },
        { left: exactRect.right, top: exactRect.top, width: Math.max(0, viewport.right - exactRect.right), height: exactRect.height },
        { left: viewport.left, top: exactRect.bottom, width: viewport.width, height: Math.max(0, viewport.bottom - exactRect.bottom) },
    ] : [];
    const interactiveState = previewOpen ? `preview_${previewState}` : 'interactive_closed';
    const sectionSkipTargetId = resolveSectionSkipTargetId(tour.steps, tour.currentStepId);
    const contextualModuleActive = tour.moduleSession.activeModule !== 'catch-up';
    const moduleLaunchStep = tour.currentStep.progression === 'module-launch';
    const moduleManualStep = tour.currentStep.progression === 'module-manual';
    const settingsBlocked = settingsContextStep && (settingsDirty || settingsSaving);

    const requestCleanup = (reason = 'cleanup') => {
        tour.clearStepUnlock();
        if (!previewDescriptorRef.current) return;
        const descriptor = previewDescriptorRef.current;
        cleanupLatchRef.current = true;
        onRequestPreviewClose?.(descriptor, reason);
        previewDescriptorRef.current = null;
        onPreviewTargetChange?.(null);
    };

    const handleBack = () => {
        requestCleanup('cleanup');
        tour.goBack();
    };

    const handleSectionSkip = () => {
        requestCleanup('cleanup');
        if (sectionSkipTargetId) tour.goToStep(sectionSkipTargetId);
    };

    const handleSkip = () => {
        requestCleanup('cleanup');
        tour.skip();
    };

    const handleNext = () => {
        requestCleanup('cleanup');
        if (moduleLaunchStep && presentation.fallback) {
            tour.acknowledgeUnavailableModule();
            return;
        }
        if (moduleManualStep) {
            tour.completeCurrentModule();
            return;
        }
        tour.goNext();
    };

    const handleKeyDown = (event) => {
        if (interactive) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!actionPending) handleSkip();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) || []);
        if (!focusable.length) {
            event.preventDefault();
            panelRef.current?.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    return createPortal(
        <div
            ref={layerRef}
            className={`onboarding-tour-layer${interactive ? ' is-interactive' : ''}${presentation.fallback || presentation.loading || placement.mode === 'fallback' ? ' is-fallback' : ''}`}
            data-onboarding-tour
            data-onboarding-state={interactive ? interactiveState : (presentation.loading ? 'loading' : (presentation.fallback ? 'fallback' : 'target'))}
            data-onboarding-preview-settled={previewSettledStateRef.current || undefined}
            data-onboarding-preview-focused={previewFocusedRef.current ? 'true' : 'false'}
            data-onboarding-preview-cleanup={cleanupLatchRef.current ? 'true' : 'false'}
            data-onboarding-module={tour.moduleSession.activeModule}
        >
            {interactive && shieldStyles.map((style, index) => (
                <div
                    key={index}
                    ref={(node) => { shieldRefs.current[index] = node; }}
                    className="onboarding-tour-shield"
                    style={style}
                    aria-hidden="true"
                />
            ))}
            {spotlightStyle && placement.mode === 'target' && (
                <div className="onboarding-tour-spotlight" style={spotlightStyle} aria-hidden="true" />
            )}
            <section
                ref={panelRef}
                className={`onboarding-tour-card${presentation.fallback || presentation.loading || placement.mode === 'fallback' ? ' is-fallback' : ''}`}
                style={{ left: placement.left, top: placement.top }}
                role="dialog"
                aria-modal={interactive ? undefined : 'true'}
                aria-labelledby={headingId}
                aria-describedby={descriptionId}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
            >
                <div className="onboarding-tour-progress" aria-live={previewOpen ? undefined : 'polite'}>{progress.label}</div>
                <h2 id={headingId}>{presentation.title}</h2>
                <p id={descriptionId}>{settingsBlocked
                    ? 'Save or discard the current Settings changes before continuing.'
                    : interactive && previewStep
                    ? 'Click the highlighted control to preview its choices. Nothing will change.'
                    : presentation.body}</p>
                {actionError && (
                    <div className="onboarding-tour-error" role="alert">
                        <span>{actionError}</span>
                    </div>
                )}
                <div className="onboarding-tour-actions">
                    <button ref={skipButtonRef} type="button" className="secondary" onClick={handleSkip} disabled={actionPending}>
                        Skip onboarding
                    </button>
                    <div className="onboarding-tour-navigation">
                        <button ref={backButtonRef} type="button" className="secondary" onClick={handleBack} disabled={!tour.canGoBack || actionPending}>
                            Back
                        </button>
                        {sectionSkipTargetId && (
                            <button ref={sectionSkipButtonRef} type="button" className="secondary" onClick={handleSectionSkip} disabled={actionPending}>
                                Skip this section
                            </button>
                        )}
                        {tour.isLast && !contextualModuleActive ? (
                            tour.allRequiredModulesComplete && (
                                <button type="button" className="primary" onClick={tour.finish} disabled={actionPending}>Finish</button>
                            )
                        ) : (
                            <button
                                ref={nextButtonRef}
                                type="button"
                                className="primary"
                                onClick={handleNext}
                                disabled={actionPending
                                    || presentation.loading
                                    || settingsBlocked
                                    || (previewStep && !tour.stepUnlocked)
                                    || (moduleLaunchStep ? !presentation.fallback : (!moduleManualStep && !tour.canGoNext))}
                            >Next</button>
                        )}
                    </div>
                </div>
            </section>
        </div>,
        document.body
    );
}
