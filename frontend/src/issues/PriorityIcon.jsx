import * as React from 'react';
import EpicHeaderValueReadout from '../eng/EpicHeaderValueReadout.jsx';

// The passive priority icon renderPriorityIcon (dashboard.jsx) returns. Its label is the shared portaled
// readout, which paints above the sticky Epic header, filter bar and Planning panel and lets the pointer
// through; it follows a mouse or pen hover, and a touch tap pins it (`transient` mode). Its props stay the
// icon's own className, data-attrs, aria-label and SVG, so PriorityTransitionMenu's trigger reuses them. `readout={false}` renders the bare icon
// (filter options, whose label sits beside it).
export default function PriorityIcon({ children, readout = true, ...iconAttrs }) {
    if (!readout) return <span {...iconAttrs}>{children}</span>;
    return (
        <EpicHeaderValueReadout value={iconAttrs['data-priority']} alwaysOn transient pointerTransparent>
            {({ triggerRef, pointerProps, pinProps }) => (
                <span ref={triggerRef} {...iconAttrs} {...pointerProps} onPointerDown={pinProps.onPointerDown} onClick={pinProps.onClick}>
                    {children}
                </span>
            )}
        </EpicHeaderValueReadout>
    );
}
