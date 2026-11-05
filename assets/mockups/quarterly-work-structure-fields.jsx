// Synthetic, memory-only fixture using the actual Settings modal, scope, source and mapping forms.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import SettingsModal from '../../frontend/src/settings/SettingsModal.jsx';
import JiraFieldSettings from '../../frontend/src/settings/JiraFieldSettings.jsx';
import { makeFieldSearchResults, makeFieldKeyDown } from '../../frontend/src/settings/useJiraFieldPickers.js';

const FIELDS = [
    { id: 'customfield_19901', name: 'Sprint' },
    { id: 'customfield_19902', name: 'Story Points' },
    { id: 'customfield_19903', name: 'Epic Name' },
    { id: 'customfield_19904', name: 'Team' },
    { id: 'customfield_19905', name: 'Delivery Owner' },
    { id: 'customfield_19906', name: 'Summary' },
    { id: 'customfield_19907', name: 'RnD_allocation_category' },
    { id: 'customfield_19908', name: 'Project Track' },
];
const TYPES = [
    { id: '19001', name: 'Story', hierarchyLevel: 0 },
    { id: '19002', name: 'Epic', hierarchyLevel: 1 },
    { id: '19003', name: 'Initiative', hierarchyLevel: 2 },
    { id: '19004', name: 'Objective', hierarchyLevel: 3 },
    { id: '19005', name: 'Strategy', hierarchyLevel: 4 },
    { id: '19006', name: 'Custom Epic', hierarchyLevel: 1 },
    { id: '19007', name: 'Unknown hierarchy type', hierarchyLevel: null },
];
const PROJECTS = [
    { key: 'ROADMAP', name: 'Example roadmap' },
    { key: 'PLATFORM', name: 'Example platform' },
    { key: 'FOUNDATION', name: 'Example foundation' },
    { key: 'PLAN', name: 'Example delivery' },
];
const BOARDS = [
    { id: '7001', name: 'Legacy quarterly planning', type: 'scrum', projects: ['ROADMAP', 'PLATFORM', 'FOUNDATION'] },
    { id: '7002', name: 'Delivery quarterly planning', type: 'scrum', projects: ['PLAN'] },
];
const FIELD_SLOTS = [
    ['sprintField', 'sprint', 'Sprint'], ['storyPointsField', 'estimate', 'Story Points'],
    ['parentNameField', 'parent', 'Epic Name'], ['teamField', 'team', 'Team'],
    ['deliveryOwnerField', 'deliveryOwner', 'Delivery Owner'],
];
const TABS = [['scope', 'Scope'], ['source', 'Source'], ['mapping', 'Field mapping']];
const ADMIN_TABS = [['project', 'Project config'], ['capacity', 'Capacity'], ['priority', 'Priority weights'], ['access', 'Access'], ['performance', 'Performance']];
const SLOT_KEYS = ['planningIssueTypeId', 'parentIssueTypeId', 'ancestorIssueTypeId', 'optionalAncestorIssueTypeId'];
const resolve = (value, previous) => typeof value === 'function' ? value(previous) : value;
const upper = value => value[0].toUpperCase() + value.slice(1);
const field = name => FIELDS.find(item => item.name === name) || null;
const type = id => TYPES.find(item => item.id === id) || null;
const quarters = Array.from({ length: 24 }, (_, index) => `${2025 + Math.floor(index / 4)}Q${index % 4 + 1}`);
const quarterIndex = value => Number(value.slice(0, 4)) * 4 + Number(value.slice(-1)) - 1;
const validQuarter = value => value === null || (typeof value === 'string' && /^\d{4}Q[1-4]$/.test(value) && Number(value.slice(0, 4)) >= 1);
const rangeLabel = config => config.from && config.through ? `${config.from} → ${config.through}` : config.from ? `${config.from} onward` : config.through ? `Through ${config.through}` : 'All sprints';

