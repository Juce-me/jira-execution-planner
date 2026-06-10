export function normalizeIssueStatus(status) {
    return String(status || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const WAITING_STATUS_CLASSES = new Set([
    'awaiting validation',
    'pending',
    'to do',
    'todo',
]);

function getIssueStatusClass(status) {
    const normalizedStatus = normalizeIssueStatus(status);
    if (!normalizedStatus) return '';
    if (normalizedStatus.includes('in progress') || normalizedStatus === 'analysis') return 'in-progress';
    if (WAITING_STATUS_CLASSES.has(normalizedStatus)) return 'waiting';
    return normalizedStatus.replace(/\s+/g, '-');
}

export function getIssueStatusClassName(status, extraClassName = '') {
    const statusClass = getIssueStatusClass(status);
    return ['task-status', extraClassName, statusClass].filter(Boolean).join(' ');
}

export function getIssueTeamLabel(teamInfo) {
    if (typeof teamInfo === 'string') return teamInfo || 'Unknown Team';
    return teamInfo?.name || teamInfo?.displayName || teamInfo?.id || 'Unknown Team';
}

export function formatPriorityShort(value) {
    const name = String(value || '').toLowerCase();
    if (!name) return 'NONE';
    if (name.includes('blocker')) return 'BLKR';
    if (name.includes('critical')) return 'CRIT';
    if (name.includes('highest')) return 'HIGH';
    if (name.includes('high')) return 'HIGH';
    if (name.includes('major')) return 'MAJR';
    if (name.includes('medium')) return 'MED';
    if (name.includes('minor')) return 'MIN';
    if (name.includes('lowest')) return 'LOW';
    if (name.includes('low')) return 'LOW';
    return name.slice(0, 4).toUpperCase();
}
