const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { DB_OAUTH_SETUP_TIMEOUT_MS, GROUP_ID, TEAM_A, TEAM_B, csrfHeaders, startPlanningSharedPlanServer } = require('./planning_shared_plan_fixture');


test.describe('real shared Planning persistence', () => {
    test.describe.configure({ mode: 'serial' });
    let server;
    test.beforeAll(async () => {
        test.setTimeout(DB_OAUTH_SETUP_TIMEOUT_MS + 30000);
        server = await startPlanningSharedPlanServer();
    });
    test.afterAll(async () => {
        try {
            if (server) {
                const state = await server.inspect();
                expect(state.failures).toEqual([]);
                expect(state.mutations).toEqual([]);
                expect(server.unhandledExternalRequests).toEqual([]);
            }
        } finally { await server?.stop(); }
    });
    const endpoint = sprint => server.baseUrl + `/api/eng/sprints/${sprint}/review`;
    async function metadata(context, sprint = 101) {
        const response = await context.request.get(endpoint(sprint) + '?groupId=' + GROUP_ID);
        expect(response.status()).toBe(200);
        return response.json();
    }
    async function save(context, body, sprint = 101) {
        return context.request.patch(endpoint(sprint), { data: { groupId: GROUP_ID, ...body },
            headers: await csrfHeaders(server, context) });
    }
    async function read(context, ids, extra = {}, sprint = 101) {
        const response = await context.request.post(endpoint(sprint) + '/values/read', {
            data: { groupId: GROUP_ID, issueIds: ids, rowKind: 'story', ...extra },
            headers: await csrfHeaders(server, context),
        });
        expect(response.status()).toBe(200);
        return response.json();
    }
    async function selectSprint(page, name) {
        const dropdown = page.locator('.sprint-dropdown').first();
        const toggle = dropdown.locator('.sprint-dropdown-toggle');
        await expect(toggle).toHaveAttribute('aria-disabled', 'false');
        if (!(await toggle.textContent()).includes(name)) {
            await toggle.click();
            await dropdown.locator('.sprint-dropdown-option', { hasText: name }).click();
        }
    }
    async function openPlanning(page, sprint = '2027Q1') {
        await page.goto(server.baseUrl);
        await selectSprint(page, sprint);
        await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning', exact: true }).check();
        await expect(page.locator('.planning-review-table')).toBeVisible();
        await page.getByRole('radio', { name: 'Stories', exact: true }).check();
        await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    }
    async function teamFilter(page, name) {
        await page.locator('.team-dropdown-toggle').first().click();
        const options = page.locator('.team-dropdown-panel .team-dropdown-option');
        await options.filter({ hasText: /^All Teams$/ }).getByRole('checkbox').check();
        await options.filter({ hasText: name }).getByRole('checkbox').check();
        await page.keyboard.press('Escape');
    }
    const rowCheckbox = (page, key) => page.locator(`.planning-review-table tbody tr[data-issue-key="${key}"]`).getByRole('checkbox');

    test('UI smoke: existing Planning table mounts against real application APIs', async ({ browser }) => {
        const { a, b, pageA, pageB } = await server.createContexts(browser);
        try {
            await openPlanning(pageA);
            await openPlanning(pageB);
            await expect(rowCheckbox(pageA, 'SYN-8101')).toBeVisible();
            await expect(rowCheckbox(pageB, 'SYN-8102')).toBeVisible();
        } finally { await a.close(); await b.close(); }
    });

    test('smoke: two members, authoritative catalogs, real CSRF and persisted shared review', async ({ browser }) => {
        const { a, b } = await server.createContexts(browser);
        try {
            const state = await server.inspect();
            expect(state.actors['actor-a'].role).toBe('user');
            expect(state.actors['actor-b'].role).toBe('user');
            expect(state.actors['actor-a'].userId).not.toBe(state.actors['actor-b'].userId);
            expect(state.actors['actor-a'].connectionId).not.toBe(state.actors['actor-b'].connectionId);
            const actors = await Promise.all(['actor-a', 'actor-b'].map(actor => server.control('inspect', { actor })));
            expect(actors[0].actor.workspaceId).toBe(actors[1].actor.workspaceId);
            expect(actors[0].actor.sessionIds.every(id => !actors[1].actor.sessionIds.includes(id))).toBe(true);
            for (const context of [a, b]) {
                const config = await (await context.request.get(server.baseUrl + '/api/config')).json();
                expect(config.userCanEditSettings).toBe(false);
                expect(config.adminSettingsMissing).toEqual([]);
                const sprints = await context.request.get(server.baseUrl + '/api/sprints');
                expect(sprints.status()).toBe(200);
                const catalog = await sprints.json();
                expect(catalog.sprints.map(row => String(row.id))).toEqual(expect.arrayContaining(['101', '102']));
                expect(catalog.cache.validatedAt).toBeTruthy();
                expect(catalog.cache.catalogVersion).toBeTruthy();
                expect((await metadata(context)).capabilities.canSave).toBe(true);
            }
            const column = { id: randomUUID(), rowKind: 'story', label: 'Synthetic effort', type: 'number', aggregation: 'sum' };
            const current = await metadata(a);
            const body = { groupId: GROUP_ID, baseSchemaRevision: current.schemaRevision,
                schemaChanges: [{ action: 'add', column }], cellChanges: [] };
            const bad = await a.request.patch(endpoint(101), { data: body, headers: await csrfHeaders(server, b) });
            expect(bad.status()).toBe(403);
            expect((await metadata(a)).schemaRevision).toBe(current.schemaRevision);
            const added = await save(a, body);
            expect(added.status()).toBe(200);
            const schema = await added.json();
            const persisted = await save(a, { baseSchemaRevision: schema.schemaRevision,
                cellChanges: [{ issueId: '8101', rowKind: 'story', columnId: column.id, value: '3', baseRevision: 0 }] });
            expect(persisted.status(), await persisted.text()).toBe(200);
            for (const context of [a, b]) {
                const values = await read(context, ['8101', '8102', '8103']);
                expect(values.cells).toEqual(expect.arrayContaining([
                    expect.objectContaining({ issueId: '8101', columnId: column.id, value: '3.000', revision: 1 }),
                ]));
            }
            expect((await server.inspect()).reviewCells).toBe(1);
            const beforeRestart = await server.inspect();
            expect(beforeRestart.failures).toEqual([]);
            expect(beforeRestart.mutations).toEqual([]);
            await server.control('restart');
            expect((await server.inspect()).sourceProof).toEqual(beforeRestart.sourceProof);
            expect((await read(b, ['8101'])).cells[0].value).toBe('3.000');
        } finally { await a.close(); await b.close(); }
    });

    test('provider scope: real work reads distinguish Teams and physical quarters', async ({ browser }) => {
        const { a, b } = await server.createContexts(browser);
        try {
            for (const [context, sprint, team, expected] of [
                [a, 101, TEAM_A, ['8101']], [b, 101, TEAM_B, ['8102']],
                [a, 102, TEAM_A, ['8101']], [b, 102, TEAM_B, ['8103']],
            ]) {
                const query = new URLSearchParams({ sprint: String(sprint), groupId: GROUP_ID, teamIds: team });
                const response = await context.request.get(server.baseUrl + '/api/tasks?' + query);
                expect(response.status(), await response.text()).toBe(200);
                const body = await response.json();
                expect(new Set(body.issues.map(issue => issue.id)).size).toBe(body.issues.length);
                expect(body.issues.map(issue => issue.id).sort()).toEqual(expected);
                const points = body.issues.reduce((total, issue) => total + issue.fields.customfield_10004, 0);
                expect(points).toBe(expected[0] === '8101' ? 3 : expected[0] === '8102' ? 5 : 8);
            }
            const unavailable = await a.request.post(endpoint(101) + '/values/read', {
                data: { groupId: GROUP_ID, issueIds: ['8999'], rowKind: 'story' }, headers: await csrfHeaders(server, a),
            });
            expect(unavailable.status()).toBe(200);
            expect((await unavailable.json()).unavailableIssueIds).toEqual(['8999']);
            const visible = await read(b, ['8999']);
            expect(visible.cells).toEqual([]);
            expect(visible.unavailableIssueIds).toEqual([]);
        } finally { await a.close(); await b.close(); }
    });

    test('promoted namespace: server-produced stamp admits both quarters for two members', async ({ browser }) => {
        await server.prepare({ promoted: true });
        const { a, b } = await server.createContexts(browser);
        try {
            const configResponse = await a.request.get(server.baseUrl + '/api/config');
            expect(configResponse.status()).toBe(200);
            const config = await configResponse.json();
            expect(config.workConfigurationsPromoted).toBe(true);
            const delivery = config.workConfigurationSummaries.find(row => row.id === 'delivery');
            expect(delivery.digest).toEqual(expect.any(String));
            for (const [context, sprint, quarter] of [[a, 101, '2027Q1'], [b, 102, '2027Q2']]) {
                const query = new URLSearchParams({ groupId: GROUP_ID, configurationId: delivery.id,
                    configurationRevision: String(delivery.revision), quarter });
                const response = await context.request.get(endpoint(sprint) + '?' + query);
                expect(response.status(), await response.text()).toBe(200);
                const meta = await response.json();
                expect(meta.capabilities.canSave).toBe(true);
                const saved = await save(context, { baseSchemaRevision: meta.schemaRevision,
                    configuration: { id: delivery.id, revision: delivery.revision, quarter, digest: delivery.digest },
                    schemaChanges: [], cellChanges: [] }, sprint);
                expect(saved.status(), await saved.text()).toBe(200);
            }
        } finally { await a.close(); await b.close(); await server.prepare(); }
    });

    test('v2 journey: include A/B, remove A, preserve B across session/reload and isolate Sprint', async ({ browser }) => {
        const { a, b, pageA, pageB } = await server.createContexts(browser);
        async function savePlan(page) {
            const responsePromise = page.waitForResponse(response => response.url() === endpoint(101)
                && response.request().method() === 'PATCH');
            await page.getByRole('button', { name: 'Save plan', exact: true }).click();
            const response = await responsePromise;
            expect(response.status(), await response.text()).toBe(200);
            return response.json();
        }
        try {
            await openPlanning(pageA);
            const initial = await metadata(a);
            // Intentional Task1 red boundary: the real table/auth/catalog smoke
            // passes first; these fields arrive with the shared-plan contract.
            expect(initial.plan, 'v2 plan metadata is absent before shared-plan implementation').toEqual({ exists: false, revision: 0 });
            expect(initial.scopeProof).toEqual(expect.any(String));
            await expect(rowCheckbox(pageA, 'SYN-8101')).not.toBeChecked();
            await expect(rowCheckbox(pageA, 'SYN-8102')).not.toBeChecked();
            await pageA.getByRole('button', { name: 'Select All', exact: true }).click();
            await expect(rowCheckbox(pageA, 'SYN-8101')).toBeChecked();
            await expect(rowCheckbox(pageA, 'SYN-8102')).toBeChecked();
            const included = await savePlan(pageA);
            expect((await server.readOperation(included.operationId)).state).toBe('committed');
            await teamFilter(pageA, 'Synthetic Team A');
            await pageA.getByRole('button', { name: 'Clear Selection', exact: true }).click();
            await expect(rowCheckbox(pageA, 'SYN-8101')).not.toBeChecked();
            await savePlan(pageA);
            await teamFilter(pageA, 'All Teams');
            await expect(rowCheckbox(pageA, 'SYN-8102')).toBeChecked();
            for (const context of [a, b]) {
                const meta = await metadata(context);
                const projection = await read(context, ['8101', '8102'], { includePlan: true,
                    expectedPlanRevision: meta.plan.revision, expectedScopeProof: meta.scopeProof });
                expect(projection.planEntries).toEqual(expect.arrayContaining([
                    expect.objectContaining({ issueId: '8101', included: false }),
                    expect.objectContaining({ issueId: '8102', included: true }),
                ]));
            }
            await pageA.reload();
            await openPlanning(pageA);
            await openPlanning(pageB);
            for (const page of [pageA, pageB]) {
                await expect(rowCheckbox(page, 'SYN-8101')).not.toBeChecked();
                await expect(rowCheckbox(page, 'SYN-8102')).toBeChecked();
            }
            await selectSprint(pageB, '2027Q2');
            await expect(rowCheckbox(pageB, 'SYN-8101')).not.toBeChecked();
            expect((await metadata(b, 102)).plan).toEqual({ exists: false, revision: 0 });
            expect((await server.inspect()).mutations).toEqual([]);
        } finally { await a.close(); await b.close(); }
    });
});
