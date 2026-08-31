import * as React from 'react';
import { shouldShowFirstRunGroupSearch } from './firstRunGroupConfiguration.js';

const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function FirstRunGroupSelectionModal(props) {
    const {
        groups = [], selectedGroupId = null, onSelectGroup, onContinue,
        onAddDepartment, onConfigureGroup, saving = false, error = '', onboardingDone = true,
        setupChoiceOpen = false,
    } = props;
    const [query, setQuery] = React.useState('');
    const [selectionCleared, setSelectionCleared] = React.useState(false);
    const modalRef = React.useRef(null);
    const addButtonRef = React.useRef(null);
    const errorRef = React.useRef(null);
    const choiceWasOpenRef = React.useRef(false);
    const trimmedQuery = query.trim().toLowerCase();
    const showSearch = shouldShowFirstRunGroupSearch(groups.length);
    const sortedGroups = React.useMemo(() => [...groups].sort((a, b) => (
        String(a?.name || a?.id || '').toLowerCase().localeCompare(String(b?.name || b?.id || '').toLowerCase())
    )), [groups]);
    const visibleGroups = React.useMemo(() => {
        if (!showSearch || !trimmedQuery) return sortedGroups;
        return sortedGroups.filter(group => String(group?.name || group?.id || '').toLowerCase().includes(trimmedQuery));
    }, [showSearch, sortedGroups, trimmedQuery]);
    const effectiveSelectedGroupId = selectionCleared ? null : selectedGroupId;
    const selectedGroup = sortedGroups.find(group => group.id === effectiveSelectedGroupId) || null;
    const selectedIsHidden = Boolean(selectedGroup && !visibleGroups.some(group => group.id === effectiveSelectedGroupId));

    React.useEffect(() => {
        if (setupChoiceOpen) {
            choiceWasOpenRef.current = true;
            return;
        }
        if (choiceWasOpenRef.current) {
            choiceWasOpenRef.current = false;
            addButtonRef.current?.focus();
            return;
        }
        const initial = modalRef.current?.querySelector('input[type="radio"]:not([disabled])') || addButtonRef.current;
        initial?.focus();
    }, [setupChoiceOpen]);
    React.useEffect(() => {
        if (error) errorRef.current?.focus();
    }, [error]);

    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...(modalRef.current?.querySelectorAll(focusableSelector) || [])];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };
    const handleContinue = () => {
        if (saving || !effectiveSelectedGroupId) return;
        onContinue();
    };
    const handleContinueKeyDown = (event) => {
        if (!saving || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
    };

    return (
        <div
            className="department-first-run-backdrop"
            role="dialog"
            aria-modal={setupChoiceOpen ? undefined : 'true'}
            aria-hidden={setupChoiceOpen ? 'true' : undefined}
            inert={setupChoiceOpen ? true : undefined}
            aria-labelledby="department-first-run-title"
            aria-busy={saving ? 'true' : 'false'}
            onKeyDown={handleKeyDown}
            ref={modalRef}
        >
            <div className="department-first-run-modal">
                <div className="department-first-run-header">
                    <div className="department-first-run-heading">
                        <div id="department-first-run-title" className="department-first-run-title">Choose your Department</div>
                        <div className="department-first-run-subtitle">Choose the Department you want to see first.</div>
                        <div className="department-first-run-next">{onboardingDone ? 'Next: dashboard' : 'Next: a skippable dashboard tour'}</div>
                    </div>
                </div>
                {showSearch ? (
                    <input type="search" className="group-filter-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Departments..." aria-label="Search Departments" disabled={saving} />
                ) : groups.length > 0 ? (
                    <div className="department-first-run-catalog-summary">All available Departments are shown · {groups.length}</div>
                ) : null}
                {selectedIsHidden && (
                    <div className="department-first-run-selected-summary" role="status">
                        <span>Selected: {selectedGroup.name || selectedGroup.id}</span>
                        <button className="secondary compact" type="button" onClick={() => setSelectionCleared(true)} disabled={saving}>Clear selection</button>
                    </div>
                )}
                <div className="department-first-run-list">
                    {groups.length === 0 ? (
                        <div className="group-pane-empty">No Departments yet.</div>
                    ) : visibleGroups.length === 0 ? (
                        <div className="group-pane-empty">No Departments match this search.</div>
                    ) : visibleGroups.map(group => {
                        const hasTeams = (group.teamIds || []).some(teamId => String(teamId || '').trim());
                        const selected = effectiveSelectedGroupId === group.id;
                        const radioId = `first-run-radio-${group.id}`;
                        return (
                            <div key={group.id} className={`department-first-run-option${selected ? ' selected' : ''}${hasTeams ? '' : ' disabled'}${saving ? ' saving' : ''}`}>
                                <input id={radioId} type="radio" name="first-run-favorite-group" checked={selected} disabled={saving || !hasTeams} onChange={() => { setSelectionCleared(false); onSelectGroup(group.id); }} />
                                {hasTeams ? (
                                    <label className="department-first-run-option-main eligible" htmlFor={radioId}>
                                        <span className="department-first-run-option-name">{group.name || group.id}</span>
                                        <span className="department-first-run-option-meta">{(group.teamIds || []).length} team{(group.teamIds || []).length === 1 ? '' : 's'}</span>
                                        <span className="department-first-run-star group-list-star" aria-hidden="true">{selected ? '★' : '☆'}</span>
                                    </label>
                                ) : (
                                    <>
                                        <label className="department-first-run-option-main" htmlFor={radioId}>
                                            <span className="department-first-run-option-name">{group.name || group.id}</span>
                                            <span className="department-first-run-option-help">Add at least one team before choosing this Department</span>
                                        </label>
                                        <span className="department-first-run-option-meta">{(group.teamIds || []).length} teams</span>
                                        <button className="secondary compact department-first-run-configure" type="button" onClick={() => onConfigureGroup(group.id)} disabled={saving}>Configure and use {group.name || group.id}</button>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
                {error && <div className="group-modal-warning" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
                <div className="department-first-run-actions">
                    <button className="secondary compact" type="button" onClick={onAddDepartment} ref={addButtonRef} disabled={saving}>Add Department</button>
                    <button
                        className="compact"
                        type="button"
                        onClick={handleContinue}
                        onKeyDown={handleContinueKeyDown}
                        disabled={!saving && !effectiveSelectedGroupId}
                        aria-disabled={saving ? 'true' : undefined}
                    >
                        {saving ? 'Saving...' : 'Continue'}
                    </button>
                </div>
            </div>
        </div>
    );
}
