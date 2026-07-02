import { classifyCapacityIssue } from '../capacityClassification.mjs';
import { storyPointsFor } from './excludedCapacityStats.js'; // exported in Step 2.0
import { getProjectTrackRank } from '../eng/engTaskUtils.js';

export const NO_TRACK_LABEL = 'No track';

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
    if (!rowMap.has(id)) rowMap.set(id, { id, label, byTrack: {}, total: 0 });
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
    for (const { track, assignee, total } of byEpic.values()) addRow(ensure(assignee, assignee), track, total);
  } else {
    for (const task of scoped) {
      const teamId = task?.fields?.teamId || task?.fields?.teamName || 'unknown';
      // Row label is the story's real team NAME; fall back to the id only when the
      // name is absent. Group teamLabels ids are deliberately not used here.
      const label = task?.fields?.teamName || teamId;
      addRow(ensure(teamId, label), trackOf(task), storyPointsFor(task));
    }
  }
  const rows = Array.from(rowMap.values()).sort((a, b) => b.total - a.total);
  return { rows, tracks: orderTracks(trackSet) };
}
