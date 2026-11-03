// Review-table roles versus the native row kinds the review storage uses.
//
// The table speaks two roles: `epic` rows are the PARENT level (the grouping row) and `story` rows are the CHILD
// level (the planning leaf). The role names are historical; what they mean depends on the configuration:
//
//   Legacy      parent = native `epic`       child = native `story`
//   rnd_2027    parent = native `initiative` child = native `epic`
//
// Native kinds select the stored namespace (NULL Legacy versus the configuration's own), so the controller translates
// at its single request/response boundary and nothing else in the table knows the difference.
import { WORK_MODEL_LEGACY, isCombinedWorkModel, resolveEntityNames } from './engWorkModel.js';

export const REVIEW_ROLES = Object.freeze(['epic', 'story']);

const IDENTITY = Object.freeze({ toNative: { epic: 'epic', story: 'story' }, toRole: { epic: 'epic', story: 'story' } });
const COMBINED = Object.freeze({ toNative: { epic: 'initiative', story: 'epic' }, toRole: { initiative: 'epic', epic: 'story' } });

export const reviewKindMap = workModel => (isCombinedWorkModel(workModel) ? COMBINED : IDENTITY);

// `names` is EntityNames; a bare model string still resolves to that model's defaults until every caller passes names.
export function reviewLabels(names = resolveEntityNames(WORK_MODEL_LEGACY)) {
    const resolved = names && typeof names === 'object' ? names : resolveEntityNames(names);
    return {
        parent: resolved.parent, parentPlural: resolved.parentPlural, child: resolved.child, childPlural: resolved.childPlural,
        // The child-level builtin that names the parent: `epic` in Legacy, `initiative` for the combined model.
        parentColumnId: isCombinedWorkModel(resolved.model) ? 'initiative' : 'epic',
    };
}

const mapKind = (map, kind) => (Object.prototype.hasOwnProperty.call(map, kind) ? map[kind] : kind);

export function toRoleSchema(workModel, data) {
    const { toRole } = reviewKindMap(workModel);
    const next = { ...data };
    if (Array.isArray(data?.columns)) next.columns = data.columns.map(column => ({ ...column, rowKind: mapKind(toRole, column.rowKind) }));
    if (data?.layouts && typeof data.layouts === 'object') {
        next.layouts = Object.fromEntries(Object.entries(data.layouts).map(([kind, layout]) => [mapKind(toRole, kind), layout]));
    }
    for (const key of ['cells', 'cellChanges']) {
        if (Array.isArray(data?.[key])) next[key] = data[key].map(cell => ({ ...cell, rowKind: mapKind(toRole, cell.rowKind) }));
    }
    return next;
}

export function toNativeChange(workModel, change) {
    const { toNative } = reviewKindMap(workModel);
    if (change.action === 'add') return { ...change, column: { ...change.column, rowKind: mapKind(toNative, change.column.rowKind) } };
    if (change.action === 'reorder' || change.action === 'layout') return { ...change, rowKind: mapKind(toNative, change.rowKind) };
    return change;
}

export const toNativeKind = (workModel, role) => mapKind(reviewKindMap(workModel).toNative, role);
