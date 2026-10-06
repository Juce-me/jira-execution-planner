import * as React from 'react';

import SettingsModal from './SettingsModal.jsx';
import { groupConfigConflictMessages } from './groupsConfigConflict.js';
import { SHARED_CONFIGURATION_TAB_IDS } from './settingsTabIds.js';
import { workspaceConfigConflictMessages } from './workspaceConfigConflict.js';

export default function SettingsModalContainer({
    activeSettingsModalTab,
    canEditEpmConfiguration,
    cancelFirstRunConfiguration,
    discardGroupDraftChanges,
    discardMineOnGroupsConfigConflict,
    firstRunConfigurationActive,
    firstRunHasCommittedSection,
    groupConfigValidationErrors,
    groupDraftError,
    groupManageTab,
    groupTestMessage,
    groupTesting,
    groupsConfigConflict,
    isEpmConfigDirty,
    isGroupBoardDraftDirty,
    isGroupDraftDirty,
    isGroupVisibilityDraftDirty,
    keepMineOnGroupsConfigConflict,
    keepMineOnWorkspaceConfigConflict,
    requestCloseGroupManage,
    setShowGroupDiscardConfirm,
    settingsHeaderAction,
    settingsModalTabs,
    settingsSaveDisabled,
    settingsSaveError,
    settingsSaveHandler,
    settingsSaveLabel,
    settingsSaveTitle,
    settingsShowsSave,
    showGroupDiscardConfirm,
    testGroupsConfigConnection,
    unsavedSectionsCount,
    useLatestWorkspaceConfig,
    workspaceConfigConflict,
    children,
}) {
    return (
        <SettingsModal
            headerAction={settingsHeaderAction}
            activeTab={activeSettingsModalTab}
            tabs={settingsModalTabs}
            isDirty={groupManageTab !== 'connections' && isGroupDraftDirty}
            unsavedSectionsCount={groupManageTab !== 'connections' ? unsavedSectionsCount : 0}
            onRequestClose={firstRunConfigurationActive ? () => {} : requestCloseGroupManage}
            validationMessages={groupManageTab !== 'connections' ? [...workspaceConfigConflictMessages(workspaceConfigConflict), ...groupConfigConflictMessages(groupsConfigConflict, { isBoardDraftDirty: isGroupBoardDraftDirty, pending: { epm: canEditEpmConfiguration && isEpmConfigDirty, groupVisibility: isGroupVisibilityDraftDirty } }), ...((settingsSaveError || groupDraftError) && SHARED_CONFIGURATION_TAB_IDS.has(groupManageTab) && !workspaceConfigConflict && !groupsConfigConflict ? [settingsSaveError || groupDraftError] : []), ...groupConfigValidationErrors] : []}
            validationActions={groupManageTab !== 'connections' && workspaceConfigConflict && !firstRunHasCommittedSection ? (
                <div className="group-modal-button-row" data-testid="workspace-config-conflict-actions">
                    <button className="secondary compact" onClick={useLatestWorkspaceConfig} type="button">Use latest</button>
                    <button className="compact" onClick={keepMineOnWorkspaceConfigConflict} type="button">Keep mine</button>
                </div>
            ) : groupManageTab !== 'connections' && groupsConfigConflict && !firstRunHasCommittedSection ? (
                <div className="group-modal-button-row">
                    <button className="secondary compact" onClick={discardMineOnGroupsConfigConflict} type="button">Discard mine</button>
                    <button className="compact" onClick={keepMineOnGroupsConfigConflict} type="button">Keep mine</button>
                </div>
            ) : null}
            showTestConfiguration={!['epm', 'connections', 'access', 'performance'].includes(groupManageTab)}
            onTestConfiguration={testGroupsConfigConnection}
            testConfigurationDisabled={groupTesting}
            testConfigurationLabel={groupTesting ? 'Testing...' : 'Test configuration'}
            testConfigurationMessage={groupTestMessage}
            onCancel={firstRunConfigurationActive ? cancelFirstRunConfiguration : requestCloseGroupManage}
            cancelLabel={groupManageTab === 'connections' ? 'Close' : 'Cancel'}
            onSave={settingsSaveHandler}
            showSave={settingsShowsSave}
            saveDisabled={settingsSaveDisabled}
            saveTitle={settingsSaveTitle}
            saveLabel={settingsSaveLabel}
            showDiscardConfirm={showGroupDiscardConfirm}
            onDiscard={discardGroupDraftChanges}
            onKeepEditing={() => setShowGroupDiscardConfirm(false)}
        >
            {children}
        </SettingsModal>
    );
}
