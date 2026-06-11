const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadIssueDependenciesModule() {
    const entryPoint = path.join(__dirname, '..', 'frontend', 'src', 'issues', 'IssueDependencies.jsx');
    const result = esbuild.buildSync({
        entryPoints: [entryPoint],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        external: ['react'],
        loader: { '.jsx': 'jsx', '.js': 'jsx' },
    });
    const mod = new Module(entryPoint, module);
    mod.paths = Module._nodeModulePaths(path.dirname(entryPoint));
    mod._compile(result.outputFiles[0].text, entryPoint);
    return mod.exports;
}

test('done blocked-by dependencies render as an unblocked chip', () => {
    const issueDependencies = loadIssueDependenciesModule();
    const IssueDependencies = issueDependencies.default;
    const model = issueDependencies.buildIssueDependencyViewModel({
        task: { key: 'PRODUCT-34047' },
        shouldRender: true,
        entries: [{
            key: 'PRODUCT-31219',
            category: 'block',
            direction: 'inward',
            prereqKey: 'PRODUCT-31219',
            dependentKey: 'PRODUCT-34047',
        }],
        dependencyLookupCache: {
            'PRODUCT-31219': { status: 'Done' },
        },
    });

    assert.equal(model.isBlockedByDone, true);

    const markup = renderToStaticMarkup(React.createElement(IssueDependencies, {
        task: { key: 'PRODUCT-34047' },
        model,
        placement: 'details',
    }));

    assert.match(markup, /class="dependency-count unblocked"/);
    assert.match(markup, /UNBLOCKED 1/);
    assert.doesNotMatch(markup, />BLOCKED BY 1</);
});

test('missing blocked-by links render inline issue details', () => {
    const issueDependencies = loadIssueDependenciesModule();
    const IssueDependencies = issueDependencies.default;
    const model = issueDependencies.buildIssueDependencyViewModel({
        task: { key: 'PRODUCT-34047' },
        shouldRender: true,
        entries: [{
            key: 'PRODUCT-31219',
            category: 'block',
            direction: 'inward',
            prereqKey: 'PRODUCT-31219',
            dependentKey: 'PRODUCT-34047',
            summary: 'Finish upstream rollout',
            status: 'In Progress',
            teamName: 'R&D Data Science',
            assignee: 'Avery Ramos',
        }],
        dependencyFocus: {
            taskKey: 'PRODUCT-34047',
            action: 'blocked-by',
            relatedKeys: ['PRODUCT-34047', 'PRODUCT-31219'],
            dependencyKeys: ['PRODUCT-31219'],
            missingKeys: ['PRODUCT-31219'],
        },
        activeDependencyFocus: {
            taskKey: 'PRODUCT-34047',
            action: 'blocked-by',
            relatedKeys: ['PRODUCT-34047', 'PRODUCT-31219'],
            dependencyKeys: ['PRODUCT-31219'],
            missingKeys: ['PRODUCT-31219'],
        },
        focusRelatedSet: new Set(['PRODUCT-34047', 'PRODUCT-31219']),
        issueByKey: new Map([['PRODUCT-34047', {}]]),
    });

    assert.equal(model.missingLines.length, 1);
    assert.deepEqual(model.missingLines[0], {
        key: 'PRODUCT-31219',
        status: 'In Progress',
        summary: 'Finish upstream rollout',
        teamName: 'R&D Data Science',
        assignee: 'Avery Ramos',
        isDone: false,
    });

    const markup = renderToStaticMarkup(React.createElement(IssueDependencies, {
        task: { key: 'PRODUCT-34047' },
        jiraUrl: 'https://jira.example.test',
        model,
        placement: 'details',
    }));

    assert.match(markup, /Not loaded/);
    assert.match(markup, /Finish upstream rollout/);
    assert.match(markup, /R&amp;D Data Science/);
    assert.match(markup, /Avery Ramos/);
    assert.match(markup, /href="https:\/\/jira\.example\.test\/browse\/PRODUCT-31219"/);
});

