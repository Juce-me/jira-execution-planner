import { classifyCapacityIssue } from '../capacityClassification.mjs';
import { storyPointsFor } from './excludedCapacityStats.js'; // exported in Step 2.0
import { getProjectTrackRank } from '../eng/engTaskUtils.js';
import { deriveDefaultBoardColumns, resolveBoardColumnOwner } from '../eng/engBoardColumns.js';
import { BOARD_COLUMN_COLOURS, DEFAULT_COLUMN_COLOUR } from '../settings/groupBoardModel.js';

export const NO_TRACK_LABEL = 'No track';
export const NO_EPIC_COLUMN_ID = 'no-epic';
const NO_EPIC_COLUMN = Object.freeze({ id: NO_EPIC_COLUMN_ID, name: 'No Epic', colour: '#e8edf7' });
// Epic mode drops closed Epics (#186); Team mode counts every Epic in the range so capacity does
// not shrink as Epics close, and drops only Killed work (#173).
const CLOSED_EPIC_STATUSES = new Set(['done', 'killed', 'incomplete']);
const DEFAULT_COLUMN_IDS = { 'To Do': 'default-to-do', 'In Progress': 'default-in-progress', Done: 'default-done' };

function firstSprint(task) {
  // A story belongs to one sprint; the normalized field is [{id,name,state}]. Take the first; key on id.
  const raw = task?.fields?.customfield_10101;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first == null) return null;
  if (typeof first === 'object') {
    const id = first.id != null ? String(first.id) : '';
    return id ? { id, name: first.name || id } : null;
  }
  const s = String(first); // legacy bare-string sprint
  return s ? { id: s, name: s } : null;
}
function trackOf(task) {
  const raw = task?.fields?.epicProjectTrack;
  const v = typeof raw === 'string' ? raw.trim() : '';
  return v || NO_TRACK_LABEL;
}
// inScope is MEMBERSHIP-ONLY — it returns true when a task passes the sprint-range,
// capacity-side, and exclusion filters; it deliberately does NOT consider story points.
// The SP sections (buildProjectTrackSprintSeries, buildProjectTrackBreakdownRows)
// additionally require storyPointsFor(task) > 0; callers that want the SP-bearing
// subset must apply that check themselves (e.g. Task 5's time-in-phase epic set).
export function inScope(task, opts) {
  const epicStatus = String(task?.fields?.epicStatus || '').trim().toLowerCase();
  if (opts.mode === 'team') {
    const storyStatus = String(task?.fields?.status?.name || '').trim().toLowerCase();
    if (epicStatus === 'killed' || storyStatus === 'killed') return false;
  } else if (CLOSED_EPIC_STATUSES.has(epicStatus)) return false;
  const sprint = firstSprint(task);
  if (!sprint) return false;
  if (opts.allowedSprintIds && !opts.allowedSprintIds.has(sprint.id)) return false;
  const epicKey = String(task?.fields?.epicKey || '').trim().toUpperCase();
  if (opts.excludeExcludedCapacity && opts.excludedEpicSet?.has(epicKey)) return false;
  const cls = classifyCapacityIssue(task, { techProjectKeys: opts.techProjectKeys, adHocEpicSet: opts.adHocEpicSet });
  if (opts.excludeAdHoc && cls.capacityType === 'ad_hoc') return false;
  if (opts.capacitySide === 'both') return true;
  return opts.capacitySide === 'tech' ? cls.projectType === 'tech' : cls.projectType === 'product';
}
function withAllowed(opts) {
  return { ...opts, allowedSprintIds: Array.isArray(opts.sprintOrder) && opts.sprintOrder.length
    ? new Set(opts.sprintOrder) : null };
}
function orderTracks(set) {
  return Array.from(set).sort((a, b) => {
    if (a === NO_TRACK_LABEL) return 1;
    if (b === NO_TRACK_LABEL) return -1;
    const r = getProjectTrackRank(a) - getProjectTrackRank(b);
    return r !== 0 ? r : a.localeCompare(b);
  });
}

