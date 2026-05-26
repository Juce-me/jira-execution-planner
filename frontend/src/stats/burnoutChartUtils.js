function defaultIsClosedStatus(status) {
    const normalized = String(status || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return normalized === 'done' || normalized === 'killed' || normalized === 'incomplete';
}

export function buildBurnoutChartModel({
    burnoutData,
    assigneeFilter,
    taskTeamByIssueKey,
    taskStatusByIssueKey,
    issueWeightByKey,
    isCompletedSprintSelected,
    metric,
    resolveTeamColor,
    isClosedStatus
}) {
    const isClosed = typeof isClosedStatus === 'function' ? isClosedStatus : defaultIsClosedStatus;
    const parseDate = (value) => {
        if (!value) return null;
        return new Date(`${value}T00:00:00`);
    };
    const toDateKey = (value) => {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const rangeStart = parseDate(burnoutData?.range?.startDate);
    const rangeEnd = parseDate(burnoutData?.range?.endDate);
    if (!rangeStart || !rangeEnd || Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeStart > rangeEnd) {
        return null;
    }
    const metricIsStoryPoints = metric === 'storyPoints';
    const metricPrecision = metricIsStoryPoints ? 1 : 0;
    const normalizeMetric = (value) => {
        const numeric = Number(value) || 0;
        if (!metricIsStoryPoints) return Math.max(0, Math.round(numeric));
        return Math.max(0, Math.round(numeric * 10) / 10);
    };

    const issueMeta = Array.isArray(burnoutData?.issuesMeta) ? burnoutData.issuesMeta : [];
    const allEvents = Array.isArray(burnoutData?.events) ? burnoutData.events : [];
    const normalizeTeamCandidate = (teamValue) => {
        const idRaw = teamValue?.id;
        const id = idRaw === undefined || idRaw === null || idRaw === '' ? null : String(idRaw);
        const nameRaw = String(teamValue?.name || '').trim();
        const hasRealName = nameRaw && nameRaw.toLowerCase() !== 'unknown team';
        if (!id && !hasRealName) return null;
        return {
            id,
            name: hasRealName ? nameRaw : 'Unknown Team'
        };
    };
    const asAssigneeKey = (value) => value?.id || value?.name || 'unassigned';
    const isAssigneeMatch = (assignee) => {
        if (assigneeFilter === 'all') return true;
        return asAssigneeKey(assignee || {}) === assigneeFilter;
    };

    const filteredIssues = issueMeta.filter((issue) => isAssigneeMatch(issue?.assignee));
    const issueKeySet = new Set(filteredIssues.map((issue) => String(issue?.issueKey || '').trim()).filter(Boolean));

    const closureByIssue = new Map();
    allEvents.forEach((event) => {
        const issueKey = String(event?.issueKey || '').trim();
        if (!issueKey || !issueKeySet.has(issueKey)) return;
        const eventDate = parseDate(event?.date);
        if (!eventDate || Number.isNaN(eventDate.getTime())) return;
        if (eventDate < rangeStart || (eventDate > rangeEnd && !isCompletedSprintSelected)) return;
        const dateKey = toDateKey(eventDate);
        const fallbackTeam = taskTeamByIssueKey.get(issueKey.toUpperCase());
        const resolvedTeam = normalizeTeamCandidate({
            id: event?.teamId,
            name: event?.teamName
        }) || normalizeTeamCandidate(fallbackTeam) || { id: null, name: 'Unknown Team' };
        const existing = closureByIssue.get(issueKey);
        if (!existing || dateKey < existing.date) {
            closureByIssue.set(issueKey, {
                date: dateKey,
                team: resolvedTeam,
                assigneeName: event?.assigneeName || 'Unassigned',
                bucket: String(event?.bucket || '').toLowerCase()
            });
        }
    });
    const closureDateKeys = Array.from(closureByIssue.values())
        .map((item) => String(item?.date || '').trim())
        .filter(Boolean)
        .sort();
    const lastClosureDateKey = closureDateKeys.length ? closureDateKeys[closureDateKeys.length - 1] : null;
    let chartEndDateKey = toDateKey(rangeEnd);
    if (isCompletedSprintSelected && lastClosureDateKey) {
        chartEndDateKey = lastClosureDateKey;
    }
    const chartEndDate = parseDate(chartEndDateKey) || rangeEnd;
    const fullRangeEnd = chartEndDate > rangeEnd ? chartEndDate : rangeEnd;

    const dayRows = [];
    const dayDeltaByTeam = {};
    const dayDetails = {};
    let cursor = new Date(rangeStart.getTime());
    while (cursor <= fullRangeEnd) {
        const key = toDateKey(cursor);
        dayRows.push(key);
        dayDeltaByTeam[key] = {};
        dayDetails[key] = { added: [], closed: [] };
        cursor.setDate(cursor.getDate() + 1);
    }

    const teamByKey = new Map();
    const resolveTeamDescriptor = (teamValue) => {
        const id = teamValue?.id || null;
        const name = teamValue?.name || 'Unknown Team';
        const key = id || `name:${name}`;
        if (!teamByKey.has(key)) {
            teamByKey.set(key, {
                key,
                id,
                name,
                color: resolveTeamColor(key)
            });
        }
        return teamByKey.get(key);
    };

    const baselineByTeam = {};
    const issueSnapshots = [];
    const bumpDelta = (dateKey, teamKey, value) => {
        if (!dayDeltaByTeam[dateKey]) return;
        dayDeltaByTeam[dateKey][teamKey] = (dayDeltaByTeam[dateKey][teamKey] || 0) + value;
    };

    let additions = 0;
    let closures = 0;
    const closureBuckets = { done: 0, killed: 0, incomplete: 0 };

    filteredIssues.forEach((issue) => {
        const issueKey = String(issue?.issueKey || '').trim();
        if (!issueKey) return;
        const issueKeyUpper = issueKey.toUpperCase();
        const createdDate = parseDate(issue?.createdDate);
        if (createdDate && createdDate > rangeEnd) return;

        const fallbackIssueTeam = taskTeamByIssueKey.get(issueKey.toUpperCase());
        const startTeamSource = normalizeTeamCandidate(issue?.teamAtStart)
            || normalizeTeamCandidate(issue?.teamAtCreated)
            || normalizeTeamCandidate(fallbackIssueTeam)
            || { id: null, name: 'Unknown Team' };
        const createdTeamSource = normalizeTeamCandidate(issue?.teamAtCreated)
            || normalizeTeamCandidate(issue?.teamAtStart)
            || normalizeTeamCandidate(fallbackIssueTeam)
            || { id: null, name: 'Unknown Team' };
        const startTeam = resolveTeamDescriptor(startTeamSource);
        const createdTeam = resolveTeamDescriptor(createdTeamSource);
        const closure = closureByIssue.get(issueKey);
        const currentStatus = taskStatusByIssueKey.get(issueKeyUpper) || '';
        const wasClosedBeforeSprintStart = isClosed(currentStatus) && !closure;
        if (wasClosedBeforeSprintStart) return;
        const issueMetricValue = metricIsStoryPoints
            ? Math.max(0, Number(issueWeightByKey.get(issueKeyUpper) || 0))
            : 1;

        const createdDateKey = createdDate ? toDateKey(createdDate) : null;
        const openTeam = (createdDateKey && createdDate > rangeStart) ? createdTeam : startTeam;
        issueSnapshots.push({
            issueKey,
            openTeamKey: openTeam.key,
            openTeamName: openTeam.name,
            createdDateKey: createdDateKey || toDateKey(rangeStart),
            closureDateKey: closure?.date || null
        });
        if (createdDateKey && createdDate > rangeStart && dayDeltaByTeam[createdDateKey]) {
            bumpDelta(createdDateKey, createdTeam.key, issueMetricValue);
            additions += issueMetricValue;
            dayDetails[createdDateKey].added.push({
                issueKey,
                teamName: createdTeam.name,
                assigneeName: issue?.assignee?.name || 'Unassigned',
                metricValue: issueMetricValue
            });
        } else {
            baselineByTeam[startTeam.key] = (baselineByTeam[startTeam.key] || 0) + issueMetricValue;
        }

        if (closure && dayDeltaByTeam[closure.date]) {
            const closureTeam = resolveTeamDescriptor(closure.team);
            bumpDelta(closure.date, closureTeam.key, -issueMetricValue);
            closures += issueMetricValue;
            if (closure.bucket in closureBuckets) {
                closureBuckets[closure.bucket] += 1;
            }
            dayDetails[closure.date].closed.push({
                issueKey,
                teamName: closureTeam.name,
                assigneeName: closure.assigneeName || 'Unassigned',
                status: closure.bucket || 'closed',
                metricValue: issueMetricValue
            });
        }
    });

    const orderedTeams = Array.from(teamByKey.values())
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    let runningByTeam = {};
    orderedTeams.forEach((team) => {
        runningByTeam[team.key] = baselineByTeam[team.key] || 0;
    });

    const timeline = [];
    let maxTotal = 0;
    dayRows.forEach((dateKey) => {
        const dayDelta = dayDeltaByTeam[dateKey] || {};
        Object.entries(dayDelta).forEach(([teamKey, delta]) => {
            const next = (runningByTeam[teamKey] || 0) + delta;
            runningByTeam[teamKey] = normalizeMetric(next);
        });
        let total = 0;
        const countsByTeam = {};
        orderedTeams.forEach((team) => {
            const count = normalizeMetric(runningByTeam[team.key] || 0);
            countsByTeam[team.key] = count;
            total += count;
        });
        maxTotal = Math.max(maxTotal, normalizeMetric(total));
        timeline.push({
            date: dateKey,
            total: normalizeMetric(total),
            countsByTeam,
            details: dayDetails[dateKey]
        });
    });

    if (!timeline.length) return null;
    const fullTimeline = timeline;
    const shouldTrimCompletedRange = Boolean(isCompletedSprintSelected && chartEndDateKey);
    const chartTimeline = shouldTrimCompletedRange
        ? fullTimeline.filter((row) => row.date <= chartEndDateKey)
        : fullTimeline;
    const timelineForChart = chartTimeline.length ? chartTimeline : fullTimeline;
    const maxTotalForChart = timelineForChart.reduce((acc, row) => Math.max(acc, row.total || 0), 0);
    const activeTeamKeys = new Set();
    orderedTeams.forEach((team) => {
        const hasAnyValue = timelineForChart.some((row) => (row.countsByTeam?.[team.key] || 0) > 0);
        if (hasAnyValue) {
            activeTeamKeys.add(team.key);
        }
    });
    const visibleTeams = orderedTeams.filter((team) => activeTeamKeys.has(team.key));
    const teamNameByKey = {};
    visibleTeams.forEach((team) => {
        teamNameByKey[team.key] = team.name;
    });
    const width = Math.max(760, timelineForChart.length * 9);
    const height = 260;
    const padding = { left: 46, right: 14, top: 12, bottom: 30 };
    const plotWidth = Math.max(1, width - padding.left - padding.right);
    const plotHeight = Math.max(1, height - padding.top - padding.bottom);
    const axisMax = Math.max(1, maxTotalForChart || maxTotal);
    const toX = (index) => {
        if (timelineForChart.length <= 1) return padding.left + plotWidth / 2;
        return padding.left + (plotWidth * index) / (timelineForChart.length - 1);
    };
    const toY = (value) => {
        const safe = Math.max(0, Number(value) || 0);
        return height - padding.bottom - (safe / axisMax) * plotHeight;
    };

    const rows = timelineForChart.map((row, index) => {
        const x = toX(index);
        let running = 0;
        const stacks = {};
        visibleTeams.forEach((team) => {
            const value = row.countsByTeam[team.key] || 0;
            const bottom = running;
            const top = bottom + value;
            stacks[team.key] = {
                value,
                bottom,
                top,
                yTop: toY(top),
                yBottom: toY(bottom)
            };
            running = top;
        });
        return { ...row, x, stacks };
    });

    const buildAreaPath = (teamKey) => {
        if (!rows.length) return '';
        const top = rows.map((row, idx) => `${idx === 0 ? 'M' : 'L'}${row.x.toFixed(2)},${row.stacks[teamKey].yTop.toFixed(2)}`).join(' ');
        const bottom = [...rows].reverse().map((row) => `L${row.x.toFixed(2)},${row.stacks[teamKey].yBottom.toFixed(2)}`).join(' ');
        return `${top} ${bottom} Z`;
    };
    const buildLinePath = (teamKey) => {
        if (!rows.length) return '';
        return rows.map((row, idx) => `${idx === 0 ? 'M' : 'L'}${row.x.toFixed(2)},${row.stacks[teamKey].yTop.toFixed(2)}`).join(' ');
    };
    const buildLinePathSegment = (teamKey, startIndex, endIndex) => {
        if (!rows.length) return '';
        const start = Math.max(0, Number(startIndex) || 0);
        const end = Math.min(rows.length - 1, Number(endIndex) || 0);
        if (end <= start) return '';
        return rows
            .slice(start, end + 1)
            .map((row, idx) => `${idx === 0 ? 'M' : 'L'}${row.x.toFixed(2)},${row.stacks[teamKey].yTop.toFixed(2)}`)
            .join(' ');
    };

    const xStep = rows.length > 1 ? (plotWidth / (rows.length - 1)) : plotWidth;

    const yTickValues = [];
    [1, 0.75, 0.5, 0.25, 0].forEach((ratio) => {
        const value = normalizeMetric(axisMax * ratio);
        if (!yTickValues.includes(value)) {
            yTickValues.push(value);
        }
    });
    if (!yTickValues.includes(axisMax)) {
        yTickValues.unshift(axisMax);
    }
    if (!yTickValues.includes(0)) {
        yTickValues.push(0);
    }
    const yTicks = yTickValues.map((value) => ({
        value,
        y: toY(value)
    }));

    const startTotal = orderedTeams.reduce((acc, team) => acc + (baselineByTeam[team.key] || 0), 0);
    const sprintEndKey = toDateKey(rangeEnd);
    const sprintEndRow = fullTimeline.find((row) => row.date === sprintEndKey);
    const remainingTotal = (sprintEndRow?.total ?? fullTimeline[fullTimeline.length - 1]?.total) || 0;
    const now = new Date();
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayDateKey = toDateKey(todayDate);
    const todayIndex = rows.findIndex((row) => row.date === todayDateKey);
    const todayX = todayIndex >= 0 ? rows[todayIndex].x : null;
    const weeklyMarkers = rows
        .map((row, index) => ({ row, index }))
        .filter(({ index }) => index > 0 && index % 7 === 0)
        .map(({ row }) => ({ key: row.date, x: row.x }));
    const futureOverlay = (todayX !== null && todayIndex < rows.length - 1)
        ? { x: todayX, width: Math.max(0, (width - padding.right) - todayX) }
        : null;
    const teamColors = {};
    visibleTeams.forEach((team) => {
        teamColors[team.name] = team.color;
    });

    return {
        width,
        height,
        padding,
        rows,
        teams: visibleTeams,
        areas: visibleTeams.map((team) => {
            const lastPositiveIndex = rows.reduce((last, row, index) => {
                return (row.stacks?.[team.key]?.value || 0) > 0 ? index : last;
            }, -1);
            const safeEndIndex = Math.max(0, lastPositiveIndex);
            const fullLine = lastPositiveIndex >= 0
                ? buildLinePathSegment(team.key, 0, safeEndIndex)
                : '';
            const pastEndIndex = todayIndex >= 0
                ? Math.min(todayIndex, safeEndIndex)
                : safeEndIndex;
            const futureStartIndex = todayIndex >= 0
                ? Math.max(todayIndex, 0)
                : safeEndIndex;
            const linePast = lastPositiveIndex >= 0
                ? buildLinePathSegment(team.key, 0, pastEndIndex)
                : '';
            const lineFuture = (lastPositiveIndex >= 0 && todayIndex >= 0 && futureStartIndex <= safeEndIndex)
                ? buildLinePathSegment(team.key, futureStartIndex, safeEndIndex)
                : '';
            return {
                team,
                areaPath: buildAreaPath(team.key),
                linePath: fullLine,
                linePastPath: linePast || fullLine,
                lineFuturePath: lineFuture,
                lineEndIndex: lastPositiveIndex
            };
        }),
        xStep,
        yTicks,
        weeklyMarkers,
        todayDateKey,
        todayX,
        futureOverlay,
        teamColors,
        teamNameByKey,
        issueSnapshots,
        metric: {
            key: metric,
            isStoryPoints: metricIsStoryPoints,
            precision: metricPrecision
        },
        summary: {
            start: normalizeMetric(startTotal),
            added: normalizeMetric(additions),
            closed: normalizeMetric(closures),
            remaining: normalizeMetric(remainingTotal),
            closureBuckets
        }
    };
}
