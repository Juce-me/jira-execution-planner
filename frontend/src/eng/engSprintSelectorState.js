import { isCombinedWorkModel } from './engWorkModel.js';

const present = values => Array.isArray(values)
    && values.some(value => String(value ?? '').trim());

export function resolveEngSprintSelectorState({
    boardMode, catalogReady, bootstrapStatus, capability,
    groupsLoading, groupsFailed, group, savedProjects, savedBoardId,
    quarterMode = false, quarterConfigurationReady = false, workModel = 'legacy',
}) {
    // After promotion the viewed quarter, not a physical Sprint, makes the selector usable and lets the
    // Board's Component / Allocation / All work scopes run: the resolved configuration is the readiness they need.
    const configurationReady = Boolean(quarterMode && quarterConfigurationReady);
    const selectable = Boolean(catalogReady || quarterMode);
    const common = bootstrapStatus === 'loading' || groupsLoading ? 'loading'
        : bootstrapStatus !== 'ready' || groupsFailed ? 'error'
        : capability === false ? 'unsupported'
        : capability !== true ? 'error'
        : !group ? 'department_required'
        : !group.board?.columns?.length ? 'columns_required'
        : !(Array.isArray(savedProjects) && savedProjects.length)
            && !String(savedBoardId ?? '').trim() ? 'projects_required'
        : 'ready';
    const delivery = isCombinedWorkModel(workModel);
    const components = present(group?.missingInfoComponents);
    const allocations = Array.isArray(group?.allocationTypes) && group.allocationTypes.some(row => String(row?.value ?? '').trim());
    const teams = present(group?.teamIds);
    const readiness = scope => !(catalogReady || configurationReady) ? 'catalog_pending'
        : common === 'loading' ? common
        : (scope === 'component' && delivery) || (scope === 'allocation' && !delivery) ? 'scope_model_mismatch'
        : common !== 'ready' ? common
        : scope === 'component' && !components ? 'components_required'
        : scope === 'allocation' && !allocations ? 'allocations_required'
        : scope === 'all_work' && !(delivery ? allocations : components) && !teams ? 'membership_required'
        : 'ready';
    return {
        ordinarySelectable: selectable,
        boardSelectable: Boolean(boardMode && selectable),
        componentReadiness: readiness('component'),
        allocationReadiness: readiness('allocation'),
        allWorkReadiness: readiness('all_work'),
    };
}
