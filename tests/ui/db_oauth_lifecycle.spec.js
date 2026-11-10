const { test, expect } = require('@playwright/test');
const { DB_OAUTH_SETUP_TIMEOUT_MS, startDbOAuthServer } = require('./db_oauth_fixture');

test.describe('real DB/OAuth fixture lifecycle', () => {
    test.describe.configure({ mode: 'serial' });
    let server;
    test.beforeAll(async () => {
        test.setTimeout(DB_OAUTH_SETUP_TIMEOUT_MS + 30000);
        server = await startDbOAuthServer();
    });
    test.afterAll(async () => {
        try { if (server) expect(server.unhandledExternalRequests).toEqual([]); }
        finally { await server?.stop(); }
    });

    async function csrf(context) {
        const response = await context.request.get(server.baseUrl + '/api/auth/csrf',
            { headers: { 'X-Requested-With': 'jira-execution-planner' } });
        expect(response.status()).toBe(200);
        return (await response.json()).csrfToken;
    }
    async function headers(context) {
        return { 'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': await csrf(context) };
    }

    test('real callback creates private identities and rejects missing/cross-session CSRF', async ({ browser }) => {
        const { a, b } = await server.createContexts(browser);
        try {
            for (const context of [a, b]) {
                expect((await (await context.request.get(server.baseUrl + '/api/auth/status')).json()).authenticated).toBe(true);
            }
            const body = { name: 'Synthetic private view', viewType: 'eng', view: {} };
            const endpoint = server.baseUrl + '/api/me/views';
            expect((await a.request.post(endpoint, { data: body })).status()).toBe(403);
            expect((await a.request.post(endpoint, { data: body,
                headers: { 'X-Requested-With': 'jira-execution-planner' } })).status()).toBe(403);
            expect((await a.request.post(endpoint, { data: body,
                headers: { 'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': await csrf(b) } })).status()).toBe(403);
            const created = await a.request.post(endpoint, { data: body, headers: await headers(a) });
            expect(created.status()).toBe(201);
            const id = (await created.json()).view.id;
            const own = await (await a.request.get(endpoint)).json();
            const other = await (await b.request.get(endpoint)).json();
            expect(own.views.some(view => view.id === id)).toBe(true);
            expect(other.views.some(view => view.id === id)).toBe(false);
            expect((await b.request.patch(endpoint + '/' + id, {
                data: { name: 'Forbidden rename' }, headers: await headers(b),
            })).status()).toBe(404);
        } finally { await a.close(); await b.close(); }
    });

    test('provider refresh rotates encrypted DB token and logout preserves the other browser session', async ({ browser }) => {
        const a = await server.createContext(browser, 'actor-a');
        const second = await server.createContext(browser, 'actor-a');
        try {
            await server.control('selectActor', { actor: 'actor-a' });
            const before = (await server.control('inspect', { actor: 'actor-a' })).actor;
            await server.control('expireToken', { actor: 'actor-a' });
            const response = await a.request.post(server.baseUrl + '/api/auth/refresh', { headers: await headers(a) });
            expect(response.status()).toBe(200);
            expect((await response.json()).authenticated).toBe(true);
            const after = (await server.control('inspect', { actor: 'actor-a' })).actor;
            expect(after.tokenVersion).toBeGreaterThan(before.tokenVersion);
            expect(after.refreshCount).toBe(before.refreshCount + 1);
            const logout = await a.request.post(server.baseUrl + '/api/auth/logout', { headers: await headers(a) });
            expect(logout.status()).toBe(200);
            expect((await (await a.request.get(server.baseUrl + '/api/auth/status')).json()).authenticated).toBe(false);
            expect((await (await second.request.get(server.baseUrl + '/api/auth/status')).json()).authenticated).toBe(true);
        } finally { await a.close(); await second.close(); }
    });

    test('expired DB session is rejected while another actor stays signed in; same-tab provider login recovers', async ({ browser }) => {
        const before = (await server.control('inspect', { actor: 'actor-a' })).actor.sessionIds;
        const { a, b } = await server.createContexts(browser);
        try {
            const actor = (await server.control('inspect', { actor: 'actor-a' })).actor;
            const sessionId = actor.sessionIds.find(id => !before.includes(id));
            expect(sessionId).toBeTruthy();
            await server.control('expireSession', { actor: 'actor-a', sessionId });
            expect((await a.request.get(server.baseUrl + '/api/me/views')).status()).toBe(401);
            expect((await (await b.request.get(server.baseUrl + '/api/auth/status')).json()).authenticated).toBe(true);
            const page = await a.newPage();
            await page.goto(server.baseUrl + '/login?reason=session_expired');
            await expect(page.locator('body')).toContainText(/sign in/i);
            await page.screenshot({ path: 'tmp/planning-331-db-oauth-login.png', animations: 'disabled' });
            await server.login(page, 'actor-a');
            expect(new URL(page.url()).origin).toBe(server.baseUrl);
            expect((await (await a.request.get(server.baseUrl + '/api/auth/status')).json()).authenticated).toBe(true);
            expect(a.pages()).toHaveLength(1);
            await page.screenshot({ path: 'tmp/planning-331-db-oauth-recovered.png', animations: 'disabled' });
        } finally { await a.close(); await b.close(); }
    });

    test('forged signed-cookie input never grants a DB identity', async ({ browser }) => {
        const context = await browser.newContext();
        try {
            await context.addCookies([{ name: 'session', value: 'forged-db-session', url: server.baseUrl }]);
            expect((await context.request.get(server.baseUrl + '/api/me/views')).status()).toBe(401);
        } finally { await context.close(); }
    });

    test('provider refresh rejection returns sanitized auth failure and permits a new callback', async ({ browser }) => {
        const context = await server.createContext(browser, 'actor-b');
        try {
            const requestHeaders = await headers(context);
            await server.control('expireToken', { actor: 'actor-b' });
            await server.control('providerRefreshFailure', { enabled: true });
            const failed = await context.request.post(server.baseUrl + '/api/auth/refresh', { headers: requestHeaders });
            expect(failed.status()).toBe(401);
            const body = await failed.json();
            expect(body.error).toMatch(/auth|refresh/);
            expect(JSON.stringify(body)).not.toMatch(/synthetic-(?:access|refresh)|invalid_grant/);
            await server.control('providerRefreshFailure', { enabled: false });
            const page = await context.newPage();
            await server.login(page, 'actor-b');
            expect((await (await context.request.get(server.baseUrl + '/api/auth/status')).json()).authenticated).toBe(true);
        } finally {
            await server.control('providerRefreshFailure', { enabled: false });
            await context.close();
        }
    });

    test('fresh child restart preserves signed cookies, encrypted tokens and private rows', async ({ browser }) => {
        const context = await server.createContext(browser);
        try {
            const before = (await server.control('inspect')).actor;
            const cookies = await context.cookies();
            const views = await (await context.request.get(server.baseUrl + '/api/me/views')).json();
            await server.control('restart');
            expect(await context.cookies()).toEqual(cookies);
            expect((await (await context.request.get(server.baseUrl + '/api/auth/status')).json()).authenticated).toBe(true);
            expect(await (await context.request.get(server.baseUrl + '/api/me/views')).json()).toEqual(views);
            const after = (await server.control('inspect')).actor;
            expect(after.userId).toBe(before.userId);
            expect(after.workspaceId).toBe(before.workspaceId);
            expect(after.tokenVersion).toBe(before.tokenVersion);
            expect(after.sessionIds.sort()).toEqual(before.sessionIds.sort());
        } finally { await context.close(); }
    });

    test('disabled users and revoked connections are rejected by real DB resolution', async ({ browser }) => {
        const context = await server.createContext(browser);
        try {
            await server.control('userStatus', { status: 'disabled' });
            expect((await context.request.get(server.baseUrl + '/api/me/views')).status()).toBe(401);
            await server.control('userStatus', { status: 'active' });
            await server.control('connectionStatus', { status: 'revoked' });
            expect((await context.request.get(server.baseUrl + '/api/me/views')).status()).toBe(401);
            const page = await context.newPage();
            await server.login(page);
            expect((await (await context.request.get(server.baseUrl + '/api/auth/status')).json()).authenticated).toBe(true);
        } finally {
            await server.control('userStatus', { status: 'active' });
            await context.close();
        }
    });

    test('storage outage is sanitized and restoring DB access preserves the session', async ({ browser }) => {
        const context = await server.createContext(browser);
        try {
            await server.control('storageFailure', { enabled: true });
            const failed = await context.request.get(server.baseUrl + '/api/me/views');
            expect(failed.status()).toBe(503);
            const body = await failed.text();
            expect(body).not.toMatch(/Synthetic fixture|sqlite|postgresql:\/\/|psycopg|Traceback|synthetic-access/);
            await server.control('storageFailure', { enabled: false });
            expect((await context.request.get(server.baseUrl + '/api/me/views')).status()).toBe(200);
        } finally {
            await server.control('storageFailure', { enabled: false });
            await context.close();
        }
    });

    test('unconfigured and configured workspace bootstrap preserve private views and DB login', async ({ browser }) => {
        const context = await server.createContext(browser);
        try {
            const privateViews = await (await context.request.get(server.baseUrl + '/api/me/views')).json();
            await server.control('dashboardConfig', { enabled: false });
            const missing = await context.request.get(server.baseUrl + '/api/config');
            expect(missing.status()).toBe(200);
            expect((await missing.json()).adminSettingsMissing.sort()).toEqual(['scope', 'source']);
            await server.control('dashboardConfig', { enabled: true });
            const configured = await context.request.get(server.baseUrl + '/api/config');
            expect(configured.status()).toBe(200);
            expect((await configured.json()).adminSettingsMissing).toEqual([]);
            expect(await (await context.request.get(server.baseUrl + '/api/me/views')).json()).toEqual(privateViews);
            expect((await (await context.request.get(server.baseUrl + '/api/auth/status')).json()).authenticated).toBe(true);
        } finally { await context.close(); }
    });

    test('quarterly HTTP promotion switches DB sources for both users and fails closed with the flag off', async ({ browser }) => {
        const { a, b } = await server.createContexts(browser);
        const configUrl = server.baseUrl + '/api/work-structure/config';
        const bootstrapUrl = server.baseUrl + '/api/config';
        const viewsUrl = server.baseUrl + '/api/me/views';
        const before = await Promise.all([a, b].map(async context => ({
            views: await (await context.request.get(viewsUrl)).json(),
        })));
        await server.quarterlyConfiguration('begin');
        try {
            for (const context of [a, b]) {
                const bootstrap = await (await context.request.get(bootstrapUrl)).json();
                expect(bootstrap.workConfigurationsEnabled).toBe(true);
                expect(bootstrap.workConfigurationsPromoted).toBe(false);
                expect(bootstrap.workConfigurationSummaries).toEqual([]);
                expect(bootstrap.boardId).toBe('701');
                const flat = await context.request.get(server.baseUrl + '/api/components');
                expect(flat.status()).toBe(200);
                expect((await flat.json()).components).toEqual([
                    { id: 'component-SYN', name: 'Synthetic SYN', projectKey: 'SYN' },
                ]);
            }
            const editor = await (await a.request.get(configUrl)).json();
            expect(editor.promoted).toBe(false);
            expect(editor.configRevision).toBe(0);
            expect(editor.workConfigurations.promotionRevision).toBeNull();
            expect(editor.workConfigurations.configurations.map(entry => entry.revision)).toEqual([0, 0]);
            expect(editor.userCanEditSettings).toBe(true);
            expect((await (await b.request.get(configUrl)).json()).userCanEditSettings).toBe(false);
            // Save through the real fenced promotion service; only provider metadata is stubbed.
            const delivery = editor.workConfigurations.configurations.find(entry => entry.id === 'delivery');
            delivery.scope.projects = [{ key: 'NEXT', type: 'product' }];
            const saveBody = { baseRevision: editor.configRevision,
                workConfigurations: editor.workConfigurations, legacyEdits: [] };
            expect((await b.request.post(configUrl, { data: saveBody, headers: await headers(b) })).status()).toBe(403);
            const savedResponse = await a.request.post(configUrl, { data: saveBody, headers: await headers(a) });
            expect(savedResponse.status()).toBe(200);
            const saved = await savedResponse.json();
            expect(saved.promoted).toBe(true);
            expect(saved.configRevision).toBe(1);
            expect(saved.workConfigurations.promotionRevision).toBe(1);
            expect(saved.changedConfigurationIds.sort()).toEqual(['delivery', 'legacy']);
            expect(saved.workConfigurations.configurations.map(entry => entry.revision)).toEqual([1, 1]);
            const scopedUrl = server.baseUrl + '/api/components?quarter=2027Q1&configurationId=delivery&configurationRevision=1';
            for (const context of [a, b]) {
                const reloaded = await (await context.request.get(configUrl)).json();
                expect(reloaded.workConfigurations).toEqual(saved.workConfigurations);
                const bootstrap = await (await context.request.get(bootstrapUrl)).json();
                expect(bootstrap.workConfigurationsPromoted).toBe(true);
                expect(bootstrap).not.toHaveProperty('boardId');
                expect(bootstrap.sharedConfig).not.toHaveProperty('projects');
                expect(bootstrap.sharedConfig).not.toHaveProperty('workConfigurations');
                expect(bootstrap.workConfigurationSummaries.map(entry => entry.id)).toEqual(['legacy', 'delivery']);
                expect(bootstrap.workConfigurationSummaries.every(entry => entry.revision === 1 && /^[a-f0-9]{32}$/.test(entry.digest))).toBe(true);
                const unscoped = await context.request.get(server.baseUrl + '/api/components');
                expect(unscoped.status()).toBe(409);
                expect((await unscoped.json()).error).toBe('configuration_required');
                const scoped = await context.request.get(scopedUrl);
                expect(scoped.status()).toBe(200);
                expect(await scoped.json()).toEqual({ configurationId: 'delivery', configurationRevision: 1,
                    components: [{ id: 'component-NEXT', name: 'Synthetic NEXT', projectKey: 'NEXT' }] });
            }
            await server.quarterlyConfiguration('disable');
            for (const context of [a, b]) {
                const blocked = await context.request.get(scopedUrl);
                expect(blocked.status()).toBe(409);
                expect((await blocked.json()).error).toBe('configuration_feature_disabled');
                const editorOff = await (await context.request.get(configUrl)).json();
                expect(editorOff.promoted).toBe(true);
                expect(editorOff.featureEnabled).toBe(false);
                expect(editorOff.workConfigurations).toEqual(saved.workConfigurations);
            }
            const blockedWrite = await a.request.post(configUrl, { headers: await headers(a),
                data: { baseRevision: saved.configRevision, workConfigurations: saved.workConfigurations } });
            expect(blockedWrite.status()).toBe(409);
            expect((await blockedWrite.json()).error).toBe('configuration_feature_disabled');
            await server.quarterlyConfiguration('enable');
            expect((await b.request.get(scopedUrl)).status()).toBe(200);
            for (const [index, context] of [a, b].entries()) {
                expect(await (await context.request.get(viewsUrl)).json()).toEqual(before[index].views);
                expect((await (await context.request.get(server.baseUrl + '/api/auth/status')).json()).authenticated).toBe(true);
            }
        } finally {
            try {
                const restored = await server.quarterlyConfiguration('restore');
                expect(restored.quarterly.authStorageUnchanged).toBe(true);
                expect((await (await a.request.get(configUrl)).json()).userCanEditSettings).toBe(false);
            } finally { await a.close(); await b.close(); }
        }
    });
});
