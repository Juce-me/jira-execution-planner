import * as React from 'react';
import { buildJiraBrowseLinkAnalytics } from '../analytics/externalLinks.js';
import TrackedExternalLink from '../components/TrackedExternalLink.jsx';
import IconButton from '../ui/IconButton.jsx';
import JiraMarkIcon from '../ui/JiraMarkIcon.jsx';
import { parseCapacityDraft } from './planningCapacityUtils.js';

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
    capacityShareLabel = '',
    updateCapacityRequest,
    onCapacitySaved,
    onCapacityRetry,
    onAnalyticsAction,
    resolveTeamColor,
    getTeamCapacityMeta,
}) {
    const [editor, setEditor] = React.useState(null);
    const [invalidTargets, setInvalidTargets] = React.useState(() => new Set());
    const [configEditingSuppressed, setConfigEditingSuppressed] = React.useState(false);
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

    latestScopeRef.current = scopeSignature;
    latestEntriesRef.current = entries;
    latestCanEditRef.current = canEditCapacity;
    latestReadFailureRef.current = Boolean(capacityReadError || capacityDataStale);
    invalidTargetsRef.current = invalidTargets;
    configSuppressedRef.current = configEditingSuppressed;
    editorRef.current = editor;

    const activeEditor = editor?.scopeSignature === scopeSignature ? editor : null;
    const sortedTeams = React.useMemo(() => [...entries].sort((left, right) => {
        if (capacityEnabled) {
            const leftDelta = left.storyPoints - (left.teamCapacity || 0);
            const rightDelta = right.storyPoints - (right.teamCapacity || 0);
            if (rightDelta !== leftDelta) return rightDelta - leftDelta;
        }
        return right.storyPoints - left.storyPoints;
    }), [entries, capacityEnabled]);

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
    }, [activeEditor?.issueKey]);

    React.useEffect(() => {
        if (activeEditor || !restoreFocusIssueRef.current) return undefined;
        const issueKey = restoreFocusIssueRef.current;
        restoreFocusIssueRef.current = '';
        const frame = window.requestAnimationFrame(() => {
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
    }, [activeEditor?.issueKey]);

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
            displayedTeamId: String(entry.id),
            displayedTeamName: entry.name,
            issueKey: entry.capacityIssueKey,
            targetTeamName: entry.capacityTargetTeamName,
            expectedCapacity: entry.capacityTargetCapacity,
            draft: typeof entry.capacityTargetCapacity === 'number'
                ? String(entry.capacityTargetCapacity)
                : '',
            sprintName,
            scopeSignature,
            submitting: false,
            errorCode: '',
            errorMessage: '',
        };
        editorRef.current = nextEditor;
        setEditor(nextEditor);
        onAnalyticsAction?.('capacity_edit_open');
    };

    const cancelEditor = (restoreFocus) => {
        if (!editorRef.current || submissionRef.current) return;
        if (restoreFocus) restoreFocusIssueRef.current = editorRef.current.issueKey;
        editorCardRef.current = null;
        editorRef.current = null;
        setEditor(null);
    };

    const submitEditor = async (event) => {
        event.preventDefault();
        const candidate = editorRef.current;
        if (!candidate || submissionRef.current) return;
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
            restoreFocusIssueRef.current = candidate.issueKey;
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

    return (
        <section className="planning-team-capacity-cards" aria-label="Selected story points by team">
            <div className="planning-stats compact planning-team-capacity-heading">
                <div className="planning-stat">
                    <span className="planning-stat-label">Selected SP by Team:</span>
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
            <div
                className="team-stats-grid"
                style={{ '--planning-team-columns': columns }}
            >
                {sortedTeams.map((entry) => {
                    const isEditing = Boolean(activeEditor && activeEditor.displayedTeamId === String(entry.id));
                    const targetMatched = entry.capacityTargetState === 'matched' && Boolean(entry.capacityIssueKey);
                    const targetSuppressed = invalidTargets.has(entry.capacityIssueKey);
                    const jiraIssueUrl = buildJiraIssueUrl(jiraUrl, entry.capacityIssueKey);
                    const showJira = !actionsGloballySuppressed && targetMatched && !targetSuppressed
                        && canOpenCapacityJira && Boolean(jiraIssueUrl);
                    const showPencil = !actionsGloballySuppressed && targetMatched && !targetSuppressed
                        && canEditCapacity && !configEditingSuppressed;
                    const hasActionRail = showJira || showPencil;
                    const capacityValuePresent = capacityEnabled && entry.hasCapacityValue;
                    const adjustedCapacity = capacityValuePresent && typeof entry.teamCapacity === 'number'
                        ? entry.teamCapacity
                        : 0;
                    const capMeta = capacityValuePresent && adjustedCapacity > 0
                        ? getTeamCapacityMeta(entry.storyPoints, adjustedCapacity)
                        : null;
                    const barWidth = 116;
                    const hasPositiveCapacity = capacityValuePresent && adjustedCapacity > 0;
                    const scale = hasPositiveCapacity
                        ? adjustedCapacity * 1.3
                        : entry.storyPoints * 1.3;
                    const valueWidth = scale > 0
                        ? Math.min(barWidth, (entry.storyPoints / scale) * barWidth)
                        : 0;
                    const markerX = hasPositiveCapacity ? (adjustedCapacity / scale) * barWidth : null;
                    const deltaSp = capacityValuePresent ? entry.storyPoints - adjustedCapacity : null;
                    const deltaPct = hasPositiveCapacity ? ((entry.storyPoints / adjustedCapacity) - 1) * 100 : null;
                    const tooltipText = capacityValuePresent
                        ? `${deltaSp >= 0 ? '+' : ''}${deltaSp.toFixed(1)} SP (${deltaPct === null ? 'no percentage' : `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}%`})`
                        : `${entry.storyPoints.toFixed(1)} SP selected`;
                    const deltaLabel = capacityValuePresent
                        ? `Cap ${adjustedCapacity.toFixed(1)} · ${deltaSp >= 0 ? '+' : ''}${deltaSp.toFixed(1)} SP · ${deltaPct === null ? 'no percentage' : `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}%`}`
                        : null;
                    const errorId = `capacity-editor-${editorDomId(entry.capacityIssueKey || entry.id)}-error`;
                    const contextId = `capacity-editor-${editorDomId(entry.capacityIssueKey || entry.id)}-context`;
                    const editorBlockedReason = isEditing ? getSubmitBlockedReason(activeEditor) : '';
                    const parsedDraft = isEditing ? parseCapacityDraft(activeEditor.draft) : { valid: false, value: null };
                    const saveDisabled = Boolean(
                        !isEditing || activeEditor.submitting || editorBlockedReason
                        || !parsedDraft.valid || parsedDraft.value === activeEditor.expectedCapacity,
                    );
                    const statusMessage = isEditing
                        ? (editorBlockedReason || activeEditor.errorMessage)
                        : '';
                    const compactCapacityShareLabel = capacityShareLabel
                        .replace(/^Planning\s+/, '')
                        .replace(/\s+share\s+/, ' ');
                    const editorDescription = [capacityShareLabel ? contextId : '', statusMessage ? errorId : ''].filter(Boolean).join(' ');

                    return (
                        <article
                            key={entry.id}
                            className={`team-stat-card team-card${isEditing ? ' is-capacity-editing' : ''}${hasActionRail ? ' has-capacity-actions' : ''}${isEditing && capacityShareLabel ? ' has-capacity-share' : ''}${statusMessage ? ' has-capacity-status' : ''}`}
                            data-tooltip={isEditing || statusMessage ? undefined : tooltipText}
                            data-capacity-team={entry.id}
                            ref={node => {
                                if (isEditing) editorCardRef.current = node;
                            }}
                        >
                            <div className="team-capacity-label-row">
                                <div className="team-stat-label">{entry.name}</div>
                                {isEditing && capacityShareLabel && (
                                    <span
                                        id={contextId}
                                        className="team-capacity-editor-context"
                                        role="note"
                                        aria-label={capacityShareLabel}
                                    >
                                        {compactCapacityShareLabel}
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
                                        {showPencil && (
                                            <IconButton
                                                variant="secondary compact"
                                                className="team-capacity-action team-capacity-edit-action"
                                                size="sm"
                                                ref={node => {
                                                    if (node) pencilRefs.current.set(entry.capacityIssueKey, node);
                                                    else pencilRefs.current.delete(entry.capacityIssueKey);
                                                }}
                                                onClick={() => openEditor(entry)}
                                                aria-label={`Edit ${entry.name} capacity`}
                                                title="Edit capacity"
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
                                                    if (!current || current.issueKey !== activeEditor.issueKey) return current;
                                                    const next = { ...current, draft: event.target.value };
                                                    editorRef.current = next;
                                                    return next;
                                                })}
                                                disabled={activeEditor.submitting}
                                                aria-label={`${entry.name} Jira total planned capacity`}
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
                                                    : `Save ${entry.name} capacity`}
                                                title="Save capacity"
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
                                                aria-label={`Cancel ${entry.name} capacity edit`}
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
                                            ? `${entry.storyPoints.toFixed(1)} story points selected against ${adjustedCapacity.toFixed(1)} capacity`
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
