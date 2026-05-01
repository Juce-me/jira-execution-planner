const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx');
const epmSettingsPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmSettings.jsx');
const settingsModalPath = path.join(__dirname, '..', 'frontend', 'src', 'settings', 'SettingsModal.jsx');
const teamGroupsSettingsPath = path.join(__dirname, '..', 'frontend', 'src', 'settings', 'TeamGroupsSettings.jsx');
const jiraFieldSettingsPath = path.join(__dirname, '..', 'frontend', 'src', 'settings', 'JiraFieldSettings.jsx');
const controlFieldPath = path.join(__dirname, '..', 'frontend', 'src', 'ui', 'ControlField.jsx');
const iconButtonPath = path.join(__dirname, '..', 'frontend', 'src', 'ui', 'IconButton.jsx');
const loadingRowsPath = path.join(__dirname, '..', 'frontend', 'src', 'ui', 'LoadingRows.jsx');
const emptyStatePath = path.join(__dirname, '..', 'frontend', 'src', 'ui', 'EmptyState.jsx');
const epmViewDataPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'useEpmViewData.js');
const epmControlsPath = path.join(__dirname, '..', 'frontend', 'src', 'epm', 'EpmControls.jsx');
const engViewPath = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngView.jsx');
const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');
const epmSettingsSource = fs.existsSync(epmSettingsPath) ? fs.readFileSync(epmSettingsPath, 'utf8') : '';
const settingsModalSource = fs.existsSync(settingsModalPath) ? fs.readFileSync(settingsModalPath, 'utf8') : '';
const teamGroupsSettingsSource = fs.existsSync(teamGroupsSettingsPath) ? fs.readFileSync(teamGroupsSettingsPath, 'utf8') : '';
const jiraFieldSettingsSource = fs.existsSync(jiraFieldSettingsPath) ? fs.readFileSync(jiraFieldSettingsPath, 'utf8') : '';
const epmSettingsUiSource = epmSettingsSource || dashboardSource;
const epmViewDataSource = fs.existsSync(epmViewDataPath) ? fs.readFileSync(epmViewDataPath, 'utf8') : '';
const epmControlsSource = fs.existsSync(epmControlsPath) ? fs.readFileSync(epmControlsPath, 'utf8') : '';
const engViewSource = fs.existsSync(engViewPath) ? fs.readFileSync(engViewPath, 'utf8') : '';

function extractShorthandSpreadProps(source) {
    const spreadStart = source.indexOf('{...{');
    const spreadEnd = source.lastIndexOf('}}');
    assert.notStrictEqual(spreadStart, -1, 'Expected JSX shorthand spread props');
    assert.notStrictEqual(spreadEnd, -1, 'Expected JSX shorthand spread props end');
    return source
        .slice(spreadStart + '{...{'.length, spreadEnd)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/,$/, ''))
        .filter((line) => /^[A-Za-z_$][\w$]*$/.test(line))
        .sort();
}

function extractDestructuredProps(source) {
    const destructureStart = source.indexOf('const {');
    const destructureEnd = source.indexOf('} = props;', destructureStart);
    assert.notStrictEqual(destructureStart, -1, 'Expected props destructuring');
    assert.notStrictEqual(destructureEnd, -1, 'Expected props destructuring end');
    return source
        .slice(destructureStart + 'const {'.length, destructureEnd)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/,$/, ''))
        .filter((line) => /^[A-Za-z_$][\w$]*$/.test(line))
        .sort();
}

