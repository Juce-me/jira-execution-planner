import * as React from 'react';
import { createPortal } from 'react-dom';
import useIssueFieldPopover from './useIssueFieldPopover.js';

const SEARCH_THRESHOLD = 3;

function textLength(value) {
    return Array.from(String(value || '').trim()).length;
}

function optionDisabled(person) {
    return person?.eligibility === 'ineligible' || person?.disabled === true;
}

function optionGuidance(person) {
    if (person?.eligibility === 'ineligible') return 'Unavailable for this field.';
    if (person?.eligibility === 'unverified') return 'Jira will verify access when selected.';
    return '';
}

export default function IssuePersonEditor({
    issueKey,
    field = 'assignee',
    fieldLabel = 'Assignee',
    currentValue = null,
    isOpen = false,
    metadata = null,
    suggestions = [],
    query,
    loading = false,
    searching = false,
    submitting = false,
    pending = false,
    error = '',
    statusMessage = '',
    recoveryMode = '',
    configurationChanged = false,
    jiraUrl = '',
    onOpen,
    onClose,
    onSearch,
    onSelect,
    onReload,
    onCheckJira,
    portalTarget,
    triggerClassName = '',
    useVisualViewport = true,
}) {
    const wrapperRef = React.useRef(null);
    const inputRef = React.useRef(null);
    const recoveryButtonRef = React.useRef(null);
    const [localQuery, setLocalQuery] = React.useState('');
    const [activeIndex, setActiveIndex] = React.useState(-1);
    const [recoveryBusy, setRecoveryBusy] = React.useState(false);
    const submittedRef = React.useRef(false);
    const wasSubmittingRef = React.useRef(false);
    const listId = React.useId().replace(/:/g, '');
    const recoveryLocked = recoveryMode === 'reload' || recoveryMode === 'check_jira';
    const effectiveQuery = query === undefined ? localQuery : String(query || '');
    const effectivePortalTarget = portalTarget === undefined
        ? (typeof document === 'undefined' ? null : document.body)
        : portalTarget;

    const options = React.useMemo(() => {
        const values = [];
        const seen = new Set();
        const append = person => {
            const accountId = String(person?.accountId || '').trim();
            const displayName = String(person?.displayName || '').trim();
            if (!accountId || !displayName || seen.has(accountId) || values.length >= 5) return;
            seen.add(accountId);
            values.push(person);
        };
        if (metadata) append(metadata.me);
        (Array.isArray(suggestions) ? suggestions : []).forEach(append);
        return values;
    }, [effectiveQuery, metadata, suggestions]);
    const hasNonMeResult = options.some(person => person.accountId !== metadata?.me?.accountId);

    const { triggerRef, panelRef, focusTrigger } = useIssueFieldPopover({
        blockClass: 'issue-person-editor',
        wrapperRef,
        portalTarget: effectivePortalTarget,
        active: isOpen,
        onDismiss: () => onClose?.('outside'),
        restoreFocusOnOutside: true,
        useVisualViewport,
        dependencies: [loading, searching, error, options.length],
    });

    React.useEffect(() => {
        if (!isOpen) return;
        submittedRef.current = false;
        const firstEnabled = options.findIndex(person => !optionDisabled(person));
        setActiveIndex(firstEnabled);
    }, [isOpen]);

    React.useEffect(() => {
        if (isOpen && !loading) inputRef.current?.focus();
    }, [isOpen, loading]);

    React.useEffect(() => {
        if (wasSubmittingRef.current && !submitting) submittedRef.current = false;
        wasSubmittingRef.current = submitting;
    }, [submitting]);

    React.useEffect(() => {
        if (error) submittedRef.current = false;
    }, [error]);

    React.useEffect(() => {
        if (!isOpen) return;
        if (activeIndex >= 0 && options[activeIndex] && !optionDisabled(options[activeIndex])) return;
        setActiveIndex(options.findIndex(person => !optionDisabled(person)));
    }, [activeIndex, isOpen, options]);

    const closeAndRestore = reason => {
        focusTrigger();
        onClose?.(reason);
    };

    const runRecovery = async () => {
        if (recoveryBusy) return;
        setRecoveryBusy(true);
        try {
            if (recoveryMode === 'reload') await onReload?.();
            else if (recoveryMode === 'check_jira') await onCheckJira?.();
        } finally {
            setRecoveryBusy(false);
            requestAnimationFrame(() => (inputRef.current?.disabled ? recoveryButtonRef.current : inputRef.current)?.focus());
        }
    };

    const selectPerson = person => {
        if (!person || optionDisabled(person) || submittedRef.current || submitting || recoveryLocked || metadata?.editable !== true) return;
        submittedRef.current = true;
        if (String(metadata?.currentValue?.accountId || '') === String(person.accountId || '')) {
            closeAndRestore('unchanged');
            return;
        }
        onSelect?.(person);
    };

    const moveActive = direction => {
        if (!options.length) return;
        let next = activeIndex;
        for (let attempts = 0; attempts < options.length; attempts += 1) {
            next = (next + direction + options.length) % options.length;
            if (!optionDisabled(options[next])) {
                setActiveIndex(next);
                return;
            }
        }
    };

    const handleInputKeyDown = event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeAndRestore('escape');
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveActive(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault();
            selectPerson(options[activeIndex]);
        }
    };

    const displayName = String(currentValue?.displayName || '').trim() || (field === 'deliveryOwner' ? 'Not set' : 'Unassigned');
    const editor = isOpen ? (
        <div
            ref={panelRef}
            className={`issue-person-editor-menu${effectivePortalTarget ? ' is-portalled' : ''}`}
            data-issue-key={String(issueKey || '')}
            onKeyDown={event => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                closeAndRestore('escape');
            }}
        >
            {loading && <div className="issue-person-editor-menu-note issue-person-editor-menu-loading">Loading people...</div>}
            {!loading && error && <div className="issue-person-editor-menu-note issue-person-editor-menu-error" role="alert" aria-label={`${fieldLabel} error`}>{error}</div>}
            {!loading && configurationChanged && (
                <div className="issue-person-editor-menu-note">Jira field configuration changed. Review the issue in Jira before trying again.</div>
            )}
            {!loading && configurationChanged && jiraUrl && (
                <a className="issue-person-editor-menu-note" href={`${jiraUrl}/browse/${encodeURIComponent(String(issueKey || ''))}`} target="_blank" rel="noopener noreferrer">Open issue in Jira ↗</a>
            )}
            {!loading && metadata && textLength(effectiveQuery) < SEARCH_THRESHOLD && (
                <div className="issue-person-editor-menu-note">Type at least 3 characters to search Jira.</div>
            )}
            {!loading && searching && <div className="issue-person-editor-menu-note issue-person-editor-menu-loading">Searching Jira...</div>}
            {!loading && !searching && textLength(effectiveQuery) >= SEARCH_THRESHOLD && !hasNonMeResult && (
                <div className="issue-person-editor-menu-note">No people found. Try a display name or check Jira.</div>
            )}
            {!loading && options.length > 0 && (
                <div id={`${listId}-options`} className="issue-person-editor-menu-options" role="listbox" aria-label={`${fieldLabel} people`}>
                    {options.map((person, index) => {
                        const guidance = optionGuidance(person);
                        const isMe = person.accountId === metadata?.me?.accountId;
                        return (
                            <button
                                key={person.accountId}
                                id={`${listId}-option-${index}`}
                                type="button"
                                className={`issue-person-editor-option${index === activeIndex ? ' is-active' : ''}`}
                                role="option"
                                aria-selected={index === activeIndex}
                                aria-label={`${person.displayName}${isMe ? ', Me' : ''}${guidance ? `, ${guidance}` : ''}`}
                                disabled={optionDisabled(person) || submitting || recoveryLocked || metadata?.editable !== true}
                                onPointerMove={() => { if (!optionDisabled(person)) setActiveIndex(index); }}
                                onClick={() => selectPerson(person)}
                            >
                                <span className="issue-person-editor-option-label">
                                    {person.displayName}{isMe ? ' (Me)' : ''}
                                    {person.emailAddress && <small>{person.emailAddress}</small>}
                                </span>
                                {guidance && <span className="issue-person-editor-option-note">{guidance}</span>}
                            </button>
                        );
                    })}
                </div>
            )}
            {(statusMessage || pending || submitting) && (
                <div className="issue-person-editor-menu-result" role="status" aria-live="polite" aria-atomic="true">
                    {statusMessage || `Saving ${fieldLabel}.`}
                </div>
            )}
            {recoveryMode && (
                <div className="issue-field-editor-recovery-actions">
                    <button ref={recoveryButtonRef} type="button" className="secondary compact" disabled={recoveryBusy} onClick={runRecovery}>
                        {recoveryMode === 'reload' ? 'Reload' : 'Check Jira'}
                    </button>
                </div>
            )}
        </div>
    ) : null;
    const inputValue = isOpen ? effectiveQuery : displayName;
    const inputWidth = Math.min(24, Math.max(4, Array.from(displayName).length, Array.from(inputValue).length)) + 0.35;

    return (
        <span className="issue-person-editor" ref={wrapperRef}>
            <input
                ref={node => {
                    triggerRef.current = node;
                    inputRef.current = node;
                }}
                type="text"
                role="combobox"
                className={`issue-person-editor-trigger${pending ? ' is-pending' : ''} ${triggerClassName}`.trim()}
                data-issue-person-editor-trigger="true"
                aria-label={isOpen ? `Search ${fieldLabel}` : `${fieldLabel}: ${displayName}`}
                aria-controls={`${listId}-options`}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-autocomplete="list"
                aria-activedescendant={isOpen && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
                aria-busy={pending}
                disabled={isOpen ? (loading || submitting || recoveryLocked || metadata?.editable !== true) : pending}
                readOnly={!isOpen}
                value={inputValue}
                style={{ width: `${inputWidth}ch` }}
                onPointerDown={(event) => event.stopPropagation()}
                onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onClick={(event) => {
                    event.stopPropagation();
                    if (!isOpen) onOpen?.();
                }}
                onChange={event => {
                    if (!isOpen) return;
                    const value = event.target.value;
                    if (query === undefined) setLocalQuery(value);
                    setActiveIndex(-1);
                    onSearch?.(value);
                }}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (!isOpen && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        onOpen?.();
                        return;
                    }
                    if (isOpen) handleInputKeyDown(event);
                }}
            />
            {editor && (effectivePortalTarget ? createPortal(editor, effectivePortalTarget) : editor)}
        </span>
    );
}
