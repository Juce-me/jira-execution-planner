// Fixture controller only. Source and Field mapping are rendered by the unchanged production component.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import JiraFieldSettings from '../../frontend/src/settings/JiraFieldSettings.jsx';
import { makeFieldSearchResults, makeFieldKeyDown } from '../../frontend/src/settings/useJiraFieldPickers.js';

const FIELDS = [
    { id: 'customfield_19901', name: 'Sprint' },
    { id: 'customfield_19902', name: 'Story Points' },
    { id: 'customfield_19903', name: 'Epic Name' },
    { id: 'customfield_19904', name: 'Team' },
    { id: 'customfield_19905', name: 'Delivery Owner' },
    { id: 'customfield_19906', name: 'Summary' },
];
const BOARDS = [
    { id: '7001', name: 'Legacy quarterly planning', type: 'scrum' },
    { id: '7002', name: 'Delivery quarterly planning', type: 'scrum' },
];
const FIELD_SLOTS = [
    ['sprintField', 'sprint', 'Sprint'],
    ['storyPointsField', 'estimate', 'Story Points'],
    ['parentNameField', 'parent', 'Epic Name'],
    ['teamField', 'team', 'Team'],
    ['deliveryOwnerField', 'deliveryOwner', 'Delivery Owner'],
];
const upper = value => value[0].toUpperCase() + value.slice(1);
const resolve = (value, previous) => typeof value === 'function' ? value(previous) : value;

