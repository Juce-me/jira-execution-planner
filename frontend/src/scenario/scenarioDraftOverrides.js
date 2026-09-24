const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value) {
    if (value === '') return '';
    return typeof value === 'string' && DATE_PATTERN.test(value) ? value : '';
}

export function normalizeScenarioDraftOverrides(overrides) {
    const normalized = {};
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return normalized;
    Object.entries(overrides).forEach(([issueKey, value]) => {
        const key = String(issueKey || '').trim();
        if (!ISSUE_KEY_PATTERN.test(key) || !value || typeof value !== 'object' || Array.isArray(value)) return;
        const start = normalizeDate(value.start);
        const end = normalizeDate(value.end);
        if (!start && !end) return;
        normalized[key] = { start, end };
    });
    return normalized;
}

export function scenarioDraftOverridesSignature(overrides) {
    const normalized = normalizeScenarioDraftOverrides(overrides);
    return Object.keys(normalized)
        .sort()
        .map(key => `${key}:${normalized[key].start}:${normalized[key].end}`)
        .join('|');
}

export function overlayScenarioDraftDelta(freshOverrides, capturedSavedOverrides, capturedLocalOverrides) {
    const fresh = normalizeScenarioDraftOverrides(freshOverrides);
    const saved = normalizeScenarioDraftOverrides(capturedSavedOverrides);
    const local = normalizeScenarioDraftOverrides(capturedLocalOverrides);
    const merged = { ...fresh };
    new Set([...Object.keys(saved), ...Object.keys(local)]).forEach(issueKey => {
        const savedValue = saved[issueKey] || null;
        const localValue = local[issueKey] || null;
        if (JSON.stringify(savedValue) === JSON.stringify(localValue)) return;
        if (localValue) merged[issueKey] = localValue;
        else delete merged[issueKey];
    });
    return merged;
}
