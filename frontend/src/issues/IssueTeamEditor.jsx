import * as React from 'react';
import { createPortal } from 'react-dom';
import useIssueFieldPopover from './useIssueFieldPopover.js';

// Same combobox grammar as IssuePersonEditor: the Team value itself becomes the filter input and the
// popover holds only the option list. Enter saves the highlighted Team, Escape or an outside click cancels.
export default function IssueTeamEditor({
    issueKey, currentValue = null, isOpen = false, metadata = null,
    loading = false, submitting = false, pending = false, error = '',
    recoveryMode = '', onOpen, onClose, onSelect, onReload, onCheckJira,
    portalTarget, triggerClassName = '', useVisualViewport = true,
}) {
    const wrapperRef = React.useRef(null);
    const inputRef = React.useRef(null);
    const submittedRef = React.useRef(false);
    const [query, setQuery] = React.useState('');
    const [editingStarted, setEditingStarted] = React.useState(false);
    const [pickedId, setPickedId] = React.useState(null);
    const listId = React.useId().replace(/:/g, '');
    const target = portalTarget === undefined ? (typeof document === 'undefined' ? null : document.body) : portalTarget;
    const locked = loading || submitting || Boolean(recoveryMode) || metadata?.editable !== true;
    const filter = editingStarted ? query.trim().toLocaleLowerCase() : '';
    const currentId = metadata?.currentValue?.id;
    const options = React.useMemo(() => (metadata?.options || [])
        .filter(team => String(team.name || '').toLocaleLowerCase().includes(filter)), [metadata, filter]);
    // The highlight is derived (arrow/hover choice, else the current Team, else the first match), so it
    // is already correct on the first frame after opening or typing.
    const pickedIndex = options.findIndex(team => team.id === pickedId);
    const currentIndex = editingStarted ? -1 : options.findIndex(team => team.id === currentId);
    const activeIndex = locked ? -1 : [pickedIndex, currentIndex, 0].find(index => index >= 0 && index < options.length) ?? -1;
    const { triggerRef, panelRef, focusTrigger } = useIssueFieldPopover({
        blockClass: 'issue-person-editor', wrapperRef, portalTarget: target,
        active: isOpen, onDismiss: () => onClose?.('outside'), restoreFocusOnOutside: true,
        useVisualViewport, dependencies: [loading, error, options.length],
    });
    React.useEffect(() => {
        setQuery('');
        setEditingStarted(false);
        setPickedId(null);
        submittedRef.current = false;
    }, [isOpen]);
    React.useEffect(() => {
        if (isOpen) inputRef.current?.focus();
    }, [isOpen]);
    React.useEffect(() => {
        if (isOpen && !loading) inputRef.current?.select();
    }, [isOpen, loading]);
    React.useEffect(() => {
        if (isOpen) panelRef.current?.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' });
    }, [isOpen, activeIndex, panelRef]);
    React.useEffect(() => {
        if (!submitting) submittedRef.current = false;
    }, [submitting]);
    React.useEffect(() => {
        if (error) submittedRef.current = false;
    }, [error]);

    const closeAndRestore = reason => {
        focusTrigger();
        onClose?.(reason);
    };
    const selectTeam = team => {
        if (!team || locked || submittedRef.current) return;
        submittedRef.current = true;
        if (team.id === currentId) closeAndRestore('unchanged');
        else onSelect?.(team);
    };
    const moveActive = direction => {
        if (options.length) setPickedId(options[(activeIndex + direction + options.length) % options.length].id);
    };
    const handleKeyDown = event => {
        event.stopPropagation();
        if (!isOpen) {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen?.(); }
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closeAndRestore('escape');
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveActive(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            selectTeam(options[activeIndex]);
        }
    };

    const displayName = currentValue?.name || 'No Team';
    const panel = isOpen && <div ref={panelRef} className={`issue-person-editor-menu${target ? ' is-portalled' : ''}`} data-issue-key={issueKey}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeAndRestore('escape'); } }}>
        {loading && <div className="issue-person-editor-menu-note issue-person-editor-menu-loading">Loading Teams…</div>}
        {!loading && error && <div className="issue-person-editor-menu-note issue-person-editor-menu-error" role="alert">{error}</div>}
        {!loading && !locked && options.length > 0 && <div id={`${listId}-options`} className="issue-person-editor-menu-options" role="listbox" aria-label="Eligible Teams">
            {options.map((team, index) => <button key={team.id} id={`${listId}-option-${index}`} type="button" role="option"
                className={`issue-person-editor-option${index === activeIndex ? ' is-active' : ''}`} aria-selected={index === activeIndex}
                onPointerMove={() => setPickedId(team.id)} onClick={() => selectTeam(team)}>
                <span className="issue-person-editor-option-label">{team.name}{team.id === currentId ? ' (current)' : ''}</span>
            </button>)}
        </div>}
        {!loading && !locked && options.length === 0 && <div className="issue-person-editor-menu-note">No matching Teams.</div>}
        {submitting && <div className="issue-person-editor-menu-result" role="status" aria-live="polite">Saving Team.</div>}
        {recoveryMode && <div className="issue-field-editor-recovery-actions">
            <button type="button" className="secondary compact" onClick={recoveryMode === 'reload' ? onReload : onCheckJira}>
                {recoveryMode === 'reload' ? 'Reload' : 'Check Jira'}
            </button>
        </div>}
    </div>;
    return <span ref={wrapperRef} className="issue-person-editor">
        <input ref={node => { triggerRef.current = node; inputRef.current = node; }} type="text" role="combobox"
            className={`issue-person-editor-trigger${pending ? ' is-pending' : ''} ${triggerClassName}`.trim()}
            data-issue-person-editor-trigger="true" aria-label={isOpen ? 'Search Team' : `Team: ${displayName}`}
            aria-controls={`${listId}-options`} aria-haspopup="listbox" aria-expanded={isOpen} aria-autocomplete="list" aria-busy={pending}
            aria-activedescendant={isOpen && activeIndex >= 0 && !locked ? `${listId}-option-${activeIndex}` : undefined}
            disabled={!isOpen && pending} readOnly={!isOpen || locked}
            value={isOpen && editingStarted ? query : displayName}
            onPointerDown={event => event.stopPropagation()}
            onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
            onClick={event => { event.stopPropagation(); if (!isOpen) onOpen?.(); }}
            onChange={event => { if (!isOpen || locked) return; setEditingStarted(true); setPickedId(null); setQuery(event.target.value); }}
            onKeyDown={handleKeyDown} />
        {target && panel ? createPortal(panel, target) : panel}
    </span>;
}
