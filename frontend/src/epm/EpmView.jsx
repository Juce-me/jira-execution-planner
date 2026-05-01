import * as React from 'react';
import EmptyState from '../ui/EmptyState.jsx';
import { EpmRollupPanel } from './EpmRollupPanel.jsx';

export function EpmView({
    selectedView,
    epmConfigLoaded,
    epmProjectsLoading,
    epmRollupBoards,
    epmRollupTree,
    epmSelectedProjectId,
    selectedEpmProject,
    selectedEpmProjectUpdateLine,
    epmTab,
    selectedSprint,
    epmRollupLoading,
    visibleEpmRollupBoards,
    epmDuplicates,
    epmAggregateTruncated,
    epmProjectRollupLoadingIds,
    searchQuery,
    loadArchivedEpmProjectRollup,
    renderEpicBlock,
    openEpmSettingsTab,
    jiraUrl,
    InitiativeIcon,
}) {
    if (selectedView !== 'epm') return null;

    return (
        <>
            {!epmConfigLoaded && (
                <EmptyState title="Loading EPM settings">
                    <p>Loading saved project configuration.</p>
                </EmptyState>
            )}

            {epmConfigLoaded && epmProjectsLoading && !epmRollupBoards && !epmRollupTree && (
                <EmptyState title="Loading EPM projects">
                    <p>Refreshing Atlassian Home project metadata.</p>
                </EmptyState>
            )}

            {epmConfigLoaded && epmSelectedProjectId && !epmProjectsLoading && !selectedEpmProject && (
                <EmptyState title="Project unavailable">
                    <p>This project is not available in the current EPM tab.</p>
                </EmptyState>
            )}

            {epmConfigLoaded && (!epmProjectsLoading || epmRollupBoards || epmRollupTree) && (!epmSelectedProjectId || selectedEpmProject) && (
                <EpmRollupPanel
                    selectedEpmProject={selectedEpmProject}
                    selectedEpmProjectUpdateLine={selectedEpmProjectUpdateLine}
                    epmTab={epmTab}
                    selectedSprint={selectedSprint}
                    epmRollupLoading={epmRollupLoading}
                    epmRollupTree={epmRollupTree}
                    epmRollupBoards={visibleEpmRollupBoards}
                    epmDuplicates={epmDuplicates}
                    epmAggregateTruncated={epmAggregateTruncated}
                    epmProjectRollupLoadingIds={epmProjectRollupLoadingIds}
                    searchQuery={searchQuery}
                    onProjectExpand={loadArchivedEpmProjectRollup}
                    renderEpicBlock={renderEpicBlock}
                    openEpmSettingsTab={openEpmSettingsTab}
                    jiraUrl={jiraUrl}
                    InitiativeIcon={InitiativeIcon}
                />
            )}
        </>
    );
}
