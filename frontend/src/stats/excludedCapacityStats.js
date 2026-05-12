function normalizeKey(value) {
    return String(value || '').trim().toUpperCase();
}

function normalizeId(value) {
    return String(value ?? '').trim();
}

function storyPointsFor(task) {
    const fields = task?.fields || {};
    const raw = fields.customfield_10004 ?? fields.storyPoints ?? task?.storyPoints ?? 0;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function teamFor(task) {
    const fields = task?.fields || {};
    const team = fields.team || task?.team || {};
    const id = normalizeId(fields.teamId || team.id || task?.teamId || fields.teamName || task?.teamName || 'unknown');
    const name = String(fields.teamName || team.name || task?.teamName || id || 'Unknown Team').trim() || 'Unknown Team';
    return { id: id || 'unknown', name };
}

function epicKeyFor(task) {
    return normalizeKey(task?.fields?.epicKey || task?.epicKey || 'NO_EPIC') || 'NO_EPIC';
}

function collectSprintTokens(value, tokens) {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
        value.forEach(item => collectSprintTokens(item, tokens));
        return;
    }
    if (typeof value === 'object') {
        if (value.id !== undefined && value.id !== null) tokens.add(normalizeId(value.id));
        if (value.name) tokens.add(String(value.name).trim());
        return;
    }
    const text = String(value).trim();
    if (!text) return;
    tokens.add(text);
    const idMatch = text.match(/id=([0-9]+)/);
    if (idMatch) tokens.add(idMatch[1]);
}

function sprintTokensFor(task) {
    const fields = task?.fields || {};
    const tokens = new Set();
    collectSprintTokens(task?.sprintId, tokens);
    collectSprintTokens(task?.sprintName, tokens);
    collectSprintTokens(task?.sprint, tokens);
    collectSprintTokens(fields.sprintId, tokens);
    collectSprintTokens(fields.sprintName, tokens);
    collectSprintTokens(fields.sprint, tokens);
    collectSprintTokens(fields.customfield_10101, tokens);
    return tokens;
}

function taskMatchesSprint(task, sprint) {
    const tokens = sprintTokensFor(task);
    if (!tokens.size) return false;
    const sprintId = normalizeId(sprint?.id);
    if (sprintId && tokens.has(sprintId)) return true;
    const sprintName = String(sprint?.name || '').trim().toLowerCase();
    if (!sprintName) return false;
    return Array.from(tokens).some(token => {
        const normalized = String(token || '').trim().toLowerCase();
        return normalized === sprintName ||
            normalized.includes(sprintName) ||
            sprintName.includes(normalized);
    });
}

function roundMetric(value) {
    return Math.round((Number(value) || 0) * 1000) / 1000;
}

export function getSprintQuarterLabel(sprint) {
    const name = String(sprint?.name || '').trim();
    const nameMatch = name.match(/\b(20\d{2})\s*Q([1-4])\b/i);
    if (nameMatch) {
        return `${nameMatch[1]} Q${nameMatch[2]}`;
    }
    const dateText = sprint?.startDate || sprint?.endDate || '';
    const parsed = dateText ? new Date(`${dateText}T00:00:00`) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) {
        const quarter = Math.floor(parsed.getMonth() / 3) + 1;
        return `${parsed.getFullYear()} Q${quarter}`;
    }
    return 'Unscheduled';
}

export function compareSprintsChronologically(a, b) {
    const dateA = a?.startDate ? new Date(`${a.startDate}T00:00:00`).getTime() : NaN;
    const dateB = b?.startDate ? new Date(`${b.startDate}T00:00:00`).getTime() : NaN;
    if (Number.isFinite(dateA) && Number.isFinite(dateB) && dateA !== dateB) return dateA - dateB;
    if (Number.isFinite(dateA) !== Number.isFinite(dateB)) return Number.isFinite(dateA) ? -1 : 1;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
}

export function buildDefaultExcludedCapacityRange(sprints, selectedSprintId) {
    const ordered = (sprints || []).slice().sort(compareSprintsChronologically);
    if (!ordered.length) return { startSprintId: '', endSprintId: '' };
    const selectedId = normalizeId(selectedSprintId);
    if (selectedId && ordered.some(sprint => normalizeId(sprint.id) === selectedId)) {
        return { startSprintId: selectedId, endSprintId: selectedId };
    }
    const last = ordered[ordered.length - 1];
    return { startSprintId: normalizeId(last.id), endSprintId: normalizeId(last.id) };
}

export function getSprintRange(sprints, startSprintId, endSprintId) {
    const ordered = (sprints || []).slice().sort(compareSprintsChronologically);
    if (!ordered.length) return [];
    const startId = normalizeId(startSprintId);
    const endId = normalizeId(endSprintId);
    const startIndex = ordered.findIndex(sprint => normalizeId(sprint.id) === startId);
    const endIndex = ordered.findIndex(sprint => normalizeId(sprint.id) === endId);
    if (startIndex < 0 || endIndex < 0) return [];
    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);
    return ordered.slice(from, to + 1);
}

