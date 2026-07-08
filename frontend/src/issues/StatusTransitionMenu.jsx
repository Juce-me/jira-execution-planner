import * as React from 'react';
import StatusPill from '../ui/StatusPill.jsx';
import { MAX_STATUS_TRANSITION_ISSUES } from '../eng/engStatusTransitionUtils.js';

// Shared ENG status-transition control used by Catch Up (single issue) and Planning
// (composed batch) for Epic, Story, and Subtask status pills. It is presentational:
// all transition state and handlers arrive as props from the dashboard hook wiring,
// so this file never imports the transition API or hook. It is only rendered when the
// ENG status-transition surface is enabled; passive surfaces (EPM, Stats, Scenario,
// Settings open) keep rendering the plain <StatusPill> span at the call site instead.

const TOO_MANY_ISSUES_MESSAGE = 'Too many issues selected. Narrow your selection, then try again.';

// Prefer the aggregated targetStatuses from the options contract; fall back to the
// distinct per-issue transition target names when the aggregate list is absent.
function resolveTargetStatuses(options) {
    const aggregated = Array.isArray(options?.targetStatuses) ? options.targetStatuses : [];
    if (aggregated.length) {
        return aggregated
            .map((entry) => ({
                name: String(entry?.name || '').trim(),
                availableCount: Number(entry?.availableCount || 0),
                blockedCount: Number(entry?.blockedCount || 0),
            }))
            .filter((entry) => entry.name);
    }
    const byName = new Map();
    (Array.isArray(options?.issues) ? options.issues : []).forEach((issue) => {
        (Array.isArray(issue?.transitions) ? issue.transitions : []).forEach((transition) => {
            const name = String(transition?.toStatus || transition?.name || '').trim();
            if (name && !byName.has(name)) {
                byName.set(name, { name, availableCount: 0, blockedCount: 0 });
            }
        });
    });
    return Array.from(byName.values());
}

function optionLabel(entry) {
    if (entry.blockedCount > 0) {
        return `${entry.name} (${entry.availableCount} available)`;
    }
    return entry.name;
}

function resultMessage(result) {
    if (!result) return '';
    const { succeeded = 0, failed = 0 } = result;
    const noun = (count) => (count === 1 ? 'issue' : 'issues');
    if (failed === 0) {
        return `Updated ${succeeded} ${noun(succeeded)}.`;
    }
    if (succeeded === 0) {
        return `No issues updated. ${failed} ${noun(failed)} failed and stay unchanged.`;
    }
    return `Updated ${succeeded} ${noun(succeeded)}, ${failed} failed. Failed items stay unchanged.`;
}

