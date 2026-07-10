import * as React from 'react';

// Shared compact option-menu renderer for ENG field-change popovers (status + priority).
// It renders the anchored role="menu" panel; the trigger (status pill / priority icon button)
// and the position:relative wrapper live in the field-specific menu component. Class names are
// namespaced by `blockClass` ('status-transition' | 'priority-transition') so the status menu
// keeps its exact DOM/test hooks while the CSS aliases the priority selectors onto the same
// declarations. Owns first-option focus, Escape handling, and outside-click dismissal so both
// fields share identical keyboard/pointer behavior.
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
}) {
    const firstOptionRef = React.useRef(null);
    const key = String(issueKey || '').trim();
    const list = Array.isArray(options) ? options : [];

    // Move focus into the menu once options are available (mirrors status behavior). The menu
    // mounts only while open, so this runs on open and whenever loading flips to false.
    React.useEffect(() => {
        if (!loading && firstOptionRef.current) {
            firstOptionRef.current.focus();
        }
    }, [loading]);

    // Keep the latest onEscape in a ref so the outside-click listener attaches ONCE for the
    // menu's open lifetime (below) rather than re-attaching on every re-render — otherwise the
    // brief detach/re-attach window (e.g. when async options finish loading) could drop an
    // outside click.
    const onEscapeRef = React.useRef(onEscape);
    onEscapeRef.current = onEscape;

    // Dismiss on any outside pointerdown while open. A fixed click-away backdrop cannot be
    // relied on here: .task-item / .epic-header carry a persisted transform (the task-appear
    // animation's `both`-fill `to` state), which makes the card the containing block for
    // position:fixed and clamps a fixed backdrop to the card box instead of the viewport, so
    // outside-card clicks missed it. A document-level pointerdown scoped to the field wrapper
    // (trigger + menu) closes the menu wherever the click lands; in-wrapper clicks (trigger
    // toggle, option select) are left to their own handlers. Escape is handled below.
    React.useEffect(() => {
        const wrapper = dismissRef && dismissRef.current;
        if (!wrapper) return undefined;
        const handlePointerDown = (event) => {
            if (!wrapper.contains(event.target)) {
                onEscapeRef.current?.();
            }
        };
        // Attach on the next tick so the click that opened this menu is not itself treated as
        // an outside click and does not immediately close it.
        const timer = window.setTimeout(() => {
            document.addEventListener('pointerdown', handlePointerDown, true);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener('pointerdown', handlePointerDown, true);
        };
    }, [dismissRef]);

    const handleMenuKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onEscape?.();
        }
    };

    const resolveKey = (option, index) => {
        if (optionKey) return optionKey(option);
        if (optionLabel) return optionLabel(option);
        return index;
    };

    return (
        <div
            className={`${blockClass}-menu`}
            role="menu"
            data-issue-key={key}
            onKeyDown={handleMenuKeyDown}
            {...{ [`data-${blockClass}-menu`]: 'true' }}
        >
                {leadingContent}
                {loading && (
                    <div className={`${blockClass}-menu-note ${blockClass}-menu-loading`}>{loadingLabel}</div>
                )}
                {!loading && error && (
                    <div
                        className={`${blockClass}-menu-note ${blockClass}-menu-error${errorTooMany ? ' is-too-many' : ''}`}
                        role="alert"
                    >
                        {error}
                    </div>
                )}
                {!loading && showEmpty && (
                    <div className={`${blockClass}-menu-note`}>{emptyLabel}</div>
                )}
                {!loading && list.length > 0 && (
                    <div className={`${blockClass}-menu-options`} aria-label={menuLabel}>
                        {list.map((option, index) => (
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
                    <div className={`${blockClass}-menu-result`} role="status">{result}</div>
                )}
        </div>
    );
}
