const clock = () => globalThis.performance?.now?.() ?? Date.now();
export function createPerformanceGate() {
    let value = null;
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    return { ready, get enabled() { return value !== false; },
        resolve(enabled) { value = enabled === true; resolveReady(); } };
}
const STAGES = new Set(['jira-search', 'normalize-tasks', 'epic-enrichment', 'epic-counts-distribution',
    'build-response', 'total', 'cache', 'parse-params', 'auth-headers', 'build-jql', 'cache-store']);

// Two frames allow React's committed result to be painted. Background documents are
// cancelled instead of inflating the successful-load distribution with throttled frames.
export function afterLoadPaint() {
    if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export function laneMetrics(project, data, headers, durationMs, payloadBytes) {
    const issues = new Map((data.issues || []).filter(issue => issue?.key).map(issue => [issue.key, issue]));
    const epicKeys = new Set([...Object.keys(data.epics || {}), ...(data.epicsInScope || []).map(epic => epic.key),
        ...[...issues.values()].map(issue => issue.fields?.epicKey)].filter(Boolean));
    const stages = {};
    for (const token of (headers?.get?.('Server-Timing') || '').split(',')) {
        const match = token.trim().match(/^([a-z-]+);dur=([\d.]+)/);
        if (match && STAGES.has(match[1]) && Number.isFinite(Number(match[2]))) stages[match[1]] = Number(match[2]);
    }
    const metrics = data.loadMetrics || {};
    return { project, durationMs: Math.max(0, durationMs), issueCount: issues.size, epicCount: epicKeys.size,
        storyCount: [...issues.values()].filter(issue => String(issue.fields?.issuetype?.name || '').toLowerCase() === 'story').length,
        payloadBytes, cacheState: metrics.cacheState || (stages.cache !== undefined ? 'hit' : 'unknown'),
        completeness: metrics.completeness || (issues.size >= 250 ? 'capped' : 'unknown'), stages,
        jiraRequests: metrics.jiraRequests ?? null, jiraPages: metrics.jiraPages ?? null, jiraRetries: metrics.jiraRetries ?? null };
}

export function createGroupLoadMeasurement({ enabled, groupId = '', sprintId = '', emit = () => {},
    now = clock, afterPaint = afterLoadPaint } = {}) {
    const started = now();
    const lanes = new Map();
    let finished = false;
    let finishing = false;
    let dependencyDurationMs = null;
    let firstContentMs = null;
    let contentPending = false;
    const publish = outcome => {
        if (!enabled || finished) return;
        finished = true;
        globalThis.document?.removeEventListener('visibilitychange', onVisibility);
        const sample = { loadId: globalThis.crypto.randomUUID(), groupId: String(groupId), sprintId: String(sprintId),
            surface: 'eng_sprint', outcome, durationMs: Math.max(0, now() - started), dependencyDurationMs, firstContentMs, lanes: [...lanes.values()] };
        // Never wait for persistence, retry, or propagate a telemetry error to the app load.
        try { Promise.resolve(emit(sample)).catch(() => {}); } catch (_) { /* best-effort telemetry */ }
    };
    const onVisibility = () => { if (globalThis.document?.hidden) publish('cancelled'); };
    if (enabled) globalThis.document?.addEventListener('visibilitychange', onVisibility);
    return {
        enabled: Boolean(enabled),
        lane(value) { if (enabled && !finished) lanes.set(value.project, value); },
        dependencies(durationMs) { dependencyDurationMs = Math.max(0, durationMs); },
        async contentReady() {
            if (!enabled || finished || contentPending) return;
            contentPending = true;
            await afterPaint();
            if (!finished) firstContentMs = Math.max(0, now() - started);
        },
        cancel() { publish('cancelled'); },
        async finish(outcomes) {
            if (!enabled || finished || finishing) return;
            finishing = true;
            if (outcomes.includes('ignored') || globalThis.document?.hidden) return publish('cancelled');
            if (outcomes.some(value => value !== 'applied')) return publish('error');
            await afterPaint();
            publish(globalThis.document?.hidden ? 'cancelled' : 'success');
        },
    };
}
