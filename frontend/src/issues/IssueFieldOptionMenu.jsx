import * as React from 'react';

// Shared compact option-menu renderer for ENG field-change popovers (status + priority).
// It renders only the click-away backdrop and the anchored role="menu" panel; the trigger
// (status pill / priority icon button) and the position:relative wrapper live in the
// field-specific menu component. Class names are namespaced by `blockClass`
// ('status-transition' | 'priority-transition') so the status menu keeps its exact DOM/test
// hooks while the CSS aliases the priority selectors onto the same declarations. Owns
// first-option focus and Escape handling so both fields share identical keyboard behavior.
export default function IssueFieldOptionMenu({
    blockClass,
    issueKey,
    menuLabel = '',
    closeLabel = 'Close menu',
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
        <>
            <button
                type="button"
                className={`${blockClass}-menu-backdrop`}
                aria-label={closeLabel}
                onClick={() => onEscape?.()}
            />
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
        </>
    );
}
