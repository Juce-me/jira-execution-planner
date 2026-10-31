import * as React from 'react';

import { searchBoards as requestBoardSearch, searchProjects as requestProjectSearch } from '../api/jiraCatalogApi.js';
import JiraFieldSettings from './JiraFieldSettings.jsx';
import { buildFieldSettingsProps, FIELD_SLOTS } from './workConfigurationFormProps.js';
import { DELIVERY_PROJECT_LIMIT_MESSAGE, MODEL_LEGACY, MODEL_RND, rangeLabel } from './workConfigurationModel.js';

const TABS = [['scope', 'Scope'], ['source', 'Source'], ['mapping', 'Field mapping']];
const FIXED_BOUNDS = { [MODEL_LEGACY]: { fromQuarter: 'All earlier quarters' }, [MODEL_RND]: { throughQuarter: 'No end' } };
const RANGE_ROWS = [['fromQuarter', 'Start quarter'], ['throughQuarter', 'End quarter']];

export function WorkConfigurationUnavailable() {
    return (
        <section className="group-pane group-projects-pane-right group-single-pane work-config-unavailable" data-work-config-unavailable>
            <h2 className="group-pane-title">Project configurations unavailable</h2>
            <p className="group-field-helper" role="status">
                Project configurations are turned off for this workspace, so the project, board and field settings
                cannot be shown or changed here. Ask an administrator to turn the feature back on.
            </p>
        </section>
    );
}

function useRemoteCatalogSearch({ BACKEND_URL, enabled, projectQuery, boardQuery, boardSelected }) {
    const [projects, setProjects] = React.useState([]);
    const [projectLoading, setProjectLoading] = React.useState(false);
    const [boards, setBoards] = React.useState([]);
    const [boardLoading, setBoardLoading] = React.useState(false);
    const run = (query, request, apply, setLoading, key) => {
        const trimmed = query.trim();
        if (!enabled || !trimmed) { apply([]); setLoading(false); return undefined; }
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setLoading(true);
            try {
                const response = await request(BACKEND_URL, { query: trimmed, signal: controller.signal });
                if (!response.ok) throw new Error(`Search error ${response.status}`);
                const data = await response.json();
                if (!controller.signal.aborted) apply(data[key] || []);
            } catch (error) {
                if (error.name !== 'AbortError') apply([]);
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }, 220);
        return () => { window.clearTimeout(timer); controller.abort(); };
    };
    React.useEffect(() => run(projectQuery, requestProjectSearch, setProjects, setProjectLoading, 'projects'), [enabled, projectQuery]);
    React.useEffect(() => run(boardSelected ? '' : boardQuery, requestBoardSearch, setBoards, setBoardLoading, 'boards'), [enabled, boardQuery, boardSelected]);
    return { projects, projectLoading, boards, boardLoading };
}

function SprintRanges({ entry, errors, onPatch }) {
    const [editing, setEditing] = React.useState({});
    const fixed = FIXED_BOUNDS[entry.model] || {};
    return (
        <div className="work-config-ranges">
            <p className="group-field-helper">Each quarter is one Jira Sprint; move the shared boundary by changing Legacy&rsquo;s end quarter and DELIVERY&rsquo;s start quarter together.</p>
            {RANGE_ROWS.map(([key, label]) => (
                <div className="work-config-range-row" key={key}>
                    <span className="team-selector-label">{label}</span>
                    {editing[key] && !fixed[key] ? (
                        <input
                            className="group-name-input"
                            aria-label={label}
                            aria-invalid={Boolean(errors[key]) || undefined}
                            aria-describedby={errors[key] ? `${entry.id}-${key}-error` : undefined}
                            placeholder="YYYYQn"
                            value={entry[key] || ''}
                            onChange={event => onPatch({ [key]: event.target.value || null })}
                        />
                    ) : (
                        <span className="selected-team-chip"><span className="team-name">{entry[key] || fixed[key] || 'None'}</span></span>
                    )}
                    {fixed[key] ? <span /> : (
                        <button type="button" className="secondary compact" aria-label={`Change ${label.toLowerCase()}`} onClick={() => setEditing(previous => ({ ...previous, [key]: !previous[key] }))}>
                            {editing[key] ? 'Done' : 'Change'}
                        </button>
                    )}
                    {errors[key] && <span id={`${entry.id}-${key}-error`} className="group-modal-warning work-config-range-error" role="alert">{errors[key]}</span>}
                </div>
            ))}
        </div>
    );
}

