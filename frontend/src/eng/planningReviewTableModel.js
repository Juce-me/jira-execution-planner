import { getTaskTeamInfo, PRIORITY_ORDER } from './engTaskUtils.js';

const naturalOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export function newReviewColumnId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const REVIEW_NUMBER_LIMIT = 999999999999n;
export const reviewCellKey = (rowKind, issueId, columnId) => JSON.stringify([rowKind, String(issueId), columnId]);

// Stored values keep the three-decimal canonical form, so reading accepts three; new input allows one.
export function parseReviewNumber(input, maxDecimals = 3) {
    const text = String(input ?? '').trim();
    if (!text) return { valid: true, value: null, scaled: null };
    if (!new RegExp(`^-?\\d+(?:\\.\\d{1,${maxDecimals}})?$`).test(text)) return { valid: false, value: null, scaled: null };
    const negative = text.startsWith('-');
    const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
    const scaled = (BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))) * (negative ? -1n : 1n);
    if (scaled > REVIEW_NUMBER_LIMIT || scaled < -REVIEW_NUMBER_LIMIT) return { valid: false, value: null, scaled: null };
    return { valid: true, value: formatReviewScaled(scaled), scaled };
}

export function formatReviewScaled(scaled) {
    const negative = scaled < 0n;
    const value = negative ? -scaled : scaled;
    const fraction = String(value % 1000n).padStart(3, '0').replace(/0+$/, '');
    return `${negative ? '-' : ''}${value / 1000n}${fraction ? `.${fraction}` : ''}`;
}

// Shows a stored number without trailing zeros: 12.000 -> 12, 12.500 -> 12.5.
export function formatReviewDisplay(value) {
    if (value == null || value === '') return '';
    const parsed = parseReviewNumber(value);
    return parsed.valid ? parsed.value : String(value);
}

export function validateReviewValue(column, input) {
    if (column.type === 'number') {
        // A trailing dot is a typing step ("1." on the way to "1.5"), so it reads as the whole number.
        const parsed = parseReviewNumber(String(input ?? '').trim().replace(/^(-?\d+)\.$/, '$1'), 1);
        return { valid: parsed.valid, value: parsed.value, error: parsed.valid ? '' : 'Use a number up to 999999999.9 with at most one decimal place.' };
    }
    const value = String(input ?? '');
    return { valid: Array.from(value).length <= 500, value: value || null, error: Array.from(value).length > 500 ? 'Text is limited to 500 characters.' : '' };
}

const statusName = value => typeof value === 'string' ? value : value?.name || '';
const rowIssueId = (issue, fields) => String(issue.id ?? fields.issueId ?? fields.id ?? '');
const projectInfo = (issue, fields) => fields.project?.key || fields.projectKey || issue.project?.key || issue.projectKey || String(issue.key || '').split('-')[0];
function issueRow(issue, rowKind, getTeamInfo) {
    const fields = rowKind === 'story' ? issue.fields || {} : issue;
    return {
        id: rowIssueId(issue, fields), issueId: rowIssueId(issue, fields),
        rowKind, key: issue.key || '', summary: fields.summary || issue.key || '',
        status: statusName(fields.status), priority: statusName(fields.priority),
        storyPoints: fields.customfield_10004 ?? fields.storyPoints ?? 0,
        team: getTeamInfo(rowKind === 'story' ? issue : { fields }), project: projectInfo(issue, fields),
        assignee: fields.assignee?.displayName || '', components: (fields.components || []).map(item => typeof item === 'string' ? item : item.name).filter(Boolean).join(', '), projectTrack: fields.projectTrack || '', issue, synthetic: false, children: [], requirements: [],
    };
}

