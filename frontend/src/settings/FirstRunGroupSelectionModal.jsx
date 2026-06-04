import * as React from 'react';

export default function FirstRunGroupSelectionModal(props) {
    const {
        groups = [],
        selectedGroupIds = [],
        onToggleGroup,
        onContinue,
        onAddGroup,
        saving = false,
        error = '',
    } = props;
    const [query, setQuery] = React.useState('');
    const selectedSet = React.useMemo(() => new Set(selectedGroupIds || []), [selectedGroupIds]);
    const selectedCount = selectedGroupIds.length;
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
                        <div id="department-first-run-title" className="department-first-run-title">Choose department groups</div>
                        <div className="department-first-run-subtitle">Select at least one group to show in controls</div>
                    </div>
                    <div className="department-first-run-count">{selectedCount} selected</div>
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
                    ) : visibleGroups.map(group => (
                        <label
                            key={group.id}
                            className={`department-first-run-option${selectedSet.has(group.id) ? ' selected' : ''}`}
                        >
                            <input
                                type="checkbox"
                                checked={selectedSet.has(group.id)}
                                onChange={() => onToggleGroup(group.id)}
                            />
                            <span className="department-first-run-option-main">
                                <span className="department-first-run-option-name">{group.name || group.id}</span>
                            </span>
                            <span className="department-first-run-option-meta">{(group.teamIds || []).length} team{(group.teamIds || []).length === 1 ? '' : 's'}</span>
                        </label>
                    ))}
                </div>
                {error && <div className="group-modal-warning">{error}</div>}
                <div className="department-first-run-actions">
                    {groups.length === 0 && (
                        <button className="secondary compact" type="button" onClick={onAddGroup}>
                            Add group
                        </button>
                    )}
                    <button
                        className="compact"
                        type="button"
                        onClick={onContinue}
                        disabled={saving || selectedGroupIds.length === 0}
                    >
                        {saving ? 'Saving...' : 'Continue'}
                    </button>
                </div>
            </div>
        </div>
    );
}
