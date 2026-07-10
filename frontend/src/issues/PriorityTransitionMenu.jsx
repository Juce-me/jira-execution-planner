import * as React from 'react';
import IssueFieldOptionMenu from './IssueFieldOptionMenu.jsx';
import { normalizeIssueStatus } from './issueViewUtils.js';
import { isRecognizedPriorityIconName, sortPriorityOptionsByRank } from '../eng/engPriorityTransitionUtils.js';

// Shared ENG priority-change control used by Catch Up / Planning Story cards and Epic
// headers. Presentational: all catalog/loading/submit state and handlers arrive as props
// from the dashboard priority hook, so this file never imports the priority API or hook.
// The trigger is a native <button> that reuses the exact dashboard priority-icon visual
// (its className, tooltip data-attrs, and SVG), so it keeps the same rendered geometry and
// tooltip while gaining a menu affordance (button reset lives in styles/eng/issues.css).
// Passive surfaces (EPM, Stats, Scenario, Settings open) keep rendering the plain icon at
// the call site instead, so no data-priority-transition-trigger is emitted there.

function priorityResultMessage(result) {
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

export default function PriorityTransitionMenu({
    issue,
    fallbackIssueType = '',
    priorityLabel,
    currentPriorityLabel,
    renderPriorityIcon,
    isOpen = false,
    options = null,
    optionsLoading = false,
    submitting = false,
    error = '',
    result = null,
    onOpen,
    onClose,
    onSubmit,
}) {
    const issueKey = String(issue?.key || '').trim();
    const kind = String(fallbackIssueType || '').toLowerCase();
    // priorityLabel drives the icon. Epic headers render a DERIVED (most-urgent child) priority
    // there, but the field the menu edits — and therefore omits as "current" — is the issue's OWN
    // priority. currentPriorityLabel carries that own value; it defaults to priorityLabel so Story
    // cards (icon === own priority) omit correctly and are unchanged. An explicit '' (issue with no
    // own priority) omits nothing, so every option is a real change.
    const ownPriorityLabel = currentPriorityLabel === undefined ? priorityLabel : currentPriorityLabel;
    const currentPriorityName = normalizeIssueStatus(ownPriorityLabel);

    // Reuse the dashboard priority-icon element as the button's contents/attributes so the
    // interactive trigger keeps its .task-priority-icon classes, tooltip data-attrs, and
    // 16x16 geometry. renderPriorityIcon always returns a <span> (never null) in practice.
    const icon = renderPriorityIcon ? renderPriorityIcon(priorityLabel, issueKey) : null;
    const iconProps = icon?.props || {};

    // Wraps BOTH the trigger and the menu; IssueFieldOptionMenu uses it to scope its
    // outside-click dismissal (an in-wrapper click is never treated as "outside").
    const fieldRef = React.useRef(null);

    // Omit the current priority, mirroring how the status menu omits the current status.
    const priorities = sortPriorityOptionsByRank(options?.priorities)
        .filter((option) => normalizeIssueStatus(option?.name) !== currentPriorityName);

    const handleTriggerClick = () => {
        if (isOpen) {
            onClose?.();
        } else {
            onOpen?.(issue, fallbackIssueType);
        }
    };

    return (
        <span className="priority-transition" ref={fieldRef}>
            <button
                type="button"
                className={iconProps.className || 'task-priority-icon none'}
                data-priority={iconProps['data-priority']}
                data-priority-short={iconProps['data-priority-short']}
                aria-label={iconProps['aria-label'] || priorityLabel || 'None'}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                data-priority-transition-trigger="true"
                data-issue-key={issueKey}
                data-issue-kind={kind}
                onClick={handleTriggerClick}
            >
                {iconProps.children}
            </button>
            {isOpen && (
                <IssueFieldOptionMenu
                    blockClass="priority-transition"
                    issueKey={issueKey}
                    menuLabel="Change priority"
                    loading={optionsLoading}
                    loadingLabel="Loading priority options..."
                    error={error || ''}
                    showEmpty={!optionsLoading && !error && priorities.length === 0}
                    emptyLabel="No other priorities available."
                    options={priorities}
                    optionKey={(option) => option.id}
                    optionLabel={(option) => option.name}
                    renderMarker={(option) => {
                        // Show the app's OWN priority icon (identical to the trigger + task
                        // rows) via renderPriorityIcon, seeded uniquely per option so any
                        // gradient/aria ids stay collision-free. Only for an exotic priority
                        // the app has no icon for AND for which Jira supplied a color do we
                        // fall back to the colored dot, so that color signal is not lost.
                        if (!isRecognizedPriorityIconName(option.name) && option.statusColor) {
                            return (
                                <span
                                    className="priority-transition-option-marker"
                                    style={{ background: option.statusColor }}
                                    aria-hidden="true"
                                />
                            );
                        }
                        return renderPriorityIcon
                            ? renderPriorityIcon(option.name, `${issueKey}-${option.id}`)
                            : null;
                    }}
                    onSelect={(option) => onSubmit?.(option.id, issueKey)}
                    disabled={submitting}
                    result={priorityResultMessage(result)}
                    onEscape={() => onClose?.()}
                    dismissRef={fieldRef}
                />
            )}
        </span>
    );
}