export function inScopeEpicKeys(tasks, opts) {
  const resolved = withAllowed(opts);
  const filtered = (tasks || []).filter((t) => inScope(t, resolved));
  return [...new Set(filtered.map((t) => String(t.fields?.epicKey || '').trim().toUpperCase()).filter(Boolean))];
}

export function buildProjectTrackSprintSeries(tasks, rawOpts) {
  const opts = withAllowed(rawOpts);
  const orderIndex = new Map((opts.sprintOrder || []).map((id, i) => [id, i]));
  const idxOf = (id) => (orderIndex.has(id) ? orderIndex.get(id) : 1e9);
  const cells = {}; const trackSet = new Set(); const sprintLabels = {};
  const add = (id, name, track, pts) => {
    if (!cells[id]) cells[id] = {};
    cells[id][track] = (cells[id][track] || 0) + pts;
    trackSet.add(track); sprintLabels[id] = name;
  };
  const scoped = (tasks || []).filter((t) => inScope(t, opts) && storyPointsFor(t) > 0);
  if ((opts.mode || 'epic') === 'epic') {
    const byEpic = new Map();
    for (const task of scoped) {
      const epicKey = String(task?.fields?.epicKey || task?.key || '').trim().toUpperCase();
      const sprint = firstSprint(task);
      if (!byEpic.has(epicKey)) byEpic.set(epicKey, { track: trackOf(task), bySprint: new Map(), names: {} });
      const rec = byEpic.get(epicKey);
      rec.bySprint.set(sprint.id, (rec.bySprint.get(sprint.id) || 0) + storyPointsFor(task));
      rec.names[sprint.id] = sprint.name;
    }
    for (const { track, bySprint, names } of byEpic.values()) {
      let domId = null; let best = -1; let bestIdx = -1;
      for (const [id, pts] of bySprint) {
        const idx = idxOf(id);
        if (pts > best || (pts === best && idx > bestIdx)) { best = pts; domId = id; bestIdx = idx; }
      }
      if (domId == null) continue;
      add(domId, names[domId], track, Array.from(bySprint.values()).reduce((a, b) => a + b, 0));
    }
  } else {
    for (const task of scoped) {
      const sprint = firstSprint(task);
      add(sprint.id, sprint.name, trackOf(task), storyPointsFor(task));
    }
  }
  const sprints = Object.keys(cells).sort((a, b) => idxOf(a) - idxOf(b) || a.localeCompare(b));
  return { sprints, sprintLabels, tracks: orderTracks(trackSet), cells };
}

export function summarizeProjectTrackTotals(series) {
  const byTrack = {}; let total = 0;
  for (const s of series.sprints) {
    for (const [track, pts] of Object.entries(series.cells[s] || {})) {
      byTrack[track] = (byTrack[track] || 0) + pts; total += pts;
    }
  }
  return { byTrack, total };
}

export function buildProjectTrackBreakdownRows(tasks, rawOpts) {
  const opts = withAllowed(rawOpts);
  const trackSet = new Set(); const rowMap = new Map();
  const ensure = (id, label) => {
    if (!rowMap.has(id)) rowMap.set(id, { id, label, byTrack: {}, epicKeysByTrack: {}, total: 0 });
    return rowMap.get(id);
  };
  const addRow = (row, track, pts) => { row.byTrack[track] = (row.byTrack[track] || 0) + pts; row.total += pts; trackSet.add(track); };
  const scoped = (tasks || []).filter((t) => inScope(t, opts) && storyPointsFor(t) > 0);
  if ((opts.mode || 'epic') === 'epic') {
    const byEpic = new Map();
    for (const task of scoped) {
      const epicKey = String(task?.fields?.epicKey || task?.key || '').trim().toUpperCase();
      if (!byEpic.has(epicKey)) byEpic.set(epicKey, { track: trackOf(task),
        assignee: task?.fields?.epicAssignee?.displayName || 'Unassigned', total: 0 });
      byEpic.get(epicKey).total += storyPointsFor(task);
    }
    for (const [epicKey, { track, assignee, total }] of byEpic) {
      const row = ensure(assignee, assignee);
      addRow(row, track, total);
      if (!row.epicKeysByTrack[track]) row.epicKeysByTrack[track] = [];
      row.epicKeysByTrack[track].push(epicKey);
    }
  } else {
    for (const task of scoped) {
      const teamId = teamRowIdentity(task);
      // Row label is the story's real team NAME; fall back to the id only when the
      // name is absent. Group teamLabels ids are deliberately not used here.
      const label = task?.fields?.teamName || teamId;
      addRow(ensure(teamId, label), trackOf(task), storyPointsFor(task));
    }
  }
  const rows = Array.from(rowMap.values()).sort((a, b) => b.total - a.total);
  return { rows, tracks: orderTracks(trackSet) };
}

