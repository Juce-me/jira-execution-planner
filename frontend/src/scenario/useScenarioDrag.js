import * as React from 'react';
import { parseScenarioDate, pxToDate, dateToISODate } from './scenarioUtils.js';
import { readPendingAuthenticationRequired } from '../api/authRequired.js';

export function useScenarioDrag({
    scenarioState,
    trackScenarioAction,
    scenarioHasUnsavedChanges,
    acquireScenarioIssueLock,
    refreshScenarioIssueLock,
    releaseScenarioIssueLock,
    scenarioIssueByKey,
}) {
    const {
        setScenarioEpicFocus,
        scenarioOverrides,
        setScenarioOverrides,
        scenarioEditMode,
        setScenarioEditMode,
        scenarioUndoStackRef,
        setScenarioUndoVersion,
        scenarioDragState,
        setScenarioDragState,
        scenarioDragStateRef,
        scenarioDragFrameRef,
        scenarioDragLockRefreshRef,
        scenarioViewRangeRef,
        scenarioWasDraggedRef,
    } = scenarioState;
    const toggleScenarioEditMode = () => {
        setScenarioEditMode(prev => {
            trackScenarioAction(prev ? 'edit_stop' : 'edit_start', { dirty_state: scenarioHasUnsavedChanges ? 'dirty' : 'clean' });
            if (!prev) {
                // Entering edit mode — clear epic focus (edit operates on flat bars)
                setScenarioEpicFocus(null);
            } else {
                // Exiting edit mode — clear undo stack
                scenarioUndoStackRef.current.clear();
                setScenarioUndoVersion(0);
            }
            return !prev;
        });
    };

    const handleScenarioBarMouseDown = (event, issue) => {
        if (!scenarioEditMode) return;
        if (event.button !== 0) return;
        // Only drag issues with SP > 0
        const sp = Number(issue.sp);
        if (!sp || sp <= 0) return;
        if (!issue.start || !issue.end) return;

        event.preventDefault();
        event.stopPropagation();

        const barEl = event.currentTarget;
        const trackEl = barEl.closest('.scenario-lane-track');
        if (!trackEl) return;

        const trackRect = trackEl.getBoundingClientRect();
        const barRect = barEl.getBoundingClientRect();
        const startDate = parseScenarioDate(issue.start);
        const endDate = parseScenarioDate(issue.end);
        if (!startDate || !endDate) return;

        const durationMs = endDate.getTime() - startDate.getTime();
        const offsetX = event.clientX - barRect.left;

        const dragState = {
            issueKey: issue.key,
            originalStart: issue.start,
            originalEnd: issue.end,
            durationMs,
            offsetX,
            trackLeft: trackRect.left,
            trackWidth: trackRect.width,
            currentStart: startDate,
            currentEnd: endDate,
        };
        scenarioDragStateRef.current = dragState;
        scenarioWasDraggedRef.current = false;
        setScenarioDragState(dragState);
        acquireScenarioIssueLock(issue.key);
        if (scenarioDragLockRefreshRef.current) {
            window.clearInterval(scenarioDragLockRefreshRef.current);
        }
        scenarioDragLockRefreshRef.current = window.setInterval(() => {
            refreshScenarioIssueLock(issue.key);
        }, 4000);
    };

    // Drag mousemove/mouseup effect
    const scenarioDraggingIssueKey = scenarioDragState?.issueKey || '';
    React.useEffect(() => {
        if (!scenarioDraggingIssueKey) return;
        const handleMouseMove = (e) => {
            const ds = scenarioDragStateRef.current;
            if (!ds) return;
            scenarioWasDraggedRef.current = true;
            if (scenarioDragFrameRef.current) return; // throttle via rAF
            scenarioDragFrameRef.current = requestAnimationFrame(() => {
                scenarioDragFrameRef.current = null;
                const ds2 = scenarioDragStateRef.current;
                const viewStart = scenarioViewRangeRef.current.start;
                const viewEnd = scenarioViewRangeRef.current.end;
                if (!ds2 || !viewStart || !viewEnd) return;
                const rawPx = e.clientX - ds2.trackLeft - ds2.offsetX;
                const newStart = pxToDate(rawPx, ds2.trackWidth, viewStart, viewEnd);
                const newEnd = new Date(newStart.getTime() + ds2.durationMs);
                const updated = { ...ds2, currentStart: newStart, currentEnd: newEnd };
                scenarioDragStateRef.current = updated;
                setScenarioDragState(updated);
            });
        };
        const handleMouseUp = () => {
            if (scenarioDragFrameRef.current) {
                cancelAnimationFrame(scenarioDragFrameRef.current);
                scenarioDragFrameRef.current = null;
            }
            if (scenarioDragLockRefreshRef.current) {
                window.clearInterval(scenarioDragLockRefreshRef.current);
                scenarioDragLockRefreshRef.current = null;
            }
            const ds = scenarioDragStateRef.current;
            if (ds && scenarioWasDraggedRef.current) {
                const newStartISO = dateToISODate(ds.currentStart);
                const newEndISO = dateToISODate(ds.currentEnd);
                scenarioUndoStackRef.current.push({
                    issueKey: ds.issueKey,
                    oldStart: ds.originalStart,
                    oldEnd: ds.originalEnd,
                    newStart: newStartISO,
                    newEnd: newEndISO,
                });
                setScenarioUndoVersion(v => v + 1);
                setScenarioOverrides(prev => ({
                    ...prev,
                    [ds.issueKey]: { start: newStartISO, end: newEndISO }
                }));
            }
            if (ds?.issueKey) {
                releaseScenarioIssueLock(ds.issueKey);
            }
            scenarioDragStateRef.current = null;
            setScenarioDragState(null);
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            const ds = scenarioDragStateRef.current;
            if (scenarioDragLockRefreshRef.current) {
                window.clearInterval(scenarioDragLockRefreshRef.current);
                scenarioDragLockRefreshRef.current = null;
            }
            if (ds?.issueKey) {
                releaseScenarioIssueLock(ds.issueKey);
            }
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [scenarioDraggingIssueKey]);

    const scenarioUndo = () => {
        const cmd = scenarioUndoStackRef.current.undo();
        if (!cmd) return;
        setScenarioUndoVersion(v => v + 1);
        setScenarioOverrides(prev => {
            const next = { ...prev };
            if (cmd.oldStart === cmd.newStart && cmd.oldEnd === cmd.newEnd) return next;
            const issue = scenarioIssueByKey.get(cmd.issueKey);
            const computedStart = issue?.start;
            const computedEnd = issue?.end;
            if (cmd.oldStart === computedStart && cmd.oldEnd === computedEnd) {
                delete next[cmd.issueKey];
            } else {
                next[cmd.issueKey] = { start: cmd.oldStart, end: cmd.oldEnd };
            }
            return next;
        });
    };

    const scenarioRedo = () => {
        const cmd = scenarioUndoStackRef.current.redo();
        if (!cmd) return;
        setScenarioUndoVersion(v => v + 1);
        setScenarioOverrides(prev => ({
            ...prev,
            [cmd.issueKey]: { start: cmd.newStart, end: cmd.newEnd }
        }));
    };

    // Keyboard shortcuts for undo/redo
    React.useEffect(() => {
        if (!scenarioEditMode) return;
        const handler = (e) => {
            if (readPendingAuthenticationRequired()) return;
            const isMeta = e.metaKey || e.ctrlKey;
            if (!isMeta || e.key.toLowerCase() !== 'z') return;
            e.preventDefault();
            if (e.shiftKey) {
                scenarioRedo();
            } else {
                scenarioUndo();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [scenarioEditMode, scenarioIssueByKey]);

    const scenarioOverrideCount = Object.keys(scenarioOverrides).length;
    return {
        toggleScenarioEditMode,
        handleScenarioBarMouseDown,
        scenarioUndo,
        scenarioRedo,
        scenarioOverrideCount,
    };
}
