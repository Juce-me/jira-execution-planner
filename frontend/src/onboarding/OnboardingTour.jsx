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

function matchesExactStepTarget(target, step) {
    if (!target || !step || target.getAttribute?.('data-onboarding-target') !== step.id) return false;
    return step.selectors.some((selector) => {
        try {
            return target.matches(selector);
        } catch (_error) {
            return false;
        }
    });
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

function exactTargetHitTest(target) {
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
        const hit = document.elementFromPoint(x, y);
        return hit === target || target.contains(hit);
    });
}

function viewportSize() {
    return {
        width: document.documentElement.clientWidth,
        height: window.innerHeight,
    };
}

function sameSnapshot(left, right) {
    if (left.steps.length !== right.steps.length) return false;
    return left.steps.every((step, index) => (
        step.id === right.steps[index]?.id && left.targets[step.id] === right.targets[step.id]
    ));
}

function readSnapshot(eligibleTargets, engReadiness, tourOwnedSuppressionRecords = []) {
    const raw = resolveOnboardingSnapshot(document, viewportSize(), {
        engReadiness,
        tourOwnedSuppressionRecords,
    });
    if (!eligibleTargets) return raw;
    const availability = {};
    ONBOARDING_STEP_CATALOG.forEach((step) => {
        const explicitlyEligible = eligibleTargets[step.id] !== false;
        availability[step.id] = explicitlyEligible && Boolean(raw.targets[step.id]);
    });
    return {
        steps: buildVisibleOnboardingSteps(availability, { engReadiness }),
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
} = {}) {
    const [snapshot, setSnapshot] = React.useState(() => (
        typeof document === 'undefined'
            ? { steps: buildVisibleOnboardingSteps({}, { engReadiness }), targets: {} }
            : readSnapshot(eligibleTargets, engReadiness)
    ));
    const tour = useOnboardingTour({
        steps: snapshot.steps,
        run,
        onboardingDone,
        onSkip,
        onFinish,
    });
    const panelRef = React.useRef(null);
    const layerRef = React.useRef(null);
    const shieldRefs = React.useRef([]);
    const backButtonRef = React.useRef(null);
    const sectionSkipButtonRef = React.useRef(null);
    const skipButtonRef = React.useRef(null);
    const priorFocusRef = React.useRef(null);
    const tourOwnedSuppressionRef = React.useRef([]);
    const pendingOwnedMutationsRef = React.useRef([]);
    const scrollEntryRef = React.useRef({ stepId: '', target: null });
    const sessionCounterRef = React.useRef(0);
    const sessionOpenRef = React.useRef(false);
    const previewDescriptorRef = React.useRef(null);
    const previewSettledStateRef = React.useRef('');
    const previewFocusedRef = React.useRef(false);
    const cleanupLatchRef = React.useRef(false);
    const requestPreviewCloseRef = React.useRef(onRequestPreviewClose);
    requestPreviewCloseRef.current = onRequestPreviewClose;
    const [previewFallbackStepId, setPreviewFallbackStepId] = React.useState('');
    const [previewFallbackTargetIdentity, setPreviewFallbackTargetIdentity] = React.useState('');
    const [unsafeTargetIdentity, setUnsafeTargetIdentity] = React.useState('');
    const [authLocked, setAuthLocked] = React.useState(false);
    const [geometry, setGeometry] = React.useState({
        target: null,
        targetRect: null,
        previewRect: null,
        coachmarkSize: DEFAULT_COACHMARK_SIZE,
    });
    const headingId = React.useId();
    const descriptionId = `${headingId}-description`;

    React.useEffect(() => () => {
        if (!previewDescriptorRef.current) return;
        const descriptor = previewDescriptorRef.current;
        cleanupLatchRef.current = true;
        previewDescriptorRef.current = null;
        requestPreviewCloseRef.current?.(descriptor, 'unmount');
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
            onPreviewTargetChange?.(null);
            setAuthLocked(true);
        };
        window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthenticationRequired);
        return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthenticationRequired);
    }, [onPreviewTargetChange, tour.isOpen]);

    if (tour.isOpen && !sessionOpenRef.current) {
        sessionCounterRef.current += 1;
        sessionOpenRef.current = true;
    } else if (!tour.isOpen) {
        sessionOpenRef.current = false;
    }

    const measure = React.useCallback(() => {
        if (!tour.isOpen || !tour.currentStep || authLocked) return;
        const tourOwnedSuppressionRecords = tourOwnedSuppressionRef.current;
        const nextSnapshot = readSnapshot(eligibleTargets, engReadiness, tourOwnedSuppressionRecords);
        setSnapshot((current) => {
            const reconciledSnapshot = tour.currentStep?.progression === 'menu-preview'
                && tourOwnedSuppressionRecords.length
                ? { ...nextSnapshot, steps: current.steps }
                : nextSnapshot;
            return sameSnapshot(current, reconciledSnapshot) ? current : reconciledSnapshot;
        });

        const viewport = viewportSize();
        const candidate = nextSnapshot.targets[tour.currentStep.id] || null;
        const targetOptions = {
            tourOwnedSuppressionRecords,
            requireEnabled: tour.currentStep.requireEnabled === true,
        };
        const priorEntry = scrollEntryRef.current;
        const isNewEntry = priorEntry.stepId !== tour.currentStep.id || priorEntry.target !== candidate;
        if (isNewEntry) {
            scrollEntryRef.current = { stepId: tour.currentStep.id, target: candidate };
            if (candidate && !isVisibleViewportTarget(candidate, viewport, targetOptions)) {
                candidate.scrollIntoView?.({ behavior: 'instant', block: 'center', inline: 'nearest' });
            }
        }
        const target = candidate && isVisibleViewportTarget(candidate, viewportSize(), targetOptions)
            ? candidate
            : null;
        const rect = target?.getBoundingClientRect?.() || null;
        const previewMenu = previewDescriptorRef.current
            ? document.querySelector(`[data-onboarding-preview-owner="${CSS.escape(previewDescriptorRef.current.targetIdentity)}"]`)
            : null;
        const previewRect = previewMenu?.getBoundingClientRect?.() || null;
        const panelRect = panelRef.current?.getBoundingClientRect?.();
        setGeometry({
            target,
            targetRect: rect,
            previewRect,
            coachmarkSize: panelRect?.width && panelRect?.height
                ? { width: panelRect.width, height: panelRect.height }
                : DEFAULT_COACHMARK_SIZE,
        });
    }, [authLocked, eligibleTargets, engReadiness, tour.currentStep, tour.isOpen]);

    React.useLayoutEffect(() => {
        if (!tour.isOpen || authLocked) return undefined;
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
    }, [authLocked, geometry.target, measure, tour.isOpen]);

    const target = geometry.target;
    const basePresentation = tour.currentStep
        ? buildStepPresentation(tour.currentStep, target, { engReadiness })
        : { fallback: true, loading: false, title: '', body: '' };
    const previewStep = tour.currentStep?.progression === 'menu-preview';
    const targetIdentity = target?.getAttribute?.('data-onboarding-target-identity') || '';
    const exactPreviewTarget = previewStep
        && matchesExactStepTarget(target, tour.currentStep)
        && isExactMenuButtonTrigger(target, target)
        && targetIdentity !== unsafeTargetIdentity;
    const previewForcedFallback = previewFallbackStepId === tour.currentStep?.id
        && previewFallbackTargetIdentity === targetIdentity;
    const unsafeForcedFallback = Boolean(targetIdentity && unsafeTargetIdentity === targetIdentity);
    const interactive = Boolean(exactPreviewTarget
        && !authLocked
        && !basePresentation.loading
        && !basePresentation.fallback
        && !previewForcedFallback);
    const presentation = previewForcedFallback || unsafeForcedFallback
        ? buildStepPresentation(tour.currentStep, null, { engReadiness })
        : basePresentation;
    const matchedPreviewSession = descriptorsMatch(previewDescriptorRef.current, previewSession)
        ? previewSession
        : null;
    const previewState = matchedPreviewSession?.state || 'closed';
    const previewOpen = PREVIEW_STATES.has(previewState);

    React.useEffect(() => {
        if (!tour.isOpen || authLocked) return undefined;
        const preferredReturnFocus = returnFocusRef?.current;
        priorFocusRef.current = preferredReturnFocus?.isConnected
            ? preferredReturnFocus
            : document.activeElement;
        return () => {
            const priorFocus = priorFocusRef.current;
            if (priorFocus?.isConnected && typeof priorFocus.focus === 'function') priorFocus.focus();
        };
    }, [authLocked, returnFocusRef, tour.isOpen]);

    React.useLayoutEffect(() => {
        if (!tour.isOpen || !tour.currentStep || authLocked) return undefined;
        const appRoot = document.getElementById('root');
        if (!appRoot) return undefined;

        const records = [];
        const suppress = (node) => {
            if (!node.hasAttribute('inert')) {
                queueTourOwnedSuppressionMutation(pendingOwnedMutationsRef.current, node, 'inert');
            }
            if (node.getAttribute('aria-hidden') !== 'true') {
                queueTourOwnedSuppressionMutation(pendingOwnedMutationsRef.current, node, 'aria-hidden');
            }
            records.push(suppressForInteraction(node));
        };
        let describedBySnapshot = null;
        let targetAncestorScrollRecords = [];
        let htmlOverflowRecord = null;
        let bodyOverflowRecord = null;
        if (interactive) {
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
        } else {
            suppress(appRoot);
        }
        tourOwnedSuppressionRef.current = records;

        return () => {
            records.slice().reverse().forEach((record) => {
                const { node, snapshot } = record;
                if (node.hasAttribute('inert') !== snapshot.inertAttribute.present
                    || node.getAttribute('inert') !== snapshot.inertAttribute.value) {
                    queueTourOwnedSuppressionMutation(pendingOwnedMutationsRef.current, node, 'inert');
                }
                if (node.hasAttribute('aria-hidden') !== snapshot.ariaHidden.present
                    || node.getAttribute('aria-hidden') !== snapshot.ariaHidden.value) {
                    queueTourOwnedSuppressionMutation(pendingOwnedMutationsRef.current, node, 'aria-hidden');
                }
                restoreInteractionSuppression(record);
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
        interactive,
        interactive ? previewState : '',
        interactive ? target : null,
        interactive ? tour.currentStep : null,
        tour.isOpen,
    ]);

    React.useEffect(() => {
        if (!interactive || !target || !tour.currentStep) {
            if (previewDescriptorRef.current) {
                cleanupLatchRef.current = true;
                onRequestPreviewClose?.(previewDescriptorRef.current, 'target_loss');
                previewDescriptorRef.current = null;
                onPreviewTargetChange?.(null);
            }
            return undefined;
        }
        const descriptor = buildPreviewDescriptor(sessionCounterRef.current, tour.currentStep, target);
        if (!descriptor) return undefined;
        if (!descriptorsMatch(previewDescriptorRef.current, descriptor)) {
            if (previewDescriptorRef.current) {
                cleanupLatchRef.current = true;
                onRequestPreviewClose?.(previewDescriptorRef.current, 'target_loss');
            }
            previewSettledStateRef.current = '';
            previewFocusedRef.current = false;
            cleanupLatchRef.current = false;
            previewDescriptorRef.current = descriptor;
            onPreviewTargetChange?.(descriptor);
        }
        return undefined;
    }, [interactive, onPreviewTargetChange, onRequestPreviewClose, target, tour.currentStep]);

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
        const reason = matchedPreviewSession.reason || '';
        if (cleanupLatchRef.current || !PROGRESS_CLOSE_REASONS.has(reason)) {
            cleanupLatchRef.current = false;
            previewSettledStateRef.current = '';
            previewFocusedRef.current = false;
            return;
        }
        if (previewSettledStateRef.current === 'error') {
            const closedTargetIdentity = previewDescriptorRef.current.targetIdentity;
            previewDescriptorRef.current = null;
            onPreviewTargetChange?.(null);
            setPreviewFallbackStepId(tour.currentStepId);
            setPreviewFallbackTargetIdentity(closedTargetIdentity);
        } else if ((previewSettledStateRef.current === 'ready' || previewSettledStateRef.current === 'empty')
            && previewFocusedRef.current) {
            previewDescriptorRef.current = null;
            onPreviewTargetChange?.(null);
            target?.focus?.();
            tour.advanceFromStep(tour.currentStepId);
        }
        previewSettledStateRef.current = '';
        previewFocusedRef.current = false;
    }, [matchedPreviewSession, measure, onPreviewTargetChange, previewState, target, tour]);

    React.useEffect(() => {
        setPreviewFallbackStepId('');
        setPreviewFallbackTargetIdentity('');
        setUnsafeTargetIdentity('');
    }, [tour.currentStepId]);

    React.useEffect(() => {
        if (!tour.isOpen || !tour.currentStep || authLocked) return undefined;
        if (interactive) target?.focus?.();
        else panelRef.current?.focus();
        return undefined;
    }, [authLocked, interactive, target, tour.currentStep, tour.isOpen]);

    React.useLayoutEffect(() => {
        if (!interactive || !target) return;
        const frame = window.requestAnimationFrame(() => {
            if (!exactTargetHitTest(target)) setUnsafeTargetIdentity(targetIdentity);
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
        const outsideViewport = expandedRect.left < 0 || expandedRect.top < 0
            || expandedRect.right > viewportSize().width || expandedRect.bottom > viewportSize().height;
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
        if (!tour.isOpen || !interactive) return undefined;
        const getIsland = () => {
            const menu = previewOpen && previewDescriptorRef.current
                ? document.querySelector(`[data-onboarding-preview-owner="${CSS.escape(previewDescriptorRef.current.targetIdentity)}"]`)
                : null;
            const controls = [backButtonRef.current, sectionSkipButtonRef.current, skipButtonRef.current]
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
            if (event.key === 'Escape' && !previewOpen && !actionPending) {
                event.preventDefault();
                tour.skip();
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
    }, [actionPending, interactive, previewOpen, target, tour]);

    React.useEffect(() => {
        if (tour.isOpen) return;
        scrollEntryRef.current = { stepId: '', target: null };
        tourOwnedSuppressionRef.current = [];
        pendingOwnedMutationsRef.current = [];
        previewDescriptorRef.current = null;
        previewSettledStateRef.current = '';
        previewFocusedRef.current = false;
        cleanupLatchRef.current = false;
        onPreviewTargetChange?.(null);
    }, [onPreviewTargetChange, tour.isOpen]);

    if (!tour.isOpen || !tour.currentStep || authLocked || typeof document === 'undefined') return null;

    const progress = buildTourProgress(snapshot.steps, tour.index);
    const placement = computeCoachmarkPlacement({
        targetRect: rectUnion(geometry.targetRect, geometry.previewRect),
        coachmarkSize: geometry.coachmarkSize,
        viewport: viewportSize(),
    });
    const spotlightStyle = geometry.targetRect ? {
        left: Math.max(0, geometry.targetRect.left - SPOTLIGHT_PADDING),
        top: Math.max(0, geometry.targetRect.top - SPOTLIGHT_PADDING),
        width: geometry.targetRect.width + SPOTLIGHT_PADDING * 2,
        height: geometry.targetRect.height + SPOTLIGHT_PADDING * 2,
    } : null;
    const viewport = viewportSize();
    const exactRect = geometry.targetRect;
    const shieldStyles = exactRect ? [
        { left: 0, top: 0, width: viewport.width, height: Math.max(0, exactRect.top) },
        { left: 0, top: exactRect.top, width: Math.max(0, exactRect.left), height: exactRect.height },
        { left: exactRect.right, top: exactRect.top, width: Math.max(0, viewport.width - exactRect.right), height: exactRect.height },
        { left: 0, top: exactRect.bottom, width: viewport.width, height: Math.max(0, viewport.height - exactRect.bottom) },
    ] : [];
    const interactiveState = previewOpen ? `preview_${previewState}` : 'interactive_closed';
    const sectionSkipTargetId = resolveSectionSkipTargetId(snapshot.steps, tour.currentStepId);

    const requestCleanup = (reason = 'cleanup') => {
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
                <div className="onboarding-tour-progress" aria-live="polite">{progress.label}</div>
                <h2 id={headingId}>{presentation.title}</h2>
                <p id={descriptionId}>{interactive
                    ? 'Activate the highlighted control to preview its choices; no value change is required. Close the preview or press Escape to continue.'
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
                        {tour.isLast ? (
                            <button type="button" className="primary" onClick={tour.finish} disabled={actionPending}>Finish</button>
                        ) : !interactive && (
                            <button type="button" className="primary" onClick={tour.goNext} disabled={!tour.canGoNext || actionPending || presentation.loading}>Next</button>
                        )}
                    </div>
                </div>
            </section>
        </div>,
        document.body
    );
}
