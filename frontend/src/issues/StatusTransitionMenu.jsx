import * as React from 'react';
import StatusPill from '../ui/StatusPill.jsx';
import { MAX_STATUS_TRANSITION_ISSUES } from '../eng/engStatusTransitionUtils.js';
import { getIssueStatusClassName, normalizeIssueStatus } from './issueViewUtils.js';

// Shared ENG status-transition control used by Catch Up (single issue) and Planning
// (composed batch) for Epic, Story, and Subtask status pills. It is presentational:
// all transition state and handlers arrive as props from the dashboard hook wiring,
// so this file never imports the transition API or hook. It is only rendered when the
// ENG status-transition surface is enabled; passive surfaces (EPM, Stats, Scenario,
// Settings open) keep rendering the plain <StatusPill> span at the call site instead.

const TOO_MANY_ISSUES_MESSAGE = 'Too many issues selected. Narrow your selection, then try again.';
const STATUS_SORT_RANK = new Map([
    ['pending', 10],
    ['to do', 20],
    ['todo', 20],
    ['awaiting validation', 30],
    ['postponed', 40],
    ['blocked', 50],
    ['analysis', 60],
    ['in progress', 70],
    ['accepted', 80],
    ['release', 90],
    ['waiting for release', 90],
    ['done', 100],
    ['killed', 110],
    ['incomplete', 120],
]);

function statusSortRank(name) {
    const normalized = normalizeIssueStatus(name);
    if (STATUS_SORT_RANK.has(normalized)) return STATUS_SORT_RANK.get(normalized);
    if (normalized.includes('blocked')) return 50;
    if (normalized.includes('progress')) return 70;
    if (normalized.includes('done') || normalized.includes('complete')) return 100;
    return 55;
}

function sortTargetStatuses(statuses) {
    return [...statuses].sort((a, b) => {
        const rankDelta = statusSortRank(a.name) - statusSortRank(b.name);
        if (rankDelta !== 0) return rankDelta;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

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
}) {
    const firstOptionRef = React.useRef(null);
    const issueKey = String(issue?.key || '').trim();

    // Move focus into the menu once options are available.
    React.useEffect(() => {
        if (isOpen && !optionsLoading && firstOptionRef.current) {
            firstOptionRef.current.focus();
        }
    }, [isOpen, optionsLoading]);

    const isServerTooMany = errorCode === 'too_many_issues';
    const isPlanning = sourceSurface === 'planning';
    // Client-side over-cap: the composed Planning batch exceeds the shared cap. Unlike a
    // server too_many_issues (options failed, so no valid statuses), the cached status
    // options are still visible but disabled so a >50 mutation can never be sent.
    const isOverCap = isPlanning && targetsCount > MAX_STATUS_TRANSITION_ISSUES;
    const showTooManyMessage = isServerTooMany || isOverCap;
    const currentStatusName = normalizeIssueStatus(statusLabel);
    const targetStatuses = sortTargetStatuses(resolveTargetStatuses(options)
        .filter((entry) => normalizeIssueStatus(entry.name) !== currentStatusName));
    const optionDisabled = (
        optionsLoading ||
        submitting ||
        isServerTooMany ||
        isOverCap ||
        (isPlanning ? targetsCount === 0 : false)
    );
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

    const handleOptionClick = (targetStatus) => {
        if (optionDisabled) return;
        onSubmit?.(targetStatus);
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
                        {!optionsLoading && !isServerTooMany && targetStatuses.length === 0 && (
                            <div className="status-transition-menu-note">No available transitions.</div>
                        )}
                        {!optionsLoading && !isServerTooMany && targetStatuses.length > 0 && (
                            <div className="status-transition-menu-options" aria-label={submitLabel}>
                                {targetStatuses.map((entry, index) => (
                                    <button
                                        key={entry.name}
                                        ref={index === 0 ? firstOptionRef : null}
                                        type="button"
                                        className="status-transition-option"
                                        role="menuitem"
                                        onClick={() => handleOptionClick(entry.name)}
                                        disabled={optionDisabled}
                                    >
                                        <span
                                            className={getIssueStatusClassName(entry.name, 'status-transition-option-marker')}
                                            aria-hidden="true"
                                        />
                                        <span className="status-transition-option-label">{optionLabel(entry)}</span>
                                    </button>
                                ))}
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
