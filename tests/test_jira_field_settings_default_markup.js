const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Pin the existing default renderer at 2ae8e47b. Quarterly opt-in props are deliberately
// absent: fixture assertions must not substitute for this production compatibility guard.
const code = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '../frontend/src/settings/JiraFieldSettings.jsx')],
    bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'],
}).outputFiles[0].text;
const loaded = { exports: {} };
new Function('module', 'exports', 'require', code)(loaded, loaded.exports, require);
const JiraFieldSettings = loaded.exports.default;
const props = {
    showTechnicalFieldIds: false,
    sprintFieldIdDraft: 'customfield_19001', sprintFieldNameDraft: 'Sprint',
    boardIdDraft: '7001', boardNameDraft: 'Planning Board',
    selectedProjectsDraft: [{ key: 'ALPHA', type: 'product' }, { key: 'BETA', type: 'tech' }],
    resolveProjectName: key => ({ ALPHA: 'Alpha', BETA: 'Beta' }[key] || key),
    issueTypesDraft: ['Story'], mappingHoverKey: null,
    parentNameFieldIdDraft: 'customfield_19002', parentNameFieldNameDraft: 'Epic Name',
    storyPointsFieldIdDraft: 'customfield_19003', storyPointsFieldNameDraft: 'Story Points',
    teamFieldIdDraft: 'customfield_19004', teamFieldNameDraft: 'Team',
    deliveryOwnerFieldIdDraft: 'customfield_19005', deliveryOwnerFieldNameDraft: 'Delivery Owner',
    projectSearchQuery: '', issueTypeSearchQuery: '', sprintFieldSearchQuery: '',
    parentNameFieldSearchQuery: '', storyPointsFieldSearchQuery: '', teamFieldSearchQuery: '',
    deliveryOwnerFieldSearchQuery: '', boardSearchQuery: '',
    jiraFields: [], jiraProjects: [],
    projectSearchResults: [], issueTypeSearchResults: [], boardSearchResults: [],
};
const baseline = {
    source: 'e259a4a19e1174db55fe825b72643a670fa0f78c7788884c5def91e3cb3779cd',
    scope: '4ac4e5cae3a33f170f547bba0a20ee4fce753e9bc4978a809e05b9846069b647',
    mapping: 'cb9bbdb2c0298d301d29aa0f14f607a34786c5f0c1695b3112744a42c09b1b70',
};

for (const tab of ['source', 'scope', 'mapping']) {
    test(`JiraFieldSettings ${tab} default markup stays byte-identical with quarterly props omitted`, () => {
        const html = renderToStaticMarkup(React.createElement(JiraFieldSettings, { ...props, groupManageTab: tab }));
        assert.ok(html.length > 500, 'render the actual form, not an empty fragment');
        assert.equal(crypto.createHash('sha256').update(html).digest('hex'), baseline[tab],
            'Default production markup changed; review the rendered difference before updating this baseline.');
        assert.doesNotMatch(html, /data-mapping-key=|Not found in Jira|DELIVERY/);
    });
}
