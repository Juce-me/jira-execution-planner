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

// Separate synthetic mounted fixture: no dashboard imports or production adapters.
function buildEngScopeProbeBundle() {
    return esbuild.buildSync({
        stdin: {
            contents: `
                import * as React from 'react';
                import { createRoot } from 'react-dom/client';
                import { useEngScope } from './frontend/src/eng/useEngScope.js';
                const stable = {
                    activeGroupId: 'group-a', selectedSprintInfo: { name: 'Sprint A' },
                    isAllTeamsSelected: false, selectedTeamSet: new Set(['team-a']),
                    teamNameById: new Map([['team-a', 'Team A']]), teamOptions: [{ id: 'team-a', name: 'Team A' }],
                    capacityTasks: [{ key: 'SYNTHETIC-1' }], techProjectKeys: new Set(['SYNTHETIC']),
                    excludedEpicSet: new Set(['SYNTHETIC-2']), adHocEpicSet: new Set(['SYNTHETIC-3']),
                    adHocEpicSignature: 'SYNTHETIC-3', speculativeMember: 'must not escape',
                };
                function Probe() {
                    const [unrelated, setUnrelated] = React.useState(0);
                    const [selectedSprint, setSelectedSprint] = React.useState('sprint-a');
                    const scope = useEngScope({ ...stable, selectedSprint });
                    React.useLayoutEffect(() => { window.__ENG_SCOPE_PROBE__ = scope; });
                    return React.createElement('div', null,
                        React.createElement('button', { onClick: () => setUnrelated(value => value + 1) }, 'Unrelated ' + unrelated),
                        React.createElement('button', { onClick: () => setSelectedSprint('sprint-b') }, 'Change sprint'),
                        React.createElement('span', null, selectedSprint));
                }
                createRoot(document.getElementById('root')).render(React.createElement(Probe));
            `,
            resolveDir: repoRoot, sourcefile: 'eng-scope-probe.js', loader: 'js',
        },
        bundle: true, write: false, format: 'iife',
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
}

module.exports = { buildRuntimeProbeBundle, readAppRenderCount, buildEngScopeProbeBundle };
