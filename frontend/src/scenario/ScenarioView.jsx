import * as React from 'react';
import ScenarioBar from './ScenarioBar.jsx';
import { parseScenarioDate, normalizeScenarioSummary, buildScenarioTooltipPayload, dateToPx, SCENARIO_BAR_HEIGHT } from './scenarioUtils.js';

export function ScenarioView({
    scenario,
    scenarioState,
    selectedSprint,
    normalizeEpicKey,
    excludedEpicSet,
}) {
    const {
        registerScenarioIssueRef,
        runScenario,
        toggleScenarioEditMode,
        handleScenarioBarMouseDown,
        scenarioBaseUrl,
        scenarioHasUnsavedChanges,
        scenarioCanSaveDraft,
        scenarioRemoteEditors,
        scenarioIssueLockWarnings,
        scenarioSearchQuery,
        scenarioSearchMatchSet,
        scenarioIssueByKey,
        scenarioViewStart,
        scenarioViewEnd,
        scenarioFocusIssueKeys,
        scenarioFocusContextKeys,
        scenarioAssigneeConflicts,
        scenarioDepViolations,
        scenarioDepViolatedKeys,
        scenarioUndo,
        scenarioRedo,
        scenarioOverrideCount,
        saveScenarioDraft,
        discardScenarioOverrides,
        openScenarioDraftHistory,
        closeScenarioDraftHistory,
        requestReloadActiveDraft,
        cancelReloadActiveDraft,
        runReloadActiveDraft,
        requestScenarioHistoryAction,
        cancelScenarioHistoryAction,
        requestScenarioReloadFromJira,
        cancelScenarioReloadFromJira,
        runScenarioReloadFromJira,
        previewScenarioDraftWriteback,
        checkScenarioDraftWritebackGate,
        runScenarioHistoryAction,
        scenarioLaneInfo,
        scenarioLateItems,
        scenarioDeadlineAtRisk,
        scenarioCriticalPathItems,
        scenarioUnschedulableItems,
        scenarioIssuesByLane,
        scenarioTicks,
        scenarioQuarterMarkers,
        SCENARIO_LANE_HEIGHT,
        scenarioBarGap,
        scenarioLaneMeta,
        scenarioLaneAssigneeGroups,
        scenarioPositions,
        scenarioEpicBars,
        scenarioEpicEdges,
        scenarioTodayLeft,
        scenarioVisibleLanes,
        scenarioUpstreamSet,
        scenarioDownstreamSet,
        scenarioBlockedSet,
        toggleScenarioLane,
        showScenarioTooltip,
        showScenarioTooltipFromElement,
        moveScenarioTooltip,
        hideScenarioTooltip,
        clearScenarioEpicFocus,
        focusScenarioEpic,
        scrollToScenarioIssue,
    } = scenario;
    const {
        scenarioLoading,
        scenarioError,
        scenarioData,
        scenarioLaneMode,
        setScenarioLaneMode,
        scenarioShowConflictsOnly,
        setScenarioShowConflictsOnly,
        scenarioTimelineRef,
        scenarioLayout,
        scenarioCollapsedCards,
        setScenarioCollapsedCards,
        scenarioSummaryHidden,
        setScenarioSummaryHidden,
        scenarioHoverKey,
        setScenarioHoverKey,
        scenarioFlashKey,
        scenarioEpicFocus,
        scenarioHistoryButtonRef,
        scenarioHistoryPanelRef,
        scenarioHistoryTitleRef,
        scenarioDraftMeta,
        setScenarioDraftMeta,
        scenarioDraftRealtimeStatus,
        scenarioEditMode,
        scenarioUndoStackRef,
        scenarioDragState,
        scenarioWasDraggedRef,
        scenarioTooltip,
        scenarioTooltipRef,
        scenarioEdgeRender,
    } = scenarioState;
    return (
        <div className="scenario-fullbleed">
            <div className="scenario-panel open">
                <div className="scenario-inner">
                    <div className="scenario-header">
                        <div>
                            <div className="scenario-title">
                                Scenario Planner
                                <span className="scenario-beta">Beta</span>
                            </div>
                            <div className="scenario-subtitle">Capacity comes from Jira capacity issues (watchers + 1 dev lead).</div>
                        </div>
                        <div className="scenario-controls">
                            <div className="scenario-control">
                                <label>Lane Mode</label>
                                <div className="scenario-toggle-group">
                                    <button
                                        className={`scenario-toggle ${scenarioLaneMode === 'team' ? 'active' : ''}`}
                                        onClick={() => {
                                            if (scenarioEpicFocus) clearScenarioEpicFocus();
                                            setScenarioLaneMode('team');
                                        }}
                                    >
                                        Team
                                    </button>
                                    <button
                                        className={`scenario-toggle ${scenarioLaneMode === 'epic' ? 'active' : ''}`}
                                        onClick={() => {
                                            if (scenarioEpicFocus) clearScenarioEpicFocus();
                                            setScenarioLaneMode('epic');
                                        }}
                                    >
                                        Epic
                                    </button>
                                    <button
                                        className={`scenario-toggle ${scenarioLaneMode === 'assignee' ? 'active' : ''}`}
                                        onClick={() => {
                                            if (scenarioEpicFocus) clearScenarioEpicFocus();
                                            setScenarioLaneMode('assignee');
                                        }}
                                    >
                                        Assignee
                                    </button>
                                </div>
                            </div>
                            <div className="scenario-controls-separator" />
                            <button
                                className={`scenario-toggle ${scenarioSummaryHidden ? '' : 'active'}`}
                                onClick={() => setScenarioSummaryHidden(prev => !prev)}
                                title={scenarioSummaryHidden ? 'Show summary cards' : 'Hide summary cards'}
                            >
                                {scenarioSummaryHidden ? 'Show Summary' : 'Hide Summary'}
                            </button>
                            <button
                                className={`scenario-edit-toggle ${scenarioEditMode ? 'active' : ''}`}
                                onClick={toggleScenarioEditMode}
                                disabled={!scenarioData}
                            >
                                {scenarioEditMode ? 'Exit Edit' : 'Edit'}
                            </button>
                            {scenarioData && !scenarioEditMode && (
                                <button
                                    type="button"
                                    ref={scenarioHistoryButtonRef}
                                    className="scenario-toggle"
                                    onClick={openScenarioDraftHistory}
                                    disabled={scenarioDraftMeta.loadingHistory}
                                >
                                    History
                                </button>
                            )}
                            <button
                                className={`scenario-toggle ${scenarioShowConflictsOnly ? 'active' : ''}`}
                                onClick={() => setScenarioShowConflictsOnly(prev => !prev)}
                            >
                                Conflicts Only
                            </button>
                            <button
                                className="secondary"
                                onClick={runScenario}
                                disabled={scenarioLoading || !selectedSprint}
                            >
                                {scenarioLoading ? 'Running...' : 'Run Scenario'}
                            </button>
                            {scenarioEditMode && (
                                <>
                                    <button
                                        className="scenario-edit-toggle"
                                        onClick={scenarioUndo}
                                        disabled={!scenarioUndoStackRef.current.canUndo()}
                                        title="Undo (Ctrl+Z)"
                                    >
                                        Undo
                                    </button>
                                    <button
                                        className="scenario-edit-toggle"
                                        onClick={scenarioRedo}
                                        disabled={!scenarioUndoStackRef.current.canRedo()}
                                        title="Redo (Ctrl+Shift+Z)"
                                    >
                                        Redo
                                    </button>
                                    <button
                                        className="scenario-edit-toggle"
                                        onClick={saveScenarioDraft}
                                        disabled={!scenarioCanSaveDraft}
                                        title="Save draft overrides to server"
                                    >
                                        {scenarioDraftMeta.saving ? 'Saving...' : 'Save Draft'}
                                    </button>
                                    <button
                                        type="button"
                                        ref={scenarioHistoryButtonRef}
                                        className="scenario-edit-toggle"
                                        onClick={openScenarioDraftHistory}
                                        disabled={scenarioDraftMeta.loadingHistory}
                                    >
                                        History
                                    </button>
                                    <button
                                        className="scenario-edit-toggle"
                                        onClick={discardScenarioOverrides}
                                        disabled={!scenarioHasUnsavedChanges}
                                        title="Discard all overrides"
                                    >
                                        Discard
                                    </button>
                                    {scenarioOverrideCount > 0 && (
                                        <span className="scenario-dirty-indicator">{scenarioOverrideCount} override{scenarioOverrideCount !== 1 ? 's' : ''}</span>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {scenarioRemoteEditors.length > 0 && (
                        <div className="scenario-draft-history-note" role="status" aria-live="polite">
                            Editing now: {scenarioRemoteEditors.map(item => item.displayName).join(', ')}
                        </div>
                    )}
                    {scenarioDraftRealtimeStatus.paused && (
                        <div className="scenario-draft-history-note" role="status" aria-live="polite">
                            Realtime paused: {scenarioDraftRealtimeStatus.message || 'keep editing local-only'}
                        </div>
                    )}
                    {scenarioError && <div className="scenario-error" role="alert">{scenarioError}</div>}
                    {scenarioDraftMeta.error && (
                        <div className="scenario-error" role="alert">{scenarioDraftMeta.error}</div>
                    )}
                    {scenarioDraftMeta.message && (
                        <div className="scenario-draft-history-note" aria-live="polite">{scenarioDraftMeta.message}</div>
                    )}
                    {scenarioIssueLockWarnings.map(lock => (
                        <div key={`${lock.issueKey}-${lock.holderDisplayName}`} className="scenario-error" role="alert">
                            {lock.holderDisplayName} is editing {lock.issueKey}. Advisory lock only; local edits stay available.
                        </div>
                    ))}
                    {scenarioDraftMeta.staleDraft && (
                        <div className="scenario-error" role="alert">
                            <span>
                                Newer draft available at revision {scenarioDraftMeta.staleDraft.draftRevision || 'unknown'}
                                {scenarioDraftMeta.staleDraft.updatedBy ? ` by ${scenarioDraftMeta.staleDraft.updatedBy}` : ''}. Local edits were not changed.
                            </span>
                            <button
                                type="button"
                                className="scenario-link"
                                onClick={openScenarioDraftHistory}
                            >
                                Review history
                            </button>
                            <button
                                type="button"
                                className="scenario-link"
                                onClick={requestReloadActiveDraft}
                                disabled={scenarioDraftMeta.loadingActiveDraft}
                            >
                                {scenarioDraftMeta.loadingActiveDraft ? 'Reloading active draft...' : 'Reload active draft'}
                            </button>
                            <button
                                type="button"
                                className="scenario-link"
                                onClick={() => setScenarioDraftMeta(prev => ({
                                    ...prev,
                                    dirtyState: scenarioHasUnsavedChanges ? 'dirty' : 'clean',
                                    staleDraft: null,
                                    message: '',
                                    error: ''
                                }))}
                            >
                                Keep editing locally
                            </button>
                            {scenarioDraftMeta.pendingActiveDraftReload && (
                                <div className="scenario-draft-history-confirmation">
                                    Reload active draft and replace local edits?
                                    <button
                                        type="button"
                                        className="scenario-link"
                                        onClick={runReloadActiveDraft}
                                    >
                                        Confirm reload active draft
                                    </button>
                                    <button
                                        type="button"
                                        className="scenario-link"
                                        onClick={cancelReloadActiveDraft}
                                    >
                                        Cancel active draft reload
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    {scenarioDraftMeta.conflict && (
                        <div className="scenario-error" role="alert">
                            <span>
                                Scenario draft conflict. Current draft revision {scenarioDraftMeta.conflict.currentDraftRevision || 'unknown'}, version {scenarioDraftMeta.conflict.currentVersionNumber || 'unknown'}
                                {scenarioDraftMeta.conflict.activeDraft?.updatedBy ? ` by ${scenarioDraftMeta.conflict.activeDraft.updatedBy}` : ''}
                                {scenarioDraftMeta.conflict.activeDraft?.updatedAt ? ` at ${scenarioDraftMeta.conflict.activeDraft.updatedAt}` : ''}.
                            </span>
                            <button
                                type="button"
                                className="scenario-link"
                                onClick={() => setScenarioDraftMeta(prev => ({
                                    ...prev,
                                    dirtyState: 'dirty_local',
                                    conflict: null,
                                    error: '',
                                    message: ''
                                }))}
                            >
                                Keep Editing
                            </button>
                            <button
                                type="button"
                                className="scenario-link"
                                onClick={openScenarioDraftHistory}
                            >
                                Review history
                            </button>
                        </div>
                    )}
                    {scenarioDraftMeta.historyOpen && (
                        <section
                            ref={scenarioHistoryPanelRef}
                            className="scenario-draft-history-panel"
                            role="dialog"
                            aria-modal="false"
                            aria-labelledby="scenario-draft-history-title"
                        >
                            <div
                                id="scenario-draft-history-title"
                                ref={scenarioHistoryTitleRef}
                                className="scenario-draft-history-title"
                                tabIndex={-1}
                            >
                                Scenario draft history
                            </div>
                            {scenarioDraftMeta.versions.length === 0 ? (
                                <div className="scenario-draft-history-note">No draft versions yet.</div>
                            ) : (
                                <div className="scenario-draft-history-list">
                                    {scenarioDraftMeta.versions.map(version => {
                                        const versionNumber = Number(version.versionNumber || 0);
                                        const overrideCount = Number.isFinite(Number(version.overrideCount))
                                            ? Number(version.overrideCount)
                                            : Object.keys(version.overrides || {}).length;
                                        const isCurrent = versionNumber === Number(scenarioDraftMeta.conflict?.currentVersionNumber || scenarioDraftMeta.activeDraft?.versionNumber || 0);
                                        const isLoaded = versionNumber === Number(scenarioDraftMeta.loadedVersionNumber || 0);
                                        const pendingAction = scenarioDraftMeta.pendingHistoryAction?.versionNumber === versionNumber
                                            ? scenarioDraftMeta.pendingHistoryAction
                                            : null;
                                        const actor = version.createdBy || version.updatedBy || 'Unknown actor';
                                        const timestamp = version.createdAt || version.updatedAt || 'Unknown time';
                                        return (
                                            <div key={version.versionId || versionNumber} className="scenario-draft-history-row">
                                                <div className="scenario-draft-history-main">
                                                    <strong>Version {versionNumber}</strong>
                                                    <span>{actor}</span>
                                                    <span>{timestamp}</span>
                                                    <span>{overrideCount} override{overrideCount === 1 ? '' : 's'}</span>
                                                    {isCurrent && <span>Current</span>}
                                                    {!isCurrent && isLoaded && <span>Loaded</span>}
                                                </div>
                                                <div className="scenario-draft-history-actions">
                                                    <button
                                                        type="button"
                                                        className="scenario-link"
                                                        onClick={() => requestScenarioHistoryAction('reload', versionNumber)}
                                                        disabled={scenarioDraftMeta.loadingVersionNumber === versionNumber || scenarioDraftMeta.rollingBackVersionNumber === versionNumber}
                                                        aria-label={`Reload version ${versionNumber}`}
                                                    >
                                                        Reload Version
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="scenario-link"
                                                        onClick={() => requestScenarioHistoryAction('rollback', versionNumber)}
                                                        disabled={scenarioDraftMeta.loadingVersionNumber === versionNumber || scenarioDraftMeta.rollingBackVersionNumber === versionNumber}
                                                        aria-label={`Rollback to version ${versionNumber}`}
                                                    >
                                                        Rollback to Version
                                                    </button>
                                                </div>
                                                {pendingAction && (
                                                    <div className="scenario-draft-history-confirmation">
                                                        {pendingAction.type === 'reload'
                                                            ? `Reload version ${versionNumber} and replace local edits?`
                                                            : `Rollback to version ${versionNumber} and replace local edits?`}
                                                        <button
                                                            type="button"
                                                            className="scenario-link"
                                                            onClick={() => runScenarioHistoryAction(pendingAction)}
                                                        >
                                                            {pendingAction.type === 'reload' ? 'Reload Version' : 'Rollback to Version'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="scenario-link"
                                                            onClick={cancelScenarioHistoryAction}
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <div className="scenario-draft-history-actions">
                                <button
                                    type="button"
                                    className="scenario-link"
                                    onClick={requestScenarioReloadFromJira}
                                    disabled={!scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.reloadingFromJira}
                                >
                                    {scenarioDraftMeta.reloadingFromJira ? 'Reloading from Jira...' : 'Reload from Jira'}
                                </button>
                            </div>
                            {scenarioDraftMeta.pendingReloadFromJira && (
                                <div className="scenario-draft-history-confirmation">
                                    Reload from Jira and replace local edits?
                                    <button
                                        type="button"
                                        className="scenario-link"
                                        onClick={runScenarioReloadFromJira}
                                    >
                                        Confirm reload from Jira
                                    </button>
                                    <button
                                        type="button"
                                        className="scenario-link"
                                        onClick={cancelScenarioReloadFromJira}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                            <div className="scenario-draft-history-note">
                                Jira write-back is gated. Preview is dry-run only; mutation remains disabled.
                            </div>
                            <div className="scenario-draft-history-actions">
                                <button
                                    type="button"
                                    className="scenario-link"
                                    onClick={previewScenarioDraftWriteback}
                                    disabled={!scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.writebackPreviewing}
                                >
                                    {scenarioDraftMeta.writebackPreviewing ? 'Previewing Jira write-back...' : 'Preview Jira write-back'}
                                </button>
                                <button
                                    type="button"
                                    className="scenario-link"
                                    onClick={checkScenarioDraftWritebackGate}
                                    disabled={!scenarioDraftMeta.activeDraft?.draftId || scenarioDraftMeta.writebackChecking}
                                >
                                    {scenarioDraftMeta.writebackChecking ? 'Checking write-back gate...' : 'Check write-back gate'}
                                </button>
                                <button
                                    type="button"
                                    className="scenario-link"
                                    disabled
                                    title="Real Jira write-back requires a separate future execution plan."
                                >
                                    Write Back to Jira
                                </button>
                            </div>
                            {scenarioDraftMeta.writebackPreview && (
                                <div className="scenario-draft-history-note" role="status" aria-live="polite">
                                    Jira write-back preview is dry-run only. {Array.isArray(scenarioDraftMeta.writebackPreview.changes) ? scenarioDraftMeta.writebackPreview.changes.length : 0} changes would be prepared.
                                </div>
                            )}
                            {scenarioDraftMeta.writebackBlocked && (
                                <div className="scenario-error" role="alert">
                                    {scenarioDraftMeta.writebackBlocked.message || 'Jira write-back is blocked by the migration gate.'}
                                </div>
                            )}
                            <button
                                type="button"
                                className="scenario-link"
                                onClick={closeScenarioDraftHistory}
                            >
                                Close
                            </button>
                        </section>
                    )}
                    {scenarioLoading && <div className="scenario-loading">Computing scenario timeline...</div>}

                    {scenarioData && (
                        <>
                            <div className={`scenario-summary ${scenarioSummaryHidden ? 'hidden' : ''}`}>
                                {!scenarioSummaryHidden && scenarioAssigneeConflicts.conflicts.size > 0 && (
                                    <div className={`scenario-card scenario-card-warning ${scenarioCollapsedCards.warnings ? 'collapsed' : ''}`}>
                                        <h4 className="scenario-card-toggle" onClick={() => setScenarioCollapsedCards(prev => ({ ...prev, warnings: !prev.warnings }))}>
                                            <span className="scenario-card-chevron">{scenarioCollapsedCards.warnings ? '▸' : '▾'}</span>
                                            ⚠️ Schedule Warnings
                                        </h4>
                                        <div className="scenario-value">
                                            {scenarioAssigneeConflicts.conflicts.size} conflicts
                                        </div>
                                        <div className="scenario-subtitle">
                                            {Array.from(new Set(
                                                Array.from(scenarioAssigneeConflicts.conflicts).map(key => {
                                                    const issue = scenarioIssueByKey.get(key);
                                                    return issue?.assignee;
                                                }).filter(Boolean)
                                            )).length} assignees with overlapping tasks
                                        </div>
                                        {!scenarioCollapsedCards.warnings && (
                                            <div className="scenario-issues-list">
                                                {Array.from(scenarioAssigneeConflicts.conflicts).map(key => {
                                                    const issue = scenarioIssueByKey.get(key);
                                                    return (
                                                        <button
                                                            key={key}
                                                            type="button"
                                                            className="scenario-link"
                                                            onClick={() => scrollToScenarioIssue(key)}
                                                        >
                                                            <span>{issue?.summary || key}</span>
                                                            <span className="scenario-link-key">{key} · {issue?.assignee}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {!scenarioSummaryHidden && <div className={`scenario-card ${scenarioCollapsedCards.timeline ? 'collapsed' : ''}`}>
                                    <h4 className="scenario-card-toggle" onClick={() => setScenarioCollapsedCards(prev => ({ ...prev, timeline: !prev.timeline }))}>
                                        <span className="scenario-card-chevron">{scenarioCollapsedCards.timeline ? '▸' : '▾'}</span>
                                        Timeline Status
                                    </h4>
                                    <div className="scenario-value">
                                        {scenarioDeadlineAtRisk ? 'At risk' : 'On track'}
                                    </div>
                                    <div className="scenario-subtitle">
                                        {scenarioLateItems.length} late · {scenarioCriticalPathItems.length} critical path
                                    </div>
                                    {!scenarioCollapsedCards.timeline && (
                                        <div className="scenario-issues-list">
                                            {[...scenarioLateItems, ...scenarioCriticalPathItems]
                                                .filter((key, idx, arr) => arr.indexOf(key) === idx)
                                                .map(key => {
                                                const issue = scenarioIssueByKey.get(key);
                                                const isLate = scenarioLateItems.includes(key);
                                                return (
                                                    <button
                                                        type="button"
                                                        key={key}
                                                        className="scenario-link"
                                                        onClick={() => scrollToScenarioIssue(key)}
                                                    >
                                                        <span>{issue?.summary || key}</span>
                                                        <span className="scenario-link-key">{key}{isLate ? ' · Late' : ' · Critical'}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>}
                                {!scenarioSummaryHidden && <div className={`scenario-card ${scenarioCollapsedCards.unschedulable ? 'collapsed' : ''}`}>
                                    <h4 className="scenario-card-toggle" onClick={() => setScenarioCollapsedCards(prev => ({ ...prev, unschedulable: !prev.unschedulable }))}>
                                        <span className="scenario-card-chevron">{scenarioCollapsedCards.unschedulable ? '▸' : '▾'}</span>
                                        Unschedulable
                                    </h4>
                                    <div className="scenario-value">{scenarioUnschedulableItems.length}</div>
                                    <div className="scenario-subtitle">Missing SP or dependencies</div>
                                    {!scenarioCollapsedCards.unschedulable && (
                                        <div className="scenario-issues-list">
                                            {scenarioUnschedulableItems.map(key => {
                                                const issue = scenarioIssueByKey.get(key);
                                                const reason = issue?.scheduledReason;
                                                let reasonLabel = '';
                                                if (reason === 'missing_story_points') {
                                                    reasonLabel = 'Missing SP';
                                                } else if (reason === 'missing_dependency') {
                                                    reasonLabel = 'Missing dependency';
                                                }
                                                return (
                                                    <button
                                                        type="button"
                                                        key={key}
                                                        className="scenario-link"
                                                        onClick={() => scrollToScenarioIssue(key)}
                                                    >
                                                        <span>{issue?.summary || key}</span>
                                                        <span className="scenario-link-key">
                                                            {key}{reasonLabel ? ` · ${reasonLabel}` : ''}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>}
                            </div>

                            {scenarioEpicFocus && (
                                <div className="scenario-focus-indicator">
                                    <button
                                        type="button"
                                        className="scenario-focus-exit"
                                        onClick={clearScenarioEpicFocus}
                                    >
                                        <span>Focused: {scenarioEpicFocus.summary || scenarioEpicFocus.key} (click to exit)</span>
                                    </button>
                                </div>
                            )}
                            <div className="scenario-timeline" ref={scenarioTimelineRef}>
                                <div className="scenario-axis">
                                    <div className="scenario-axis-ticks">
                                        {scenarioTicks.map((tick) => {
                                            const left = `${tick.ratio * 100}%`;
                                            return (
                                                <span
                                                    key={tick.label}
                                                    className="scenario-axis-tick"
                                                    style={{ left }}
                                                >
                                                    {tick.label}
                                                </span>
                                            );
                                        })}
                                    </div>
                                    {scenarioTodayLeft !== null && (
                                        <div
                                            className="scenario-today"
                                            style={{
                                                left: `${scenarioTodayLeft}px`,
                                                height: `calc(${scenarioLaneMeta.totalHeight}px + var(--scenario-axis-height))`
                                            }}
                                        />
                                    )}
                                </div>
                                <div
                                    className="scenario-lanes"
                                    style={{ height: `${scenarioLaneMeta.totalHeight}px` }}
                                >
                                    {scenarioLayout.width > 0 && scenarioQuarterMarkers.map((marker, index) => {
                                        const left = scenarioLayout.labelWidth + scenarioLayout.width * marker.ratio;
                                        return (
                                            <div
                                                key={`quarter-${index}-${marker.date.toISOString()}`}
                                                className="scenario-quarter-line"
                                                style={{ left: `${left}px` }}
                                            />
                                        );
                                    })}
                                    {scenarioVisibleLanes.map((lane) => {
                                        const laneMeta = scenarioLaneMeta.meta.get(lane) || { height: SCENARIO_LANE_HEIGHT };
                                        const laneHeight = laneMeta.height;
                                        const allLaneIssues = scenarioIssuesByLane.get(lane) || [];
                                        const laneIssues = scenarioShowConflictsOnly
                                            ? allLaneIssues.filter(issue => scenarioAssigneeConflicts.conflicts.has(issue.key))
                                            : allLaneIssues;
                                        const laneEpicBars = scenarioEpicBars.filter(bar => bar.lane === lane);
                                        const laneInfo = scenarioLaneInfo.get(lane) || { label: lane, key: lane };
                                        const isCollapsed = laneMeta.collapsed;
                                        return (
                                        <div
                                            key={lane}
                                            className="scenario-lane"
                                            style={{ top: `${laneMeta.offset}px` }}
                                        >
                                            <div className="scenario-lane-label-container" style={{ height: `${laneHeight}px` }}>
                                            <button
                                                className="scenario-lane-label"
                                                type="button"
                                                disabled={scenarioEpicFocus}
                                                onClick={() => !scenarioEpicFocus && toggleScenarioLane(lane)}
                                                aria-expanded={!isCollapsed}
                                            >
                                                <div className="scenario-lane-title">
                                                    <span className="scenario-lane-title-text">
                                                        {normalizeScenarioSummary(laneInfo.label) || laneInfo.label}
                                                    </span>
                                                    {scenarioLaneMode !== 'epic' && laneInfo.key && laneInfo.key !== laneInfo.label && (
                                                        <span className="scenario-lane-key">{laneInfo.key}</span>
                                                    )}
                                                </div>
                                                <div className="scenario-lane-meta">
                                                    {Number.isFinite(laneInfo.totalSp) && laneInfo.totalSp > 0 && (
                                                        <div className="scenario-lane-sp">Allocated: {laneInfo.totalSp.toFixed(1)} SP.</div>
                                                    )}
                                                    {scenarioLaneMode === 'team' && laneInfo.capacity != null && (
                                                        <div className="scenario-lane-capacity">Team Size: {laneInfo.capacity + 1} 👥</div>
                                                    )}
                                                    {scenarioLaneMode === 'team' && (
                                                        <div className={`scenario-lane-status ${(laneInfo.lateCount || laneInfo.unschedulableCount) ? 'risk' : 'ok'}`}>
                                                            Status: {(laneInfo.lateCount || laneInfo.unschedulableCount) ? 'At risk' : 'OK'}
                                                        </div>
                                                    )}
                                                    {laneInfo.conflictCount > 0 && (
                                                        <div className="scenario-lane-conflicts">
                                                            ⚠️ {laneInfo.conflictCount} conflict{laneInfo.conflictCount !== 1 ? 's' : ''}
                                                        </div>
                                                    )}
                                                    {laneMeta.hiddenCount > 0 && (
                                                        <div className="scenario-lane-more">+{laneMeta.hiddenCount} more</div>
                                                    )}
                                                </div>
                                            </button>
                                            {scenarioLaneMode === 'team' && (() => {
                                                const groups = scenarioLaneAssigneeGroups.get(lane) || [];
                                                return groups.map((group, idx) => {
                                                    const displayName = group.assignee ? (() => { const parts = group.assignee.split(' '); return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]; })() : 'Unassigned';
                                                    const top = scenarioBarGap + group.startRow * (SCENARIO_BAR_HEIGHT + scenarioBarGap);
                                                    const height = group.rowCount * (SCENARIO_BAR_HEIGHT + scenarioBarGap);
                                                    return (
                                                        <div key={`al-${idx}`} className="scenario-assignee-label"
                                                             style={{ top: `${top}px`, height: `${height}px` }}
                                                             title={group.assignee || 'Unassigned'}>
                                                            {displayName}
                                                        </div>
                                                    );
                                                });
                                            })()}
                                            </div>
                                            <div className="scenario-lane-track" style={{ height: `${laneHeight}px` }}>
                                                {scenarioLaneMode === 'team' && (() => {
                                                    const groups = scenarioLaneAssigneeGroups.get(lane) || [];
                                                    return groups.slice(1).map((group, idx) => {
                                                        const dividerY = group.startRow * (SCENARIO_BAR_HEIGHT + scenarioBarGap);
                                                        return (
                                                            <div key={`assignee-div-${idx}`} className="scenario-assignee-divider"
                                                                 style={{ top: `${dividerY}px` }} />
                                                        );
                                                    });
                                                })()}
                                                {laneEpicBars.map(bar => {
                                                    const left = `${(bar.xStart / scenarioLayout.width) * 100}%`;
                                                    const width = `${Math.max(2, ((bar.xEnd - bar.xStart) / scenarioLayout.width) * 100)}%`;
                                                    const top = `${Math.max(2, bar.y - (scenarioLaneMeta.meta.get(lane)?.offset || 0))}px`;
                                                    const height = `${Math.max(10, bar.height)}px`;
                                                    const epicAssignees = bar.assignees && bar.assignees.length > 0
                                                        ? (bar.assignees.length === 1
                                                            ? bar.assignees[0]
                                                            : `${bar.assignees.length} assignees: ${bar.assignees.slice(0, 3).join(', ')}${bar.assignees.length > 3 ? '...' : ''}`)
                                                        : null;
                                                    const epicTooltip = buildScenarioTooltipPayload(
                                                        bar.epicSummary || bar.epicKey,
                                                        bar.epicKey,
                                                        bar.storyPoints,
                                                        bar.isExcluded,
                                                        false, // hasConflict
                                                        epicAssignees,
                                                        [], // conflictingKeys
                                                        false, // isOutOfSprint
                                                        false // isInProgress
                                                    );
                                                    return (
                                                        <div
                                                            key={`${bar.lane}-${bar.epicKey}`}
                                                            className={`scenario-epic-bar ${bar.isExcluded ? 'excluded' : ''}`}
                                                            style={{ left, width, top, height }}
                                                            role="button"
                                                            tabIndex={0}
                                                            onClick={() => focusScenarioEpic(bar.epicKey, bar.epicSummary)}
                                                            onKeyDown={(event) => {
                                                                if (event.key === 'Enter' || event.key === ' ') {
                                                                    event.preventDefault();
                                                                    focusScenarioEpic(bar.epicKey, bar.epicSummary);
                                                                }
                                                            }}
                                                            onMouseEnter={(event) => showScenarioTooltip(event, epicTooltip)}
                                                            onMouseMove={moveScenarioTooltip}
                                                            onMouseLeave={hideScenarioTooltip}
                                                            onFocus={(event) => showScenarioTooltipFromElement(event.currentTarget, epicTooltip)}
                                                            onBlur={hideScenarioTooltip}
                                                        >
                                                        </div>
                                                    );
                                                })}
                                                {laneIssues.map((issue) => {
                                                    const position = scenarioPositions[issue.key];
                                                    if (!position || !scenarioLayout.width) return null;
                                                    const left = `${(position.xStart / scenarioLayout.width) * 100}%`;
                                                    const width = `${Math.max(2, ((position.xEnd - position.xStart) / scenarioLayout.width) * 100)}%`;
                                                    const top = `${position.y - (scenarioLaneMeta.meta.get(lane)?.offset || 0)}px`;
                                                    const displayKey = issue.originalKey || issue.key;
                                                    const issueUrl = scenarioBaseUrl ? `${scenarioBaseUrl}/browse/${displayKey}` : '';
                                                    const issueSummary = normalizeScenarioSummary(issue.summary) || displayKey;
                                                    const isExcluded = excludedEpicSet.has(normalizeEpicKey(issue.epicKey || ''));
                                                    const hasAssigneeConflict = scenarioAssigneeConflicts.conflicts.has(displayKey);
                                                    const conflictingKeys = scenarioAssigneeConflicts.conflictDetails.get(displayKey) || [];
                                                    const issueEndDate = issue.end ? parseScenarioDate(issue.end) : null;
                                                    const isOutOfSprint = issueEndDate && scenarioViewEnd && issueEndDate > scenarioViewEnd;
                                                    const isInProgress = issue.progressPct !== null && issue.progressPct !== undefined;
                                                    const issueTooltip = buildScenarioTooltipPayload(issue.summary || displayKey, displayKey, issue.sp, isExcluded, hasAssigneeConflict, issue.assignee, conflictingKeys, isOutOfSprint, isInProgress, issue.team);
                                                    const isFocused = scenarioHoverKey === issue.key || scenarioFlashKey === issue.key;
                                                    const isUpstream = scenarioUpstreamSet.has(issue.key);
                                                    const isDownstream = scenarioDownstreamSet.has(issue.key);
                                                    const isDimmed = scenarioHoverKey && !isFocused && !isUpstream && !isDownstream;
                                                    const isUnscheduled = !issue.start || !issue.end;
                                                    const isFocusContext = scenarioEpicFocus && scenarioFocusContextKeys.has(issue.key) && !scenarioFocusIssueKeys.has(issue.key);
                                                    const isSearchMatch = scenarioSearchQuery && scenarioSearchMatchSet.has(issue.key);
                                                    const isDone = issue.scheduledReason === 'already_done';
                                                    const isIncomplete = issue.scheduledReason === 'incomplete';
                                                    const incompleteProgress = isIncomplete ? (() => {
                                                        const timeSpent = issue.timeSpentSeconds || 0;
                                                        const sp = Number(issue.sp) || 0;
                                                        if (timeSpent > 0 && sp > 0) {
                                                            const spWeeks = sp * 2; // sp_to_weeks = 2.0
                                                            const spSeconds = spWeeks * 5 * 8 * 3600; // weeks * days/week * hours/day * seconds/hour
                                                            const ratio = Math.min(0.95, Math.max(0.05, timeSpent / spSeconds));
                                                            return `${(ratio * 100).toFixed(0)}%`;
                                                        }
                                                        return '50%'; // fallback
                                                    })() : null;
                                                    const isEditable = scenarioEditMode && !isExcluded && Number(issue.sp) > 0 && !isUnscheduled;
                                                    const isDragging = scenarioDragState?.issueKey === issue.key;
                                                    const hasDepViolation = scenarioDepViolatedKeys.has(issue.key);
                                                    const barClassName = `scenario-bar ${isDone ? 'done' : ''} ${isIncomplete ? 'incomplete' : ''} ${issue.isCritical ? 'critical' : ''} ${issue.isLate ? 'late' : ''} ${((issue.blockedBy || []).length > 0 || scenarioBlockedSet.has(issue.key)) ? 'blocked' : ''} ${(issue.isContext || isFocusContext) ? 'context' : ''} ${isUnscheduled ? 'unscheduled' : ''} ${isFocused ? 'is-focused' : ''} ${isUpstream ? 'is-upstream' : ''} ${isDownstream ? 'is-downstream' : ''} ${isDimmed ? 'dimmed' : ''} ${scenarioFlashKey === issue.key ? 'flash' : ''} ${isExcluded ? 'excluded' : ''} ${isSearchMatch ? 'search-match' : ''} ${hasAssigneeConflict ? 'assignee-conflict' : ''} ${isOutOfSprint ? 'out-of-sprint' : ''} ${isInProgress ? 'in-progress' : ''} ${isEditable ? 'editable' : ''} ${isDragging ? 'dragging' : ''} ${hasDepViolation ? 'dep-violated' : ''}`;
                                                    const barStyle = isIncomplete && incompleteProgress
                                                        ? { left, width, height: `${SCENARIO_BAR_HEIGHT}px`, top, '--incomplete-progress': incompleteProgress }
                                                        : { left, width, height: `${SCENARIO_BAR_HEIGHT}px`, top };
                                                    return (
                                                        <ScenarioBar
                                                            key={issue.key}
                                                            issueKey={issue.key}
                                                            className={barClassName}
                                                            style={barStyle}
                                                            href={issueUrl || '#'}
                                                            displaySummary={issueSummary}
                                                            dateSource={issue.dateSource}
                                                            registerRef={registerScenarioIssueRef(issue.key)}
                                                            onMouseDown={isEditable ? (e) => handleScenarioBarMouseDown(e, issue) : undefined}
                                                            onClick={(event) => {
                                                                event.preventDefault();
                                                                if (scenarioWasDraggedRef.current) { scenarioWasDraggedRef.current = false; return; }
                                                                const taskElement = document.querySelector(`[data-task-key="${issue.key}"]`);
                                                                if (taskElement) {
                                                                    const elementTop = taskElement.getBoundingClientRect().top + window.scrollY;
                                                                    window.scrollTo({ top: elementTop - 100, behavior: 'smooth' });
                                                                    taskElement.classList.add('is-focused');
                                                                    setTimeout(() => {
                                                                        taskElement.classList.remove('is-focused');
                                                                    }, 1400);
                                                                }
                                                            }}
                                                            onMouseEnter={(event) => {
                                                                setScenarioHoverKey(issue.key);
                                                                showScenarioTooltip(event, issueTooltip);
                                                            }}
                                                            onMouseMove={moveScenarioTooltip}
                                                            onMouseLeave={() => {
                                                                setScenarioHoverKey(null);
                                                                hideScenarioTooltip();
                                                            }}
                                                            onFocus={(event) => {
                                                                setScenarioHoverKey(issue.key);
                                                                showScenarioTooltipFromElement(event.currentTarget, issueTooltip);
                                                            }}
                                                            onBlur={() => {
                                                                setScenarioHoverKey(null);
                                                                hideScenarioTooltip();
                                                            }}
                                                        />
                                                    );
                                                })}
                                                {scenarioDragState && scenarioDragState.issueKey && scenarioViewStart && scenarioViewEnd && (() => {
                                                    // Render ghost bar in the lane that contains the dragged issue
                                                    const dragPosition = scenarioPositions[scenarioDragState.issueKey];
                                                    if (!dragPosition || dragPosition.lane !== lane) return null;
                                                    const ghostLeft = dateToPx(scenarioDragState.currentStart, scenarioLayout.width, scenarioViewStart, scenarioViewEnd);
                                                    const ghostRight = dateToPx(scenarioDragState.currentEnd, scenarioLayout.width, scenarioViewStart, scenarioViewEnd);
                                                    const ghostWidth = Math.max(6, ghostRight - ghostLeft);
                                                    const laneMeta = scenarioLaneMeta.meta.get(lane);
                                                    const laneOffset = laneMeta?.offset || 0;
                                                    const ghostTop = dragPosition.y - laneOffset;
                                                    return (
                                                        <div
                                                            className="scenario-drag-ghost"
                                                            style={{
                                                                left: `${ghostLeft}px`,
                                                                width: `${ghostWidth}px`,
                                                                top: `${ghostTop}px`,
                                                                height: `${SCENARIO_BAR_HEIGHT}px`,
                                                                borderRadius: '4px',
                                                            }}
                                                        />
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    )})}
                                </div>
                                {scenarioEdgeRender.width > 0 && (
                                    <svg
                                        className="scenario-deps"
                                        viewBox={`0 0 ${scenarioEdgeRender.width} ${scenarioEdgeRender.height}`}
                                        preserveAspectRatio="none"
                                        style={{ height: `${scenarioEdgeRender.height}px`, width: `${scenarioEdgeRender.width}px` }}
                                    >
                                        <defs>
                                            <marker id="scenario-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                                                <path d="M0,0 L6,3 L0,6 z" fill="#94a3b8" />
                                            </marker>
                                            <marker id="scenario-arrow-block" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                                                <path d="M0,0 L6,3 L0,6 z" fill="#ef4444" />
                                            </marker>
                                            <marker id="scenario-arrow-violated" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                                                <path d="M0,0 L6,3 L0,6 z" fill="#ef4444" />
                                            </marker>
                                        </defs>
                                        {scenarioLaneMode === 'epic' && scenarioEpicEdges.map((edge, index) => (
                                            <g key={`epic-edge-${edge.fromEpic}-${edge.toEpic}-${index}`}>
                                                <path
                                                    className="scenario-epic-edge"
                                                    d={`M 8 ${edge.y1} L 8 ${edge.y2}`}
                                                />
                                                <text className="scenario-epic-edge-label" x="12" y={(edge.y1 + edge.y2) / 2}>
                                                    {edge.count}
                                                </text>
                                            </g>
                                        ))}
                                        {scenarioEdgeRender.paths.map((path) => {
                                            const isViolated = scenarioDepViolations.has(`${path.from}->${path.to}`);
                                            return (
                                                <path
                                                    key={path.id}
                                                    className={`scenario-edge ${path.isActive ? 'active' : ''} ${path.isFaded ? 'faded' : ''} ${path.isContextEdge ? 'context' : ''} ${path.type === 'block' ? 'block' : ''} ${isViolated ? 'violated' : ''}`}
                                                    d={path.d}
                                                    markerEnd={path.type === 'block' ? 'url(#scenario-arrow-block)' : (isViolated ? 'url(#scenario-arrow-violated)' : 'url(#scenario-arrow)')}
                                                />
                                            );
                                        })}
                                    </svg>
                                )}
                                <div
                                    className={`scenario-tooltip ${scenarioTooltip.visible ? 'visible' : ''}`}
                                    style={{ left: `${scenarioTooltip.x}px`, top: `${scenarioTooltip.y}px` }}
                                    ref={scenarioTooltipRef}
                                >
                                    <div>{scenarioTooltip.summary}</div>
                                    {scenarioTooltip.key && <div className="scenario-tooltip-key">{scenarioTooltip.key}</div>}
                                    {scenarioTooltip.assignee && (
                                        <div className="scenario-tooltip-key">👤 {scenarioTooltip.assignee}</div>
                                    )}
                                    {scenarioTooltip.team && (
                                        <div className="scenario-tooltip-key">👥 {scenarioTooltip.team}</div>
                                    )}
                                    {Number.isFinite(scenarioTooltip.sp) && (
                                        <div className="scenario-tooltip-key">SP: {scenarioTooltip.sp.toFixed(1)}</div>
                                    )}
                                    {scenarioTooltip.note && (
                                        <div className="scenario-tooltip-note">{scenarioTooltip.note}</div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
