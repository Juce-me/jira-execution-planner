import { useEffect, useRef, useState } from 'react';

import { readPendingAuthenticationRequired } from '../api/authRequired.js';
import { testJiraConnection } from '../api/configApi.js';
import { ADMIN_SETTINGS_TAB_IDS, DEPARTMENT_SETTINGS_TAB_IDS, SHARED_CONFIGURATION_TAB_IDS } from './settingsTabIds.js';

export function useSettingsModalState() {
    const [adminSettingsTab, setAdminSettingsTab] = useState('scope');
    const [departmentSettingsTab, setDepartmentSettingsTab] = useState('teams');
    const [showGroupManage, setShowGroupManage] = useState(false);
    const [groupTesting, setGroupTesting] = useState(false);
    const [groupTestMessage, setGroupTestMessage] = useState('');
    const [showGroupListMobile, setShowGroupListMobile] = useState(false);
    const [showGroupDiscardConfirm, setShowGroupDiscardConfirm] = useState(false);
    const [groupManageTab, setGroupManageTab] = useState('scope');
    const groupManageButtonRef = useRef(null);
    return {
        adminSettingsTab,
        departmentSettingsTab,
        groupManageButtonRef,
        groupManageTab,
        groupTestMessage,
        groupTesting,
        setAdminSettingsTab,
        setDepartmentSettingsTab,
        setGroupManageTab,
        setGroupTestMessage,
        setGroupTesting,
        setShowGroupDiscardConfirm,
        setShowGroupListMobile,
        setShowGroupManage,
        showGroupDiscardConfirm,
        showGroupListMobile,
        showGroupManage,
    };
}

