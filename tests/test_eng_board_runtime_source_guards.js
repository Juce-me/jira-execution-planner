const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = (path) => fs.readFileSync(path, 'utf8');

const dashboard = read('frontend/src/dashboard.jsx');
const boardView = read('frontend/src/eng/EngBoardView.jsx');
const engView = read('frontend/src/eng/EngView.jsx');

test('dashboard wires Board loading, error, and retry state to EngBoardView', () => {
    const mount = dashboard.slice(dashboard.indexOf('<EngBoardView'), dashboard.indexOf('/>', dashboard.indexOf('<EngBoardView')));
    assert.match(mount, /loading=\{loading\}/);
    assert.match(dashboard, /const displayedEngError = sprintError \|\| error;/);
    assert.match(dashboard, /const retryEngLoad = sprintError \? \(\) => loadSprints\(true\) : fetchTasks;/);
    assert.match(mount, /error=\{displayedEngError\}/);
    assert.match(mount, /onRetry=\{retryEngLoad\}/);
    assert.match(boardView, /<LoadingState[\s\S]*title="Loading tasks"[\s\S]*message="Refreshing Jira sprint work\."/);
    assert.match(boardView, /className="error"[\s\S]*<button onClick=\{onRetry\}>Retry<\/button>/);
    assert.ok(boardView.lastIndexOf('React.use') < boardView.indexOf('if (loading)'), 'All Board hooks must precede loading/error early returns');
});

test('required sprint refreshes queue behind active discovery while Retry clicks deduplicate', () => {
    assert.match(dashboard, /if \(queueIfBusy\) pendingSprintRefreshRef\.current = true;/);
    assert.match(dashboard, /if \(boardChanged\) \{\s*loadSprints\(true, \{ queueIfBusy: true \}\);/);
    assert.match(dashboard, /const retryEngLoad = sprintError \? \(\) => loadSprints\(true\) : fetchTasks;/);
    const refreshHandler = dashboard.slice(
        dashboard.indexOf('const refreshActiveViewFromJira'),
        dashboard.indexOf('const manualRefreshDisabled'),
    );
    assert.match(refreshHandler, /loadSprints\(true, \{ queueIfBusy: true \}\);/);
});

test('Board story export comes from stories inside filtered Board epic groups', () => {
    assert.match(dashboard, /const boardJiraStoryKeys = React\.useMemo\(/);
    assert.match(dashboard, /boardEpicGroupsFiltered\.flatMap\(group => group\.tasks \|\| \[\]\)/);
    const selector = dashboard.slice(
        dashboard.indexOf('const activeJiraExportStoryKeys'),
        dashboard.indexOf('const epmDependencyTasks'),
    );
    assert.match(selector, /if \(selectedView === 'epm'\) return epmJiraStoryKeys;/);
    assert.match(selector, /if \(showScenario\) return scenarioJiraStoryKeys;/);
    assert.match(selector, /if \(showBoard\) return boardJiraStoryKeys;/);
    assert.match(selector, /return visibleTaskJiraStoryKeys;/);
});

test('sticky Catch Up Clear all uses the narrow facet reset while empty state keeps the broad reset', () => {
    assert.match(dashboard, /const clearEngFacetFilters = React\.useCallback\(\(\) => resetEngFacetFilters\(/);
    const mount = dashboard.slice(dashboard.indexOf('<EngView'), dashboard.indexOf('<IssueCardContext.Provider'));
    assert.match(mount, /onClearFacets=\{clearEngFacetFilters\}/);
    assert.match(mount, /onClearFilters=\{clearEngFilters\}/);
    assert.match(engView, /onClearAll=\{onClearFacets\}/);
    assert.match(engView, /hasNoVisibleTasks && onClearFilters \? onClearFilters : onRetry/);
});

test('dead statusWorkItems plumbing is absent from production and the composer harness', () => {
    for (const path of [
        'frontend/src/dashboard.jsx',
        'frontend/src/settings/GroupBoardsTab.jsx',
        'frontend/src/settings/GroupBoardSettings.jsx',
        'tests/ui/group_board_composer_harness.jsx',
    ]) {
        assert.doesNotMatch(read(path), /statusWorkItems|REFERENCE_STATUS_WORK_ITEMS/, `${path} must not thread synthetic status counts`);
    }
});