test('settings modal shell and tab bodies are extracted while dashboard keeps settings state ownership', () => {
    const settingsModalCallStart = dashboardSource.indexOf('<SettingsModal');
    const settingsModalOpenTagEndMarker = '\n                        >';
    const settingsModalCallEnd = dashboardSource.indexOf(settingsModalOpenTagEndMarker, settingsModalCallStart);
    const settingsModalCallSource = settingsModalCallStart === -1 || settingsModalCallEnd === -1
        ? ''
        : dashboardSource.slice(settingsModalCallStart, settingsModalCallEnd);
    const settingsModalChildrenStart = settingsModalCallEnd === -1
        ? -1
        : settingsModalCallEnd + settingsModalOpenTagEndMarker.length;
    const settingsModalChildrenEnd = dashboardSource.indexOf('</SettingsModal>', settingsModalChildrenStart);
    const settingsModalChildrenSource = settingsModalChildrenStart === -1 || settingsModalChildrenEnd === -1
        ? ''
        : dashboardSource.slice(settingsModalChildrenStart, settingsModalChildrenEnd);
    const epmSettingsCallStart = dashboardSource.indexOf('<EpmSettings');
    const epmSettingsCallEnd = dashboardSource.indexOf('/>', epmSettingsCallStart);
    const epmSettingsCallSource = epmSettingsCallStart === -1 || epmSettingsCallEnd === -1
        ? ''
        : dashboardSource.slice(epmSettingsCallStart, epmSettingsCallEnd);
    const teamGroupsSettingsCallStart = dashboardSource.indexOf('<TeamGroupsSettings');
    const teamGroupsSettingsCallEnd = dashboardSource.indexOf('/>', teamGroupsSettingsCallStart);
    const teamGroupsSettingsCallSource = teamGroupsSettingsCallStart === -1 || teamGroupsSettingsCallEnd === -1
        ? ''
        : dashboardSource.slice(teamGroupsSettingsCallStart, teamGroupsSettingsCallEnd);
    const jiraFieldSettingsCallStart = dashboardSource.indexOf('<JiraFieldSettings');
    const jiraFieldSettingsCallEnd = dashboardSource.indexOf('/>', jiraFieldSettingsCallStart);
    const jiraFieldSettingsCallSource = jiraFieldSettingsCallStart === -1 || jiraFieldSettingsCallEnd === -1
        ? ''
        : dashboardSource.slice(jiraFieldSettingsCallStart, jiraFieldSettingsCallEnd);
    const epmSettingsPropsStart = epmSettingsSource.indexOf('const {');
    const epmSettingsPropsEnd = epmSettingsSource.indexOf('} = props;', epmSettingsPropsStart);
    const epmSettingsPropsSource = epmSettingsPropsStart === -1 || epmSettingsPropsEnd === -1
        ? ''
        : epmSettingsSource.slice(epmSettingsPropsStart, epmSettingsPropsEnd);

    assert.ok(fs.existsSync(settingsModalPath), 'Expected extracted SettingsModal shell component');
    assert.ok(settingsModalSource.includes('export default function SettingsModal'), 'Expected SettingsModal default component export');
    assert.ok(dashboardSource.includes("import SettingsModal from './settings/SettingsModal.jsx';"), 'Expected dashboard to import extracted SettingsModal shell');
    assert.ok(settingsModalCallSource.includes('activeTab={groupManageTab}'), 'Expected dashboard to pass active settings tab into SettingsModal');
    assert.ok(settingsModalCallSource.includes('tabs={settingsModalTabs}'), 'Expected dashboard to pass tab descriptors into SettingsModal');
    assert.ok(settingsModalCallSource.includes('isDirty={isGroupDraftDirty}'), 'Expected dashboard to pass dirty state into SettingsModal');
    assert.ok(settingsModalCallSource.includes('onRequestClose={requestCloseGroupManage}'), 'Expected backdrop close handling to stay wired through dashboard');
    assert.ok(settingsModalCallSource.includes('showDiscardConfirm={showGroupDiscardConfirm}'), 'Expected discard-confirm state to stay owned by dashboard');
    assert.ok(settingsModalCallSource.includes('onDiscard={discardGroupDraftChanges}'), 'Expected discard action to stay owned by dashboard');
    assert.ok(settingsModalCallSource.includes('saveDisabled={settingsSaveDisabled}'), 'Expected dashboard to own save disabled state');
    assert.ok(settingsModalCallSource.includes('saveTitle={settingsSaveTitle}'), 'Expected dashboard to own save title state');
    assert.ok(settingsModalCallSource.includes('validationMessages={groupConfigValidationErrors}'), 'Expected validation messages to render through the shell');
    assert.ok(settingsModalCallSource.includes('onCancel={requestCloseGroupManage}'), 'Expected dashboard to wire cancel through the shared close handler');
    assert.ok(settingsModalCallSource.includes('onSave={settingsSaveHandler}'), 'Expected dashboard to wire save through the tab-aware save handler');
    assert.ok(settingsModalCallSource.includes('onKeepEditing={() => setShowGroupDiscardConfirm(false)}'), 'Expected dashboard to hide discard confirmation from the shell');
    assert.ok(settingsModalSource.includes('className="group-modal-backdrop"'), 'Expected SettingsModal to own the backdrop');
    assert.ok(settingsModalSource.includes('className="group-modal-header"'), 'Expected SettingsModal to own the modal header');
    assert.ok(settingsModalSource.includes('className="group-modal-tabs"'), 'Expected SettingsModal to own the tab bar');
    assert.ok(settingsModalSource.includes('className="group-modal-footer"'), 'Expected SettingsModal to own the shared footer');
    assert.ok(settingsModalSource.includes('className="group-confirm-backdrop"'), 'Expected SettingsModal to own the discard confirmation shell');
    assert.ok(settingsModalSource.includes('onClick={onRequestClose}'), 'Expected backdrop click to call the dashboard close handler');
    assert.ok(settingsModalSource.includes('const handleCancel = onCancel || onRequestClose;'), 'Expected cancel to fall back to the dashboard close handler');
    assert.ok(settingsModalSource.includes('onClick={handleCancel}'), 'Expected cancel button to call the provided cancel handler');
    assert.ok(settingsModalSource.includes('onClick={onSave}'), 'Expected save button to call the provided save handler');
    assert.ok(settingsModalSource.includes('onClick={onDiscard}'), 'Expected discard button to call the provided discard handler');
    assert.ok(settingsModalSource.includes('onClick={onKeepEditing}'), 'Expected keep-editing actions to hide the discard confirmation');
    assert.ok(!dashboardSource.includes('className="group-modal-backdrop"'), 'Dashboard should delegate backdrop markup to SettingsModal');
    assert.ok(fs.existsSync(teamGroupsSettingsPath), 'Expected extracted TeamGroupsSettings component');
    assert.ok(fs.existsSync(jiraFieldSettingsPath), 'Expected extracted JiraFieldSettings component');
    assert.ok(teamGroupsSettingsSource.includes('export default function TeamGroupsSettings'), 'Expected TeamGroupsSettings default component export');
    assert.ok(jiraFieldSettingsSource.includes('export default function JiraFieldSettings'), 'Expected JiraFieldSettings default component export');
    assert.ok(dashboardSource.includes("import TeamGroupsSettings from './settings/TeamGroupsSettings.jsx';"), 'Expected dashboard to import TeamGroupsSettings');
    assert.ok(dashboardSource.includes("import JiraFieldSettings from './settings/JiraFieldSettings.jsx';"), 'Expected dashboard to import JiraFieldSettings');
    assert.ok(settingsModalChildrenSource.includes("groupManageTab === 'teams'") && settingsModalChildrenSource.includes('<TeamGroupsSettings'), 'Expected dashboard to delegate team group tab content');
    assert.ok(settingsModalChildrenSource.includes("groupManageTab === 'source'") && settingsModalChildrenSource.includes('<JiraFieldSettings'), 'Expected dashboard to delegate Jira source tab content');
    assert.ok(settingsModalChildrenSource.includes("groupManageTab === 'scope'") && settingsModalChildrenSource.includes('<JiraFieldSettings'), 'Expected dashboard to delegate Jira scope tab content');
    assert.ok(settingsModalChildrenSource.includes("groupManageTab === 'mapping'") && settingsModalChildrenSource.includes('<JiraFieldSettings'), 'Expected dashboard to delegate Jira mapping tab content');
    assert.ok(settingsModalChildrenSource.includes("groupManageTab === 'capacity'") && settingsModalChildrenSource.includes('<JiraFieldSettings'), 'Expected dashboard to delegate Jira capacity tab content');
    assert.ok(settingsModalChildrenSource.includes("groupManageTab === 'priorityWeights'") && settingsModalChildrenSource.includes('<JiraFieldSettings'), 'Expected dashboard to delegate priority weights tab content');
    assert.ok(settingsModalChildrenSource.includes("groupManageTab === 'labels'"), 'Expected group label tab content to stay in dashboard');
    assert.ok(!teamGroupsSettingsSource.includes('useState('), 'TeamGroupsSettings must not own settings state');
    assert.ok(!jiraFieldSettingsSource.includes('useState('), 'JiraFieldSettings must not own settings state');
    assert.ok(dashboardSource.includes("const [teamSearchQuery, setTeamSearchQuery] = useState({});"), 'Expected dashboard to keep team search state ownership');
    assert.ok(dashboardSource.includes('const handleTeamSearchChange = (groupId, value) => {'), 'Expected dashboard to keep team search handler ownership');
    assert.ok(dashboardSource.includes("const [projectSearchQuery, setProjectSearchQuery] = useState('');"), 'Expected dashboard to keep project search state ownership');
    assert.ok(dashboardSource.includes("const [boardSearchQuery, setBoardSearchQuery] = useState('');"), 'Expected dashboard to keep board search state ownership');
    assert.ok(dashboardSource.includes('const [priorityWeightsDraft, setPriorityWeightsDraft] = useState(() => clonePriorityWeightRows(DEFAULT_PRIORITY_WEIGHT_ROWS));'), 'Expected dashboard to keep priority weight draft ownership');
    assert.deepStrictEqual(
        extractShorthandSpreadProps(teamGroupsSettingsCallSource),
        extractDestructuredProps(teamGroupsSettingsSource),
        'Expected TeamGroupsSettings passed props to match received props exactly'
    );
    assert.deepStrictEqual(
        extractShorthandSpreadProps(jiraFieldSettingsCallSource),
        extractDestructuredProps(jiraFieldSettingsSource),
        'Expected JiraFieldSettings passed props to match received props exactly'
    );
    ['activeGroupDraft', 'teamSearchOpen', 'activeTeamQuery', 'removeTeamFromGroup', 'showGroupAdvanced', 'groupImportText'].forEach((propName) => {
        assert.ok(teamGroupsSettingsCallSource.includes(`${propName},`), `Expected dashboard to pass ${propName} into TeamGroupsSettings`);
        assert.ok(teamGroupsSettingsSource.includes(`${propName},`), `Expected TeamGroupsSettings to receive ${propName}`);
    });
    ['groupManageTab', 'selectedProjectsDraft', 'jiraProjects', 'projectSearchQuery', 'boardSearchQuery', 'parentNameFieldSearchQuery', 'storyPointsFieldSearchQuery', 'capacityProjectSearchQuery', 'capacityFieldSearchQuery', 'priorityWeightsDraft'].forEach((propName) => {
        assert.ok(jiraFieldSettingsCallSource.includes(`${propName},`), `Expected dashboard to pass ${propName} into JiraFieldSettings`);
        assert.ok(jiraFieldSettingsSource.includes(`${propName},`), `Expected JiraFieldSettings to receive ${propName}`);
    });
    assert.ok(teamGroupsSettingsSource.includes('className="selected-team-chip"'), 'Expected selected team chip markup in TeamGroupsSettings');
    assert.ok(teamGroupsSettingsSource.includes('removeTeamFromGroup(activeGroupDraft.id, teamId)'), 'Expected selected team remove behavior in TeamGroupsSettings');
    assert.ok(teamGroupsSettingsSource.includes('teamSearchOpen[activeGroupDraft.id] && activeTeamQuery.trim()'), 'Expected team search result gating in TeamGroupsSettings');
    assert.ok(jiraFieldSettingsSource.includes('className="selected-team-chip"'), 'Expected selected Jira source chips in JiraFieldSettings');
    assert.ok(jiraFieldSettingsSource.includes('removeProjectSelection(p.key)'), 'Expected selected project remove behavior in JiraFieldSettings');
    assert.ok(jiraFieldSettingsSource.includes('onClick={clearBoardSelection}'), 'Expected board selected-chip remove behavior in JiraFieldSettings');
    assert.ok(jiraFieldSettingsSource.includes("setStoryPointsFieldIdDraft(''); setStoryPointsFieldNameDraft('');"), 'Expected story points field remove behavior in JiraFieldSettings');
    assert.ok(jiraFieldSettingsSource.includes("setCapacityFieldIdDraft(''); setCapacityFieldNameDraft('');"), 'Expected capacity field remove behavior in JiraFieldSettings');
    assert.ok(fs.existsSync(epmSettingsPath), 'Expected extracted EpmSettings component');
    assert.ok(epmSettingsSource.includes('export default function EpmSettings'), 'Expected EpmSettings default component export');
    assert.ok(dashboardSource.includes("import EpmSettings from './epm/EpmSettings.jsx';"), 'Expected dashboard to import extracted EPM settings');
    assert.ok(dashboardSource.includes("groupManageTab === 'epm'") && dashboardSource.includes('<EpmSettings'), 'Expected dashboard shell to render EpmSettings for the EPM tab');
    assert.ok(dashboardSource.includes("const [epmSettingsTab, setEpmSettingsTab] = useState('scope');"), 'Expected dashboard to keep EPM settings tab state ownership');
    assert.ok(dashboardSource.includes('const saveEpmConfig = async () => {'), 'Expected dashboard to keep EPM save ownership');
    ['epmConfigLoading', 'epmConfigSaving', 'focusEpmScopeField'].forEach((propName) => {
        assert.ok(epmSettingsCallSource.includes(`${propName},`), `Expected dashboard to pass ${propName} into EpmSettings`);
        assert.ok(epmSettingsPropsSource.includes(`${propName},`), `Expected EpmSettings to receive ${propName}`);
    });
    assert.ok(epmSettingsSource.includes('id="epm-settings-scope-panel"'), 'Expected scope panel markup in EpmSettings');
    assert.ok(epmSettingsSource.includes('id="epm-settings-projects-panel"'), 'Expected projects panel markup in EpmSettings');
    assert.ok(epmSettingsSource.includes('epm-label-menu-layer'), 'Expected EPM label menu layer in EpmSettings');
});

