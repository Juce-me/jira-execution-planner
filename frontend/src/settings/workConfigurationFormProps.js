import { makeFieldKeyDown, makeFieldSearchResults } from './useJiraFieldPickers.js';
import {
    MODEL_LEGACY,
    MODEL_RND,
    DELIVERY_PROJECT_LIMIT_MESSAGE,
    describeHierarchyRow,
    hierarchyLabels,
    slotsFor,
} from './workConfigurationModel.js';

// Builds the props the production JiraFieldSettings renderer takes for one configuration entry and
// one nested tab. Pure: every state read/write goes through the `api` callbacks, and every setter
// emits a field patch for its own value only, so a late callback cannot overwrite an inline rename.

export const FIELD_SLOTS = [
    ['sprintField', 'sprint'], ['storyPointsField', 'storyPoints'], ['parentNameField', 'parentName'],
    ['teamField', 'team'], ['deliveryOwnerField', 'deliveryOwner'],
];
const upper = value => value[0].toUpperCase() + value.slice(1);
const resolve = (value, previous) => (typeof value === 'function' ? value(previous) : value);

const REQUIREMENT = {
    legacy: { sprint: 'required', storyPoints: 'required', team: 'required', parentName: 'optional', deliveryOwner: 'optional' },
    rnd_2027: { sprint: 'required', storyPoints: 'required', team: 'required', parentName: 'optional', deliveryOwner: 'optional' },
};