export function buildPlanningReviewRows({ epicGroups = [], visibleTasks = [], mode = 'epic', getTeamInfo = getTaskTeamInfo } = {}) {
    const visibleKeys = new Set(visibleTasks.map(task => task.key));
    const rows = [];
    const represented = new Set();
    for (const group of epicGroups) {
        const children = (group.tasks || []).filter(task => visibleKeys.has(task.key));
        children.forEach(task => represented.add(task.key));
        const requirements = group.requirements || [];
        const realEpic = group.key && group.key !== 'NO_EPIC' && group.epic?.key && group.epic.key !== 'NO_EPIC';
        if (mode === 'story') {
            rows.push(...children.map(task => ({ ...issueRow(task, 'story', getTeamInfo), epicKey: realEpic ? group.key : null, epicIssueId: realEpic ? rowIssueId(group.epic, group.epic) || null : null, epic: realEpic ? group.epic.summary || group.key : 'No Epic', projectTrack: realEpic ? group.epic.projectTrack || '' : '' })));
            rows.push(...requirements.map(requirement => ({ id: requirement.id, rowKind: 'requirement', key: '', summary: `${group.epic?.summary || group.key}: Story awaiting creation for ${requirement.team?.name || 'Unknown Team'}`, synthetic: true, requirements: [requirement], children: [], storyPoints: 0, team: requirement.team, project: group.epic?.projectKey || '', epicKey: realEpic ? group.key : null, epic: realEpic ? group.epic.summary || group.key : 'No Epic', projectTrack: group.epic?.projectTrack || '' })));
        } else if (realEpic) {
            const row = issueRow(group.epic, 'epic', getTeamInfo);
            row.children = children;
            row.requirements = requirements;
            row.storyPoints = formatReviewScaled(children.reduce((sum, task) => sum + (parseReviewNumber(task.fields?.customfield_10004 ?? task.fields?.storyPoints).scaled ?? 0n), 0n));
            row.teamsInScope = [...new Set([...children.map(task => getTeamInfo(task).name), ...requirements.map(item => item.team?.name || 'Unknown Team')])].sort(naturalOrder.compare);
            rows.push(row);
        } else if (children.length) {
            rows.push({ id: 'no-epic', rowKind: 'group', key: '', summary: 'No Epic', synthetic: true, children, requirements: [], storyPoints: formatReviewScaled(children.reduce((sum, task) => sum + (parseReviewNumber(task.fields?.customfield_10004).scaled ?? 0n), 0n)) });
        }
    }
    const orphans = visibleTasks.filter(task => !represented.has(task.key));
    if (mode === 'story') rows.push(...orphans.map(task => ({ ...issueRow(task, 'story', getTeamInfo), epicKey: null, epicIssueId: null, epic: 'No Epic' })));
    else if (orphans.length) {
        const existing = rows.find(row => row.id === 'no-epic');
        if (existing) { existing.children.push(...orphans); existing.storyPoints = formatReviewScaled(existing.children.reduce((sum, task) => sum + (parseReviewNumber(task.fields?.customfield_10004).scaled ?? 0n), 0n)); }
        else rows.push({ id: 'no-epic', rowKind: 'group', key: '', summary: 'No Epic', synthetic: true, children: orphans, requirements: [], storyPoints: formatReviewScaled(orphans.reduce((sum, task) => sum + (parseReviewNumber(task.fields?.customfield_10004).scaled ?? 0n), 0n)) });
    }
    return rows;
}

export function reviewSelectionState(row, selectedKeys = new Set()) {
    const tasks = row.rowKind === 'story' && !row.synthetic ? [row.issue] : row.synthetic ? [] : row.children;
    const selected = tasks.filter(task => selectedKeys.has(task.key)).length;
    return { checked: tasks.length > 0 && selected === tasks.length, mixed: selected > 0 && selected < tasks.length, disabled: tasks.length === 0, tasks };
}

// A real Epic or Story with no points (a null Jira value counts as 0). Placeholders and group rows never qualify.
export function hasZeroStoryPoints(row) {
    if (row.synthetic || !['epic', 'story'].includes(row.rowKind)) return false;
    const parsed = parseReviewNumber(row.storyPoints);
    return parsed.valid && (parsed.scaled ?? 0n) === 0n;
}

// Points of the rows the user has ticked: a Story counts itself; an Epic or the No Epic group counts its ticked children.
export function selectedStoryPoints(row, selectedKeys = new Set()) {
    if (row.rowKind === 'requirement') return null;
    const tasks = (row.rowKind === 'story' ? [row.issue] : row.children || []).filter(task => selectedKeys.has(task.key));
    if (!tasks.length) return null;
    return formatReviewScaled(tasks.reduce((sum, task) => sum + (parseReviewNumber(task.fields?.customfield_10004 ?? task.fields?.storyPoints).scaled ?? 0n), 0n));
}

