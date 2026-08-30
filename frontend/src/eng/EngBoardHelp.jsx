import * as React from 'react';

const HELP_MAX_WIDTH = 512;
const HELP_GUTTER = 12;

export default function EngBoardHelp({ scaleMax = 1 }) {
    const [open, setOpen] = React.useState(false);
    const hostRef = React.useRef(null);
    const triggerRef = React.useRef(null);
    const popoverRef = React.useRef(null);
    const titleId = React.useId();
    const dialogId = React.useId();

    const closeWithFocus = React.useCallback(() => {
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
    }, []);

    const placePopover = React.useCallback(() => {
        const popover = popoverRef.current;
        if (!popover) return;
        const viewportWidth = document.documentElement.clientWidth;
        const availableWidth = Math.max(0, viewportWidth - HELP_GUTTER * 2);
        popover.style.width = `${Math.min(HELP_MAX_WIDTH, availableWidth)}px`;
        popover.style.left = '0px';
        const overflowRight = popover.getBoundingClientRect().right - (viewportWidth - HELP_GUTTER);
        if (overflowRight > 0) popover.style.left = `${-overflowRight}px`;
    }, []);

    React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (!hostRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeWithFocus();
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [closeWithFocus, open]);

    React.useLayoutEffect(() => {
        if (!open) return;
        const popover = popoverRef.current;
        if (!popover) return;
        placePopover();
        popover.focus({ preventScroll: true });
        let resizeFrame = 0;
        const onResize = () => {
            window.cancelAnimationFrame(resizeFrame);
            resizeFrame = window.requestAnimationFrame(() => {
                resizeFrame = window.requestAnimationFrame(placePopover);
            });
        };
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            window.cancelAnimationFrame(resizeFrame);
        };
    }, [open, placePopover]);

    return (
        <div className="board-help-host" ref={hostRef}>
            <button
                type="button"
                className="board-help-trigger"
                ref={triggerRef}
                aria-label="How Group Board works"
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-controls={open ? dialogId : undefined}
                onClick={() => setOpen((wasOpen) => !wasOpen)}
            >
                <svg
                    className="board-help-icon"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    focusable="false"
                >
                    <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="8" cy="5" r="0.9" fill="currentColor" />
                    <path d="M8 7.25v4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
            </button>
            {open && (
                <div
                    id={dialogId}
                    className="board-help-popover"
                    role="dialog"
                    aria-labelledby={titleId}
                    tabIndex={-1}
                    ref={popoverRef}
                >
                    <h2 id={titleId}>How Group Board works</h2>
                    <ul className="board-help-copy">
                        <li>Choose a folded column to centre it.</li>
                        <li>Star a column to keep it open for this session.</li>
                        <li>Cards are ordered highest priority first.</li>
                        <li>The tallest bar represents {scaleMax} epics.</li>
                        <li>Drag a card to another column to change its epic status.</li>
                    </ul>
                    <p className="board-help-copy">
                        Shared columns, the default star, and Min/Max limits live in Group Board settings.
                    </p>
                </div>
            )}
        </div>
    );
}
