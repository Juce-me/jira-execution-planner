const TERMINAL_STATUS_KEYS = new Set(['done', 'killed', 'incomplete', 'postponed']);

export function parseIsoDate(value) {
    if (!value || typeof value !== 'string') return null;
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

export function toIsoDate(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function getCurrentQuarterLabel(referenceDate = new Date()) {
    const quarter = Math.floor(referenceDate.getMonth() / 3) + 1;
    return `${referenceDate.getFullYear()}Q${quarter}`;
}

export function shiftQuarterLabel(label, delta) {
    const match = String(label || '').match(/^(\d{4})Q([1-4])$/i);
    if (!match) return label;
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    const absolute = (year * 4) + (quarter - 1) + Number(delta || 0);
    const nextYear = Math.floor(absolute / 4);
    const nextQuarter = (absolute % 4) + 1;
    return `${nextYear}Q${nextQuarter}`;
}

export function buildQuarterOptions(endQuarter, total = 12) {
    const safeTotal = Math.max(1, Number(total) || 12);
    const anchor = String(endQuarter || '').trim() || getCurrentQuarterLabel();
    const options = [];
    for (let offset = safeTotal - 1; offset >= 0; offset -= 1) {
        options.push(shiftQuarterLabel(anchor, -offset));
    }
    return options;
}

export function normalizeCohortStatus(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'open';
    if (raw === 'done') return 'done';
    if (raw === 'killed') return 'killed';
    if (raw === 'incomplete') return 'incomplete';
    if (raw === 'postponed') return 'postponed';
    return 'open';
}

export function isTerminalCohortStatus(statusKey) {
    return TERMINAL_STATUS_KEYS.has(normalizeCohortStatus(statusKey));
}

export function periodKeyFromDate(dateValue, groupBy) {
    if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return '';
    if (groupBy === 'month') {
        const month = String(dateValue.getMonth() + 1).padStart(2, '0');
        return `${dateValue.getFullYear()}-${month}`;
    }
    const quarter = Math.floor(dateValue.getMonth() / 3) + 1;
    return `${dateValue.getFullYear()}Q${quarter}`;
}

export function computeElapsedPeriods(createdDate, terminalDate, groupBy) {
    if (!(createdDate instanceof Date) || Number.isNaN(createdDate.getTime())) return null;
    if (!(terminalDate instanceof Date) || Number.isNaN(terminalDate.getTime())) return null;
    if (terminalDate < createdDate) return null;
    if (groupBy === 'month') {
        const createdIndex = (createdDate.getFullYear() * 12) + createdDate.getMonth();
        const terminalIndex = (terminalDate.getFullYear() * 12) + terminalDate.getMonth();
        return Math.max(0, terminalIndex - createdIndex);
    }
    const createdQuarter = Math.floor(createdDate.getMonth() / 3);
    const terminalQuarter = Math.floor(terminalDate.getMonth() / 3);
    const createdIndex = (createdDate.getFullYear() * 4) + createdQuarter;
    const terminalIndex = (terminalDate.getFullYear() * 4) + terminalQuarter;
    return Math.max(0, terminalIndex - createdIndex);
}

export function elapsedLabel(index, groupBy) {
    return `${groupBy === 'month' ? 'M' : 'Q'}+${index}`;
}

function startOfPeriod(dateValue, groupBy) {
    if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return null;
    if (groupBy === 'month') {
        return new Date(dateValue.getFullYear(), dateValue.getMonth(), 1);
    }
    const quarterStartMonth = Math.floor(dateValue.getMonth() / 3) * 3;
    return new Date(dateValue.getFullYear(), quarterStartMonth, 1);
}

function nextPeriodStart(dateValue, groupBy) {
    if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return null;
    if (groupBy === 'month') {
        return new Date(dateValue.getFullYear(), dateValue.getMonth() + 1, 1);
    }
    return new Date(dateValue.getFullYear(), dateValue.getMonth() + 3, 1);
}

export function filterCohortIssues(issues, filters = {}) {
    const source = Array.isArray(issues) ? issues : [];
    const projectFilter = String(filters.projectKey || 'all');
    const assigneeFilter = String(filters.assigneeKey || 'all');
    const statusToggles = filters.statusToggles || {};
    const excludedKeys = filters.excludeEpicKeys instanceof Set
        ? filters.excludeEpicKeys
        : new Set(Array.isArray(filters.excludeEpicKeys) ? filters.excludeEpicKeys : []);
    return source.filter((issue) => {
        const issueKey = String(issue?.key || '').trim();
        if (issueKey && excludedKeys.has(issueKey)) {
            return false;
        }
        if (projectFilter !== 'all' && String(issue?.projectKey || '') !== projectFilter) {
            return false;
        }
        const assignee = issue?.assignee || {};
        const assigneeKey = String(assignee?.id || assignee?.name || 'unassigned');
        if (assigneeFilter !== 'all' && assigneeKey !== assigneeFilter) {
            return false;
        }
        const status = normalizeCohortStatus(issue?.status);
        if (statusToggles && Object.prototype.hasOwnProperty.call(statusToggles, status)) {
            return Boolean(statusToggles[status]);
        }
        return true;
    });
}

export function aggregateCohortSummary(issues) {
    const source = Array.isArray(issues) ? issues : [];
    const summary = {
        total: source.length,
        done: 0,
        killed: 0,
        incomplete: 0,
        postponed: 0,
        open: 0,
        resolvedWithDate: 0
    };
    source.forEach((issue) => {
        const status = normalizeCohortStatus(issue?.status);
        summary[status] += 1;
        if (status !== 'open' && issue?.terminalDate) {
            summary.resolvedWithDate += 1;
        }
    });
    return summary;
}

export function deriveProjectOptions(issues) {
    const source = Array.isArray(issues) ? issues : [];
    const map = new Map();
    source.forEach((issue) => {
        const key = String(issue?.projectKey || '').trim();
        if (!key || map.has(key)) return;
        map.set(key, { value: key, label: key });
    });
    return [{ value: 'all', label: 'All Projects' }, ...Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))];
}