function initialConfigurations(specimen = '') {
    const configs = [
        { id: 'legacy', name: 'Legacy', from: null, through: '2026Q4', model: 'legacy', classificationMode: 'projects', projects: [{ key: 'ROADMAP', type: 'product' }, { key: 'PLATFORM', type: 'tech' }, { key: 'FOUNDATION', type: 'tech' }], boardId: '7001', board: 'Legacy quarterly planning', hierarchy: Object.fromEntries(SLOT_KEYS.map((key, index) => [key, index < 3 ? TYPES[index].id : null])) },
        { id: 'delivery', name: 'DELIVERY', from: '2027Q1', through: null, model: 'rnd_2027', classificationMode: 'combined', projects: [{ key: 'PLAN', type: 'other' }], boardId: '7002', board: 'Delivery quarterly planning', hierarchy: Object.fromEntries(SLOT_KEYS.map((key, index) => [key, TYPES[index + 1].id])) },
    ].map(config => {
        for (const [prefix, key, fallback] of FIELD_SLOTS) {
            config[key] = prefix === 'parentNameField' && config.model === 'rnd_2027' ? 'Summary' : fallback;
            config[prefix + 'Id'] = field(config[key]).id;
        }
        if (config.model === 'legacy') { config.legacyIssueTypeNames = ['Story']; config.hierarchy.planningIssueTypeId = null; }
        config.projectTrackField = field('Project Track');
        config.allocationField = config.model === 'rnd_2027' ? field('RnD_allocation_category') : null;
        return config;
    });
    const legacy = configs.find(config => config.id === 'legacy'), delivery = configs.find(config => config.id === 'delivery');
    if (specimen === 'captured-multi') legacy.legacyIssueTypeNames = ['Story', 'Task'];
    if (specimen === 'captured-unrestricted') legacy.legacyIssueTypeNames = [];
    if (specimen === 'unresolved-type') delivery.hierarchy.planningIssueTypeId = '19999';
    if (specimen === 'blank-delivery') {
        delivery.projects = []; delivery.boardId = ''; delivery.board = '';
        delivery.hierarchy = Object.fromEntries(SLOT_KEYS.map(key => [key, null]));
        for (const [prefix, key] of FIELD_SLOTS) { delivery[key] = ''; delivery[prefix + 'Id'] = ''; }
        delivery.projectTrackField = null; delivery.allocationField = null;
    }
    return configs;
}

function validateConfigurations(configs) {
    const errors = Object.fromEntries(configs.map(config => [config.id, {}]));
    for (const config of configs) {
        if (!config.name.trim()) errors[config.id].name = 'Enter a configuration name.';
        else if (configs.some(other => other.id !== config.id && other.name.trim().toLowerCase() === config.name.trim().toLowerCase())) errors[config.id].name = 'Use a different name for each configuration.';
        for (const key of ['from', 'through']) if (!validQuarter(config[key])) errors[config.id][key] = 'Use YYYYQ1–YYYYQ4 with a calendar year from 0001 to 9999; no spaces or lowercase.';
        if (validQuarter(config.from) && validQuarter(config.through) && config.from && config.through && quarterIndex(config.from) > quarterIndex(config.through)) errors[config.id].through = 'End sprint must not precede start sprint.';
        if (config.model === 'rnd_2027' && config.projects.length > 1) errors[config.id].projects = 'DELIVERY uses one Jira project';
    }
    if (configs.every(config => !errors[config.id].from && !errors[config.id].through)) {
        const legacy = configs.find(config => config.id === 'legacy'), delivery = configs.find(config => config.id === 'delivery');
        const sorted = [...configs].sort((a, b) => (a.from ? quarterIndex(a.from) : -Infinity) - (b.from ? quarterIndex(b.from) : -Infinity));
        if (sorted[0].id !== 'legacy') {
            errors[legacy.id].from = 'Legacy must precede DELIVERY.';
            errors[delivery.id].from = 'Legacy must precede DELIVERY.';
        }
        if (sorted[0].from) errors[sorted[0].id].from ||= 'The first configuration must include all earlier sprints.';
        if (sorted.at(-1).through) errors[sorted.at(-1).id].through = 'The last configuration must have no end sprint.';
        for (let index = 1; index < sorted.length; index++) {
            const before = sorted[index - 1], after = sorted[index];
            const message = !before.through || !after.from || quarterIndex(after.from) <= quarterIndex(before.through)
                ? 'Sprint ranges overlap.' : quarterIndex(after.from) !== quarterIndex(before.through) + 1 ? 'Sprint ranges must meet without a gap.' : '';
            if (message) { errors[before.id].through ||= message; errors[after.id].from ||= message; }
        }
    }
    return errors;
}
function missingMappings(config) {
    const missing = [];
    if (!config.projects.length) missing.push('Jira project');
    if (config.boardId && !BOARDS.some(board => board.id === config.boardId && board.projects.some(key => config.projects.some(project => project.key === key)))) missing.push('Sprint Board outside selected projects');
    for (const [prefix, , label] of FIELD_SLOTS.slice(0, 2).concat([FIELD_SLOTS[3]])) {
        if (!config[prefix + 'Id']) missing.push(label);
        else if (!FIELDS.some(item => item.id === config[prefix + 'Id'])) missing.push(`${label} (not found in Jira)`);
    }
    const offset = config.model === 'rnd_2027' ? 1 : 0;
    SLOT_KEYS.slice(0, offset ? 4 : 3).forEach((key, index) => {
        const id = config.hierarchy[key], label = TYPES[index + offset].name;
        const capturedFilter = config.model === 'legacy' && index === 0 && Array.isArray(config.legacyIssueTypeNames);
        if ((!capturedFilter && index < 2 && !id) || (id && !type(id))) missing.push(id ? `${label} (${id}: not found in Jira)` : label);
    });
    return [...new Set(missing)];
}
const missingSummary = configs => configs.map(config => ({ config, missing: missingMappings(config) }))
    .filter(item => item.missing.length).map(({ config, missing }) => `${config.name || 'Unnamed configuration'}: missing ${missing.join(', ')}.`).join(' ');

