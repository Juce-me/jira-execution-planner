export const DEFAULT_PRIORITY_WEIGHT_ROWS = Object.freeze([
    { priority: 'Blocker', weight: '0.4' },
    { priority: 'Critical', weight: '0.3' },
    { priority: 'Major', weight: '0.2' },
    { priority: 'Minor', weight: '0.06' },
    { priority: 'Low', weight: '0.03' },
    { priority: 'Trivial', weight: '0.01' }
]);

export function clonePriorityWeightRows(rows) {
    const source = Array.isArray(rows) && rows.length ? rows : DEFAULT_PRIORITY_WEIGHT_ROWS;
    return source.map((row) => ({
        priority: String(row.priority || '').trim(),
        weight: String(row.weight ?? '').trim()
    }));
}

export function buildPriorityWeightMap(rows) {
    const map = {};
    (rows || []).forEach((row) => {
        const key = String(row?.priority || '').toLowerCase().trim();
        const numeric = Number(row?.weight);
        if (!key || Number.isNaN(numeric) || !Number.isFinite(numeric) || numeric < 0) return;
        map[key] = numeric;
    });
    if (Object.keys(map).length === 0) {
        clonePriorityWeightRows(DEFAULT_PRIORITY_WEIGHT_ROWS).forEach((row) => {
            map[String(row.priority || '').toLowerCase()] = Number(row.weight);
        });
    }
    return map;
}