export function deriveAssigneeOptions(issues) {
    const source = Array.isArray(issues) ? issues : [];
    const map = new Map();
    source.forEach((issue) => {
        const assignee = issue?.assignee || {};
        const value = String(assignee?.id || assignee?.name || 'unassigned');
        const label = String(assignee?.name || 'Unassigned');
        const current = map.get(value) || { value, label, count: 0 };
        current.count += 1;
        map.set(value, current);
    });
    return [{ value: 'all', label: 'All Assignees', count: source.length }, ...Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))];
}

export function buildCohortGridModel(issues, options = {}) {
    const source = Array.isArray(issues) ? issues : [];
    const groupBy = options.groupBy === 'month' ? 'month' : 'quarter';
    const maxColumnsBudget = Math.max(1, Number(options.maxColumns) || (groupBy === 'month' ? 30 : 12));
    const rangeStartDate = parseIsoDate(options.rangeStartDate);
    const rangeEndDate = parseIsoDate(options.rangeEndDate);
    const rowMap = new Map();
    let maxElapsed = 0;

    source.forEach((issue) => {
        const createdDate = parseIsoDate(issue?.createdDate);
        if (!createdDate) return;
        const periodStart = startOfPeriod(createdDate, groupBy);
        const rowKey = periodKeyFromDate(createdDate, groupBy);
        if (!rowKey) return;
        const row = rowMap.get(rowKey) || {
            key: rowKey,
            label: rowKey,
            startDate: periodStart || createdDate,
            totalCreated: 0,
            openCount: 0,
            cells: new Map(),
            sampleByCell: new Map(),
            statusByCell: new Map()
        };
        row.totalCreated += 1;
        if (createdDate < row.startDate) {
            row.startDate = createdDate;
        }

        const status = normalizeCohortStatus(issue?.status);
        const terminalDate = parseIsoDate(issue?.terminalDate);
        if (status === 'open') {
            row.openCount += 1;
        } else if (terminalDate) {
            const elapsed = computeElapsedPeriods(createdDate, terminalDate, groupBy);
            if (elapsed !== null && elapsed <= maxColumnsBudget) {
                maxElapsed = Math.max(maxElapsed, elapsed);
                row.cells.set(elapsed, (row.cells.get(elapsed) || 0) + 1);
                const statusCounts = row.statusByCell.get(elapsed) || {
                    done: 0,
                    killed: 0,
                    incomplete: 0,
                    postponed: 0
                };
                statusCounts[status] = (statusCounts[status] || 0) + 1;
                row.statusByCell.set(elapsed, statusCounts);
                const sampleList = row.sampleByCell.get(elapsed) || [];
                if (sampleList.length < 5) {
                    sampleList.push({
                        key: issue?.key || '',
                        summary: issue?.summary || '',
                        status,
                        terminalDate: issue?.terminalDate || ''
                    });
                    row.sampleByCell.set(elapsed, sampleList);
                }
            }
        }

        rowMap.set(rowKey, row);
    });

    const sequenceStart = startOfPeriod(rangeStartDate, groupBy);
    const sequenceEnd = startOfPeriod(rangeEndDate, groupBy);
    if (sequenceStart && sequenceEnd && sequenceStart <= sequenceEnd) {
        let cursor = new Date(sequenceStart.getTime());
        while (cursor <= sequenceEnd) {
            const rowKey = periodKeyFromDate(cursor, groupBy);
            if (rowKey && !rowMap.has(rowKey)) {
                rowMap.set(rowKey, {
                    key: rowKey,
                    label: rowKey,
                    startDate: new Date(cursor.getTime()),
                    totalCreated: 0,
                    openCount: 0,
                    cells: new Map(),
                    sampleByCell: new Map(),
                    statusByCell: new Map()
                });
            }
            const next = nextPeriodStart(cursor, groupBy);
            if (!next) break;
            cursor = next;
        }
    }

    const rows = Array.from(rowMap.values()).sort((a, b) => a.startDate - b.startDate);
    const columns = Array.from({ length: maxElapsed + 1 }).map((_, index) => ({
        index,
        key: elapsedLabel(index, groupBy),
        label: elapsedLabel(index, groupBy)
    }));

    let maxCellCount = 0;
    const normalizedRows = rows.map((row) => {
        const cells = columns.map((column) => {
            const count = row.cells.get(column.index) || 0;
            maxCellCount = Math.max(maxCellCount, count);
            return {
                index: column.index,
                count,
                samples: row.sampleByCell.get(column.index) || [],
                statusCounts: row.statusByCell.get(column.index) || {
                    done: 0,
                    killed: 0,
                    incomplete: 0,
                    postponed: 0
                }
            };
        });
        return {
            key: row.key,
            label: row.label,
            totalCreated: row.totalCreated,
            openCount: row.openCount,
            cells
        };
    });

    const resolvedCount = normalizedRows.reduce((sum, row) => {
        return sum + row.cells.reduce((rowSum, cell) => rowSum + cell.count, 0);
    }, 0);

    return {
        groupBy,
        columns,
        rows: normalizedRows,
        maxCellCount,
        totals: {
            created: source.length,
            resolvedWithDate: resolvedCount
        }
    };
}

