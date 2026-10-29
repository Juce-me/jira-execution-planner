import * as React from 'react';
import { createPortal } from 'react-dom';
import EpicHeaderValueReadout from './EpicHeaderValueReadout.jsx';
import IconButton from '../ui/IconButton.jsx';
import usePlanningAssigneeCapacity from './usePlanningAssigneeCapacity.js';
import { projectPlanningOriginals } from './engIssueEditState.js';
import {
    applyChangesToDocument, buildAssigneeRows, formatHundredths, mayBeIncomplete, teamTasks, validateCellDraft,
} from './planningAssigneeCapacityModel.js';

const HOST_ID = 'planning-assignee-capacity-host';
const EXPANDED_KEY = 'jep.planningAssigneeCapacityExpanded';
const readExpanded = () => { try { return window.localStorage.getItem(EXPANDED_KEY) === '1'; } catch (_error) { return false; } };
const writeExpanded = expanded => { try { window.localStorage.setItem(EXPANDED_KEY, expanded ? '1' : '0'); } catch (_error) { /* storage unavailable */ } };

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
    React.useEffect(() => { if (document.activeElement !== ref.current && !latest.current.error) setDraft(shown); }, [shown]);
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

function PersonRow({ row, readOnly, onCommit, editors }) {
    const input = (field, label, maxLength) => <CapacityInput field={field} label={`${label} for ${row.name}`} value={row[field]} disabled={readOnly} maxLength={maxLength} editors={editors} onCommit={(name, value) => onCommit(row.key, name, value)} />;
    return <tr data-assignee-key={row.key}>
        <td className="planning-assignee-name"><div className="planning-assignee-person">
            <EpicHeaderValueReadout value={row.name}>{({ discoveryProps }) => <span {...discoveryProps} className="planning-review-truncated-value">{row.name}</span>}</EpicHeaderValueReadout>
            {row.removable && !readOnly && <IconButton size="sm" className="planning-review-column-action" aria-label={`Remove ${row.name}`} onClick={() => onCommit(row.key, 'removed', true)}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
            </IconButton>}
        </div></td>
        <td className={`planning-review-storyPoints${row.inherited ? ' planning-assignee-inherited' : ''}`}>{input('capacity', 'Capacity', 8)}</td>
        <EffortCell hundredths={row.selectedHundredths} cue={row.cue} />
        <EffortCell hundredths={row.totalHundredths} />
        <td className="planning-review-storyPoints">{input('vacations', 'Vacations', 8)}</td>
        <td className="planning-assignee-note">
            <EpicHeaderValueReadout value={row.notes || ''} suppressed={!row.notes} measureSelector="input" nativeSelector="input">
                {({ discoveryProps }) => <span {...discoveryProps} tabIndex={undefined} className="planning-review-truncated-value">{input('notes', 'Notes', 500)}</span>}
            </EpicHeaderValueReadout>
        </td>
    </tr>;
}

function AssigneeTable({ view, state, readOnly, onCommit, onRestore, onRetry, editors, sprintName, incomplete }) {
    const { rows, removed, unassigned, totals, inheritedFromSprintId } = view;
    const failed = state.save === 'failed';
    return <>
        {inheritedFromSprintId && <p className="planning-review-guidance">Inherited from {sprintName(inheritedFromSprintId) || 'an earlier Sprint'}.</p>}
        {incomplete && <p className="planning-review-guidance">Total effort may be incomplete: one load returns at most 250 issues per request.</p>}
        <table className="planning-review-table planning-assignee-table" aria-label="Assignee capacity">
            <thead><tr>
                <th className="planning-assignee-name">Assignee</th>
                <th className="planning-review-storyPoints">Capacity</th>
                <th className="planning-review-storyPoints">Selected effort</th>
                <th className="planning-review-storyPoints">Total effort</th>
                <th className="planning-review-storyPoints">Vacations</th>
                <th className="planning-assignee-note">Notes</th>
            </tr></thead>
            <tbody>
                {unassigned && <tr className="planning-review-zero-sp" data-assignee-key="unassigned">
                    <td className="planning-assignee-name">Unassigned</td>
                    <td className="planning-review-storyPoints" />
                    <EffortCell hundredths={unassigned.selectedHundredths} />
                    <EffortCell hundredths={unassigned.totalHundredths} />
                    <td className="planning-review-storyPoints" />
                    <td className="planning-assignee-note" />
                </tr>}
                {rows.map(row => <PersonRow key={row.key} row={row} readOnly={readOnly} onCommit={onCommit} editors={editors} />)}
            </tbody>
            <tfoot><tr>
                <td className="planning-assignee-name">Total</td>
                <td className="planning-review-storyPoints">{fmt(totals.capacityHundredths)}</td>
                <EffortCell hundredths={totals.selectedHundredths} cue={totals.cue} />
                <EffortCell hundredths={totals.totalHundredths} />
                <td className="planning-review-storyPoints">{fmt(totals.vacationsHundredths)}</td>
                <td className="planning-assignee-note" />
            </tr></tfoot>
        </table>
        {removed.length > 0 && !readOnly && <p className="planning-review-guidance planning-assignee-removed">
            <span aria-hidden="true">☹</span> Removed from this Sprint:{' '}
            {removed.map((person, index) => <React.Fragment key={person.key}>{index > 0 && ', '}
                <button type="button" className="planning-review-text-button" aria-label={`Restore ${person.name}`} onClick={() => onRestore(person.key)}>{person.name}</button>
            </React.Fragment>)}
        </p>}
        {failed && <p className="planning-review-guidance" role="alert">{state.error || 'Assignee capacity could not be saved.'}{' '}
            <button type="button" className="planning-action-button" onClick={onRetry}>Retry</button>
        </p>}
    </>;
}