function FixtureFields({ tab, configuration: draft, onPatch, technicalIds, onTechnicalIds, specimen, catalogState, onCatalogRetry }) {
    const [search, setSearch] = React.useState({});
    const [hover, setHover] = React.useState(null);
    const [retireFilter, setRetireFilter] = React.useState(false);
    const [pendingType, setPendingType] = React.useState(null);
    const [mappingSearch, setMappingSearch] = React.useState(null);
    const [previewOpen, setPreviewOpen] = React.useState(false);
    const typeCatalog = specimen === 'duplicate-types' ? [...TYPES, { id: '19008', name: 'Epic', hierarchyLevel: 1 }] : TYPES;
    const resolvedType = id => typeCatalog.find(item => item.id === id) || null;
    const catalogUnavailable = catalogState !== 'ready';
    const displayType = id => {
        const found = resolvedType(id);
        if (!id) return null;
        if (!found) return { id, name: `${id} · ${catalogState === 'loading' ? 'Loading Jira type' : catalogState === 'error' ? 'Jira catalog unavailable' : 'Not found in Jira'}` };
        return typeCatalog.filter(item => item.name === found.name).length > 1 ? { ...found, name: `${found.name} (${found.id})` } : found;
    };
    const refs = React.useRef(Object.fromEntries([...FIELD_SLOTS.map(([prefix]) => prefix), 'board', 'project'].map(prefix => [prefix, React.createRef()])));
    const change = patch => onPatch(patch);
    const setSearchValue = (key, value) => setSearch(previous => ({ ...previous, [key]: resolve(value, previous[key] ?? (key.endsWith('Open') ? false : key.endsWith('Index') ? 0 : '')) }));
    const props = {
        groupManageTab: tab, loadingFields: false, jiraFields: FIELDS, loadingProjects: false, jiraProjects: PROJECTS,
        showTechnicalFieldIds: technicalIds, setShowTechnicalFieldIds: value => onTechnicalIds(resolve(value, technicalIds)),
        mappingHoverKey: hover, setMappingHoverKey: setHover,
        mappingPreviewOpen: previewOpen, setMappingPreviewOpen: setPreviewOpen,
        sourceFieldHelpers: { board: 'If empty, list sprints already used by issues in the selected projects. Choose a board to include unused sprints.' },
    };
    for (const [prefix, nameKey] of FIELD_SLOTS) {
        const cap = upper(prefix), query = search[prefix + 'Query'] ?? '';
        const resultSet = makeFieldSearchResults(query, FIELDS), results = resultSet.items;
        props[prefix + 'NameDraft'] = draft[nameKey];
        props[prefix + 'IdDraft'] = draft[prefix + 'Id'];
        props['set' + cap + 'NameDraft'] = value => change(previous => ({ [nameKey]: resolve(value, previous[nameKey]) }));
        props['set' + cap + 'IdDraft'] = value => change(previous => ({ [prefix + 'Id']: resolve(value, previous[prefix + 'Id']) }));
        props[prefix + 'SearchQuery'] = query;
        props[prefix + 'SearchOpen'] = search[prefix + 'Open'] ?? false;
        props[prefix + 'SearchIndex'] = search[prefix + 'Index'] ?? 0;
        props[prefix + 'SearchResults'] = results;
        props[prefix + 'SearchHidden'] = resultSet.total - results.length;
        props[prefix + 'SearchInputRef'] = refs.current[prefix];
        for (const suffix of ['Query', 'Open', 'Index']) props['set' + cap + 'Search' + suffix] = value => setSearchValue(prefix + suffix, value);
        props['handle' + cap + 'SearchKeyDown'] = makeFieldKeyDown(results, props[prefix + 'SearchIndex'], props['set' + cap + 'SearchIndex'], props['set' + cap + 'IdDraft'], props['set' + cap + 'NameDraft'], props['set' + cap + 'SearchQuery'], props['set' + cap + 'SearchOpen']);
    }
    const boardQuery = search.boardQuery ?? '';
    const scopedBoards = BOARDS.filter(board => board.projects.some(key => draft.projects.some(project => project.key === key)));
    const boardResults = scopedBoards.filter(board => board.name.toLowerCase().includes(boardQuery.toLowerCase().trim()) || board.id.includes(boardQuery.trim()));
    Object.assign(props, {
        boardIdDraft: draft.boardId, boardNameDraft: draft.board,
        setBoardIdDraft: value => change(previous => ({ boardId: resolve(value, previous.boardId) })),
        setBoardNameDraft: value => change(previous => ({ board: resolve(value, previous.board) })),
        boardSearchQuery: boardQuery, boardSearchOpen: search.boardOpen ?? false, boardSearchIndex: search.boardIndex ?? 0,
        boardSearchRemoteLoading: false, boardSearchResults: boardResults, boardSearchInputRef: refs.current.board,
        setBoardSearchQuery: value => setSearchValue('boardQuery', value), setBoardSearchOpen: value => setSearchValue('boardOpen', value), setBoardSearchIndex: value => setSearchValue('boardIndex', value),
        handleBoardSearchKeyDown: makeFieldKeyDown(boardResults, search.boardIndex ?? 0, value => setSearchValue('boardIndex', value), value => change({ boardId: value }), value => change({ board: value }), value => setSearchValue('boardQuery', value), value => setSearchValue('boardOpen', value)),
        clearBoardSelection: () => { change({ boardId: '', board: '' }); setSearchValue('boardQuery', ''); setSearchValue('boardOpen', false); },
    });
    const projectQuery = search.projectQuery ?? '';
    const projectResults = draft.classificationMode === 'combined' && draft.projects.length ? [] : PROJECTS.filter(project => !draft.projects.some(selected => selected.key === project.key) && `${project.key} ${project.name}`.toLowerCase().includes(projectQuery.toLowerCase().trim()));
    const addProject = (key, projectType) => change(previous => ({ projects: previous.projects.some(project => project.key === key) || (previous.classificationMode === 'combined' && previous.projects.length) ? previous.projects : [...previous.projects, { key, type: projectType }] }));
    Object.assign(props, {
        classificationMode: draft.classificationMode === 'combined' ? 'combined' : undefined,
        projectSearchQuery: projectQuery, projectSearchOpen: search.projectOpen ?? false, projectSearchIndex: search.projectIndex ?? 0,
        projectSearchRemoteLoading: false, projectSearchResults: projectResults, projectSearchInputRef: refs.current.project,
        setProjectSearchQuery: value => setSearchValue('projectQuery', value), setProjectSearchOpen: value => setSearchValue('projectOpen', value), setProjectSearchIndex: value => setSearchValue('projectIndex', value),
        handleProjectSearchKeyDown: event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSearchValue('projectIndex', value => Math.max(0, Math.min(projectResults.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1)))); }
            if (event.key === 'Enter' && projectResults.length && draft.classificationMode === 'combined') { event.preventDefault(); addProject(projectResults[search.projectIndex ?? 0]?.key || projectResults[0].key, 'other'); setSearchValue('projectQuery', ''); setSearchValue('projectOpen', false); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSearchValue('projectOpen', false); }
        },
        selectedProjectsDraft: draft.projects, resolveProjectName: key => PROJECTS.find(project => project.key === key)?.name || key,
        addProjectSelection: (key, projectType) => { addProject(key, projectType); setSearchValue('projectQuery', ''); setSearchValue('projectOpen', false); },
        removeProjectSelection: key => change(previous => ({ projects: previous.projects.filter(project => project.key !== key) })),
    });
    const offset = draft.model === 'rnd_2027' ? 1 : 0;
    const capturedNames = Array.isArray(draft.legacyIssueTypeNames) ? draft.legacyIssueTypeNames : null;
    const capturedMatches = capturedNames?.length === 1 ? typeCatalog.filter(item => item.name === capturedNames[0]) : [];
    const capturedDisplay = capturedMatches.length === 1 ? capturedMatches[0] : null;
    const hierarchyMappings = SLOT_KEYS.slice(0, offset ? 4 : 3).map((key, index) => ({
        key, label: TYPES[index + offset].name, optional: index >= 2,
        selected: index === 0 && capturedNames ? capturedDisplay : displayType(draft.hierarchy[key]), options: catalogUnavailable ? [] : typeCatalog.filter(item => Number.isInteger(item.hierarchyLevel) && item.hierarchyLevel === index + offset),
        helper: index === 0 ? 'Read Story Points, Team and Sprint from this Jira issue type.' : index === 1 ? 'Sum the child issues using the existing calculation rules.' : 'Jira parent context.',
        onSelect: selected => {
            if (index === 0 && capturedNames) { setPendingType(selected.id); setRetireFilter(true); }
            else change(previous => ({ hierarchy: { ...previous.hierarchy, [key]: selected.id } }));
        },
        onRemove: () => {
            if (index === 0 && draft.model === 'legacy' && Array.isArray(draft.legacyIssueTypeNames)) { setPendingType(null); setRetireFilter(true); }
            else change(previous => ({ hierarchy: { ...previous.hierarchy, [key]: null } }));
        },
        previewKey: index === 0 ? 'issueType' : index === 1 ? 'parent' : undefined,
    }));
    const child = capturedDisplay || resolvedType(draft.hierarchy.planningIssueTypeId), parent = resolvedType(draft.hierarchy.parentIssueTypeId);
    Object.assign(props, {
        hierarchyMappings, issueTypesDraft: child ? [child.name] : [],
        extraFieldMappings: [
            { key: 'projectTrackField', label: 'Project Track', helper: `Jira field on the ${parent?.name || 'parent issue'}.`, selected: draft.projectTrackField, options: FIELDS },
            ...(draft.model === 'rnd_2027' ? [{ key: 'allocationField', label: 'RnD_allocation_category', helper: 'Explicit Epic value, then Initiative, then Objective. Components remain separate.', selected: draft.allocationField, options: FIELDS }] : []),
        ].map(mapping => ({ ...mapping, onSelect: selected => change({ [mapping.key]: selected }), onRemove: () => change({ [mapping.key]: null }) })),
        mappingPreviewLabels: {
            childType: child?.name || 'Unmapped issue type', parentType: parent?.name || 'Unmapped parent type',
            childSummary: child ? `${child.name} Summary` : 'Select a Jira issue type', childKey: child ? `${child.name.toUpperCase().replaceAll(' ', '-')}-KEY` : 'UNMAPPED-KEY', parentKey: parent ? `${parent.name.toUpperCase()}-KEY` : 'UNMAPPED-PARENT',
            summary: child ? `${child.name} under ${parent?.name || 'an unmapped parent'}` : 'Mapping incomplete', childHierarchyLevel: child?.hierarchyLevel, description: child ? `Preview of ${child.name} under ${parent?.name || 'an unmapped parent'}.` : 'Incomplete mapping. Save is allowed; dependent views need configuration.',
        },
        mappingFieldHelpers: { parentName: `Field used to name the parent ${parent?.name || 'issue'}.`, storyPoints: `Estimate on the ${child?.name || 'mapped issue'}; rollups use the existing rules.`, team: `Team on the ${child?.name || 'mapped issue'}.`, deliveryOwner: `Delivery owner on the ${parent?.name || 'parent issue'}.` },
    });
    const limitedProjectSearch = tab === 'scope' && draft.classificationMode === 'combined' && draft.projects.length === 1 && Boolean(projectQuery.trim());
    const activeMapping = hierarchyMappings.find(mapping => mapping.key === mappingSearch?.key);
    const noTypeMatches = tab === 'mapping' && catalogState === 'ready' && activeMapping && mappingSearch?.query.trim()
        && !makeFieldSearchResults(mappingSearch.query, activeMapping.options).total;
    return <div data-real-jira-settings data-project-limit={limitedProjectSearch || undefined} onChangeCapture={event => {
        const row = event.target.closest('[data-mapping-key]');
        if (row) setMappingSearch({ key: row.dataset.mappingKey, query: event.target.value });
    }}>
        {limitedProjectSearch && <p className="group-field-helper" role="status" data-project-limit-message>DELIVERY uses one Jira project</p>}
        {tab === 'mapping' && draft.model === 'legacy' && Array.isArray(draft.legacyIssueTypeNames) && <div className="group-projects-subsection" data-captured-filter>
            <div className="team-selector-label">Captured issue-type filter</div>
            <div className="group-field-helper">{draft.legacyIssueTypeNames.length ? draft.legacyIssueTypeNames.join(', ') : 'All issue types (unrestricted)'}. This captured filter stays in effect until you explicitly change the mapping below.</div>
            <div className="selected-team-chip"><span className="team-name">{draft.legacyIssueTypeNames.length ? draft.legacyIssueTypeNames.join(', ') : 'All issue types'}</span><button type="button" className="remove-btn" aria-label="Change captured issue-type filter" title="Change captured issue-type filter" onClick={() => { setPendingType(null); setRetireFilter(true); }}>×</button></div>
        </div>}
        {tab === 'mapping' && catalogUnavailable && <div className="group-modal-warning" role="status" data-catalog-state={catalogState}>
            Synthetic specimen · {catalogState === 'loading' ? 'Loading Jira issue types. Saved IDs are preserved.' : 'Could not load Jira issue types. Saved IDs are preserved.'}
            {catalogState === 'error' && <button type="button" className="secondary compact" onClick={onCatalogRetry}>Retry Jira catalog</button>}
        </div>}
        {noTypeMatches && <div className="group-modal-warning" role="status" data-picker-feedback>Synthetic specimen · {activeMapping.label}: No matching issue types at this level. Types with unknown hierarchy levels are not selectable.</div>}
        {tab === 'mapping' && <p className="group-field-helper" data-field-context-note>Field types and issue contexts need verification by Test configuration. This synthetic fixture does not verify Jira metadata or access.</p>}
        <fieldset className="team-catalog-edit-lock" disabled={tab === 'mapping' && catalogUnavailable}><JiraFieldSettings {...props} /></fieldset>
        {retireFilter && <div className="group-confirm-backdrop" role="alertdialog" aria-label="Change captured issue-type filter?" onClick={() => setRetireFilter(false)}>
            <div className="group-confirm" onClick={event => event.stopPropagation()}><div className="group-confirm-title">Change captured issue-type filter?</div>
                <p className="group-field-helper">This retires the captured {draft.legacyIssueTypeNames.length ? draft.legacyIssueTypeNames.join(', ') : 'unrestricted'} filter for every Legacy sprint. Select the replacement Jira mapping after confirming.</p>
                <div className="group-confirm-actions"><button type="button" className="secondary compact" onClick={() => setRetireFilter(false)}>Keep captured filter</button><button type="button" className="compact" onClick={() => { change(previous => ({ legacyIssueTypeNames: null, hierarchy: { ...previous.hierarchy, planningIssueTypeId: pendingType } })); setRetireFilter(false); }}>Change mapping</button></div>
            </div>
        </div>}
    </div>;

}

