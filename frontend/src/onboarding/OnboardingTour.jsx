import * as React from 'react';
import { createPortal } from 'react-dom';
import {
    ONBOARDING_STEP_CATALOG,
    buildStepPresentation,
    buildTourProgress,
    buildVisibleOnboardingSteps,
    computeCoachmarkPlacement,
    resolveOnboardingSnapshot,
    resolveVisibleTarget,
} from './onboardingSteps.js';
import useOnboardingTour from './useOnboardingTour.js';

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

function readSnapshot(eligibleTargets) {
    const appRoot = document.getElementById('root');
    const raw = resolveOnboardingSnapshot(document, viewportSize(), {
        ignoredAncestors: appRoot ? [appRoot] : [],
    });
    if (!eligibleTargets) return raw;
    const availability = {};
    ONBOARDING_STEP_CATALOG.forEach((step) => {
        const explicitlyEligible = eligibleTargets[step.id] !== false;
        availability[step.id] = explicitlyEligible && Boolean(raw.targets[step.id]);
    });
    return {
        steps: buildVisibleOnboardingSteps(availability),
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
    recoveryLoginUrl = '',
} = {}) {
    const [snapshot, setSnapshot] = React.useState(() => (
        typeof document === 'undefined'
            ? { steps: buildVisibleOnboardingSteps(), targets: {} }
            : readSnapshot(eligibleTargets)
    ));
    const tour = useOnboardingTour({
        steps: snapshot.steps,
        run,
        onboardingDone,
        onSkip,
        onFinish,
    });
    const panelRef = React.useRef(null);
    const priorFocusRef = React.useRef(null);
    const [geometry, setGeometry] = React.useState({ target: null, targetRect: null, coachmarkSize: DEFAULT_COACHMARK_SIZE });
    const headingId = React.useId();

    const measure = React.useCallback(() => {
        if (!tour.isOpen || !tour.currentStep) return;
        const nextSnapshot = readSnapshot(eligibleTargets);
        setSnapshot((current) => (sameSnapshot(current, nextSnapshot) ? current : nextSnapshot));

        const viewport = viewportSize();
        const appRoot = document.getElementById('root');
        const target = resolveVisibleTarget(tour.currentStep.selectors, document, viewport, {
            ignoredAncestors: appRoot ? [appRoot] : [],
            requireEnabled: tour.currentStep.requireEnabled === true,
        });
        const rect = target?.getBoundingClientRect?.() || null;
        const panelRect = panelRef.current?.getBoundingClientRect?.();
        setGeometry({
            target,
            targetRect: rect,
            coachmarkSize: panelRect?.width && panelRect?.height
                ? { width: panelRect.width, height: panelRect.height }
                : DEFAULT_COACHMARK_SIZE,
        });
    }, [eligibleTargets, tour.currentStep, tour.isOpen]);

    React.useLayoutEffect(() => {
        if (!tour.isOpen) return undefined;
        measure();
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);

        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(measure)
            : null;
        if (geometry.target) resizeObserver?.observe(geometry.target);
        if (panelRef.current) resizeObserver?.observe(panelRef.current);

        const mutationRoot = document.getElementById('root') || document.body;
        const mutationObserver = typeof MutationObserver !== 'undefined'
            ? new MutationObserver(measure)
            : null;
        mutationObserver?.observe(mutationRoot, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-hidden', 'aria-disabled'],
        });

        return () => {
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
        };
    }, [geometry.target, measure, tour.isOpen]);

    React.useEffect(() => {
        if (!tour.isOpen) return undefined;
        const appRoot = document.getElementById('root');
        priorFocusRef.current = document.activeElement;

        let priorAriaHidden = null;
        let hadAriaHidden = false;
        let priorInertAttribute = null;
        let priorInertProperty = false;
        if (appRoot) {
            hadAriaHidden = appRoot.hasAttribute('aria-hidden');
            priorAriaHidden = appRoot.getAttribute('aria-hidden');
            priorInertAttribute = appRoot.getAttribute('inert');
            priorInertProperty = Boolean(appRoot.inert);
            appRoot.setAttribute('aria-hidden', 'true');
            appRoot.setAttribute('inert', '');
            if ('inert' in appRoot) appRoot.inert = true;
        }

        panelRef.current?.focus();
        return () => {
            if (appRoot) {
                if (hadAriaHidden) appRoot.setAttribute('aria-hidden', priorAriaHidden);
                else appRoot.removeAttribute('aria-hidden');
                if ('inert' in appRoot) appRoot.inert = priorInertProperty;
                if (priorInertAttribute === null) appRoot.removeAttribute('inert');
                else appRoot.setAttribute('inert', priorInertAttribute);
            }
            const priorFocus = priorFocusRef.current;
            if (priorFocus?.isConnected && typeof priorFocus.focus === 'function') priorFocus.focus();
        };
    }, [tour.isOpen]);

    if (!tour.isOpen || !tour.currentStep || typeof document === 'undefined') return null;

    const target = geometry.target;
    const presentation = buildStepPresentation(tour.currentStep, target);
    const progress = buildTourProgress(snapshot.steps, tour.index);
    const placement = computeCoachmarkPlacement({
        targetRect: geometry.targetRect,
        coachmarkSize: geometry.coachmarkSize,
        viewport: viewportSize(),
    });
    const spotlightStyle = geometry.targetRect ? {
        left: Math.max(0, geometry.targetRect.left - SPOTLIGHT_PADDING),
        top: Math.max(0, geometry.targetRect.top - SPOTLIGHT_PADDING),
        width: geometry.targetRect.width + SPOTLIGHT_PADDING * 2,
        height: geometry.targetRect.height + SPOTLIGHT_PADDING * 2,
    } : null;

    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!actionPending) tour.skip();
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
            className={`onboarding-tour-layer${presentation.fallback || placement.mode === 'fallback' ? ' is-fallback' : ''}`}
            data-onboarding-tour
        >
            {spotlightStyle && placement.mode === 'target' && (
                <div className="onboarding-tour-spotlight" style={spotlightStyle} aria-hidden="true" />
            )}
            <section
                ref={panelRef}
                className={`onboarding-tour-card${presentation.fallback || placement.mode === 'fallback' ? ' is-fallback' : ''}`}
                style={{ left: placement.left, top: placement.top }}
                role="dialog"
                aria-modal="true"
                aria-labelledby={headingId}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
            >
                <div className="onboarding-tour-progress" aria-live="polite">{progress.label}</div>
                <h2 id={headingId}>{presentation.title}</h2>
                <p>{presentation.body}</p>
                {actionError && (
                    <div className="onboarding-tour-error" role="alert">
                        <span>{actionError}</span>
                        {recoveryLoginUrl && <a href={recoveryLoginUrl}>Sign in again</a>}
                    </div>
                )}
                <div className="onboarding-tour-actions">
                    <button type="button" className="secondary" onClick={tour.skip} disabled={actionPending}>
                        Skip onboarding
                    </button>
                    <div className="onboarding-tour-navigation">
                        <button type="button" className="secondary" onClick={tour.goBack} disabled={!tour.canGoBack || actionPending}>
                            Back
                        </button>
                        {tour.isLast ? (
                            <button type="button" className="primary" onClick={tour.finish} disabled={actionPending}>Finish</button>
                        ) : (
                            <button type="button" className="primary" onClick={tour.goNext} disabled={!tour.canGoNext || actionPending}>Next</button>
                        )}
                    </div>
                </div>
            </section>
        </div>,
        document.body
    );
}
