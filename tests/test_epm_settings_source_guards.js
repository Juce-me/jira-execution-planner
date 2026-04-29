const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx');
const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');

test('dashboard source includes the EPM settings tab and lazy-load flow', () => {
    assert.ok(dashboardSource.includes("groupManageTab === 'epm'"), 'Expected an EPM settings tab branch');
    assert.ok(dashboardSource.includes("const DEFAULT_EPM_LABEL_PREFIX = 'rnd_project_';"), 'Expected EPM label prefix default');
    assert.ok(dashboardSource.includes("const [epmConfigDraft, setEpmConfigDraft] = useState(createEmptyEpmConfigDraft());"), 'Expected EPM config draft state');
    assert.ok(dashboardSource.includes("const epmConfigBaselineRef = useRef(JSON.stringify(createEmptyEpmConfigDraft()));"), 'Expected EPM config baseline tracking');
    assert.ok(dashboardSource.includes("const [epmProjectsError, setEpmProjectsError] = useState('');"), 'Expected EPM project error state');
    assert.ok(dashboardSource.includes('const isEpmConfigDirty = React.useMemo(() => {'), 'Expected EPM dirty-state tracking');
    assert.ok(dashboardSource.includes('if (isEpmConfigDirty) return true;'), 'Expected EPM dirty-state participation in modal dirty checks');
    assert.ok(dashboardSource.includes('isEpmConfigDirty,'), 'Expected EPM dirty-state participation in unsaved section counting');
    assert.ok(dashboardSource.includes('const loadEpmConfig = () => fetchEpmConfig(BACKEND_URL);'), 'Expected EPM config loader wrapper');
    assert.ok(dashboardSource.includes('const loadEpmScopeMeta = () => fetchEpmScope(BACKEND_URL);'), 'Expected EPM scope metadata loader wrapper');
    assert.ok(dashboardSource.includes('const loadEpmGoals = (rootGoalKey = \'\') => fetchEpmGoals(BACKEND_URL, rootGoalKey);'), 'Expected EPM goals loader wrapper');
    assert.ok(dashboardSource.includes('const loadEpmProjects = () => fetchEpmProjects(BACKEND_URL);'), 'Expected EPM projects loader wrapper');
    assert.ok(dashboardSource.includes('const saveEpmConfig = async () => {'), 'Expected EPM config saver');
    assert.ok(dashboardSource.includes('const normalizeEpmConfigDraft = (config) => {'), 'Expected EPM config normalizer');
    assert.ok(dashboardSource.includes('const hasSavedEpmScopeConfig = (config) => {'), 'Expected saved-scope helper');
    assert.ok(dashboardSource.includes('const updateEpmScopeDraft = (field, value) => {'), 'Expected EPM scope draft mutator');
    assert.ok(dashboardSource.includes('const updateEpmProjectDraft = (projectId, field, value) => {'), 'Expected inline EPM draft mutator');
    assert.ok(dashboardSource.includes('const updateEpmLabelPrefixDraft = (value) => {'), 'Expected EPM label prefix mutator');
    assert.ok(dashboardSource.includes('const addCustomEpmProjectDraft = () => {'), 'Expected custom EPM project draft creator');
    assert.ok(dashboardSource.includes('const removeEpmProjectDraft = (projectId) => {'), 'Expected EPM project draft removal');
    assert.ok(dashboardSource.includes('getEpmProjectIdentity(project) === epmSelectedProjectId'), 'Expected main EPM selected project lookup to use the shared project identity');
    assert.ok(dashboardSource.includes('const currentProjectId = projectIdOverride || getEpmProjectIdentity(currentProject);'), 'Expected EPM issue fetch to use the shared project identity');
    assert.ok(dashboardSource.includes('const projectId = getEpmProjectIdentity(project);'), 'Expected EPM project picker options to use the shared project identity');
    assert.ok(dashboardSource.includes('const openEpmSettingsTab = () => {'), 'Expected helper that opens the EPM settings tab without flashing stale project rows');
    assert.ok(dashboardSource.includes("const [epmSettingsProjects, setEpmSettingsProjects] = useState([]);"), 'Expected settings-scoped EPM project preview state');
    assert.ok(dashboardSource.includes("const [epmSettingsProjectsLoading, setEpmSettingsProjectsLoading] = useState(false);"), 'Expected settings-scoped EPM project preview loading state');
    assert.ok(dashboardSource.includes("const [epmSettingsProjectsError, setEpmSettingsProjectsError] = useState('');"), 'Expected settings-scoped EPM project preview error state');
    assert.ok(dashboardSource.includes("const [epmRootGoalsLoading, setEpmRootGoalsLoading] = useState(false);"), 'Expected root goal loading state');
    assert.ok(dashboardSource.includes("const [epmSubGoalsLoading, setEpmSubGoalsLoading] = useState(false);"), 'Expected sub-goal loading state');
    assert.ok(dashboardSource.includes("const [epmRootGoalsError, setEpmRootGoalsError] = useState('');"), 'Expected root goal error state');
    assert.ok(dashboardSource.includes("const [epmSubGoalsError, setEpmSubGoalsError] = useState('');"), 'Expected sub-goal error state');
    assert.ok(dashboardSource.includes("const [epmRootGoalOpen, setEpmRootGoalOpen] = useState(false);"), 'Expected root goal dropdown open state');
    assert.ok(dashboardSource.includes("const [epmSubGoalOpen, setEpmSubGoalOpen] = useState(false);"), 'Expected sub-goal dropdown open state');
    assert.ok(dashboardSource.includes('const epmProjectsRequestIdRef = useRef(0);'), 'Expected stale-response guard ref for EPM project refreshes');
    assert.ok(dashboardSource.includes('const epmSubGoalsRequestIdRef = useRef(0);'), 'Expected stale-response guard ref for sub-goal fetches');
    assert.ok(dashboardSource.includes('if (epmProjectsRequestIdRef.current !== requestId) {'), 'Expected stale-response guard branch for EPM project refreshes');
    assert.ok(dashboardSource.includes('if (epmSubGoalsRequestIdRef.current !== requestId) {'), 'Expected stale-response guard branch for sub-goal fetches');
    assert.ok(dashboardSource.includes('const config = await loadEpmConfig();'), 'Expected config load to remain independent');
    assert.ok(dashboardSource.includes('const scopeMeta = await loadEpmScopeMeta();'), 'Expected scope metadata load to be handled separately');
    assert.ok(dashboardSource.includes('const rootGoalsPayload = await loadEpmGoals();'), 'Expected root-goal discovery load to be handled separately');
    assert.ok(dashboardSource.includes('const clearEpmRootGoal = () => {'), 'Expected root clear handler');
    assert.ok(dashboardSource.includes('const clearEpmSubGoal = () => {'), 'Expected explicit sub-goal clear handler');
    assert.ok(dashboardSource.includes('const hasDraftEpmScope = React.useMemo(() => {'), 'Expected draft-driven EPM scope helper for settings modal state');
    assert.ok(dashboardSource.includes('const showEpmRootGoalResults = epmRootGoalOpen &&') && dashboardSource.includes('Boolean(epmRootGoalsError)') && dashboardSource.includes('epmRootGoals.length === 0'), 'Expected root goal result panel gating to include error-only and empty-catalog states');
    assert.ok(dashboardSource.includes('const showEpmSubGoalResults = epmSubGoalOpen &&') && dashboardSource.includes('Boolean(epmSubGoalsError)') && dashboardSource.includes('epmSubGoals.length === 0'), 'Expected sub-goal result panel gating to include error-only and empty-catalog states');
    assert.ok(dashboardSource.includes('const handleEpmRootGoalSearchKeyDown = (event) => {'), 'Expected root goal keyboard handler');
    assert.ok(dashboardSource.includes('const handleEpmSubGoalSearchKeyDown = (event) => {'), 'Expected sub-goal keyboard handler');
    assert.ok(dashboardSource.includes('void saveEpmConfig().catch(() => {});'), 'Expected direct EPM save callers to consume rejections');
    assert.ok(dashboardSource.includes('if (isEpmConfigDirty) {') && dashboardSource.includes('await saveEpmConfig();'), 'Expected shared save path to persist EPM settings when dirty');
    assert.ok(dashboardSource.includes("setGroupDraftError(message);") && dashboardSource.includes('throw err;'), 'Expected EPM save failures to surface and block shared save');
    assert.ok(dashboardSource.includes('Atlassian site'), 'Expected Atlassian site copy');
    assert.ok(dashboardSource.includes('Root goal'), 'Expected Root goal copy');
    assert.ok(dashboardSource.includes('Sub-goal'), 'Expected Sub-goal copy');
    assert.ok(dashboardSource.includes('Label prefix'), 'Expected Label prefix copy');
    assert.ok(dashboardSource.includes('Project name'), 'Expected Project name copy');
    assert.ok(dashboardSource.includes('Select a root goal before choosing a sub-goal.'), 'Expected root-goal prerequisite helper copy');
    assert.ok(dashboardSource.includes('This sub-goal has no direct Jira Home projects. Choose a different child goal.'), 'Expected empty child-goal helper copy');
    assert.ok(dashboardSource.includes('Loading root goals...'), 'Expected root goal loading copy');
    assert.ok(dashboardSource.includes('Loading sub-goals...'), 'Expected sub-goal loading copy');
    assert.ok(dashboardSource.includes('setShowGroupManage(true);') && dashboardSource.includes('setGroupManageTab(\'epm\');'), 'Expected EPM settings open action to switch tabs without mutating main EPM project state');
    assert.ok(dashboardSource.includes("setEpmProjectsError(err?.message || 'Failed to load EPM projects.');"), 'Expected EPM project refresh failures to surface distinct settings-state copy');
    assert.ok(dashboardSource.includes('setEpmRootGoalsError(String(rootGoalsPayload?.error || \'\').trim());'), 'Expected handled root-goal discovery errors to surface in picker state');
    assert.ok(dashboardSource.includes('const lookupError = String(payload?.error || \'\').trim();') && dashboardSource.includes('setEpmSubGoalsError(lookupError);'), 'Expected handled sub-goal discovery errors to surface in picker state');
    assert.ok(dashboardSource.includes("setGroupDraftError('Failed to load EPM settings.');"), 'Expected config-load failures to clear stale EPM draft state and surface an error');
    assert.ok(dashboardSource.includes('if (!hasSavedEpmScope) {') && dashboardSource.includes('void refreshEpmProjects();'), 'Expected main EPM view fetch gating on saved scope');
    assert.ok(dashboardSource.includes('const refreshEpmView = async () => {') && dashboardSource.includes('if (!hasSavedEpmScope) {') && dashboardSource.includes('setEpmProjects([]);') && dashboardSource.includes('setEpmRollupTree(null);') && dashboardSource.includes('setEpmRollupLoading(false);'), 'Expected manual EPM refresh gating to clear stale project and rollup state without fetching');
    assert.ok(dashboardSource.includes('EPM projects'), 'Expected EPM projects copy');
    assert.ok(dashboardSource.includes('Add custom Project'), 'Expected Add custom Project button copy');
    assert.ok(dashboardSource.includes('Jira label'), 'Expected Jira label copy');
    assert.ok(!dashboardSource.includes('data-field="jiraEpicKey"'), 'Did not expect Jira epic key input field');
    assert.ok(!dashboardSource.includes('Jira epic'), 'Did not expect Jira Epic copy in EPM settings');
    assert.ok(dashboardSource.includes("const EPM_LABEL_SEARCH_GROUP_ID = 'epm-project';"), 'Expected dedicated EPM label search namespace constant');
    assert.ok(dashboardSource.includes('const getEpmLabelRowKey = (projectId) => getLabelRowKey(EPM_LABEL_SEARCH_GROUP_ID, projectId);'), 'Expected EPM label picker reads to use the dedicated shared key helper');
    assert.ok(dashboardSource.includes('void loadEpmProjectLabels(project.id, showAllLabels);'), 'Expected EPM label picker focus to load prefix-scoped labels');
    assert.ok(!dashboardSource.includes("scheduleJiraLabelSearch('epm', homeProjectId, rawQuery);"), 'Did not expect the legacy EPM label search namespace');
    assert.ok(dashboardSource.includes('Search Jira labels...'), 'Expected EPM Jira label search placeholder copy');
    assert.ok(dashboardSource.includes('fetch(`${BACKEND_URL}/api/jira/labels?prefix=${encodeURIComponent(prefix)}&limit=200`'), 'Expected EPM label autocomplete to use prefix and limit=200');
    assert.ok(dashboardSource.includes('fetch(`${BACKEND_URL}/api/jira/labels?limit=200`'), 'Expected Show all labels to query without prefix and with limit=200');
    assert.ok(dashboardSource.includes('Show all labels'), 'Expected Show all labels toggle copy');
    assert.ok(dashboardSource.includes('Change label'), 'Expected selected labels to expose an explicit Change action');
    assert.ok(dashboardSource.includes('Choose label'), 'Expected unlabeled rows to expose an explicit Choose label action');
    assert.ok(dashboardSource.includes('const isChangingLabel = Boolean(epmLabelChanging[rowKey]);'), 'Expected label search field to be gated behind explicit Change state');
    assert.ok(dashboardSource.includes('{isChangingLabel && ('), 'Expected label search field to render only after explicit Choose or Change');
    assert.ok(dashboardSource.includes('No Jira label selected.'), 'Expected EPM empty Jira label state copy');
    assert.ok(dashboardSource.includes('placeholder={project.homeName || project.name || \'Project name\'}'), 'Expected name placeholder to default from the Home project name');
    assert.ok(dashboardSource.includes("name: String(row?.name ?? ''),"), 'Expected name field to be persisted exactly as typed');
    assert.ok(dashboardSource.includes("label: String(row?.label ?? ''),"), 'Expected label field to be persisted exactly as typed');
    assert.ok(dashboardSource.includes("const draftId = `draft-${Date.now().toString(36)}-${epmDraftIdCounterRef.current}`;"), 'Expected custom Project draft rows to use stable draft-* ids');
    assert.ok(dashboardSource.includes('homeProjectId: null,'), 'Expected custom Project rows to carry null Home linkage before save');
    assert.ok(!dashboardSource.includes('mock-input'), 'Did not expect mock-input class');
    assert.ok(dashboardSource.includes('const epmSettingsProjectsCacheRef = useRef(new Map());'), 'Expected settings project cache');
    assert.ok(dashboardSource.includes('const epmSettingsProjectsCacheKey = React.useMemo(() => getEpmSettingsProjectsCacheKey(epmConfigDraft), [epmConfigDraft]);'), 'Expected settings project cache key');
    assert.ok(dashboardSource.includes('const ensureEpmSettingsProjectsLoaded = async (options = {}) => {'), 'Expected automatic settings project loader');
    assert.ok(dashboardSource.includes("if (!showGroupManage || groupManageTab !== 'epm' || epmSettingsTab !== 'projects') return;"), 'Expected Projects tab scoped auto-load effect');
    assert.ok(dashboardSource.includes('void ensureEpmSettingsProjectsLoaded({'), 'Expected Projects tab to auto-load projects with a stable draft snapshot');
    assert.ok(dashboardSource.includes('draftConfig: draftSnapshot'), 'Expected Projects tab load to pass the draft snapshot');
    assert.ok(dashboardSource.includes('cacheKey: cacheKeySnapshot'), 'Expected Projects tab load to pass the matching cache key');
    assert.ok(!dashboardSource.includes('Run Test Configuration to preview projects for the selected draft scope.'), 'Project tab must not require manual preview before showing rows');
    assert.ok(!dashboardSource.includes("groupManageTab === 'epm' && epmSettingsTab === 'projects' && (\\n    <div className=\"group-modal-button-row\">"), 'EPM project refresh must not live in modal footer');
    assert.ok(dashboardSource.includes('className="epm-projects-header-actions"'), 'Expected Projects header actions for refresh/status');
    assert.ok(dashboardSource.includes('Refresh from Jira Home'), 'Expected Projects header refresh action');
    assert.ok(dashboardSource.includes('epmSettingsProjectsLoadedAt'), 'Expected cached/last-loaded status state');
    assert.ok(dashboardSource.includes('epmSettingsProjectsFetchMeta'), 'Expected Home project fetch metadata state');
    assert.ok(dashboardSource.includes('epmSettingsProjectsRefreshing'), 'Expected refresh state that preserves rows');
    assert.ok(dashboardSource.includes('missingFromHomeFetch'), 'Expected missing Home project reconciliation state');
    assert.ok(dashboardSource.includes('const getHomeBackedEpmSettingsProjects = (projects) => {'), 'Expected settings project cache to exclude custom rows rendered from config');
    assert.ok(dashboardSource.includes('epm-project-skeleton-row'), 'Expected skeleton loading rows');
    assert.ok(dashboardSource.includes('Retry'), 'Expected inline retry action for project load errors');
    assert.ok(!dashboardSource.includes('epmSettingsPreviewRequested'), 'EPM project configuration must not use preview-request state');
    assert.ok(!dashboardSource.includes('loadEpmProjectPreview'), 'EPM project configuration must not use preview-named loaders');
    assert.ok(dashboardSource.includes('const [epmSettingsProjectsLoaded, setEpmSettingsProjectsLoaded] = useState(false);'), 'Expected loaded-state for project configuration rows');
    assert.ok(dashboardSource.includes('const updateEpmSettingsProjectRowsAfterSave = (savedConfig) => {'), 'Expected save path to reconcile settings rows after custom id rekeying');
});

