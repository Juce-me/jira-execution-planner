import * as React from 'react';

export const FIRST_RUN_CONFIGURATION_GUIDE_STEPS = ['name', 'teams', 'components', 'favorite', 'visibility'];

export const FIRST_RUN_ADMIN_SECTION_KEYS = [
    'projects',
    'priorityWeights',
    'board',
    'capacity',
    'sprintField',
    'parentNameField',
    'storyPointsField',
    'teamField',
    'deliveryOwnerField',
    'issueTypes',
    'adminAccess',
];

const normalizeCommittedSections = (sections = {}) => ({
    admin: Boolean(sections.admin),
    groups: Boolean(sections.groups),
    epm: Boolean(sections.epm),
    preference: Boolean(sections.preference),
});

export const normalizeFirstRunAdminSections = (sections = {}) => Object.fromEntries(
    FIRST_RUN_ADMIN_SECTION_KEYS.map(key => [key, Boolean(sections?.[key])])
);

export const buildFirstRunSettingsSaveOutcome = (overrides = {}) => ({
    ok: Boolean(overrides.ok),
    authRequired: Boolean(overrides.authRequired),
    inFlight: Boolean(overrides.inFlight),
    conflict: Boolean(overrides.conflict),
    normalizedGroups: overrides.normalizedGroups || null,
    committedSections: normalizeCommittedSections(overrides.committedSections),
    pendingSections: normalizeCommittedSections(overrides.pendingSections),
    committedAdminSections: normalizeFirstRunAdminSections(overrides.committedAdminSections),
    pendingAdminSections: normalizeFirstRunAdminSections(overrides.pendingAdminSections),
    error: overrides.error || '',
});

const UNORDERED_SHARED_ARRAY_KEYS = new Set([
    'teamIds', 'teamLabels', 'missingInfoComponents', 'excludedCapacityEpics',
    'adHocCapacityEpics', 'statuses', 'labels',
]);

const canonicalSharedValue = (value, key = '') => {
    if (Array.isArray(value)) {
        const normalized = value.map(item => canonicalSharedValue(item));
        if (key === 'groups') return normalized.sort((left, right) => String(left?.id || '').localeCompare(String(right?.id || '')));
        if (UNORDERED_SHARED_ARRAY_KEYS.has(key)) return normalized.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
        return normalized;
    }
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(childKey => [childKey, canonicalSharedValue(value[childKey], childKey)]));
};

export const verifyFirstRunGroupsSaveSnapshot = (submitted, response, pendingGroupId) => {
    if (!submitted || !response || !Array.isArray(submitted.groups) || !Array.isArray(response.groups)) {
        return { ok: false, error: 'The saved Department response was malformed. Retry saving.' };
    }
    if (!response.groups.some(group => String(group?.id || '') === String(pendingGroupId || ''))) {
        return { ok: false, error: 'The saved Department response did not include the Department being configured. Retry saving.' };
    }
    const baseRevision = submitted.baseRevision;
    const committedRevision = response.configRevision;
    if (
        response.source !== 'workspace_db'
        || !Number.isSafeInteger(baseRevision)
        || !Number.isSafeInteger(committedRevision)
        || committedRevision <= baseRevision
    ) {
        return { ok: false, error: 'The saved Department response did not identify a valid committed workspace revision. Retry saving.' };
    }
    const submittedShared = canonicalSharedValue({
        version: submitted.version || 1,
        groups: submitted.groups,
        defaultGroupId: submitted.defaultGroupId || '',
    });
    const responseShared = canonicalSharedValue({
        version: response.version || 1,
        groups: response.groups,
        defaultGroupId: response.defaultGroupId || '',
    });
    if (JSON.stringify(submittedShared) !== JSON.stringify(responseShared)) {
        return { ok: false, error: 'The saved Department response did not match the submitted shared settings. Retry saving.' };
    }
    return { ok: true, error: '' };
};

export const createFirstRunConfigurationSession = (overrides = {}) => ({
    status: 'idle',
    mode: null,
    pendingGroupId: null,
    guideStep: 'name',
    guideComplete: false,
    capturedDrafts: null,
    latestNormalizedGroups: null,
    error: '',
    recoveryAction: null,
    ...overrides,
    committedSections: normalizeCommittedSections(overrides.committedSections),
    committedAdminSections: normalizeFirstRunAdminSections(overrides.committedAdminSections),
    pendingAdminSections: normalizeFirstRunAdminSections(overrides.pendingAdminSections),
});

const mergeCommittedSections = (current, next) => normalizeCommittedSections({
    ...current,
    ...Object.fromEntries(Object.entries(next || {}).filter(([, value]) => value)),
});

export const mergeFirstRunAdminSections = (current, next) => Object.fromEntries(
    FIRST_RUN_ADMIN_SECTION_KEYS.map(key => [key, Boolean(current?.[key] || next?.[key])])
);

