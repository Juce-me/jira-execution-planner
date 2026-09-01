import * as React from 'react';
import { createPortal } from 'react-dom';

const MENU_EDGE_GAP = 8;
const MENU_TRIGGER_GAP = 6;

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
    const menuRef = React.useRef(null);
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

    // A menu inside the Board epic panel cannot remain under its trigger in the DOM: story
    // triggers live in the panel's overflow-y:auto body, which clips a full workflow list, and
    // the header/body paint order can cover a header menu. When a panel host is supplied, render
    // the same menu at that host and position it against the trigger in viewport coordinates.
    // The menu flips above when that side has more room and scrolls internally when neither side
    // can fit it; resize and scroll keep it attached to the live trigger.
    React.useLayoutEffect(() => {
        if (!effectivePortalTarget) return undefined;
        const menu = menuRef.current;
        const wrapper = dismissRef && dismissRef.current;
        const trigger = wrapper?.querySelector(`[data-${blockClass}-trigger]`);
        if (!menu || !trigger) return undefined;
        if (preview) menu.style.position = 'fixed';

        const positionMenu = () => {
            const triggerRect = trigger.getBoundingClientRect();
            const visualViewport = preview ? window.visualViewport : null;
            const viewportLeft = Math.max(0, Number(visualViewport?.offsetLeft) || 0);
            const viewportTop = Math.max(0, Number(visualViewport?.offsetTop) || 0);
            const viewportWidth = Math.max(0, Number(visualViewport?.width) || document.documentElement.clientWidth);
            const viewportHeight = Math.max(0, Number(visualViewport?.height) || window.innerHeight);
            const viewportRight = viewportLeft + viewportWidth;
            const viewportBottom = viewportTop + viewportHeight;

            menu.style.left = `${triggerRect.left}px`;
            menu.style.top = `${triggerRect.bottom + MENU_TRIGGER_GAP}px`;
            menu.style.maxHeight = `${Math.max(0, viewportHeight - MENU_EDGE_GAP * 2)}px`;

            const naturalHeight = Math.min(menu.scrollHeight, viewportHeight - MENU_EDGE_GAP * 2);
            const belowSpace = viewportBottom - MENU_EDGE_GAP - triggerRect.bottom - MENU_TRIGGER_GAP;
            const aboveSpace = triggerRect.top - MENU_TRIGGER_GAP - viewportTop - MENU_EDGE_GAP;
            const placeBelow = belowSpace >= naturalHeight || belowSpace >= aboveSpace;
            const availableHeight = Math.max(0, placeBelow ? belowSpace : aboveSpace);
            menu.style.maxHeight = `${availableHeight}px`;

            const height = Math.min(naturalHeight, availableHeight);
            menu.style.top = placeBelow
                ? `${triggerRect.bottom + MENU_TRIGGER_GAP}px`
                : `${Math.max(viewportTop + MENU_EDGE_GAP, triggerRect.top - MENU_TRIGGER_GAP - height)}px`;

            const menuRect = menu.getBoundingClientRect();
            const minLeft = viewportLeft + MENU_EDGE_GAP;
            const maxLeft = Math.max(minLeft, viewportRight - MENU_EDGE_GAP - menuRect.width);
            menu.style.left = `${Math.min(Math.max(minLeft, triggerRect.left), maxLeft)}px`;
        };

        positionMenu();
        window.addEventListener('resize', positionMenu);
        window.addEventListener('scroll', positionMenu, true);
        if (preview) {
            window.visualViewport?.addEventListener('resize', positionMenu);
            window.visualViewport?.addEventListener('scroll', positionMenu);
        }
        return () => {
            window.removeEventListener('resize', positionMenu);
            window.removeEventListener('scroll', positionMenu, true);
            if (preview) {
                window.visualViewport?.removeEventListener('resize', positionMenu);
                window.visualViewport?.removeEventListener('scroll', positionMenu);
            }
        };
    }, [blockClass, dismissRef, effectivePortalTarget, loading, list.length, error, preview, result]);

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
        if (!wrapper || preview) return undefined;
        const handlePointerDown = (event) => {
            if (!wrapper.contains(event.target) && !menuRef.current?.contains(event.target)) {
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
    }, [dismissRef, preview]);

    // Escape closes the menu, so focus must go back to the trigger that opened it. Without this
    // the focused option simply unmounts and focus falls to <body>: the keyboard user loses their
    // place on every surface, and inside a focus trap (the board's epic panel binds Escape/Tab to
    // the panel element) the next Escape reaches nothing and the dialog becomes undismissable.
    // The trigger is resolved from the dismissRef wrapper; every consumer marks it with
    // data-<blockClass>-trigger. A portalled menu still returns focus to that same anchor.
    const focusTrigger = () => {
        const wrapper = dismissRef && dismissRef.current;
        wrapper?.querySelector(`[data-${blockClass}-trigger]`)?.focus();
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
                            <div
                                key={resolveKey(option, index)}
                                id={`${previewId}-option-${index}`}
                                className={`${blockClass}-option${index === activePreviewIndex ? ' is-preview-active' : ''}`}
                                role="menuitem"
                                aria-disabled="true"
                            >
                                {renderMarker ? renderMarker(option) : null}
                                <span className={`${blockClass}-option-label`}>{optionLabel ? optionLabel(option) : ''}</span>
                            </div>
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