export function buildOpenEpicsBars(issues, options = {}) {
    const source = Array.isArray(issues) ? issues : [];
    const groupBy = options.groupBy === 'month' ? 'month' : 'quarter';
    const rowKey = options.rowKey || null;
    const todayDate = options.today instanceof Date ? options.today : new Date();
    const limit = Math.max(1, Number(options.limit) || 30);

    return source
        .filter((issue) => {
            const status = normalizeCohortStatus(issue?.status);
            if (status !== 'open') return false;
            const createdDate = parseIsoDate(issue?.createdDate);
            if (!createdDate) return false;
            if (!rowKey) return true;
            return periodKeyFromDate(createdDate, groupBy) === rowKey;
        })
        .map((issue) => {
            const createdDate = parseIsoDate(issue?.createdDate);
            const daysOpen = createdDate
                ? Math.max(0, Math.floor((todayDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)))
                : 0;
            return {
                key: issue?.key || '',
                summary: issue?.summary || '',
                status: issue?.jiraStatus || issue?.status || 'Open',
                projectKey: issue?.projectKey || '',
                teamName: issue?.team?.name || 'Unknown Team',
                assigneeName: issue?.assignee?.name || 'Unassigned',
                daysOpen
            };
        })
        .sort((a, b) => b.daysOpen - a.daysOpen)
        .slice(0, limit);
}
