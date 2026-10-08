const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const repoRoot = path.join(__dirname, '..', '..');
const anchor = 'const perfStateLastRef = useRef({});';
const adapter = 'if (perfEnabled) window.__JEP_EXTRACTION_PERF__ = () => ({ ...perfCountersRef.current });';

// Builds a copy of the bundle with the in-memory render-counter adapter. The source file is never written.
// esbuild's synchronous API rejects plugins, so the adapter is applied to the entry text and fed through
// stdin, the same way tests/ui/scenario_draft_history.spec.js does it.
function buildRuntimeProbeBundle() {
    const entry = path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx');
    const contents = fs.readFileSync(entry, 'utf8');
    if (contents.split(anchor).length - 1 !== 1) {
        throw new Error('runtime adapter anchor must occur exactly once');
    }
    const result = esbuild.buildSync({
        stdin: {
            contents: contents.replace(anchor, `${anchor}\n${adapter}`),
            resolveDir: path.dirname(entry),
            sourcefile: entry,
            loader: 'jsx',
        },
        bundle: true,
        write: false,
        nodePaths: [path.join(repoRoot, 'node_modules')],
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    });
    return result.outputFiles[0].text;
}

async function readAppRenderCount(page) {
    return page.evaluate(() => window.__JEP_EXTRACTION_PERF__().renders);
}

module.exports = { buildRuntimeProbeBundle, readAppRenderCount };
