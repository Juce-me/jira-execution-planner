import * as React from 'react';
import { createPortal } from 'react-dom';
import useIssueFieldPopover from '../issues/useIssueFieldPopover.js';

export default function PlanningPopover({ open, onClose, label, trigger, children, error, anchorClassName = '' }) {
    const wrapperRef = React.useRef(null);
    const target = document.body;
    const { triggerRef, panelRef, focusTrigger } = useIssueFieldPopover({
        blockClass: 'planning-review-popover', wrapperRef, portalTarget: target, active: open,
        onDismiss: () => close(false), useVisualViewport: true, dependencies: [children, error],
    });
    const close = restoreFocus => {
        if (panelRef.current?.contains(document.activeElement)) document.activeElement.blur();
        onClose();
        if (restoreFocus) focusTrigger();
    };
    // Focus synchronously so Escape works the moment the panel is open.
    React.useLayoutEffect(() => {
        if (open) (panelRef.current?.querySelector('[data-autofocus]') ?? panelRef.current)?.focus({ preventScroll: true });
    }, [open]);
    return <span className={`planning-review-popover-anchor${anchorClassName ? ` ${anchorClassName}` : ''}`} ref={wrapperRef}>
        {React.cloneElement(trigger, { ref: triggerRef, 'aria-haspopup': 'dialog', 'aria-expanded': open })}
        {open && createPortal(<div ref={panelRef} className="planning-review-popover" role="dialog" aria-label={label} tabIndex={-1}
            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }}
            onClick={event => { if (event.target.closest('[data-review-popover-close]')) close(true); }}>
            {children}{error && <p className="planning-review-guidance" role="alert">{error}</p>}
        </div>, target)}
    </span>;
}

