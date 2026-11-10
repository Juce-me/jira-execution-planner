import * as React from 'react';

import { searchBoards as requestBoardSearch, searchProjects as requestProjectSearch } from '../api/jiraCatalogApi.js';
import JiraFieldSettings from './JiraFieldSettings.jsx';
import MappingPickerRow from './MappingPickerRow.jsx';
import { buildFieldSettingsProps, FIELD_SLOTS } from './workConfigurationFormProps.js';
import { DELIVERY_PROJECT_LIMIT_MESSAGE, MODEL_LEGACY, MODEL_RND, incompleteTabs, inheritedBoard, rangeLabel, refreshableSources, sourceCause, sprintValueOptions, typedSprintOption } from './workConfigurationModel.js';

const TABS = [['scope', 'Scope'], ['source', 'Source'], ['mapping', 'Field mapping']];
const FIXED_BOUNDS = { [MODEL_LEGACY]: { fromQuarter: 'No start (all earlier Sprints)' }, [MODEL_RND]: { throughQuarter: 'No end' } };
const HINT_KEY = 'jira_work_config_hint_v1';
const readHintDismissed = () => { try { return window.localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } };
const noHover = () => {};
const RANGE_ROWS = [['fromQuarter', 'From Sprint'], ['throughQuarter', 'Through Sprint']];

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
                if (!controller.signal.aborted) apply(key ? data[key] || [] : data);
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

// Scope boundaries are Jira Sprint values chosen from what the saved sources observed; a canonical value that is not listed (list failed, loading or incomplete) can be typed and chosen.
// The two open ends (Legacy's start, DELIVERY's end) stay fixed; inner boundaries reuse MappingPickerRow.
function SprintRanges({ entry, errors, onPatch, sprintValues, onRetry, canEdit, workConfig }) {
    const fixed = FIXED_BOUNDS[entry.model] || {};
    const options = React.useMemo(() => sprintValueOptions(sprintValues), [sprintValues]);
    const sprintRefresh = workConfig.sprintRefresh;
    // Nothing is readable from Jira until the first Save promotes the bundle: before that no configuration exists server-side.
    const savedSources = workConfig.promoted ? refreshableSources(workConfig.baseline?.configurations || []) : [];
    return (
        <div className="work-config-ranges">
            <div className="work-config-ranges-head" data-sprint-refresh>
                <div className="team-selector-label">Sprints</div>
                {savedSources.length > 0 && (
                    <button type="button" className="secondary compact" disabled={!canEdit || sprintRefresh.status === 'running'} onClick={workConfig.refreshSprintValues}>
                        {sprintRefresh.status === 'running' ? 'Refreshing Sprint values…' : 'Refresh Sprint values'}
                    </button>
                )}
            </div>
            {sprintValues.state === 'loading' && !options.length && <p className="group-field-helper" role="status" data-sprint-values-state="loading">Loading Sprint values from Jira&hellip;</p>}
            {sprintValues.state === 'error' && (
                <p className="group-modal-warning" role="status" data-sprint-values-state="error">
                    Could not load Sprint values. The saved Sprints are unchanged. You can still type a Sprint value such as 2027Q1.
                    <button type="button" className="secondary compact" onClick={onRetry}>Retry</button>
                </p>
            )}
            {sprintValues.state === 'ready' && !options.length && <p className="group-field-helper" role="status" data-sprint-values-state="empty">No Sprint has been seen yet. {sourceCause((sprintValues.sources || []).find(item => item.configurationId === entry.id)?.diagnostics, entry.name) || 'Refresh the Sprint values, or choose a source Board in Source.'}</p>}
            <div className="work-config-range-grid">
                {RANGE_ROWS.map(([key, label]) => {
                    const value = entry[key];
                    return (
                        <div key={key} data-range-row={key}>
                            {fixed[key] ? (
                                <div className="group-projects-subsection">
                                    <div className="team-selector-label">{label}</div>
                                    <div className="capacity-inline-row"><div className="selected-team-chip"><span className="team-name">{fixed[key]}</span></div></div>
                                </div>
                            ) : (
                                <fieldset className="team-catalog-edit-lock work-config-fieldset" disabled={!canEdit}>
                                    <MappingPickerRow
                                        mapping={{
                                            key,
                                            label,
                                            required: true,
                                            selected: value ? { id: value, name: value } : null,
                                            options,
                                            emptyMessage: 'No matching Sprint value.',
                                            typedOption: typedSprintOption,
                                            onSelect: option => onPatch({ [key]: option.value }),
                                            onRemove: () => onPatch({ [key]: null }),
                                        }}
                                        kind="sprint"
                                        showTechnicalFieldIds={undefined}
                                        mappingHoverKey={null}
                                        setMappingHoverKey={noHover}
                                    />
                                </fieldset>
                            )}
                            {errors[key] && <span id={`${entry.id}-${key}-error`} className="group-modal-warning work-config-range-error" role="alert" tabIndex={-1} data-work-config-issue>{errors[key]}</span>}
                        </div>
                    );
                })}
            </div>
            {sprintRefresh.failed > 0 && <p className="group-modal-warning" role="status" data-sprint-refresh-failed>{sprintRefresh.failed === 1 ? 'One source' : `${sprintRefresh.failed} sources`} could not be refreshed. The list keeps what Jira last reported.</p>}
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
            {isActive && error && <span id={`${entry.id}-name-error`} className="group-list-name-error" role="alert" tabIndex={-1} data-work-config-issue>{error}</span>}
        </div>
    );
}

