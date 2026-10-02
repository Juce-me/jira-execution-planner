import * as React from 'react';
import { createPortal } from 'react-dom';
import { nearestBoundary } from './planningReviewTableModel.js';

const ENGAGE = 5, STAY = 9;   // px from a boundary: closer than ENGAGE shows the +, and it stays until the pointer leaves STAY

// One fixed, body-level "+" that follows the pointer along the live header's cell boundaries (pointer devices only).
// `getLive()` returns { row, left, right }: the header row the user sees (the docked clone while docked) and the horizontal bounds
// the boundaries must fall inside (frozen columns excluded). Key never gets a boundary; Summary's boundary inserts directly after the pinned columns.
export default function PlanningReviewBoundaryPlus({ getLive, suspended, onOpen, onHover }) {
    const [target, setTarget] = React.useState(null);
    const targetRef = React.useRef(null);
    const overlayRef = React.useRef(null);
    const latest = React.useRef({});
    latest.current = { getLive, onHover };

    React.useEffect(() => {
        const hide = () => {
            if (!targetRef.current) return;
            targetRef.current = null; setTarget(null); latest.current.onHover(null);
        };
        if (suspended || window.matchMedia('(hover: none)').matches) { hide(); return undefined; }
        let frame = 0, pointer = null;
        const evaluate = () => {
            frame = 0;
            const live = latest.current.getLive();
            if (!pointer || !live?.row) { hide(); return; }
            const rowRect = live.row.getBoundingClientRect();
            const overOverlay = overlayRef.current?.contains(pointer.target);
            if (!overOverlay && (pointer.clientY < rowRect.top || pointer.clientY > rowRect.bottom || pointer.clientX < live.left || pointer.clientX > live.right + STAY)) { hide(); return; }   // the last column's + reaches past the scroller's edge
            if (pointer.target.closest?.('.planning-review-popover')) { hide(); return; }
            // Columns scrolled under the frozen cells (select, Key, and Summary on wide screens) have no visible edge to offer.
            const cells = Array.from(live.row.cells);
            const frozenRight = Math.max(live.left, ...cells.filter(cell => getComputedStyle(cell).left !== 'auto').map(cell => cell.getBoundingClientRect().right));
            const edges = cells.filter(cell => cell.dataset.columnId && cell.dataset.columnId !== 'key')
                .map(cell => ({ afterId: cell.dataset.columnId, x: cell.getBoundingClientRect().right }))
                .filter(edge => edge.x >= frozenRight - 0.5 && edge.x <= live.right);
            const afterId = nearestBoundary(edges, pointer.clientX, targetRef.current ? STAY : ENGAGE);
            if (afterId === null) { hide(); return; }
            const next = { afterId, x: edges.find(edge => edge.afterId === afterId).x, top: rowRect.top, height: rowRect.height };
            const previous = targetRef.current;
            if (previous && previous.afterId === next.afterId && previous.x === next.x && previous.top === next.top && previous.height === next.height) return;
            targetRef.current = next; setTarget(next);
            if (!previous || previous.afterId !== next.afterId) latest.current.onHover(next.afterId);
        };
        const onMove = event => { pointer = event; if (!frame) frame = requestAnimationFrame(evaluate); };
        const onAway = () => { pointer = null; hide(); };
        document.addEventListener('mousemove', onMove, { passive: true });
        document.documentElement.addEventListener('mouseleave', onAway);
        window.addEventListener('scroll', onAway, { capture: true, passive: true });
        window.addEventListener('resize', onAway);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('mousemove', onMove);
            document.documentElement.removeEventListener('mouseleave', onAway);
            window.removeEventListener('scroll', onAway, { capture: true });
            window.removeEventListener('resize', onAway);
            hide();
        };
    }, [suspended]);

    return createPortal(
        <div ref={overlayRef} className="planning-review-boundary" hidden={!target} style={target ? { left: target.x, top: target.top, height: target.height } : undefined}>
            <span className="planning-review-boundary-line" aria-hidden="true" />
            <button type="button" className="planning-review-boundary-hit" tabIndex={-1} aria-hidden="true" onClick={() => { if (targetRef.current) onOpen(targetRef.current.afterId); }}>
                <span className="planning-review-boundary-dot" aria-hidden="true">+</span>
            </button>
        </div>, document.body);
}
