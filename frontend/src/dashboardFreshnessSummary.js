// Source observations describe a check, not a guarantee of current Jira membership.
export function formatCheckedAge(nowMs, lastCheckedAtMs) {
    const seconds = Math.max(0, Math.floor((nowMs - lastCheckedAtMs) / 1000));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
}

export function summarizeFreshness(state, sources, nowMs) {
    const checks = sources.map(source => state?.checks?.[source]).filter(Boolean);
    if (!state?.running) {
        const failure = ['failed', 'rate_limited', 'unverified'].find(value => checks.some(check => check.failure === value));
        if (failure === 'unverified') return 'Cached data; check unavailable';
        if (failure) return 'Could not check; showing previous data';
        if (state?.pending) return 'Updates pending';
    }
    const forced = checks.filter(check => check.checkKind === 'forced' && Number.isFinite(check.lastCheckedAtMs));
    if (!forced.length) {
        const unknown = checks.filter(check => check.checkKind === 'unknown' && Number.isFinite(check.lastCheckedAtMs));
        return unknown.length ? `Checked ${formatCheckedAge(nowMs, Math.min(...unknown.map(check => check.lastCheckedAtMs)))} ago; freshness unconfirmed` : '';
    }
    const qualifiers = [];
    if (forced.some(check => check.coverage === 'partial')) qualifiers.push('partial results');
    if (forced.length < sources.length || forced.some(check => !['complete', 'partial'].includes(check.coverage))) qualifiers.push('coverage unknown');
    return `Checked ${formatCheckedAge(nowMs, Math.min(...forced.map(check => check.lastCheckedAtMs)))} ago${qualifiers.length ? `; ${qualifiers.join('; ')}` : ''}`;
}
