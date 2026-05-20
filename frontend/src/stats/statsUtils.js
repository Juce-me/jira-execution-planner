import { PRIORITY_ALIASES, PRIORITY_LABEL_BY_KEY, RADAR_PALETTE } from './statsConstants.js';

export function formatPercent(value) {
    return `${(value * 100).toFixed(2)}%`;
}

export function normalizePriority(name) {
    const key = String(name || '').toLowerCase().trim();
    return PRIORITY_ALIASES[key] || key;
}

export function getPriorityLabel(name) {
    const key = normalizePriority(name);
    return PRIORITY_LABEL_BY_KEY[key] || name;
}

export function computePriorityWeighted(priorities, weightMap) {
    const totals = { done: 0, incomplete: 0, killed: 0 };
    Object.entries(priorities || {}).forEach(([priorityName, counts]) => {
        const normalized = normalizePriority(priorityName);
        const weight = weightMap?.[normalized] || 0;
        totals.done += weight * (counts.done || 0);
        totals.incomplete += weight * (counts.incomplete || 0);
        totals.killed += weight * (counts.killed || 0);
    });
    return totals;
}

export function computeRate(metrics) {
    const done = metrics?.done || 0;
    const incomplete = metrics?.incomplete || 0;
    const denom = done + incomplete;
    return denom > 0 ? done / denom : 0;
}

export function getRateClass(rate) {
    if (rate >= 1) return 'good';
    if (rate >= 0.6 && rate < 0.8) return 'warn';
    if (rate < 0.6) return 'bad';
    return '';
}

export function hashTeamId(value) {
    const str = String(value || '');
    let hash = 5381;
    for (let i = 0; i < str.length; i += 1) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return Math.abs(hash);
}

export function resolveTeamColor(teamId) {
    if (!RADAR_PALETTE.length) return '#94a3b8';
    const index = hashTeamId(teamId) % RADAR_PALETTE.length;
    return RADAR_PALETTE[index];
}

export function buildRadarPoints({ values, radius, center, maxValue, axes }) {
    const count = axes.length;
    return axes.map((axis, index) => {
        const value = Math.max(0, values[axis] || 0);
        const ratio = maxValue > 0 ? value / maxValue : 0;
        const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
        const r = ratio * radius;
        const x = center + r * Math.cos(angle);
        const y = center + r * Math.sin(angle);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
}

export function buildLocalStatsFromTasks(taskList, {
    excludedSet = new Set(),
    normalizeStatus = (status) => String(status || '').toLowerCase().trim(),
    getTeamInfo = () => ({}),
    techProjectKeys = new Set(),
    sprintName = ''
} = {}) {
    const teams = {};
    const projectsSummary = {
        product: { done: 0, incomplete: 0, killed: 0, priorities: {} },
        tech: { done: 0, incomplete: 0, killed: 0, priorities: {} }
    };
    const totals = { done: 0, incomplete: 0, killed: 0 };
    const storyPointsTotals = { total: 0, done: 0, incomplete: 0, killed: 0 };

    const bumpPriority = (target, priorityName, bucket) => {
        if (!target.priorities) target.priorities = {};
        if (!target.priorities[priorityName]) {
            target.priorities[priorityName] = { done: 0, incomplete: 0, killed: 0 };
        }
        target.priorities[priorityName][bucket] += 1;
    };

    const bumpPriorityPoints = (target, priorityName, points) => {
        if (!target.priorityPoints) target.priorityPoints = {};
        if (!target.priorityPoints[priorityName]) {
            target.priorityPoints[priorityName] = 0;
        }
        target.priorityPoints[priorityName] += points;
    };

    (taskList || []).forEach(task => {
        const epicKey = task.fields?.epicKey || 'NO_EPIC';
        if (excludedSet?.has(epicKey)) {
            return;
        }
        const status = normalizeStatus(task.fields?.status?.name);
        const isKilled = status === 'killed';
        const isDone = status === 'done';
        const priorityName = task.fields?.priority?.name || 'Unspecified';
        const pointsRaw = task.fields?.customfield_10004;
        const pointsValue = Number(pointsRaw);
        const storyPoints = Number.isFinite(pointsValue) ? pointsValue : 0;
        storyPointsTotals.total += storyPoints;
        const teamInfo = getTeamInfo(task);
        const teamKey = teamInfo.id || teamInfo.name || 'unknown';
        const projectBucket = techProjectKeys.has(task.fields?.projectKey || String(task.key || '').split('-')[0]) ? 'tech' : 'product';

        if (!teams[teamKey]) {
            teams[teamKey] = {
                id: teamInfo.id || teamKey,
                name: teamInfo.name || teamKey,
                done: 0,
                incomplete: 0,
                killed: 0,
                priorities: {},
                priorityPoints: {},
                projects: {
                    product: { done: 0, incomplete: 0, killed: 0, priorities: {} },
                    tech: { done: 0, incomplete: 0, killed: 0, priorities: {} }
                }
            };
        }

        const teamEntry = teams[teamKey];
        if (isKilled) {
            teamEntry.killed += 1;
            teamEntry.projects[projectBucket].killed += 1;
            projectsSummary[projectBucket].killed += 1;
            totals.killed += 1;
            storyPointsTotals.killed += storyPoints;
            bumpPriority(teamEntry, priorityName, 'killed');
            bumpPriority(teamEntry.projects[projectBucket], priorityName, 'killed');
            bumpPriority(projectsSummary[projectBucket], priorityName, 'killed');
            return;
        }

        bumpPriorityPoints(teamEntry, priorityName, storyPoints);
        if (isDone) {
            teamEntry.done += 1;
            teamEntry.projects[projectBucket].done += 1;
            projectsSummary[projectBucket].done += 1;
            totals.done += 1;
            storyPointsTotals.done += storyPoints;
            bumpPriority(teamEntry, priorityName, 'done');
            bumpPriority(teamEntry.projects[projectBucket], priorityName, 'done');
            bumpPriority(projectsSummary[projectBucket], priorityName, 'done');
            return;
        }

        teamEntry.incomplete += 1;
        teamEntry.projects[projectBucket].incomplete += 1;
        projectsSummary[projectBucket].incomplete += 1;
        totals.incomplete += 1;
        storyPointsTotals.incomplete += storyPoints;
        bumpPriority(teamEntry, priorityName, 'incomplete');
        bumpPriority(teamEntry.projects[projectBucket], priorityName, 'incomplete');
        bumpPriority(projectsSummary[projectBucket], priorityName, 'incomplete');
    });

    const sortedTeams = Object.values(teams).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return {
        sprint: sprintName,
        totals,
        storyPoints: storyPointsTotals,
        projects: projectsSummary,
        teams: sortedTeams
    };
}