function teamRowIdentity(task) {
  return task?.fields?.teamId || task?.fields?.teamName || 'unknown';
}

// Team mode strips (#173): the Department Board's columns in Board order, or the composer's
// To Do / In Progress / Done default over the observed Epic statuses when no column holds one.
function resolveStripColumns(boardColumns, tasks) {
  const owner = resolveBoardColumnOwner(boardColumns);
  if (owner) {
    const live = boardColumns.filter((column) => (column?.statuses || []).length > 0);
    return { owner, columns: live.map((column) => ({ id: column.id, name: column.name,
      colour: BOARD_COLUMN_COLOURS.includes(column.colour) ? column.colour : DEFAULT_COLUMN_COLOUR })) };
  }
  const observed = [...new Set(tasks.map((task) => String(task?.fields?.epicStatus || '').trim()).filter(Boolean))].sort();
  // No observed Epic status at all still needs one column for status-less Epics.
  const defaults = deriveDefaultBoardColumns((observed.length ? observed : ['To Do']).map((name) => ({ name })))
    .map((column) => ({ ...column, id: DEFAULT_COLUMN_IDS[column.name] }));
  return {
    owner: resolveBoardColumnOwner(defaults),
    columns: defaults.map(({ id, name, colour }) => ({ id, name, colour }))
  };
}

// Per team row and per track, Story Points by the parent Epic's Board column. Uses the same
// scope, SP and row identity as buildProjectTrackBreakdownRows (Team mode), so every track's
// column parts sum to that track's segment and `all` sums to the totals bar.
export function buildProjectTrackColumnSplit(tasks, rawOpts, boardColumns) {
  const opts = withAllowed(rawOpts);
  const scoped = (tasks || []).filter((t) => inScope(t, opts) && storyPointsFor(t) > 0);
  const { owner, columns } = resolveStripColumns(Array.isArray(boardColumns) ? boardColumns : [], scoped);
  const rows = {}; const all = {}; let hasNoEpic = false;
  const add = (bucket, track, columnId, pts) => {
    if (!bucket[track]) bucket[track] = {};
    bucket[track][columnId] = (bucket[track][columnId] || 0) + pts;
  };
  for (const task of scoped) {
    const hasEpic = Boolean(String(task?.fields?.epicKey || '').trim());
    const columnId = hasEpic ? owner(String(task?.fields?.epicStatus || '').trim()) : NO_EPIC_COLUMN_ID;
    if (columnId === NO_EPIC_COLUMN_ID) hasNoEpic = true;
    const rowId = teamRowIdentity(task);
    if (!rows[rowId]) rows[rowId] = {};
    const track = trackOf(task); const pts = storyPointsFor(task);
    add(rows[rowId], track, columnId, pts);
    add(all, track, columnId, pts);
  }
  return { columns: hasNoEpic ? [...columns, { ...NO_EPIC_COLUMN }] : columns, rows, all };
}

// StackedBar strip parts for one track: every Board column in order (0 SP columns included for
// the readout), plus No Epic only when that track has some.
export function projectTrackStripParts(split, byTrackColumns, track) {
  const byColumn = byTrackColumns?.[track] || {};
  return split.columns
    .map((column) => ({ key: column.id, label: column.name, colour: column.colour, value: byColumn[column.id] || 0 }))
    .filter((part) => part.key !== NO_EPIC_COLUMN_ID || part.value > 0);
}