test('dashboard source includes the EPM settings tab and lazy-load flow', () => {
    assert.ok(dashboardSource.includes("groupManageTab === 'epm'"), 'Expected an EPM settings tab branch');
    assert.ok(fs.existsSync(epmViewDataPath), 'Expected EPM view data hook');
    assert.ok(dashboardSource.includes("const DEFAULT_EPM_LABEL_PREFIX = 'rnd_project_';"), 'Expected EPM label prefix default');
    assert.ok(dashboardSource.includes("const [epmConfigDraft, setEpmConfigDraft] = useState(createEmptyEpmConfigDraft());"), 'Expected EPM config draft state');
    assert.ok(dashboardSource.includes("const epmConfigBaselineRef = useRef(JSON.stringify(createEmptyEpmConfigDraft()));"), 'Expected EPM config baseline tracking');
    assert.ok(epmViewDataSource.includes("const [epmProjectsError, setEpmProjectsError] = useState('');"), 'Expected EPM project error state');
    assert.ok(dashboardSource.includes('const isEpmConfigDirty = React.useMemo(() => {'), 'Expected EPM dirty-state tracking');
    assert.ok(dashboardSource.includes('if (isEpmConfigDirty) return true;'), 'Expected EPM dirty-state participation in modal dirty checks');
    assert.ok(dashboardSource.includes('isEpmConfigDirty,'), 'Expected EPM dirty-state participation in unsaved section counting');
    assert.ok(dashboardSource.includes('const loadEpmConfig = () => fetchEpmConfig(BACKEND_URL);'), 'Expected EPM config loader wrapper');
    assert.ok(dashboardSource.includes('const loadEpmScopeMeta = () => fetchEpmScope(BACKEND_URL);'), 'Expected EPM scope metadata loader wrapper');
    assert.ok(dashboardSource.includes('const loadEpmGoals = (rootGoalKey = \'\') => fetchEpmGoals(BACKEND_URL, rootGoalKey);'), 'Expected EPM goals loader wrapper');
    assert.ok(epmViewDataSource.includes('fetchEpmProjects(backendUrl, { tab });'), 'Expected tab-scoped EPM projects loader');
    assert.ok(dashboardSource.includes('const saveEpmConfig = async () => {'), 'Expected EPM config saver');
    assert.ok(dashboardSource.includes('const normalizeEpmConfigDraft = (config) => {'), 'Expected EPM config normalizer');
    assert.ok(dashboardSource.includes('const hasSavedEpmScopeConfig = (config) => {'), 'Expected saved-scope helper');
    assert.ok(dashboardSource.includes('const updateEpmScopeDraft = (field, value) => {'), 'Expected EPM scope draft mutator');
    assert.ok(dashboardSource.includes('const updateEpmProjectDraft = (projectId, field, value) => {'), 'Expected inline EPM draft mutator');
    assert.ok(dashboardSource.includes('const updateEpmLabelPrefixDraft = (value) => {'), 'Expected EPM label prefix mutator');
    assert.ok(dashboardSource.includes('const addCustomEpmProjectDraft = () => {'), 'Expected custom EPM project draft creator');
    assert.ok(dashboardSource.includes('const removeEpmProjectDraft = (projectId) => {'), 'Expected EPM project draft removal');
    assert.ok(epmViewDataSource.includes('getEpmProjectIdentity(project) === epmSelectedProjectId'), 'Expected main EPM selected project lookup to use the shared project identity');
    assert.ok(epmViewDataSource.includes('const currentProjectId = projectIdOverride || getEpmProjectIdentity(currentProject);'), 'Expected EPM issue fetch to use the shared project identity');
    assert.ok(epmControlsSource.includes('const projectId = getEpmProjectIdentity(project);'), 'Expected EPM project picker options to use the shared project identity');
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
    assert.ok(epmViewDataSource.includes('const epmProjectsRequestIdRef = useRef(0);'), 'Expected stale-response guard ref for EPM project refreshes');
    assert.ok(dashboardSource.includes('const epmSubGoalsRequestIdRef = useRef(0);'), 'Expected stale-response guard ref for sub-goal fetches');
    assert.ok(epmViewDataSource.includes('if (epmProjectsRequestIdRef.current !== requestId) {'), 'Expected stale-response guard branch for EPM project refreshes');
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
    assert.ok(epmSettingsUiSource.includes('Atlassian site'), 'Expected Atlassian site copy');
    assert.ok(epmSettingsUiSource.includes('Root goal'), 'Expected Root goal copy');
    assert.ok(epmSettingsUiSource.includes('Sub-goal'), 'Expected Sub-goal copy');
    assert.ok(epmSettingsUiSource.includes('Label prefix'), 'Expected Label prefix copy');
    assert.ok(epmSettingsUiSource.includes('Project name'), 'Expected Project name copy');
    assert.ok(epmSettingsUiSource.includes('Select a root goal before choosing a sub-goal.'), 'Expected root-goal prerequisite helper copy');
    assert.ok(epmSettingsUiSource.includes('This sub-goal has no direct Jira Home projects. Choose a different child goal.'), 'Expected empty child-goal helper copy');
    assert.ok(epmSettingsUiSource.includes('Loading root goals...'), 'Expected root goal loading copy');
    assert.ok(epmSettingsUiSource.includes('Loading sub-goals...'), 'Expected sub-goal loading copy');
    assert.ok(dashboardSource.includes('setShowGroupManage(true);') && dashboardSource.includes('setGroupManageTab(\'epm\');'), 'Expected EPM settings open action to switch tabs without mutating main EPM project state');
    assert.ok(epmViewDataSource.includes("setEpmProjectsError(err?.message || 'Failed to load EPM projects.');"), 'Expected EPM project refresh failures to surface distinct settings-state copy');
    assert.ok(dashboardSource.includes('setEpmRootGoalsError(String(rootGoalsPayload?.error || \'\').trim());'), 'Expected handled root-goal discovery errors to surface in picker state');
    assert.ok(dashboardSource.includes('const lookupError = String(payload?.error || \'\').trim();') && dashboardSource.includes('setEpmSubGoalsError(lookupError);'), 'Expected handled sub-goal discovery errors to surface in picker state');
    assert.ok(dashboardSource.includes("setGroupDraftError('Failed to load EPM settings.');"), 'Expected config-load failures to clear stale EPM draft state and surface an error');
    assert.ok(epmViewDataSource.includes('if (!hasSavedEpmScope) {') && epmViewDataSource.includes('void refreshEpmView();'), 'Expected main EPM view fetch gating on saved scope');
    assert.ok(epmViewDataSource.includes('const refreshEpmView = React.useCallback(async () => {') && epmViewDataSource.includes('if (!hasSavedEpmScope) {') && epmViewDataSource.includes('setEpmProjects([]);') && epmViewDataSource.includes('setEpmRollupTree(null);') && epmViewDataSource.includes('setEpmRollupLoading(false);'), 'Expected manual EPM refresh gating to clear stale project and rollup state without fetching');
    assert.ok(epmSettingsUiSource.includes('EPM projects'), 'Expected EPM projects copy');
    assert.ok(epmSettingsUiSource.includes('Add custom Project'), 'Expected Add custom Project button copy');
    assert.ok(epmSettingsUiSource.includes('Jira label'), 'Expected Jira label copy');
    assert.ok(!epmSettingsUiSource.includes('data-field="jiraEpicKey"'), 'Did not expect Jira epic key input field');
    assert.ok(!epmSettingsUiSource.includes('Jira epic'), 'Did not expect Jira Epic copy in EPM settings');
    assert.ok(dashboardSource.includes("const EPM_LABEL_SEARCH_GROUP_ID = 'epm-project';"), 'Expected dedicated EPM label search namespace constant');
    assert.ok(dashboardSource.includes('const getEpmLabelRowKey = (projectId) => getLabelRowKey(EPM_LABEL_SEARCH_GROUP_ID, projectId);'), 'Expected EPM label picker reads to use the dedicated shared key helper');
    assert.ok(epmSettingsUiSource.includes('void loadEpmProjectLabels(project.id, showAllLabels);'), 'Expected EPM label picker focus to load prefix-scoped labels');
    assert.ok(!dashboardSource.includes("scheduleJiraLabelSearch('epm', homeProjectId, rawQuery);"), 'Did not expect the legacy EPM label search namespace');
    assert.ok(epmSettingsUiSource.includes('Search Jira labels...'), 'Expected EPM Jira label search placeholder copy');
    assert.ok(dashboardSource.includes('requestJiraLabels(BACKEND_URL, showAll || !prefix'), 'Expected EPM label autocomplete to use the Jira label request wrapper');
    assert.ok(dashboardSource.includes('? { limit: 200 }') && dashboardSource.includes(': { prefix, limit: 200 }'), 'Expected EPM label autocomplete to preserve prefix/show-all limit=200 behavior');
    assert.ok(epmSettingsUiSource.includes('Show all labels'), 'Expected Show all labels toggle copy');
    assert.ok(epmSettingsUiSource.includes('Change label'), 'Expected selected labels to expose an explicit Change action');
    assert.ok(epmSettingsUiSource.includes('Choose label'), 'Expected unlabeled rows to expose an explicit Choose label action');
    assert.ok(epmSettingsUiSource.includes('const isChangingLabel = Boolean(epmLabelChanging[rowKey]);'), 'Expected label search field to be gated behind explicit Change state');
    assert.ok(epmSettingsUiSource.includes('{isChangingLabel && ('), 'Expected label search field to render only after explicit Choose or Change');
    assert.ok(epmSettingsUiSource.includes('No Jira label selected.'), 'Expected EPM empty Jira label state copy');
    assert.ok(epmSettingsUiSource.includes('placeholder={project.homeName || project.name || \'Project name\'}'), 'Expected name placeholder to default from the Home project name');
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
    assert.ok(epmSettingsUiSource.includes('className="epm-projects-header-actions"'), 'Expected Projects header actions for refresh/status');
    assert.ok(epmSettingsUiSource.includes('Refresh from Jira Home'), 'Expected Projects header refresh action');
    assert.ok(dashboardSource.includes('epmSettingsProjectsLoadedAt'), 'Expected cached/last-loaded status state');
    assert.ok(dashboardSource.includes('epmSettingsProjectsFetchMeta'), 'Expected Home project fetch metadata state');
    assert.ok(dashboardSource.includes('epmSettingsProjectsRefreshing'), 'Expected refresh state that preserves rows');
    assert.ok(epmSettingsUiSource.includes('missingFromHomeFetch'), 'Expected missing Home project reconciliation state');
    assert.ok(dashboardSource.includes('const getHomeBackedEpmSettingsProjects = (projects) => {'), 'Expected settings project cache to exclude custom rows rendered from config');
    assert.ok(dashboardSource.includes('epm-project-skeleton-row'), 'Expected skeleton loading rows');
    assert.ok(epmSettingsUiSource.includes('Retry'), 'Expected inline retry action for project load errors');
    assert.ok(!dashboardSource.includes('epmSettingsPreviewRequested'), 'EPM project configuration must not use preview-request state');
    assert.ok(!dashboardSource.includes('loadEpmProjectPreview'), 'EPM project configuration must not use preview-named loaders');
    assert.ok(dashboardSource.includes('const [epmSettingsProjectsLoaded, setEpmSettingsProjectsLoaded] = useState(false);'), 'Expected loaded-state for project configuration rows');
    assert.ok(dashboardSource.includes('const updateEpmSettingsProjectRowsAfterSave = (savedConfig) => {'), 'Expected save path to reconcile settings rows after custom id rekeying');
});

