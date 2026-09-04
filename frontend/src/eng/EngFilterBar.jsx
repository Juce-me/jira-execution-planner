import * as React from 'react';
import {
    buildFacetView,
    countActiveFacets,
    describeFacetChip,
    resetFacetSelection,
    toggleFacetOption,
} from './engFilterFacets.js';
import { resolveEngFilterOptionVisual } from './engFilterOptionVisuals.js';
import { getIssueStatusClassName } from '../issues/issueViewUtils.js';
import StatusPill from '../ui/StatusPill.jsx';
import { getProjectTrackEmoji } from './engTaskUtils.js';

// The compact ENG filter bar: a Filters trigger with its facet popover, the readout, the chips
// lane and a slot for the consumer's own view controls. Presentational — it owns no data, no
// persistence and no analytics (§10.3 excludes facet ticks, chip clears and "+n more"). The
// facet set arrives as a prop so the Board (epics) and Catch Up (stories) share one bar with
// different subjects; the subject is stated on screen because counts are not comparable
// between them (D19).

const LOCKED_REASON = 'Keep at least one — an empty filter would show nothing';
const POPOVER_MAX_WIDTH = 348;
const POPOVER_GUTTER = 12;

export default function EngFilterBar({
    facets = [],
    selection = {},
    counts = {},
    scopeTotal = 0,
    subject = '',
    readoutCount = 0,
    readoutUnit = '',
    onChange,
    onClearAll,
    onHeightChange,
    viewControls = null,
    boardColumns = [],
    renderPriorityIcon,
}) {
    const mountId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '') || 'eng-filter';
    const [open, setOpen] = React.useState(false);
    const [hiddenChipCount, setHiddenChipCount] = React.useState(0);
    const popHostRef = React.useRef(null);
    const triggerRef = React.useRef(null);
    const popoverRef = React.useRef(null);
    const chipsRef = React.useRef(null);
    const moreRef = React.useRef(null);
    const wrapRef = React.useRef(null);

    React.useLayoutEffect(() => {
        const node = wrapRef.current;
        if (!node) return undefined;
        const reportHeight = () => {
            onHeightChange?.(node.getBoundingClientRect().height || 0);
        };
        reportHeight();
        const observer = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(reportHeight)
            : null;
        observer?.observe(node);
        return () => {
            observer?.disconnect();
            onHeightChange?.(0);
        };
    }, [onHeightChange]);

    const facetViews = buildFacetView({ facets, selection, counts, scopeTotal });
    const activeFacetCount = countActiveFacets(facetViews);
    const chips = facetViews
        .map((facetView, index) => ({
            facet: facets[index],
            copy: describeFacetChip(facetView, facets[index]),
        }))
        .filter((chip) => chip.copy);

    const resetFacet = (facet) => {
        onChange?.(resetFacetSelection(selection, facet, counts));
    };

    const selectOption = (facet, optionId) => {
        const next = toggleFacetOption(selection, facet, optionId, counts);
        // A locked option returns the selection unchanged rather than emptying its facet.
        if (next !== selection) onChange?.(next);
    };

    const closePopover = () => {
        setOpen(false);
        triggerRef.current?.focus();
    };

    // Dismiss on an outside click, matching the app's other anchored panels.
    React.useEffect(() => {
        if (!open) return undefined;
        const onDocClick = (event) => {
            if (popHostRef.current && !popHostRef.current.contains(event.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [open]);

    // §10.1: Escape closes the popover unconditionally. A handler on `.pop-host` alone only
    // catches Escape while focus is still inside it — a click on the panel's dead space (its
    // padding, `.pop-subject`, `.pop-head`) moves focus to <body> first, after which Escape would
    // no longer bubble through `.pop-host`. Listen on the document instead while open.
    React.useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                closePopover();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open]);

    // D29: sized at open time, not in CSS. 100vw counts the scrollbar, and the trigger sits in
    // a sticky bar, so the room below it changes with scroll; the panel scrolls internally.
    React.useLayoutEffect(() => {
        if (!open) return undefined;
        const fitPopover = () => {
            const popover = popoverRef.current;
            const trigger = triggerRef.current;
            if (!popover || !trigger) return;
            const docWidth = document.documentElement.clientWidth;
            const triggerRect = trigger.getBoundingClientRect();
            popover.style.width = `${Math.min(POPOVER_MAX_WIDTH, docWidth - POPOVER_GUTTER * 2)}px`;
            popover.style.maxHeight = `${Math.max(180, window.innerHeight - triggerRect.bottom - POPOVER_GUTTER * 2)}px`;
            // keep it inside the right edge without leaving its anchor
            popover.style.left = '0px';
            const overflowRight = popover.getBoundingClientRect().right - (docWidth - POPOVER_GUTTER);
            if (overflowRight > 0) popover.style.left = `${-overflowRight}px`;
        };
        fitPopover();
        window.addEventListener('resize', fitPopover);
        return () => window.removeEventListener('resize', fitPopover);
    }, [open]);

    // D36: the lane clips, then collapses. Hide chips from the end and account for them in one
    // "+n more" until the lane fits, so the bar can never grow a second row. Recomputed on
    // render and on resize. Clear all is never collapsed — with chips hidden it is the one
    // control still acting on all of them.
    React.useLayoutEffect(() => {
        const lane = chipsRef.current;
        const more = moreRef.current;
        if (!lane || !more) return undefined;
        const collapse = () => {
            const chipElements = [...lane.querySelectorAll('.chip:not(.chip-more)')];
            chipElements.forEach((element) => { element.hidden = false; });
            more.hidden = true;
            const fits = () => lane.scrollWidth <= lane.clientWidth + 1;
            if (!chipElements.length || fits()) {
                setHiddenChipCount(0);
                return;
            }
            more.hidden = false;
            let collapsed = 0;
            for (let index = chipElements.length - 1; index >= 0; index -= 1) {
                chipElements[index].hidden = true;
                collapsed += 1;
                if (fits()) break;
            }
            setHiddenChipCount(collapsed);
        };
        collapse();
        window.addEventListener('resize', collapse);
        return () => window.removeEventListener('resize', collapse);
    });

    return (
        <div className="filterbar-wrap" ref={wrapRef} data-onboarding-target="filters">
            <div className="filterbar">
                <div className="pop-host" ref={popHostRef}>
                    <button
                        type="button"
                        className="fb-trigger"
                        ref={triggerRef}
                        aria-expanded={open}
                        aria-haspopup="dialog"
                        onClick={() => setOpen((wasOpen) => !wasOpen)}
                    >
                        Filters
                        {activeFacetCount > 0 && <span className="badge">{activeFacetCount}</span>}
                    </button>
                    {open && (
                        <div className="popover" role="dialog" aria-label="Filters" ref={popoverRef}>
                            <div className="pop-subject">{subject}</div>
                            {facetViews.map((facetView, index) => {
                                const facet = facets[index];
                                const isSingle = facetView.kind === 'single';
                                const emptyDescriptionId = `${mountId}-${facetView.id}-empty-description`;
                                return (
                                    <div className="pop-group" data-facet={facetView.id} key={facetView.id}>
                                        <div className="pop-head">
                                            <span className="pop-facet">{facetView.label}</span>
                                            <span className="pop-total">{facetView.admittedTotal}</span>
                                            {!isSingle && (
                                                <button
                                                    type="button"
                                                    className="pop-all"
                                                    onClick={() => resetFacet(facet)}
                                                >
                                                    Select all
                                                </button>
                                            )}
                                        </div>
                                        <div
                                            className="pop-list"
                                            role={isSingle ? 'radiogroup' : 'group'}
                                            aria-label={facetView.label}
                                            aria-describedby={facetView.isEmptySelection ? emptyDescriptionId : undefined}
                                        >
                                            {facetView.visibleOptions.map((option) => {
                                                const isActive = facetView.activeOptionIds.includes(option.id);
                                                const isLocked = facetView.lockedOptionIds.includes(option.id);
                                                const visual = resolveEngFilterOptionVisual({ facetId: facetView.id, option, boardColumns });
                                                const prioritySeed = `${mountId}-${facetView.id}-${option.id}`.replace(/[^a-zA-Z0-9_-]/g, '-');
                                                return (
                                                    <button
                                                        key={option.id}
                                                        type="button"
                                                        data-option={option.id}
                                                        className={`pop-opt${isSingle ? ' radio' : ''}${isLocked ? ' is-locked' : ''}`}
                                                        role={isSingle ? 'radio' : undefined}
                                                        aria-checked={isSingle ? isActive : undefined}
                                                        aria-pressed={isSingle ? undefined : isActive}
                                                        aria-disabled={isLocked ? true : undefined}
                                                        title={isLocked ? LOCKED_REASON : undefined}
                                                        onClick={() => selectOption(facet, option.id)}
                                                    >
                                                        <span className="box" />
                                                        <span className="pop-opt-content">
                                                            {visual?.kind === 'status_label' ? (
                                                                <StatusPill
                                                                    label={option.label}
                                                                    className={getIssueStatusClassName(option.label, 'eng-filter-status-pill')}
                                                                    title={isLocked ? LOCKED_REASON : option.label}
                                                                    style={visual.configuredColour ? { '--eng-filter-status-colour': visual.configuredColour } : undefined}
                                                                />
                                                            ) : (
                                                                <>
                                                                    {visual && (
                                                                        <span className="pop-opt-visual" aria-hidden="true">
                                                                            {visual.kind === 'priority' && typeof renderPriorityIcon === 'function'
                                                                                ? renderPriorityIcon(visual.value, prioritySeed)
                                                                                : null}
                                                                            {visual.kind === 'project_track' ? getProjectTrackEmoji(visual.value) : null}
                                                                        </span>
                                                                    )}
                                                                    <span className="pop-opt-label" title={option.label}>{option.label}</span>
                                                                </>
                                                            )}
                                                        </span>
                                                        <span className="n">{option.count}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {facetView.isEmptySelection && facet.emptyDescription && (
                                            <div id={emptyDescriptionId} className="pop-neutral" role="status" aria-live="polite">
                                                {facet.emptyDescription}
                                            </div>
                                        )}
                                        {!isSingle && facetView.isNeutral && (
                                            <div className="pop-neutral">
                                                {`Everything ticked — not filtering by ${facetView.label.toLowerCase()}`}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="fb-readout">
                    <b>{readoutCount}</b> <span className="dim">{readoutUnit}</span>
                </div>

                <div className="fb-chips" ref={chipsRef}>
                    {chips.map(({ facet, copy }) => (
                        <span className="chip" key={facet.id} title={copy.title}>
                            <span className="facet">{copy.facetLabel}</span>
                            {copy.verb && <span className="verb">{copy.verb}</span>}
                            <span className="names">
                                {copy.names.join(', ')}
                                {copy.overflowCount > 0 ? ` +${copy.overflowCount}` : ''}
                            </span>
                            <button
                                type="button"
                                className="x"
                                aria-label={`Clear ${copy.facetLabel} filter`}
                                onClick={() => resetFacet(facet)}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                    <button
                        type="button"
                        className="chip chip-more"
                        ref={moreRef}
                        hidden={hiddenChipCount === 0}
                        title="Open Filters to see every active facet"
                        onClick={() => setOpen(true)}
                    >
                        {`+${hiddenChipCount} more`}
                    </button>
                    {chips.length > 0 && (
                        <button type="button" className="chip-clear" onClick={() => onClearAll?.()}>
                            Clear all
                        </button>
                    )}
                </div>

                {viewControls && <div className="fb-view-controls">{viewControls}</div>}
            </div>
        </div>
    );
}
