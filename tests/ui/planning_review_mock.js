// Synthetic API state for component/layout tests only. Real persistence and auth
// acceptance uses planning_shared_plan*.spec.js against Flask and its database.
function createPlanningReviewMock({ initialPlans = {} } = {}) {
    const plans = new Map(), schemas = new Map(), cells = new Map(), receipts = new Map();
    const copy = value => JSON.parse(JSON.stringify(value));
    const planFor = (groupId, sprintId) => {
        const key = `${groupId}:${sprintId}`;
        if (!plans.has(key)) {
            const initial = initialPlans[key] || initialPlans[sprintId];
            plans.set(key, { exists: Boolean(initial), revision: initial ? 1 : 0,
                entries: new Map((initial?.includedIssueIds || []).map(issueId => [String(issueId), { issueId: String(issueId), included: true, revision: 1 }])) });
        }
        return plans.get(key);
    };
    const normalized = columns => columns.map((column, index, all) => ({ ...column, label: column.label.trim(),
        aggregation: column.aggregation ?? (column.type === 'number' ? 'sum' : 'none'), archived: column.archived ?? false,
        after: column.after ?? null, order: column.order ?? all.slice(0, index).filter(previous => previous.rowKind === column.rowKind).length }));
    const applyColumns = (columns, changes) => {
        let result = copy(columns);
        for (const change of changes) {
            if (change.action === 'layout') continue;
            if (change.action === 'add') result.push(copy(change.column));
            else if (change.action === 'reorder') result = result.map(column => column.rowKind === change.rowKind && change.columnIds.includes(column.id) ? { ...column, order: change.columnIds.indexOf(column.id) } : column);
            else result = result.map(column => column.id !== change.columnId ? column : { ...column,
                ...(change.action === 'rename' ? { label: change.label } : {}),
                ...(change.action === 'archive' ? { archived: change.archived } : {}),
                ...(change.action === 'aggregation' ? { aggregation: change.aggregation } : {}) });
        }
        return normalized(result);
    };
    function response(request, body, status = 200) {
        const url = new URL(request.url()), match = /^\/api\/eng\/sprints\/([^/]+)\/review(?:\/(values\/read|operations\/([^/]+)))?$/.exec(url.pathname);
        if (!match || status !== 200) return body;
        const payload = request.method() === 'GET' ? null : request.postDataJSON();
        const groupId = payload?.groupId || url.searchParams.get('groupId') || 'group-alpha';
        const sprintId = match[1], plan = planFor(groupId, sprintId), proof = `synthetic-plan:${groupId}:${sprintId}`;
        if (match[3]) return receipts.get(match[3]) || { operationId: match[3], status: 'unknown' };
        if (match[2] === 'values/read') {
            const result = { cells: [], unavailableIssueIds: [], ...body };
            const storedCells = cells.get(groupId) || new Map();
            const existing = new Map(result.cells.map(cell => [`${cell.rowKind}:${cell.issueId}:${cell.columnId}`, cell]));
            for (const [key, cell] of storedCells) if (payload.issueIds.includes(cell.issueId) && cell.rowKind === payload.rowKind
                && (!existing.has(key) || existing.get(key).revision < cell.revision)) existing.set(key, cell);
            result.cells = [...existing.values()];
            if (!payload.includePlan) return result;
            const unavailable = new Set(result.unavailableIssueIds.filter(id => payload.issueIds.includes(id)));
            return { ...result, unavailableIssueIds: [...unavailable], planRevision: plan.revision, scopeProof: proof,
                planEntries: payload.issueIds.filter(id => !unavailable.has(id)).map(issueId => copy(plan.entries.get(issueId) || { issueId, included: false, revision: 0 })) };
        }
        if (request.method() === 'PATCH' && payload?.version === 2) {
            const prior = schemas.get(groupId) || { columns: [], schemaRevision: payload.baseSchemaRevision };
            const columns = applyColumns(prior.columns, payload.schemaChanges || []);
            const schemaChanged = payload.schemaChanges.some(change => change.action !== 'layout');
            const schemaRevision = schemaChanged ? payload.baseSchemaRevision + 1 : body.schemaRevision ?? prior.schemaRevision;
            if (schemaChanged) schemas.set(groupId, { columns, schemaRevision, saved: true });
            let changed = !plan.exists;
            const inclusionChanges = payload.inclusionChanges.map(change => {
                const previous = plan.entries.get(change.issueId) || { included: false, revision: 0 };
                const entry = { issueId: change.issueId, included: change.included, revision: previous.revision + Number(previous.included !== change.included) };
                if (previous.included !== change.included) { changed = true; plan.entries.set(change.issueId, entry); }
                return entry;
            });
            if (changed) plan.revision++;
            plan.exists = true;
            const storedCells = cells.get(groupId) || new Map();
            const saved = payload.cellChanges.map(change => ({ issueId: change.issueId, rowKind: change.rowKind,
                columnId: change.columnId, value: change.value, revision: change.baseRevision + 1 }));
            saved.forEach(cell => storedCells.set(`${cell.rowKind}:${cell.issueId}:${cell.columnId}`, cell));
            cells.set(groupId, storedCells);
            const layouts = Object.fromEntries(payload.schemaChanges.filter(change => change.action === 'layout').map(change => [change.rowKind, { order: change.order, hidden: change.hidden }]));
            const result = { ...body, columns, schemaRevision, cells: saved, operationId: payload.operationId,
                plan: { exists: true, revision: plan.revision }, inclusionChanges,
                ...(Object.keys(layouts).length ? { layouts, viewRevision: payload.baseViewRevision + 1, inheritedFrom: null } : {}) };
            receipts.set(payload.operationId, { operationId: payload.operationId, status: 'committed', plan: result.plan, schemaRevision,
                ...(result.viewRevision !== undefined ? { viewRevision: result.viewRevision } : {}) });
            return result;
        }
        const result = { schemaVersion: 1, sprintId, groupId, schemaRevision: 0, columns: [], layouts: {}, viewRevision: 0,
            inheritedFrom: null, capabilities: { canRead: true, canSave: true }, ...body };
        const previous = schemas.get(groupId);
        if (previous?.saved && previous.schemaRevision >= result.schemaRevision) Object.assign(result, { columns: previous.columns, schemaRevision: previous.schemaRevision });
        else schemas.set(groupId, { columns: copy(result.columns), schemaRevision: result.schemaRevision });
        if (Object.hasOwn(result, 'plan')) return result;
        return { ...result, plan: { exists: plan.exists, revision: plan.revision },
            scopeProof: result.capabilities.canRead ? proof : null,
            planCapabilities: { canRead: Boolean(result.capabilities.canRead), canSave: Boolean(result.capabilities.canSave), reason: result.capabilities.reason || null } };
    }
    return { response };
}
module.exports = { createPlanningReviewMock };
