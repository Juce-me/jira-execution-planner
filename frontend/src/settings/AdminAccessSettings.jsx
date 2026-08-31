import * as React from 'react';
import { isAuthenticationRequiredError } from '../api/authRequired.js';
import { fetchAdminUsers, saveAdminMembership } from '../api/adminApi.js';

export function useAdminAccessSettings({ backendUrl, available, active }) {
    const [users, setUsers] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');
    const [selectedUserIds, setSelectedUserIds] = React.useState([]);
    const baselineRef = React.useRef('[]');
    const selectedSignature = React.useMemo(
        () => JSON.stringify([...selectedUserIds].sort()),
        [selectedUserIds]
    );
    const isDirty = available && selectedSignature !== baselineRef.current;

    const applyUsers = React.useCallback((nextUsers) => {
        const normalizedUsers = Array.isArray(nextUsers) ? nextUsers : [];
        const selectedIds = normalizedUsers
            .filter(user => user.accountType === 'admin')
            .map(user => user.id)
            .sort();
        setUsers(normalizedUsers);
        setSelectedUserIds(selectedIds);
        baselineRef.current = JSON.stringify(selectedIds);
        return normalizedUsers;
    }, []);

    React.useEffect(() => {
        if (!available || !active) return;
        setLoading(true);
        setError('');
        fetchAdminUsers(backendUrl)
            .then(payload => applyUsers(payload.users))
            .catch(loadError => {
                if (isAuthenticationRequiredError(loadError)) return;
                setError(loadError?.message || 'Failed to load administrators.');
            })
            .finally(() => setLoading(false));
    }, [active, applyUsers, available, backendUrl]);

    const toggleUser = React.useCallback((userId) => {
        setSelectedUserIds(current => current.includes(userId)
            ? current.filter(id => id !== userId)
            : [...current, userId].sort());
    }, []);

    const save = React.useCallback(async () => {
        if (!isDirty) return;
        const baselineIds = new Set(JSON.parse(baselineRef.current || '[]'));
        const selectedIds = new Set(selectedUserIds);
        const changes = users
            .filter(user => baselineIds.has(user.id) !== selectedIds.has(user.id))
            .map(user => ({ userId: user.id, isAdmin: selectedIds.has(user.id) }));
        const results = await saveAdminMembership(backendUrl, changes);
        const updatedById = new Map(results.map(result => [result?.user?.id, result?.user]));
        applyUsers(users.map(user => updatedById.get(user.id) || user));
    }, [applyUsers, backendUrl, isDirty, selectedUserIds, users]);

    return { users, loading, error, selectedUserIds, isDirty, toggleUser, save };
}

function displayNameForUser(user) {
    return String(user?.displayName || user?.email || 'Atlassian user');
}

export default function AdminAccessSettings(props) {
    const {
        authMode,
        adminUserManagementAvailable,
        adminUsers,
        adminUsersLoading,
        adminUsersError,
        selectedAdminUserIds,
        onToggleAdminUser,
    } = props;

    if (authMode !== 'atlassian_oauth') {
        return (
            <div className="admin-access-settings">
                <div className="admin-access-card">
                    <h2 className="group-pane-title">App administrators</h2>
                    <div className="group-field-helper">Basic authentication gives every user administrator access.</div>
                </div>
            </div>
        );
    }

    if (!adminUserManagementAvailable) {
        return (
            <div className="admin-access-settings">
                <div className="admin-access-card">
                    <h2 className="group-pane-title">App administrators</h2>
                    <div className="group-field-helper">This OAuth setup gives every signed-in user administrator access.</div>
                </div>
            </div>
        );
    }

    const selectedIds = new Set(selectedAdminUserIds || []);
    return (
        <div className="admin-access-settings">
            <div className="admin-access-card">
                <h2 className="group-pane-title">App administrators</h2>
                <div className="group-field-helper">
                    Select administrators from users who have signed in with Atlassian. Display details come from OAuth; authorization uses the Atlassian account ID.
                </div>
                {adminUsersError && <div className="admin-access-error" role="alert">{adminUsersError}</div>}
                {adminUsersLoading ? (
                    <div className="group-pane-empty">Loading Atlassian users...</div>
                ) : adminUsers.length === 0 ? (
                    <div className="group-pane-empty">No OAuth users have signed in yet.</div>
                ) : (
                    <div className="admin-access-list">
                        {adminUsers.map((user) => {
                            const name = displayNameForUser(user);
                            const isSelected = selectedIds.has(user.id);
                            const isDisabled = user.status !== 'active';
                            return (
                                <label
                                    className={`admin-access-row ${isDisabled ? 'is-disabled' : ''}`}
                                    data-admin-account-id={user.externalSubject || ''}
                                    key={user.id}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        disabled={isDisabled}
                                        onChange={() => onToggleAdminUser(user.id)}
                                        aria-label={`Administrator access for ${name}`}
                                    />
                                    <span className="admin-access-identity">
                                        <strong>{name}</strong>
                                        {user.email && <span>{user.email}</span>}
                                        <code>{user.externalSubject}</code>
                                    </span>
                                    <span className={`user-connection-status ${isSelected ? 'success' : ''}`}>
                                        {isSelected ? 'Administrator' : 'User'}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