export function buildFieldSettingsProps({
    entry, tab, search = {}, setSearch, patch, refs, technicalIds, setTechnicalIds,
    jiraFields, loadingFields, jiraProjects, loadingProjects, projectResults, projectLoading,
    boardResults, boardLoading, resolveProjectName, addProject, removeProject,
    typeCatalog, hoverKey, setHoverKey, requestRetire, boardName,
}) {
    const id = entry.id;
    const model = entry.model;
    const rnd = model === MODEL_RND;
    const get = (key, fallback) => search[key] ?? fallback;
    const set = (key, fallback) => value => setSearch(id, key, previous => resolve(value, previous ?? fallback));
    const parentName = rnd ? 'initiative' : 'epic';
    const childName = rnd ? 'Epic' : 'Story';
    const parentLabel = rnd ? 'Initiative' : 'Epic';
    const props = {
        groupManageTab: tab,
        loadingFields,
        jiraFields,
        loadingProjects,
        jiraProjects,
        showTechnicalFieldIds: technicalIds,
        setShowTechnicalFieldIds: value => setTechnicalIds(resolve(value, technicalIds)),
        mappingHoverKey: hoverKey,
        setMappingHoverKey: setHoverKey,
        sourceFieldHelpers: {
            sprint: 'Where each work item\u2019s Sprint is read, for every issue type.',
            board: ['No board: Sprints seen on this project\u2019s issues.', 'Board set: also Sprints on that board.'],
            requirement: { sprint: 'required' },
        },
    };

    for (const [prefix, name] of FIELD_SLOTS) {
        const cap = upper(prefix);
        const query = get(`${prefix}Query`, '');
        const resultSet = makeFieldSearchResults(query, jiraFields || []);
        const results = resultSet.items;
        const index = get(`${prefix}Index`, 0);
        const setId = value => patch(id, current => ({ fields: { [name]: { ...current.fields[name], fieldId: resolve(value, current.fields[name]?.fieldId || '') } } }));
        const setName = value => patch(id, current => ({ fields: { [name]: { ...current.fields[name], fieldName: resolve(value, current.fields[name]?.fieldName || '') } } }));
        props[`${prefix}NameDraft`] = entry.fields[name]?.fieldName || '';
        props[`${prefix}IdDraft`] = entry.fields[name]?.fieldId || '';
        props[`set${cap}IdDraft`] = setId;
        props[`set${cap}NameDraft`] = setName;
        props[`${prefix}SearchQuery`] = query;
        props[`${prefix}SearchOpen`] = get(`${prefix}Open`, false);
        props[`${prefix}SearchIndex`] = index;
        props[`${prefix}SearchResults`] = results;
        props[`${prefix}SearchHidden`] = resultSet.total - results.length;
        props[`${prefix}SearchInputRef`] = refs[prefix];
        props[`set${cap}SearchQuery`] = set(`${prefix}Query`, '');
        props[`set${cap}SearchOpen`] = set(`${prefix}Open`, false);
        props[`set${cap}SearchIndex`] = set(`${prefix}Index`, 0);
        props[`handle${cap}SearchKeyDown`] = makeFieldKeyDown(results, index, props[`set${cap}SearchIndex`], setId, setName, props[`set${cap}SearchQuery`], props[`set${cap}SearchOpen`]);
    }

    const boardQuery = get('boardQuery', '');
    const setBoardId = value => patch(id, { scope: { boardId: resolve(value, entry.scope.boardId) } });
    const setBoardName = value => setSearch(id, 'boardName', resolve(value, boardName));
    Object.assign(props, {
        boardIdDraft: entry.scope.boardId,
        boardNameDraft: boardName || '',
        setBoardIdDraft: setBoardId,
        setBoardNameDraft: setBoardName,
        boardSearchQuery: boardQuery,
        boardSearchOpen: get('boardOpen', false),
        boardSearchIndex: get('boardIndex', 0),
        boardSearchRemoteLoading: boardLoading,
        boardSearchResults: boardResults,
        boardSearchInputRef: refs.board,
        setBoardSearchQuery: set('boardQuery', ''),
        setBoardSearchOpen: set('boardOpen', false),
        setBoardSearchIndex: set('boardIndex', 0),
        handleBoardSearchKeyDown: makeFieldKeyDown(boardResults, get('boardIndex', 0), set('boardIndex', 0), value => setBoardId(String(value)), value => setBoardName(value), set('boardQuery', ''), set('boardOpen', false)),
        clearBoardSelection: () => { setBoardId(''); setBoardName(''); set('boardQuery', '')(''); set('boardOpen', false)(false); },
    });

    const projectQuery = get('projectQuery', '');
    const projectIndex = get('projectIndex', 0);
    const addWithReset = (key, type) => {
        const added = addProject(id, key, type);
        if (added) { set('projectQuery', '')(''); set('projectOpen', false)(false); }
    };
    Object.assign(props, {
        classificationMode: rnd ? 'combined' : undefined,
        projectSearchQuery: projectQuery,
        projectSearchOpen: get('projectOpen', false),
        projectSearchIndex: projectIndex,
        projectSearchRemoteLoading: projectLoading,
        projectSearchResults: projectResults,
        projectSearchInputRef: refs.project,
        setProjectSearchQuery: set('projectQuery', ''),
        setProjectSearchOpen: set('projectOpen', false),
        setProjectSearchIndex: set('projectIndex', 0),
        handleProjectSearchKeyDown: event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (!projectResults.length) return;
                event.preventDefault();
                set('projectIndex', 0)(value => Math.max(0, Math.min(projectResults.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1))));
            } else if (event.key === 'Enter') {
                // Enter delegates to the same single-project rule as the mouse path, so a second
                // DELIVERY project is refused with the same message even when no result is listed.
                event.preventDefault();
                const pick = projectResults[projectIndex] || projectResults[0];
                if (rnd && entry.scope.projects.length >= 1) { addProject(id, pick?.key || '__none__', 'other'); return; }
                if (pick) addWithReset(pick.key);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                set('projectOpen', false)(false);
            }
        },
        selectedProjectsDraft: entry.scope.projects,
        resolveProjectName,
        addProjectSelection: (key, projectType) => addWithReset(key, rnd ? 'other' : projectType),
        removeProjectSelection: key => removeProject(id, key),
    });

    // Hierarchy rows: loading / error / resolved / unresolved states come from describeHierarchyRow.
    const catalogState = typeCatalog.state;
    const labels = hierarchyLabels(model);
    const legacyFilter = model === MODEL_LEGACY && Array.isArray(entry.legacyIssueTypeNames) ? entry.legacyIssueTypeNames : null;
    const typeById = Object.fromEntries((typeCatalog.types || []).map(type => [type.id, type]));
    const rows = slotsFor(model).map((slot, index) => describeHierarchyRow({ entry, slot, index, types: typeCatalog.types || [], catalogState }));
    const capturedMatches = legacyFilter?.length === 1 ? (typeCatalog.types || []).filter(type => type.name === legacyFilter[0]) : [];
    const emptyMessage = catalogState === 'ready'
        ? 'No matching issue types at this level. Types with unknown hierarchy levels are not selectable.'
        : catalogState === 'loading' ? 'Loading Jira issue types.'
            : catalogState === 'unscoped' ? 'Save a Jira project to load issue types.'
                : 'Could not load Jira issue types.';
    const hierarchyMappings = rows.map((row, index) => {
        const slot = slotsFor(model)[index];
        const retiresFilter = index === 0 && legacyFilter;
        const selected = retiresFilter ? (capturedMatches.length === 1 ? capturedMatches[0] : null) : row.selected;
        return {
            key: slot,
            label: row.label,
            required: index < 2,
            optional: index >= 2,
            selected,
            options: row.options,
            emptyMessage,
            status: row.status,
            helper: index === 0 ? `Story Points and Team are read from this ${labels[0]}; the Sprint field is set in Source.`
                : index === 1 ? 'Totals its child issues using the existing calculation rules.' : 'Jira parent context.',
            onSelect: option => (retiresFilter ? requestRetire({ pendingType: option.id }) : patch(id, { hierarchy: { [slot]: option.id } })),
            onRemove: () => (retiresFilter ? requestRetire({ pendingType: null }) : patch(id, { hierarchy: { [slot]: null } })),
            previewKey: index === 0 ? 'issueType' : index === 1 ? 'parent' : undefined,
        };
    });
    const planningId = entry.hierarchy.planningIssueTypeId;
    const parentId = entry.hierarchy.parentIssueTypeId;
    const child = capturedMatches[0] || (planningId ? typeById[planningId] : null);
    const parent = parentId ? typeById[parentId] : null;
    const fieldMapping = (key, name, label, helper) => ({
        key,
        label,
        optional: true,
        helper,
        selected: entry.fields[name]?.fieldId ? { id: entry.fields[name].fieldId, name: entry.fields[name].fieldName || entry.fields[name].fieldId } : null,
        options: jiraFields || [],
        onSelect: option => patch(id, { fields: { [name]: { fieldId: option.id, fieldName: option.name } } }),
        onRemove: () => patch(id, { fields: { [name]: { fieldId: '', fieldName: '' } } }),
    });
    Object.assign(props, {
        hierarchyMappings,
        issueTypesDraft: child ? [child.name] : (legacyFilter || []),
        extraFieldMappings: [
            fieldMapping('projectTrackField', 'projectTrack', 'Project Track', `Jira field on the ${parent?.name || parentLabel}.`),
            ...(rnd ? [fieldMapping('allocationField', 'allocation', 'RnD_allocation_category', 'Explicit Epic value, then Initiative, then Objective. Components remain separate.')] : []),
        ],
        mappingPreviewLabels: {
            childType: child?.name || 'Unmapped issue type',
            parentType: parent?.name || 'Unmapped parent type',
            childSummary: child ? `${child.name} Summary` : 'Select a Jira issue type',
            childKey: child ? `${child.name.toUpperCase().replaceAll(' ', '-')}-KEY` : 'UNMAPPED-KEY',
            parentKey: parent ? `${parent.name.toUpperCase()}-KEY` : 'UNMAPPED-PARENT',
            childHierarchyLevel: child?.hierarchyLevel,
            parentIconUrl: parent?.iconUrl || undefined,
            childIconUrl: child?.iconUrl || undefined,
            summary: child ? `${child.name} under ${parent?.name || 'an unmapped parent'}` : 'Mapping incomplete',
            description: child ? `Preview of ${child.name} under ${parent?.name || 'an unmapped parent'}.` : 'Incomplete mapping. Save is allowed; dependent views need configuration.',
        },
        mappingFieldHelpers: {
            parentName: `Field used to name the parent ${parent?.name || parentName}.`,
            storyPoints: `Estimate on the ${child?.name || childName}; rollups use the existing rules.`,
            team: `Team on the ${child?.name || childName}.`,
            deliveryOwner: `Delivery owner on the ${parent?.name || parentName}.`,
            requirement: REQUIREMENT[model],
        },
    });
    return props;
}

export const projectLimitReached = (entry, query) => entry.model === MODEL_RND
    && entry.scope.projects.length >= 1 && Boolean(String(query || '').trim());

export { DELIVERY_PROJECT_LIMIT_MESSAGE };
