import * as React from 'react';
import { createPortal } from 'react-dom';
import EpicHeaderValueReadout from './EpicHeaderValueReadout.jsx';
import IconButton from '../ui/IconButton.jsx';
import PersonAvatar from '../ui/PersonAvatar.jsx';
import PlanningAssigneeAddPicker from './PlanningAssigneeAddPicker.jsx';
import usePlanningAssigneeCapacity from './usePlanningAssigneeCapacity.js';
export { getAssigneeCapacityController } from './usePlanningAssigneeCapacity.js';
import { projectPlanningOriginals } from './engIssueEditState.js';
import { createStripRowModeSync } from './planningRowModeChannel.js';
import {
    applyChangesToDocument, assigneeAvatarUrls, assigneeRowColor, capacityMark, capacityMarkText, effectivePlanned, buildAssigneeColorMap, buildAssigneeRows, formatHundredths, handlesUndoKey, hiddenSelectedCount, isUndoShortcut, teamTasks,
    numberStringToHundredths, plannedCapacityTotal, validateCellDraft,
} from './planningAssigneeCapacityModel.js';

const HOST_ID = 'planning-assignee-capacity-host';
// The strip's own preference (the UI-prefs object is rewritten from App state). The pre-release key
// `jep.planningAssigneeCapacityExpanded` is not read: it never shipped, so the strip simply starts collapsed once.
export const EXPANDED_KEY = 'jira_dashboard_planning_assignee_capacity_v1';
const readExpanded = () => { try { return JSON.parse(window.localStorage.getItem(EXPANDED_KEY) || 'null')?.expanded === true; } catch { return false; } };
const writeExpanded = expanded => { try { window.localStorage.setItem(EXPANDED_KEY, JSON.stringify({ expanded })); } catch { /* storage unavailable */ } };

// Avatars of people added from the search this page session, by account id (the search result's allowlisted URL), so an
// added row shows its photo until reload; a loaded Story's assignee photo wins. Nothing is stored.
const addedAvatarUrls = new Map();

export const PlanningAssigneeCapacityContext = React.createContext(null);
export const usePlanningAssigneeCapacityView = () => React.useContext(PlanningAssigneeCapacityContext);

// One text cell: Enter or blur commits, Escape cancels, an invalid draft stays with its error and is never sent.
function CapacityInput({ field, label, value, disabled, maxLength, onCommit, editors }) {
    const shown = value ?? '';
    const [draft, setDraft] = React.useState(shown);
    const [error, setError] = React.useState('');
    const ref = React.useRef(null);
    const cancelled = React.useRef(false);
    const latest = React.useRef({});
    latest.current = { draft, shown, error, onCommit };
    // A new shown value (a save, a re-read or an Undo) replaces the draft unless the focused cell holds an edit of its own.
    const previousShown = React.useRef(shown);
    React.useEffect(() => {
        const before = previousShown.current;
        previousShown.current = shown;
        if (!latest.current.error && (document.activeElement !== ref.current || latest.current.draft === before)) setDraft(shown);
    }, [shown]);
    const commit = () => {
        const { draft: text, shown: current, onCommit: send } = latest.current;
        if (cancelled.current) { cancelled.current = false; return true; }
        if (text === current) { setError(''); return true; }
        const result = validateCellDraft(field, text);
        if (!result.ok) { setError(result.error); return false; }
        setError('');
        setDraft(result.value ?? '');
        send(field, result.value);
        return true;
    };
    const commitRef = React.useRef(commit);
    commitRef.current = commit;
    React.useEffect(() => {
        // Collapsing the strip or leaving the Team commits an open edit first; an invalid draft is dropped.
        const editor = () => { if (latest.current.draft !== latest.current.shown) commitRef.current(); };
        editors.add(editor);
        return () => { editors.delete(editor); editor(); };
    }, [editors]);
    return <>
        <input ref={ref} className={`planning-review-input${error ? ' invalid' : ''}`} type="text" inputMode={field === 'notes' ? 'text' : 'decimal'}
            aria-label={label} aria-invalid={Boolean(error)} maxLength={maxLength} value={draft} disabled={disabled}
            onChange={event => { setDraft(event.target.value); setError(''); }}
            onBlur={() => commit()}
            onKeyDown={event => {
                // A cell mid-edit keeps Cmd/Ctrl+Z for the input's own native undo; the table's Undo never sees it.
                if (isUndoShortcut(event) && (latest.current.draft !== latest.current.shown || latest.current.error)) { event.stopPropagation(); return; }
                if (event.key === 'Enter') { if (commit()) ref.current.blur(); }
                else if (event.key === 'Escape') { cancelled.current = true; setDraft(shown); setError(''); ref.current.blur(); }
            }} />
        {error && <span className="planning-review-validation" role="alert">{error}</span>}
    </>;
}