function ConfigurationRow({ entry, isActive, error, onSelect, onPatch }) {
    const focusValue = React.useRef('');
    return (
        <div className={`group-list-item ${isActive ? 'active' : ''}`} data-work-config={entry.id} onClick={() => { if (!isActive) onSelect(entry.id); }}>
            {isActive ? (
                <input
                    className="group-list-name-input"
                    placeholder="Configuration name"
                    aria-label="Configuration name"
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby={error ? `${entry.id}-name-error` : undefined}
                    value={entry.name}
                    onClick={event => event.stopPropagation()}
                    onFocus={() => { focusValue.current = entry.name; }}
                    onChange={event => onPatch(entry.id, { name: event.target.value })}
                    onKeyDown={event => {
                        if (event.key === 'Escape') { event.preventDefault(); onPatch(entry.id, { name: focusValue.current }); }
                        if (event.key === 'Enter' && !error) { event.preventDefault(); onPatch(entry.id, { name: entry.name.trim() }); }
                    }}
                    onBlur={event => { if (!error) onPatch(entry.id, { name: event.currentTarget.value.trim() }); }}
                />
            ) : (
                <button type="button" className="group-list-select" onClick={() => onSelect(entry.id)}>
                    <span className="group-list-name">{entry.name || 'Unnamed configuration'}</span>
                </button>
            )}
            <div className="group-list-line group-list-meta-line">
                <span className="group-list-dot">&middot;</span>
                <span className="group-list-meta">{rangeLabel(entry)}</span>
            </div>
            {isActive && error && <span id={`${entry.id}-name-error`} className="group-list-name-error" role="alert">{error}</span>}
        </div>
    );
}