function SprintRanges({ config, errors, onPatch }) {
    const [editing, setEditing] = React.useState({});
    return <div data-ranges><p className="group-field-helper">Each quarter is one Jira Sprint; move the shared boundary by changing Legacy’s end quarter and DELIVERY’s start quarter together.</p>{[['from', 'Start quarter', 'All earlier quarters'], ['through', 'End quarter', 'No end']].map(([key, label, empty]) => <div data-range-row key={key}>
        <span className="team-selector-label">{label}</span>
        {editing[key] ? <input className="group-name-input" aria-label={label} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${config.id}-${key}-error` : undefined} list={`mockup-quarters-${config.id}`} placeholder="YYYYQn" value={config[key] || ''} onChange={event => onPatch({ [key]: event.target.value || null })} /> : <span className="selected-team-chip"><span className="team-name">{config[key] || empty}</span></span>}
        <button type="button" className="secondary compact" aria-label={`Change ${label.toLowerCase()}`} onClick={() => setEditing(previous => ({ ...previous, [key]: !previous[key] }))}>{editing[key] ? 'Done' : 'Change'}</button>
        {errors[key] && <span id={`${config.id}-${key}-error`} className="group-modal-warning" data-range-error>{errors[key]}</span>}
    </div>)}<datalist id={`mockup-quarters-${config.id}`}>{quarters.map(value => <option key={value} value={value} />)}</datalist></div>;
}

function Mockup() {
    const params = new URLSearchParams(location.search);
    const initialTab = TABS.some(([key]) => key === params.get('section')) ? params.get('section') : 'scope';
    const specimen = params.get('specimen') || '';
    const [configs, setConfigs] = React.useState(() => initialConfigurations(specimen));
    const [saved, setSaved] = React.useState(() => initialConfigurations(specimen));
    const [activeId, setActiveId] = React.useState(params.get('configuration') === 'delivery' ? 'delivery' : 'legacy');
    const [admin, setAdmin] = React.useState(ADMIN_TABS.some(([key]) => key === params.get('admin')) ? params.get('admin') : 'project');
    const [tabs, setTabs] = React.useState({ legacy: initialTab, delivery: initialTab });
    const [technicalIds, setTechnicalIds] = React.useState(false);
    const [drawer, setDrawer] = React.useState(false);
    const [open, setOpen] = React.useState(true);
    const [discard, setDiscard] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [messageKind, setMessageKind] = React.useState('');
    const [catalogState, setCatalogState] = React.useState(specimen === 'type-loading' ? 'loading' : specimen === 'type-error' ? 'error' : 'ready');
    const nameFocusValues = React.useRef(new Map());
    const config = configs.find(item => item.id === activeId), tab = tabs[activeId];
    const errors = validateConfigurations(configs);
    const validationMessages = [...new Set(configs.flatMap(item => Object.values(errors[item.id]).map(error => `${item.name.trim() || 'Configuration'}: ${error}`)))];
    const dirty = configs.filter((item, index) => JSON.stringify(item) !== JSON.stringify(saved[index]));
    const patch = (id, update) => { setMessage(''); setConfigs(previous => previous.map(item => item.id === id ? { ...item, ...(typeof update === 'function' ? update(item) : update) } : item)); };
    const requestClose = () => dirty.length ? setDiscard(true) : setOpen(false);
    const changeConfig = id => { setActiveId(id); setDrawer(false); if (messageKind !== 'save') setMessage(''); };
    React.useEffect(() => { document.getElementById('settings-panel')?.scrollTo(0, 0); }, [activeId, tab]);
    React.useEffect(() => {
        const url = new URL(location.href);
        for (const key of ['variant', 'profile', 'component']) url.searchParams.delete(key);
        url.searchParams.set('configuration', activeId); url.searchParams.set('section', tab); url.searchParams.set('admin', admin);
        history.replaceState(null, '', url);
    }, [activeId, tab, admin]);
    const selectTab = (id, kind) => { if (messageKind !== 'save') setMessage(''); if (kind === 'admin') setAdmin(id); else setTabs(previous => ({ ...previous, [activeId]: id })); };
    const tabKeys = (event, rows, current, kind) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (rows.findIndex(([key]) => key === current) + (event.key === 'ArrowRight' ? 1 : -1) + rows.length) % rows.length;
        selectTab(rows[index][0], kind);
        requestAnimationFrame(() => document.getElementById(`${kind}-tab-${rows[index][0]}`)?.focus());
    };
    return <>
        <main className="container" aria-hidden={open}><header><h1>Jira Delivery Planner</h1><p className="group-modal-meta">Planning · Example department · 2026Q4</p><button type="button" className="secondary compact" onClick={() => { setMessage(''); setOpen(true); }}>Settings</button></header></main>
        {open && <SettingsModal title="Settings" activeTab="admin" tabs={['Departments', 'EPM', 'Connections', 'Admin'].map(label => ({ id: label.toLowerCase(), label, disabled: label !== 'Admin' }))}
            isDirty={Boolean(dirty.length)} unsavedSectionsCount={dirty.length ? 1 : 0} onRequestClose={requestClose} onCancel={requestClose}
            showDiscardConfirm={discard} onKeepEditing={() => setDiscard(false)} onDiscard={() => { setConfigs(structuredClone(saved)); setDiscard(false); setOpen(false); setMessage(''); }}
            validationMessages={validationMessages} showSave saveDisabled={!dirty.length || validationMessages.length > 0}
            onSave={() => { setSaved(structuredClone(configs)); setMessageKind('save'); const missing = missingSummary(configs); setMessage(`Saved in this preview only. ${missing ? `Incomplete mappings — ${missing} ` : ''}No application configuration changed.`); }}
            showTestConfiguration={admin === 'project'} onTestConfiguration={() => {
                setMessageKind('test');
                if (dirty.length) { setMessage('Save your changes before testing the saved configuration.'); return; }
                if (catalogState !== 'ready') { setMessage(`${config.name}: Jira issue-type catalog is ${catalogState}; saved IDs have not been resolved. Synthetic specimen only.`); return; }
                const selected = saved.find(item => item.id === activeId), missing = missingMappings(selected);
                setMessage(missing.length ? `${selected.name}: saved configuration is incomplete — missing ${missing.join(', ')}. No Jira request was made.` : `${selected.name}: saved synthetic mappings are populated. Live Jira access and field contexts have not been tested.`);
            }} testConfigurationMessage={message || 'Mockup · synthetic data only'}>
            <nav className="group-modal-tabs epm-settings-tabs" id="admin-tabs" role="tablist" aria-label="Admin settings sections">{ADMIN_TABS.map(([key, label]) => <button key={key} type="button" className={`group-modal-tab ${admin === key ? 'active' : ''}`} role="tab" id={`admin-tab-${key}`} aria-selected={admin === key} aria-controls={key === 'project' ? 'project-config-panel' : 'workspace-panel'} tabIndex={admin === key ? 0 : -1} onClick={() => selectTab(key, 'admin')} onKeyDown={event => tabKeys(event, ADMIN_TABS, admin, 'admin')}>{label}</button>)}</nav>
            <div className="group-modal-body group-modal-split" id="project-config-panel" hidden={admin !== 'project'}>
                <aside className={`group-pane group-pane-left ${drawer ? 'is-mobile-active' : ''}`} id="configurations" aria-label="Project configurations">
                    <div className="group-pane-header"><div className="group-pane-title">Configurations</div><div className="group-pane-count">{configs.length} configurations</div><button type="button" className="group-pane-mobile-close" onClick={() => setDrawer(false)}>Back</button></div>
                    <div className="group-pane-list">{configs.map(item => <div key={item.id} className={`group-list-item ${item.id === activeId ? 'active' : ''}`} data-config={item.id} onClick={() => { if (item.id !== activeId) changeConfig(item.id); }}>
                        {item.id === activeId ? <input className="group-list-name-input" placeholder="Configuration name" aria-label="Configuration name" aria-invalid={Boolean(errors[item.id].name)} aria-describedby={errors[item.id].name ? `${item.id}-name-error` : undefined} value={item.name} onClick={event => event.stopPropagation()} onFocus={() => nameFocusValues.current.set(item.id, item.name)} onChange={event => patch(item.id, { name: event.target.value })}
                            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); patch(item.id, { name: nameFocusValues.current.get(item.id) ?? item.name }); } if (event.key === 'Enter' && !errors[item.id].name) { event.preventDefault(); patch(item.id, { name: item.name.trim() }); } }}
                            onBlur={event => { if (!errors[item.id].name) patch(item.id, { name: event.currentTarget.value.trim() }); }} /> : <button type="button" className="group-list-select" onClick={() => changeConfig(item.id)}><span className="group-list-name">{item.name || 'Unnamed configuration'}</span></button>}
                        <div className="group-list-line group-list-meta-line"><span className="group-list-dot">·</span><span className="group-list-meta">{rangeLabel(item)}</span></div>
                        {item.id === activeId && errors[item.id].name && <span id={`${item.id}-name-error`} className="group-list-name-error" role="alert">{errors[item.id].name}</span>}
                    </div>)}</div>
                    <div className="group-field-helper" data-configuration-summary>The viewed sprint selects the configuration automatically.</div>
                </aside>
                <section className="group-pane group-pane-right" id="editor" aria-label="Selected configuration">
                    <div className="group-pane-mobile-header"><button type="button" className="secondary compact" onClick={() => setDrawer(true)}>Configurations</button><span className="group-pane-mobile-title">{config.name}</span></div>
                    <div id="configuration-header"><div data-header-row><h2 className="group-pane-title" title={config.name}>{config.name || 'Unnamed configuration'}</h2><label className="group-visible-control"><input type="checkbox" checked={technicalIds} onChange={event => setTechnicalIds(event.target.checked)} /><span>Jira IDs</span></label></div><div className="group-field-helper">Changes affect every sprint in this range. Earlier views read live Jira data; they are not snapshots.</div></div>
                    <nav className="group-modal-tabs epm-settings-tabs" id="tabs" role="tablist" aria-label="Configuration sections" data-config-tabs>{TABS.map(([key, label]) => <button type="button" key={key} id={`configuration-tab-${key}`} className={`group-modal-tab ${tab === key ? 'active' : ''}`} role="tab" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} aria-controls={`panel-${activeId}-${key}`} onClick={() => selectTab(key, 'configuration')} onKeyDown={event => tabKeys(event, TABS, tab, 'configuration')}>{label}</button>)}</nav>
                    <div id="settings-panel">{specimen === 'blank-delivery' && activeId === 'delivery' && <div className="group-modal-warning" data-setup-guidance>Saving affects all sprints from 2027Q1 onward. DELIVERY is incomplete: select its Jira project, Source and required mappings before using those views. This specimen changes no application configuration.</div>}{configs.flatMap(item => TABS.map(([section]) => <div key={`${item.id}-${section}`} id={`panel-${item.id}-${section}`} role="tabpanel" aria-labelledby={`configuration-tab-${section}`} data-fixture-panel data-configuration={item.id} data-section={section} data-model={item.model} hidden={item.id !== activeId || section !== tab}>
                        {section === 'scope' && <SprintRanges config={item} errors={errors[item.id]} onPatch={update => patch(item.id, update)} />}
                        <FixtureFields tab={section} configuration={item} technicalIds={technicalIds} onTechnicalIds={setTechnicalIds} onPatch={update => patch(item.id, update)} specimen={specimen} catalogState={catalogState} onCatalogRetry={() => setCatalogState('ready')} />
                    </div>))}</div>
                </section>
            </div>
            {message && admin !== 'project' && <p className="group-field-helper" role="status" data-save-feedback>{message}</p>}
            <section className="group-pane group-projects-pane-right group-single-pane" id="workspace-panel" role="tabpanel" aria-labelledby={`admin-tab-${admin}`} hidden={admin === 'project'}><h2 className="group-pane-title">{ADMIN_TABS.find(([key]) => key === admin)?.[1]}</h2><p className="group-projects-desc">Workspace settings · shared across all project configurations.</p><p className="group-field-helper">The existing workspace panel stays at this level. This fixture demonstrates Project config; it does not edit workspace capacity, weights, access or performance.</p></section>
        </SettingsModal>}
    </>;
}

createRoot(document.getElementById('work-structure-mockup')).render(<Mockup />);
