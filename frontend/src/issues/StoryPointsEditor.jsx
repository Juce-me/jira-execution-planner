import * as React from 'react';
import { parseStoryPointsDraft } from '../eng/engIssueFieldEditUtils.js';

function displayStoryPoints(value) {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '0';
}

export default function StoryPointsEditor({
    issueKey,
    currentValue = null,
    isOpen = false,
    metadata = null,
    loading = false,
    submitting = false,
    pending = false,
    error = '',
    statusMessage = '',
    recoveryMode = '',
    configurationChanged = false,
    onOpen,
    onClose,
    onSubmit,
    onReload,
    onCheckJira,
    triggerClassName = '',
}) {
    const inputRef = React.useRef(null);
    const submittedRef = React.useRef(false);
    const recoveryRef = React.useRef('');
    const [draft, setDraft] = React.useState(() => displayStoryPoints(currentValue));
    const [validationError, setValidationError] = React.useState('');
    const recoveryLocked = recoveryMode === 'reload' || recoveryMode === 'check_jira';
    const readOnly = !isOpen || loading || submitting || recoveryLocked || metadata?.editable !== true;

    React.useEffect(() => {
        if (isOpen) return;
        submittedRef.current = false;
        setValidationError('');
        setDraft(displayStoryPoints(currentValue));
    }, [currentValue, isOpen]);

    React.useEffect(() => {
        if (!isOpen || !metadata?.mappingRevision) return;
        submittedRef.current = false;
        setValidationError('');
        setDraft(displayStoryPoints(metadata.currentValue));
    }, [isOpen, metadata?.mappingRevision, metadata?.currentValue]);

    React.useEffect(() => {
        if (!isOpen) {
            recoveryRef.current = '';
            return;
        }
        if (!recoveryMode || recoveryRef.current === recoveryMode) return;
        recoveryRef.current = recoveryMode;
        const recover = recoveryMode === 'reload' ? onReload : onCheckJira;
        Promise.resolve(recover?.()).finally(() => {
            requestAnimationFrame(() => inputRef.current?.focus());
        });
    }, [isOpen, recoveryMode, onReload, onCheckJira]);

    const resetAndClose = reason => {
        setValidationError('');
        setDraft(displayStoryPoints(currentValue));
        onClose?.(reason);
    };

    const save = async () => {
        if (submittedRef.current || readOnly) return;
        const parsed = parseStoryPointsDraft(inputRef.current?.value ?? draft);
        if (!parsed.valid) {
            setValidationError('Enter a non-negative number with at most one decimal place.');
            return;
        }
        setValidationError('');
        if (typeof metadata?.currentValue === 'number' && metadata.currentValue === parsed.value) {
            submittedRef.current = true;
            inputRef.current?.blur();
            submittedRef.current = false;
            resetAndClose('unchanged');
            return;
        }
        submittedRef.current = true;
        recoveryRef.current = '';
        const result = await onSubmit?.(parsed.value);
        submittedRef.current = false;
        if (result) {
            inputRef.current?.blur();
            onClose?.('saved');
        }
    };

    const feedback = validationError || (configurationChanged
        ? 'Jira field configuration changed. Review the issue in Jira before trying again.'
        : error || statusMessage || (pending || submitting ? 'Saving Story Points.' : ''));

    return (
        <span
            className={`story-points-editor-wrap ${triggerClassName}${pending ? ' is-pending' : ''}`.trim()}
            data-issue-key={String(issueKey || '')}
        >
            <input
                ref={inputRef}
                className="story-points-editor"
                type="text"
                inputMode="decimal"
                aria-label="Story Points"
                aria-invalid={!!(validationError || error)}
                aria-describedby={feedback ? `story-points-feedback-${issueKey}` : undefined}
                aria-busy={pending || loading || submitting}
                title={feedback || 'Story Points'}
                value={draft}
                readOnly={readOnly}
                style={{ width: `${Math.max(1, draft.length + 0.35)}ch` }}
                onFocus={(event) => {
                    if (!isOpen) onOpen?.();
                    const input = event.currentTarget;
                    requestAnimationFrame(() => input.select());
                }}
                onChange={event => {
                    setDraft(event.target.value);
                    setValidationError('');
                }}
                onBlur={() => {
                    if (submittedRef.current) return;
                    if (isOpen) resetAndClose('outside');
                }}
                onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        save();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        resetAndClose('escape');
                        submittedRef.current = true;
                        event.currentTarget.blur();
                        submittedRef.current = false;
                    }
                }}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => event.stopPropagation()}
                onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
            />
            <span className="story-points-editor-unit" aria-hidden="true">SP</span>
            {feedback && (
                <span id={`story-points-feedback-${issueKey}`} className="story-points-editor-feedback" role={validationError || error ? 'alert' : 'status'}>
                    {feedback}
                </span>
            )}
        </span>
    );
}
