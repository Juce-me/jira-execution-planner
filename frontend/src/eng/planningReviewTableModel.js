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
        const parsed = parseReviewNumber(input, 1);
        return { valid: parsed.valid, value: parsed.value, error: parsed.valid ? '' : 'Use a number up to 999999999.9 with at most one decimal place.' };
    }
    const value = String(input ?? '');
    return { valid: Array.from(value).length <= 500, value: value || null, error: Array.from(value).length > 500 ? 'Text is limited to 500 characters.' : '' };
}

const statusName = value => typeof value === 'string' ? value : value?.name || '';
const projectInfo = (issue, fields) => fields.project?.key || fields.projectKey || issue.project?.key || issue.projectKey || String(issue.key || '').split('-')[0];
function issueRow(issue, rowKind, getTeamInfo) {
    const fields = rowKind === 'story' ? issue.fields || {} : issue;
    return {
        id: String(issue.id ?? fields.issueId ?? fields.id ?? ''), issueId: String(issue.id ?? fields.issueId ?? fields.id ?? ''),
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
            rows.push(...children.map(task => ({ ...issueRow(task, 'story', getTeamInfo), epicKey: realEpic ? group.key : null, epic: realEpic ? group.epic.summary || group.key : 'No Epic', projectTrack: realEpic ? group.epic.projectTrack || '' : '' })));
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
    if (mode === 'story') rows.push(...orphans.map(task => ({ ...issueRow(task, 'story', getTeamInfo), epicKey: null, epic: 'No Epic' })));
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

// New or moved column ids go after `afterId`; 'summary' means directly after the pinned columns; anything else appends.
export function insertColumnId(order, id, afterId = null) {
    const next = order.filter(item => item !== id);
    let index = next.length;
    if (afterId === 'summary') index = 0;
    else if (afterId && next.includes(afterId)) index = next.indexOf(afterId) + 1;
    next.splice(index, 0, id);
    return next;
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

export function buildPlanningReviewColumns({ rows = [], mode = 'epic', customColumns = [], hidden = new Set(), admittedTeamCount, admittedProjectCount, layout = {} } = {}) {
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
    if ((admittedTeamCount ?? teams.size) > 1) columns.push({ id: mode === 'epic' ? 'teamsInScope' : 'team', label: mode === 'epic' ? 'Teams in scope' : 'Team', type: 'text', optional: true });
    if ((admittedProjectCount ?? projects.size) > 1) columns.push({ id: 'project', label: 'Project', type: 'text', optional: true });
    if (mode === 'epic') columns.push({ id: 'team', label: 'Epic Team', type: 'text', optional: true });
    if (mode === 'story') columns.push({ id: 'epic', label: 'Epic', type: 'text', optional: true });
    columns.push({ id: 'assignee', label: 'Assignee', type: 'text', optional: true }, { id: 'components', label: 'Component', type: 'text', optional: true }, { id: 'capacity', label: 'Capacity', type: 'text', optional: true }, { id: 'projectTrack', label: 'Project Track', type: 'text', optional: true });
    columns.push(...customColumns.filter(column => column.rowKind === mode && !column.archived).sort((a, b) => a.order - b.order).map(column => ({ ...column, custom: true })));
    const order = new Map((layout.order || []).map((id, index) => [id, index]));
    const pinned = columns.filter(column => ['key', 'summary'].includes(column.id));
    const movable = columns.filter(column => !['key', 'summary'].includes(column.id));
    movable.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    return [...pinned, ...movable].filter(column => column.required || !hidden.has(column.id));
}

export function reviewValue(row, column, cells = {}) {
    if (column.custom) return row.synthetic || !row.issueId ? null : cells[reviewCellKey(row.rowKind, row.issueId, column.id)]?.value ?? null;
    if (column.id === 'team') return row.team?.name || 'Unknown Team';
    if (column.id === 'teamsInScope') return (row.teamsInScope || []).join(', ');
    return row[column.id] ?? null;
}

export function sortPlanningReviewRows(rows, criteria = [], columns = [], cells = {}) {
    if (criteria.length > 5) throw new Error('Use at most five sort criteria.');
    const byId = new Map(columns.map(column => [column.id, column]));
    return [...rows].sort((a, b) => {
        for (const criterion of criteria) {
            const column = byId.get(criterion.columnId);
            if (!column) continue;
            const av = reviewValue(a, column, cells), bv = reviewValue(b, column, cells);
            const ab = av == null || av === '', bb = bv == null || bv === '';
            if (ab !== bb) return ab ? 1 : -1;
            if (ab) continue;
            let comparison;
            if (column.type === 'number') {
                const an = parseReviewNumber(av).scaled ?? 0n, bn = parseReviewNumber(bv).scaled ?? 0n;
                comparison = an < bn ? -1 : an > bn ? 1 : 0;
            } else if (column.type === 'priority') comparison = (PRIORITY_ORDER[av] ?? 999) - (PRIORITY_ORDER[bv] ?? 999);
            else comparison = naturalOrder.compare(String(av), String(bv));
            if (comparison) return comparison * (criterion.direction === 'desc' ? -1 : 1);
        }
        return naturalOrder.compare(a.issueId || a.id, b.issueId || b.id) || naturalOrder.compare(a.key, b.key);
    });
}

export function planningReviewTotals(rows, columns, cells = {}) {
    return Object.fromEntries(columns.filter(column => column.type === 'number' && column.aggregation === 'sum').map(column => {
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
