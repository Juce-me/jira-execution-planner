const present = values => Array.isArray(values)
    && values.some(value => String(value ?? '').trim());

export function resolveEngSprintSelectorState({
    boardMode, catalogReady, bootstrapStatus, capability,
    groupsLoading, groupsFailed, group, savedProjects, savedBoardId,
}) {
    const selectable = Boolean(catalogReady);
    const common = bootstrapStatus === 'loading' || groupsLoading ? 'loading'
        : bootstrapStatus !== 'ready' || groupsFailed ? 'error'
        : capability === false ? 'unsupported'
        : capability !== true ? 'error'
        : !group ? 'department_required'
        : !group.board?.columns?.length ? 'columns_required'
        : !(Array.isArray(savedProjects) && savedProjects.length)
            && !String(savedBoardId ?? '').trim() ? 'projects_required'
        : 'ready';
    const components = present(group?.missingInfoComponents);
    const teams = present(group?.teamIds);
    const readiness = scope => !catalogReady ? 'catalog_pending'
        : common !== 'ready' ? common
        : scope === 'component' && !components ? 'components_required'
        : scope === 'all_work' && !components && !teams ? 'membership_required'
        : 'ready';
    return {
        ordinarySelectable: selectable,
        boardSelectable: Boolean(boardMode && selectable),
        componentReadiness: readiness('component'),
        allWorkReadiness: readiness('all_work'),
    };
}