export const DEFAULT_REVIEW_HIDDEN_COLUMNS = ['components', 'project', 'capacity', 'projectTrack'];
// Column limits accumulate across every Sprint for a Department group: the table's own check and the server's codes share this copy.
export const REVIEW_LIMIT_MESSAGES = {
    review_column_limit: 'This row mode supports up to 30 active custom columns per group.',
    review_schema_limit: 'Review columns are limited to 240 per group, archived ones included.',
};

// New or moved column ids go after `afterId`; 'summary' means directly after the pinned columns; anything else appends.
export function insertColumnId(order, id, afterId = null) {
    const next = order.filter(item => item !== id);
    let index = next.length;
    if (afterId === 'summary') index = 0;
    else if (afterId && next.includes(afterId)) index = next.indexOf(afterId) + 1;
    next.splice(index, 0, id);
    return next;
}

// The anchor a new column sends: the corner (null) is the last native column of the full order, a boundary after a
// derived column is the nearest preceding native column, else 'summary', so a new column never lands among derived ones.
export function nativeAnchorFor(order, afterId, derivedIds = []) {
    const derived = new Set(derivedIds);
    if (afterId !== null && !derived.has(afterId)) return afterId;
    const end = afterId === null ? order.length : order.indexOf(afterId);
    for (let index = end - 1; index >= 0; index -= 1) if (!derived.has(order[index])) return order[index];
    return afterId === null && !order.length ? null : 'summary';
}

// `edges` are { afterId, x } header boundaries; returns the afterId of the closest edge within `threshold` px, else null.
export function nearestBoundary(edges, x, threshold = 5) {
    let best = null, closest = Infinity;
    for (const edge of edges) {
        const distance = Math.abs(edge.x - x);
        if (distance <= threshold && distance < closest) { best = edge.afterId; closest = distance; }
    }
    return best;
}

// `derived: true` places columns by the saved order plus each new column's `after` anchor and appends the other row kind's
// derived columns (Story number sums up to Epics, every Epic column down to Stories); without it the columns are unchanged.
export function buildPlanningReviewColumns({ rows = [], mode = 'epic', customColumns = [], hidden = new Set(), admittedTeamCount, admittedProjectCount, layout = {}, derived = false } = {}) {
    const teams = new Set(rows.flatMap(row => row.rowKind === 'epic' ? row.teamsInScope || [] : [row.team?.name || 'Unknown Team']));
    const projects = new Set(rows.filter(row => !row.synthetic).map(row => row.project).filter(Boolean));
    const columns = [
        { id: 'key', label: 'Key', type: 'text', optional: true },
        { id: 'summary', label: 'Summary', type: 'text', required: true },
        { id: 'status', label: 'Status', type: 'text', optional: true },
        { id: 'priority', label: 'Priority', type: 'priority', optional: true },
        { id: 'storyPoints', label: mode === 'epic' ? 'Sprint SP' : 'Story Points', type: 'number', optional: true, aggregation: 'sum' },
        { id: 'accepted', label: 'Accepted', type: 'number', optional: true, aggregation: 'sum' },
    ];
    // The fold runs on the unfiltered list, so admission-gated built-ins stay in it as anchors and are filtered afterwards.
    const gated = new Set();
    const teamAdmitted = (admittedTeamCount ?? teams.size) > 1, projectAdmitted = (admittedProjectCount ?? projects.size) > 1;
    if (teamAdmitted || derived) columns.push({ id: mode === 'epic' ? 'teamsInScope' : 'team', label: mode === 'epic' ? 'Teams in scope' : 'Team', type: 'text', optional: true });
    if (!teamAdmitted) gated.add(mode === 'epic' ? 'teamsInScope' : 'team');
    if (projectAdmitted || derived) columns.push({ id: 'project', label: 'Project', type: 'text', optional: true });
    if (!projectAdmitted) gated.add('project');
    if (mode === 'epic') columns.push({ id: 'team', label: 'Epic Team', type: 'text', optional: true });
    if (mode === 'story') columns.push({ id: 'epic', label: 'Epic', type: 'text', optional: true });
    columns.push({ id: 'assignee', label: 'Assignee', type: 'text', optional: true }, { id: 'components', label: 'Component', type: 'text', optional: true }, { id: 'capacity', label: 'Capacity', type: 'text', optional: true }, { id: 'projectTrack', label: 'Project Track', type: 'text', optional: true });
    const pinned = columns.filter(column => ['key', 'summary'].includes(column.id));
    if (!derived) {
        columns.push(...customColumns.filter(column => column.rowKind === mode && !column.archived).sort((a, b) => a.order - b.order).map(column => ({ ...column, custom: true })));
        const order = new Map((layout.order || []).map((id, index) => [id, index]));
        const movable = columns.filter(column => !['key', 'summary'].includes(column.id));
        movable.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
        return [...pinned, ...movable].filter(column => column.required || !hidden.has(column.id));
    }
    const byCreation = (a, b) => a.order - b.order;
    const own = customColumns.filter(column => column.rowKind === mode).sort(byCreation);
    const derivedColumns = customColumns
        .filter(column => column.rowKind !== mode && !column.archived && (mode === 'story' || (column.type === 'number' && column.aggregation === 'sum')))
        .sort(byCreation)
        .map(column => ({ id: column.id, rowKind: column.rowKind, label: column.label, type: column.type, aggregation: mode === 'epic' ? 'sum' : 'none', order: column.order, derived: true }));
    const builtIns = columns.filter(column => !['key', 'summary'].includes(column.id)).map(column => column.id);
    let order = [...new Set((layout.order || []).filter(id => !['key', 'summary'].includes(id)))];
    order.push(...builtIns.filter(id => !order.includes(id)));
    for (const column of own) if (!order.includes(column.id)) order = insertColumnId(order, column.id, column.after ?? null);
    order.push(...derivedColumns.map(column => column.id).filter(id => !order.includes(id)));
    const byId = new Map([...columns, ...own.filter(column => !column.archived).map(column => ({ ...column, custom: true })), ...derivedColumns].map(column => [column.id, column]));
    const movable = order.map(id => byId.get(id)).filter(column => column && !gated.has(column.id) && !['key', 'summary'].includes(column.id));
    return [...pinned, ...movable].filter(column => column.required || !hidden.has(column.id));
}

