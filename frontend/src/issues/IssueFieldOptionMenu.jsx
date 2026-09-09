import * as React from 'react';
import { createPortal } from 'react-dom';
import useIssueFieldPopover from './useIssueFieldPopover.js';

// Shared compact option-menu renderer for ENG field-change popovers (status + priority).
// It renders the anchored role="menu" panel; the trigger (status pill / priority icon button)
// and the position:relative wrapper live in the field-specific menu component. Class names are
// namespaced by `blockClass` ('status-transition' | 'priority-transition') so the status menu
// keeps its exact DOM/test hooks while the CSS aliases the priority selectors onto the same
// declarations. Owns first-option focus, Escape handling (including returning focus to the
// trigger), and outside-click dismissal so both fields share identical keyboard/pointer behavior.
export default function IssueFieldOptionMenu({
    blockClass,
    issueKey,
    menuLabel = '',
    leadingContent = null,
    loading = false,
    loadingLabel = 'Loading options...',
    error = '',
    errorTooMany = false,
    showEmpty = false,
    emptyLabel = '',
    options = [],
    optionKey,
    optionLabel,
    renderMarker,
    onSelect,
    disabled = false,
    result = '',
    onEscape,
    dismissRef = null,
    portalTarget = null,
    previewOnly = null,
    onPreviewLifecycleChange,
}) {
    const firstOptionRef = React.useRef(null);
    const key = String(issueKey || '').trim();
    const list = Array.isArray(options) ? options : [];
    const preview = Boolean(previewOnly);
    const previewDescriptor = React.useMemo(() => previewOnly ? ({
        sessionId: previewOnly.sessionId,
        stepId: previewOnly.stepId,
        fieldKind: previewOnly.fieldKind,
        issueKey: previewOnly.issueKey,
        targetIdentity: previewOnly.targetIdentity,
    }) : null, [
        previewOnly?.sessionId,
        previewOnly?.stepId,
        previewOnly?.fieldKind,
        previewOnly?.issueKey,
        previewOnly?.targetIdentity,
    ]);
    const previewId = React.useId().replace(/:/g, '');
    const [activePreviewIndex, setActivePreviewIndex] = React.useState(0);
    const [previewPortalTarget, setPreviewPortalTarget] = React.useState(null);
    const effectivePortalTarget = preview ? (portalTarget || previewPortalTarget) : portalTarget;
    const previewStatusLabel = loading
        ? 'Loading choices.'
        : error
            ? 'Choices could not be loaded.'
            : `${list.length} ${list.length === 1 ? 'choice' : 'choices'} available.`;
    const lifecycleRef = React.useRef(onPreviewLifecycleChange);
    lifecycleRef.current = onPreviewLifecycleChange;
    const {
        panelRef: menuRef,
        focusTrigger,
    } = useIssueFieldPopover({
        blockClass,
        wrapperRef: dismissRef,
        portalTarget: effectivePortalTarget,
        preview,
        onDismiss: onEscape,
        // Preserve the old menu default: visualViewport events were preview-only. New field
        // editors opt into mobile visualViewport tracking explicitly.
        useVisualViewport: preview,
        dependencies: [loading, list.length, error, result],
    });

    React.useEffect(() => {
        if (preview) setActivePreviewIndex(0);
    }, [list.length, preview, previewDescriptor?.sessionId, previewDescriptor?.targetIdentity]);

    React.useLayoutEffect(() => {
        if (!preview || portalTarget) return undefined;
        const container = document.createElement('div');
        container.className = 'onboarding-tour-preview-portal';
        container.dataset.onboardingPreviewPortal = String(previewDescriptor?.targetIdentity || '');
        document.body.appendChild(container);
        setPreviewPortalTarget(container);
        return () => {
            container.remove();
            setPreviewPortalTarget(null);
        };
    }, [portalTarget, preview, previewDescriptor?.targetIdentity]);

    // Move focus into the menu once options are available (mirrors status behavior). The menu
    // mounts only while open, so this runs on open and whenever loading flips to false.
    React.useEffect(() => {
        if (preview) {
            menuRef.current?.focus();
        } else if (!loading && firstOptionRef.current) {
            firstOptionRef.current.focus();
        }
    }, [loading, preview, effectivePortalTarget]);

    React.useEffect(() => {
        if (!preview || !effectivePortalTarget) return undefined;
        const state = loading ? 'loading' : error ? 'error' : list.length ? 'ready' : 'empty';
        lifecycleRef.current?.(previewDescriptor, { state, reason: '' });
        return undefined;
    }, [effectivePortalTarget, error, list.length, loading, preview, previewDescriptor]);

    // Escape closes the menu, so focus must go back to the trigger that opened it. Without this
    // the focused option simply unmounts and focus falls to <body>: the keyboard user loses their
    // place on every surface, and inside a focus trap (the board's epic panel binds Escape/Tab to
    // the panel element) the next Escape reaches nothing and the dialog becomes undismissable.
    // The trigger is resolved from the dismissRef wrapper; every consumer marks it with
    // data-<blockClass>-trigger. A portalled menu still returns focus to that same anchor.
    const activatePreviewOption = () => {
        focusTrigger();
        onEscape?.('preview_option');
    };

    const handlePreviewMenuClick = (event) => {
        if (!preview || event.target.closest('button[role="menuitem"]')) return;
        activatePreviewOption();
    };

    const handleMenuKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            // Restore before closing, so focus never passes through <body> at all.
            focusTrigger();
            onEscape?.('escape');
            return;
        }
        if (!preview || loading || error || !list.length) return;
        let nextIndex = activePreviewIndex;
        if (event.key === 'ArrowDown') nextIndex = (activePreviewIndex + 1) % list.length;
        else if (event.key === 'ArrowUp') nextIndex = (activePreviewIndex - 1 + list.length) % list.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = list.length - 1;
        else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            activatePreviewOption();
            return;
        } else {
            return;
        }
        event.preventDefault();
        setActivePreviewIndex(nextIndex);
    };

    const resolveKey = (option, index) => {
        if (optionKey) return optionKey(option);
        if (optionLabel) return optionLabel(option);
        return index;
    };

    const menu = (
        <div
            className={`${blockClass}-menu${effectivePortalTarget ? ' is-portalled' : ''}${preview ? ' is-preview-only' : ''}`}
            role="menu"
            data-issue-key={key}
            onKeyDown={handleMenuKeyDown}
            onClick={handlePreviewMenuClick}
            ref={menuRef}
            tabIndex={preview ? -1 : undefined}
            aria-label={preview ? `${menuLabel}. Read-only preview.` : undefined}
            aria-activedescendant={preview && !loading && !error && list.length ? `${previewId}-option-${activePreviewIndex}` : undefined}
            data-onboarding-preview-owner={preview ? String(previewDescriptor?.targetIdentity || '') : undefined}
            {...{ [`data-${blockClass}-menu`]: 'true' }}
        >
                {leadingContent}
                {preview && (
                    <div
                        className={`${blockClass}-menu-note onboarding-tour-preview-note`}
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                    >
                        Read-only preview. {previewStatusLabel}
                    </div>
                )}
                {loading && (
                    <div className={`${blockClass}-menu-note ${blockClass}-menu-loading`}>{loadingLabel}</div>
                )}
                {!loading && error && (
                    <div
                        className={`${blockClass}-menu-note ${blockClass}-menu-error${errorTooMany ? ' is-too-many' : ''}`}
                        role={preview ? undefined : 'alert'}
                    >
                        {error}
                    </div>
                )}
                {!loading && showEmpty && (
                    <div className={`${blockClass}-menu-note`}>{emptyLabel}</div>
                )}
                {!loading && list.length > 0 && (
                    <div className={`${blockClass}-menu-options`} aria-label={menuLabel}>
                        {list.map((option, index) => preview ? (
                            <button
                                key={resolveKey(option, index)}
                                id={`${previewId}-option-${index}`}
                                type="button"
                                className={`${blockClass}-option${index === activePreviewIndex ? ' is-preview-active' : ''}`}
                                role="menuitem"
                                onClick={activatePreviewOption}
                            >
                                {renderMarker ? renderMarker(option) : null}
                                <span className={`${blockClass}-option-label`}>{optionLabel ? optionLabel(option) : ''}</span>
                            </button>
                        ) : (
                            <button
                                key={resolveKey(option, index)}
                                ref={index === 0 ? firstOptionRef : null}
                                type="button"
                                className={`${blockClass}-option`}
                                role="menuitem"
                                onClick={() => { if (!disabled) onSelect?.(option); }}
                                disabled={disabled}
                            >
                                {renderMarker ? renderMarker(option) : null}
                                <span className={`${blockClass}-option-label`}>{optionLabel ? optionLabel(option) : ''}</span>
                            </button>
                        ))}
                    </div>
                )}
                {result && (
                    <div className={`${blockClass}-menu-result`} role={preview ? undefined : 'status'}>{result}</div>
                )}
        </div>
    );

    if (preview && !effectivePortalTarget) return null;
    return effectivePortalTarget ? createPortal(menu, effectivePortalTarget) : menu;
}