test('EPM project utility hydrates display name without persisting Home fallback', () => {
    const utilsPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'epmProjectUtils.mjs');
    const utilsSource = fs.readFileSync(utilsPath, 'utf8');

    assert.ok(utilsSource.includes('export function getEpmProjectIdentity(project) {'), 'Expected shared EPM project identity helper');
    assert.ok(utilsSource.includes("return String(project?.id || '').trim();"), 'Expected project identity to use project id only');
    assert.ok(!utilsSource.includes('project?.id || project?.homeProjectId'), 'Did not expect Home project id fallback in identity helper');
    assert.ok(utilsSource.includes('export function hydrateEpmProjectDraft(row, homeProject) {'), 'Expected hydrateEpmProjectDraft helper');
    assert.ok(utilsSource.includes("const name = draftName.trim() ? draftName : homeName;"), 'Expected draft name to fall back to Home project name');
    assert.ok(utilsSource.includes("const label = draftLabel.trim() ? draftLabel : homeLabel;"), 'Expected blank draft label to fall back to Home project label');
    assert.ok(utilsSource.includes("displayName: name || homeName || ''"), 'Expected displayName fallback to hydrated project name');
    assert.ok(!utilsSource.includes('customName'), 'Did not expect legacy customName fallback in EPM project utils');
});