// A derived cell's value: the sum of the in-scope Stories' stored values on Epic and "No Epic" rows (Story columns), or
// the parent Epic's value on Story rows (Epic columns). `isLoaded(id, rowKind)` must confirm the source is loaded and
// available; until it does, or during a manual refresh, the cell is incomplete and shows blank. Never written.
export function derivedValue(row, column, { cells = {}, isLoaded, forceLoading = false } = {}) {
    const blank = complete => ({ scaled: null, value: null, complete });
    if (forceLoading) return blank(false);
    const loaded = (id, rowKind) => Boolean(id) && Boolean(isLoaded?.(id, rowKind));
    if (column.rowKind === 'story') {
        if (!['epic', 'group'].includes(row.rowKind)) return blank(true);
        let sum = 0n, stored = false;
        for (const task of row.children || []) {
            const id = rowIssueId(task, task.fields || {});
            if (!loaded(id, 'story')) return blank(false);
            const scaled = parseReviewNumber(cells[reviewCellKey('story', id, column.id)]?.value).scaled;
            if (scaled != null) { sum += scaled; stored = true; }
        }
        return stored ? { scaled: sum, value: formatReviewScaled(sum), complete: true } : blank(true);
    }
    if (column.rowKind === 'epic') {
        if (row.rowKind !== 'story' || row.synthetic || !row.epicIssueId) return blank(true);
        if (!loaded(row.epicIssueId, 'epic')) return blank(false);
        const stored = cells[reviewCellKey('epic', row.epicIssueId, column.id)]?.value;
        if (stored == null || stored === '') return blank(true);
        if (column.type !== 'number') return { scaled: null, value: String(stored), complete: true };
        const parsed = parseReviewNumber(stored);
        return parsed.valid && parsed.scaled != null ? { scaled: parsed.scaled, value: parsed.value, complete: true } : blank(true);
    }
    return blank(true);
}

// `originals` (the registry's planningOriginals()) makes a row with a pending status/priority edit sort by its
// pre-edit value; the cell still renders the new one, and the row moves only once the edit is confirmed.
export function reviewValue(row, column, cells = {}, originals, derivedContext) {
    if (column.derived) return derivedValue(row, column, { ...derivedContext, cells }).value;
    if (column.custom) return row.synthetic || !row.issueId ? null : cells[reviewCellKey(row.rowKind, row.issueId, column.id)]?.value ?? null;
    if (originals?.size && (column.id === 'status' || column.id === 'priority')) {
        const original = originals.get(String(row.key || '').trim().toUpperCase())?.[column.id];
        if (original !== undefined) return typeof original === 'string' ? original : original?.name ?? null;
    }
    if (column.id === 'team') return row.team?.name || 'Unknown Team';
    if (column.id === 'teamsInScope') return (row.teamsInScope || []).join(', ');
    return row[column.id] ?? null;
}

