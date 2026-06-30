import { classifyCapacityIssue } from '../capacityClassification.mjs';

function normalizeKey(value) {
    return String(value || '').trim().toUpperCase();
}

function normalizeId(value) {
    return String(value ?? '').trim();
}

export function storyPointsFor(task) {
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

function epicSummaryFor(task) {
    const fields = task?.fields || {};
    const summary = fields.epicSummary ?? task?.epicSummary ?? fields.parentSummary ?? task?.parentSummary ?? '';
    return String(summary || '').trim();
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

// Stacked-segment order. `product` here is Product EXCLUDING Ad Hoc
// ("Product other"); Ad Hoc is a separate included-Product bucket. Summary cards
// add Ad Hoc back into a "Product total" figure (see summarizeEffortTypeSplitTotals).
const EFFORT_TYPE_BUCKETS = ['excludedCapacity', 'adHoc', 'product', 'tech'];

function emptyEffortSegments() {
    return {
        excludedCapacity: { key: 'excludedCapacity', label: 'Excluded Capacity', points: 0, percent: 0 },
        adHoc: { key: 'adHoc', label: 'Ad Hoc', points: 0, percent: 0 },
        product: { key: 'product', label: 'Product', points: 0, percent: 0 },
        tech: { key: 'tech', label: 'Tech', points: 0, percent: 0 }
    };
}

function summarizeEffortSplitRow(row) {
    const totalPoints = row.excludedCapacityPoints + row.adHocPoints + row.techPoints + row.productPoints;
    const segments = emptyEffortSegments();
    segments.excludedCapacity.points = roundMetric(row.excludedCapacityPoints);
    segments.adHoc.points = roundMetric(row.adHocPoints);
    segments.product.points = roundMetric(row.productPoints);
    segments.tech.points = roundMetric(row.techPoints);
    EFFORT_TYPE_BUCKETS.forEach((bucket) => {
        segments[bucket].percent = totalPoints > 0 ? roundMetric(segments[bucket].points / totalPoints) : 0;
    });
    return {
        ...row,
        excludedCapacityPoints: segments.excludedCapacity.points,
        adHocPoints: segments.adHoc.points,
        techPoints: segments.tech.points,
        productPoints: segments.product.points,
        totalPoints: roundMetric(totalPoints),
        segments
    };
}

export function summarizeEffortTypeSplitTotals(rows) {
    const totals = (rows || []).reduce((acc, row) => {
        const excludedCapacityPoints = Number(row?.excludedCapacityPoints || 0);
        const adHocPoints = Number(row?.adHocPoints || 0);
        const techPoints = Number(row?.techPoints || 0);
        const productPoints = Number(row?.productPoints || 0);
        const rowTotal = Number(row?.totalPoints || 0)
            || excludedCapacityPoints + adHocPoints + techPoints + productPoints;
        acc.totalPoints += rowTotal;
        acc.excludedCapacityPoints += excludedCapacityPoints;
        acc.adHocPoints += adHocPoints;
        acc.techPoints += techPoints;
        acc.productPoints += productPoints;
        return acc;
    }, {
        totalPoints: 0,
        excludedCapacityPoints: 0,
        adHocPoints: 0,
        techPoints: 0,
        productPoints: 0
    });
    const totalPoints = roundMetric(totals.totalPoints);
    const excludedCapacityPoints = roundMetric(totals.excludedCapacityPoints);
    const adHocPoints = roundMetric(totals.adHocPoints);
    const techPoints = roundMetric(totals.techPoints);
    // `productPoints` is Product other (excluding Ad Hoc); `productTotalPoints`
    // is included Product capacity (Product other + Ad Hoc) for summary cards.
    const productPoints = roundMetric(totals.productPoints);
    const productTotalPoints = roundMetric(totals.productPoints + totals.adHocPoints);
    return {
        totalPoints,
        excludedCapacityPoints,
        adHocPoints,
        techPoints,
        productPoints,
        productTotalPoints,
        excludedCapacityPercent: totalPoints > 0 ? roundMetric(excludedCapacityPoints / totalPoints) : 0,
        adHocPercent: totalPoints > 0 ? roundMetric(adHocPoints / totalPoints) : 0,
        techPercent: totalPoints > 0 ? roundMetric(techPoints / totalPoints) : 0,
        productPercent: totalPoints > 0 ? roundMetric(productPoints / totalPoints) : 0,
        productTotalPercent: totalPoints > 0 ? roundMetric(productTotalPoints / totalPoints) : 0
    };
}

function normalizeFilterKeys(options) {
    if (Array.isArray(options?.excludedEpicKeyFilters)) {
        const filters = options.excludedEpicKeyFilters.map(normalizeKey).filter(Boolean);
        if (filters.length) return new Set(filters);
    }
    const single = normalizeKey(options?.excludedEpicKeyFilter || '');
    if (single) return new Set([single]);
    return null;
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

function isSuppressedSourceWarning(warning) {
    return /epic summary enrichment capped/i.test(String(warning || ''));
}

function mergeIssuePayload(existing, incoming) {
    if (!existing) return incoming;
    const existingSummary = epicSummaryFor(existing);
    const incomingSummary = epicSummaryFor(incoming);
    if (existingSummary || !incomingSummary) return existing;
    return {
        ...existing,
        fields: {
            ...(existing.fields || {}),
            epicSummary: incomingSummary
        }
    };
}

export function mergeExcludedCapacityStatsSourceChunks(chunks, options = {}) {
    const issuesByKey = new Map();
    const warnings = [];
    const warningSet = new Set();
    let queryPages = 0;
    let issueLimit = 0;
    (chunks || []).filter(Boolean).forEach(chunk => {
        (chunk.issues || []).forEach(issue => {
            const issueKey = normalizeKey(issue?.key || issue?.id || '');
            if (!issueKey) return;
            issuesByKey.set(issueKey, mergeIssuePayload(issuesByKey.get(issueKey), issue));
        });
        const meta = chunk.meta || {};
        queryPages += Number(meta.queryPages || 0);
        issueLimit = Math.max(issueLimit, Number(meta.issueLimit || 0));
        (meta.warnings || []).forEach(warning => {
            const text = String(warning || '').trim();
            if (!text || isSuppressedSourceWarning(text) || warningSet.has(text)) return;
            warningSet.add(text);
            warnings.push(text);
        });
    });
    const loadedSprintCount = Number(options.loadedSprintCount ?? (chunks || []).filter(Boolean).length);
    const totalSprintCount = Number(options.totalSprintCount ?? loadedSprintCount);
    return {
        issues: Array.from(issuesByKey.values()),
        meta: {
            warnings,
            truncated: warnings.length > 0,
            paginationMode: 'progressive-sprint',
            queryPages,
            issueLimit,
            loadedSprintCount,
            totalSprintCount
        }
    };
}

function buildSprintSourceFailureChunk(sprintId, error) {
    const message = String(error?.message || error || 'failed to load').trim();
    return {
        issues: [],
        meta: {
            warnings: [`Sprint ${sprintId} excluded capacity source failed: ${message}`],
            queryPages: 0
        }
    };
}

export async function loadExcludedCapacityStatsSourceChunks(sprintIds, fetchSprintChunk, options = {}) {
    const ids = (sprintIds || []).map(normalizeId).filter(Boolean);
    const requestedConcurrency = Number(options.maxConcurrent || 3);
    const maxConcurrent = Math.max(1, Math.min(
        ids.length || 1,
        Number.isFinite(requestedConcurrency) ? Math.floor(requestedConcurrency) : 3
    ));
    const chunks = new Array(ids.length);
    const errors = [];
    let nextIndex = 0;
    let loadedSprintCount = 0;
    const isCancelled = typeof options.isCancelled === 'function' ? options.isCancelled : () => false;

    const emitProgress = () => {
        if (isCancelled() || typeof options.onProgress !== 'function') return;
        options.onProgress(chunks.filter(Boolean), {
            loadedSprintCount,
            totalSprintCount: ids.length,
            errors: errors.slice()
        });
    };

    const loadNext = async () => {
        while (!isCancelled()) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= ids.length) return;
            const sprintId = ids[index];
            try {
                chunks[index] = await fetchSprintChunk(sprintId, index) || { issues: [], meta: { warnings: [] } };
            } catch (err) {
                if (err?.name === 'AbortError') throw err;
                const failureChunk = buildSprintSourceFailureChunk(sprintId, err);
                chunks[index] = failureChunk;
                errors.push({
                    sprintId,
                    message: failureChunk.meta.warnings[0]
                });
            }
            loadedSprintCount += 1;
            emitProgress();
        }
    };

    await Promise.all(Array.from({ length: maxConcurrent }, loadNext));
    return {
        chunks: chunks.filter(Boolean),
        errors
    };
}

export function buildExcludedEpicCatalog(tasks, options = {}) {
    const configured = (options.excludedEpicKeys || []).map(normalizeKey).filter(key => key && key !== 'NO_EPIC');
    if (!configured.length) return [];
    const summariesByKey = new Map();
    (tasks || []).forEach(task => {
        const key = epicKeyFor(task);
        if (!summariesByKey.has(key)) {
            const summary = epicSummaryFor(task);
            if (summary) summariesByKey.set(key, summary);
        }
    });
    return configured.map(key => ({
        key,
        summary: summariesByKey.get(key) || ''
    })).sort((a, b) => {
        const aLabel = (a.summary || a.key).toLowerCase();
        const bLabel = (b.summary || b.key).toLowerCase();
        return aLabel.localeCompare(bLabel);
    });
}

export function buildExcludedCapacityTimeSeries(tasks, sprints, options = {}) {
    const excludedKeys = new Set((options.excludedEpicKeys || []).map(normalizeKey).filter(Boolean));
    const filterSet = normalizeFilterKeys(options);
    const numeratorKeys = filterSet ? filterSet : excludedKeys;
    const explicitTeams = (options.teams || [])
        .map(team => ({
            id: normalizeId(team?.id || team?.name || 'unknown') || 'unknown',
            name: String(team?.name || team?.id || 'Unknown Team').trim() || 'Unknown Team'
        }))
        .filter(team => team.id);
    const teamsById = new Map(explicitTeams.map(team => [team.id, team]));

    (tasks || []).forEach(task => {
        const team = teamFor(task);
        const existing = teamsById.get(team.id);
        if (!existing) {
            teamsById.set(team.id, team);
            return;
        }
        if (existing.name === existing.id && team.name && team.name !== team.id) {
            teamsById.set(team.id, { id: existing.id, name: team.name });
        }
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

export function buildEffortTypeSplitRows(tasks, selectedSprints, options = {}) {
    const sprintList = Array.isArray(selectedSprints)
        ? selectedSprints.filter(Boolean)
        : (selectedSprints ? [selectedSprints] : []);
    if (!sprintList.length) return [];
    const excludedKeys = new Set((options.excludedEpicKeys || []).map(normalizeKey).filter(Boolean));
    const filterSet = normalizeFilterKeys(options);
    const excludedScope = filterSet ? filterSet : excludedKeys;
    const techProjectKeys = new Set((options.techProjectKeys || []).map(normalizeKey).filter(Boolean));
    // Ad Hoc epics are INCLUDED Product capacity reported separately; they never
    // subtract. Excluded scope still wins first so excluded stories never leak
    // into Ad Hoc, then classification routes Ad Hoc/Tech/Product.
    const adHocEpicSet = new Set((options.adHocEpicKeys || []).map(normalizeKey).filter(Boolean));
    const explicitTeams = (options.teams || [])
        .map(team => ({
            id: normalizeId(team?.id || team?.name || 'unknown') || 'unknown',
            name: String(team?.name || team?.id || 'Unknown Team').trim() || 'Unknown Team'
        }))
        .filter(team => team.id);
    const emptyRow = (team) => ({
        teamId: team.id,
        teamName: team.name,
        excludedCapacityPoints: 0,
        adHocPoints: 0,
        techPoints: 0,
        productPoints: 0
    });
    const rowsByTeam = new Map(explicitTeams.map(team => [team.id, emptyRow(team)]));

    (tasks || []).forEach(task => {
        if (!sprintList.some(sprint => taskMatchesSprint(task, sprint))) return;
        const team = teamFor(task);
        const row = rowsByTeam.get(team.id) || emptyRow(team);
        if (row.teamName === row.teamId && team.name && team.name !== team.id) {
            row.teamName = team.name;
        }
        const points = storyPointsFor(task);
        const epicKey = epicKeyFor(task);
        if (excludedScope.has(epicKey)) {
            row.excludedCapacityPoints += points;
        } else {
            const { capacityType } = classifyCapacityIssue(task, { techProjectKeys, adHocEpicSet });
            if (capacityType === 'ad_hoc') {
                row.adHocPoints += points;
            } else if (capacityType === 'tech') {
                row.techPoints += points;
            } else {
                row.productPoints += points;
            }
        }
        rowsByTeam.set(team.id, row);
    });

    return Array.from(rowsByTeam.values())
        .map(summarizeEffortSplitRow)
        .sort((a, b) => a.teamName.localeCompare(b.teamName));
}

export function buildExcludedCapacityLineSeries(tasks, sprints, options = {}) {
    const mode = options.mode === 'group' ? 'group' : 'teams';
    const rows = buildExcludedCapacityTimeSeries(tasks, sprints, options);
    const orderedSprints = (sprints || []).map(sprint => ({
        sprintId: normalizeId(sprint?.id),
        sprintName: String(sprint?.name || sprint?.id || '').trim(),
        quarter: getSprintQuarterLabel(sprint)
    }));

    if (mode === 'group') {
        const groupLabel = String(options.groupName || 'Group').trim() || 'Group';
        const points = orderedSprints.map(sprint => {
            const sprintRows = rows.filter(row => row.sprintId === sprint.sprintId);
            const total = sprintRows.reduce((sum, row) => sum + (row.totalPoints || 0), 0);
            const excluded = sprintRows.reduce((sum, row) => sum + (row.excludedPoints || 0), 0);
            return {
                sprintId: sprint.sprintId,
                sprintName: sprint.sprintName,
                quarter: sprint.quarter,
                totalPoints: roundMetric(total),
                excludedPoints: roundMetric(excluded),
                percent: total > 0 ? roundMetric(excluded / total) : 0
            };
        });
        return {
            mode: 'group',
            sprints: orderedSprints,
            series: [{
                seriesId: 'group',
                label: groupLabel,
                points
            }]
        };
    }

    const teamMap = new Map();
    rows.forEach(row => {
        if (!teamMap.has(row.teamId)) {
            teamMap.set(row.teamId, { seriesId: row.teamId, label: row.teamName, points: [] });
        }
    });
    teamMap.forEach(entry => {
        entry.points = orderedSprints.map(sprint => {
            const match = rows.find(row => row.teamId === entry.seriesId && row.sprintId === sprint.sprintId);
            return {
                sprintId: sprint.sprintId,
                sprintName: sprint.sprintName,
                quarter: sprint.quarter,
                totalPoints: match ? match.totalPoints : 0,
                excludedPoints: match ? match.excludedPoints : 0,
                percent: match ? match.percent : 0
            };
        });
    });
    const series = Array.from(teamMap.values()).sort((a, b) => a.label.localeCompare(b.label));
    return {
        mode: 'teams',
        sprints: orderedSprints,
        series
    };
}

export function classifyEpicTeamMode(tasks, options = {}) {
    const result = {};
    buildEpicTeamModeBuckets(tasks, options).forEach((entry) => {
        result[entry.key] = entry.teamPoints.size > 1 ? 'cross' : 'mono';
    });
    return result;
}

function buildEpicTeamModeBuckets(tasks, options = {}) {
    const selectedSprints = Array.isArray(options.sprints) ? options.sprints : [];
    const sprintBuckets = selectedSprints.length ? selectedSprints : [{ id: 'all', name: 'All selected sprints' }];
    const byEpic = new Map();
    (tasks || []).forEach(task => {
        const epicKey = epicKeyFor(task);
        const team = teamFor(task);
        const points = storyPointsFor(task);
        const matchingSprints = sprintBuckets.filter(sprint => {
            if (!selectedSprints.length) return true;
            return taskMatchesSprint(task, sprint);
        });
        matchingSprints.forEach(sprint => {
            const sprintKey = normalizeId(sprint?.id) || String(sprint?.name || '').trim() || 'unscheduled';
            const key = `${epicKey}::${sprintKey}`;
            const entry = byEpic.get(key) || {
                key,
                epicKey,
                sprintKey,
                sprintId: normalizeId(sprint?.id),
                sprintName: String(sprint?.name || sprint?.id || sprintKey || '').trim(),
                teamPoints: new Map(),
                teamNames: new Map(),
                totalPoints: 0
            };
            entry.teamPoints.set(team.id, (entry.teamPoints.get(team.id) || 0) + points);
            entry.teamNames.set(team.id, team.name);
            entry.totalPoints += points;
            byEpic.set(key, entry);
        });
    });
    return Array.from(byEpic.values());
}

function summarizeEpicModeRow(row) {
    const totalPoints = row.monoPoints + row.crossPoints;
    const sharedPoints = row.sharedPoints || 0;
    return {
        ...row,
        monoPoints: roundMetric(row.monoPoints),
        crossPoints: roundMetric(row.crossPoints),
        sharedPoints: roundMetric(sharedPoints),
        totalPoints: roundMetric(totalPoints),
        monoPercent: totalPoints > 0 ? roundMetric(row.monoPoints / totalPoints) : 0,
        crossPercent: sharedPoints > 0 ? roundMetric(row.crossPoints / sharedPoints) : 0
    };
}

function epicModeTasks(tasks, options = {}) {
    if (options.includeAllEpics) {
        return (tasks || []).filter(task => epicKeyFor(task) !== 'NO_EPIC');
    }
    const excludedKeys = new Set((options.excludedEpicKeys || []).map(normalizeKey).filter(Boolean));
    const filterSet = normalizeFilterKeys(options);
    const scopedExcludedKeys = filterSet ? filterSet : excludedKeys;
    return (tasks || []).filter(task => scopedExcludedKeys.has(epicKeyFor(task)));
}

export function buildEpicTeamModeShare(tasks, options = {}) {
    const scopedTasks = epicModeTasks(tasks, options);
    const selectedSprints = Array.isArray(options.sprints) ? options.sprints : [];
    const buckets = buildEpicTeamModeBuckets(scopedTasks, { sprints: selectedSprints });
    const explicitTeams = (options.teams || [])
        .map(team => ({
            id: normalizeId(team?.id || team?.name || 'unknown') || 'unknown',
            name: String(team?.name || team?.id || 'Unknown Team').trim() || 'Unknown Team'
        }))
        .filter(team => team.id);
    const byTeam = new Map(explicitTeams.map(team => [team.id, {
        teamId: team.id,
        teamName: team.name,
        monoPoints: 0,
        crossPoints: 0,
        sharedPoints: 0,
        sprintRows: new Map()
    }]));

    buckets.forEach(bucket => {
        const isCross = bucket.teamPoints.size > 1;
        bucket.teamPoints.forEach((points, teamId) => {
            const teamName = bucket.teamNames.get(teamId) || teamId;
            const entry = byTeam.get(teamId) || {
                teamId,
                teamName,
                monoPoints: 0,
                crossPoints: 0,
                sharedPoints: 0,
                sprintRows: new Map()
            };
            if (entry.teamName === entry.teamId && teamName && teamName !== teamId) {
                entry.teamName = teamName;
            }
            const sprintRow = entry.sprintRows.get(bucket.sprintKey) || {
                sprintId: bucket.sprintId,
                sprintName: bucket.sprintName,
                monoPoints: 0,
                crossPoints: 0,
                sharedPoints: 0
            };
            entry.sharedPoints += points;
            sprintRow.sharedPoints += points;
            if (isCross) {
                entry.crossPoints += points;
                sprintRow.crossPoints += points;
            } else {
                entry.monoPoints += points;
                sprintRow.monoPoints += points;
            }
            entry.sprintRows.set(bucket.sprintKey, sprintRow);
            byTeam.set(teamId, entry);
        });
    });

    return Array.from(byTeam.values())
        .map(row => {
            const sprintRows = Array.from(row.sprintRows.values())
                .map(summarizeEpicModeRow)
                .filter(sprintRow => sprintRow.crossPoints > 0 || sprintRow.sharedPoints > 0)
                .sort((a, b) => String(a.sprintName || '').localeCompare(String(b.sprintName || '')));
            return summarizeEpicModeRow({
                ...row,
                sprintRows
            });
        })
        .sort((a, b) => a.teamName.localeCompare(b.teamName));
}

export function buildEpicTeamCrossShareLineSeries(tasks, sprints, options = {}) {
    const selectedSprints = Array.isArray(sprints) ? sprints : [];
    const orderedSprints = selectedSprints.map(sprint => ({
        sprintId: normalizeId(sprint?.id),
        sprintName: String(sprint?.name || sprint?.id || '').trim(),
        quarter: getSprintQuarterLabel(sprint)
    }));
    const explicitTeams = (options.teams || [])
        .map(team => ({
            id: normalizeId(team?.id || team?.name || 'unknown') || 'unknown',
            name: String(team?.name || team?.id || 'Unknown Team').trim() || 'Unknown Team'
        }))
        .filter(team => team.id);
    const teamsById = new Map(explicitTeams.map(team => [team.id, team]));
    (tasks || []).forEach(task => {
        const team = teamFor(task);
        const existing = teamsById.get(team.id);
        if (!existing || (existing.name === existing.id && team.name && team.name !== team.id)) {
            teamsById.set(team.id, team);
        }
    });

    const totalsByTeamSprint = new Map();
    (tasks || []).forEach(task => {
        const team = teamFor(task);
        selectedSprints.forEach(sprint => {
            if (!taskMatchesSprint(task, sprint)) return;
            const sprintId = normalizeId(sprint?.id);
            const key = `${team.id}::${sprintId}`;
            totalsByTeamSprint.set(key, (totalsByTeamSprint.get(key) || 0) + storyPointsFor(task));
        });
    });

    const crossByTeamSprint = new Map();
    const scopedTasks = (tasks || []).filter(task => epicKeyFor(task) !== 'NO_EPIC');
    buildEpicTeamModeBuckets(scopedTasks, { sprints: selectedSprints }).forEach(bucket => {
        if (bucket.teamPoints.size <= 1) return;
        bucket.teamPoints.forEach((points, teamId) => {
            const key = `${teamId}::${bucket.sprintId}`;
            crossByTeamSprint.set(key, (crossByTeamSprint.get(key) || 0) + points);
        });
    });

    const series = Array.from(teamsById.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(team => ({
            seriesId: team.id,
            label: team.name,
            points: orderedSprints.map(sprint => {
                const key = `${team.id}::${sprint.sprintId}`;
                const totalPoints = totalsByTeamSprint.get(key) || 0;
                const crossPoints = crossByTeamSprint.get(key) || 0;
                return {
                    sprintId: sprint.sprintId,
                    sprintName: sprint.sprintName,
                    quarter: sprint.quarter,
                    totalPoints: roundMetric(totalPoints),
                    excludedPoints: roundMetric(crossPoints),
                    percent: totalPoints > 0 ? roundMetric(crossPoints / totalPoints) : 0
                };
            })
        }));
    return {
        mode: 'teams',
        sprints: orderedSprints,
        series
    };
}

export function buildEpicTeamModeOverall(tasks, options = {}) {
    const scopedTasks = epicModeTasks(tasks, options);
    const buckets = buildEpicTeamModeBuckets(scopedTasks, { sprints: Array.isArray(options.sprints) ? options.sprints : [] });
    const totals = buckets.reduce((acc, bucket) => {
        if (bucket.teamPoints.size > 1) {
            acc.crossPoints += bucket.totalPoints;
        } else {
            acc.monoPoints += bucket.totalPoints;
        }
        acc.sharedPoints += bucket.totalPoints;
        return acc;
    }, { monoPoints: 0, crossPoints: 0, sharedPoints: 0 });
    return summarizeEpicModeRow(totals);
}

export function buildEpicTeamModeSprintRows(tasks, options = {}) {
    const scopedTasks = epicModeTasks(tasks, options);
    const selectedSprints = Array.isArray(options.sprints) ? options.sprints : [];
    const rowsBySprint = new Map();
    selectedSprints.forEach(sprint => {
        const sprintKey = normalizeId(sprint?.id) || String(sprint?.name || '').trim() || 'unscheduled';
        rowsBySprint.set(sprintKey, {
            sprintId: normalizeId(sprint?.id),
            sprintName: String(sprint?.name || sprint?.id || sprintKey || '').trim(),
            monoPoints: 0,
            crossPoints: 0,
            sharedPoints: 0
        });
    });
    buildEpicTeamModeBuckets(scopedTasks, { sprints: selectedSprints }).forEach(bucket => {
        const row = rowsBySprint.get(bucket.sprintKey) || {
            sprintId: bucket.sprintId,
            sprintName: bucket.sprintName,
            monoPoints: 0,
            crossPoints: 0,
            sharedPoints: 0
        };
        if (bucket.teamPoints.size > 1) {
            row.crossPoints += bucket.totalPoints;
        } else {
            row.monoPoints += bucket.totalPoints;
        }
        row.sharedPoints += bucket.totalPoints;
        rowsBySprint.set(bucket.sprintKey, row);
    });
    return Array.from(rowsBySprint.values()).map(summarizeEpicModeRow);
}
