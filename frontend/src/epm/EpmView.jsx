import * as React from 'react';
import EmptyState from '../ui/EmptyState.jsx';
import LoadingState from '../ui/LoadingState.jsx';
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
    openEpmSettingsTab,
    jiraUrl,
    InitiativeIcon,
}) {
    if (selectedView !== 'epm') return null;

    return (
        <>
            {!epmConfigLoaded && (
                <LoadingState
                    title="Loading EPM settings"
                    message="Loading saved project configuration."
                />
            )}

            {epmConfigLoaded && epmProjectsLoading && !epmRollupBoards && !epmRollupTree && (
                <LoadingState
                    title="Loading EPM projects"
                    message="Refreshing Atlassian Home project metadata."
                />
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
                    openEpmSettingsTab={openEpmSettingsTab}
                    jiraUrl={jiraUrl}
                    InitiativeIcon={InitiativeIcon}
                />
            )}
        </>
    );
}
