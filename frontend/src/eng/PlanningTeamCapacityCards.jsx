import * as React from 'react';
import { buildJiraBrowseLinkAnalytics } from '../analytics/externalLinks.js';
import TrackedExternalLink from '../components/TrackedExternalLink.jsx';
import IconButton from '../ui/IconButton.jsx';
import JiraMarkIcon from '../ui/JiraMarkIcon.jsx';
import EpicHeaderValueReadout from './EpicHeaderValueReadout.jsx';
import { capacityAxis, parseCapacityDraft, TEAM_CARD_HEADROOM } from './planningCapacityUtils.js';
import { usePlanningAssigneeCapacityView } from './PlanningAssigneeCapacity.jsx';
import { formatHundredths, plannedWireValue, roundHalfUpHundredths, samePlannedValue, validateNumberDraft } from './planningAssigneeCapacityModel.js';

const formatSp = value => formatHundredths(roundHalfUpHundredths(value) ?? 0);

const CAPACITY_ERROR_MESSAGES = {
    invalid_capacity: 'Enter a valid capacity of 0 or more.',
    capacity_target_changed: 'This card now maps to a different Jira capacity ticket. Cancel and reopen the editor.',
    capacity_read_failed: 'Capacity could not be refreshed. Retry before editing.',
    capacity_forbidden: 'Jira did not allow this capacity change.',
    capacity_issue_not_found: 'This capacity ticket is no longer available. Refresh Planning.',
    capacity_config_missing: 'Capacity editing is no longer configured. Refresh Planning.',
    capacity_config_unverified: 'Capacity editing needs an Admin to verify the Jira Capacity field. Refresh after it is saved.',
    capacity_config_conflict: 'Capacity configuration needs Admin resolution. Refresh after it is resolved.',
    capacity_issue_mismatch: 'This card no longer matches its Jira capacity ticket. Refresh Planning.',
    capacity_field_not_editable: 'The configured Capacity field cannot be edited on this Jira issue.',
    config_storage_unavailable: 'Capacity configuration is temporarily unavailable. Try again.',
    jira_oauth_required: 'Sign in with Atlassian to edit capacity.',
    jira_capacity_update_conflict: 'Jira could not apply the capacity change yet. Review and try again.',
    jira_capacity_update_failed: 'Capacity could not be updated in Jira. Try again.',
    auth_required: 'Your Jira sign-in expired. Sign in again to edit capacity.',
    missing_oauth_scope: 'Your Jira sign-in needs updated permissions.',
};

const TARGET_FAILURE_CODES = new Set([
    'invalid_issue_key',
    'capacity_issue_not_found',
    'capacity_issue_mismatch',
    'capacity_field_not_editable',
]);

const CONFIG_FAILURE_CODES = new Set([
    'capacity_config_missing',
    'capacity_config_unverified',
    'capacity_config_conflict',
]);

const RELOAD_RESET_CODES = new Set([...TARGET_FAILURE_CODES, ...CONFIG_FAILURE_CODES]);

function PencilIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
            <path d="m15 5 4 4" />
        </svg>
    );
}

function CheckIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M20 6 9 17l-5-5" />
        </svg>
    );
}

// The rail icons for a mismatch (push, Task 6) and a failed save (retry), in the pencil's icon style.
function ArrowRightIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5 12h14" />
            <path d="m13 6 6 6-6 6" />
        </svg>
    );
}

function RetryIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
        </svg>
    );
}

// A rail icon with the pencil's size, frame and hover, and the portaled in-app readout (hover, focus or tap).
function RailIcon({ readout, label, onClick, children }) {
    return (
        <EpicHeaderValueReadout value={readout} alwaysOn transient pointerTransparent>
            {({ triggerRef, pointerProps, focusProps }) => (
                <IconButton ref={triggerRef} {...pointerProps} {...focusProps} variant="secondary compact" className="team-capacity-action team-capacity-edit-action" size="sm" onClick={onClick} aria-label={label}>
                    {children}
                </IconButton>
            )}
        </EpicHeaderValueReadout>
    );
}

function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </svg>
    );
}

export function buildJiraIssueUrl(jiraUrl, issueKey) {
    if (typeof jiraUrl !== 'string' || !jiraUrl.trim() || !issueKey) return '';
    try {
        const issueUrl = new URL(jiraUrl.trim());
        if (
            (issueUrl.protocol !== 'http:' && issueUrl.protocol !== 'https:')
            || issueUrl.username
            || issueUrl.password
        ) return '';
        issueUrl.pathname = `/browse/${encodeURIComponent(issueKey)}`;
        issueUrl.search = '';
        issueUrl.hash = '';
        return issueUrl.href;
    } catch (_error) {
        return '';
    }
}

function currentEntryForEditor(entries, editor) {
    if (!editor) return null;
    return entries.find(entry => String(entry.id) === editor.displayedTeamId) || null;
}

function targetStillMatches(entries, editor) {
    const entry = currentEntryForEditor(entries, editor);
    return Boolean(
        entry
        && entry.capacityTargetState === 'matched'
        && entry.capacityIssueKey === editor.issueKey,
    );
}

function displayCapacity(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '';
}

function fixedErrorMessage(error) {
    const code = typeof error?.code === 'string' && error.code ? error.code : 'jira_capacity_update_failed';
    return CAPACITY_ERROR_MESSAGES[code] || CAPACITY_ERROR_MESSAGES.jira_capacity_update_failed;
}