export function useSettingsModal({
    BACKEND_URL,
    adminAccessAvailable,
    adminSettingsTab,
    canEditEpmConfiguration,
    canEditSharedConfiguration,
    departmentSettingsTab,
    epmConfigBaselineRef,
    epmConfigSaving,
    firstRunConfigurationActive,
    firstRunConfigurationSession,
    groupDraft,
    groupManageTab,
    groupPreferences,
    groupSaving,
    groupsConfig,
    isEpmConfigDirty,
    isGroupDraftDirty,
    openEpmSettingsTab,
    performanceAdminAvailable,
    preferredSettingsTab,
    saveAllSettings,
    saveBlockedReason,
    setAdminSettingsTab,
    setBoardSearchIndex,
    setBoardSearchOpen,
    setBoardSearchQuery,
    setCapacityFieldSearchOpen,
    setCapacityFieldSearchQuery,
    setCapacityProjectSearchOpen,
    setCapacityProjectSearchQuery,
    setComponentSearchIndex,
    setComponentSearchOpen,
    setComponentSearchQuery,
    setDepartmentSettingsTab,
    setEpmConfigDraft,
    setExcludedEpicSearchIndex,
    setExcludedEpicSearchOpen,
    setExcludedEpicSearchQuery,
    setGroupDraftError,
    setGroupImportText,
    setGroupManageTab,
    setGroupTestMessage,
    setGroupTesting,
    setGroupsConfigConflict,
    setProjectSearchIndex,
    setProjectSearchOpen,
    setProjectSearchQuery,
    setSettingsSaveError,
    setShowGroupAdvanced,
    setShowGroupDiscardConfirm,
    setShowGroupImport,
    setShowGroupListMobile,
    setShowGroupManage,
    trackSettingsAction,
    userCanEditSettings,
}) {
    const openGroupManage = (tab = preferredSettingsTab) => {
        setGroupManageTab(tab);
        setShowGroupManage(true);
    };

    const closeGroupManage = () => {
        setShowGroupManage(false);
        setGroupDraftError('');
        setSettingsSaveError('');
        setGroupsConfigConflict(null);
        setGroupImportText('');
        setShowGroupImport(false);
        setShowGroupAdvanced(false);
        setShowGroupDiscardConfirm(false);
        setShowGroupListMobile(false);
        setGroupManageTab(preferredSettingsTab);
        setProjectSearchQuery('');
        setProjectSearchOpen(false);
        setProjectSearchIndex(0);
        setBoardSearchQuery('');
        setBoardSearchOpen(false);
        setBoardSearchIndex(0);
        setComponentSearchQuery('');
        setComponentSearchOpen(false);
        setComponentSearchIndex(0);
        setExcludedEpicSearchQuery('');
        setExcludedEpicSearchOpen(false);
        setExcludedEpicSearchIndex(0);
        setGroupTesting(false);
        setGroupTestMessage('');
        setCapacityProjectSearchQuery('');
        setCapacityProjectSearchOpen(false);
        setCapacityFieldSearchQuery('');
        setCapacityFieldSearchOpen(false);
    };

    const requestCloseGroupManage = () => {
        if (groupSaving) return;
        trackSettingsAction(groupManageTab, 'cancel', { dirty_state: isGroupDraftDirty ? 'dirty' : 'clean' });
        if (isGroupDraftDirty) {
            setShowGroupDiscardConfirm(true);
            return;
        }
        closeGroupManage();
    };

    const discardGroupDraftChanges = () => {
        if (isEpmConfigDirty) {
            try {
                setEpmConfigDraft(JSON.parse(epmConfigBaselineRef.current || '{}'));
            } catch (_) { /* baseline is produced by this document */ }
        }
        setShowGroupDiscardConfirm(false);
        closeGroupManage();
    };
    const labelsTabEnabled = (groupDraft?.groups || groupsConfig.groups || []).length > 0;

    const testGroupsConfigConnection = async () => {
        setGroupTesting(true);
        setGroupTestMessage('');
        trackSettingsAction(groupManageTab, 'test');
        try {
            const response = await testJiraConnection(BACKEND_URL);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `Test failed (${response.status})`);
            }
            setGroupTestMessage(payload.message || 'Connection to Jira API looks good.');
            trackSettingsAction(groupManageTab, 'test_result', { result: 'success' });
        } catch (error) {
            setGroupTestMessage(error?.message || 'Connection test failed.');
            trackSettingsAction(groupManageTab, 'test_result', { result: 'failure' });
        } finally {
            setGroupTesting(false);
        }
    };

    const openUserConnectionsSettings = () => {
        trackSettingsAction('connections', 'open');
        setShowGroupManage(true);
        setGroupManageTab('connections');
    };

    const focusSettingsSubTab = (prefix, tab) => {
        window.requestAnimationFrame(() => {
            const node = document.getElementById(`${prefix}-${tab}-tab`);
            if (node && typeof node.focus === 'function') {
                node.focus();
            }
        });
    };

    const handleSettingsSubTabKeyDown = (event, tabs, currentTab, setTab, prefix) => {
        const currentIndex = Math.max(0, tabs.indexOf(currentTab));
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
            const nextTab = tabs[nextIndex];
            setTab(nextTab);
            focusSettingsSubTab(prefix, nextTab);
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            setTab(tabs[0]);
            focusSettingsSubTab(prefix, tabs[0]);
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            const nextTab = tabs[tabs.length - 1];
            setTab(nextTab);
            focusSettingsSubTab(prefix, nextTab);
        }
    };

    const selectDepartmentSettingsTab = (tab) => {
        if (tab === 'labels' && !labelsTabEnabled) return;
        setDepartmentSettingsTab(tab);
        setGroupManageTab(tab);
    };

    const selectAdminSettingsTab = (tab) => {
        setAdminSettingsTab(tab);
        setGroupManageTab(tab);
    };

    const handleDepartmentSettingsTabKeyDown = (event) => {
        handleSettingsSubTabKeyDown(
            event,
            labelsTabEnabled ? ['teams', 'labels', 'boards'] : ['teams', 'boards'],
            departmentSettingsTab,
            selectDepartmentSettingsTab,
            'department-settings'
        );
    };

    const handleAdminSettingsTabKeyDown = (event) => {
        handleSettingsSubTabKeyDown(
            event,
            ['scope', 'source', 'mapping', 'capacity', 'priorityWeights', ...(adminAccessAvailable ? ['access'] : []), ...(performanceAdminAvailable ? ['performance'] : [])],
            adminSettingsTab,
            selectAdminSettingsTab,
            'admin-settings'
        );
    };

    const activeSettingsModalTab = ADMIN_SETTINGS_TAB_IDS.has(groupManageTab)
        ? 'admin'
        : DEPARTMENT_SETTINGS_TAB_IDS.has(groupManageTab)
            ? 'departments'
            : groupManageTab;
    const activeDepartmentSettingsTab = departmentSettingsTab === 'labels' && !labelsTabEnabled
        ? 'teams'
        : departmentSettingsTab;
    const settingsModalAllTabs = [
        {
            id: 'admin',
            label: 'Admin',
            onClick: () => {
                trackSettingsAction('admin', 'tab_change');
                setGroupManageTab(adminSettingsTab);
            }
        },
        {
            id: 'departments',
            label: 'Departments',
            onClick: () => {
                trackSettingsAction('departments', 'tab_change');
                setGroupManageTab(activeDepartmentSettingsTab);
            }
        },
        {
            id: 'connections',
            label: 'Connections',
            onClick: openUserConnectionsSettings
        },
        {
            id: 'epm',
            label: 'EPM',
            onClick: openEpmSettingsTab
        }
    ];
    const settingsModalTabs = settingsModalAllTabs.filter(tab => {
        if (tab.id === 'epm') return canEditEpmConfiguration;
        if (tab.id === 'admin') return canEditSharedConfiguration;
        return true;
    });
    const settingsSaveHandler = () => {
        setSettingsSaveError('');
        void saveAllSettings({
            firstRunSession: firstRunConfigurationActive ? firstRunConfigurationSession : null,
        }).then((outcome) => {
            if (outcome?.error) setSettingsSaveError(outcome.error);
        });
    };
    const settingsShowsSave = groupManageTab !== 'connections';
    const settingsSaveDisabled = Boolean(saveBlockedReason);
    const settingsSaveTitle = saveBlockedReason || '';
    const settingsSaveLabel = groupSaving || epmConfigSaving
        ? 'Saving...'
        : (firstRunConfigurationActive && groupPreferences.onboardingDone === false ? 'Save and continue' : 'Save');

    const openBoardDepartmentSettings = (tab) => {
        trackSettingsAction(tab, 'open', { source_surface: 'board' });
        setShowGroupManage(true);
        selectDepartmentSettingsTab(tab);
    };
    const openBoardAdminScopeSettings = () => {
        if (userCanEditSettings !== true) return;
        trackSettingsAction('scope', 'open', { source_surface: 'board' });
        setShowGroupManage(true);
        selectAdminSettingsTab('scope');
    };

    return {
        activeDepartmentSettingsTab,
        activeSettingsModalTab,
        closeGroupManage,
        discardGroupDraftChanges,
        handleAdminSettingsTabKeyDown,
        handleDepartmentSettingsTabKeyDown,
        labelsTabEnabled,
        openBoardAdminScopeSettings,
        openBoardDepartmentSettings,
        openGroupManage,
        requestCloseGroupManage,
        selectAdminSettingsTab,
        selectDepartmentSettingsTab,
        settingsModalTabs,
        settingsSaveDisabled,
        settingsSaveHandler,
        settingsSaveLabel,
        settingsSaveTitle,
        settingsShowsSave,
        testGroupsConfigConnection,
    };
}