function EntryForm({ workConfig, entry, tab, BACKEND_URL, jiraProjects, loadingProjects, jiraFields, loadingFields, resolveProjectName }) {
    const [hover, setHover] = React.useState(null);
    const [retire, setRetire] = React.useState(null);
    const refs = React.useRef(Object.fromEntries([...FIELD_SLOTS.map(([prefix]) => prefix), 'board', 'project'].map(name => [name, React.createRef()])));
    const search = workConfig.uiFor(entry.id).search || {};
    const typeCatalog = workConfig.typeCatalogFor(entry.id);
    const remote = useRemoteCatalogSearch({
        BACKEND_URL,
        enabled: true,
        projectQuery: tab === 'scope' ? (search.projectQuery || '') : '',
        boardQuery: tab === 'source' ? (search.boardQuery || '') : '',
        boardSelected: Boolean(entry.scope.boardId),
    });
    const selectedKeys = new Set(entry.scope.projects.map(project => project.key));
    const projectQuery = String(search.projectQuery || '').toLowerCase().trim();
    const projectPool = remote.projects.length ? remote.projects : jiraProjects;
    const projectResults = projectQuery
        ? projectPool.filter(project => !selectedKeys.has(project.key)
            && `${project.key} ${project.name}`.toLowerCase().includes(projectQuery)).slice(0, 10)
        : [];
    const boardQuery = String(search.boardQuery || '').toLowerCase().trim();
    const boardResults = boardQuery
        ? remote.boards.filter(board => String(board.id).includes(boardQuery) || String(board.name || '').toLowerCase().includes(boardQuery)).slice(0, 20)
        : [];
    const props = buildFieldSettingsProps({
        entry, tab, search, setSearch: workConfig.setSearch, patch: workConfig.patch, refs: refs.current,
        technicalIds: workConfig.technicalIds, setTechnicalIds: workConfig.setTechnicalIds,
        jiraFields, loadingFields, jiraProjects, loadingProjects, projectResults, projectLoading: remote.projectLoading,
        boardResults, boardLoading: remote.boardLoading, resolveProjectName,
        addProject: workConfig.addProject, removeProject: workConfig.removeProject,
        typeCatalog, hoverKey: hover, setHoverKey: setHover, requestRetire: setRetire,
        boardName: search.boardName || '',
    });
    // Shown while a project is being searched for; a refused add keeps the query, so it stays visible.
    const limitMessage = tab === 'scope' && projectQuery
        && (workConfig.limitMessages[entry.id] || (entry.model === MODEL_RND && entry.scope.projects.length >= 1))
        ? DELIVERY_PROJECT_LIMIT_MESSAGE : '';
    const filter = entry.model === MODEL_LEGACY && Array.isArray(entry.legacyIssueTypeNames) ? entry.legacyIssueTypeNames : null;
    const fieldError = workConfig.fieldErrors[entry.id] || {};
    const catalogUnavailable = typeCatalog.state !== 'ready';
    return (
        <div className="work-config-fields" data-work-config-form data-configuration={entry.id} data-model={entry.model}>
            {tab === 'scope' && <SprintRanges entry={entry} errors={workConfig.validation.errors[entry.id] || {}} onPatch={update => workConfig.patch(entry.id, update)} />}
            {tab === 'scope' && limitMessage && <p className="group-field-helper work-config-note" role="status" data-project-limit-message>{limitMessage}</p>}
            {tab === 'scope' && workConfig.validation.errors[entry.id]?.projects && (
                <p className="group-modal-warning work-config-note" role="alert">{workConfig.validation.errors[entry.id].projects}</p>
            )}
            {tab === 'mapping' && filter && (
                <div className="group-projects-subsection work-config-note" data-captured-filter>
                    <div className="team-selector-label">Captured issue-type filter</div>
                    <div className="group-field-helper">{filter.length ? filter.join(', ') : 'All issue types (unrestricted)'}. This captured filter stays in effect until you explicitly change the mapping below.</div>
                    <div className="selected-team-chip">
                        <span className="team-name">{filter.length ? filter.join(', ') : 'All issue types'}</span>
                        <button type="button" className="remove-btn" aria-label="Change captured issue-type filter" title="Change captured issue-type filter" onClick={() => setRetire({ pendingType: null })}>&times;</button>
                    </div>
                </div>
            )}
            {tab === 'mapping' && catalogUnavailable && (
                <div className="group-modal-warning work-config-note" role="status" data-catalog-state={typeCatalog.state}>
                    {typeCatalog.state === 'loading' && 'Loading Jira issue types. Saved IDs are preserved.'}
                    {typeCatalog.state === 'unscoped' && 'Save a Jira project for this configuration to load its issue types. Saved IDs are preserved.'}
                    {typeCatalog.state === 'error' && (<>
                        Could not load Jira issue types. Saved IDs are preserved.
                        <button type="button" className="secondary compact" onClick={workConfig.retryTypeCatalog}>Retry Jira catalog</button>
                    </>)}
                </div>
            )}
            {tab === 'mapping' && Object.entries(fieldError).map(([slot, message]) => (
                <div key={slot} className="group-modal-warning work-config-note" role="alert" data-field-error={slot}>
                    {message}
                    <button type="button" className="secondary compact" onClick={() => workConfig.reload()}>Reload latest (discard my changes)</button>
                </div>
            ))}
            {tab === 'mapping' && <p className="group-field-helper work-config-note" data-field-context-note>Field types and issue contexts need verification by Test configuration; selecting a field here does not verify Jira metadata or access.</p>}
            <fieldset className="team-catalog-edit-lock work-config-fieldset" disabled={!workConfig.userCanEdit}><JiraFieldSettings {...props} /></fieldset>
            {retire && (
                <div className="group-confirm-backdrop" role="alertdialog" aria-label="Change captured issue-type filter?" onClick={() => setRetire(null)}>
                    <div className="group-confirm" onClick={event => event.stopPropagation()}>
                        <div className="group-confirm-title">Change captured issue-type filter?</div>
                        <p className="group-field-helper">This retires the captured {filter?.length ? filter.join(', ') : 'unrestricted'} filter for every Legacy sprint. Select the replacement Jira mapping after confirming.</p>
                        <div className="group-confirm-actions">
                            <button type="button" className="secondary compact" onClick={() => setRetire(null)}>Keep captured filter</button>
                            <button type="button" className="compact" onClick={() => {
                                workConfig.patch(entry.id, { legacyIssueTypeNames: null, hierarchy: { planningIssueTypeId: retire.pendingType } });
                                setRetire(null);
                            }}>Change mapping</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function WorkConfigurationsEditor({
    BACKEND_URL, workConfig, jiraProjects = [], loadingProjects = false, jiraFields = [], loadingFields = false, resolveProjectName,
}) {
    const { entries, activeEntry: entry } = workConfig;
    React.useEffect(() => { document.getElementById('work-config-panel')?.scrollTo?.(0, 0); }, [workConfig.activeId, entry && workConfig.tabFor(entry.id)]);
    if (workConfig.loadState === 'error') {
        return (
            <section className="group-pane group-projects-pane-right group-single-pane" data-work-config-load-error>
                <h2 className="group-pane-title">Project configurations</h2>
                <p className="group-modal-warning" role="alert">{workConfig.loadError || 'Project configurations could not be loaded.'}</p>
                <div className="group-pane-tools"><button type="button" className="secondary compact" onClick={() => workConfig.reload()}>Reload</button></div>
            </section>
        );
    }
    if (!entry) {
        return (
            <section className="group-pane group-projects-pane-right group-single-pane" data-work-config-loading>
                <h2 className="group-pane-title">Project configurations</h2>
                <p className="group-field-helper" role="status">Loading project configurations&hellip;</p>
            </section>
        );
    }
    const tab = workConfig.tabFor(entry.id);
    const errors = workConfig.validation.errors;
    const onTabKeys = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = TABS.findIndex(([key]) => key === tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
        workConfig.setTab(entry.id, TABS[next][0]);
        window.requestAnimationFrame(() => document.getElementById(`work-config-tab-${TABS[next][0]}`)?.focus());
    };
    return (
        <div className="group-modal-body group-modal-split work-config-editor" data-work-config-editor>
            <aside className={`group-pane group-pane-left ${workConfig.drawerOpen ? 'is-mobile-active' : ''}`} aria-label="Project configurations">
                <div className="group-pane-header">
                    <div className="group-pane-title">Configurations</div>
                    <div className="group-pane-count">{entries.length} configurations</div>
                    <button type="button" className="group-pane-mobile-close" onClick={() => workConfig.setDrawerOpen(false)}>Back</button>
                </div>
                <div className="group-pane-list">
                    {entries.map(item => (
                        <ConfigurationRow key={item.id} entry={item} isActive={item.id === entry.id} error={errors[item.id]?.name} onSelect={workConfig.selectConfiguration} onPatch={workConfig.patch} />
                    ))}
                </div>
                <div className="group-field-helper work-config-summary">The viewed sprint selects the configuration automatically.</div>
            </aside>
            <section className="group-pane group-pane-right work-config-right" aria-label="Selected configuration">
                <div className="group-pane-mobile-header">
                    <button type="button" className="secondary compact" onClick={() => workConfig.setDrawerOpen(true)}>Configurations</button>
                    <span className="group-pane-mobile-title">{entry.name}</span>
                </div>
                <div className="work-config-header">
                    <div className="work-config-header-row">
                        <h2 className="group-pane-title" title={entry.name}>{entry.name || 'Unnamed configuration'}</h2>
                        <span className="group-modal-meta">{rangeLabel(entry)}</span>
                    </div>
                    <div className="group-field-helper work-config-header-helper">Changes affect every sprint in this range. Earlier views read live Jira data; they are not snapshots.</div>
                </div>
                <nav className="group-modal-tabs epm-settings-tabs" role="tablist" aria-label="Configuration sections" onKeyDown={onTabKeys}>
                    {TABS.map(([key, label]) => (
                        <button type="button" key={key} id={`work-config-tab-${key}`} className={`group-modal-tab ${tab === key ? 'active' : ''}`} role="tab" aria-selected={tab === key} aria-controls="work-config-panel" tabIndex={tab === key ? 0 : -1} onClick={() => workConfig.setTab(entry.id, key)}>{label}</button>
                    ))}
                </nav>
                <div id="work-config-panel" className="work-config-panel" role="tabpanel" aria-labelledby={`work-config-tab-${tab}`}>
                    {entry.model === MODEL_RND && !entry.scope.projects.length && (
                        <div className="group-modal-warning work-config-note" data-setup-guidance>
                            Saving affects all sprints from {entry.fromQuarter || 'the start quarter'} onward. {entry.name} is incomplete: select its Jira project, Source and required mappings before using those views.
                        </div>
                    )}
                    <EntryForm key={`${entry.id}-${tab}`} {...{ workConfig, entry, tab, BACKEND_URL, jiraProjects, loadingProjects, jiraFields, loadingFields, resolveProjectName }} />
                </div>
            </section>
        </div>
    );
}
