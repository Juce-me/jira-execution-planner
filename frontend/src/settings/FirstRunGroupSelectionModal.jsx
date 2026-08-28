import * as React from 'react';

export default function FirstRunGroupSelectionModal(props) {
    const {
        groups = [],
        selectedGroupId = null,
        onSelectGroup,
        onContinue,
        onConfigure,
        saving = false,
        error = '',
    } = props;
    const [query, setQuery] = React.useState('');
    const trimmedQuery = query.trim().toLowerCase();
    const sortedGroups = React.useMemo(() => {
        return [...groups].sort((a, b) => {
            const aName = String(a?.name || a?.id || '').toLowerCase();
            const bName = String(b?.name || b?.id || '').toLowerCase();
            return aName.localeCompare(bName);
        });
    }, [groups]);
    const visibleGroups = React.useMemo(() => {
        if (!trimmedQuery) return sortedGroups;
        return sortedGroups.filter(group => String(group?.name || group?.id || '').toLowerCase().includes(trimmedQuery));
    }, [sortedGroups, trimmedQuery]);

    return (
        <div className="department-first-run-backdrop" role="dialog" aria-modal="true" aria-labelledby="department-first-run-title">
            <div className="department-first-run-modal">
                <div className="department-first-run-header">
                    <div className="department-first-run-heading">
                        <div id="department-first-run-title" className="department-first-run-title">Choose your group</div>
                        <div className="department-first-run-subtitle">Star one group to use as your personal starting group</div>
                    </div>
                </div>
                {groups.length > 0 && (
                    <input
                        type="text"
                        className="group-filter-input"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search groups..."
                        aria-label="Search groups"
                    />
                )}
                <div className="department-first-run-list">
                    {groups.length === 0 ? (
                        <div className="group-pane-empty">No groups yet.</div>
                    ) : visibleGroups.length === 0 ? (
                        <div className="group-pane-empty">No groups match this search.</div>
                    ) : visibleGroups.map(group => {
                        const hasTeams = (group.teamIds || []).some(teamId => String(teamId || '').trim());
                        const selected = selectedGroupId === group.id;
                        return (
                        <label
                            key={group.id}
                            className={`department-first-run-option${selected ? ' selected' : ''}${hasTeams ? '' : ' disabled'}`}
                        >
                            <input
                                type="radio"
                                name="first-run-favorite-group"
                                checked={selected}
                                disabled={!hasTeams}
                                onChange={() => onSelectGroup(group.id)}
                            />
                            <span className="department-first-run-option-main">
                                <span className="department-first-run-option-name">{group.name || group.id}</span>
                                {!hasTeams && (
                                    <span className="department-first-run-option-help">Configure teams before choosing this group</span>
                                )}
                            </span>
                            <span className="department-first-run-option-meta">{(group.teamIds || []).length} team{(group.teamIds || []).length === 1 ? '' : 's'}</span>
                            <span className="department-first-run-star group-list-star" aria-hidden="true">
                                {selected ? '★' : '☆'}
                            </span>
                        </label>
                        );
                    })}
                </div>
                {error && (
                    <div className="group-modal-warning">
                        {error}
                    </div>
                )}
                <div className="department-first-run-actions">
                    <button className="secondary compact" type="button" onClick={onConfigure}>
                        Configure
                    </button>
                    <button
                        className="compact"
                        type="button"
                        onClick={onContinue}
                        disabled={saving || !selectedGroupId}
                    >
                        {saving ? 'Saving...' : 'Continue'}
                    </button>
                </div>
            </div>
        </div>
    );
}