// Wraps the Planning overview: holds the assignee capacity state for one selected Team and renders the in-flow strip
// into the host element after the controls stack. Cards, bar and every other slot are untouched.
export default function PlanningAssigneeCapacity({
    children, enabled, selectedTeamIds, allTeams, sprintId, sprintClosed, sprints, backendUrl, tasks, originals, selectedTasks,
    getTeamInfo, normalizeStatus, laneCounts,
}) {
    const oneTeam = Boolean(enabled && !allTeams && selectedTeamIds?.size === 1);
    const teamId = oneTeam ? String([...selectedTeamIds][0]) : '';
    const [expanded, setExpanded] = React.useState(readExpanded);
    const [opened, setOpened] = React.useState(expanded);
    const [host, setHost] = React.useState(null);
    React.useLayoutEffect(() => { setHost(document.getElementById(HOST_ID)); });
    const active = oneTeam && opened;
    const { state, controller } = usePlanningAssigneeCapacity({ backendUrl, sprintId: sprintId ? String(sprintId) : '', teamId, active });
    const editors = React.useRef(new Set()).current;
    const normalizeRef = React.useRef(normalizeStatus), teamInfoRef = React.useRef(getTeamInfo);
    normalizeRef.current = normalizeStatus; teamInfoRef.current = getTeamInfo;

    const projected = React.useMemo(() => projectPlanningOriginals(tasks, originals), [tasks, originals]);
    // Keyed on the loaded tasks and the Team only, so a selection toggle never rebuilds the Total list.
    const teamList = React.useMemo(() => (oneTeam ? teamTasks(projected, { teamId, getTeamInfo: task => teamInfoRef.current(task), normalizeStatus: status => normalizeRef.current(status) }) : []), [projected, teamId, oneTeam]);
    const effective = React.useMemo(() => applyChangesToDocument(state.document, state.changes), [state.document, state.changes]);
    const view = React.useMemo(() => buildAssigneeRows({ document: effective, teamTasksList: teamList, selectedTasks: selectedTasks || [], ignoreInherited: sprintClosed }), [effective, teamList, selectedTasks, sprintClosed]);
    const shownRef = React.useRef(null);
    shownRef.current = document => {
        const result = buildAssigneeRows({ document, teamTasksList: teamList, selectedTasks: selectedTasks || [], ignoreInherited: sprintClosed });
        return { rows: result.rows, removedKeys: result.removed.map(person => person.key) };
    };
    const onCommit = React.useCallback((key, field, value) => { controller.commit({ key, field, value }, document => shownRef.current(document)); }, [controller]);
    const onRestore = React.useCallback(key => onCommit(key, 'removed', false), [onCommit]);
    const onRetry = React.useCallback(() => controller.retry(), [controller]);
    const sprintName = React.useCallback(id => (sprints || []).find(sprint => String(sprint.id) === String(id))?.name, [sprints]);
    const toggle = () => {
        if (expanded) [...editors].forEach(editor => editor());
        const next = !expanded;
        setExpanded(next); writeExpanded(next);
        if (next) setOpened(true);
    };
    const incomplete = mayBeIncomplete({ laneIssueCounts: laneCounts || [] });
    const context = React.useMemo(() => ({ oneTeam, teamId, view, state, opened }), [oneTeam, teamId, view, state, opened]);

    const readOnly = !state.capabilities.canSave;
    const hidden = state.load === 'ready' && !state.capabilities.canRead;
    const empty = !view.rows.length && !view.unassigned && !view.removed.length;
    const status = state.save === 'saving' ? 'Saving…' : state.save === 'saved' ? 'Saved' : state.save === 'failed' ? 'Not saved' : '';
    let body = null;
    if (opened) {
        if (state.load === 'error') body = <p className="planning-review-guidance" role="alert">Assignee capacity could not be loaded. <button type="button" className="planning-action-button" onClick={() => controller.reload()}>Retry</button></p>;
        else if (!state.document) body = <p className="planning-review-guidance" role="status">Loading assignee capacity…</p>;
        else if (empty) body = <p className="planning-review-guidance">No Stories or saved people for this Team in this Sprint.</p>;
        else body = <>
            {readOnly && <p className="planning-review-guidance">Assignee capacity is read-only here.</p>}
            <AssigneeTable view={view} state={state} readOnly={readOnly} onCommit={onCommit} onRestore={onRestore} onRetry={onRetry} editors={editors} sprintName={sprintName} incomplete={incomplete} />
        </>;
    }
    const strip = oneTeam && !hidden && host ? createPortal(
        <div className={`capacity-panel open${expanded ? '' : ' capacity-panel-collapsed'}`} data-assignee-capacity>
            <button type="button" className="capacity-header capacity-header-toggle" aria-expanded={expanded} aria-controls="planning-assignee-capacity-body" onClick={toggle}>
                <span className="capacity-title">Assignee Capacity (Story Points)<span className="capacity-panel-caret" aria-hidden="true">▸</span></span>
                <span className="capacity-subtitle" role="status">{status}</span>
            </button>
            <div id="planning-assignee-capacity-body" className="capacity-grid-wrapper" key={`${sprintId}|${teamId}`}>{body}</div>
        </div>, host) : null;
    return <PlanningAssigneeCapacityContext.Provider value={context}>{children}{strip}</PlanningAssigneeCapacityContext.Provider>;
}
