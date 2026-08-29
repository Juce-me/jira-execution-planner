import * as React from 'react';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import StatusPill from '../ui/StatusPill.jsx';
import StatusTransitionMenu from '../issues/StatusTransitionMenu.jsx';
import PriorityTransitionMenu from '../issues/PriorityTransitionMenu.jsx';
import ProjectTrackTransitionMenu from '../issues/ProjectTrackTransitionMenu.jsx';
import { getIssueStatusClassName } from '../issues/issueViewUtils.js';
import { formatSubtaskUpdatedDate } from '../issues/subtaskProgressUtils.js';
import { epicStatusName, getProjectTrackEmoji, getProjectTrackLabel } from './engTaskUtils.js';
import { epicPriorityName } from './engBoardColumns.js';
import { computeEpicStoryProgress } from './engBoardCardModel.js';
import { loadEpicDescription } from './engEpicDescriptionCache.js';
import {
    DEFAULT_PANEL_SORT,
    PANEL_SORT_OPTIONS,
    buildPanelStatusOrder,
    panelSortLabel,
    sortPanelStories,
} from './engBoardPanelStories.js';

// §6.3 — the epic detail panel. Layout and geometry are lifted from the approved asset
// (docs/plans/assets/eng-group-board/board.html: .m-head/.m-eyebrow/.m-controls/.m-title/.m-body/
// .m-desc/.m-sec). Two deliberate departures from the asset's own class names:
//
//   - the asset's `.backdrop`/`.modal` are generic enough to collide inside the app's single
//     dashboard.css, so this uses the app's existing grammar, `<thing>-modal-backdrop`/`<thing>`
//     (settings/modal-shell.css) as .epic-panel-backdrop/.epic-panel, and the app's
//     --modal-backdrop-z token rather than the asset's literal 9000;
//   - the sort control is the app's own dropdown (`.sprint-dropdown.sprint-dropdown-compact`,
//     exactly as EngView.jsx renders the ENG epic Sort), not the asset's bespoke `.sort-*`.
//
// Every EDITABLE control is the app's existing one (D22): PriorityTransitionMenu,
// ProjectTrackTransitionMenu and StatusTransitionMenu, with their own keyboard behaviour. None of
// them is re-implemented here and none is wrapped in a new labelled dropdown.
//
// FOCUS (§10.1): focus moves in on open and is trapped while open; Escape closes. Returning focus
// to the card that opened it belongs to the caller, which owns the card.

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function EngBoardEpicPanel({
    epicGroup,
    columns = [],
    jiraUrl = '',
    backendUrl = '',
    renderPriorityIcon,
    transitionsEnabled = false,
    statusTransitions = null,
    priorityTransitions = null,
    projectTrackTransitions = null,
    statusTransitionSubmitting = false,
    onSubmitStatusTransition,
    onClose,
}) {
    const epic = (epicGroup && epicGroup.epic) || {};
    const epicKey = (epicGroup && epicGroup.key) || epic.key || '';
    const summary = epic.summary || epicKey;
    const tasks = (epicGroup && epicGroup.tasks) || [];
    const progress = computeEpicStoryProgress(tasks);
    const storyPoints = (((epicGroup && epicGroup.storyPoints) || 0)).toFixed(1);
    const titleId = `epic-panel-title-${epicKey}`;

    const panelRef = React.useRef(null);
    const sortHostRef = React.useRef(null);
    const descBodyRef = React.useRef(null);

    const [sort, setSort] = React.useState(DEFAULT_PANEL_SORT);
    const [sortOpen, setSortOpen] = React.useState(false);
    const [expanded, setExpanded] = React.useState(false);
    const [overflows, setOverflows] = React.useState(false);
    // §9.2's four states, as one value rather than three booleans that can disagree.
    const [description, setDescription] = React.useState({ status: 'loading' });
    const descriptionRef = React.useRef(description);
    descriptionRef.current = description;
    const [attempt, setAttempt] = React.useState(0);

    const statusOrder = React.useMemo(() => buildPanelStatusOrder(columns), [columns]);
    const rows = React.useMemo(
        () => sortPanelStories(tasks, { sort, statusOrder }),
        [tasks, sort, statusOrder],
    );

    // Lazily, one issue per opened panel, through the session cache — so a second open of the
    // same epic issues no request at all (§9.2). The rest of the panel is already populated from
    // data.epics and never waits on this.
    React.useEffect(() => {
        let cancelled = false;
        const previousDescription = descriptionRef.current;
        setDescription({ status: 'loading' });
        loadEpicDescription(backendUrl, { key: epicKey })
            .then((payload) => {
                if (cancelled) return;
                setDescription(payload?.isEmpty
                    ? { status: 'empty' }
                    : { status: 'loaded', html: String(payload?.html || '') });
            })
            .catch((error) => {
                if (cancelled) return;
                if (isAuthenticationRequiredError(error)) {
                    setDescription(previousDescription);
                    return;
                }
                setDescription({ status: 'error', message: error?.message || 'Could not load the description.' });
            });
        return () => { cancelled = true; };
    }, [backendUrl, epicKey, attempt]);

    // Only offer "Show full description" when the body is actually taller than the clamp — an
    // affordance that reveals nothing is the dead control this plan calls a review stop. Measured
    // while clamped; once expanded the control stays so the reader can collapse again. A table
    // clipped by that same boundary is removed from sequential keyboard order until it is visible.
    React.useLayoutEffect(() => {
        const node = descBodyRef.current;
        if (!node || description.status !== 'loaded') return;
        if (!expanded) setOverflows(node.scrollHeight > node.clientHeight + 1);
        const bodyRect = node.getBoundingClientRect();
        node.querySelectorAll('.adf-table-scroll').forEach((tableScroller) => {
            const tableRect = tableScroller.getBoundingClientRect();
            const fullyVisible = (
                tableRect.top >= bodyRect.top - 1
                && tableRect.bottom <= bodyRect.bottom + 1
            );
            tableScroller.tabIndex = expanded || fullyVisible ? 0 : -1;
        });
    }, [description, expanded, overflows]);

    // §10.1: focus moves to the panel on open. The panel itself takes it, so a screen reader
    // announces the dialog rather than landing on whichever control happens to come first.
    React.useEffect(() => {
        panelRef.current?.focus();
    }, []);

    React.useEffect(() => {
        if (!sortOpen) return undefined;
        const onDocPointerDown = (event) => {
            if (sortHostRef.current && !sortHostRef.current.contains(event.target)) setSortOpen(false);
        };
        document.addEventListener('mousedown', onDocPointerDown);
        return () => document.removeEventListener('mousedown', onDocPointerDown);
    }, [sortOpen]);

    // Escape dismisses the innermost thing that is open. IssueFieldOptionMenu already stops Escape
    // propagating while focus is INSIDE the menu, but the menu opens with focus still on its
    // trigger until its options arrive — and Escape on the trigger bubbles here, where closing the
    // whole dialog would be the wrong answer. So an open menu is closed through its own hook's
    // close handler; nothing about the menus' keyboard behaviour is re-implemented.
    const MENU_CLOSERS = [
        ['.status-transition-menu', () => statusTransitions?.closeSingleIssueStatusControl?.()],
        ['.priority-transition-menu', () => priorityTransitions?.closePriorityControl?.()],
        ['.project-track-transition-menu', () => projectTrackTransitions?.closeProjectTrackControl?.()],
    ];

    // Escape and the Tab cycle are handled on the panel, NOT on the document, so an inner
    // component that stops propagation keeps winning.
    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            if (sortOpen) {
                setSortOpen(false);
                return;
            }
            const openMenu = MENU_CLOSERS.find(([selector]) => panelRef.current?.querySelector(selector));
            if (openMenu) {
                openMenu[1]();
                return;
            }
            onClose?.();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) || [])
            .filter((node) => node.offsetParent !== null || node === document.activeElement);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === panelRef.current)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };

    const statusLabel = epicStatusName(epic) || 'Unknown';
    const priorityLabel = epicPriorityName(epic);
    const trackValue = epic.projectTrack || '';
    const initiative = epic.initiative && epic.initiative.summary;

    const renderStoryStatus = (task) => {
        const name = task?.fields?.status?.name || 'Unknown';
        const className = getIssueStatusClassName(name);
        if (!transitionsEnabled || !statusTransitions) {
            return <StatusPill className={className} label={name} />;
        }
        return (
            <StatusTransitionMenu
                issue={task}
                fallbackIssueType="Story"
                statusLabel={name}
                statusClassName={className}
                sourceSurface="board"
                isOpen={statusTransitions.activeSingleIssueTarget?.key === task.key}
                options={statusTransitions.transitionOptions}
                optionsLoading={statusTransitions.transitionOptionsLoading}
                submitting={statusTransitionSubmitting || !!statusTransitions.pendingIssueKeys?.has(task.key)}
                error={statusTransitions.transitionError}
                errorCode={statusTransitions.transitionErrorCode}
                result={statusTransitions.transitionResult}
                onOpen={statusTransitions.openSingleIssueStatusControl}
                onClose={statusTransitions.closeSingleIssueStatusControl}
                onSubmit={(targetStatus) => onSubmitStatusTransition?.(targetStatus, task)}
                portalTarget={panelRef.current}
            />
        );
    };

    const renderPriorityControl = (issue, kind, label) => {
        if (!transitionsEnabled || !priorityTransitions) {
            return renderPriorityIcon ? renderPriorityIcon(label, issue.key) : null;
        }
        return (
            <PriorityTransitionMenu
                issue={issue}
                fallbackIssueType={kind}
                priorityLabel={label}
                renderPriorityIcon={renderPriorityIcon}
                isOpen={priorityTransitions.activePriorityTarget?.key === issue.key}
                options={priorityTransitions.priorityOptions}
                optionsLoading={priorityTransitions.priorityOptionsLoading}
                submitting={priorityTransitions.prioritySubmitting
                    || !!priorityTransitions.pendingIssueKeys?.has(issue.key)}
                error={priorityTransitions.priorityError}
                result={priorityTransitions.priorityResult}
                onOpen={priorityTransitions.openPriorityControl}
                onClose={priorityTransitions.closePriorityControl}
                onSubmit={priorityTransitions.submitPriorityChange}
            />
        );
    };

    return (
        <div
            className="epic-panel-backdrop"
            onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
        >
            <div
                className="epic-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                ref={panelRef}
                onKeyDown={handleKeyDown}
            >
                <div className="m-head">
                    <div className="m-eyebrow">
                        <span>{epicKey}</span>
                        {initiative && <span aria-hidden="true">·</span>}
                        {initiative && <span>Initiative: {initiative}</span>}
                        {jiraUrl && (
                            <a href={`${jiraUrl}/browse/${epicKey}`} target="_blank" rel="noopener noreferrer">
                                Open in Jira ↗
                            </a>
                        )}
                        <button type="button" className="m-close" aria-label="Close" onClick={() => onClose?.()}>
                            ×
                        </button>
                    </div>
                    <div className="m-controls">
                        {renderPriorityControl(
                            { key: epicKey, priority: priorityLabel, summary },
                            'Epic',
                            priorityLabel,
                        )}
                        {(transitionsEnabled && projectTrackTransitions) ? (
                            <ProjectTrackTransitionMenu
                                epicKey={epicKey}
                                currentTrack={trackValue}
                                isOpen={projectTrackTransitions.activeProjectTrackTarget?.key === epicKey}
                                options={projectTrackTransitions.projectTrackOptions}
                                optionsLoading={projectTrackTransitions.projectTrackOptionsLoading}
                                submitting={projectTrackTransitions.projectTrackSubmitting
                                    || !!projectTrackTransitions.pendingProjectTrackIssueKeys?.has(epicKey)}
                                error={projectTrackTransitions.projectTrackError}
                                result={projectTrackTransitions.projectTrackResult}
                                onOpen={projectTrackTransitions.openProjectTrackControl}
                                onClose={projectTrackTransitions.closeProjectTrackControl}
                                onSubmit={projectTrackTransitions.submitProjectTrackChange}
                            />
                        ) : (
                            <span
                                className="epic-track-indicator"
                                title={`Project Track: ${getProjectTrackLabel(trackValue)}`}
                                aria-label={`Project Track: ${getProjectTrackLabel(trackValue)}`}
                            >
                                {getProjectTrackEmoji(trackValue)}
                            </span>
                        )}
                        {(transitionsEnabled && statusTransitions) ? (
                            <StatusTransitionMenu
                                issue={{ key: epicKey, summary, status: epic.status }}
                                fallbackIssueType="Epic"
                                statusLabel={statusLabel}
                                statusClassName={getIssueStatusClassName(statusLabel)}
                                sourceSurface="board"
                                isOpen={statusTransitions.activeSingleIssueTarget?.key === epicKey}
                                options={statusTransitions.transitionOptions}
                                optionsLoading={statusTransitions.transitionOptionsLoading}
                                submitting={statusTransitionSubmitting
                                    || !!statusTransitions.pendingIssueKeys?.has(epicKey)}
                                error={statusTransitions.transitionError}
                                errorCode={statusTransitions.transitionErrorCode}
                                result={statusTransitions.transitionResult}
                                onOpen={statusTransitions.openSingleIssueStatusControl}
                                onClose={statusTransitions.closeSingleIssueStatusControl}
                                onSubmit={(targetStatus) => onSubmitStatusTransition?.(targetStatus, { key: epicKey })}
                                portalTarget={panelRef.current}
                            />
                        ) : (
                            <StatusPill className={getIssueStatusClassName(statusLabel)} label={statusLabel} />
                        )}
                        <span className="m-sp">
                            {storyPoints} sp · {progress.done} of {progress.total} stories done
                        </span>
                    </div>
                    <h2 className="m-title" id={titleId}>{summary}</h2>
                </div>

                <div className="m-body">
                    <div className={`m-desc${description.status === 'loaded' && !expanded ? ' is-clamped' : ''}`}>
                        {description.status === 'loading' && (
                            <div className="m-desc-skeleton" aria-hidden="true">
                                <span /><span /><span />
                            </div>
                        )}
                        {description.status === 'empty' && (
                            <div className="group-modal-meta">No description</div>
                        )}
                        {description.status === 'error' && (
                            <div className="m-desc-error" role="alert">
                                <span>{description.message}</span>
                                <button type="button" className="m-desc-retry" onClick={() => setAttempt((n) => n + 1)}>
                                    Retry
                                </button>
                            </div>
                        )}
                        {description.status === 'loaded' && (
                            // Server-rendered and escaped by backend/epm/home.py's adf_to_html,
                            // with hrefs allowlisted to https?:/mailto: — the only HTML this app
                            // ever injects, and never raw Jira description markup (§9.2).
                            <div
                                className="m-desc-body"
                                ref={descBodyRef}
                                dangerouslySetInnerHTML={{ __html: description.html }}
                            />
                        )}
                        {description.status === 'loaded' && (overflows || expanded) && (
                            <button
                                type="button"
                                className="m-desc-more"
                                aria-expanded={expanded}
                                onClick={() => setExpanded((wasExpanded) => !wasExpanded)}
                            >
                                {expanded ? 'Show less' : 'Show full description'}
                            </button>
                        )}
                    </div>

                    <div className="m-sec">
                        <div className="m-sec-head">
                            <span className="m-sec-label">Stories in scope</span>
                            <span className="m-sec-label">
                                {rows.length} {rows.length === 1 ? 'story' : 'stories'} · {storyPoints} sp
                            </span>
                            <span className="spacer" />
                            <div
                                className="sprint-dropdown sprint-dropdown-compact epic-panel-sort-dropdown"
                                ref={sortHostRef}
                            >
                                <div
                                    className={`sprint-dropdown-toggle ${sortOpen ? 'open' : ''}`}
                                    role="button"
                                    tabIndex={0}
                                    aria-label="Sort stories"
                                    aria-expanded={sortOpen}
                                    onClick={() => setSortOpen((wasOpen) => !wasOpen)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            setSortOpen((wasOpen) => !wasOpen);
                                        }
                                    }}
                                >
                                    <span className="cap">Sort</span>
                                    <span>{panelSortLabel(sort)}</span>
                                    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M6 9L1 4h10z" /></svg>
                                </div>
                                {sortOpen && (
                                    <div className="sprint-dropdown-panel">
                                        <div className="sprint-dropdown-list">
                                            {PANEL_SORT_OPTIONS.map((option) => (
                                                <div
                                                    key={option.value}
                                                    className={`sprint-dropdown-option ${sort === option.value ? 'selected' : ''}`}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => { setSort(option.value); setSortOpen(false); }}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            setSort(option.value);
                                                            setSortOpen(false);
                                                        }
                                                    }}
                                                >
                                                    {option.label}
                                                </div>
                                            ))}
                                        </div>
                                        {/* Status order is the board's, left to right — stated
                                            here because it is not alphabetical and not obvious. */}
                                        <div className="group-modal-meta">Status follows the board, left to right</div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* .story-subtasks-rows, not .story-subtasks-panel: the panel wrapper adds
                            Catch Up's enter animation and `overflow: hidden`, which would clip a
                            transition menu opened on the last row. The ROW classes — the thing
                            D22 governs — are inherited unchanged. */}
                        <div className="story-subtasks-rows">
                            {rows.map((task) => (
                                <div
                                    key={task.key}
                                    className="story-subtask-row has-priority"
                                    data-story-key={task.key}
                                >
                                    {renderPriorityControl(task, 'Story', task?.fields?.priority?.name || '')}
                                    <a
                                        className="story-subtask-name"
                                        href={jiraUrl ? `${jiraUrl}/browse/${task.key}` : '#'}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {task?.fields?.summary || task.key}
                                    </a>
                                    {renderStoryStatus(task)}
                                    <span className="story-subtask-assignee">
                                        {task?.fields?.assignee?.displayName || 'Unassigned'}
                                    </span>
                                    {task?.fields?.updated ? (
                                        <time className="story-subtask-updated" dateTime={task.fields.updated}>
                                            {formatSubtaskUpdatedDate(task.fields.updated)}
                                        </time>
                                    ) : (
                                        <span className="story-subtask-updated">No update</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
