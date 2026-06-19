import * as React from 'react';

export default function GroupEpicSelector({
    label,
    selectedEpics = [],
    searchQuery = '',
    onSearchChange,
    onSearchFocus,
    onSearchBlur,
    onSearchKeyDown,
    searchInputRef,
    searchOpen = false,
    searchLoading = false,
    searchResults = [],
    searchIndex = 0,
    onAddEpic,
    onRemoveEpic,
    chipLastRef,
}) {
    const selected = Array.isArray(selectedEpics) ? selectedEpics : [];
    return (
        <div className="component-selector">
            <label className="component-selector-label">{label}</label>
            {selected.length > 0 && (
                <div className="selected-components-list">
                    {selected.map((epicKey, index) => (
                        <div key={epicKey} className="component-chip">
                            <span className="component-name">{epicKey}</span>
                            <button
                                className="remove-btn"
                                onClick={() => onRemoveEpic(epicKey)}
                                title={`Remove ${epicKey}`}
                                type="button"
                                ref={index === selected.length - 1 ? chipLastRef : null}
                            >×</button>
                        </div>
                    ))}
                </div>
            )}
            <div className="component-search-wrapper">
                <input
                    type="text"
                    className="component-search-input"
                    placeholder="Search epics by key or summary..."
                    value={searchQuery}
                    onChange={(event) => onSearchChange(event.target.value)}
                    onFocus={onSearchFocus}
                    onBlur={onSearchBlur}
                    onKeyDown={onSearchKeyDown}
                    ref={searchInputRef}
                />
                {searchOpen && searchQuery.trim() && (
                    <div className="component-search-results">
                        {searchLoading ? (
                            <div className="component-search-result-item is-empty">Searching...</div>
                        ) : searchResults.length === 0 ? (
                            <div className="component-search-result-item is-empty">No epics found</div>
                        ) : searchResults.map((epic, index) => (
                            <div
                                key={epic.key}
                                className={`component-search-result-item ${index === searchIndex ? 'active' : ''}`}
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    onAddEpic(epic.key);
                                }}
                            >
                                <span>{epic.key}</span>
                                {epic.summary ? <span className="component-result-meta"> · {epic.summary}</span> : null}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
