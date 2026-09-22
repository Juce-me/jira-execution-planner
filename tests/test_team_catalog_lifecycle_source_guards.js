const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Team catalog lifecycle hook owns request, completion, and auth invalidation', () => {
    const source = read('frontend/src/settings/useTeamCatalogLifecycle.js');
    assert.match(source, /fetchAllTeams as requestAllTeams/);
    assert.match(source, /fetchTeamCatalog as requestTeamCatalog/);
    assert.match(source, /saveTeamCatalog as requestSaveTeamCatalog/);
    assert.match(source, /completionReads < 5/);
    assert.match(source, /Date\.now\(\) - completionStartedAt < 15000/);
    assert.match(source, /completionAttemptId: data\.cache\.refreshAttemptId/);
    assert.match(source, /window\.addEventListener\(AUTH_REQUIRED_EVENT, handleAuthRequired\)/);
    assert.match(source, /data\.cache\?\.backend === 'postgresql'[\s\S]*void loadTeamCatalog/);
    assert.match(source, /const savedCatalog = await saveTeamCatalog/);
});

test('dashboard delegates Team lifecycle and retains only availability and UI wiring', () => {
    const source = read('frontend/src/dashboard.jsx');
    assert.match(source, /import useTeamCatalogLifecycle from '\.\/settings\/useTeamCatalogLifecycle\.js'/);
    assert.match(source, /\} = useTeamCatalogLifecycle\(\{/);
    assert.match(source, /invalidateTeamMembership,/);
    assert.match(source, /invalidateTeamMembership\(\);/);
    assert.match(source, /buildTeamAvailability\(\{/);
    assert.doesNotMatch(source, /fetchAllTeams as requestAllTeams/);
    assert.doesNotMatch(source, /teamCatalogHydrationInFlightRef/);
    assert.doesNotMatch(source, /const fetchAllTeamsFromJira = async/);
});

test('Team lifecycle guards modal, Sprint, and browser-context ownership', () => {
    const source = read('frontend/src/settings/useTeamCatalogLifecycle.js');
    assert.match(source, /lifecycleKey/);
    assert.match(source, /sprintCatalogGeneration/);
    assert.match(source, /teamMembershipState\.lifecycleKey === currentLifecycleKey/);
    assert.match(source, /modalGenerationRef\.current === modalGeneration/);
    assert.match(source, /initializationGenerationRef\.current === requestGeneration/);
    assert.match(source, /String\(selectedSprintInfo\?\.id \|\| ''\) === sprintId/);
    assert.match(source, /String\(sprintBrowserContextId \|\| ''\) === membershipDocument\.browserContextId/);
    assert.match(source, /retireMembershipOwner\(\)/);
});

test('Team lifecycle does not expose the unused names-only resolver path', () => {
    const hook = read('frontend/src/settings/useTeamCatalogLifecycle.js');
    const dashboard = read('frontend/src/dashboard.jsx');
    assert.doesNotMatch(hook, /resolveTeams as requestResolveTeams/);
    assert.doesNotMatch(hook, /resolveMissingTeamNames/);
    assert.doesNotMatch(dashboard, /resolveMissingTeamNames/);
});

test('rejected Board-affecting saves recover Sprint and Team authority', () => {
    const source = read('frontend/src/dashboard.jsx');
    assert.match(source, /const recoverCatalogsAfterRejectedBoardSave = async/);
    assert.match(source, /recoverCatalogsAfterRejectedBoardSave[\s\S]*fetchAppConfig\(BACKEND_URL\)[\s\S]*acceptSource[\s\S]*loadSprints\(false\)/);
    assert.match(source, /if \(!groupDraft\)[\s\S]*void recoverCatalogsAfterRejectedBoardSave\(\)/);
    assert.match(source, /groupConfigValidationErrors\.length > 0[\s\S]*void recoverCatalogsAfterRejectedBoardSave\(\)/);
    assert.match(source, /isAuthenticationRequiredError\(err\)[\s\S]*void recoverCatalogsAfterRejectedBoardSave\(\)/);
});
