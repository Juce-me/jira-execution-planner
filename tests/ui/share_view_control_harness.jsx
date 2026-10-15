// Mount harness for the Share control: the real ShareViewButton on both header surfaces, inside a
// structural replica of the real header (same classes, so the real cascade applies), with a fake
// `share` object a spec drives through `window.__shareHarness`. The assertions that prove the
// control inside the real app (hook wiring, scroll swap, EPM and Scenario) are in the app cases of
// share_view_control.spec.js.

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import ShareViewButton from '../../frontend/src/shareView/ShareViewButton.jsx';
import { SearchControl } from '../../frontend/src/eng/EngControls.jsx';
import JiraExportButton from '../../frontend/src/components/JiraExportButton.jsx';
import IconButton from '../../frontend/src/ui/IconButton.jsx';
import { initAnalytics } from '../../frontend/src/analytics/analytics.js';

const state = {
    active: 'main',
    sourceSurface: 'catch_up',
    disabled: false,
    notice: null,
    capture: { ok: true, url: 'http://127.0.0.1:5050/?v=1&mode=catch-up&group=synthetic-group&sprint=3001', dropped: [] },
};
const calls = { captures: 0, dismissed: 0 };
let rerender = () => {};

function Harness() {
    const [, setTick] = React.useState(0);
    rerender = () => setTick(tick => tick + 1);
    const share = {
        notice: state.notice,
        dismissNotice: () => { calls.dismissed += 1; state.notice = null; rerender(); },
        captureShareUrl: () => { calls.captures += 1; return state.capture; },
        shareDisabled: state.disabled,
        applyTerminal: true,
    };
    const searchProps = (surface) => ({
        surface, searchActive: false, searchInput: '', setSearchInput: () => {}, setSearchFocused: () => {}, searchInputRef: { current: null },
    });
    const shareControl = (surface) => (
        <ShareViewButton surface={surface} share={share} sourceSurface={state.sourceSurface} activeControlSurface={state.active} />
    );
    return (
        <div className="container">
            <header>
                <div className="subtitle">
                    <span className="subtitle-main">Jira Delivery Planner</span>
                    <div className="header-actions">
                        <div className="header-actions-row">
                            <SearchControl {...searchProps('main')} />
                            {shareControl('main')}
                            <JiraExportButton jiraUrl="https://jira.example" epicKeys={['SYN-1']} />
                            <IconButton variant="secondary compact" className="header-icon-button refresh-icon" title="Refresh tasks and sprints from Jira" aria-label="Refresh tasks and sprints from Jira">
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="M19 7.5a7.5 7.5 0 1 0 2 5.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
                                    <path d="M19 3v4h-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </IconButton>
                            <button className="header-icon-button group-gear-button" title="Manage team groups" aria-label="Manage team groups" type="button">
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z" stroke="currentColor" strokeWidth="1.6"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
                <div className="view-selector">
                    <div className="controls-label">Controls</div>
                    <div className="view-filters"><span className="harness-controls-row">controls row</span></div>
                </div>
            </header>
            <div className="compact-sticky-header is-visible">
                <div className="compact-sticky-header-controls"><span className="harness-controls-row">compact controls</span></div>
                <div className="compact-sticky-header-search">
                    <SearchControl {...searchProps('compact')} extraClassName="compact-sticky-header-search-field" />
                </div>
                {shareControl('compact')}
            </div>
            <p style={{ height: 1200 }}>content</p>
        </div>
    );
}

window.__shareHarness = {
    state,
    calls,
    set(patch) { Object.assign(state, patch); rerender(); },
};
window.dataLayer = [];
initAnalytics({ fetchContext: async () => ({ enabled: true }) }).then(() => {
    createRoot(document.getElementById('harness-root')).render(<Harness />);
});
