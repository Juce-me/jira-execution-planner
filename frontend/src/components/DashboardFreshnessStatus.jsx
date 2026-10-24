import React from 'react';
import { summarizeFreshness } from '../dashboardFreshnessSummary.js';

export default function DashboardFreshnessStatus({ freshness, jiraUrl }) {
    const [nowMs, setNowMs] = React.useState(Date.now);
    const previous = React.useRef({ contextKey: null, text: '' });
    const owners = freshness.ownersRef.current;
    const contextKey = owners?.readEnvironment().contextKey;
    const sources = owners?.readAdapter(owners.resolveFreshnessSurface())?.sources() || [];
    if (previous.current.contextKey !== contextKey) previous.current = { contextKey, text: '' };
    if (!freshness.state.running) previous.current.text = summarizeFreshness(freshness.state, sources, nowMs);
    React.useEffect(() => {
        let timeout = null;
        const foreground = () => document.visibilityState === 'visible' && document.hasFocus();
        const tick = () => {
            timeout = null;
            if (!foreground()) return;
            setNowMs(Date.now());
            timeout = setTimeout(tick, 1000);
        };
        const changed = () => { clearTimeout(timeout); timeout = null; if (foreground()) tick(); };
        document.addEventListener('visibilitychange', changed);
        window.addEventListener('focus', changed);
        window.addEventListener('blur', changed);
        changed();
        return () => { clearTimeout(timeout); document.removeEventListener('visibilitychange', changed); window.removeEventListener('focus', changed); window.removeEventListener('blur', changed); };
    }, []);
    // The Jira URL fills the slot only while there is no status text and no check is running; it never changes the slot's height.
    // Intrinsic copies reserve the full readout before any check; nine day digits cover the native Date range.
    return <span className="dashboard-freshness-slot">
        <span className="dashboard-freshness-size controls-label" aria-hidden="true">Checked 999999999d ago; partial results; coverage unknown</span>
        <span className="dashboard-freshness-size controls-label" aria-hidden="true">Could not check; showing previous data</span>
        {previous.current.text && <span className="dashboard-freshness-status controls-label" data-dashboard-freshness-status>{previous.current.text}</span>}
        {jiraUrl && !previous.current.text && !freshness.state.running && <span className="subtitle-secondary">{jiraUrl}</span>}
    </span>;
}
