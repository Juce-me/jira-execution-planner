import * as React from 'react';
import { createPortal } from 'react-dom';
import IssueCard from '../issues/IssueCard.jsx';
import useIssueFieldPopover from '../issues/useIssueFieldPopover.js';
import { useStorySubtasks } from '../issues/useStorySubtasks.js';
import { fetchIssuesLookup } from '../api/issuesApi.js';
import { resolveEntityNames } from './engWorkModel.js';
import { planningDetailsIssue, planningRelatedKeys, readPlanningRelatedBatch, PLANNING_DETAILS_CATEGORIES } from './planningRowDetailsModel.js';

const CATEGORY_LABELS = { 'depends-on': 'Depends on', dependents: 'Dependents', 'blocked-by': 'Blocked by', blocks: 'Blocks' };

function DetailsContent({ row, jiraUrl, context, panelRef, onClose, onSizeChange }) {
    const issue = planningDetailsIssue(row);
    const { backendUrl = '', sprintId, dependencyData = {}, issueByKey = new Map(), dependencyIncomplete = false, entityNames = resolveEntityNames('legacy'), InitiativeIcon } = context;
    const [related, setRelated] = React.useState(null);
    const [childrenCount, setChildrenCount] = React.useState(0);
    const requestRef = React.useRef(null);
    const generation = React.useRef(0);
    const { storySubtasksByKey, toggleStorySubtasks, retryStorySubtasks } = useStorySubtasks({ backendUrl, selectedSprint: sprintId });
    React.useLayoutEffect(onSizeChange, [related, childrenCount, storySubtasksByKey]);
    React.useEffect(() => () => { generation.current++; requestRef.current?.abort(); }, []);
    const knownIssues = new Map(issueByKey);
    knownIssues.set(issue.key, issue);
    (row.children || []).forEach(child => knownIssues.set(child.key, child));
    const loadRelated = async (category, offset = 0, retry = false) => {
        if (requestRef.current) return;
        // Pagination and retries belong to the relationship snapshot chosen by that explicit action.
        // A background dependency refresh must not shift the cursor into a different key list.
        const continuing = related?.category === category && (offset > 0 || retry);
        const keys = continuing ? related.keys : planningRelatedKeys(dependencyData, issue.key, category);
        const controller = new AbortController(); requestRef.current = controller;
        const token = generation.current;
        setRelated(previous => ({ category, keys, items: offset ? previous?.items || [] : [], unavailableKeys: offset ? previous?.unavailableKeys || [] : [], nextOffset: offset, loading: true, error: '', retryOffset: offset }));
        try {
            const data = await readPlanningRelatedBatch({ keys, offset, knownIssues, signal: controller.signal,
                request: (batch, options) => fetchIssuesLookup(backendUrl, batch, options) });
            if (token !== generation.current || controller.signal.aborted) return;
            setRelated(previous => ({ ...previous, items: [...(offset ? previous.items : []), ...data.issues],
                unavailableKeys: [...(offset ? previous.unavailableKeys : []), ...data.unavailableKeys], nextOffset: data.nextOffset, loading: false,
                error: '', retryOffset: retry ? offset : null }));
        } catch (error) {
            if (error.name !== 'AbortError' && error.name !== 'AuthenticationRequiredError' && token === generation.current) setRelated(previous => ({ ...previous, loading: false, error: 'Related issues could not be loaded. Retry this batch.' }));
        } finally { if (requestRef.current === controller) requestRef.current = null; }
    };
    const dependencyContext = { dependencyData, issueByKey: knownIssues, visibleTaskKeySet: new Set(),
        dependencyFocus: related ? { taskKey: issue.key, action: related.category } : null,
        onHoverEnter: () => {}, onHoverLeave: () => {} };
    const card = (task, isLeaf = true) => <IssueCard key={task.key} task={task.key === issue.key ? task : { ...task, fields: { ...task.fields, subtaskSummary: null } }} jiraUrl={jiraUrl} showPlanning={false} allowSelection={false}
        shouldRenderIssueDependencies={task.key === issue.key} dependencyContext={dependencyContext}
        entityNames={isLeaf ? entityNames : { ...entityNames, child: entityNames.parent, childLevel: entityNames.parentLevel }} InitiativeIcon={InitiativeIcon} isPlanningLeaf={isLeaf}
        subtaskState={storySubtasksByKey[task.key]} onToggleSubtasks={task.key === issue.key ? () => {
            // Only the inspected issue owns an expandable subtask reader.
            toggleStorySubtasks(task);
        } : undefined} onRetrySubtasks={task.key === issue.key ? () => retryStorySubtasks(task) : undefined} />;
    return <div ref={panelRef} role="dialog" aria-modal="false" aria-label={`Details for ${issue.key}`} tabIndex={-1}
        className="issue-person-editor-menu is-portalled" data-planning-row-details
        style={{ width: 'min(640px, calc(100vw - 16px))', maxWidth: 'calc(100vw - 16px)', minWidth: 0 }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}
        onClick={event => { const chip = event.target.closest?.('button[data-dep-chip]'); if (!chip || !event.currentTarget.contains(chip)) return;
            const category = chip.dataset.depChip; if (PLANNING_DETAILS_CATEGORIES.includes(category)) { event.stopPropagation(); void loadRelated(category); } }}>
        <div className="pop-head"><span className="pop-facet">Details · {issue.key}</span><button type="button" className="secondary compact" onClick={onClose}>Close details</button></div>
        {row.epicKey && <p className="planning-review-guidance">{entityNames?.parent || 'Parent'}: <a className="task-key-link" href={`${jiraUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(row.epicKey)}`} target="_blank" rel="noopener noreferrer">{row.epic || row.epicKey}</a></p>}
        {!row.epicKey && row.rowKind === 'story' && <p className="planning-review-guidance">No parent in the current view.</p>}
        {card(issue, row.rowKind === 'story')}
        {storySubtasksByKey[issue.key]?.loaded && storySubtasksByKey[issue.key]?.expanded && (storySubtasksByKey[issue.key].summary?.total || 0) > (storySubtasksByKey[issue.key].items || []).length && <div>
            <p className="planning-review-guidance" role="status">Subtask results are incomplete. {storySubtasksByKey[issue.key].items.length} of {storySubtasksByKey[issue.key].summary.total} loaded.</p>
            <button type="button" className="secondary compact" onClick={() => retryStorySubtasks(issue)}>Retry subtasks</button>
        </div>}
        {dependencyIncomplete && <p className="planning-review-guidance" role="status">Dependency information is incomplete. Listed relationships may not be exhaustive.</p>}
        {!planningRelatedKeys(dependencyData, issue.key, 'depends-on').length && !planningRelatedKeys(dependencyData, issue.key, 'dependents').length && !planningRelatedKeys(dependencyData, issue.key, 'blocked-by').length && !planningRelatedKeys(dependencyData, issue.key, 'blocks').length && <p className="planning-review-guidance">No related issues in the loaded dependency data.</p>}
        {related && <section aria-label={`${CATEGORY_LABELS[related.category]} related issues`}>
            <p className="planning-review-guidance">{CATEGORY_LABELS[related.category]} · {related.keys.length} related issues · {related.nextOffset} checked</p>
            {related.items.map(task => card(task))}
            {related.unavailableKeys.length > 0 && <><p className="planning-review-guidance" role="status">{related.unavailableKeys.length} related issues are unavailable.</p>
                {!related.loading && !related.error && <button type="button" className="secondary compact" onClick={() => void loadRelated(related.category)}>Retry related category</button>}</>}
            {related.loading && <p className="planning-review-guidance" role="status">Loading related issues…</p>}
            {related.error && <><p className="planning-review-guidance" role="alert">{related.error}</p><button type="button" className="secondary compact" onClick={() => void loadRelated(related.category, related.retryOffset, true)}>Retry related issues</button></>}
            {!related.loading && !related.error && related.nextOffset < related.keys.length && <button type="button" className="secondary compact" onClick={() => void loadRelated(related.category, related.nextOffset)}>Load next related issues</button>}
        </section>}
        {row.rowKind === 'epic' && (row.children || []).length > 0 && <section aria-label="Children in current view">
            <p className="planning-review-guidance">{row.children.length} {entityNames?.childPlural || 'children'} in the current view.</p>
            {row.children.slice(0, childrenCount).map(task => card(planningDetailsIssue(task)))}
            {childrenCount < row.children.length && <button type="button" className="secondary compact" onClick={() => setChildrenCount(count => count + 20)}>Show next children</button>}
        </section>}
    </div>;
}

