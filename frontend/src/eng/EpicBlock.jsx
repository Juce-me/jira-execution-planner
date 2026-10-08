import * as React from 'react';
import { getIssueStatusClassName, getIssueTeamLabel } from '../issues/issueViewUtils.js';
import { getEpicEffectivePriority, getProjectTrackEmoji, getProjectTrackLabel } from './engTaskUtils.js';
import EpicHeaderValueReadout from './EpicHeaderValueReadout.jsx';
import IssuePersonEditor from '../issues/IssuePersonEditor.jsx';
import PriorityTransitionMenu from '../issues/PriorityTransitionMenu.jsx';
import ProjectTrackTransitionMenu from '../issues/ProjectTrackTransitionMenu.jsx';
import StatusTransitionMenu from '../issues/StatusTransitionMenu.jsx';
import StatusPill from '../ui/StatusPill.jsx';
import EpicRefreshButton from '../ui/EpicRefreshButton.jsx';
import StoryRequirementCard from './StoryRequirementCard.jsx';
import IssueCard from '../issues/IssueCard.jsx';

export function EpicBlock({
    epicGroup,
    statusTransitionActiveKey,
    priorityTransitionActiveKey,
    projectTrackTransitionActiveKey,
    issueFieldEdits,
    issueFieldEditsEnabled,
    jiraUrl,
    statusTransitionSourceSurface,
    excludedEpicSet,
    normalizeEpicKey,
    stickyEpicFocusKey,
    epicRefMap,
    priorityTransitionEnabled,
    renderPriorityIcon,
    priorityOptions,
    priorityOptionsLoading,
    prioritySubmitting,
    pendingPriorityIssueKeys,
    priorityError,
    priorityResult,
    openPriorityControl,
    closePriorityControl,
    submitPriorityChange,
    onboardingPreviewSession,
    handleOnboardingPreviewLifecycleChange,
    projectTrackTransitionEnabled,
    projectTrackOptions,
    projectTrackOptionsLoading,
    projectTrackSubmitting,
    pendingProjectTrackIssueKeys,
    projectTrackError,
    projectTrackResult,
    openProjectTrackControl,
    closeProjectTrackControl,
    submitProjectTrackChange,
    showStats,
    showPlanning,
    toggleSharedGroupExcludedCapacityEpic,
    canToggleSharedGroupExcludedCapacity,
    canEditSharedConfiguration,
    showGroupManage,
    isGroupDraftDirty,
    statusTransitionEnabled,
    transitionOptions,
    transitionOptionsLoading,
    statusTransitionSubmitting,
    pendingStatusIssueKeys,
    transitionError,
    transitionErrorCode,
    transitionResult,
    openSingleIssueStatusControl,
    prefetchSingleIssueStatusOptions,
    closeSingleIssueStatusControl,
    handleSubmitStatusTransition,
    isEpicRefreshMode,
    epicRefresh,
    getTeamInfo,
    selectedTasks,
    toggleTaskSelection,
    removeTask,
    shouldRenderIssueDependencies,
    issueDependencyContext,
    storySubtasksByKey,
    toggleStorySubtasks,
    retryStorySubtasks,
    statusTransitionTargetsCount,
}) {
    const epicInfo = epicGroup.epic;
    const epicTitle = epicInfo?.summary || epicGroup.parentSummary ||
        (epicGroup.key === 'NO_EPIC' ? 'No Epic Linked' : epicGroup.key);
    const epicTotalSp = epicGroup.storyPoints || 0;
    const epicStatus = typeof epicInfo?.status === 'string'
        ? epicInfo.status
        : epicInfo?.status?.name || '';
    const epicStatusClassName = epicStatus
        ? getIssueStatusClassName(epicStatus, 'epic-status-pill')
        : '';
    const effectivePriority = getEpicEffectivePriority(epicGroup);
    // The header icon shows the derived (most-urgent child) priority, but the
    // priority menu edits the Epic's OWN priority field; normalize it to a name
    // the same way epicStatus is handled above.
    const epicOwnPriority = typeof epicInfo?.priority === 'string'
        ? epicInfo.priority
        : epicInfo?.priority?.name || '';
    const projectTrackValue = epicInfo?.projectTrack || '';
    const projectTrackEmoji = getProjectTrackEmoji(projectTrackValue);
    const epicInteractionActive = statusTransitionActiveKey === epicGroup.key
        || priorityTransitionActiveKey === epicGroup.key
        || projectTrackTransitionActiveKey === epicGroup.key
        || issueFieldEdits.activeEditor?.issueKey === epicGroup.key;
    const renderEpicPersonEditor = (field, label, value) => {
        const editableEpic = issueFieldEditsEnabled && epicGroup.key !== 'NO_EPIC' && Boolean(epicInfo), active = editableEpic && issueFieldEdits.activeEditor?.issueKey === epicGroup.key && issueFieldEdits.activeEditor.field === field;
        const displayName = value?.displayName || (field === 'deliveryOwner' ? 'Not set' : 'Unassigned');
        if (!editableEpic) {
            return (
                <EpicHeaderValueReadout value={displayName} suppressed={epicInteractionActive}>
                    {({ discoveryProps }) => (
                        <span {...discoveryProps} className="epic-full-value-trigger epic-assignee-value">
                            {displayName}
                        </span>
                    )}
                </EpicHeaderValueReadout>
            );
        }
        return (
            <EpicHeaderValueReadout
                value={displayName}
                suppressed={epicInteractionActive}
                measureSelector="[data-issue-person-editor-trigger]"
                nativeSelector="[data-issue-person-editor-trigger]"
            >
                {({ triggerRef, pointerProps, focusProps }) => (
                    <span ref={triggerRef} {...pointerProps} {...focusProps} className="epic-full-value-trigger epic-assignee-value">
                        <IssuePersonEditor issueKey={epicGroup.key} field={field} fieldLabel={label} currentValue={value} isOpen={active} metadata={active ? issueFieldEdits.metadata : null}
                            suggestions={active ? issueFieldEdits.suggestions : []} query={active ? issueFieldEdits.searchQuery : ''} loading={active && issueFieldEdits.status === 'loading'} searching={active && issueFieldEdits.searching}
                            submitting={active && ['queued', 'saving'].includes(issueFieldEdits.status)} pending={issueFieldEdits.pendingIssueKeys.has(epicGroup.key)} error={active ? issueFieldEdits.errorMessage : ''} statusMessage={active && issueFieldEdits.status === 'confirmed' ? 'Saved in Jira.' : active && issueFieldEdits.outcome?.status === 'observed' ? 'Current value loaded from Jira.' : ''} recoveryMode={active && issueFieldEdits.status === 'conflict' ? 'reload' : active && issueFieldEdits.status === 'unknown' ? 'check_jira' : ''} configurationChanged={active && issueFieldEdits.outcome?.configurationChanged === true} jiraUrl={jiraUrl}
                            onOpen={() => issueFieldEdits.openEditor({ issueKey: epicGroup.key, field, issueKind: 'epic', sourceSurface: statusTransitionSourceSurface })} onClose={issueFieldEdits.closeEditor} onSearch={issueFieldEdits.search} onSelect={issueFieldEdits.submit} onReload={issueFieldEdits.reload} onCheckJira={issueFieldEdits.checkJira} />
                    </span>
                )}
            </EpicHeaderValueReadout>
        );
    };
    return (
        <div
            key={epicGroup.key}
            className={`epic-block ${epicGroup.hasNoChildStories ? 'epic-block-no-child-stories' : ''} ${excludedEpicSet.has(normalizeEpicKey(epicGroup.key)) ? 'epic-excluded' : ''} ${stickyEpicFocusKey === epicGroup.key ? 'epic-block-sticky-focus' : ''}`}
            data-onboarding-target="hierarchy-epic"
            data-epic-key={epicGroup.key}
            ref={(node) => {
                if (!node) {
                    epicRefMap.current.delete(epicGroup.key);
                    return;
                }
                epicRefMap.current.set(epicGroup.key, node);
            }}
        >
                <div className="epic-header">
                    <div className="epic-title">
                        <div className="epic-title-row">
                        <span className="epic-icon" aria-hidden="true" title="EPIC">
                            <svg viewBox="0 0 16 16" fill="none">
                                <path
                                    clipRule="evenodd"
                                    d="m10.271.050656c.2887.111871.479.38969.479.699344v4.63515l3.1471.62941c.2652.05303.4812.24469.5655.50161s.0238.53933-.1584.73914l-7.74997 8.49999c-.20863.2288-.53644.3059-.82517.194-.28874-.1118-.47905-.3896-.47905-.6993v-4.6351l-3.14708-.62947c-.26515-.05303-.48123-.24468-.56553-.5016-.08431-.25692-.02379-.53933.1584-.73915l7.75-8.499996c.20863-.2288201.53643-.305899.8252-.194028zm-6.57276 8.724134 3.05177.61036v3.92915l5.55179-6.08909-3.05179-.61036v-3.9291z"
                                    fill="#bf63f3"
                                    fillRule="evenodd"
                                />
                            </svg>
                        </span>
                        {effectivePriority.name && (
                            (priorityTransitionEnabled && epicGroup.key !== 'NO_EPIC') ? (
                                <PriorityTransitionMenu
                                    issue={{ key: epicGroup.key, priority: epicOwnPriority, summary: epicTitle }}
                                    fallbackIssueType="Epic"
                                    priorityLabel={effectivePriority.name}
                                    currentPriorityLabel={epicOwnPriority}
                                    renderPriorityIcon={renderPriorityIcon}
                                    isOpen={priorityTransitionActiveKey === epicGroup.key}
                                    options={priorityOptions}
                                    optionsLoading={priorityOptionsLoading}
                                    submitting={prioritySubmitting || pendingPriorityIssueKeys.has(epicGroup.key)}
                                    error={priorityError}
                                    result={priorityResult}
                                    onOpen={openPriorityControl}
                                    onClose={closePriorityControl}
                                    onSubmit={submitPriorityChange}
                                    previewOnly={onboardingPreviewSession}
                                    onPreviewLifecycleChange={handleOnboardingPreviewLifecycleChange}
                                />
                            ) : (
                                renderPriorityIcon(effectivePriority.name, epicGroup.key)
                            )
                        )}
                        {epicGroup.key !== 'NO_EPIC' && (
                            projectTrackTransitionEnabled ? (
                                <ProjectTrackTransitionMenu
                                    epicKey={epicGroup.key}
                                    currentTrack={projectTrackValue}
                                    isOpen={projectTrackTransitionActiveKey === epicGroup.key}
                                    options={projectTrackOptions}
                                    optionsLoading={projectTrackOptionsLoading}
                                    submitting={projectTrackSubmitting || pendingProjectTrackIssueKeys.has(epicGroup.key)}
                                    error={projectTrackError}
                                    result={projectTrackResult}
                                    onOpen={openProjectTrackControl}
                                    onClose={closeProjectTrackControl}
                                    onSubmit={submitProjectTrackChange}
                                    previewOnly={onboardingPreviewSession}
                                    onPreviewLifecycleChange={handleOnboardingPreviewLifecycleChange}
                                />
                            ) : (
                                <span
                                    className="epic-track-indicator"
                                    title={`Project Track: ${getProjectTrackLabel(projectTrackValue)}`}
                                    aria-label={`Project Track: ${getProjectTrackLabel(projectTrackValue)}`}
                                >
                                    {projectTrackEmoji}
                                </span>
                            )
                        )}
                        {epicGroup.key !== 'NO_EPIC' ? (
                            <EpicHeaderValueReadout
                                value={epicTitle}
                                suppressed={epicInteractionActive}
                                measureSelector=".epic-name"
                            >
                                {({ triggerRef, describedBy, pointerProps, focusProps }) => (
                                    <a
                                        ref={triggerRef}
                                        className="epic-link epic-full-value-trigger"
                                        href={jiraUrl ? `${jiraUrl}/browse/${epicGroup.key}` : '#'}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label={epicTitle}
                                        aria-describedby={describedBy}
                                        {...pointerProps}
                                        {...focusProps}
                                    >
                                        <span className="epic-name">{epicTitle}</span>
                                        <span className="epic-key">{epicGroup.key}</span>
                                    </a>
                                )}
                            </EpicHeaderValueReadout>
                        ) : (
                            <>
                                <EpicHeaderValueReadout value={epicTitle} suppressed={epicInteractionActive}>
                                    {({ discoveryProps }) => (
                                        <span {...discoveryProps} className="epic-name epic-full-value-trigger">{epicTitle}</span>
                                    )}
                                </EpicHeaderValueReadout>
                                <span className="epic-key">Unassigned</span>
                            </>
                        )}
                        {(showStats || showPlanning) && (
                            <button
                                className={`epic-stat-toggle ${excludedEpicSet.has(normalizeEpicKey(epicGroup.key)) ? '' : 'active'}`}
                                onClick={() => toggleSharedGroupExcludedCapacityEpic(epicGroup.key)}
                                disabled={!canToggleSharedGroupExcludedCapacity}
                                title={!canEditSharedConfiguration
                                    ? 'You do not have permission to edit shared group capacity settings'
                                    : (showGroupManage && isGroupDraftDirty)
                                        ? 'Save or discard open Department settings changes before changing excluded capacity'
                                        : 'Include/exclude this epic in shared group capacity and reporting'}
                            >
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                                    <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                                {excludedEpicSet.has(normalizeEpicKey(epicGroup.key)) ? 'Excluded' : 'Included'}
                            </button>
                        )}
                    </div>
                    </div>
                    <div className="epic-meta">
                        {epicStatus && (
                            <EpicHeaderValueReadout
                                value={epicStatus}
                                suppressed={epicInteractionActive}
                                measureSelector=".status-pill"
                                nativeSelector={statusTransitionEnabled && epicGroup.key !== 'NO_EPIC' ? '.status-pill' : ''}
                            >
                                {statusTransitionEnabled && epicGroup.key !== 'NO_EPIC' ? (
                                    ({ triggerRef, pointerProps, focusProps }) => (
                                        <span ref={triggerRef} {...pointerProps} {...focusProps} className="epic-full-value-trigger epic-status-readout-target">
                                            <StatusTransitionMenu
                                                issue={{ key: epicGroup.key, status: epicStatus, summary: epicTitle }}
                                                fallbackIssueType="Epic"
                                                statusLabel={epicStatus}
                                                statusClassName={epicStatusClassName}
                                                sourceSurface={statusTransitionSourceSurface}
                                                isOpen={statusTransitionActiveKey === epicGroup.key}
                                                options={transitionOptions}
                                                optionsLoading={transitionOptionsLoading}
                                                submitting={statusTransitionSubmitting || pendingStatusIssueKeys.has(epicGroup.key)}
                                                error={transitionError}
                                                errorCode={transitionErrorCode}
                                                result={transitionResult}
                                                onOpen={openSingleIssueStatusControl} onPrefetch={prefetchSingleIssueStatusOptions}
                                                onClose={closeSingleIssueStatusControl}
                                                onSubmit={(targetStatus) => handleSubmitStatusTransition(targetStatus, { key: epicGroup.key }, { singleIssue: true })}
                                                previewOnly={onboardingPreviewSession}
                                                onPreviewLifecycleChange={handleOnboardingPreviewLifecycleChange}
                                            />
                                        </span>
                                    )
                                ) : (
                                    ({ triggerRef, truncated, describedBy, pointerProps, focusProps }) => (
                                        <span
                                            ref={triggerRef}
                                            {...pointerProps}
                                            {...focusProps}
                                            className="epic-full-value-trigger epic-status-readout-target"
                                            tabIndex={truncated ? 0 : undefined}
                                            aria-label={epicStatus}
                                            aria-describedby={describedBy}
                                        >
                                            <StatusPill
                                                className={`${epicStatusClassName} epic-status-value`}
                                                label={epicStatus}
                                                status={epicStatus}
                                            />
                                        </span>
                                    )
                                )}
                            </EpicHeaderValueReadout>
                        )}
                        <span className="epic-story-points">SP: {epicTotalSp.toFixed(1)}</span>
                        {(epicInfo?.assignee?.displayName || (issueFieldEditsEnabled && epicGroup.key !== 'NO_EPIC' && epicInfo)) && (
                            <span className="task-assignee epic-assignee">
                                <span className="task-assignee-icon" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" fill="none">
                                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z" stroke="currentColor" strokeWidth="2" />
                                        <path d="M4 20c0-3.31 3.58-6 8-6s8 2.69 8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    </svg>
                                </span>
                                {renderEpicPersonEditor('assignee', 'Assignee', epicInfo?.assignee)}
                            </span>
                        )}
                    </div>
                {isEpicRefreshMode && epicGroup.key !== 'NO_EPIC' && (
                    <EpicRefreshButton epicKey={epicGroup.key} epicName={epicTitle} state={epicRefresh.epicStates[epicGroup.key] || 'idle'} onRefresh={epicRefresh.refreshEpic} />
                )}
                </div>
            {(epicGroup.rows || epicGroup.tasks.map(task => ({ kind: 'story', id: task.key, task }))).map(row => {
                if (row.kind === 'story_requirement') {
                    return (
                        <StoryRequirementCard
                            key={row.id}
                            requirement={row}
                            jiraUrl={jiraUrl}
                            sourceSurface={showPlanning ? 'planning' : 'catch_up'}
                        />
                    );
                }
                const task = row.task;
                const teamInfo = getTeamInfo(task);
                const teamLabel = getIssueTeamLabel(teamInfo);
                const statusClassName = getIssueStatusClassName(task.fields.status?.name);
                return (
                    <IssueCard
                        key={task.key}
                        task={task}
                        jiraUrl={jiraUrl}
                        teamInfo={teamInfo}
                        teamLabel={teamLabel}
                        statusClassName={statusClassName}
                        renderPriorityIcon={renderPriorityIcon}
                        showPlanning={showPlanning}
                        isSelected={!!selectedTasks[task.key]}
                        onToggleSelection={toggleTaskSelection}
                        onRemove={removeTask}
                        isLeaving={epicRefresh.leavingKeys.has(task.key)}
                        shouldRenderIssueDependencies={shouldRenderIssueDependencies}
                        dependencyContext={issueDependencyContext}
                        subtaskState={storySubtasksByKey[task.key] || null}
                        onToggleSubtasks={toggleStorySubtasks}
                        onRetrySubtasks={retryStorySubtasks}
                        statusTransitionEnabled={statusTransitionEnabled}
                        statusTransitionSourceSurface={statusTransitionSourceSurface}
                        statusTransitionActiveKey={statusTransitionActiveKey}
                        statusTransitionOptions={transitionOptions}
                        statusTransitionOptionsLoading={transitionOptionsLoading}
                        statusTransitionSubmitting={statusTransitionSubmitting}
                        statusTransitionError={transitionError}
                        statusTransitionErrorCode={transitionErrorCode}
                        statusTransitionResult={transitionResult}
                        statusTransitionTargetsCount={statusTransitionTargetsCount}
                        statusTransitionPendingIssueKeys={pendingStatusIssueKeys}
                        onOpenStatusTransition={openSingleIssueStatusControl} onPrefetchStatusTransition={prefetchSingleIssueStatusOptions}
                        onCloseStatusTransition={closeSingleIssueStatusControl}
                        onSubmitStatusTransition={handleSubmitStatusTransition}
                        priorityTransitionEnabled={priorityTransitionEnabled}
                        priorityTransitionActiveKey={priorityTransitionActiveKey}
                        priorityTransitionOptions={priorityOptions}
                        priorityTransitionOptionsLoading={priorityOptionsLoading}
                        priorityTransitionSubmitting={prioritySubmitting}
                        priorityTransitionError={priorityError}
                        priorityTransitionResult={priorityResult}
                        priorityTransitionPendingIssueKeys={pendingPriorityIssueKeys}
                        onOpenPriorityTransition={openPriorityControl}
                        onClosePriorityTransition={closePriorityControl}
                        onSubmitPriorityTransition={submitPriorityChange}
                        onboardingPreviewSession={onboardingPreviewSession}
                        onPreviewLifecycleChange={handleOnboardingPreviewLifecycleChange}
                        issueFieldEdits={issueFieldEditsEnabled ? issueFieldEdits : null}
                    />
                );
            })}
        </div>
    );
}