test('EPM settings source uses shared basic UI primitives for representative rows and states', () => {
    assert.ok(fs.existsSync(controlFieldPath), 'Expected shared ControlField primitive');
    assert.ok(fs.existsSync(iconButtonPath), 'Expected shared IconButton primitive');
    assert.ok(fs.existsSync(loadingRowsPath), 'Expected shared LoadingRows primitive');
    assert.ok(fs.existsSync(emptyStatePath), 'Expected shared EmptyState primitive');
    assert.ok(dashboardSource.includes("import ControlField from './ui/ControlField.jsx';"), 'Expected dashboard to import ControlField');
    assert.ok(dashboardSource.includes("import IconButton from './ui/IconButton.jsx';"), 'Expected dashboard to import IconButton');
    assert.ok(dashboardSource.includes("import LoadingRows from './ui/LoadingRows.jsx';"), 'Expected dashboard to import LoadingRows');
    assert.ok(dashboardSource.includes("import EmptyState from './ui/EmptyState.jsx';"), 'Expected dashboard to import EmptyState');
    assert.ok(dashboardSource.includes('<ControlField label="Search"'), 'Expected header search control to use ControlField');
    assert.ok(epmControlsSource.includes('<ControlField label="Project"'), 'Expected EPM project picker control to use ControlField');
    assert.ok(epmSettingsUiSource.includes('<IconButton') && epmSettingsUiSource.includes('className="epm-label-change-shortcut"'), 'Expected selected-label change action to use IconButton');
    assert.ok(epmSettingsUiSource.includes('<IconButton') && epmSettingsUiSource.includes('className="epm-project-home-shortcut"'), 'Expected Home project shortcut to use IconButton');
    assert.ok(dashboardSource.includes('<LoadingRows') && dashboardSource.includes('ariaLabel="Loading EPM projects"'), 'Expected EPM project skeleton rows to use LoadingRows');
    assert.ok(engViewSource.includes('<EmptyState') && engViewSource.includes('title="No tasks found"'), 'Expected task empty state to use EmptyState');
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
    const projectsPanelStart = epmSettingsUiSource.indexOf('id="epm-settings-projects-panel"');
    const projectsPanelEnd = epmSettingsUiSource.indexOf('className="epm-project-empty-state"', projectsPanelStart);
    assert.notStrictEqual(projectsPanelStart, -1, 'Expected EPM projects settings panel');
    assert.notStrictEqual(projectsPanelEnd, -1, 'Expected EPM projects row list before empty state');
    const projectsPanelSource = epmSettingsUiSource.slice(projectsPanelStart, projectsPanelEnd);

    assert.ok(projectsPanelSource.includes('className="epm-project-settings-row"'), 'Expected compact one-row project layout');
    assert.ok(projectsPanelSource.includes('project.stateLabel || project.stateValue'), 'Expected Home project status beside the project name');
    assert.ok(projectsPanelSource.includes('Choose label'), 'Expected no-label rows to keep search behind an explicit compact action');
    assert.ok(!projectsPanelSource.includes('{(!currentLabel || isChangingLabel) && ('), 'Search input must not show by default for every no-label row');
    assert.ok(!projectsPanelSource.includes('project.latestUpdateDate && ('), 'Project rows must not render Home update snippets');
    assert.ok(!projectsPanelSource.includes("project.latestUpdateSnippet || 'No updates yet'"), 'Project rows must not show update text');
});