export default function PlanningRowDetails({ row, triggerElement, jiraUrl = '', context = {}, onClose }) {
    const [sizeVersion, setSizeVersion] = React.useState(0);
    const onSizeChange = React.useCallback(() => { setSizeVersion(value => value + 1); }, []);
    const wrapperRef = React.useRef(null);
    wrapperRef.current = triggerElement;
    const close = React.useCallback(() => { onClose(); triggerElement?.focus({ preventScroll: true }); }, [onClose, triggerElement]);
    const dismiss = React.useCallback(() => {
        close();
        // A non-focusable outside target moves focus to body after pointerdown.
        // Preserve a newly focused control; otherwise return to the still-mounted row.
        window.setTimeout(() => {
            if (document.activeElement === document.body && triggerElement?.isConnected) triggerElement.focus({ preventScroll: true });
        }, 0);
    }, [close, triggerElement]);
    const { triggerRef, panelRef } = useIssueFieldPopover({ blockClass: 'planning-row-details', wrapperRef,
        portalTarget: document.body, active: Boolean(row), onDismiss: dismiss, restoreFocusOnOutside: false, useVisualViewport: true,
        dependencies: [row?.key, sizeVersion] });
    triggerRef.current = triggerElement;
    React.useEffect(() => {
        if (!row) return undefined;
        const escape = event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(); } };
        document.addEventListener('keydown', escape);
        return () => document.removeEventListener('keydown', escape);
    }, [row?.key, close]);
    React.useLayoutEffect(() => { if (row) panelRef.current?.focus({ preventScroll: true }); }, [row?.key]);
    if (!row || row.synthetic) return null;
    return createPortal(<DetailsContent key={`${row.rowKind}:${row.key}`} row={row} jiraUrl={jiraUrl} context={context} panelRef={panelRef} onClose={close} onSizeChange={onSizeChange} />, document.body);
}