test('Open Settings CTA opens the EPM Projects label tab', () => {
    const openSettingsStart = dashboardSource.indexOf('const openEpmSettingsTab = () => {');
    const openSettingsEnd = dashboardSource.indexOf('};', openSettingsStart);
    assert.notStrictEqual(openSettingsStart, -1, 'Expected EPM settings open helper');
    assert.notStrictEqual(openSettingsEnd, -1, 'Expected EPM settings open helper terminator');
    const openSettingsSource = dashboardSource.slice(openSettingsStart, openSettingsEnd);

    assert.ok(openSettingsSource.includes("setGroupManageTab('epm');"), 'Expected Open Settings to enter the EPM settings area');
    assert.ok(openSettingsSource.includes("setEpmSettingsTab('projects');"), 'Expected Open Settings to land on the Projects labels tab');
    assert.ok(!openSettingsSource.includes("setEpmSettingsTab('scope');"), 'Open Settings must not land on the Scope tab');
});

test('EPM project rows stay compact and show Home status instead of update snippets', () => {
    const projectsPanelStart = dashboardSource.indexOf('id="epm-settings-projects-panel"');
    const projectsPanelEnd = dashboardSource.indexOf('className="epm-project-empty-state"', projectsPanelStart);
    assert.notStrictEqual(projectsPanelStart, -1, 'Expected EPM projects settings panel');
    assert.notStrictEqual(projectsPanelEnd, -1, 'Expected EPM projects row list before empty state');
    const projectsPanelSource = dashboardSource.slice(projectsPanelStart, projectsPanelEnd);

    assert.ok(projectsPanelSource.includes('className="epm-project-settings-row"'), 'Expected compact one-row project layout');
    assert.ok(projectsPanelSource.includes('project.stateLabel || project.stateValue'), 'Expected Home project status beside the project name');
    assert.ok(projectsPanelSource.includes('Choose label'), 'Expected no-label rows to keep search behind an explicit compact action');
    assert.ok(!projectsPanelSource.includes('{(!currentLabel || isChangingLabel) && ('), 'Search input must not show by default for every no-label row');
    assert.ok(!projectsPanelSource.includes('project.latestUpdateDate && ('), 'Project rows must not render Home update snippets');
    assert.ok(!projectsPanelSource.includes("project.latestUpdateSnippet || 'No updates yet'"), 'Project rows must not show update text');
});

