import * as React from 'react';

export default function PlanningTableStickyStack({ overview, compactHeaderRef, onActivate, toolbarRef, children }) {
    const ref = React.useRef(null);
    const activateRef = React.useRef(onActivate);
    activateRef.current = onActivate;
    React.useEffect(() => {
        let activated = false, frame;
        const onScroll = () => {
            if (window.scrollY <= 0) { activated = false; return; }
            if (activated) return;
            activated = true;
            activateRef.current?.();
            frame = requestAnimationFrame(() => {
                const headerHeight = compactHeaderRef?.current?.getBoundingClientRect().height || 0;
                const top = ref.current?.getBoundingClientRect().top;
                // Include the header's flow margin so scroll anchoring cannot leave the stack short of its sticky boundary.
                const headerMargin = compactHeaderRef?.current ? parseFloat(getComputedStyle(compactHeaderRef.current).marginBottom) || 0 : 0;
                if (top > headerHeight) window.scrollTo({ top: window.scrollY + top - headerHeight + headerMargin, behavior: 'instant' });
            });
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
    }, [compactHeaderRef]);
    return <div ref={ref} className="planning-review-sticky-stack">{children}{overview}<div ref={toolbarRef} className="planning-review-toolbar-slot" /></div>;
}