test('EPM project rows use stable cells for variable statuses and labels', () => {
    const projectsPanelStart = epmSettingsUiSource.indexOf('id="epm-settings-projects-panel"');
    const projectsPanelEnd = epmSettingsUiSource.indexOf('className="epm-project-empty-state"', projectsPanelStart);
    assert.notStrictEqual(projectsPanelStart, -1, 'Expected EPM projects settings panel');
    assert.notStrictEqual(projectsPanelEnd, -1, 'Expected EPM projects row list before empty state');
    const projectsPanelSource = epmSettingsUiSource.slice(projectsPanelStart, projectsPanelEnd);

    assert.ok(projectsPanelSource.includes('className="epm-project-settings-table"'), 'Expected table-style project settings layout');
    assert.ok(projectsPanelSource.includes('className="epm-project-table-header"'), 'Expected table-style project settings header');
    assert.ok(projectsPanelSource.includes('className="epm-project-name-cell"'), 'Expected project names to live in a stable row cell');
    assert.ok(projectsPanelSource.includes('className="epm-project-status-cell"'), 'Expected Home statuses to live in a stable row cell');
    assert.ok(projectsPanelSource.includes('className="epm-project-label-cell"'), 'Expected Jira labels to live in a bounded row cell');
    assert.ok(!projectsPanelSource.includes('className="epm-project-open-cell"'), 'Home must not be a standalone table column');
});