test('EPM selected Jira label has one explicit change action', () => {
    const selectedLabelStart = dashboardSource.indexOf('className="epm-label-selected-chip"');
    const selectedLabelEnd = dashboardSource.indexOf('{isChangingLabel && (', selectedLabelStart);
    assert.notStrictEqual(selectedLabelStart, -1, 'Expected compact selected label chip');
    assert.notStrictEqual(selectedLabelEnd, -1, 'Expected label search branch after selected chip');
    const selectedLabelSource = dashboardSource.slice(selectedLabelStart, selectedLabelEnd);

    assert.ok(selectedLabelSource.includes('Change label'), 'Expected one clear label-change action');
    assert.ok(!selectedLabelSource.includes('title="Remove label"'), 'Selected label chip must not also expose a duplicate x action');
    assert.ok(!selectedLabelSource.includes("updateEpmProjectDraft(project.id, 'label', '')"), 'Selected label chip must not clear the label through a duplicate x action');
});

test('dashboard source preserves saved EPM sub-goal on settings open', () => {
    const loadSettingsStart = dashboardSource.indexOf('const loadEpmSettings = async () => {');
    const loadSettingsEnd = dashboardSource.indexOf('loadEpmSettings();', loadSettingsStart);
    assert.ok(loadSettingsStart !== -1 && loadSettingsEnd !== -1, 'Expected EPM settings load effect block');
    const loadSettingsSource = dashboardSource.slice(loadSettingsStart, loadSettingsEnd);

    assert.ok(!loadSettingsSource.includes('clearEpmSubGoalOptions();'), 'EPM settings open must not clear saved sub-goal options');
    assert.ok(!loadSettingsSource.includes('loadEpmSubGoalsForRoot(rootGoalKey, savedSubGoalKey)'), 'EPM settings open must not refetch sub-goals just to render the saved chip');
    assert.ok(!loadSettingsSource.includes('resetEpmProjectPreview();'), 'EPM settings open must not use preview-named project reset state');
    assert.ok(!loadSettingsSource.includes('resetEpmSettingsProjectRows();'), 'EPM settings open must not erase cached project configuration rows');
    assert.ok(dashboardSource.includes('const epmSubGoalsCacheRef = useRef(new Map());'), 'Expected sub-goals cache by root goal');
    assert.ok(dashboardSource.includes('const resetEpmSettingsProjectRows = () => {'), 'Expected configuration-named project-row reset helper');
    assert.ok(dashboardSource.includes('return epmSubGoals.find((goal) => String(goal?.key || \'\').trim().toUpperCase() === key) || { key, name: key };'), 'Expected selected sub-goal fallback chip without refetch');
});

