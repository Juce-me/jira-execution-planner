const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const dashboardPath = path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx');
const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');

test('dashboard source includes the EPM settings tab and lazy-load flow', () => {
    assert.ok(dashboardSource.includes("groupManageTab === 'epm'"), 'Expected an EPM settings tab branch');
    assert.ok(dashboardSource.includes("const [epmConfigDraft, setEpmConfigDraft] = useState({ version: 1, scope: { cloudId: '', subGoalKey: '' }, projects: {} });"), 'Expected EPM config draft state');
    assert.ok(dashboardSource.includes("const epmConfigBaselineRef = useRef(JSON.stringify({ version: 1, scope: { cloudId: '', subGoalKey: '' }, projects: {} }));"), 'Expected EPM config baseline tracking');
    assert.ok(dashboardSource.includes('const isEpmConfigDirty = React.useMemo(() => {'), 'Expected EPM dirty-state tracking');
    assert.ok(dashboardSource.includes('if (isEpmConfigDirty) return true;'), 'Expected EPM dirty-state participation in modal dirty checks');
    assert.ok(dashboardSource.includes('isEpmConfigDirty,'), 'Expected EPM dirty-state participation in unsaved section counting');
    assert.ok(dashboardSource.includes('const loadEpmConfig = async () => {'), 'Expected EPM config loader');
    assert.ok(dashboardSource.includes('const loadEpmProjects = async () => {'), 'Expected EPM projects loader');
    assert.ok(dashboardSource.includes('const saveEpmConfig = async () => {'), 'Expected EPM config saver');
    assert.ok(dashboardSource.includes('const normalizeEpmConfigDraft = (config) => {'), 'Expected EPM config normalizer');
    assert.ok(dashboardSource.includes('const hasSavedEpmScopeConfig = (config) => {'), 'Expected saved-scope helper');
    assert.ok(dashboardSource.includes('const updateEpmScopeDraft = (field, value) => {'), 'Expected EPM scope draft mutator');
    assert.ok(dashboardSource.includes('const updateEpmProjectDraft = (homeProjectId, field, value) => {'), 'Expected inline EPM draft mutator');
    assert.ok(dashboardSource.includes('fetch(`${BACKEND_URL}/api/epm/config`'), 'Expected EPM config fetch endpoint');
    assert.ok(dashboardSource.includes('fetch(`${BACKEND_URL}/api/epm/projects`'), 'Expected EPM projects fetch endpoint');
    assert.ok(dashboardSource.includes('void saveEpmConfig().catch(() => {});'), 'Expected direct EPM save callers to consume rejections');
    assert.ok(dashboardSource.includes('if (isEpmConfigDirty) {') && dashboardSource.includes('await saveEpmConfig();'), 'Expected shared save path to persist EPM settings when dirty');
    assert.ok(dashboardSource.includes("setGroupDraftError(message);") && dashboardSource.includes('throw err;'), 'Expected EPM save failures to surface and block shared save');
    assert.ok(dashboardSource.includes('Atlassian cloud ID'), 'Expected Atlassian cloud ID copy');
    assert.ok(dashboardSource.includes('Sub-goal key'), 'Expected Sub-goal key copy');
    assert.ok(dashboardSource.includes('Custom name'), 'Expected Custom name copy');
    assert.ok(dashboardSource.includes('Save an Atlassian cloud ID and Jira Home sub-goal key to load EPM projects.'), 'Expected saved-scope helper copy');
    assert.ok(dashboardSource.includes('if (hasSavedEpmScopeConfig(nextConfig)) {') && dashboardSource.includes('await refreshEpmProjects();') && dashboardSource.includes('setEpmProjects([]);'), 'Expected save path to refresh only when saved scope exists');
    assert.ok(dashboardSource.includes('if (!cancelled && shouldLoadProjects) {'), 'Expected EPM project fetch gating after config load');
    assert.ok(dashboardSource.includes(') : !hasSavedEpmScope ? ('), 'Expected saved-scope helper branch before empty project state');
    assert.ok(dashboardSource.includes('if (!hasSavedEpmScope) {') && dashboardSource.includes('void refreshEpmProjects();'), 'Expected main EPM view fetch gating on saved scope');
    assert.ok(dashboardSource.includes('const refreshEpmView = async () => {') && dashboardSource.includes('if (!hasSavedEpmScope) {') && dashboardSource.includes('setEpmIssues([]);') && dashboardSource.includes('setEpmIssueEpics({});'), 'Expected manual EPM refresh gating to clear stale project and issue state without fetching');
    assert.ok(dashboardSource.includes('EPM projects'), 'Expected EPM projects copy');
    assert.ok(dashboardSource.includes('Jira label'), 'Expected Jira label copy');
    assert.ok(dashboardSource.includes('Jira epic'), 'Expected Jira epic copy');
    assert.ok(!dashboardSource.includes('mock-input'), 'Did not expect mock-input class');
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
