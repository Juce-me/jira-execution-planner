import * as React from 'react';
import { createPortal } from 'react-dom';
import useIssueFieldPopover from './useIssueFieldPopover.js';

// Uses the established issue-field popover geometry and presentation.
export default function IssueTeamEditor({
    issueKey, currentValue = null, isOpen = false, metadata = null,
    loading = false, submitting = false, pending = false, error = '',
    recoveryMode = '', onOpen, onClose, onSelect, onReload, onCheckJira,
    portalTarget, triggerClassName = '', useVisualViewport = true,
}) {
    const wrapperRef = React.useRef(null);
    const [query, setQuery] = React.useState('');
    const inputRef = React.useRef(null);
    const target = portalTarget === undefined ? (typeof document === 'undefined' ? null : document.body) : portalTarget;
    const options = (metadata?.options || []).filter(team => String(team.name || '').toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    const { triggerRef, panelRef } = useIssueFieldPopover({
        blockClass: 'issue-person-editor', wrapperRef, portalTarget: target,
        active: isOpen, onDismiss: () => onClose?.('outside'), restoreFocusOnOutside: true,
        useVisualViewport, dependencies: [loading, error, options.length],
    });
    React.useEffect(() => {
        if (isOpen) setQuery('');
    }, [isOpen]);
    React.useEffect(() => {
        if (isOpen && !loading) inputRef.current?.focus();
    }, [isOpen, loading]);
    const locked = submitting || Boolean(recoveryMode) || metadata?.editable !== true;
    const panel = isOpen && <div ref={panelRef} className={`issue-person-editor-menu${target ? ' is-portalled' : ''}`} data-issue-key={issueKey}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose?.('escape'); } }}>
        {loading && <div className="issue-person-editor-menu-note">Loading Teams…</div>}
        {error && <div className="issue-person-editor-menu-note issue-person-editor-menu-error" role="alert">{error}</div>}
        {!loading && <input ref={inputRef} className="issue-person-editor-search" aria-label="Filter eligible Teams" value={query}
            disabled={locked} onChange={event => setQuery(event.target.value)} />}
        {!loading && <div className="issue-person-editor-menu-options" role="listbox" aria-label="Eligible Teams">
            {options.map(team => <button key={team.id} type="button" className="issue-person-editor-option" role="option"
                aria-selected={team.id === metadata?.currentValue?.id} disabled={locked}
                onClick={() => team.id === metadata?.currentValue?.id ? onClose?.('unchanged') : onSelect?.(team)}>{team.name}</button>)}
            {!options.length && <div className="issue-person-editor-menu-note">No eligible Team choices.</div>}
        </div>}
        {recoveryMode === 'reload' && <button type="button" onClick={onReload}>Reload field</button>}
        {recoveryMode === 'check_jira' && <button type="button" onClick={onCheckJira}>Check Jira</button>}
        <button type="button" className="issue-person-editor-cancel" onClick={() => onClose?.('cancel')}>Cancel</button>
    </div>;
    return <span ref={wrapperRef} className="issue-person-editor">
        <input ref={triggerRef} type="text" readOnly className={`issue-person-editor-trigger ${triggerClassName}`} disabled={pending}
            aria-label={`Edit Team for ${issueKey}`} aria-expanded={isOpen} value={currentValue?.name || 'No Team'}
            onClick={onOpen} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen?.(); } } } />
        {target && panel ? createPortal(panel, target) : panel}
    </span>;
}