test('EPM project Home links render as compact shortcut icons', () => {
    const projectsPanelStart = epmSettingsUiSource.indexOf('id="epm-settings-projects-panel"');
    const projectsPanelEnd = epmSettingsUiSource.indexOf('className="epm-project-empty-state"', projectsPanelStart);
    assert.notStrictEqual(projectsPanelStart, -1, 'Expected EPM projects settings panel');
    assert.notStrictEqual(projectsPanelEnd, -1, 'Expected EPM projects row list before empty state');
    const projectsPanelSource = epmSettingsUiSource.slice(projectsPanelStart, projectsPanelEnd);

    assert.ok(projectsPanelSource.includes('className="epm-project-home-shortcut"'), 'Expected Home project link to use compact shortcut styling');
    assert.ok(projectsPanelSource.includes('aria-label={`Open Jira Home project for ${project.displayName || project.homeName || project.id}`}'), 'Expected Home shortcut to keep an accessible project-specific label');
    assert.ok(projectsPanelSource.includes('M7 17L17 7'), 'Expected shortcut to use an external-link glyph');
    assert.ok(projectsPanelSource.indexOf('className="epm-project-home-shortcut"') > projectsPanelSource.indexOf('className="epm-project-name-cell"'), 'Expected Home shortcut to render inside/near the project name cell');
    assert.ok(!projectsPanelSource.includes('>Open<'), 'Home shortcut should not render noisy Open text');
});

