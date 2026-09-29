const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const { installDashboardShell } = require('./epm_home_token_fixture');

const selectedSprintId = 34625;
const selectedSprintName = '2026Q2 Sprint 42';
const selectedProjects = [{ key: 'ABC', type: 'product' }];
const boardConfig = { boardId: '', boardName: '' };
const sharedConfigRevision = 1;

async function buildDashboardBundle(sourceRoot, { instrumentBoardOwner = false } = {}) {
    const ownerPath = path.join(sourceRoot, 'frontend', 'src', 'eng', 'useEngBoardData.js');
    return (await esbuild.build({
        entryPoints: [path.join(sourceRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"production"' },
        plugins: instrumentBoardOwner ? [{
            name: 'observe-eng-board-reducer',
            setup(build) {
                build.onLoad({ filter: /useEngBoardData\.js$/ }, args => {
                    if (path.resolve(args.path) !== path.resolve(ownerPath)) return null;
                    const source = fs.readFileSync(args.path, 'utf8');
                    const seam = "                    emit({ type: 'frame', requestId, frame: nextFrame });";
                    if (!source.includes(seam)) throw new Error('ENG Board reducer seam was not found');
                    return {
                        loader: 'js',
                        contents: source.replace(seam, `${seam}\n                    globalThis.__engBoardReducerObserved?.({\n                        requestId, generationId: nextFrame.generationId, sequence: nextFrame.sequence,\n                        frameType: nextFrame.type, scope: nextFrame.scope || null, at: performance.now(),\n                    });`),
                    };
                });
            },
        }] : [],
    })).outputFiles[0].text;
}

async function installEngBoardDashboardFixture(page, {
    sourceRoot, passthroughEngBoard = false, instrumentBoardOwner = false,
} = {}) {
    const diagnostics = { apiRoutes: [], boardRouteAction: null };
    await installDashboardShell(page);
    if (sourceRoot) {
        const bundle = await buildDashboardBundle(sourceRoot, { instrumentBoardOwner });
        await page.unroute('**/frontend/dist/dashboard.js');
        await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
            status: 200, contentType: 'application/javascript', body: bundle,
        }));
    }
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        diagnostics.apiRoutes.push({ method: request.method(), url: request.url(), path: `${url.pathname}${url.search}` });
        if (url.pathname === '/api/eng/board' && request.method() === 'GET' && passthroughEngBoard) {
            diagnostics.boardRouteAction = 'continue';
            return route.continue();
        }
        const json = (body, status = 200) => route.fulfill({
            status, contentType: 'application/json', body: JSON.stringify(body),
        });
        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com' });
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        if (url.pathname === '/api/config') return json({
            jiraUrl: 'https://jira.example', capacityProject: '', groupQueryTemplateEnabled: false,
            settingsAdminOnly: false, userCanEditSettings: true, boardAllWorkAvailable: true,
            projectsConfigured: true, epm: { version: 2, labelPrefix: '', scope: {}, projects: {} },
            sharedConfigRevision,
            sharedConfig: { projects: { selected: selectedProjects }, board: boardConfig },
        });
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') return json({
            version: 1, revision: 1, groups: [{
                id: 'grp-default', name: 'Default', teamIds: [], teamLabels: {},
                missingInfoComponents: ['Platform'],
                board: { columns: [
                    { id: 'todo', name: 'To do', colour: '#597ef7', star: true, min: null, max: null, statuses: ['To Do'] },
                    { id: 'done', name: 'Done', colour: '#52c41a', star: false, min: null, max: null, statuses: ['Done'] },
                ] },
            }], defaultGroupId: 'grp-default', source: 'test',
        });
        if (url.pathname === '/api/projects/selected') {
            return json({ selected: selectedProjects, configRevision: sharedConfigRevision });
        }
        if (url.pathname === '/api/board-config') {
            return json({ ...boardConfig, source: 'config', configRevision: sharedConfigRevision });
        }
        if (url.pathname === '/api/sprints') return json({ sprints: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }] });
        if (url.pathname === '/api/tasks-with-team-name') return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        return json({});
    });
    return diagnostics;
}

module.exports = { buildDashboardBundle, installEngBoardDashboardFixture, selectedSprintId, selectedSprintName };