export function sortPlanningReviewRows(rows, criteria = [], columns = [], cells = {}, originals, derivedContext) {
    if (criteria.length > 5) throw new Error('Use at most five sort criteria.');
    const byId = new Map(columns.map(column => [column.id, column]));
    return [...rows].sort((a, b) => {
        for (const criterion of criteria) {
            const column = byId.get(criterion.columnId);
            if (!column) continue;
            // A derived value compares by its exact sum; an incomplete one is null, so it sorts with the empties.
            const ad = column.derived ? derivedValue(a, column, { ...derivedContext, cells }) : null, bd = column.derived ? derivedValue(b, column, { ...derivedContext, cells }) : null;
            const av = ad ? ad.value : reviewValue(a, column, cells, originals), bv = bd ? bd.value : reviewValue(b, column, cells, originals);
            const ab = av == null || av === '', bb = bv == null || bv === '';
            if (ab !== bb) return ab ? 1 : -1;
            if (ab) continue;
            let comparison;
            if (column.type === 'number') {
                const an = ad ? ad.scaled ?? 0n : parseReviewNumber(av).scaled ?? 0n, bn = bd ? bd.scaled ?? 0n : parseReviewNumber(bv).scaled ?? 0n;
                comparison = an < bn ? -1 : an > bn ? 1 : 0;
            } else if (column.type === 'priority') comparison = (PRIORITY_ORDER[av] ?? 999) - (PRIORITY_ORDER[bv] ?? 999);
            else comparison = naturalOrder.compare(String(av), String(bv));
            if (comparison) return comparison * (criterion.direction === 'desc' ? -1 : 1);
        }
        return naturalOrder.compare(a.issueId || a.id, b.issueId || b.id) || naturalOrder.compare(a.key, b.key);
    });
}

// A rolled-up column totals the Epic rows plus the "No Epic" row, so it equals the in-scope Story total; it is blank
// (null) while any contributing value is incomplete. Epic columns shown on Stories carry no aggregation and no total.
export function planningReviewTotals(rows, columns, cells = {}, derivedContext) {
    return Object.fromEntries(columns.filter(column => column.type === 'number' && column.aggregation === 'sum').map(column => {
        if (column.derived) {
            let sum = 0n;
            for (const row of rows) {
                const result = derivedValue(row, column, { ...derivedContext, cells });
                if (!result.complete) return [column.id, null];
                sum += result.scaled ?? 0n;
            }
            return [column.id, formatReviewScaled(sum)];
        }
        const sum = rows.reduce((total, row) => {
            if (column.custom && row.synthetic) return total;
            return total + (parseReviewNumber(reviewValue(row, column, cells)).scaled ?? 0n);
        }, 0n);
        return [column.id, formatReviewScaled(sum)];
    }));
}

export function planningReviewScopeCounts({ tasks = [], selectedTeamIds = [], allTeams = false, groupTeamIds = [], projects = [], readinessEpics = [], getTeamInfo = getTaskTeamInfo } = {}) {
    const selected = new Set(Array.from(selectedTeamIds).map(String).filter(id => id && id !== 'all'));
    const admitted = allTeams || selected.size === 0 ? null : selected;
    const teams = new Set(admitted || Array.from(groupTeamIds).map(String).filter(Boolean));
    const projectKeys = new Set(projects.map(project => typeof project === 'string' ? project : project?.key).filter(Boolean));
    for (const task of tasks) {
        const team = getTeamInfo(task);
        if (admitted && !admitted.has(String(team.id))) continue;
        teams.add(String(team.id || 'unknown'));
        const project = projectInfo(task, task.fields || {});
        if (project) projectKeys.add(project);
    }
    for (const epic of readinessEpics) {
        const missing = epic.missingTeams || [];
        if (admitted && !missing.some(team => admitted.has(String(team.id))) && !admitted.has(String(epic.teamId || epic.team?.id || ''))) continue;
        for (const team of missing) if (!admitted || admitted.has(String(team.id))) teams.add(String(team.id));
        const project = projectInfo(epic, epic);
        if (project) projectKeys.add(project);
    }
    return { teams: teams.size, projects: projectKeys.size };
}
