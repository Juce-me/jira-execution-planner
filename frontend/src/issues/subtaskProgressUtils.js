export function formatPercent(value) {
    const bounded = Math.max(0, Math.min(100, Number(value) || 0));
    return `${bounded.toFixed(3).replace(/\.?0+$/, '')}%`;
}

export function buildStorySubtaskProgress(summary = {}) {
    const source = summary || {};
    const total = Math.max(0, Number(source.total) || 0);
    const done = Math.max(0, Number(source.done) || 0);
    const inProgress = Math.max(0, Number(source.inProgress) || 0);
    const percentComplete = total > 0 ? (done / total) * 100 : 0;
    return {
        total,
        done,
        inProgress,
        waiting: Math.max(0, total - done - inProgress),
        percentLabel: `${Math.round(percentComplete)}%`,
        doneWidth: formatPercent(total > 0 ? (done / total) * 100 : 0),
        inProgressWidth: formatPercent(total > 0 ? (inProgress / total) * 100 : 0),
        hasProgress: total > 0,
        hasDone: done > 0,
        hasInProgress: inProgress > 0,
    };
}

export function formatSubtaskUpdatedDate(value) {
    if (!value) return '';
    const normalized = String(value);
    const jiraDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
    if (jiraDateMatch) {
        return `${jiraDateMatch[1]}-${jiraDateMatch[2]}-${jiraDateMatch[3]}`;
    }
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return '';
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        String(date.getUTCDate()).padStart(2, '0'),
    ].join('-');
}
