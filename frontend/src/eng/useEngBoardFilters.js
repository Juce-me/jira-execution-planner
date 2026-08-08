import * as React from 'react';
import { buildEngBoardFacetModel, mergeBoardEpicGroups, resolveEngBoardFilters } from './engBoardFilters.js';
import { matchesEngBoardSearch } from './engBoardSearch.js';

// The Board's own epic-level filter pipeline (§7.1, D19, O6), extracted out of dashboard.jsx so
// the call site is wiring only. `selection` and its setter stay OWNED by the caller (not this
// hook): the per-group state snapshot/restore system (buildDefaultGroupState,
// buildGroupStateSnapshot, applyGroupState, and the groupStateSnapshot deps array) all run
// earlier in dashboard.jsx's render than this hook is called, so a value this hook computes could
// never be read there — only a plain useState declared before those sites can be.
//
// `scopeTasks` must already be search-blind (engFilterScopeTasks forces its own query to '' while
// showBoard is true, §8): Board's search runs after the facets, here, over the epic-keyed groups
// the facets counted, not over the story-level population.
export function useEngBoardFilters({ scopeTasks, epicsInScope, epicDetails, isTechTask, searchQuery, groupTasksByEpic, selection }) {
    const epicGroups = React.useMemo(
        () => mergeBoardEpicGroups({
            storyGroups: groupTasksByEpic(scopeTasks),
            epicsInScope,
            epicDetails,
        }),
        [scopeTasks, epicsInScope, epicDetails]
    );
    const facetModel = React.useMemo(
        () => buildEngBoardFacetModel({ epicGroups, isTechTask }),
        [epicGroups, isTechTask]
    );
    const boardFilters = React.useMemo(
        () => resolveEngBoardFilters({ model: facetModel, selection }),
        [facetModel, selection]
    );
    const boardEpicGroupsFiltered = React.useMemo(() => (
        epicGroups
            .filter((group) => boardFilters.admitsEpic(group))
            .filter((group) => matchesEngBoardSearch({ key: group.key, ...group.epic }, searchQuery))
    ), [epicGroups, boardFilters, searchQuery]);

    return { boardEpicGroups: epicGroups, boardFilters, boardEpicGroupsFiltered };
}