const hasCommittedSection = (sections) => Object.values(normalizeCommittedSections(sections)).some(Boolean);

export function firstRunConfigurationSessionReducer(state, action) {
    const current = state || createFirstRunConfigurationSession();
    switch (action?.type) {
        case 'start':
            return createFirstRunConfigurationSession({
                status: 'editing',
                mode: action.mode,
                pendingGroupId: action.pendingGroupId,
                capturedDrafts: structuredClone(action.drafts || null),
            });
        case 'set_guide_step':
            return { ...current, guideStep: action.step };
        case 'complete_guide':
            return { ...current, guideStep: 'visibility', guideComplete: true };
        case 'save_sections_started':
        case 'retry_sections':
            return { ...current, status: 'saving_sections', error: '', recoveryAction: null };
        case 'sections_progress':
            return {
                ...current,
                committedSections: mergeCommittedSections(current.committedSections, action.committedSections),
                committedAdminSections: mergeFirstRunAdminSections(current.committedAdminSections, action.committedAdminSections),
                pendingAdminSections: normalizeFirstRunAdminSections(action.pendingAdminSections),
                latestNormalizedGroups: action.normalizedGroups || current.latestNormalizedGroups,
            };
        case 'validation_failed':
            return {
                ...current,
                status: 'editing',
                guideStep: action.step || 'name',
                guideComplete: false,
                error: action.error || '',
                recoveryAction: null,
            };
        case 'save_sections_failed': {
            const committedSections = mergeCommittedSections(current.committedSections, action.committedSections);
            const partial = hasCommittedSection(committedSections);
            return {
                ...current,
                status: partial ? 'sections_pending' : 'editing',
                committedSections,
                committedAdminSections: mergeFirstRunAdminSections(current.committedAdminSections, action.committedAdminSections),
                pendingAdminSections: normalizeFirstRunAdminSections(action.pendingAdminSections),
                latestNormalizedGroups: action.normalizedGroups || current.latestNormalizedGroups,
                error: action.error || '',
                recoveryAction: partial ? 'retry_sections' : null,
            };
        }
        case 'sections_saved':
            return {
                ...current,
                status: 'preference_pending',
                committedSections: mergeCommittedSections(current.committedSections, action.committedSections),
                committedAdminSections: mergeFirstRunAdminSections(current.committedAdminSections, action.committedAdminSections),
                pendingAdminSections: normalizeFirstRunAdminSections(),
                latestNormalizedGroups: action.normalizedGroups || current.latestNormalizedGroups,
                error: '',
                recoveryAction: 'retry_preference',
            };
        case 'preference_save_failed':
            return { ...current, status: 'preference_pending', error: action.error || '', recoveryAction: 'retry_preference' };
        case 'preference_saved':
            return {
                ...current,
                status: 'complete',
                error: '',
                recoveryAction: null,
                committedSections: mergeCommittedSections(current.committedSections, { preference: true }),
            };
        case 'rebase':
            return { ...current, latestNormalizedGroups: action.normalizedGroups || current.latestNormalizedGroups };
        case 'return_after_sections':
        case 'return_after_preference':
            return createFirstRunConfigurationSession();
        case 'cancel':
            return hasCommittedSection(current.committedSections) ? current : createFirstRunConfigurationSession();
        default:
            return current;
    }
}

export const canAdvanceFirstRunConfigurationGuide = (step, group, groups = []) => {
    if (step === 'name') {
        const name = String(group?.name || '').trim();
        if (!name) return false;
        return !(groups || []).some(candidate => candidate?.id !== group?.id
            && String(candidate?.name || '').trim().toLowerCase() === name.toLowerCase());
    }
    if (step === 'teams') {
        return (group?.teamIds || []).some(teamId => String(teamId || '').trim());
    }
    return FIRST_RUN_CONFIGURATION_GUIDE_STEPS.includes(step);
};