test('EPM project rows expose table header sorting and view controls', () => {
    const projectsPanelStart = epmSettingsUiSource.indexOf('id="epm-settings-projects-panel"');
    const projectsPanelEnd = epmSettingsUiSource.indexOf('className="epm-project-empty-state"', projectsPanelStart);
    assert.notStrictEqual(projectsPanelStart, -1, 'Expected EPM projects settings panel');
    assert.notStrictEqual(projectsPanelEnd, -1, 'Expected EPM projects row list before empty state');
    const projectsPanelSource = epmSettingsUiSource.slice(projectsPanelStart, projectsPanelEnd);

    assert.ok(dashboardSource.includes('sortEpmSettingsProjects'), 'Expected dashboard to import the settings project sorter');
    assert.ok(dashboardSource.includes('filterEpmSettingsProjectsForView'), 'Expected dashboard to import the settings project view filter');
    assert.ok(dashboardSource.includes("const [epmSettingsProjectSort, setEpmSettingsProjectSort] = useState('status');"), 'Expected settings project sort to default to status');
    assert.ok(dashboardSource.includes("const [epmSettingsProjectView, setEpmSettingsProjectView] = useState('current');"), 'Expected settings project view to default to current');
    assert.ok(dashboardSource.includes('filterEpmSettingsProjectsForView(rows, epmSettingsProjectView)'), 'Expected settings project rows to filter by selected view before sorting');
    assert.ok(projectsPanelSource.includes('className="epm-project-view-control"'), 'Expected Current/Archived/All view control in Projects tools');
    assert.ok(projectsPanelSource.includes("['current', 'archived', 'all']"), 'Expected Current, Archived, and All view choices');
    assert.ok(projectsPanelSource.includes('className="epm-project-table-sort"'), 'Expected sorting to live in table headers');
    assert.ok(projectsPanelSource.includes("setEpmSettingsProjectSort('name')"), 'Expected Project header sort action');
    assert.ok(projectsPanelSource.includes("setEpmSettingsProjectSort('status')"), 'Expected Status header sort action');
    assert.ok(projectsPanelSource.includes("setEpmSettingsProjectSort('label')"), 'Expected Jira label header sort action');
    assert.ok(epmSettingsUiSource.includes('No projects in this view.'), 'Expected filtered-empty project views to show an empty state');
    assert.ok(!projectsPanelSource.includes('className="epm-project-sort-control"'), 'Sort dropdown must not stay in the panel header');
    assert.ok(!projectsPanelSource.includes('Home order'), 'Home must not be a sort option');
});