function EntryForm({ workConfig, entry, tab, BACKEND_URL, jiraProjects, loadingProjects, jiraFields, loadingFields, resolveProjectName }) {
    const [hover, setHover] = React.useState(null);
    const [retire, setRetire] = React.useState(null);
    const [previewOpen, setPreviewOpen] = React.useState(false);
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
    // Only the board id is saved; its name is read back once so the chip never shows "Board 7001" after a reload. A blank
    // Board shows the Board it inherits, named under the configuration that owns it.
    const inherited = inheritedBoard(workConfig.entries, entry.id);
    const savedBoardId = entry.scope.boardId || inherited?.boardId || '';
    const boardNameOwner = entry.scope.boardId ? entry.id : inherited?.fromId;
    const savedBoardName = entry.scope.boardId ? search.boardName : (inherited ? workConfig.uiFor(inherited.fromId).search?.boardName : '');
    React.useEffect(() => {
        if (tab !== 'source' || !savedBoardId || savedBoardName) return undefined;
        const controller = new AbortController();
        requestBoardSearch(BACKEND_URL, { query: String(savedBoardId), signal: controller.signal })
            .then(response => (response.ok ? response.json() : null))
            .then(data => {
                const match = (data?.boards || []).find(board => String(board.id) === String(savedBoardId));
                if (match?.name && !controller.signal.aborted) workConfig.setSearch(boardNameOwner, 'boardName', match.name);
            })
            .catch(() => {});
        return () => controller.abort();
    }, [BACKEND_URL, tab, boardNameOwner, savedBoardId, savedBoardName]);
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
        inheritedBoard: inherited ? { ...inherited, name: savedBoardName || '' } : null,
        entries: workConfig.entries,
        boardName: search.boardName || '',
    });
    props.mappingPreviewOpen = previewOpen;
    props.setMappingPreviewOpen = setPreviewOpen;
    // Shown while a project is being searched for; a refused add keeps the query, so it stays visible.
    const limitMessage = tab === 'scope' && projectQuery
        && (workConfig.limitMessages[entry.id] || (entry.model === MODEL_RND && entry.scope.projects.length >= 1))
        ? DELIVERY_PROJECT_LIMIT_MESSAGE : '';
    const filter = entry.model === MODEL_LEGACY && Array.isArray(entry.legacyIssueTypeNames) ? entry.legacyIssueTypeNames : null;
    const fieldError = workConfig.fieldErrors[entry.id] || {};
    const catalogUnavailable = typeCatalog.state !== 'ready';
    return (
        <div className="work-config-fields" data-work-config-form data-configuration={entry.id} data-model={entry.model}>
            {tab === 'scope' && <SprintRanges entry={entry} errors={workConfig.validation.errors[entry.id] || {}} onPatch={update => workConfig.patch(entry.id, update)} sprintValues={workConfig.sprintValues} onRetry={workConfig.retrySprintValues} canEdit={workConfig.userCanEdit} workConfig={workConfig} />}
            {tab === 'scope' && limitMessage && <p className="group-field-helper work-config-note" role="status" data-project-limit-message>{limitMessage}</p>}
            {tab === 'scope' && workConfig.validation.errors[entry.id]?.projects && (
                <p className="group-modal-warning work-config-note" role="alert" tabIndex={-1} data-work-config-issue>{workConfig.validation.errors[entry.id].projects}</p>
            )}
            {tab === 'mapping' && filter && filter.length !== 1 && (
                <div className="group-projects-subsection work-config-note" data-captured-filter>
                    <div className="team-selector-label">Captured issue-type filter</div>
                    <div className="group-field-helper">{filter.length ? filter.join(', ') : 'All issue types (unrestricted)'}. This captured filter stays in effect until you explicitly change the mapping below.</div>
                    <div className="selected-team-chip">
                        <span className="team-name">{filter.length ? filter.join(', ') : 'All issue types'}</span>
                        <button type="button" className="remove-btn" aria-label="Change captured issue-type filter" onClick={() => setRetire({ pendingType: null })}>&times;</button>
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
    const [hintDismissed, setHintDismissed] = React.useState(readHintDismissed);
    const dismissHint = () => { setHintDismissed(true); try { window.localStorage.setItem(HINT_KEY, '1'); } catch { /* storage unavailable */ } };
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
    const incomplete = incompleteTabs(entry, errors[entry.id], { fields: loadingFields ? null : jiraFields }, workConfig.entries);
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
                    <button type="button" className="group-pane-mobile-close" onClick={() => workConfig.setDrawerOpen(false)}>Back</button>
                </div>
                <div className="group-pane-list">
                    {entries.map(item => (
                        <ConfigurationRow key={item.id} entry={item} isActive={item.id === entry.id} error={errors[item.id]?.name} onSelect={workConfig.selectConfiguration} onPatch={workConfig.patch} />
                    ))}
                </div>
            </aside>
            <section className="group-pane group-pane-right work-config-right" aria-label="Selected configuration">
                <div className="group-pane-mobile-header">
                    <button type="button" className="secondary compact" onClick={() => workConfig.setDrawerOpen(true)}>Configurations</button>
                    <span className="group-pane-mobile-title">{entry.name}</span>
                </div>
                {!hintDismissed && (
                    <div className="work-config-header">
                        <div className="group-field-helper work-config-header-helper" data-work-config-hint>
                            <span>Changes apply to every Sprint in this range, and past views read live Jira data.</span>
                            <button type="button" className="secondary compact" onClick={dismissHint}>Got it</button>
                        </div>
                    </div>
                )}
                <div className="work-config-tabbar">
                    <nav className="group-modal-tabs epm-settings-tabs" role="tablist" aria-label="Configuration sections" onKeyDown={onTabKeys}>
                        {TABS.map(([key, label]) => (
                            <button type="button" key={key} id={`work-config-tab-${key}`} className={`group-modal-tab ${tab === key ? 'active' : ''}`} role="tab" aria-selected={tab === key} aria-controls="work-config-panel" tabIndex={tab === key ? 0 : -1} data-incomplete={incomplete[key] || undefined} onClick={() => workConfig.setTab(entry.id, key)}>{label}{incomplete[key] && <span className="work-config-tab-flag" aria-hidden="true" />}</button>
                        ))}
                    </nav>
                    <label className="group-visible-control work-config-ids-control">
                        <input type="checkbox" checked={workConfig.technicalIds} onChange={event => workConfig.setTechnicalIds(event.target.checked)} />
                        <span>Jira IDs</span>
                    </label>
                </div>
                <div id="work-config-panel" className="work-config-panel" role="tabpanel" aria-labelledby={`work-config-tab-${tab}`}>
                    {workConfig.typeNamesToSave.includes(entry.id) && <p className="group-field-helper work-config-note" role="status" data-work-config-type-names>Jira type names need saving.</p>}
                    {entry.model === MODEL_RND && !entry.scope.projects.length && (
                        <div className="group-modal-warning work-config-note" data-setup-guidance>
                            {entry.name} is not ready: choose its Jira project.
                        </div>
                    )}
                    <EntryForm key={`${entry.id}-${tab}`} {...{ workConfig, entry, tab, BACKEND_URL, jiraProjects, loadingProjects, jiraFields, loadingFields, resolveProjectName }} />
                </div>
            </section>
        </div>
    );
}