export function buildExcludedCapacityTimeSeries(tasks, sprints, options = {}) {
    const excludedKeys = new Set((options.excludedEpicKeys || []).map(normalizeKey).filter(Boolean));
    const filterKey = normalizeKey(options.excludedEpicKeyFilter || '');
    const numeratorKeys = filterKey ? new Set([filterKey]) : excludedKeys;
    const explicitTeams = (options.teams || [])
        .map(team => ({
            id: normalizeId(team?.id || team?.name || 'unknown') || 'unknown',
            name: String(team?.name || team?.id || 'Unknown Team').trim() || 'Unknown Team'
        }))
        .filter(team => team.id);
    const teamsById = new Map(explicitTeams.map(team => [team.id, team]));

    (tasks || []).forEach(task => {
        const team = teamFor(task);
        if (!teamsById.has(team.id)) teamsById.set(team.id, team);
    });

    const rows = [];
    const orderedTeams = Array.from(teamsById.values())
        .sort((a, b) => a.name.localeCompare(b.name));
    (sprints || []).forEach(sprint => {
        orderedTeams.forEach(team => {
            let totalPoints = 0;
            let excludedPoints = 0;
            (tasks || []).forEach(task => {
                if (!taskMatchesSprint(task, sprint)) return;
                const taskTeam = teamFor(task);
                if (taskTeam.id !== team.id) return;
                const points = storyPointsFor(task);
                totalPoints += points;
                const epicKey = epicKeyFor(task);
                if (numeratorKeys.has(epicKey)) {
                    excludedPoints += points;
                }
            });
            rows.push({
                sprintId: normalizeId(sprint?.id),
                sprintName: String(sprint?.name || sprint?.id || '').trim(),
                quarter: getSprintQuarterLabel(sprint),
                teamId: team.id,
                teamName: team.name,
                totalPoints: roundMetric(totalPoints),
                excludedPoints: roundMetric(excludedPoints),
                percent: totalPoints > 0 ? roundMetric(excludedPoints / totalPoints) : 0
            });
        });
    });
    return rows;
}

export function classifyEpicTeamMode(tasks, options = {}) {
    const dependencies = options.dependencies || {};
    const byEpic = new Map();
    (tasks || []).forEach(task => {
        const epicKey = epicKeyFor(task);
        const team = teamFor(task);
        const entry = byEpic.get(epicKey) || { epicKey, teamIds: new Set(), crossTeamLink: false };
        entry.teamIds.add(team.id);
        (dependencies[task?.key] || []).forEach(dep => {
            const linkedTeamId = normalizeId(dep?.teamId || dep?.team?.id || dep?.teamName || dep?.team?.name || '');
            if (linkedTeamId && linkedTeamId !== team.id) {
                entry.crossTeamLink = true;
            }
        });
        byEpic.set(epicKey, entry);
    });
    const result = {};
    byEpic.forEach((entry, epicKey) => {
        result[epicKey] = entry.teamIds.size > 1 || entry.crossTeamLink ? 'cross' : 'mono';
    });
    return result;
}

export function buildEpicTeamModeShare(tasks, options = {}) {
    const excludedKeys = new Set((options.excludedEpicKeys || []).map(normalizeKey).filter(Boolean));
    const filterKey = normalizeKey(options.excludedEpicKeyFilter || '');
    const scopedExcludedKeys = filterKey ? new Set([filterKey]) : excludedKeys;
    const excludedTasks = (tasks || []).filter(task => scopedExcludedKeys.has(epicKeyFor(task)));
    const classifications = classifyEpicTeamMode(excludedTasks, { dependencies: options.dependencies });
    const byTeam = new Map();

    excludedTasks.forEach(task => {
        const team = teamFor(task);
        const entry = byTeam.get(team.id) || {
            teamId: team.id,
            teamName: team.name,
            monoPoints: 0,
            crossPoints: 0
        };
        const points = storyPointsFor(task);
        if (classifications[epicKeyFor(task)] === 'cross') {
            entry.crossPoints += points;
        } else {
            entry.monoPoints += points;
        }
        byTeam.set(team.id, entry);
    });

    return Array.from(byTeam.values())
        .map(row => {
            const totalPoints = row.monoPoints + row.crossPoints;
            return {
                ...row,
                monoPoints: roundMetric(row.monoPoints),
                crossPoints: roundMetric(row.crossPoints),
                totalPoints: roundMetric(totalPoints),
                monoPercent: totalPoints > 0 ? roundMetric(row.monoPoints / totalPoints) : 0,
                crossPercent: totalPoints > 0 ? roundMetric(row.crossPoints / totalPoints) : 0
            };
        })
        .sort((a, b) => a.teamName.localeCompare(b.teamName));
}
