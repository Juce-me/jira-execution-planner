const { test, expect } = require('@playwright/test');
const { randomBytes } = require('node:crypto');
const { DB_OAUTH_SETUP_TIMEOUT_MS, GROUP_ID, csrfHeaders, startPlanningSharedPlanServer } = require('./planning_shared_plan_fixture');

function operationId() {
    const bytes = randomBytes(16);
    bytes.writeUIntBE(Date.now(), 0, 6);
    bytes[6] = (bytes[6] & 15) | 0x70;
    bytes[8] = (bytes[8] & 63) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

test('real v2 HTTP saves use authoritative scope, cross-user projection and durable receipt', async ({ browser }) => {
    test.setTimeout(DB_OAUTH_SETUP_TIMEOUT_MS + 60000);
    const server = await startPlanningSharedPlanServer();
    let contexts;
    try {
        contexts = await server.createContexts(browser);
        const { a, b } = contexts;
        const path = server.baseUrl + '/api/eng/sprints/101/review';
        const metaResponse = await a.request.get(path + '?groupId=' + GROUP_ID);
        expect(metaResponse.status()).toBe(200);
        const meta = await metaResponse.json();
        expect(meta.plan).toEqual({ exists: false, revision: 0 });
        expect(meta.scopeProof).toEqual(expect.any(String));
        const body = { version: 2, groupId: GROUP_ID, operationId: operationId(), initializePlan: true,
            basePlanRevision: 0, baseScopeProof: meta.scopeProof, baseSchemaRevision: 0,
            inclusionChanges: [{ issueId: '8101', included: true, baseRevision: 0 },
                { issueId: '8102', included: true, baseRevision: 0 }] };
        const saved = await a.request.patch(path, { data: body, headers: await csrfHeaders(server, a) });
        expect(saved.status(), await saved.text()).toBe(200);
        expect((await saved.json()).plan).toEqual({ exists: true, revision: 1 });
        expect((await server.readOperation(body.operationId)).state).toBe('committed');
        const read = await b.request.post(path + '/values/read', { data: { groupId: GROUP_ID,
            issueIds: ['8101', '8102', '8103', '8999'], rowKind: 'story', includePlan: true,
            expectedPlanRevision: 1, expectedScopeProof: meta.scopeProof }, headers: await csrfHeaders(server, b) });
        expect(read.status(), await read.text()).toBe(200);
        const projection = await read.json();
        expect(projection.planEntries).toEqual([{ issueId: '8101', included: true, revision: 1 },
            { issueId: '8102', included: true, revision: 1 }, { issueId: '8999', included: false, revision: 0 }]);
        expect(projection.unavailableIssueIds).toEqual(['8103']);
        const status = await a.request.get(path + '/operations/' + body.operationId + '?groupId=' + GROUP_ID);
        expect((await status.json()).status).toBe('committed');
        expect(await status.text()).not.toContain('8101');
        const other = await b.request.get(path + '/operations/' + body.operationId + '?groupId=' + GROUP_ID);
        expect((await other.json()).status).toBe('unknown');
        const replay = await a.request.patch(path, { data: body, headers: await csrfHeaders(server, a) });
        expect(replay.status(), await replay.text()).toBe(200);
        expect((await replay.json()).inclusionChanges).toEqual((await saved.json()).inclusionChanges);
        // Promotion changes current source/namespace admission; the retained original outcome survives.
        await server.prepare({ promoted: true });
        const changedScopeReplay = await a.request.patch(path, { data: body, headers: await csrfHeaders(server, a) });
        expect(changedScopeReplay.status(), await changedScopeReplay.text()).toBe(200);
        expect((await changedScopeReplay.json()).inclusionChanges).toEqual((await saved.json()).inclusionChanges);
        expect((await server.inspect()).mutations).toEqual([]);
    } finally {
        await contexts?.a.close(); await contexts?.b.close(); await server.stop();
    }
});

test('real v2 promoted namespace saves an empty plan without touching Legacy', async ({ browser }) => {
    test.setTimeout(DB_OAUTH_SETUP_TIMEOUT_MS + 60000);
    const server = await startPlanningSharedPlanServer();
    let contexts;
    try {
        await server.prepare({ promoted: true });
        contexts = await server.createContexts(browser);
        const { a, b } = contexts;
        const config = await (await a.request.get(server.baseUrl + '/api/config')).json();
        const delivery = config.workConfigurationSummaries.find(row => row.id === 'delivery');
        const path = server.baseUrl + '/api/eng/sprints/101/review';
        const query = new URLSearchParams({ groupId: GROUP_ID, configurationId: delivery.id,
            configurationRevision: String(delivery.revision), quarter: '2027Q1' });
        const metaResponse = await a.request.get(path + '?' + query);
        expect(metaResponse.status(), await metaResponse.text()).toBe(200);
        const meta = await metaResponse.json();
        expect(meta.planCapabilities.canSave).toBe(true);
        const other = await (await b.request.get(path + '?' + query)).json();
        expect(other.scopeProof).toBe(meta.scopeProof);
        const body = { version: 2, groupId: GROUP_ID, operationId: operationId(), initializePlan: true,
            basePlanRevision: 0, baseScopeProof: meta.scopeProof, baseSchemaRevision: 0,
            configuration: { id: delivery.id, revision: delivery.revision, quarter: '2027Q1', digest: delivery.digest },
            inclusionChanges: [] };
        const saved = await a.request.patch(path, { data: body, headers: await csrfHeaders(server, a) });
        expect(saved.status(), await saved.text()).toBe(200);
        expect((await saved.json()).plan).toEqual({ exists: true, revision: 1 });
        const retained = await a.request.get(path + '/operations/' + body.operationId
            + '?groupId=' + GROUP_ID + '&configurationId=' + delivery.id);
        expect((await retained.json()).status).toBe('committed');
        const wrong = await a.request.get(path + '/operations/' + body.operationId + '?groupId=' + GROUP_ID);
        expect(wrong.status()).toBe(409);
        await server.prepare({ promoted: true });
        const refreshed = await (await a.request.get(path + '?' + query)).json();
        expect(refreshed.scopeProof).toBe(meta.scopeProof);
        expect(refreshed.plan).toEqual({ exists: true, revision: 1 });
        expect((await server.inspect()).mutations).toEqual([]);
    } finally {
        await contexts?.a.close(); await contexts?.b.close(); await server.stop();
    }
});