export default function StatusTransitionMenu({
    issue,
    fallbackIssueType = '',
    statusLabel,
    statusClassName = '',
    sourceSurface = 'catch_up',
    isOpen = false,
    options = null,
    optionsLoading = false,
    submitting = false,
    error = '',
    errorCode = '',
    result = null,
    targetsCount = 0,
    canToggleTargetSet = false,
    isInTargetSet = false,
    onOpen,
    onClose,
    onToggleTargetSet,
    onSubmit,
    onSubmitSingleIssue,
}) {
    const [selectedTargetStatus, setSelectedTargetStatus] = React.useState('');
    const selectRef = React.useRef(null);
    const issueKey = String(issue?.key || '').trim();

    // Reset the chosen status when the menu opens for a (possibly different) issue.
    React.useEffect(() => {
        if (isOpen) {
            setSelectedTargetStatus('');
        }
    }, [isOpen, issueKey]);

    // Move focus into the menu once options are available.
    React.useEffect(() => {
        if (isOpen && !optionsLoading && selectRef.current) {
            selectRef.current.focus();
        }
    }, [isOpen, optionsLoading]);

    const isServerTooMany = errorCode === 'too_many_issues';
    const isPlanning = sourceSurface === 'planning';
    // Client-side over-cap: the composed Planning batch exceeds the shared cap. Unlike a
    // server too_many_issues (options failed, so no valid statuses), the fetched options
    // are still valid here, so keep the controls visible but disable the batch submit and
    // offer the single-issue recovery action below.
    const isOverCap = isPlanning && targetsCount > MAX_STATUS_TRANSITION_ISSUES;
    const showTooManyMessage = isServerTooMany || isOverCap;
    const targetStatuses = resolveTargetStatuses(options);
    const canApplySelectedStatus = !!selectedTargetStatus && !optionsLoading && !submitting;
    const submitDisabled = (
        !canApplySelectedStatus ||
        isServerTooMany ||
        isOverCap ||
        (isPlanning ? targetsCount === 0 : false)
    );
    const showSingleIssueAction = isPlanning && targetsCount > 1 && typeof onSubmitSingleIssue === 'function';

    const submitLabel = isPlanning
        ? `Apply to selected ${targetsCount === 1 ? 'target' : 'targets'} (${targetsCount})`
        : 'Apply';

    const handleTriggerClick = () => {
        if (isOpen) {
            onClose?.();
        } else {
            onOpen?.(issue, fallbackIssueType);
        }
    };

    const handleSubmit = () => {
        if (submitDisabled) return;
        onSubmit?.(selectedTargetStatus);
    };

    // "Apply to this issue only" acts on the single clicked issue, so it stays available
    // even when the composed batch is over the cap — it is the recovery path.
    const handleSubmitSingle = () => {
        if (!canApplySelectedStatus) return;
        onSubmitSingleIssue?.(selectedTargetStatus);
    };

    const handleMenuKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onClose?.();
        }
    };

    return (
        <span className="status-transition">
            <StatusPill
                interactive
                className={statusClassName}
                label={statusLabel}
                onClick={handleTriggerClick}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                data-status-transition-trigger="true"
                data-issue-key={issueKey}
                data-issue-kind={String(fallbackIssueType || '').toLowerCase()}
            />
            {isOpen && (
                <>
                    <button
                        type="button"
                        className="status-transition-menu-backdrop"
                        aria-label="Close status menu"
                        onClick={() => onClose?.()}
                    />
                    <div
                        className="status-transition-menu"
                        role="menu"
                        data-status-transition-menu="true"
                        data-issue-key={issueKey}
                        onKeyDown={handleMenuKeyDown}
                    >
                        {canToggleTargetSet && (
                            <label className="status-transition-target-toggle-row">
                                <input
                                    type="checkbox"
                                    className="status-transition-target-toggle"
                                    checked={!!isInTargetSet}
                                    onChange={() => onToggleTargetSet?.()}
                                />
                                <span>Include in batch</span>
                            </label>
                        )}
                        {optionsLoading && (
                            <div className="status-transition-menu-note status-transition-menu-loading">Loading status options...</div>
                        )}
                        {!optionsLoading && (error || showTooManyMessage) && (
                            <div
                                className={`status-transition-menu-note status-transition-menu-error${showTooManyMessage ? ' is-too-many' : ''}`}
                                role="alert"
                            >
                                {showTooManyMessage ? TOO_MANY_ISSUES_MESSAGE : error}
                            </div>
                        )}
                        {!optionsLoading && !isServerTooMany && (
                            <div className="status-transition-menu-controls">
                                <select
                                    ref={selectRef}
                                    className="status-transition-select"
                                    value={selectedTargetStatus}
                                    onChange={(event) => setSelectedTargetStatus(event.target.value)}
                                    disabled={submitting || targetStatuses.length === 0}
                                    aria-label="Target status"
                                >
                                    <option value="">
                                        {targetStatuses.length === 0 ? 'No available transitions' : 'Choose status...'}
                                    </option>
                                    {targetStatuses.map((entry) => (
                                        <option key={entry.name} value={entry.name}>{optionLabel(entry)}</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    className="status-transition-submit"
                                    onClick={handleSubmit}
                                    disabled={submitDisabled}
                                >
                                    {submitting ? 'Applying...' : submitLabel}
                                </button>
                                {showSingleIssueAction && (
                                    <button
                                        type="button"
                                        className="status-transition-submit-single"
                                        onClick={handleSubmitSingle}
                                        disabled={!canApplySelectedStatus}
                                    >
                                        Apply to this issue only
                                    </button>
                                )}
                            </div>
                        )}
                        {result && (
                            <div className="status-transition-menu-result" role="status">
                                {resultMessage(result)}
                            </div>
                        )}
                    </div>
                </>
            )}
        </span>
    );
}
