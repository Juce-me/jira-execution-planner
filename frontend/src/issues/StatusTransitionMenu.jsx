import * as React from 'react';
import StatusPill from '../ui/StatusPill.jsx';
import IssueFieldOptionMenu from './IssueFieldOptionMenu.jsx';
import { MAX_STATUS_TRANSITION_ISSUES } from '../eng/engStatusTransitionUtils.js';
import { getIssueStatusClassName, normalizeIssueStatus } from './issueViewUtils.js';
import { useStatusColourStyle } from './StatusColourContext.jsx';

// Shared ENG status-transition control used by Catch Up (single issue) and Planning for
// Epic, Story, and Subtask status pills. In Planning a Story pill applies to every selected
// Story (the batch); Epic and Subtask pills change only their own issue. It is presentational:
// all transition state and handlers arrive as props from the dashboard hook wiring,
// so this file never imports the transition API or hook. It is only rendered when the
// ENG status-transition surface is enabled; passive surfaces (EPM, Stats, Scenario,
// Settings open) keep rendering the plain <StatusPill> span at the call site instead.

// A mouse resting on the pill this long is about to open it; sweeping past does not warm anything.
const PREFETCH_HOVER_DWELL_MS = 120;
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
    actsOnSelection = true,
    onOpen,
    onPrefetch,
    onClose,
    onSubmit,
    portalTarget = null,
    previewOnly = null,
    onPreviewLifecycleChange,
}) {
    const issueKey = String(issue?.key || '').trim();
    const statusStyle = useStatusColourStyle();
    // Owns the trigger anchor. The menu normally stays inside this wrapper; Board panel menus
    // portal to the panel root, and IssueFieldOptionMenu includes both nodes in outside-click
    // dismissal so option clicks are never mistaken for click-away gestures.
    const fieldRef = React.useRef(null);
    const targetIdentity = React.useId().replace(/:/g, '');
    const previewDescriptor = previewOnly?.fieldKind === 'status'
        && previewOnly?.issueKey === issueKey
        && previewOnly?.targetIdentity === targetIdentity
        ? { ...previewOnly, targetIdentity }
        : null;

    const isServerTooMany = errorCode === 'too_many_issues';
    // Only a Planning Story pill applies to the selected Stories; Epic and Subtask pills act on
    // themselves, so they behave like Catch Up and never show the batch count or cap. A Planning
    // Table row pill also acts on its own row, so it opts out with actsOnSelection={false}.
    const isPlanning = actsOnSelection && sourceSurface === 'planning' && String(fallbackIssueType || '').toLowerCase() === 'story';
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

    // Warm the options before the click lands: a mouse that rests on the pill for the dwell is about
    // to open it. Pressing cancels the dwell, so a click never races its own prefetch. The hook skips
    // cached, in-flight and over-cap requests.
    const prefetchTimerRef = React.useRef(null);
    const cancelPrefetchDwell = () => {
        window.clearTimeout(prefetchTimerRef.current);
        prefetchTimerRef.current = null;
    };
    const prefetchOptions = () => {
        cancelPrefetchDwell();
        if (!isOpen && !previewDescriptor) onPrefetch?.(issue, fallbackIssueType);
    };
    React.useEffect(() => cancelPrefetchDwell, []);

    const handleTriggerClick = () => {
        if (isOpen) {
            onClose?.();
            if (previewDescriptor) {
                onPreviewLifecycleChange?.(previewDescriptor, { state: 'closed', reason: 'same_trigger' });
            }
        } else {
            onOpen?.(issue, fallbackIssueType);
            if (previewDescriptor) {
                onPreviewLifecycleChange?.(previewDescriptor, { state: 'loading', reason: '' });
            }
        }
    };

    const handleOptionClick = (targetStatus) => {
        if (optionDisabled) return;
        onSubmit?.(targetStatus);
    };

    return (
        <span className="status-transition" ref={fieldRef}>
            <StatusPill
                interactive
                className={statusClassName}
                label={statusLabel}
                status={statusLabel}
                onClick={handleTriggerClick}
                onPointerEnter={(event) => {
                    if (event.pointerType === 'mouse' && onPrefetch) prefetchTimerRef.current = window.setTimeout(prefetchOptions, PREFETCH_HOVER_DWELL_MS);
                }}
                onPointerLeave={cancelPrefetchDwell}
                onPointerDown={cancelPrefetchDwell}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                data-status-transition-trigger="true"
                data-onboarding-target="editing-status"
                data-issue-key={issueKey}
                data-issue-kind={String(fallbackIssueType || '').toLowerCase()}
                data-onboarding-target-identity={targetIdentity}
                disabled={submitting && !isOpen}
            />
            {isOpen && (
                <IssueFieldOptionMenu
                    blockClass="status-transition"
                    issueKey={issueKey}
                    menuLabel={submitLabel}
                    loading={optionsLoading}
                    loadingLabel="Loading status options..."
                    error={showTooManyMessage ? TOO_MANY_ISSUES_MESSAGE : (error || '')}
                    errorTooMany={showTooManyMessage}
                    showEmpty={!isServerTooMany && targetStatuses.length === 0}
                    emptyLabel="No available transitions."
                    options={isServerTooMany ? [] : targetStatuses}
                    optionKey={(entry) => entry.name}
                    optionLabel={optionLabel}
                    renderMarker={(entry) => {
                        const background = statusStyle(entry.name)?.background;
                        return (
                            <span
                                className={getIssueStatusClassName(entry.name, 'status-transition-option-marker')}
                                style={background ? { background } : undefined}
                                aria-hidden="true"
                            />
                        );
                    }}
                    onSelect={(entry) => { if (!previewDescriptor) handleOptionClick(entry.name); }}
                    disabled={optionDisabled}
                    result={result ? resultMessage(result) : ''}
                    onEscape={(reason) => {
                        onClose?.();
                        if (previewDescriptor) {
                            onPreviewLifecycleChange?.(previewDescriptor, { state: 'closed', reason: reason || 'escape' });
                        }
                    }}
                    dismissRef={fieldRef}
                    portalTarget={portalTarget}
                    previewOnly={previewDescriptor}
                    onPreviewLifecycleChange={onPreviewLifecycleChange}
                />
            )}
        </span>
    );
}
