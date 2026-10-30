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
];
const PROJECTS = [
    { key: 'ROADMAP', name: 'Example roadmap' },
    { key: 'PLATFORM', name: 'Example platform' },
    { key: 'FOUNDATION', name: 'Example foundation' },
    { key: 'DELIVERY', name: 'Example delivery' },
];
const BOARDS = [
    { id: '7001', name: 'Legacy quarterly planning', type: 'scrum', projects: ['ROADMAP', 'PLATFORM', 'FOUNDATION'] },
    { id: '7002', name: 'Delivery quarterly planning', type: 'scrum', projects: ['DELIVERY'] },
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
const validQuarter = value => value === null || /^\d{4}Q[1-4]$/.test(value);
const rangeLabel = config => config.from && config.through ? `${config.from} → ${config.through}` : config.from ? `${config.from} onward` : config.through ? `Through ${config.through}` : 'All sprints';

function initialConfigurations() {
    return [
        { id: 'legacy', name: 'Legacy', from: null, through: '2026Q4', model: 'legacy', classificationMode: 'projects', projects: [{ key: 'ROADMAP', type: 'product' }, { key: 'PLATFORM', type: 'tech' }, { key: 'FOUNDATION', type: 'tech' }], boardId: '7001', board: 'Legacy quarterly planning', hierarchy: Object.fromEntries(SLOT_KEYS.map((key, index) => [key, index < 3 ? TYPES[index].id : null])) },
        { id: 'delivery', name: 'DELIVERY', from: '2027Q1', through: null, model: 'rnd_2027', classificationMode: 'combined', projects: [{ key: 'DELIVERY', type: 'other' }], boardId: '7002', board: 'Delivery quarterly planning', hierarchy: Object.fromEntries(SLOT_KEYS.map((key, index) => [key, TYPES[index + 1].id])) },
    ].map(config => {
        for (const [prefix, key, fallback] of FIELD_SLOTS) {
            config[key] = prefix === 'parentNameField' && config.model === 'rnd_2027' ? 'Summary' : fallback;
            config[prefix + 'Id'] = field(config[key]).id;
        }
        config.projectTrackField = field('Project Track');
        config.allocationField = config.model === 'rnd_2027' ? field('RnD_allocation_category') : null;
        return config;
    });
}

function validateConfigurations(configs) {
    const errors = Object.fromEntries(configs.map(config => [config.id, {}]));
    for (const config of configs) {
        if (!config.name.trim()) errors[config.id].name = 'Enter a configuration name.';
        else if (configs.some(other => other.id !== config.id && other.name.trim().toLowerCase() === config.name.trim().toLowerCase())) errors[config.id].name = 'Use a different name for each configuration.';
        for (const key of ['from', 'through']) if (!validQuarter(config[key])) errors[config.id][key] = 'Use YYYYQ1, YYYYQ2, YYYYQ3 or YYYYQ4.';
        if (validQuarter(config.from) && validQuarter(config.through) && config.from && config.through && quarterIndex(config.from) > quarterIndex(config.through)) errors[config.id].through = 'End sprint must not precede start sprint.';
    }
    if (configs.every(config => !errors[config.id].from && !errors[config.id].through)) {
        const sorted = [...configs].sort((a, b) => (a.from ? quarterIndex(a.from) : -Infinity) - (b.from ? quarterIndex(b.from) : -Infinity));
        if (sorted[0].from) errors[sorted[0].id].from = 'The first configuration must include all earlier sprints.';
        if (sorted.at(-1).through) errors[sorted.at(-1).id].through = 'The last configuration must have no end sprint.';
        for (let index = 1; index < sorted.length; index++) {
            const before = sorted[index - 1], after = sorted[index];
            if (!before.through || !after.from || quarterIndex(after.from) <= quarterIndex(before.through)) errors[after.id].from = 'Sprint ranges overlap.';
            else if (quarterIndex(after.from) !== quarterIndex(before.through) + 1) errors[after.id].from = 'Sprint ranges must meet without a gap.';
        }
    }
    return errors;
}
function missingMappings(config) {
    const missing = [];
    if (!config.projects.length) missing.push('Jira project');
    if (config.boardId && !BOARDS.some(board => board.id === config.boardId && board.projects.some(key => config.projects.some(project => project.key === key)))) missing.push('Sprint Board outside selected projects');
    for (const [prefix, , label] of FIELD_SLOTS.slice(0, 2).concat([FIELD_SLOTS[3]])) if (!config[prefix + 'Id']) missing.push(label);
    for (const key of SLOT_KEYS.slice(0, 2)) if (!config.hierarchy[key]) missing.push('Jira issue-type mapping');
    return missing;
}

function FixtureFields({ tab, configuration: draft, onPatch, technicalIds, onTechnicalIds }) {
    const [search, setSearch] = React.useState({});
    const [hover, setHover] = React.useState(null);
    const refs = React.useRef(Object.fromEntries([...FIELD_SLOTS.map(([prefix]) => prefix), 'board', 'project'].map(prefix => [prefix, React.createRef()])));
    const change = patch => onPatch(patch);
    const setSearchValue = (key, value) => setSearch(previous => ({ ...previous, [key]: resolve(value, previous[key] ?? (key.endsWith('Open') ? false : key.endsWith('Index') ? 0 : '')) }));
    const props = {
        groupManageTab: tab, loadingFields: false, jiraFields: FIELDS, loadingProjects: false, jiraProjects: PROJECTS,
        showTechnicalFieldIds: technicalIds, setShowTechnicalFieldIds: value => onTechnicalIds(resolve(value, technicalIds)),
        mappingHoverKey: hover, setMappingHoverKey: setHover,
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
    const addProject = (key, projectType) => change(previous => ({ projects: previous.projects.some(project => project.key === key) ? previous.projects : [...previous.projects, { key, type: projectType }] }));
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
    const hierarchyMappings = SLOT_KEYS.slice(0, offset ? 4 : 3).map((key, index) => ({
        key, label: TYPES[index + offset].name, optional: index >= 2,
        selected: type(draft.hierarchy[key]), options: TYPES.filter(item => item.hierarchyLevel === index + offset),
        helper: index === 0 ? 'Read Story Points, Team and Sprint from this Jira issue type.' : index === 1 ? 'Sum the child issues using the existing calculation rules.' : 'Jira parent context.',
        onSelect: selected => change(previous => ({ hierarchy: { ...previous.hierarchy, [key]: selected.id } })),
        onRemove: () => change(previous => ({ hierarchy: { ...previous.hierarchy, [key]: null } })),
        previewKey: index === 0 ? 'issueType' : index === 1 ? 'parent' : undefined,
    }));
    const child = type(draft.hierarchy.planningIssueTypeId), parent = type(draft.hierarchy.parentIssueTypeId);
    Object.assign(props, {
        hierarchyMappings, issueTypesDraft: child ? [child.name] : [],
        extraFieldMappings: [
            { key: 'projectTrackField', label: 'Project Track', helper: `Jira field on the ${parent?.name || 'parent issue'}.`, selected: draft.projectTrackField, options: FIELDS },
            ...(draft.model === 'rnd_2027' ? [{ key: 'allocationField', label: 'RnD_allocation_category', helper: 'Explicit Epic value, then Initiative, then Objective. Components remain separate.', selected: draft.allocationField, options: FIELDS }] : []),
        ].map(mapping => ({ ...mapping, onSelect: selected => change({ [mapping.key]: selected }), onRemove: () => change({ [mapping.key]: null }) })),
        mappingPreviewLabels: {
            childType: child?.name || 'Unmapped issue type', parentType: parent?.name || 'Unmapped parent type',
            childSummary: child ? `${child.name} Summary` : 'Select a Jira issue type', childKey: child ? `${child.name.toUpperCase().replaceAll(' ', '-')}-KEY` : 'UNMAPPED-KEY', parentKey: parent ? `${parent.name.toUpperCase()}-KEY` : 'UNMAPPED-PARENT',
            childHierarchyLevel: child?.hierarchyLevel, description: child ? `Preview of ${child.name} under ${parent?.name || 'an unmapped parent'}.` : 'Incomplete mapping. Save is allowed; dependent views need configuration.',
        },
        mappingFieldHelpers: { parentName: `Field used to name the parent ${parent?.name || 'issue'}.`, storyPoints: `Estimate on the ${child?.name || 'mapped issue'}; rollups use the existing rules.`, team: `Team on the ${child?.name || 'mapped issue'}.`, deliveryOwner: `Delivery owner on the ${parent?.name || 'parent issue'}.` },
    });
    return <div data-real-jira-settings><JiraFieldSettings {...props} /></div>;
}

function SprintRanges({ config, errors, onPatch }) {
    const [editing, setEditing] = React.useState({});
    return <div data-ranges>{[['from', 'Start sprint', 'All earlier sprints'], ['through', 'End sprint', 'No end']].map(([key, label, empty]) => <div data-range-row key={key}>
        <span className="team-selector-label">{label}</span>
        {editing[key] ? <input className="group-name-input" aria-label={label} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${config.id}-${key}-error` : undefined} list={`mockup-quarters-${config.id}`} placeholder="YYYYQn" value={config[key] || ''} onChange={event => onPatch({ [key]: event.target.value || null })} /> : <span className="selected-team-chip"><span className="team-name">{config[key] || empty}</span></span>}
        <button type="button" className="secondary compact" aria-label={`Change ${label.toLowerCase()}`} onClick={() => setEditing(previous => ({ ...previous, [key]: !previous[key] }))}>{editing[key] ? 'Done' : 'Change'}</button>
        {errors[key] && <span id={`${config.id}-${key}-error`} className="group-modal-warning" data-range-error>{errors[key]}</span>}
    </div>)}<datalist id={`mockup-quarters-${config.id}`}>{quarters.map(value => <option key={value} value={value} />)}</datalist></div>;
}

function Mockup() {
    const params = new URLSearchParams(location.search);
    const initialTab = TABS.some(([key]) => key === params.get('section')) ? params.get('section') : 'scope';
    const [configs, setConfigs] = React.useState(initialConfigurations);
    const [saved, setSaved] = React.useState(initialConfigurations);
    const [activeId, setActiveId] = React.useState(params.get('configuration') === 'delivery' ? 'delivery' : 'legacy');
    const [admin, setAdmin] = React.useState(ADMIN_TABS.some(([key]) => key === params.get('admin')) ? params.get('admin') : 'project');
    const [tabs, setTabs] = React.useState({ legacy: initialTab, delivery: initialTab });
    const [technicalIds, setTechnicalIds] = React.useState(false);
    const [drawer, setDrawer] = React.useState(false);
    const [open, setOpen] = React.useState(true);
    const [discard, setDiscard] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const config = configs.find(item => item.id === activeId), tab = tabs[activeId];
    const errors = validateConfigurations(configs);
    const validationMessages = configs.flatMap(item => Object.values(errors[item.id]).map(error => `${item.name.trim() || 'Configuration'}: ${error}`));
    const dirty = configs.filter((item, index) => JSON.stringify(item) !== JSON.stringify(saved[index]));
    const patch = (id, update) => { setMessage(''); setConfigs(previous => previous.map(item => item.id === id ? { ...item, ...(typeof update === 'function' ? update(item) : update) } : item)); };
    const requestClose = () => dirty.length ? setDiscard(true) : setOpen(false);
    const changeConfig = id => { setActiveId(id); setDrawer(false); setMessage(''); };
    React.useEffect(() => {
        const url = new URL(location.href);
        for (const key of ['variant', 'profile', 'component']) url.searchParams.delete(key);
        url.searchParams.set('configuration', activeId); url.searchParams.set('section', tab); url.searchParams.set('admin', admin);
        history.replaceState(null, '', url);
    }, [activeId, tab, admin]);
    const selectTab = (id, kind) => { setMessage(''); if (kind === 'admin') setAdmin(id); else setTabs(previous => ({ ...previous, [activeId]: id })); };
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
            isDirty={Boolean(dirty.length)} unsavedSectionsCount={dirty.length} onRequestClose={requestClose} onCancel={requestClose}
            showDiscardConfirm={discard} onKeepEditing={() => setDiscard(false)} onDiscard={() => { setConfigs(structuredClone(saved)); setDiscard(false); setOpen(false); setMessage(''); }}
            validationMessages={validationMessages} showSave saveDisabled={!dirty.length || validationMessages.length > 0}
            onSave={() => { setSaved(structuredClone(configs)); const incomplete = configs.some(item => missingMappings(item).length); setMessage(`Saved in this preview only.${incomplete ? ' Incomplete mappings still need configuration.' : ''} No application configuration changed.`); }}
            showTestConfiguration={admin === 'project'} onTestConfiguration={() => {
                if (dirty.length) { setMessage('Save your changes before testing the saved configuration.'); return; }
                const missing = missingMappings(saved.find(item => item.id === activeId));
                setMessage(missing.length ? `Synthetic check: saved configuration is incomplete (${[...new Set(missing)].join(', ')}). No Jira request was made.` : 'Saved synthetic mappings are populated. Live Jira access and field contexts have not been tested.');
            }} testConfigurationMessage={message || 'Mockup · synthetic data only'}>
            <nav className="group-modal-tabs epm-settings-tabs" id="admin-tabs" role="tablist" aria-label="Admin settings sections">{ADMIN_TABS.map(([key, label]) => <button key={key} type="button" className={`group-modal-tab ${admin === key ? 'active' : ''}`} role="tab" id={`admin-tab-${key}`} aria-selected={admin === key} aria-controls={key === 'project' ? 'project-config-panel' : 'workspace-panel'} tabIndex={admin === key ? 0 : -1} onClick={() => selectTab(key, 'admin')} onKeyDown={event => tabKeys(event, ADMIN_TABS, admin, 'admin')}>{label}</button>)}</nav>
            <div className="group-modal-body group-modal-split" id="project-config-panel" hidden={admin !== 'project'}>
                <aside className={`group-pane group-pane-left ${drawer ? 'is-mobile-active' : ''}`} id="configurations" aria-label="Project configurations">
                    <div className="group-pane-header"><div className="group-pane-title">Configurations</div><div className="group-pane-count">{configs.length} configurations</div><button type="button" className="group-pane-mobile-close" onClick={() => setDrawer(false)}>Back</button></div>
                    <div className="group-pane-list">{configs.map(item => <div key={item.id} className={`group-list-item ${item.id === activeId ? 'active' : ''}`} data-config-row data-config={item.id} onClick={() => { if (item.id !== activeId) changeConfig(item.id); }}>
                        {item.id === activeId ? <input className="group-list-name-input" aria-label="Configuration name" aria-invalid={Boolean(errors[item.id].name)} aria-describedby={errors[item.id].name ? `${item.id}-name-error` : undefined} value={item.name} onChange={event => patch(item.id, { name: event.target.value })} /> : <button type="button" className="group-list-name" data-config-select onClick={() => changeConfig(item.id)}>{item.name || 'Unnamed configuration'}</button>}
                        <span className="group-list-meta">{rangeLabel(item)}</span>
                        {errors[item.id].name && <span id={`${item.id}-name-error`} className="group-modal-warning">{errors[item.id].name}</span>}
                    </div>)}</div>
                    <div className="group-field-helper" data-configuration-summary>The viewed sprint selects the configuration automatically.</div>
                </aside>
                <section className="group-pane group-pane-right" id="editor" aria-label="Selected configuration">
                    <div className="group-pane-mobile-header"><button type="button" className="secondary compact" onClick={() => setDrawer(true)}>Configurations</button><span className="group-pane-mobile-title">{config.name}</span></div>
                    <div id="configuration-header"><div data-header-row><h2 className="group-pane-title" title={config.name}>{config.name || 'Unnamed configuration'}</h2><span className="group-modal-meta">{rangeLabel(config)}</span></div><div className="group-field-helper">Changes affect every sprint in this range. Earlier views read live Jira data; they are not snapshots.</div></div>
                    <nav className="group-modal-tabs epm-settings-tabs" id="tabs" role="tablist" aria-label="Configuration sections" data-config-tabs>{TABS.map(([key, label]) => <button type="button" key={key} id={`configuration-tab-${key}`} className={`group-modal-tab ${tab === key ? 'active' : ''}`} role="tab" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} aria-controls={`panel-${activeId}-${key}`} onClick={() => selectTab(key, 'configuration')} onKeyDown={event => tabKeys(event, TABS, tab, 'configuration')}>{label}</button>)}</nav>
                    <div id="settings-panel">{configs.flatMap(item => TABS.map(([section]) => <div key={`${item.id}-${section}`} id={`panel-${item.id}-${section}`} role="tabpanel" aria-labelledby={`configuration-tab-${section}`} data-fixture-panel data-configuration={item.id} data-section={section} data-model={item.model} hidden={item.id !== activeId || section !== tab}>
                        {section === 'scope' && <SprintRanges config={item} errors={errors[item.id]} onPatch={update => patch(item.id, update)} />}
                        <FixtureFields tab={section} configuration={item} technicalIds={technicalIds} onTechnicalIds={setTechnicalIds} onPatch={update => patch(item.id, update)} />
                    </div>))}</div>
                </section>
            </div>
            <section className="group-pane group-projects-pane-right group-single-pane" id="workspace-panel" role="tabpanel" aria-labelledby={`admin-tab-${admin}`} hidden={admin === 'project'}><h2 className="group-pane-title">{ADMIN_TABS.find(([key]) => key === admin)?.[1]}</h2><p className="group-projects-desc">Workspace settings · shared across all project configurations.</p><p className="group-field-helper">The existing workspace panel stays at this level. This fixture demonstrates Project config; it does not edit workspace capacity, weights, access or performance.</p></section>
        </SettingsModal>}
    </>;
}

createRoot(document.getElementById('work-structure-mockup')).render(<Mockup />);
