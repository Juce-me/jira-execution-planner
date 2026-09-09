import * as React from 'react';
import StatusPill from '../ui/StatusPill.jsx';
import { getIssueStatusClassName } from '../issues/issueViewUtils.js';
import { formatSubtaskUpdatedDate } from '../issues/subtaskProgressUtils.js';
import { epicStatusName, getProjectTrackEmoji, getProjectTrackLabel } from './engTaskUtils.js';
import { epicPriorityName } from './engBoardColumns.js';
import { computeEpicStoryProgress } from './engBoardCardModel.js';
import IssuePersonEditor from '../issues/IssuePersonEditor.jsx';

// §6.2 — the board's epic card. Layout and geometry are lifted from the asset
// (docs/plans/assets/eng-group-board/board.html: .ecard/.erow1-3/.etitle/.ekey/.eperson — new
// classes, because no compact epic-summary card existed in the app before this). Every INNER
// control instead reuses an existing app class/component rather than the asset's own version of
// it (D22):
//   - the priority icon is rendered by the CALLER's renderPriorityIcon — the same closure
//     PriorityTransitionMenu already receives as a prop — so the six-icon SVG set is never
//     duplicated here;
//   - the track glyph reuses .epic-track-indicator with the app's own
//     getProjectTrackEmoji/getProjectTrackLabel (engTaskUtils.js), exactly like dashboard.jsx's
//     own passive (non-transition) rendering of the same span;
//   - the status pill is the shared <StatusPill> in its passive span form — the board does not
//     wire a transition menu onto the card in this task; that arrives with the detail panel;
//   - the story-progress bar reuses .story-subtasks-progress-track/-segment verbatim (the same
//     markup IssueCard.jsx already renders for a story's own subtask bar) rather than the asset's
//     .eprog-track/--st-done/--st-progress, which are undefined custom properties in the real app.
export default function EngBoardEpicCard({
    epicGroup, renderPriorityIcon, onOpen, onDragStart, onDragEnd, isDragging = false, isRejected = false,
    workItemLabel = 'stories',
    issueFieldEdits = null, jiraUrl = '',
}) {
    const epic = (epicGroup && epicGroup.epic) || {};
    const key = (epicGroup && epicGroup.key) || epic.key || '';
    const summary = epic.summary || key;
    const status = epicStatusName(epic);
    const track = epic.projectTrack || null;
    const assigneeName = epic.assignee?.displayName || 'Unassigned';
    const deliveryOwnerName = epic.deliveryOwner?.displayName || null;
    const tasks = (epicGroup && epicGroup.tasks) || [];
    const progress = computeEpicStoryProgress(tasks);
    // One decimal, matching the app's own story-point convention (e.g. dashboard.jsx's epic
    // header `epicTotalSp.toFixed(1)`) and the column header (EngBoardView.jsx) — not
    // Math.round(), which could round a column's summed total to a different whole number than
    // its cards' own one-decimal figures sum to.
    const storyPoints = (((epicGroup && epicGroup.storyPoints) || 0)).toFixed(1);
    const personEditor = (field, label, value) => {
        const active = issueFieldEdits?.activeEditor?.issueKey === key && issueFieldEdits.activeEditor.field === field;
        return (
            <span className="eperson">
                <span className="lbl">{label}</span>
                <b className={value?.displayName ? '' : 'is-empty'}>
                    <IssuePersonEditor
                        issueKey={key} field={field} fieldLabel={label} currentValue={value}
                        isOpen={active} metadata={active ? issueFieldEdits.metadata : null}
                        suggestions={active ? issueFieldEdits.suggestions : []} query={active ? issueFieldEdits.searchQuery : ''}
                        loading={active && issueFieldEdits.status === 'loading'} searching={active && issueFieldEdits.searching}
                        submitting={active && ['queued', 'saving'].includes(issueFieldEdits.status)}
                        pending={issueFieldEdits.pendingIssueKeys?.has(key)} error={active ? issueFieldEdits.errorMessage : ''}
                        statusMessage={active && issueFieldEdits.status === 'confirmed' ? 'Saved in Jira.' : active && issueFieldEdits.outcome?.status === 'observed' ? 'Current value loaded from Jira.' : ''}
                        recoveryMode={active && issueFieldEdits.status === 'conflict' ? 'reload' : active && issueFieldEdits.status === 'unknown' ? 'check_jira' : ''}
                        configurationChanged={active && issueFieldEdits.outcome?.configurationChanged === true} jiraUrl={jiraUrl}
                        onOpen={() => issueFieldEdits?.openEditor({ issueKey: key, field, issueKind: 'epic', sourceSurface: 'board' })}
                        onClose={issueFieldEdits?.closeEditor} onSearch={issueFieldEdits?.search} onSelect={issueFieldEdits?.submit}
                        onReload={issueFieldEdits?.reload} onCheckJira={issueFieldEdits?.checkJira}
                    />
                </b>
            </span>
        );
    };

    return (
        // The draggable wrapper owns only drag. The native button owns rows 1–2 and panel opening;
        // row 3 remains a sibling so its field controls never nest inside or activate that button.
        <div
            className={['ecard', isDragging ? 'is-dragging' : '', isRejected ? 'is-rejected' : ''].filter(Boolean).join(' ')}
            data-epic-key={key}
            // Drag is a trigger for the status-transition surface, so it goes inert with it: the
            // caller withholds the handlers when transitions are off (an open Settings modal), and
            // the card must not keep advertising a gesture that would do nothing.
            draggable={Boolean(onDragStart)}
            onDragStart={(event) => onDragStart?.(event, key)}
            onDragEnd={(event) => onDragEnd?.(event, key)}
        >
            <button type="button" className="ecard-open" aria-label={`${key}: ${summary}`} onClick={() => onOpen?.(key)}>
            <div className="erow1">
                {renderPriorityIcon ? renderPriorityIcon(epicPriorityName(epic), key) : null}
                {track && (
                    <span
                        className="epic-track-indicator"
                        title={`Project Track: ${getProjectTrackLabel(track)}`}
                        aria-label={`Project Track: ${getProjectTrackLabel(track)}`}
                    >
                        {getProjectTrackEmoji(track)}
                    </span>
                )}
                <StatusPill className={getIssueStatusClassName(status)} label={status || 'Unknown'} />
                <span className="etitle">{summary}</span>
                <span className="ekey">{key}</span>
            </div>
            <div className="erow2">
                <span className="story-subtasks-progress" aria-hidden="true">
                    <span className="story-subtasks-progress-track">
                        <span
                            className="story-subtasks-progress-segment story-subtasks-progress-done"
                            style={{ width: progress.doneWidth }}
                        />
                        <span
                            className="story-subtasks-progress-segment story-subtasks-progress-in-progress"
                            style={{ width: progress.inProgressWidth }}
                        />
                    </span>
                </span>
                <span>{progress.done} of {progress.total} {workItemLabel}</span>
                <span className="push">{storyPoints} sp</span>
                {epic.updated ? (
                    <time dateTime={epic.updated}>{formatSubtaskUpdatedDate(epic.updated)}</time>
                ) : (
                    <span>No update</span>
                )}
            </div>
            </button>
            <div className="erow3">
                {issueFieldEdits ? personEditor('assignee', 'Assignee', epic.assignee) : <span className="eperson"><span className="lbl">Assignee</span><b>{assigneeName}</b></span>}
                {issueFieldEdits ? personEditor('deliveryOwner', 'Delivery owner', epic.deliveryOwner) : <span className="eperson"><span className="lbl">Delivery owner</span><b className={deliveryOwnerName ? '' : 'is-empty'}>{deliveryOwnerName || 'Not set'}</b></span>}
            </div>
        </div>
    );
}