test('dashboard source clears EPM sub-goal only when root goal changes or user clears it', () => {
    const selectRootStart = dashboardSource.indexOf('const selectEpmRootGoal = async (goal) => {');
    const clearRootStart = dashboardSource.indexOf('const clearEpmRootGoal = () => {', selectRootStart);
    assert.ok(selectRootStart !== -1 && clearRootStart !== -1, 'Expected EPM root selection block');
    const selectRootSource = dashboardSource.slice(selectRootStart, clearRootStart);

    assert.ok(selectRootSource.includes('const rootChanged = previousRootGoalKey !== rootGoalKey;'), 'Expected same-root selection guard');
    assert.ok(selectRootSource.includes("subGoalKey: rootChanged ? '' : prev.scope?.subGoalKey || ''"), 'Expected sub-goal preservation when root did not change');
    assert.ok(selectRootSource.includes('if (rootChanged) {'), 'Expected sub-goal clear to be gated by actual root changes');
});

test('dashboard source separates EPM scope and project mapping tabs', () => {
    assert.ok(dashboardSource.includes("const [epmSettingsTab, setEpmSettingsTab] = useState('scope');"), 'Expected EPM-local settings tab state');
    assert.ok(dashboardSource.includes('const epmProjectPrerequisites = React.useMemo(() => getEpmProjectPrerequisites(epmConfigDraft), [epmConfigDraft]);'), 'Expected Projects prerequisite state');
    assert.ok(dashboardSource.includes("className={`group-modal-tab ${epmSettingsTab === 'scope' ? 'active' : ''}`"), 'Expected EPM Scope sub-tab button');
    assert.ok(dashboardSource.includes("className={`group-modal-tab ${epmSettingsTab === 'projects' ? 'active' : ''}`"), 'Expected EPM Projects sub-tab button');
    assert.ok(!dashboardSource.includes("disabled={!canOpenEpmProjectsTab}"), 'Projects tab must stay clickable and show prerequisites inside the panel');
    assert.ok(dashboardSource.includes('role="tablist"'), 'Expected accessible EPM settings tablist');
    assert.ok(dashboardSource.includes('role="tab"'), 'Expected accessible EPM settings tabs');
    assert.match(dashboardSource, /aria-selected=\{epmSettingsTab === ['"]scope['"]\}/, 'Expected scope tab selected state');
    assert.match(dashboardSource, /aria-selected=\{epmSettingsTab === ['"]projects['"]\}/, 'Expected projects tab selected state');
    assert.ok(dashboardSource.includes('aria-controls="epm-settings-projects-panel"'), 'Expected projects tab panel relationship');
    assert.ok(dashboardSource.includes('const handleEpmSettingsTabKeyDown = (event) => {'), 'Expected keyboard support for EPM sub-tabs');
    assert.ok(dashboardSource.includes('document.getElementById(`epm-settings-${tab}-tab`)'), 'Expected keyboard tab changes to preserve focus');
    assert.ok(dashboardSource.includes("epmSettingsTab === 'scope'"), 'Expected scope-only render branch');
    assert.ok(dashboardSource.includes("epmSettingsTab === 'projects'"), 'Expected projects-only render branch');
    assert.ok(dashboardSource.includes('Set sub-goal'), 'Expected prerequisite action for missing sub-goal');
    assert.ok(dashboardSource.includes('Set label prefix'), 'Expected prerequisite action for missing label prefix');
});

test('settings hotkey effect is declared after the save handlers it depends on', () => {
    const hotkeyEffectIndex = dashboardSource.indexOf("window.addEventListener('keydown', handleKey);");
    const saveEpmConfigIndex = dashboardSource.indexOf('const saveEpmConfig = async () => {');
    const saveGroupsConfigIndex = dashboardSource.indexOf('const saveGroupsConfig = async () => {');

    assert.ok(hotkeyEffectIndex !== -1, 'Expected settings hotkey effect in dashboard.jsx');
    assert.ok(saveEpmConfigIndex !== -1, 'Expected saveEpmConfig in dashboard.jsx');
    assert.ok(saveGroupsConfigIndex !== -1, 'Expected saveGroupsConfig in dashboard.jsx');
    assert.ok(hotkeyEffectIndex > saveEpmConfigIndex, 'Expected settings hotkey effect after saveEpmConfig');
    assert.ok(hotkeyEffectIndex > saveGroupsConfigIndex, 'Expected settings hotkey effect after saveGroupsConfig');
});