const cueClass = cue => (cue === 'over' ? ' planning-assignee-over' : cue === 'under' ? ' planning-assignee-under' : '');
const cueText = cue => (cue === 'over' ? 'over capacity' : cue === 'under' ? 'under capacity' : '');
const fmt = hundredths => formatHundredths(hundredths);

function EffortCell({ hundredths, cue }) {
    return <td className={`planning-review-storyPoints${cueClass(cue)}`}>{fmt(hundredths)}{cue && <span className="planning-review-sr-only"> ({cueText(cue)})</span>}</td>;
}

// The Totals row's Planned capacity (#323): the people's sum out of the team number when one is known. Above it, the cell
// takes the over cue's tone and its text becomes a native button with the marks' transient in-app readout (hover,
// focus-visible or tap; a mouse click pins nothing); display only, it writes nothing and gates no edit.
function PlannedTotalCell({ hundredths, teamCapacity }) {
    const { text, over } = plannedCapacityTotal(hundredths, teamCapacity);
    if (!over) return <td className="planning-review-storyPoints">{text}</td>;
    return <td className={`planning-review-storyPoints${cueClass('over')}`}>
        <EpicHeaderValueReadout value={over} alwaysOn transient>
            {({ triggerRef, pointerProps, focusProps, pinProps }) => <button ref={triggerRef} type="button" className="planning-review-text-button" aria-label={over} {...pointerProps} {...focusProps} {...pinProps}>{text}</button>}
        </EpicHeaderValueReadout>
    </td>;
}

// The leading mark slot of every name cell (#323): one fixed width on every row, Unassigned included, so avatars and
// names stay aligned. A person with Planned capacity set gets a mark when effort is within 20% of it (on plan: a rounded
// `--good` square with a check) or more than 20% above it (over: two bold rounded exclamation marks in `--warn`); spare
// capacity gets none. The mark is the derived-column marker kind (a native button with the in-app readout on hover,
// focus-visible or tap; in `transient` mode a mouse or pen click neither pins it nor focuses the mark) and writes
// nothing. The icons follow the app's inline-SVG icon style (24-unit viewBox, currentColor, round caps and joins), so
// every engine paints them alike; they only resemble the emoji, no emoji font is involved.
const MARK_ICONS = {
    'on-plan': <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <rect x="2" y="2" width="20" height="20" rx="5.5" fill="currentColor" />
        <path d="M7.2 12.4l3.3 3.3 6.4-7" style={{ stroke: 'var(--bg-secondary)' }} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>,
    over: <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M8 4.2v9.6M16 4.2v9.6" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <circle cx="8" cy="19.4" r="2.3" fill="currentColor" />
        <circle cx="16" cy="19.4" r="2.3" fill="currentColor" />
    </svg>,
};

function MarkSlot({ row }) {
    const capacity = row ? numberStringToHundredths(row.capacity) : null;
    const mark = row ? capacityMark(capacity, row.selectedHundredths) : null;
    if (!mark) return <span data-assignee-mark="" aria-hidden="true" />;
    const sentence = capacityMarkText(mark, capacity, row.selectedHundredths);
    return <span data-assignee-mark="" data-mark={mark}>
        <EpicHeaderValueReadout value={sentence} alwaysOn transient>
            {({ triggerRef, pointerProps, focusProps, pinProps }) => <button ref={triggerRef} type="button" className="planning-review-derived-marker" aria-label={sentence} {...pointerProps} {...focusProps} {...pinProps}>
                <span>{MARK_ICONS[mark]}</span>
            </button>}
        </EpicHeaderValueReadout>
    </span>;
}