export const validateFirstRunPendingGroup = (groups = [], pendingGroupId = null) => {
    const pendingId = String(pendingGroupId || '').trim();
    const group = (groups || []).find(candidate => candidate?.id === pendingId);
    if (!group) return { ok: false, step: 'name', error: 'The Department being configured is no longer available. Return and choose again.' };
    const name = String(group.name || '').trim();
    if (!name) return { ok: false, step: 'name', error: 'Department name is required.' };
    const duplicate = (groups || []).some(candidate => candidate?.id !== pendingId
        && String(candidate?.name || '').trim().toLowerCase() === name.toLowerCase());
    if (duplicate) return { ok: false, step: 'name', error: 'Department names must be unique.' };
    const hasTeam = (group.teamIds || []).some(teamId => String(teamId || '').trim());
    if (!hasTeam) return { ok: false, step: 'teams', error: 'Add at least one team before saving.' };
    return { ok: true, step: null, error: '' };
};

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
    const [targetMissing, setTargetMissing] = React.useState(false);
    const stepIndex = FIRST_RUN_CONFIGURATION_GUIDE_STEPS.indexOf(step);
    const isLast = stepIndex === FIRST_RUN_CONFIGURATION_GUIDE_STEPS.length - 1;
    const canContinue = canAdvanceFirstRunConfigurationGuide(step, group, groups);
    const descriptionId = `first-run-configuration-guide-${step}`;

    React.useLayoutEffect(() => {
        const target = document.querySelector(targetSelector(step));
        setTargetMissing(!target);
        if (!target) return undefined;
        const priorDescription = target.getAttribute('aria-describedby');
        const describedBy = [priorDescription, descriptionId].filter(Boolean).join(' ');
        target.setAttribute('aria-describedby', describedBy);
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (typeof target.focus === 'function') target.focus({ preventScroll: true });
        const focusableSelector = 'button, input, select, textarea, a[href], [tabindex]';
        const suppressed = new Map();
        const isOwned = (node) => (
            node === target
            || target.contains(node)
            || Boolean(node.closest('.auth-required-dialog'))
            || Boolean(node.closest(`[data-first-run-guide-allow="${step}"]`))
            || Boolean(node.closest('[data-first-run-settings-cancel]'))
            || Boolean(coachmarkRef.current?.contains(node))
        );
        const suppress = (node) => {
            if (!(node instanceof HTMLElement) || isOwned(node) || suppressed.has(node)) return;
            suppressed.set(node, {
                tabIndex: node.getAttribute('tabindex'),
                ariaHidden: node.getAttribute('aria-hidden'),
                inert: node.inert,
            });
            node.inert = true;
            node.setAttribute('tabindex', '-1');
            node.setAttribute('aria-hidden', 'true');
        };
        document.querySelectorAll(focusableSelector).forEach(suppress);

        const ownedCandidates = () => ([...new Set([
                target,
                ...document.querySelectorAll(`[data-first-run-guide-allow="${step}"]`),
                ...document.querySelectorAll(`[data-first-run-guide-allow="${step}"] ${focusableSelector}`),
                ...(coachmarkRef.current?.querySelectorAll(focusableSelector) || []),
                ...document.querySelectorAll('[data-first-run-settings-cancel]'),
            ])].filter(node => node instanceof HTMLElement && !node.disabled && !node.inert));
        const focusOwnedTarget = () => {
            const candidates = ownedCandidates();
            (candidates[0] || target).focus({ preventScroll: true });
            return candidates;
        };
        const handleFocusIn = (event) => {
            if (!isOwned(event.target)) focusOwnedTarget();
        };
        const handleKeyDown = (event) => {
            if (event.key !== 'Tab') return;
            if (event.target?.closest?.('.auth-required-dialog')) return;
            const candidates = ownedCandidates();
            if (!candidates.length) return;
            const currentIndex = candidates.indexOf(document.activeElement);
            const nextIndex = event.shiftKey
                ? (currentIndex <= 0 ? candidates.length - 1 : currentIndex - 1)
                : (currentIndex < 0 || currentIndex === candidates.length - 1 ? 0 : currentIndex + 1);
            event.preventDefault();
            candidates[nextIndex].focus({ preventScroll: true });
        };
        const observer = new MutationObserver((records) => {
            if (!target.isConnected) setTargetMissing(true);
            records.forEach(record => record.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;
                if (node.matches(focusableSelector)) suppress(node);
                node.querySelectorAll?.(focusableSelector).forEach(suppress);
            }));
        });
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener('focusin', handleFocusIn, true);
        document.addEventListener('keydown', handleKeyDown, true);

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
        document.addEventListener('scroll', updatePlacement, true);
        const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePlacement);
        resizeObserver?.observe(target);
        resizeObserver?.observe(coachmarkRef.current);
        return () => {
            observer.disconnect();
            document.removeEventListener('focusin', handleFocusIn, true);
            document.removeEventListener('keydown', handleKeyDown, true);
            viewport?.removeEventListener('resize', updatePlacement);
            viewport?.removeEventListener('scroll', updatePlacement);
            window.removeEventListener('resize', updatePlacement);
            document.removeEventListener('scroll', updatePlacement, true);
            resizeObserver?.disconnect();
            suppressed.forEach(({ tabIndex, ariaHidden, inert }, node) => {
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
    const recoveryVisible = targetMissing || status === 'sections_pending' || (status === 'preference_pending' && error);
    const visibleError = targetMissing
        ? 'The configuration target is no longer available. Return and choose the Department again.'
        : error;

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
            {visibleError && <div className="first-run-configuration-error" role="alert">{visibleError}</div>}
            {recoveryVisible ? (
                <div className="first-run-configuration-actions">
                    <button type="button" className="secondary compact" onClick={onReturn}>Return</button>
                    {!targetMissing && (
                        <button type="button" className="compact" onClick={onRetry}>
                            {status === 'preference_pending' ? 'Retry favorite save' : 'Retry unsaved settings'}
                        </button>
                    )}
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