export function useSettingsAutoOpenEffect({
    groupConfigSource,
    groupsLoading,
    setShowGroupManage,
}) {
    // Auto-open settings modal on first launch (no config file exists)
    const hasAutoOpenedRef = useRef(false);
    useEffect(() => {
        if (hasAutoOpenedRef.current) return;
        if (groupsLoading) return;
        if (groupConfigSource === 'auto') {
            hasAutoOpenedRef.current = true;
            setShowGroupManage(true);
        }
    }, [groupsLoading, groupConfigSource]);
}

export function useSettingsHotkeyEffect({
    closeAllTeamSearchDropdowns,
    epmConfigSaving,
    firstRunConfigurationActive,
    firstRunConfigurationSession,
    groupManageTab,
    groupSaving,
    requestCloseGroupManage,
    saveAllSettings,
    setShowGroupDiscardConfirm,
    showGroupDiscardConfirm,
    showGroupManage,
    teamSearchOpen,
}) {
    useEffect(() => {
        if (!showGroupManage) return;
        const handleKey = (event) => {
            if (readPendingAuthenticationRequired()) return;
            const key = event.key;
            if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 's') {
                event.preventDefault();
                if (groupManageTab === 'connections') return;
                if (!groupSaving && !epmConfigSaving) void saveAllSettings({
                    firstRunSession: firstRunConfigurationActive ? firstRunConfigurationSession : null,
                });
                return;
            }
            if (key === 'Escape') {
                if (firstRunConfigurationActive) {
                    event.preventDefault();
                    const target = document.querySelector(`[data-first-run-guide-target="${firstRunConfigurationSession.guideStep}"]`);
                    target?.focus?.();
                    return;
                }
                const hasOpenDropdown = Object.values(teamSearchOpen || {}).some(Boolean);
                if (hasOpenDropdown) {
                    event.preventDefault();
                    closeAllTeamSearchDropdowns();
                    return;
                }
                if (showGroupDiscardConfirm) {
                    event.preventDefault();
                    setShowGroupDiscardConfirm(false);
                    return;
                }
                event.preventDefault();
                requestCloseGroupManage();
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [showGroupManage, groupManageTab, groupSaving, epmConfigSaving, firstRunConfigurationActive, firstRunConfigurationSession, teamSearchOpen, showGroupDiscardConfirm, requestCloseGroupManage, saveAllSettings]);
}

export function useSettingsTabGuardEffects({
    canEditEpmConfiguration,
    canEditSharedConfiguration,
    groupManageTab,
    setAdminSettingsTab,
    setDepartmentSettingsTab,
    setGroupManageTab,
    showGroupManage,
}) {
    useEffect(() => {
        if (!showGroupManage) return;
        if (groupManageTab === 'epm') {
            if (!canEditEpmConfiguration) {
                setGroupManageTab('teams');
            }
            return;
        }
        if (!canEditSharedConfiguration && SHARED_CONFIGURATION_TAB_IDS.has(groupManageTab)) {
            setGroupManageTab('teams');
        }
    }, [showGroupManage, canEditSharedConfiguration, canEditEpmConfiguration, groupManageTab]);
    useEffect(() => {
        if (ADMIN_SETTINGS_TAB_IDS.has(groupManageTab)) {
            setAdminSettingsTab(groupManageTab);
        }
        if (DEPARTMENT_SETTINGS_TAB_IDS.has(groupManageTab)) {
            setDepartmentSettingsTab(groupManageTab);
        }
    }, [groupManageTab]);
}
