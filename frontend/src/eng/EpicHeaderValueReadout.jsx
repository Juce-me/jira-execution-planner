import * as React from 'react';
import { createPortal } from 'react-dom';

export default function EpicHeaderValueReadout({ value, suppressed = false, measureSelector = '', nativeSelector = '', children }) {
    const triggerRef = React.useRef(null);
    const readoutRef = React.useRef(null);
    const closeTimerRef = React.useRef(null);
    const triggerHoveredRef = React.useRef(false);
    const readoutHoveredRef = React.useRef(false);
    const focusWithinRef = React.useRef(false);
    const [truncated, setTruncated] = React.useState(false);
    const [visible, setVisible] = React.useState(false);
    const [position, setPosition] = React.useState({ left: 8, top: 8, placed: false, above: false });
    const readoutId = React.useId().replace(/:/g, '');

    const cancelClose = React.useCallback(() => {
        if (closeTimerRef.current == null) return;
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
    }, []);

    const scheduleClose = React.useCallback(() => {
        cancelClose();
        closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null;
            if (!triggerHoveredRef.current && !readoutHoveredRef.current && !focusWithinRef.current) {
                setVisible(false);
            }
        }, 80);
    }, [cancelClose]);

    const measureTruncation = React.useCallback(() => {
        const root = triggerRef.current;
        const node = measureSelector ? root?.querySelector?.(measureSelector) : root;
        const next = Boolean(node && (
            node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1
        ));
        setTruncated(previous => (previous === next ? previous : next));
        if (!next) setVisible(false);
    }, [measureSelector]);

    React.useLayoutEffect(() => {
        measureTruncation();
        const node = triggerRef.current;
        if (!node || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measureTruncation);
        observer.observe(node);
        const measuredNode = measureSelector ? node.querySelector?.(measureSelector) : null;
        if (measuredNode && measuredNode !== node) observer.observe(measuredNode);
        return () => observer.disconnect();
    }, [measureTruncation, measureSelector, value]);

    React.useEffect(() => {
        const fontSet = document.fonts;
        if (!fontSet?.ready) return undefined;
        let active = true;
        let frame = null;
        const measureAfterFontLoad = () => {
            if (!active) return;
            if (frame != null) window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(measureTruncation);
        };
        fontSet.ready.then(measureAfterFontLoad);
        fontSet.addEventListener?.('loadingdone', measureAfterFontLoad);
        return () => {
            active = false;
            if (frame != null) window.cancelAnimationFrame(frame);
            fontSet.removeEventListener?.('loadingdone', measureAfterFontLoad);
        };
    }, [measureTruncation]);

    React.useLayoutEffect(() => {
        if (!nativeSelector) return undefined;
        const nativeTarget = triggerRef.current?.querySelector?.(nativeSelector);
        if (!nativeTarget) return undefined;
        const descriptionId = truncated ? `epic-full-value-${readoutId}` : '';
        if (descriptionId) nativeTarget.setAttribute('aria-describedby', descriptionId);
        else nativeTarget.removeAttribute('aria-describedby');
        return () => {
            if (nativeTarget.getAttribute('aria-describedby') === descriptionId) {
                nativeTarget.removeAttribute('aria-describedby');
            }
        };
    }, [nativeSelector, readoutId, truncated]);

    const updatePosition = React.useCallback(() => {
        const trigger = triggerRef.current;
        const readout = readoutRef.current;
        if (!trigger || !readout) return;
        const triggerRect = trigger.getBoundingClientRect();
        const readoutRect = readout.getBoundingClientRect();
        const viewportWidth = window.visualViewport?.width || window.innerWidth;
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const viewportLeft = window.visualViewport?.offsetLeft || 0;
        const viewportTop = window.visualViewport?.offsetTop || 0;
        const padding = 8;
        const gap = 6;
        const minLeft = viewportLeft + padding;
        const maxLeft = Math.max(minLeft, viewportLeft + viewportWidth - padding - readoutRect.width);
        const left = Math.min(Math.max(triggerRect.left, minLeft), maxLeft);
        const belowTop = triggerRect.bottom + gap;
        const above = belowTop + readoutRect.height > viewportTop + viewportHeight - padding;
        const preferredTop = above ? triggerRect.top - readoutRect.height - gap : belowTop;
        const maxTop = Math.max(viewportTop + padding, viewportTop + viewportHeight - padding - readoutRect.height);
        const top = Math.min(Math.max(preferredTop, viewportTop + padding), maxTop);
        setPosition({ left, top, placed: true, above });
    }, []);

    React.useLayoutEffect(() => {
        if (!visible || suppressed) return undefined;
        updatePosition();
        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);
        window.visualViewport?.addEventListener?.('resize', updatePosition);
        window.visualViewport?.addEventListener?.('scroll', updatePosition);
        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
            window.visualViewport?.removeEventListener?.('resize', updatePosition);
            window.visualViewport?.removeEventListener?.('scroll', updatePosition);
        };
    }, [suppressed, updatePosition, visible]);

    React.useEffect(() => {
        if (!visible || suppressed) return undefined;
        const dismissOnEscape = event => {
            if (event.key !== 'Escape') return;
            triggerHoveredRef.current = false;
            readoutHoveredRef.current = false;
            setVisible(false);
        };
        document.addEventListener('keydown', dismissOnEscape, true);
        return () => document.removeEventListener('keydown', dismissOnEscape, true);
    }, [suppressed, visible]);

    React.useEffect(() => {
        if (suppressed) setVisible(false);
    }, [suppressed]);

    React.useEffect(() => () => cancelClose(), [cancelClose]);

    const show = () => {
        cancelClose();
        if (truncated && !suppressed) {
            setPosition(previous => ({ ...previous, placed: false }));
            setVisible(true);
        }
    };
    const pointerProps = {
        onPointerEnter: () => {
            triggerHoveredRef.current = true;
            show();
        },
        onPointerLeave: () => {
            triggerHoveredRef.current = false;
            scheduleClose();
        },
    };
    const focusProps = {
        onFocus: () => {
            focusWithinRef.current = true;
            show();
        },
        onBlur: event => {
            if (triggerRef.current?.contains(event.relatedTarget)) return;
            focusWithinRef.current = false;
            scheduleClose();
        },
    };
    const describedBy = truncated ? `epic-full-value-${readoutId}` : undefined;
    const readout = visible && truncated && !suppressed ? createPortal(
        <span
            ref={readoutRef}
            id={`epic-full-value-${readoutId}`}
            className={`epic-full-value-readout${position.above ? ' is-above' : ''}`}
            role="tooltip"
            style={{
                left: `${position.left}px`,
                top: `${position.top}px`,
                visibility: position.placed ? 'visible' : 'hidden',
            }}
            onPointerEnter={() => {
                readoutHoveredRef.current = true;
                cancelClose();
            }}
            onPointerLeave={() => {
                readoutHoveredRef.current = false;
                scheduleClose();
            }}
        >
            {value}
        </span>,
        document.body
    ) : null;

    return (
        <>
            {children({
                triggerRef,
                truncated,
                describedBy,
                pointerProps,
                focusProps,
                discoveryProps: {
                    ref: triggerRef,
                    ...pointerProps,
                    ...focusProps,
                    tabIndex: truncated ? 0 : undefined,
                    'aria-label': value,
                    'aria-describedby': describedBy,
                },
            })}
            {readout}
        </>
    );
}
