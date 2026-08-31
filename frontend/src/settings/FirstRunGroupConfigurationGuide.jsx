import * as React from 'react';
import {
    FIRST_RUN_CONFIGURATION_GUIDE_STEPS,
    canAdvanceFirstRunConfigurationGuide,
} from './firstRunGroupConfiguration.js';

const COPY = {
    name: {
        title: 'Name your Department',
        body: 'Use a short, unique name. This name appears everywhere the Department is selected.',
    },
    teams: {
        title: 'Choose at least one team',
        body: 'Teams define which Jira work appears for this Department. Add one or more teams to continue.',
    },
    components: {
        title: 'Choose Jira Components (optional)',
        body: 'Component is a Jira issue field, usually set on an Epic. Configured Components broaden Missing Information and Lead Times.',
    },
    favorite: {
        title: 'Set your favorite Department',
        body: 'This Department will be selected first for you. Favorites are personal and do not change the shared Department.',
    },
    visibility: {
        title: 'Show it in the Department selector',
        body: 'Your favorite Department is always shown in your Department selector. Finish to save the configuration.',
    },
};

const targetSelector = (step) => `[data-first-run-guide-target="${step}"]`;

export default function FirstRunGroupConfigurationGuide({
    step,
    group,
    groups,
    onBack,
    onContinue,
    onCancel,
    onRetry,
    onReturn,
    status = 'editing',
    busy = false,
    error = '',
}) {
    const coachmarkRef = React.useRef(null);
    const [placement, setPlacement] = React.useState({ top: 12, left: 12 });
    const stepIndex = FIRST_RUN_CONFIGURATION_GUIDE_STEPS.indexOf(step);
    const isLast = stepIndex === FIRST_RUN_CONFIGURATION_GUIDE_STEPS.length - 1;
    const canContinue = canAdvanceFirstRunConfigurationGuide(step, group, groups);
    const descriptionId = `first-run-configuration-guide-${step}`;

    React.useLayoutEffect(() => {
        const target = document.querySelector(targetSelector(step));
        if (!target) return undefined;
        const priorDescription = target.getAttribute('aria-describedby');
        const describedBy = [priorDescription, descriptionId].filter(Boolean).join(' ');
        target.setAttribute('aria-describedby', describedBy);
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (typeof target.focus === 'function') target.focus({ preventScroll: true });
        const modal = target.closest('.group-modal-backdrop');
        const focusable = modal ? [...modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')] : [];
        const suppressed = focusable.filter(node => (
            node !== target
            && !target.contains(node)
            && !node.closest(`[data-first-run-guide-allow="${step}"]`)
            && !coachmarkRef.current?.contains(node)
            && !node.hasAttribute('data-first-run-settings-cancel')
        )).map(node => ({
            node,
            tabIndex: node.getAttribute('tabindex'),
            ariaHidden: node.getAttribute('aria-hidden'),
            inert: node.inert,
        }));
        suppressed.forEach(({ node }) => {
            node.inert = true;
            node.setAttribute('tabindex', '-1');
            node.setAttribute('aria-hidden', 'true');
        });

        const updatePlacement = () => {
            if (!target.isConnected || !coachmarkRef.current) return;
            const viewport = window.visualViewport;
            const viewportLeft = viewport?.offsetLeft || 0;
            const viewportTop = viewport?.offsetTop || 0;
            const viewportWidth = viewport?.width || window.innerWidth;
            const viewportHeight = viewport?.height || window.innerHeight;
            const targetRect = target.getBoundingClientRect();
            const coachmarkRect = coachmarkRef.current.getBoundingClientRect();
            const gap = 10;
            const left = Math.max(viewportLeft + 8, Math.min(
                targetRect.left,
                viewportLeft + viewportWidth - coachmarkRect.width - 8
            ));
            const below = targetRect.bottom + gap;
            const top = below + coachmarkRect.height <= viewportTop + viewportHeight - 8
                ? below
                : Math.max(viewportTop + 8, targetRect.top - coachmarkRect.height - gap);
            setPlacement({ top, left });
        };
        updatePlacement();
        const viewport = window.visualViewport;
        viewport?.addEventListener('resize', updatePlacement);
        viewport?.addEventListener('scroll', updatePlacement);
        window.addEventListener('resize', updatePlacement);
        return () => {
            viewport?.removeEventListener('resize', updatePlacement);
            viewport?.removeEventListener('scroll', updatePlacement);
            window.removeEventListener('resize', updatePlacement);
            suppressed.forEach(({ node, tabIndex, ariaHidden, inert }) => {
                node.inert = inert;
                if (tabIndex === null) node.removeAttribute('tabindex');
                else node.setAttribute('tabindex', tabIndex);
                if (ariaHidden === null) node.removeAttribute('aria-hidden');
                else node.setAttribute('aria-hidden', ariaHidden);
            });
            if (!target.isConnected) return;
            if (priorDescription) target.setAttribute('aria-describedby', priorDescription);
            else target.removeAttribute('aria-describedby');
        };
    }, [descriptionId, step]);

    const copy = COPY[step] || COPY.name;
    const continueLabel = step === 'components' && !(group?.missingInfoComponents || []).length
        ? 'Continue without components'
        : (isLast ? 'Done' : 'Continue');

    return (
        <aside
            ref={coachmarkRef}
            className="first-run-configuration-guide"
            role="status"
            aria-live="polite"
            style={{ top: placement.top, left: placement.left }}
        >
            <div className="first-run-configuration-progress">Step {stepIndex + 1} of {FIRST_RUN_CONFIGURATION_GUIDE_STEPS.length}</div>
            <div className="first-run-configuration-title">{copy.title}</div>
            <div id={descriptionId} className="first-run-configuration-body">{copy.body}</div>
            {error && <div className="first-run-configuration-error" role="alert">{error}</div>}
            {status === 'sections_pending' || (status === 'preference_pending' && error) ? (
                <div className="first-run-configuration-actions">
                    <button type="button" className="secondary compact" onClick={onReturn}>Return</button>
                    <button type="button" className="compact" onClick={onRetry}>
                        {status === 'preference_pending' ? 'Retry favorite save' : 'Retry unsaved settings'}
                    </button>
                </div>
            ) : (
                <div className="first-run-configuration-actions">
                    <button type="button" className="secondary compact" onClick={onCancel} disabled={busy}>Cancel</button>
                    {stepIndex > 0 && <button type="button" className="secondary compact" onClick={onBack} disabled={busy}>Back</button>}
                    <button type="button" className="compact" onClick={onContinue} disabled={busy || !canContinue}>{continueLabel}</button>
                </div>
            )}
        </aside>
    );
}
