import * as React from 'react';
import IconButton from './IconButton.jsx';
import LoadingMark from './LoadingMark.jsx';

// The same two paths as the header Refresh button (dashboard.jsx, `refresh-icon`). The arc's circle is centred at (13.5, 12.6) with the arrowhead
// above it, so the viewBox is shifted to put the glyph's ink at the button's centre (measured: 0.875px right and 0.25px low at 14px before the shift).
const RefreshGlyph = () => (
    <svg viewBox="1.5 0.43 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M19 7.5a7.5 7.5 0 1 0 2 5.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M19 3v4h-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

export default function EpicRefreshButton({
    epicKey,
    epicName,
    state = 'idle',
    onRefresh,
    errorLabel = 'Epic refresh failed. Try again.',
}) {
    const busy = state === 'busy';
    const name = epicName || epicKey;
    const label = busy ? `Refreshing ${name}` : state === 'error' ? errorLabel : `Refresh epic ${name}`;
    return (
        <IconButton
            size="sm"
            variant="secondary compact"
            className="epic-refresh-button"
            data-state={state}
            data-epic-refresh={epicKey}
            aria-label={label}
            title={label}
            aria-disabled={busy ? 'true' : undefined}
            aria-busy={busy ? 'true' : undefined}
            onClick={(event) => {
                event.stopPropagation();
                if (!busy) onRefresh?.(epicKey);
            }}
        >
            {busy ? <LoadingMark /> : <RefreshGlyph />}
        </IconButton>
    );
}
