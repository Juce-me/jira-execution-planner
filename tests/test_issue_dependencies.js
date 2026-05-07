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