function PersonRow({ row, color, avatarUrl, readOnly, onCommit, editors }) {
    const input = (field, label, maxLength) => <CapacityInput field={field} label={`${label} for ${row.name}`} value={row[field]} disabled={readOnly} maxLength={maxLength} editors={editors} onCommit={(name, value) => onCommit(row.key, name, value)} />;
    return <tr data-assignee-key={row.key} className={color ? 'planning-assignee-tinted' : undefined} style={color ? { '--planning-assignee-color': color } : undefined}>
        <td className="planning-assignee-name"><div className="planning-assignee-person">
            <MarkSlot row={row} />
            {/* The issue card's person slot: the Story assignee's photo when loaded, else its person glyph. */}
            <span className="task-assignee-icon" aria-hidden="true">
                <PersonAvatar avatarUrl={avatarUrl}>
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Z" stroke="currentColor" strokeWidth="1.6"/>
                        <path d="M4 20c1.8-4 6-5.5 8-5.5S18.2 16 20 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                </PersonAvatar>
            </span>
            <EpicHeaderValueReadout value={row.name}>{({ discoveryProps }) => <span {...discoveryProps} className="planning-review-truncated-value">{row.name}</span>}</EpicHeaderValueReadout>
            {row.removable && !readOnly && <IconButton size="sm" className="planning-review-column-action" aria-label={`Remove ${row.name}`} onClick={() => onCommit(row.key, 'removed', true)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
            </IconButton>}
        </div></td>
        <td className={`planning-review-storyPoints${row.inherited ? ' planning-assignee-inherited' : ''}`}>{input('capacity', 'Capacity', 8)}</td>
        <EffortCell hundredths={row.selectedHundredths} cue={row.cue} />
        <td className="planning-review-storyPoints">{input('vacations', 'Vacations', 8)}</td>
        <td className="planning-assignee-note">
            <EpicHeaderValueReadout value={row.notes || ''} suppressed={!row.notes} measureSelector="input" nativeSelector="input">
                {({ discoveryProps }) => <span {...discoveryProps} tabIndex={undefined} className="planning-review-truncated-value">{input('notes', 'Notes', 500)}</span>}
            </EpicHeaderValueReadout>
        </td>
    </tr>;
}

function AssigneeTable({ view, avatars, state, readOnly, onCommit, onRestore, onRetry, onDiscard, onUndo, editors, sprintName, hiddenSelected, tinted, addPicker, teamCapacity }) {
    const { rows, removed, unassigned, totals, inheritedFromSprintId } = view;
    const failed = state.save === 'failed';
    const colorMap = React.useMemo(() => buildAssigneeColorMap(rows), [rows]);
    // Cmd/Ctrl+Z inside the table undoes the last edit; default is prevented only when an edit was undone.
    const onKeyDown = event => {
        if (readOnly || !handlesUndoKey(event) || event.currentTarget.querySelector('.planning-review-input.invalid')) return;
        if (onUndo()) event.preventDefault();
    };
    return <>
        {inheritedFromSprintId && <p className="planning-review-guidance">Inherited from {sprintName(inheritedFromSprintId) || 'an earlier Sprint'}. Editing any value saves this Sprint's own copy.</p>}
        {state.undoKept && !inheritedFromSprintId && <p className="planning-review-guidance" data-assignee-undo-kept>Undo kept this Sprint's own copy with the inherited values.</p>}
        {hiddenSelected > 0 && <p className="planning-review-guidance" data-assignee-filter-hidden>{hiddenSelected} selected {hiddenSelected === 1 ? 'Story of this Team is' : 'Stories of this Team are'} hidden by filters and not counted in Estimated effort.</p>}
        <table className="planning-review-table planning-assignee-table" aria-label="Assignee capacity" onKeyDown={onKeyDown}>
            <thead><tr>
                <th className="planning-assignee-name">Assignee</th>
                <th className="planning-review-storyPoints">Planned capacity</th>
                <th className="planning-review-storyPoints">Estimated effort</th>
                <th className="planning-review-storyPoints">Vacations</th>
                <th className="planning-assignee-note">Notes</th>
            </tr></thead>
            <tbody>
                {unassigned && <tr className="planning-review-zero-sp" data-assignee-key="unassigned">
                    {/* An empty person slot keeps the name in line with the person names; no glyph, as the row is no person. */}
                    <td className="planning-assignee-name"><div className="planning-assignee-person"><MarkSlot row={null} /><span className="task-assignee-icon" aria-hidden="true" /><span className="planning-review-truncated-value">Unassigned</span></div></td>
                    <td className="planning-review-storyPoints" />
                    <EffortCell hundredths={unassigned.selectedHundredths} />
                    <td className="planning-review-storyPoints" />
                    <td className="planning-assignee-note" />
                </tr>}
                {rows.map(row => <PersonRow key={row.key} row={row} color={tinted ? assigneeRowColor(row, colorMap) : null} avatarUrl={avatars.get(row.key)} readOnly={readOnly} onCommit={onCommit} editors={editors} />)}
            </tbody>
            <tfoot><tr>
                <td className="planning-assignee-name">Total</td>
                <PlannedTotalCell hundredths={totals.capacityHundredths} teamCapacity={teamCapacity} />
                <EffortCell hundredths={totals.selectedHundredths} cue={totals.cue} />
                <td className="planning-review-storyPoints">{fmt(totals.vacationsHundredths)}</td>
                <td className="planning-assignee-note" />
            </tr></tfoot>
        </table>
        {addPicker && <p className="planning-review-guidance">{addPicker}</p>}
        {removed.length > 0 && !readOnly && <p className="planning-review-guidance planning-assignee-removed">
            Removed from this Sprint and later ones:{' '}
            {removed.map((person, index) => <span key={person.key}>
                <button type="button" className="planning-review-text-button" aria-label={`Restore ${person.name}`} onClick={() => onRestore(person.key)}>{person.name}</button>{index < removed.length - 1 && ','}
            </span>)}
        </p>}
        {failed && <p className="planning-review-guidance" role="alert" data-assignee-save-failed>Not saved: {state.error || 'Assignee capacity could not be saved.'}{' '}
            <button type="button" className="planning-action-button" onClick={onRetry}>Retry</button>{' '}
            <button type="button" className="planning-action-button" onClick={onDiscard}>Discard changes</button>
        </p>}
    </>;
}

// Wraps the Planning overview: holds the assignee capacity state for one selected Team and renders the in-flow strip
// into the host element after the controls stack. Cards, bar and every other slot are untouched.
export default function PlanningAssigneeCapacity({
    children, enabled, selectedTeamIds, allTeams, sprintId, sprintClosed, sprints, backendUrl, tasks, originals, selectedTasks,
    getTeamInfo, normalizeStatus, rawCapacity = null, capacitySource = '', selectedKeys = null, automaticRefreshRef = null,
}) {
    const oneTeam = Boolean(enabled && !allTeams && selectedTeamIds?.size === 1);
    const teamId = oneTeam ? String([...selectedTeamIds][0]) : '';
    const [expanded, setExpanded] = React.useState(readExpanded);
    // The table mounts on the first expansion and then stays (hidden while collapsed); the data does not wait for it.
    const [opened, setOpened] = React.useState(expanded);
    const [host, setHost] = React.useState(null);
    React.useLayoutEffect(() => { setHost(document.getElementById(HOST_ID)); });
    // D6: the document is read whenever one Team is selected (the pinned bar's strip needs it), expanded or not.
    const { state, controller } = usePlanningAssigneeCapacity({ backendUrl, sprintId: sprintId ? String(sprintId) : '', teamId, active: oneTeam });
    const editors = React.useRef(new Set()).current;
    const normalizeRef = React.useRef(normalizeStatus), teamInfoRef = React.useRef(getTeamInfo);
    normalizeRef.current = normalizeStatus; teamInfoRef.current = getTeamInfo;

    const projected = React.useMemo(() => projectPlanningOriginals(tasks, originals), [tasks, originals]);
    // The team's Stories in scope ("has Stories" and the Unassigned row), keyed on the loaded tasks and the Team only, so a
    // selection toggle never rebuilds it.
    const teamList = React.useMemo(() => (oneTeam ? teamTasks(projected, { teamId, getTeamInfo: task => teamInfoRef.current(task), normalizeStatus: status => normalizeRef.current(status) }) : []), [projected, teamId, oneTeam]);
    const [addedAvatars, setAddedAvatars] = React.useState(0);
    const avatars = React.useMemo(() => {
        const urls = assigneeAvatarUrls(projected);
        addedAvatarUrls.forEach((url, key) => { if (!urls.has(key)) urls.set(key, url); });
        return urls;
    }, [projected, addedAvatars]);
    const effective = React.useMemo(() => applyChangesToDocument(state.document, state.changes), [state.document, state.changes]);
    const view = React.useMemo(() => buildAssigneeRows({ document: effective, teamTasksList: teamList, selectedTasks: selectedTasks || [], ignoreInherited: sprintClosed }), [effective, teamList, selectedTasks, sprintClosed]);
    const shownRef = React.useRef(null);
    shownRef.current = document => {
        const result = buildAssigneeRows({ document, teamTasksList: teamList, selectedTasks: selectedTasks || [], ignoreInherited: sprintClosed });
        return { rows: result.rows, removedKeys: result.removed.map(person => person.key) };
    };
    const onCommit = React.useCallback((key, field, value) => { controller.commit({ key, field, value }, document => shownRef.current(document)); }, [controller]);
    const onRestore = React.useCallback(key => onCommit(key, 'removed', false), [onCommit]);
    // Add assignee: a new person is a row with the result's name snapshot; a removed one is restored; an existing row is focused.
    const onAdd = React.useCallback(person => {
        if (person.avatarUrl && addedAvatarUrls.get(person.accountId) !== person.avatarUrl) {
            addedAvatarUrls.set(person.accountId, person.avatarUrl);
            setAddedAvatars(count => count + 1);
        }
        if (controller.addPerson(person, document => shownRef.current(document)) !== 'exists' || !host) return;
        requestAnimationFrame(() => host.querySelector(`tr[data-assignee-key="${CSS.escape(person.accountId)}"] input`)?.focus());
    }, [controller, host]);
    const onRetry = React.useCallback(() => controller.retry(), [controller]);
    const onDiscard = React.useCallback(() => controller.discard(), [controller]);
    const onUndo = React.useCallback(() => controller.undo(), [controller]);
    const sprintName = React.useCallback(id => (sprints || []).find(sprint => String(sprint.id) === String(id))?.name, [sprints]);
    // Collapsing commits an open edit first and persists the preference, from the toggle or from the rows rule below.
    const collapse = () => { [...editors].forEach(editor => editor()); setExpanded(false); writeExpanded(false); };
    const collapseRef = React.useRef(collapse);
    collapseRef.current = collapse;
    // Epics selected -> strip collapsed; expanding the strip from its header -> Stories selected (#323).
    const rowSync = React.useMemo(() => createStripRowModeSync({ collapse: () => collapseRef.current() }), []);
    const toggle = () => {
        if (expanded) { collapse(); rowSync.setOpen(false); return; }
        setExpanded(true); writeExpanded(true); setOpened(true);
        rowSync.setOpen(true, { byUser: true });
    };
    const hiddenSelected = React.useMemo(() => hiddenSelectedCount(teamList, selectedKeys, selectedTasks), [teamList, selectedKeys, selectedTasks]);
    const loaded = Boolean(state.document);
    // The Planning freshness follow-up and the header Refresh re-read the shown document through this entry (#251).
    React.useEffect(() => {
        if (!automaticRefreshRef || !oneTeam || !loaded) return undefined;
        const entry = { refresh: options => controller.refresh(options), blocked: () => controller.isBusy() };
        automaticRefreshRef.assigneeCapacity = entry;
        return () => { if (automaticRefreshRef.assigneeCapacity === entry) automaticRefreshRef.assigneeCapacity = null; };
    }, [automaticRefreshRef, oneTeam, loaded, controller]);
    // The strip sits above the sheet, outside its reading anchor: when an automatic re-read changes its height while it is
    // scrolled away above the sticky stack, scroll by what the content below it actually moved (native scroll anchoring
    // may already have moved it back). The strip's bottom is read when the controller publishes, before React commits.
    const readingBottom = React.useRef(null);
    React.useEffect(() => controller.subscribe(() => {
        readingBottom.current = host && controller.getState().origin === 'automatic' ? host.getBoundingClientRect().bottom : null;
    }), [controller, host]);
    React.useLayoutEffect(() => {
        const previous = readingBottom.current;
        readingBottom.current = null;
        if (!host || state.origin !== 'automatic' || previous == null) return;
        const visibleTop = Math.max(0, document.querySelector('.planning-review-sticky-stack')?.getBoundingClientRect().bottom || 0);
        const shift = host.getBoundingClientRect().bottom - previous;
        if (previous <= visibleTop && Math.abs(shift) >= 1) window.scrollBy(0, shift);
    }, [host, state]);
    // Only people with an underbar segment (Estimated effort above 0) are tinted, and the strip exists only with a team
    // number (Jira or stored).
    const tinted = Number(rawCapacity) > 0;
    // The stored team number as shown (own, gray inherited or pending), for the team card's editor and reconcile banner.
    const planned = React.useMemo(() => effectivePlanned(effective), [effective]);
    const context = React.useMemo(() => ({ oneTeam, teamId, view, state, loaded, rawCapacity, capacitySource, planned, controller }), [oneTeam, teamId, view, state, loaded, rawCapacity, capacitySource, planned, controller]);

    const readOnly = !state.capabilities.canSave;
    const hidden = state.load === 'ready' && !state.capabilities.canRead;
    const empty = !view.rows.length && !view.unassigned && !view.removed.length;
    const status = state.save === 'saving' ? 'Saving…' : state.save === 'saved' ? 'Saved' : state.save === 'failed' ? 'Not saved' : '';
    const addPicker = readOnly ? null : <PlanningAssigneeAddPicker backendUrl={backendUrl} onAdd={onAdd} />;
    // The table (and with it the header's Undo) shows once the document is loaded and holds a row, a person or a removal.
    const showTable = opened && state.load !== 'error' && Boolean(state.document) && !empty;
    let body = null;
    if (opened) {
        if (state.load === 'error') body = <p className="planning-review-guidance" role="alert">Assignee capacity could not be loaded. <button type="button" className="planning-action-button" onClick={() => controller.reload()}>Retry</button></p>;
        else if (!state.document) body = <p className="planning-review-guidance" role="status">Loading assignee capacity…</p>;
        else if (empty) body = <p className="planning-review-guidance">No Stories or saved people for this Team in this Sprint.{addPicker && <> {addPicker}</>}</p>;
        else body = <>
            {readOnly && <p className="planning-review-guidance">Assignee capacity is read-only here.</p>}
            <AssigneeTable view={view} avatars={avatars} state={state} readOnly={readOnly} onCommit={onCommit} onRestore={onRestore} onRetry={onRetry} onDiscard={onDiscard} onUndo={onUndo} editors={editors} sprintName={sprintName} hiddenSelected={hiddenSelected} tinted={tinted} addPicker={addPicker} teamCapacity={rawCapacity} />
        </>;
    }
    const open = Boolean(oneTeam && !hidden && host && expanded);
    React.useLayoutEffect(() => rowSync.connect(), [rowSync]);
    React.useLayoutEffect(() => { rowSync.setOpen(open); }, [rowSync, open]);
    const strip = oneTeam && !hidden && host ? createPortal(
        <div className={`capacity-panel open${expanded ? '' : ' capacity-panel-collapsed'}`} data-assignee-capacity>
            <div className="capacity-header">
                <button type="button" className="capacity-header capacity-header-toggle" aria-expanded={expanded} aria-controls="planning-assignee-capacity-body" onClick={toggle}>
                    <span className="capacity-title">Assignee Capacity (Story Points)<span className="capacity-panel-caret" aria-hidden="true">▸</span></span>
                    <span className="capacity-subtitle" role="status" data-save-state={state.save}>{status}</span>
                </button>
                {expanded && showTable && !readOnly && <button type="button" className="planning-action-button" disabled={!state.undoCount} onClick={() => onUndo()}>Undo</button>}
            </div>
            <div id="planning-assignee-capacity-body" className="capacity-grid-wrapper" key={`${sprintId}|${teamId}`}>{body}</div>
        </div>, host) : null;
    return <PlanningAssigneeCapacityContext.Provider value={context}>{children}{strip}</PlanningAssigneeCapacityContext.Provider>;
}