test('EPM settings drops empty custom project rows and gives them an explicit delete action', () => {
    const normalizeStart = dashboardSource.indexOf('const normalizeEpmConfigDraft = (config) => {');
    const normalizeEnd = dashboardSource.indexOf('const hasSavedEpmScopeConfig = (config) => {', normalizeStart);
    assert.notStrictEqual(normalizeStart, -1, 'Expected EPM config normalizer');
    assert.notStrictEqual(normalizeEnd, -1, 'Expected EPM config normalizer end');
    const normalizeSource = dashboardSource.slice(normalizeStart, normalizeEnd);

    assert.ok(normalizeSource.includes('if (isEmptyCustomEpmProjectRow(normalizedRow)) return;'), 'Save normalization must skip fully empty custom project rows');

    const projectsPanelStart = epmSettingsUiSource.indexOf('id="epm-settings-projects-panel"');
    const projectsPanelEnd = epmSettingsUiSource.indexOf('className="epm-project-empty-state"', projectsPanelStart);
    assert.notStrictEqual(projectsPanelStart, -1, 'Expected EPM projects settings panel');
    assert.notStrictEqual(projectsPanelEnd, -1, 'Expected EPM projects row list before empty state');
    const projectsPanelSource = epmSettingsUiSource.slice(projectsPanelStart, projectsPanelEnd);

    assert.ok(projectsPanelSource.includes('const isEmptyCustomProject = isEmptyCustomEpmProjectRow(project);'), 'Expected empty custom row detection in the row renderer');
    assert.ok(projectsPanelSource.includes('{!isChangingLabel && !isEmptyCustomProject && ('), 'Expected empty custom rows to prioritize Delete over Choose label');
    assert.ok(projectsPanelSource.includes('Delete empty project'), 'Expected blank custom rows to expose a clear delete action');
    assert.ok(projectsPanelSource.includes('{canRemoveProject && !isEmptyCustomProject && ('), 'Expected empty custom rows to avoid a second generic remove action');
});

test('EPM selected Jira label has one explicit change action', () => {
    const selectedLabelStart = epmSettingsUiSource.indexOf('className="epm-label-selected-chip"');
    const selectedLabelEnd = epmSettingsUiSource.indexOf('{isChangingLabel && (', selectedLabelStart);
    assert.notStrictEqual(selectedLabelStart, -1, 'Expected compact selected label chip');
    assert.notStrictEqual(selectedLabelEnd, -1, 'Expected label search branch after selected chip');
    const selectedLabelSource = epmSettingsUiSource.slice(selectedLabelStart, selectedLabelEnd);

    assert.ok(selectedLabelSource.includes('className="epm-label-change-shortcut"'), 'Expected selected label change to use a compact icon action');
    assert.ok(selectedLabelSource.includes('title="Change label"'), 'Expected compact label-change action to keep a readable title');
    assert.ok(selectedLabelSource.includes('&times;'), 'Expected compact label-change action to render as a cross');
    assert.ok(!selectedLabelSource.includes('>\n                                                                                    Change label\n                                                                                </button>'), 'Selected label chip must not render a bulky Change label text button');
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
    assert.ok(epmSettingsUiSource.includes("className={`group-modal-tab ${epmSettingsTab === 'scope' ? 'active' : ''}`"), 'Expected EPM Scope sub-tab button');
    assert.ok(epmSettingsUiSource.includes("className={`group-modal-tab ${epmSettingsTab === 'projects' ? 'active' : ''}`"), 'Expected EPM Projects sub-tab button');
    assert.ok(!epmSettingsUiSource.includes("disabled={!canOpenEpmProjectsTab}"), 'Projects tab must stay clickable and show prerequisites inside the panel');
    assert.ok(epmSettingsUiSource.includes('role="tablist"'), 'Expected accessible EPM settings tablist');
    assert.ok(epmSettingsUiSource.includes('role="tab"'), 'Expected accessible EPM settings tabs');
    assert.match(epmSettingsUiSource, /aria-selected=\{epmSettingsTab === ['"]scope['"]\}/, 'Expected scope tab selected state');
    assert.match(epmSettingsUiSource, /aria-selected=\{epmSettingsTab === ['"]projects['"]\}/, 'Expected projects tab selected state');
    assert.ok(epmSettingsUiSource.includes('aria-controls="epm-settings-projects-panel"'), 'Expected projects tab panel relationship');
    assert.ok(dashboardSource.includes('const handleEpmSettingsTabKeyDown = (event) => {'), 'Expected keyboard support for EPM sub-tabs');
    assert.ok(dashboardSource.includes('document.getElementById(`epm-settings-${tab}-tab`)'), 'Expected keyboard tab changes to preserve focus');
    assert.ok(epmSettingsUiSource.includes("epmSettingsTab === 'scope'"), 'Expected scope-only render branch');
    assert.ok(epmSettingsUiSource.includes("epmSettingsTab === 'projects'"), 'Expected projects-only render branch');
    assert.ok(epmSettingsUiSource.includes('Set sub-goal'), 'Expected prerequisite action for missing sub-goal');
    assert.ok(epmSettingsUiSource.includes('Set label prefix'), 'Expected prerequisite action for missing label prefix');
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