function conflictMessage(currentCapacity) {
    if (currentCapacity === null) {
        return 'Capacity is now blank in Jira. Review and save again, or cancel.';
    }
    return `Capacity changed in Jira to ${displayCapacity(currentCapacity)}. Review and save again, or cancel.`;
}

function editorDomId(value) {
    return String(value || 'capacity').replace(/[^a-z0-9_-]+/gi, '-');
}

const noSubscription = () => () => {};
const noNumbers = () => null;
const NO_STATUSES = new Map();
const isFailedSave = save => save === 'failed' || save === 'rejected';
// The stored-number save state a card shows: the Team's stored-number slot only (a person-row failure belongs to the strip).
const plannedSaveOf = status => (status && status.plannedSave && status.plannedSave !== 'idle' ? status.plannedSave : '');
const teamsText = count => `${count} Team${count === 1 ? '' : 's'}`;

// Every card Team's status, through its own Team subscription; the map keeps its identity until one status changes.
function useTeamStatuses(controller, idsKey) {
    const cache = React.useRef(null);
    const subscribe = React.useCallback(listener => {
        if (!controller || !idsKey) return () => {};
        const unsubscribes = idsKey.split('\n').map(id => controller.subscribeTeam(id, listener));
        return () => unsubscribes.forEach(unsubscribe => unsubscribe());
    }, [controller, idsKey]);
    const getSnapshot = () => {
        if (!controller || !idsKey) return NO_STATUSES;
        const ids = idsKey.split('\n');
        const list = ids.map(id => controller.getTeamStatus(id));
        const previous = cache.current;
        if (previous && previous.key === idsKey && previous.list.every((status, index) => status === list[index])) return previous.map;
        cache.current = { key: idsKey, list, map: new Map(ids.map((id, index) => [id, list[index]])) };
        return cache.current.map;
    };
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// The overview row's state note, compact and expanded: stored-number saves in flight and failed ones (the cards stay
// unchanged; a failed card's Retry and Discard are in its hover rail).
export function usePlanningTeamCapacitySaveStatus() {
    const context = usePlanningAssigneeCapacityView();
    const controller = context?.controller || null;
    const getSnapshot = () => {
        const byTeam = controller?.getPlannedNumbers()?.byTeam;
        if (!byTeam) return '';
        const saves = Object.keys(byTeam).map(teamId => plannedSaveOf(controller.getTeamStatus(teamId)));
        const failed = saves.filter(isFailedSave).length, saving = saves.filter(save => save === 'saving').length;
        const count = n => `${n} Team save${n === 1 ? '' : 's'}`;
        return [failed ? `${count(failed)} failed: hover a card to retry` : '', saving ? `Saving ${teamsText(saving)}…` : ''].filter(Boolean).join(' · ');
    };
    return React.useSyncExternalStore(controller ? controller.subscribe : noSubscription, getSnapshot, getSnapshot);
}

export default function PlanningTeamCapacityCards({
    entries = [],
    capacityEnabled = false,
    canOpenCapacityJira = false,
    canEditCapacity = false,
    jiraUrl = '',
    sprintName = '',
    scopeSignature = '',
    capacityReadRevision = 0,
    capacityLoading = false,
    capacityReadError = '',
    capacityDataStale = false,
    futureSprintCapacityIssuesMissing = false,
    capacityShareLabel = '',
    updateCapacityRequest,
    onCapacitySaved,
    onCapacityRetry,
    onAnalyticsAction,
    onInteractionChange,
    resolveTeamColor,
    getTeamCapacityMeta,
    // Task 6: applies a mismatched Team's stored number to its own Jira ticket; without it no push icon is shown.
    onPushTeam,
}) {
    const [editor, updateEditor] = React.useState(null);
    const [invalidTargets, setInvalidTargets] = React.useState(() => new Set());
    const [configEditingSuppressed, setConfigEditingSuppressed] = React.useState(false);
    // Every displayed Team's stored number ("Team capacity (not in Jira)") and its own read and save status (#323).
    const assignee = usePlanningAssigneeCapacityView();
    const assigneeRef = React.useRef(assignee);
    assigneeRef.current = assignee;
    const capacityController = assignee?.controller || null;
    const numbers = React.useSyncExternalStore(capacityController ? capacityController.subscribe : noSubscription,
        capacityController ? capacityController.getPlannedNumbers : noNumbers, capacityController ? capacityController.getPlannedNumbers : noNumbers);
    const numbersRef = React.useRef(numbers);
    numbersRef.current = numbers;
    const plannedOf = entry => numbers?.byTeam?.[String(entry.id)] || null;
    // Commits waiting for the Team's document, which a click asked for (`ensureTeamDocument`); dropped on a scope change.
    const pendingCommitsRef = React.useRef(new Map());
    const inputRef = React.useRef(null);
    const editorCardRef = React.useRef(null);
    const pencilRefs = React.useRef(new Map());
    const restoreFocusIssueRef = React.useRef('');
    const requestAbortRef = React.useRef(null);
    const submissionRef = React.useRef(false);
    const previousReadRevisionRef = React.useRef(capacityReadRevision);
    const latestScopeRef = React.useRef(scopeSignature);
    const latestEntriesRef = React.useRef(entries);
    const latestCanEditRef = React.useRef(canEditCapacity);
    const latestReadFailureRef = React.useRef(Boolean(capacityReadError || capacityDataStale));
    const invalidTargetsRef = React.useRef(invalidTargets);
    const configSuppressedRef = React.useRef(configEditingSuppressed);
    const editorRef = React.useRef(editor);

    const setEditor = value => {
        const next = typeof value === 'function' ? value(editorRef.current) : value;
        editorRef.current = next; onInteractionChange?.(Boolean(next)); updateEditor(next);
    };
    React.useEffect(() => () => onInteractionChange?.(false), []);

    latestScopeRef.current = scopeSignature;
    latestEntriesRef.current = entries;
    latestCanEditRef.current = canEditCapacity;
    latestReadFailureRef.current = Boolean(capacityReadError || capacityDataStale);
    invalidTargetsRef.current = invalidTargets;
    configSuppressedRef.current = configEditingSuppressed;
    editorRef.current = editor;

    const activeEditor = editor?.scopeSignature === scopeSignature ? editor : null;
    const sortedTeams = React.useMemo(() => [...entries].sort((left, right) => (
        String(left.name || '').localeCompare(String(right.name || ''))
        || String(left.id || '').localeCompare(String(right.id || ''))
    )), [entries]);
    const teamStatuses = useTeamStatuses(capacityController, sortedTeams.map(entry => String(entry.id)).join('\n'));
    const statusOf = entry => teamStatuses.get(String(entry.id)) || null;
    // The Team is in the numbers map of the current Sprint and its status can save (null, unknown, is not yet true).
    const plannedFor = entry => Boolean(plannedOf(entry) && statusOf(entry)?.canSave === true);

    const getSubmitBlockedReason = React.useCallback((candidate) => {
        if (!candidate || candidate.scopeSignature !== latestScopeRef.current) {
            return CAPACITY_ERROR_MESSAGES.capacity_target_changed;
        }
        if (!latestCanEditRef.current) {
            return 'Capacity editing is unavailable until the Jira Capacity configuration is verified. Refresh Planning.';
        }
        if (configSuppressedRef.current) {
            return candidate.errorMessage || CAPACITY_ERROR_MESSAGES.capacity_config_missing;
        }
        if (latestReadFailureRef.current) {
            return CAPACITY_ERROR_MESSAGES.capacity_read_failed;
        }
        if (invalidTargetsRef.current.has(candidate.issueKey)) {
            return candidate.errorMessage || CAPACITY_ERROR_MESSAGES.capacity_target_changed;
        }
        if (!targetStillMatches(latestEntriesRef.current, candidate)) {
            return CAPACITY_ERROR_MESSAGES.capacity_target_changed;
        }
        return '';
    }, []);

    React.useLayoutEffect(() => {
        pendingCommitsRef.current.clear();
        if (!editorRef.current || editorRef.current.scopeSignature === scopeSignature) return;
        requestAbortRef.current?.abort();
        requestAbortRef.current = null;
        submissionRef.current = null;
        restoreFocusIssueRef.current = '';
        editorCardRef.current = null;
        setEditor(null);
    }, [scopeSignature]);

    React.useEffect(() => {
        if (previousReadRevisionRef.current === capacityReadRevision) return;
        previousReadRevisionRef.current = capacityReadRevision;
        const clearedTargets = new Set();
        invalidTargetsRef.current = clearedTargets;
        configSuppressedRef.current = false;
        setInvalidTargets(clearedTargets);
        setConfigEditingSuppressed(false);
        setEditor(current => {
            if (!current || !RELOAD_RESET_CODES.has(current.errorCode)) return current;
            return { ...current, errorCode: '', errorMessage: '' };
        });
    }, [capacityReadRevision]);

    React.useEffect(() => {
        if (!activeEditor) return undefined;
        const frame = window.requestAnimationFrame(() => {
            if (!inputRef.current) return;
            inputRef.current.focus();
            inputRef.current.select();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeEditor?.id]);

    React.useEffect(() => {
        if (activeEditor || !restoreFocusIssueRef.current) return undefined;
        const issueKey = restoreFocusIssueRef.current;
        const frame = window.requestAnimationFrame(() => {
            if (restoreFocusIssueRef.current !== issueKey) return;
            restoreFocusIssueRef.current = '';
            pencilRefs.current.get(issueKey)?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeEditor, sortedTeams]);

    React.useEffect(() => {
        if (!activeEditor) return undefined;
        const handlePointerDown = (event) => {
            if (submissionRef.current || editorCardRef.current?.contains(event.target)) return;
            editorCardRef.current = null;
            setEditor(null);
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [activeEditor?.id]);

    // Silent database-only mirror of each matched Jira ticket value: on the end of a user-initiated capacity read of the
    // same scope (`capacityLoading` true to false; automatic reads never set it). The controller decides the rest per Team
    // (an existing own document only, never a new one; differs after rounding; owner idle; can save).
    const previousLoadRef = React.useRef({ loading: capacityLoading, scope: scopeSignature });
    React.useEffect(() => {
        const previous = previousLoadRef.current;
        previousLoadRef.current = { loading: capacityLoading, scope: scopeSignature };
        if (!previous.loading || capacityLoading || previous.scope !== scopeSignature || capacityReadError || capacityDataStale) return;
        const control = assigneeRef.current?.controller;
        if (!control) return;
        entries.forEach(entry => {
            if (entry.capacityTargetState !== 'matched' || typeof entry.capacityTargetCapacity !== 'number') return;
            control.mirrorTeamPlanned(String(entry.id), entry.capacityTargetCapacity);
        });
    }, [capacityLoading, scopeSignature]);

    // A commit that waited for its Team's document is sent once that read settles, in the scope it was asked in.
    React.useEffect(() => {
        const pending = pendingCommitsRef.current;
        pending.forEach((intent, teamId) => {
            if (teamStatuses.get(teamId)?.load === 'loading') return;
            pending.delete(teamId);
            if (intent.scopeSignature !== latestScopeRef.current || intent.sprintId !== numbersRef.current?.sprintId) return;
            assigneeRef.current?.controller?.commitTeamPlanned(teamId, intent.value, intent.source);
        });
    }, [teamStatuses]);

    // Commits a Team's stored number, loading its document first when no card has loaded it yet (a user action).
    const commitTeamNumber = (teamId, value, source, scope) => {
        const control = assigneeRef.current?.controller;
        if (!control || scope.scopeSignature !== latestScopeRef.current || scope.sprintId !== numbersRef.current?.sprintId) return false;
        if (control.commitTeamPlanned(teamId, value, source)) return true;
        control.ensureTeamDocument(teamId);
        if (control.getTeamStatus(teamId).load !== 'loading') return false;
        pendingCommitsRef.current.set(teamId, { value, source, ...scope });
        return true;
    };

    React.useEffect(() => () => {
        requestAbortRef.current?.abort();
        requestAbortRef.current = null;
        submissionRef.current = null;
    }, []);

    const openEditor = (entry) => {
        if (
            activeEditor || !canEditCapacity || capacityReadError || capacityDataStale
            || configEditingSuppressed || invalidTargets.has(entry.capacityIssueKey)
            || entry.capacityTargetState !== 'matched' || !entry.capacityIssueKey
            || !entry.capacityTargetTeamName
        ) return;
        const nextEditor = {
            mode: 'jira',
            id: `jira:${entry.id}`,
            displayedTeamId: String(entry.id),
            displayedTeamName: entry.name,
            issueKey: entry.capacityIssueKey,
            targetTeamName: entry.capacityTargetTeamName,
            expectedCapacity: entry.capacityTargetCapacity,
            draft: typeof entry.capacityTargetCapacity === 'number'
                ? String(entry.capacityTargetCapacity)
                : '',
            sprintName,
            sprintId: numbers?.sprintId || '',
            scopeSignature,
            submitting: false,
            errorCode: '',
            errorMessage: '',
        };
        // A typed stored number settles to the ticket value after this save: load the Team's document now.
        if (plannedOf(entry)?.source === 'user' && statusOf(entry)?.canSave === true) assignee?.controller?.ensureTeamDocument(String(entry.id));
        editorRef.current = nextEditor;
        setEditor(nextEditor);
        onAnalyticsAction?.('capacity_edit_open');
    };

    // The stored team number's editor: no Jira ticket and no Jira number (the "no ticket" predicate) and the Team can
    // save. Opening it loads the Team's document; it writes through that Team's save queue and emits no capacity_* event.
    const openPlannedEditor = (entry) => {
        if (activeEditor || !entry.plannedEditable || !plannedFor(entry)) return;
        assignee.controller.ensureTeamDocument(String(entry.id));
        const stored = plannedOf(entry).value ?? '';
        const nextEditor = {
            mode: 'planned',
            id: `planned:${entry.id}`,
            displayedTeamId: String(entry.id),
            displayedTeamName: entry.name,
            issueKey: '',
            expectedCapacity: stored,
            draft: String(stored),
            sprintName,
            sprintId: numbers.sprintId,
            scopeSignature,
            submitting: false,
            errorCode: '',
            errorMessage: '',
        };
        editorRef.current = nextEditor;
        setEditor(nextEditor);
    };

    const cancelEditor = (restoreFocus) => {
        if (!editorRef.current || submissionRef.current) return;
        if (restoreFocus) restoreFocusIssueRef.current = editorRef.current.id;
        editorCardRef.current = null;
        editorRef.current = null;
        setEditor(null);
    };

    const submitPlannedEditor = (candidate) => {
        const context = assigneeRef.current;
        const parsed = validateNumberDraft(candidate.draft);
        if (!parsed.ok) {
            setEditor(current => current ? { ...current, errorMessage: parsed.error } : current);
            return;
        }
        if (!context?.controller || !commitTeamNumber(candidate.displayedTeamId, parsed.value, 'user', candidate)) {
            setEditor(current => current ? { ...current, errorMessage: 'Team capacity cannot be saved here. Refresh Planning.' } : current);
            return;
        }
        restoreFocusIssueRef.current = candidate.id;
        editorCardRef.current = null;
        editorRef.current = null;
        setEditor(null);
    };

    const submitEditor = async (event) => {
        event.preventDefault();
        const candidate = editorRef.current;
        if (!candidate || submissionRef.current) return;
        if (candidate.mode === 'planned') {
            submitPlannedEditor(candidate);
            return;
        }
        const blockedReason = getSubmitBlockedReason(candidate);
        if (blockedReason) {
            setEditor(current => current ? { ...current, errorMessage: blockedReason } : current);
            return;
        }
        const parsed = parseCapacityDraft(candidate.draft);
        if (!parsed.valid || parsed.value === candidate.expectedCapacity) return;

        const controller = new AbortController();
        submissionRef.current = controller;
        requestAbortRef.current?.abort();
        requestAbortRef.current = controller;
        const submittingEditor = {
            ...candidate,
            submitting: true,
            errorCode: '',
            errorMessage: '',
        };
        editorRef.current = submittingEditor;
        setEditor(submittingEditor);
        onAnalyticsAction?.('capacity_change_submit');

        try {
            const result = await updateCapacityRequest(candidate.issueKey, {
                sprintName: candidate.sprintName,
                teamName: candidate.targetTeamName,
                expectedCapacity: candidate.expectedCapacity,
                capacity: parsed.value,
            }, { signal: controller.signal });
            if (controller.signal.aborted || candidate.scopeSignature !== latestScopeRef.current) return;
            const savedCapacity = typeof result?.capacity === 'number' && Number.isFinite(result.capacity) && result.capacity >= 0
                ? result.capacity
                : parsed.value;
            const savedResult = result?.result === 'already_current' ? 'already_current' : 'success';
            onCapacitySaved?.({
                issueKey: candidate.issueKey,
                teamName: candidate.targetTeamName,
                capacity: savedCapacity,
                result: savedResult,
                sprintName: candidate.sprintName,
                scopeSignature: candidate.scopeSignature,
            });
            onAnalyticsAction?.('capacity_change_result', { result: 'success' });
            // The user's own Jira save also settles a number they typed, in any scope: that Team's stored `user` number
            // becomes {ticket value, jira}.
            const savedWire = plannedWireValue(savedCapacity);
            if (savedWire != null && numbersRef.current?.byTeam?.[candidate.displayedTeamId]?.source === 'user') {
                commitTeamNumber(candidate.displayedTeamId, savedWire, 'jira', candidate);
            }
            restoreFocusIssueRef.current = candidate.id;
            editorCardRef.current = null;
            editorRef.current = null;
            setEditor(null);
        } catch (error) {
            if (error?.name === 'AbortError' || controller.signal.aborted) return;
            const code = typeof error?.code === 'string' && error.code
                ? error.code
                : 'jira_capacity_update_failed';
            const isConflict = code === 'capacity_conflict';
            const isAuthenticationFailure = error?.name === 'AuthenticationRequiredError' || code === 'auth_required';
            const message = isAuthenticationFailure
                ? ''
                : isConflict
                    ? conflictMessage(error.currentCapacity)
                    : fixedErrorMessage(error);

            if (CONFIG_FAILURE_CODES.has(code)) {
                configSuppressedRef.current = true;
                setConfigEditingSuppressed(true);
            }
            if (TARGET_FAILURE_CODES.has(code)) {
                const nextTargets = new Set(invalidTargetsRef.current);
                nextTargets.add(candidate.issueKey);
                invalidTargetsRef.current = nextTargets;
                setInvalidTargets(nextTargets);
            }
            const failedEditor = {
                ...candidate,
                expectedCapacity: isConflict ? error.currentCapacity : candidate.expectedCapacity,
                submitting: false,
                errorCode: code,
                errorMessage: message,
            };
            editorRef.current = failedEditor;
            setEditor(failedEditor);
            onAnalyticsAction?.('capacity_change_result', { result: isConflict ? 'conflict' : 'failure' });
        } finally {
            if (
                requestAbortRef.current === controller
                && submissionRef.current === controller
            ) {
                requestAbortRef.current = null;
                submissionRef.current = null;
            }
        }
    };

    if (sortedTeams.length === 0) return null;
    const teamCount = sortedTeams.length;
    const rows = teamCount === 6 ? 2 : Math.ceil(teamCount / 6);
    const columns = Math.ceil(teamCount / rows);
    const actionsGloballySuppressed = Boolean(activeEditor || capacityReadError || capacityDataStale);
    const retryMessage = capacityDataStale
        ? 'Capacity could not be refreshed. Showing last loaded values.'
        : 'Capacity is unavailable. Retry.';
    const showFutureSprintEmptyStatus = futureSprintCapacityIssuesMissing && !capacityReadError;
    // A mismatch: a matched ticket the user may write and a number the user typed that differs from it (after rounding).
    // It marks the card; its push icon (→) joins the hover rail only with a push handler (Task 6).
    const mismatchOf = (entry) => {
        if (!numbers || capacityLoading || capacityReadError || capacityDataStale || !plannedFor(entry)) return null;
        const stored = plannedOf(entry);
        if (stored.source !== 'user' || stored.value == null) return null;
        if (entry.capacityTargetState !== 'matched' || !entry.capacityIssueKey || invalidTargets.has(entry.capacityIssueKey)) return null;
        if (!canEditCapacity || configEditingSuppressed || !entry.capacityTargetTeamName) return null;
        const ticket = typeof entry.capacityTargetCapacity === 'number' ? entry.capacityTargetCapacity : null;
        if (samePlannedValue(stored, ticket == null ? null : { value: ticket })) return null;
        return { stored: stored.value, ticket };
    };
    // A future Sprint with no capacity tickets yet: say so, and that the cards show stored numbers meanwhile.
    const futureSprintUsesPlanned = sortedTeams.some(entry => entry.capacitySource === 'planned');

    return (
        <section className="planning-team-capacity-cards" aria-label="Planned story points by team">
            <div className="planning-stats compact planning-team-capacity-heading">
                <div className="planning-stat">
                    <span className="planning-stat-label">Planned SP by Team:</span>
                </div>
            </div>
            {capacityReadError && (
                <div className="team-capacity-read-status" role="status" aria-busy={capacityLoading}>
                    <span>{retryMessage}</span>
                    <button
                        type="button"
                        className="secondary compact"
                        onClick={() => {
                            if (!capacityLoading) onCapacityRetry?.();
                        }}
                        disabled={capacityLoading}
                        aria-label={capacityLoading ? 'Retrying capacity' : 'Retry capacity'}
                    >
                        {capacityLoading ? 'Retrying capacity' : 'Retry'}
                    </button>
                </div>
            )}
            {showFutureSprintEmptyStatus && (
                <div className="team-capacity-read-status" role="status" aria-busy={capacityLoading}>
                    <span>Team capacity Jira issues have not been created yet for this future sprint.{futureSprintUsesPlanned ? ' Showing Team capacity (not in Jira) meanwhile.' : ''}</span>
                    <button
                        type="button"
                        className="secondary compact"
                        onClick={() => {
                            if (!capacityLoading) onCapacityRetry?.();
                        }}
                        disabled={capacityLoading}
                        aria-label={capacityLoading ? 'Refreshing capacity' : 'Refresh capacity'}
                    >
                        {capacityLoading ? 'Refreshing capacity' : 'Refresh capacity'}
                    </button>
                </div>
            )}
            <div
                className="team-stats-grid"
                style={{ '--planning-team-columns': columns }}
            >
                {sortedTeams.map((entry) => {
                    const isEditing = Boolean(activeEditor && activeEditor.displayedTeamId === String(entry.id));
                    const targetMatched = entry.capacityTargetState === 'matched' && Boolean(entry.capacityIssueKey);
                    const targetSuppressed = invalidTargets.has(entry.capacityIssueKey);
                    const jiraIssueUrl = buildJiraIssueUrl(jiraUrl, entry.capacityIssueKey);
                    const teamStatus = statusOf(entry);
                    const storedPlanned = plannedOf(entry);
                    const plannedSave = storedPlanned ? plannedSaveOf(teamStatus) : '';
                    // At most three rail icons: a failed save's Retry and Discard take the place of the Jira link and the push.
                    const showFailedIcons = !actionsGloballySuppressed && !isEditing && isFailedSave(plannedSave);
                    const showJira = !actionsGloballySuppressed && !showFailedIcons && targetMatched && !targetSuppressed
                        && canOpenCapacityJira && Boolean(jiraIssueUrl);
                    const showPencil = !actionsGloballySuppressed && targetMatched && !targetSuppressed
                        && canEditCapacity && !configEditingSuppressed;
                    // No ticket: the stored number's own pencil, shown while the Team's save right is unknown or granted and
                    // enabled once it is granted.
                    const showPlannedPencil = !actionsGloballySuppressed && !targetMatched && entry.plannedEditable === true
                        && Boolean(storedPlanned && teamStatus) && teamStatus.canSave !== false;
                    const plannedEditing = isEditing && activeEditor.mode === 'planned';
                    const plannedShown = entry.capacitySource === 'planned';
                    const mismatch = mismatchOf(entry);
                    const showPush = !actionsGloballySuppressed && !showFailedIcons && Boolean(mismatch) && typeof onPushTeam === 'function';
                    const hasActionRail = showJira || showPencil || showPlannedPencil || showPush || showFailedIcons;
                    const railIcons = [showJira, showPush, showFailedIcons, showFailedIcons, showPencil, showPlannedPencil].filter(Boolean).length;
                    const capacityValuePresent = capacityEnabled && entry.hasCapacityValue;
                    const adjustedCapacity = capacityValuePresent && typeof entry.teamCapacity === 'number'
                        ? entry.teamCapacity
                        : 0;
                    const capMeta = capacityValuePresent && adjustedCapacity > 0
                        ? getTeamCapacityMeta(entry.storyPoints, adjustedCapacity)
                        : null;
                    const barWidth = 116;
                    const hasPositiveCapacity = capacityValuePresent && adjustedCapacity > 0;
                    const scale = capacityAxis({ capacity: hasPositiveCapacity ? adjustedCapacity : 0, selected: entry.storyPoints }, TEAM_CARD_HEADROOM);
                    const valueWidth = scale > 0 ? (entry.storyPoints / scale) * barWidth : 0;
                    const markerX = hasPositiveCapacity ? (adjustedCapacity / scale) * barWidth : null;
                    const deltaSp = capacityValuePresent ? entry.storyPoints - adjustedCapacity : null;
                    const deltaPct = hasPositiveCapacity ? ((entry.storyPoints / adjustedCapacity) - 1) * 100 : null;
                    const tooltipText = `${plannedShown ? `Team capacity (not in Jira)${storedPlanned?.source === 'inherited' ? ', inherited' : ''} · ` : ''}${capacityValuePresent
                        ? `${deltaSp >= 0 ? '+' : ''}${deltaSp.toFixed(1)} SP (${deltaPct === null ? 'no percentage' : `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}%`})`
                        : `${entry.storyPoints.toFixed(1)} SP selected`}`;
                    const deltaLabel = capacityValuePresent
                        ? `Cap ${adjustedCapacity.toFixed(1)} · ${deltaSp >= 0 ? '+' : ''}${deltaSp.toFixed(1)} SP · ${deltaPct === null ? 'no percentage' : `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}%`}`
                        : null;
                    const errorId = `capacity-editor-${editorDomId(entry.capacityIssueKey || entry.id)}-error`;
                    const contextId = `capacity-editor-${editorDomId(entry.capacityIssueKey || entry.id)}-context`;
                    const plannedBlockedReason = plannedEditing && (activeEditor.scopeSignature !== scopeSignature || activeEditor.sprintId !== numbers?.sprintId || !entry.plannedEditable || !plannedFor(entry))
                        ? 'Team capacity cannot be saved here. Refresh Planning.'
                        : '';
                    const editorBlockedReason = plannedEditing ? plannedBlockedReason : isEditing ? getSubmitBlockedReason(activeEditor) : '';
                    const plannedDraft = plannedEditing ? validateNumberDraft(activeEditor.draft) : null;
                    const parsedDraft = plannedEditing
                        ? { valid: plannedDraft.ok, value: plannedDraft.ok ? plannedDraft.value : null }
                        : isEditing ? parseCapacityDraft(activeEditor.draft) : { valid: false, value: null };
                    const saveDisabled = Boolean(
                        !isEditing || activeEditor.submitting || editorBlockedReason
                        || !parsedDraft.valid || (plannedEditing
                            ? samePlannedValue(parsedDraft.value == null ? null : { value: parsedDraft.value }, activeEditor.expectedCapacity === '' ? null : { value: activeEditor.expectedCapacity })
                            : parsedDraft.value === activeEditor.expectedCapacity),
                    );
                    // The stored number's save state shows on the card because the assignee strip may be collapsed; its
                    // Retry and Discard are the strip's actions (Discard keeps the strip's name and fits the narrow card).
                    // A failed save is the rail's ↻ Retry and × Discard (readout: the error), so the card never grows.
                    const failedText = plannedSave === 'rejected' ? 'Team capacity not saved: the server refused it.' : plannedSave === 'failed' ? 'Team capacity not saved.' : '';
                    const statusMessage = isEditing
                        ? (editorBlockedReason || activeEditor.errorMessage || (plannedDraft && !plannedDraft.ok ? plannedDraft.error : ''))
                        : '';
                    const compactCapacityShareLabel = capacityShareLabel
                        .replace(/^Planning\s+/, '')
                        .replace(/\s+share\s+/, ' ');
                    const editorContext = plannedEditing ? `Team capacity (not in Jira)${capacityShareLabel ? ` · ${capacityShareLabel}` : ''}` : capacityShareLabel;
                    const compactEditorContext = plannedEditing ? 'Team capacity (not in Jira)' : compactCapacityShareLabel;
                    const editorDescription = [editorContext ? contextId : '', statusMessage ? errorId : ''].filter(Boolean).join(' ');

                    return (
                        <article
                            key={entry.id}
                            className={`team-stat-card team-card${isEditing ? ' is-capacity-editing' : ''}${hasActionRail ? ' has-capacity-actions' : ''}${isEditing && editorContext ? ' has-capacity-share' : ''}${statusMessage ? ' has-capacity-status' : ''}`}
                            data-tooltip={isEditing || statusMessage ? undefined : tooltipText}
                            data-capacity-team={entry.id}
                            data-capacity-source={entry.capacitySource || undefined}
                            data-capacity-attention={showFailedIcons ? 'failed' : mismatch ? 'mismatch' : undefined}
                            data-capacity-rail-icons={railIcons > 2 ? railIcons : undefined}
                            data-planned-source={plannedShown ? storedPlanned?.source || undefined : undefined}
                            ref={node => {
                                if (isEditing) editorCardRef.current = node;
                            }}
                        >
                            <div className="team-capacity-label-row">
                                <div className="team-stat-label">{entry.name}</div>
                                {isEditing && editorContext && (
                                    <span
                                        id={contextId}
                                        className="team-capacity-editor-context"
                                        role="note"
                                        aria-label={editorContext}
                                    >
                                        {compactEditorContext}
                                    </span>
                                )}
                                {hasActionRail && (
                                    <div className="team-capacity-action-rail">
                                        {showJira && (
                                            <TrackedExternalLink
                                                className="team-capacity-action team-capacity-jira-action"
                                                href={jiraIssueUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                analyticsMeta={buildJiraBrowseLinkAnalytics({
                                                    issueKind: 'unknown',
                                                    sourceSurface: 'planning',
                                                })}
                                                aria-label={`Open ${entry.name} capacity ticket in Jira`}
                                                title="Open capacity ticket in Jira"
                                            >
                                                <JiraMarkIcon className="team-capacity-jira-icon" />
                                            </TrackedExternalLink>
                                        )}
                                        {showPush && (
                                            <RailIcon readout={`Apply ${formatSp(mismatch.stored)} SP to Jira (ticket ${mismatch.ticket == null ? 'blank' : `${formatSp(mismatch.ticket)} SP`})`}
                                                label={`Apply ${entry.name} team capacity to Jira`}
                                                onClick={() => onPushTeam({ teamId: String(entry.id), issueKey: entry.capacityIssueKey, stored: mismatch.stored, ticket: mismatch.ticket })}>
                                                <ArrowRightIcon />
                                            </RailIcon>
                                        )}
                                        {showFailedIcons && (
                                            <>
                                                <RailIcon readout={`Retry · ${failedText}`} label="Retry" onClick={() => assignee.controller.retryTeam(String(entry.id))}>
                                                    <RetryIcon />
                                                </RailIcon>
                                                <RailIcon readout={`Discard changes · ${failedText}`} label="Discard changes" onClick={() => assignee.controller.discardTeamPlanned(String(entry.id))}>
                                                    <CloseIcon />
                                                </RailIcon>
                                            </>
                                        )}
                                        {showPencil && (
                                            <IconButton
                                                variant="secondary compact"
                                                className="team-capacity-action team-capacity-edit-action"
                                                size="sm"
                                                ref={node => {
                                                    if (node) pencilRefs.current.set(`jira:${entry.id}`, node);
                                                    else pencilRefs.current.delete(`jira:${entry.id}`);
                                                }}
                                                onClick={() => openEditor(entry)}
                                                aria-label={`Edit ${entry.name} capacity`}
                                                title="Edit capacity"
                                            >
                                                <PencilIcon />
                                            </IconButton>
                                        )}
                                        {showPlannedPencil && (
                                            <IconButton
                                                variant="secondary compact"
                                                className="team-capacity-action team-capacity-edit-action"
                                                size="sm"
                                                ref={node => {
                                                    if (node) pencilRefs.current.set(`planned:${entry.id}`, node);
                                                    else pencilRefs.current.delete(`planned:${entry.id}`);
                                                }}
                                                onClick={() => openPlannedEditor(entry)}
                                                disabled={teamStatus.canSave !== true}
                                                aria-label={`Edit ${entry.name} team capacity`}
                                                title="Edit team capacity (not in Jira)"
                                            >
                                                <PencilIcon />
                                            </IconButton>
                                        )}
                                    </div>
                                )}
                            </div>
                            {isEditing ? (
                                <>
                                    <form
                                        className="team-capacity-editor"
                                        onSubmit={submitEditor}
                                        aria-busy={activeEditor.submitting}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Escape') {
                                                event.preventDefault();
                                                cancelEditor(true);
                                            }
                                        }}
                                    >
                                        <div className="team-capacity-editor-row">
                                            <input
                                                ref={inputRef}
                                                className="team-capacity-input"
                                                type="number"
                                                min="0"
                                                step="any"
                                                value={activeEditor.draft}
                                                onChange={event => setEditor(current => {
                                                    if (!current || current.id !== activeEditor.id) return current;
                                                    const next = { ...current, draft: event.target.value };
                                                    editorRef.current = next;
                                                    return next;
                                                })}
                                                disabled={activeEditor.submitting}
                                                aria-label={plannedEditing ? `${entry.name} team capacity (not in Jira)` : `${entry.name} Jira total planned capacity`}
                                                aria-describedby={editorDescription}
                                            />
                                            <IconButton
                                                variant="secondary compact"
                                                className="team-capacity-editor-action"
                                                size="md"
                                                type="submit"
                                                disabled={saveDisabled}
                                                isLoading={activeEditor.submitting}
                                                aria-label={activeEditor.submitting
                                                    ? `Saving ${entry.name} capacity`
                                                    : plannedEditing ? `Save ${entry.name} team capacity` : `Save ${entry.name} capacity`}
                                                title={plannedEditing ? 'Save team capacity (not in Jira)' : 'Save capacity'}
                                            >
                                                <CheckIcon />
                                            </IconButton>
                                            <IconButton
                                                variant="secondary compact"
                                                className="team-capacity-editor-action"
                                                size="md"
                                                type="button"
                                                onClick={() => cancelEditor(true)}
                                                disabled={activeEditor.submitting}
                                                aria-label={plannedEditing ? `Cancel ${entry.name} team capacity edit` : `Cancel ${entry.name} capacity edit`}
                                                title="Cancel capacity edit"
                                            >
                                                <CloseIcon />
                                            </IconButton>
                                        </div>
                                    </form>
                                    {statusMessage && (
                                        <div id={errorId} className="team-capacity-status" role="status" aria-live="polite">
                                            <span>{statusMessage}</span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div
                                        className="microbar"
                                        aria-label={capacityValuePresent
                                            ? `${entry.storyPoints.toFixed(1)} story points selected against ${adjustedCapacity.toFixed(1)} ${plannedShown ? 'team capacity (not in Jira)' : 'capacity'}`
                                            : `${entry.storyPoints.toFixed(1)} story points selected`}
                                    >
                                        <div
                                            className="microbar-fill"
                                            style={{
                                                width: `${scale > 0 ? Math.min(100, (valueWidth / barWidth) * 100) : 0}%`,
                                                background: resolveTeamColor(entry.id),
                                            }}
                                        />
                                        {markerX !== null && (
                                            <div className="microbar-marker" style={{ left: `${(markerX / barWidth) * 100}%` }} />
                                        )}
                                        <span className="microbar-label">{entry.storyPoints.toFixed(1)} SP</span>
                                    </div>
                                    {deltaLabel && (
                                        <div className={`microbar-meta ${capMeta?.status || ''}`}>{deltaLabel}</div>
                                    )}
                                </>
                            )}
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
