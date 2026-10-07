import * as React from 'react';
import LoadingMark from '../ui/LoadingMark.jsx';

export default function IssueSummaryEditor({
    issueKey, currentValue = '', isOpen = false, metadata = null, loading = false,
    submitting = false, pending = false, error = '', recoveryMode = '',
    onOpen, onClose, onSelect, onReload, onCheckJira, triggerClassName = '',
}) {
    const wrapperRef = React.useRef(null);
    const triggerRef = React.useRef(null);
    const inputRef = React.useRef(null);
    const submittedRef = React.useRef(false);
    const cancelledRef = React.useRef(false);
    const restoreFocusRef = React.useRef(false);
    const wasOpenRef = React.useRef(false);
    const [draft, setDraft] = React.useState(String(currentValue));
    const [validationError, setValidationError] = React.useState('');
    React.useEffect(() => {
        if (isOpen && metadata && !loading) {
            setDraft(String(metadata.currentValue || ''));
            setValidationError('');
            cancelledRef.current = false;
            restoreFocusRef.current = false;
            requestAnimationFrame(() => { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select(); });
        }
    }, [isOpen, loading, metadata?.currentValue]);
    React.useEffect(() => {
        if (wasOpenRef.current && !isOpen && restoreFocusRef.current) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
        wasOpenRef.current = isOpen;
    }, [isOpen]);
    React.useLayoutEffect(() => {
        if (!inputRef.current) return;
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }, [draft, isOpen]);
    const locked = loading || submitting || Boolean(recoveryMode) || metadata?.editable !== true;
    const commit = async () => {
        if (locked || submittedRef.current || cancelledRef.current) return;
        if (!draft.trim() || draft.length > 255) { setValidationError('Enter a summary of 1–255 characters.'); return; }
        if (draft === metadata.currentValue) { onClose?.('unchanged'); return; }
        submittedRef.current = true;
        try { await onSelect?.(draft); }
        finally { submittedRef.current = false; }
    };
    return <span ref={wrapperRef} className="issue-person-editor issue-summary-editor">
        {isOpen ? <span className="issue-summary-editor-inline">
            <textarea ref={inputRef} className="planning-review-input issue-summary-editor-input" aria-label={`Summary for ${issueKey}`} maxLength={255} rows={1}
                value={draft} readOnly={locked} aria-invalid={Boolean(validationError)}
                onChange={event => { setDraft(event.target.value); setValidationError(''); }}
                onBlur={event => { if (!wrapperRef.current?.contains(event.relatedTarget)) { restoreFocusRef.current = false; void commit(); } }}
                onKeyDown={event => {
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelledRef.current = true; restoreFocusRef.current = true; onClose?.('escape'); }
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); restoreFocusRef.current = true; void commit(); }
                }} />
            {(loading || submitting) && <span className="issue-summary-editor-busy" role="status" aria-label={loading ? 'Loading summary' : 'Saving summary'}><LoadingMark /></span>}
            {(validationError || error) && <span className="planning-review-validation" role="alert">{validationError || error}</span>}
            {recoveryMode === 'reload' && <button type="button" className="planning-action-button" onClick={onReload}>Reload field</button>}
            {recoveryMode === 'check_jira' && <button type="button" className="planning-action-button" onClick={onCheckJira}>Check Jira</button>}
        </span> : <button ref={triggerRef} type="button" className={`issue-person-editor-trigger issue-summary-editor-trigger ${triggerClassName}`} disabled={pending}
            aria-label={`Edit summary for ${issueKey}`} onClick={onOpen}>{currentValue}</button>}
    </span>;
}
