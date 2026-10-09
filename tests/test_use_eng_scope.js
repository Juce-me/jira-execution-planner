const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');
const ownerPath = path.resolve(__dirname, '../frontend/src/eng/useEngScope.js');
const NAMES = ['activeGroupId', 'selectedSprint', 'selectedSprintInfo', 'isAllTeamsSelected', 'selectedTeamSet', 'teamNameById', 'teamOptions', 'capacityTasks', 'techProjectKeys', 'excludedEpicSet', 'adHocEpicSet', 'adHocEpicSignature'];
function load() {
    const code = esbuild.buildSync({ entryPoints: [ownerPath], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'] }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports.useEngScope;
}
test('SSR preserves exactly the twelve shared inputs and their references', () => {
    const useEngScope = load();
    const inputs = {
        activeGroupId: 'group-a', selectedSprint: 'sprint-a', selectedSprintInfo: { name: 'Sprint A' },
        isAllTeamsSelected: false, selectedTeamSet: new Set(['team-a']), teamNameById: new Map([['team-a', 'Team A']]),
        teamOptions: [{ id: 'team-a', name: 'Team A' }], capacityTasks: [{ key: 'SYNTHETIC-1' }],
        techProjectKeys: new Set(['SYNTHETIC']), excludedEpicSet: new Set(['SYNTHETIC-2']),
        adHocEpicSet: new Set(['SYNTHETIC-3']), adHocEpicSignature: 'SYNTHETIC-3', speculativeMember: 'must not escape',
    };
    let result;
    function Probe() { result = useEngScope(inputs); return null; }
    renderToString(React.createElement(Probe));
    assert.deepEqual(Object.keys(result), NAMES);
    for (const name of NAMES) assert.equal(result[name], inputs[name], name);
});
test('scope keeps the frozen memo dependency order without new lifecycle owners', () => {
    const source = fs.readFileSync(ownerPath, 'utf8');
    assert.deepEqual(source.match(/\}\), \[([^\]]+)\]\)/)[1].split(',').map(name => name.trim()), NAMES);
    assert.doesNotMatch(source, /use(?:State|Ref|Effect|Callback)|fetch|localStorage|sessionStorage/);
    const dashboard = fs.readFileSync(path.resolve(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');
    assert.match(dashboard, /const adHocEpicSignature = React\.useMemo\([\s\S]*?\);\s*const scope = useEngScope\(/);
    assert.equal((dashboard.match(/const scope = useEngScope\(/g) || []).length, 1);
});