function FixtureFields({ tab, configuration, onChange, technicalIds, onTechnicalIds }) {
    const [draft, setDraft] = React.useState(() => structuredClone(configuration));
    const [search, setSearch] = React.useState({});
    const [hover, setHover] = React.useState(null);
    const [showIds, setShowIds] = React.useState(technicalIds);
    const refs = React.useRef(Object.fromEntries([...FIELD_SLOTS.map(([prefix]) => prefix), 'board', 'issueType'].map(prefix => [prefix, React.createRef()])));
    const change = patch => setDraft(previous => {
        const next = { ...previous, ...(typeof patch === 'function' ? patch(previous) : patch) };
        onChange(next);
        return next;
    });
    const setSearchValue = (key, value) => setSearch(previous => ({ ...previous, [key]: resolve(value, previous[key] ?? (key.endsWith('Open') ? false : key.endsWith('Index') ? 0 : '')) }));
    const props = {
        groupManageTab: tab,
        loadingFields: false,
        jiraFields: FIELDS,
        loadingProjects: false,
        jiraProjects: [],
        showTechnicalFieldIds: showIds,
        setShowTechnicalFieldIds: value => setShowIds(previous => {
            const next = resolve(value, previous);
            onTechnicalIds(next);
            return next;
        }),
        mappingHoverKey: hover,
        setMappingHoverKey: setHover,
    };
    for (const [prefix, nameKey, fallback] of FIELD_SLOTS) {
        const cap = upper(prefix);
        const defaultName = prefix === 'parentNameField' && draft.model === 'delivery' ? 'Summary' : fallback;
        const fieldName = draft[nameKey] ?? defaultName;
        const fieldId = draft[prefix + 'Id'] ?? (FIELDS.find(field => field.name === fieldName)?.id || '');
        const query = search[prefix + 'Query'] ?? '';
        const resultSet = makeFieldSearchResults(query, FIELDS);
        const results = resultSet.items;
        props[prefix + 'NameDraft'] = fieldName;
        props[prefix + 'IdDraft'] = fieldId;
        props['set' + cap + 'NameDraft'] = value => change(previous => ({ [nameKey]: resolve(value, previous[nameKey] ?? defaultName) }));
        props['set' + cap + 'IdDraft'] = value => change(previous => ({ [prefix + 'Id']: resolve(value, previous[prefix + 'Id'] ?? fieldId) }));
        props[prefix + 'SearchQuery'] = query;
        props[prefix + 'SearchOpen'] = search[prefix + 'Open'] ?? false;
        props[prefix + 'SearchIndex'] = search[prefix + 'Index'] ?? 0;
        props[prefix + 'SearchResults'] = results;
        props[prefix + 'SearchHidden'] = resultSet.total - results.length;
        props[prefix + 'SearchInputRef'] = refs.current[prefix];
        for (const suffix of ['Query', 'Open', 'Index']) props['set' + cap + 'Search' + suffix] = value => setSearchValue(prefix + suffix, value);
        props['handle' + cap + 'SearchKeyDown'] = makeFieldKeyDown(results, search[prefix + 'Index'] ?? 0, props['set' + cap + 'SearchIndex'], props['set' + cap + 'IdDraft'], props['set' + cap + 'NameDraft'], props['set' + cap + 'SearchQuery'], props['set' + cap + 'SearchOpen']);
    }
    const boardQuery = search.boardQuery ?? '';
    const boardResults = BOARDS.filter(board => board.name.toLowerCase().includes(boardQuery.toLowerCase().trim()) || board.id.includes(boardQuery.trim())).slice(0, 20);
    Object.assign(props, {
        boardIdDraft: draft.boardId ?? (draft.id === 'legacy' ? '7001' : '7002'),
        boardNameDraft: draft.board ?? '',
        setBoardIdDraft: value => change(previous => ({ boardId: resolve(value, previous.boardId) })),
        setBoardNameDraft: value => change(previous => ({ board: resolve(value, previous.board) })),
        boardSearchQuery: boardQuery,
        boardSearchOpen: search.boardOpen ?? false,
        boardSearchIndex: search.boardIndex ?? 0,
        boardSearchRemoteLoading: false,
        boardSearchResults: boardResults,
        boardSearchInputRef: refs.current.board,
        setBoardSearchQuery: value => setSearchValue('boardQuery', value),
        setBoardSearchOpen: value => setSearchValue('boardOpen', value),
        setBoardSearchIndex: value => setSearchValue('boardIndex', value),
        handleBoardSearchKeyDown: makeFieldKeyDown(boardResults, search.boardIndex ?? 0, value => setSearchValue('boardIndex', value), value => change({ boardId: value }), value => change({ board: value }), value => setSearchValue('boardQuery', value), value => setSearchValue('boardOpen', value)),
        clearBoardSelection: () => {
            change({ boardId: '', board: '' });
            setSearchValue('boardQuery', '');
            setSearchValue('boardOpen', false);
        },
    });
    const issueQuery = search.issueTypeQuery ?? '';
    const selectedTypes = draft.issueTypes ?? [draft.model === 'delivery' ? 'Epic' : 'Story'];
    const issueTypes = ['Story', 'Epic'].filter(name => !selectedTypes.includes(name) && name.toLowerCase().includes(issueQuery.toLowerCase().trim())).map(name => ({ id: name, name }));
    const selectIssueType = name => {
        change({ issueTypes: [name], model: name === 'Epic' ? 'delivery' : 'legacy' });
        setSearchValue('issueTypeQuery', '');
        setSearchValue('issueTypeOpen', false);
    };
    Object.assign(props, {
        issueTypesDraft: draft.issueTypes ?? [draft.model === 'delivery' ? 'Epic' : 'Story'],
        issueTypeSearchQuery: issueQuery,
        issueTypeSearchOpen: search.issueTypeOpen ?? false,
        issueTypeSearchIndex: search.issueTypeIndex ?? 0,
        issueTypeSearchResults: issueTypes,
        issueTypeSearchInputRef: refs.current.issueType,
        setIssueTypeSearchQuery: value => setSearchValue('issueTypeQuery', value),
        setIssueTypeSearchOpen: value => setSearchValue('issueTypeOpen', value),
        setIssueTypeSearchIndex: value => setSearchValue('issueTypeIndex', value),
        handleIssueTypeSearchKeyDown: makeFieldKeyDown(issueTypes, search.issueTypeIndex ?? 0, value => setSearchValue('issueTypeIndex', value), () => {}, selectIssueType, value => setSearchValue('issueTypeQuery', value), value => setSearchValue('issueTypeOpen', value)),
        addIssueType: selectIssueType,
        removeIssueType: () => change({ issueTypes: [] }),
    });
    return <JiraFieldSettings {...props} />;
}

window.prepareActualSettingsMockup = configuration => {
    const draft = structuredClone(configuration);
    for (const [prefix, nameKey, fallback] of FIELD_SLOTS) {
        draft[nameKey] ??= prefix === 'parentNameField' && draft.model === 'delivery' ? 'Summary' : fallback;
        draft[prefix + 'Id'] ??= FIELDS.find(field => field.name === draft[nameKey])?.id || '';
    }
    draft.issueTypes ??= [draft.model === 'delivery' ? 'Epic' : 'Story'];
    draft.boardId ??= draft.id === 'legacy' ? '7001' : '7002';
    return draft;
};
let mountedRoot = null;
window.unmountActualJiraSettings = () => {
    if (mountedRoot) mountedRoot.unmount();
    mountedRoot = null;
};
window.mountActualJiraSettings = (element, options) => {
    window.unmountActualJiraSettings();
    mountedRoot = createRoot(element);
    mountedRoot.render(<FixtureFields {...options} />);
};
