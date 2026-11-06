const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

test('the Table Save callback reads the settled outcome rather than stale render props', async () => {
    const priorDocument = global.document, priorCapture = global.__planningSaveAnalyticsControls;
    global.document = { body: {} };
    try {
        const built = await esbuild.build({
            entryPoints: [path.resolve('frontend/src/eng/PlanningReviewTable.jsx')],
            bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom', 'react-dom/*'],
            plugins: [{ name: 'capture-save-control', setup(build) {
                build.onResolve({ filter: /^\.\/PlanningReview(?:StateCluster|BoundaryPlus)\.jsx$/ }, args => ({ path: args.path, namespace: 'test' }));
                // The pointer-only boundary portal is unrelated to Save; capture the real Table's toolbar callback.
                build.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path.includes('StateCluster')
                    ? 'export default function Capture(props) { globalThis.__planningSaveAnalyticsControls = props; return null; }'
                    : 'export default function Boundary() { return null; }', loader: 'js' }));
            } }],
        });
        const bundled = { exports: {} };
        new Function('module', 'exports', 'require', built.outputFiles[0].text)(bundled, bundled.exports, require);
        const { buildPlanningReviewAnalyticsParams } = await import('../frontend/src/analytics/dashboardAnalytics.js');
        for (const result of ['success', 'failure', 'conflict', 'unknown']) {
            let writes = 0;
            const events = [], initial = { dirty: true, columns: [], capabilities: { canRead: true, canSave: true }, schemaChanges: [], drafts: {}, cells: {} };
            let live = initial;
            const review = { ...initial, getState: () => live, save: async () => {
                writes++;
                live = { ...initial, unconfirmed: result === 'unknown', conflict: result === 'conflict' ? {} : null };
                return result === 'success';
            } };
            renderToStaticMarkup(React.createElement(bundled.exports.default, { review, getTeamInfo: () => ({ id: 'synthetic-team', name: 'Synthetic team' }), onReviewAction: (action, params) => events.push(buildPlanningReviewAnalyticsParams(action, params)) }));
            await global.__planningSaveAnalyticsControls.onSave();
            assert.deepEqual(events, [{ feature_name: 'planning_review', source_surface: 'planning', workflow_action: 'save_review', result }]);
            assert.equal(writes, 1);
        }
    } finally {
        global.document = priorDocument;
        global.__planningSaveAnalyticsControls = priorCapture;
    }
});