test('hidden blocked-by links render inline issue links', () => {
    const issueDependencies = loadIssueDependenciesModule();
    const IssueDependencies = issueDependencies.default;
    const model = issueDependencies.buildIssueDependencyViewModel({
        task: { key: 'PRODUCT-34047' },
        shouldRender: true,
        entries: [{
            key: 'PRODUCT-31219',
            category: 'block',
            direction: 'inward',
            prereqKey: 'PRODUCT-31219',
            dependentKey: 'PRODUCT-34047',
            summary: 'Finish upstream rollout',
            status: 'In Progress',
            teamName: 'R&D Data Science',
            assignee: 'Avery Ramos',
        }],
        dependencyFocus: {
            taskKey: 'PRODUCT-34047',
            action: 'blocked-by',
            relatedKeys: ['PRODUCT-34047', 'PRODUCT-31219'],
            dependencyKeys: ['PRODUCT-31219'],
            missingKeys: [],
        },
        activeDependencyFocus: {
            taskKey: 'PRODUCT-34047',
            action: 'blocked-by',
            relatedKeys: ['PRODUCT-34047', 'PRODUCT-31219'],
            dependencyKeys: ['PRODUCT-31219'],
            missingKeys: [],
        },
        focusRelatedSet: new Set(['PRODUCT-34047', 'PRODUCT-31219']),
        issueByKey: new Map([
            ['PRODUCT-34047', {}],
            ['PRODUCT-31219', {
                fields: {
                    summary: 'Finish upstream rollout',
                    status: { name: 'In Progress' },
                    assignee: { displayName: 'Avery Ramos' },
                },
            }],
        ]),
        visibleTaskKeySet: new Set(['PRODUCT-34047']),
    });

    assert.equal(model.hiddenLines.length, 1);

    const markup = renderToStaticMarkup(React.createElement(IssueDependencies, {
        task: { key: 'PRODUCT-34047' },
        jiraUrl: 'https://jira.example.test',
        model,
        placement: 'details',
    }));

    assert.match(markup, /Hidden by filter/);
    assert.match(markup, /Finish upstream rollout/);
    assert.match(markup, /href="https:\/\/jira\.example\.test\/browse\/PRODUCT-31219"/);
});

test('offscreen blocked-by links render inline issue links', () => {
    const issueDependencies = loadIssueDependenciesModule();
    const IssueDependencies = issueDependencies.default;
    const model = issueDependencies.buildIssueDependencyViewModel({
        task: { key: 'PRODUCT-36097' },
        shouldRender: true,
        entries: [{
            key: 'PRODUCT-36832',
            category: 'block',
            direction: 'inward',
            prereqKey: 'PRODUCT-36832',
            dependentKey: 'PRODUCT-36097',
            summary: '[P] Make smart deals threshold dependent on test group',
            status: 'In Progress',
            teamName: 'R&D Perimeter',
            assignee: 'Dasha Saukh',
        }],
        dependencyFocus: {
            taskKey: 'PRODUCT-36097',
            action: 'blocked-by',
            relatedKeys: ['PRODUCT-36097', 'PRODUCT-36832'],
            dependencyKeys: ['PRODUCT-36832'],
            missingKeys: [],
            offscreenKeys: ['PRODUCT-36832'],
        },
        activeDependencyFocus: {
            taskKey: 'PRODUCT-36097',
            action: 'blocked-by',
            relatedKeys: ['PRODUCT-36097', 'PRODUCT-36832'],
            dependencyKeys: ['PRODUCT-36832'],
            missingKeys: [],
            offscreenKeys: ['PRODUCT-36832'],
        },
        focusRelatedSet: new Set(['PRODUCT-36097', 'PRODUCT-36832']),
        issueByKey: new Map([
            ['PRODUCT-36097', {}],
            ['PRODUCT-36832', {
                fields: {
                    summary: '[P] Make smart deals threshold dependent on test group',
                    status: { name: 'In Progress' },
                    assignee: { displayName: 'Dasha Saukh' },
                },
            }],
        ]),
        visibleTaskKeySet: new Set(['PRODUCT-36097', 'PRODUCT-36832']),
    });

    assert.equal(model.offscreenLines.length, 1);

    const markup = renderToStaticMarkup(React.createElement(IssueDependencies, {
        task: { key: 'PRODUCT-36097' },
        jiraUrl: 'https://jira.example.test',
        model,
        placement: 'details',
    }));

    assert.match(markup, /Not on screen/);
    assert.match(markup, /Make smart deals threshold/);
    assert.match(markup, /href="https:\/\/jira\.example\.test\/browse\/PRODUCT-36832"/);
});
