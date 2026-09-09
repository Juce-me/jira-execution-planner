import * as React from 'react';

const POPOVER_EDGE_GAP = 8;
const POPOVER_TRIGGER_GAP = 6;

export default function useIssueFieldPopover({
    blockClass,
    wrapperRef = null,
    portalTarget = null,
    active = true,
    preview = false,
    onDismiss,
    restoreFocusOnOutside = false,
    useVisualViewport = false,
    dependencies = [],
} = {}) {
    const triggerRef = React.useRef(null);
    const panelRef = React.useRef(null);
    const onDismissRef = React.useRef(onDismiss);
    onDismissRef.current = onDismiss;

    const resolveTrigger = React.useCallback(() => {
        if (triggerRef.current) return triggerRef.current;
        const wrapper = wrapperRef?.current;
        return wrapper?.querySelector(`[data-${blockClass}-trigger]`) || null;
    }, [blockClass, wrapperRef]);

    const focusTrigger = React.useCallback(() => {
        resolveTrigger()?.focus();
    }, [resolveTrigger]);

    React.useLayoutEffect(() => {
        if (!active || !portalTarget) return undefined;
        const panel = panelRef.current;
        const trigger = resolveTrigger();
        if (!panel || !trigger) return undefined;

        const positionPanel = () => {
            const triggerRect = trigger.getBoundingClientRect();
            const visualViewport = useVisualViewport ? window.visualViewport : null;
            const viewportLeft = Math.max(0, Number(visualViewport?.offsetLeft) || 0);
            const viewportTop = Math.max(0, Number(visualViewport?.offsetTop) || 0);
            const viewportWidth = Math.max(0, Number(visualViewport?.width) || document.documentElement.clientWidth);
            const viewportHeight = Math.max(0, Number(visualViewport?.height) || window.innerHeight);
            const viewportRight = viewportLeft + viewportWidth;
            const viewportBottom = viewportTop + viewportHeight;

            panel.style.left = `${triggerRect.left}px`;
            panel.style.top = `${triggerRect.bottom + POPOVER_TRIGGER_GAP}px`;
            panel.style.maxHeight = `${Math.max(0, viewportHeight - POPOVER_EDGE_GAP * 2)}px`;

            const naturalHeight = Math.min(panel.scrollHeight, viewportHeight - POPOVER_EDGE_GAP * 2);
            const belowSpace = viewportBottom - POPOVER_EDGE_GAP - triggerRect.bottom - POPOVER_TRIGGER_GAP;
            const aboveSpace = triggerRect.top - POPOVER_TRIGGER_GAP - viewportTop - POPOVER_EDGE_GAP;
            const placeBelow = belowSpace >= naturalHeight || belowSpace >= aboveSpace;
            const availableHeight = Math.max(0, placeBelow ? belowSpace : aboveSpace);
            const height = Math.min(naturalHeight, availableHeight);
            panel.style.maxHeight = `${availableHeight}px`;
            panel.style.top = placeBelow
                ? `${triggerRect.bottom + POPOVER_TRIGGER_GAP}px`
                : `${Math.max(viewportTop + POPOVER_EDGE_GAP, triggerRect.top - POPOVER_TRIGGER_GAP - height)}px`;

            const panelRect = panel.getBoundingClientRect();
            const minLeft = viewportLeft + POPOVER_EDGE_GAP;
            const maxLeft = Math.max(minLeft, viewportRight - POPOVER_EDGE_GAP - panelRect.width);
            panel.style.left = `${Math.min(Math.max(minLeft, triggerRect.left), maxLeft)}px`;
        };

        positionPanel();
        window.addEventListener('resize', positionPanel);
        window.addEventListener('scroll', positionPanel, true);
        if (useVisualViewport) {
            window.visualViewport?.addEventListener('resize', positionPanel);
            window.visualViewport?.addEventListener('scroll', positionPanel);
        }
        return () => {
            window.removeEventListener('resize', positionPanel);
            window.removeEventListener('scroll', positionPanel, true);
            if (useVisualViewport) {
                window.visualViewport?.removeEventListener('resize', positionPanel);
                window.visualViewport?.removeEventListener('scroll', positionPanel);
            }
        };
    }, [active, portalTarget, resolveTrigger, useVisualViewport, ...dependencies]);

    React.useEffect(() => {
        const wrapper = wrapperRef?.current;
        if (!active || !wrapper || preview) return undefined;
        const handlePointerDown = (event) => {
            if (wrapper.contains(event.target) || panelRef.current?.contains(event.target)) return;
            const trigger = resolveTrigger();
            onDismissRef.current?.();
            if (restoreFocusOnOutside && trigger) window.setTimeout(() => trigger.focus(), 0);
        };
        const timer = window.setTimeout(() => {
            document.addEventListener('pointerdown', handlePointerDown, true);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener('pointerdown', handlePointerDown, true);
        };
    }, [active, preview, resolveTrigger, restoreFocusOnOutside, wrapperRef]);

    return { triggerRef, panelRef, focusTrigger, resolveTrigger };
}
