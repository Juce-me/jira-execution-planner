import { recordPerformanceLoad } from '../api/performanceApi.js';
import { afterLoadPaint } from '../eng/loadPerformance.js';

const clock = () => globalThis.performance?.now?.() ?? Date.now();
const MAX_LANES = 200;
const text = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit);

// One observation per user-initiated EPM rollup load: when the Home project list arrived, when the rollup was applied
// and painted, and the rollup time of each EPM project (see EPM_KEYS in backend/services/load_performance.py).
export function createEpmLoadMeasurement({ enabled, tab = 'active', sprintId = '', emit = () => {},
    now = clock, afterPaint = afterLoadPaint } = {}) {
    const started = now();
    const lanes = new Map();
    let indexMs = null;
    let finished = false;
    const publish = outcome => {
        if (!enabled || finished) return;
        finished = true;
        const durationMs = Math.max(0, now() - started);
        const sample = { schemaVersion: 1, loadId: globalThis.crypto.randomUUID(), groupId: 'epm',
            sprintId: tab === 'active' && sprintId ? text(sprintId, 128) : null, surface: 'epm', scopeType: tab,
            outcome, durationMs, indexMs: indexMs === null ? null : Math.min(indexMs, durationMs),
            lanes: [...lanes.values()].slice(0, MAX_LANES).map(lane => ({ ...lane, durationMs: Math.min(lane.durationMs, durationMs) })) };
        try { Promise.resolve(emit(sample)).catch(() => {}); } catch (_) { /* best-effort telemetry */ }
    };
    return {
        enabled: Boolean(enabled),
        startedAt: started,
        projectsListed() { if (enabled && !finished && indexMs === null) indexMs = Math.max(0, now() - started); },
        lane(project, name, durationMs) {
            const id = text(project, 128);
            if (!enabled || finished || !id || !Number.isFinite(durationMs) || durationMs < 0) return;
            lanes.set(id, { project: id, name: text(name, 120) || id, durationMs });
        },
        cancel() { publish('cancelled'); },
        error() { publish('error'); },
        async finish() {
            if (!enabled || finished) return;
            if (globalThis.document?.hidden) return publish('cancelled');
            await afterPaint();
            publish(globalThis.document?.hidden ? 'cancelled' : 'success');
        },
    };
}

// Collection follows the dashboard's performance gate (resolved at config bootstrap); without one nothing is recorded.
// Telemetry never delays or fails a load.
export function createEpmLoadReporter(backendUrl, { gate = null, record = recordPerformanceLoad } = {}) {
    return {
        start({ tab, sprintId }) {
            return createEpmLoadMeasurement({ enabled: Boolean(gate?.enabled), tab, sprintId,
                emit: async sample => {
                    await gate.ready;
                    if (gate.enabled) return record(backendUrl, sample);
                } });
        },
    };
}
