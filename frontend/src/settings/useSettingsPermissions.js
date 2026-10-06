import { useState } from 'react';

import { useAdminAccessSettings } from './AdminAccessSettings.jsx';

// Settings permission cells, set only from the config bootstrap and the post-save refresh.
// Editing the administrator sections is granted only by an explicit `userCanEditSettings === true`;
// `settingsAdminOnly` is write-only metadata and never grants anything.
export function useSettingsPermissions({
    BACKEND_URL,
    groupManageTab,
    showGroupManage,
}) {
    const [, setSettingsAdminOnly] = useState(true);
    const [userCanEditSettings, setUserCanEditSettings] = useState(false);
    const [performanceAdminAvailable, setPerformanceAdminAvailable] = useState(false);
    const [userCanEditEpmConfig, setUserCanEditEpmConfig] = useState(false);
    const [adminUserManagementAvailable, setAdminUserManagementAvailable] = useState(false);
    const [userIsToolAdmin, setUserIsToolAdmin] = useState(false);
    const adminAccessAvailable = !adminUserManagementAvailable || userIsToolAdmin; // DB user directory: tool admins only
    const [environmentConfigExists, setEnvironmentConfigExists] = useState(false);
    const adminAccess = useAdminAccessSettings({
        backendUrl: BACKEND_URL,
        available: adminUserManagementAvailable && userIsToolAdmin,
        active: showGroupManage && groupManageTab === 'access',
    });
    const canEditSharedConfiguration = userCanEditSettings === true;
    const canEditEpmConfiguration = userCanEditEpmConfig === true;
    const preferredSettingsTab = canEditSharedConfiguration && !environmentConfigExists ? 'scope' : 'teams';
    const applyBootstrapPermissions = (config) => {
        setSettingsAdminOnly(Boolean(config.settingsAdminOnly));
        setUserCanEditSettings(config.userCanEditSettings === true);
        setUserCanEditEpmConfig(config.userCanEditEpmConfig === true);
        setAdminUserManagementAvailable(config.adminUserManagementAvailable === true);
        setUserIsToolAdmin(config.userIsToolAdmin === true);
        setEnvironmentConfigExists(Boolean(config.environmentConfigExists || config.projectsConfigured));
    };
    // The post-save refresh omits setUserIsToolAdmin (and, in loadConfig, the performance flag and Jira URL).
    const applySavePermissions = (config) => {
        setSettingsAdminOnly(Boolean(config.settingsAdminOnly));
        setUserCanEditSettings(config.userCanEditSettings === true);
        setUserCanEditEpmConfig(config.userCanEditEpmConfig === true);
        setAdminUserManagementAvailable(config.adminUserManagementAvailable === true);
        setEnvironmentConfigExists(Boolean(config.environmentConfigExists || config.projectsConfigured));
    };
    return {
        adminAccess,
        adminAccessAvailable,
        adminUserManagementAvailable,
        applyBootstrapPermissions,
        applySavePermissions,
        canEditEpmConfiguration,
        canEditSharedConfiguration,
        performanceAdminAvailable,
        preferredSettingsTab,
        setPerformanceAdminAvailable,
        userCanEditSettings,
    };
}
