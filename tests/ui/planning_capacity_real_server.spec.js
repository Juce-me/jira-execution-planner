const { test, expect } = require('@playwright/test');
const { DB_OAUTH_SETUP_TIMEOUT_MS, TEAM_A, TEAM_B, csrfHeaders, startPlanningSharedPlanServer } = require('./planning_shared_plan_fixture');

// #323 Task 10: Planning Team capacity against the real Flask app and the owned PostgreSQL cluster. Actors A and B are
// non-admin members of one workspace (workspace isolation is proven at route level in Task 1). The synthetic Jira has
// one "Team info 2027Q1 - Synthetic Team A" ticket (20) and none for Team B or for 2027Q2, so 2027Q2 is the no-ticket
// path for both Teams. The provider refuses every Jira mutation unless a test opts in to the capacity PUT.
const CAPACITY_KEY = 'SYNCAP-9001';
const CAPACITY_FIELD = 'customfield_10030';
const TEAMS = { [TEAM_A]: 'Synthetic Team A', [TEAM_B]: 'Synthetic Team B' };

test.describe('real Planning Team capacity', () => {
    test.describe.configure({ mode: 'serial' });
    let server;
    // Every response either context receives; the journey must see no CSRF (or any other) 403.
    const forbidden = [];
    test.beforeAll(async () => {
        test.setTimeout(DB_OAUTH_SETUP_TIMEOUT_MS + 30000);
        server = await startPlanningSharedPlanServer();
    });
    test.afterAll(async () => {
        try {
            if (server) {
                const state = await server.inspect();
                expect(state.failures).toEqual([]);
                expect(state.mutations, 'the default provider guard: Planning never mutates Jira').toEqual([]);
                expect(server.unhandledExternalRequests).toEqual([]);
                expect(forbidden).toEqual([]);
            }
        } finally { await server?.stop(); }
    });

    const capacityPath = sprint => `/api/eng/sprints/${sprint}/assignee-capacity`;
    async function contexts(browser) {
        const opened = await server.createContexts(browser);
        for (const context of [opened.a, opened.b]) {
            context.on('response', response => {
                if (response.status() === 403) forbidden.push(`${response.request().method()} ${new URL(response.url()).pathname}`);
            });
        }
        return opened;
    }
    async function storedDocument(context, sprint, teamId) {
        const response = await context.request.get(server.baseUrl + capacityPath(sprint) + '?teamId=' + teamId);
        expect(response.status(), await response.text()).toBe(200);
        return response.json();
    }
    async function batchRead(context, sprint, teamIds) {
        const response = await context.request.post(server.baseUrl + capacityPath(sprint) + '/planned/read', {
            data: { teamIds }, headers: await csrfHeaders(server, context) });
        expect(response.status(), await response.text()).toBe(200);
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
    async function openCards(page, sprint) {
        await page.goto(server.baseUrl);
        await selectSprint(page, sprint);
        await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Planning', exact: true }).check();
        await expect(page.locator('.planning-review-table')).toBeVisible();
        await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
        await page.getByRole('button', { name: 'Show capacity details', exact: true }).click();
        await expect(page.locator('.planning-team-capacity-cards .team-stat-card')).toHaveCount(2);
    }
    const card = (page, teamId) => page.locator(`.planning-team-capacity-cards .team-stat-card[data-capacity-team="${teamId}"]`);
    // The stored-number pencil of a no-ticket Team: type, then Enter commits.
    async function typeTeamNumber(page, teamId, value) {
        await card(page, teamId).hover();
        await card(page, teamId).getByRole('button', { name: `Edit ${TEAMS[teamId]} team capacity`, exact: true }).click();
        const input = card(page, teamId).getByRole('spinbutton', { name: `${TEAMS[teamId]} team capacity (not in Jira)` });
        await expect(input).toBeFocused();
        await input.fill(value);
        await input.press('Enter');
    }
    // Holds this page's stored-number PATCHes until the test releases them (GETs pass through).
    async function holdPatches(page) {
        const held = [];
        await page.route(url => /\/api\/eng\/sprints\/\d+\/assignee-capacity$/.test(url.pathname), route => {
            if (route.request().method() !== 'PATCH') return route.continue();
            held.push(route);
        });
        return held;
    }
    const isCapacityPatch = (response, sprint) => response.request().method() === 'PATCH'
        && new URL(response.url()).pathname === capacityPath(sprint);

    test('two Teams saved concurrently both persist, and the other member reads them back', async ({ browser }) => {
        const { a, b, pageA, pageB } = await contexts(browser);
        try {
            await openCards(pageA, '2027Q2');
            const held = await holdPatches(pageA);
            await typeTeamNumber(pageA, TEAM_A, '14');
            await typeTeamNumber(pageA, TEAM_B, '6');
            await expect.poll(() => held.length, 'both Team saves are in flight at once').toBe(2);
            expect(held.map(route => route.request().postDataJSON())).toEqual([
                { teamId: TEAM_A, planned: { value: '14', source: 'user' }, changes: [] },
                { teamId: TEAM_B, planned: { value: '6', source: 'user' }, changes: [] },
            ]);
            const answers = Promise.all([0, 1].map(() => pageA.waitForResponse(response => isCapacityPatch(response, 102))));
            await Promise.all(held.map(route => route.continue()));
            expect((await answers).map(response => response.status())).toEqual([200, 200]);
            await pageA.unrouteAll({ behavior: 'wait' });

            for (const [teamId, value] of [[TEAM_A, '14'], [TEAM_B, '6']]) {
                const own = await storedDocument(b, 102, teamId);
                expect(own).toMatchObject({ teamId, revision: 1, planned: { value, source: 'user' }, inherited: null });
            }
            const projection = await batchRead(b, 102, [TEAM_A, TEAM_B]);
            expect(projection.teams).toEqual([
                { teamId: TEAM_A, revision: 1, planned: { value: '14', source: 'user' }, inherited: null },
                { teamId: TEAM_B, revision: 1, planned: { value: '6', source: 'user' }, inherited: null },
            ]);
            await openCards(pageB, '2027Q2');
            await expect(card(pageB, TEAM_A).locator('.microbar-meta')).toContainText('Cap 14.0');
            await expect(card(pageB, TEAM_B).locator('.microbar-meta')).toContainText('Cap 6.0');
            await expect(card(pageB, TEAM_A)).toHaveAttribute('data-planned-source', 'user');
            expect(forbidden).toEqual([]);
        } finally { await a.close(); await b.close(); }
    });

    test('A and B editing the same Team resolve last-write-wins', async ({ browser }) => {
        const { a, b, pageA, pageB } = await contexts(browser);
        try {
            // Both members load 14 before either saves.
            await openCards(pageA, '2027Q2');
            await openCards(pageB, '2027Q2');
            for (const page of [pageA, pageB]) await expect(card(page, TEAM_A).locator('.microbar-meta')).toContainText('Cap 14.0');
            const first = pageA.waitForResponse(response => isCapacityPatch(response, 102));
            await typeTeamNumber(pageA, TEAM_A, '10');
            expect((await first).status()).toBe(200);
            expect((await storedDocument(b, 102, TEAM_A)).planned).toEqual({ value: '10', source: 'user' });
            // B still shows its earlier read and saves over A's number: no revision precondition, no conflict.
            await expect(card(pageB, TEAM_A).locator('.microbar-meta')).toContainText('Cap 14.0');
            const second = pageB.waitForResponse(response => isCapacityPatch(response, 102));
            await typeTeamNumber(pageB, TEAM_A, '12');
            const answer = await second;
            expect(answer.status()).toBe(200);
            expect((await answer.json()).planned).toEqual({ value: '12', source: 'user' });
            for (const context of [a, b]) {
                const own = await storedDocument(context, 102, TEAM_A);
                expect(own).toMatchObject({ revision: 3, planned: { value: '12', source: 'user' } });
            }
            // B's write did not touch Team B.
            expect((await storedDocument(a, 102, TEAM_B)).planned).toEqual({ value: '6', source: 'user' });
            expect(forbidden).toEqual([]);
        } finally { await a.close(); await b.close(); }
    });

    test('one click on → pushes the stored number to the Team\'s own ticket through the opt-in fake Jira PUT', async ({ browser }) => {
        const { a, b, pageA } = await contexts(browser);
        try {
            const seeded = await a.request.patch(server.baseUrl + capacityPath(101), {
                data: { teamId: TEAM_A, planned: { value: '14', source: 'user' }, changes: [] }, headers: await csrfHeaders(server, a) });
            expect(seeded.status(), await seeded.text()).toBe(200);
            const before = (await server.inspect()).calls.length;
            await openCards(pageA, '2027Q1');
            await expect(card(pageA, TEAM_A)).toHaveAttribute('data-capacity-attention', 'mismatch');
            await expect(card(pageA, TEAM_A).locator('.microbar-meta')).toContainText('Cap 20.0');
            await expect(card(pageA, TEAM_B)).not.toHaveAttribute('data-capacity-attention', /./);
            expect((await server.inspect()).calls.slice(before).filter(call => call.method !== 'GET' && call.path !== '/rest/api/3/search/jql'),
                'opening Planning writes nothing to Jira').toEqual([]);

            await server.allowCapacityPut(true);
            await card(pageA, TEAM_A).hover();
            const push = card(pageA, TEAM_A).getByRole('button', { name: 'Apply Synthetic Team A team capacity to Jira', exact: true });
            await expect(push).toBeVisible();
            const jiraWrite = pageA.waitForResponse(response => response.request().method() === 'PATCH'
                && new URL(response.url()).pathname === '/api/capacity/' + CAPACITY_KEY);
            const settle = pageA.waitForResponse(response => isCapacityPatch(response, 101));
            await push.click();
            const written = await jiraWrite;
            expect(written.request().postDataJSON()).toEqual({ sprintName: '2027Q1', teamName: 'Synthetic Team A', expectedCapacity: 20, capacity: 14 });
            expect(written.status()).toBe(200);
            expect(await written.json()).toEqual({ issueKey: CAPACITY_KEY, teamName: 'Synthetic Team A', previousCapacity: 20, capacity: 14, result: 'success' });
            const settled = await settle;
            expect(settled.request().postDataJSON()).toEqual({ teamId: TEAM_A, planned: { value: '14', source: 'jira' }, changes: [] });
            expect(settled.status()).toBe(200);
            await expect(card(pageA, TEAM_A)).not.toHaveAttribute('data-capacity-attention', /./);
            await expect(card(pageA, TEAM_A).locator('.microbar-meta')).toContainText('Cap 14.0');
            await card(pageA, TEAM_A).hover();
            await expect(push).toHaveCount(0);

            const state = await server.inspect();
            expect(state.capacityPuts, 'exactly one PUT, to the Team\'s own ticket, of the capacity field only')
                .toEqual([{ actor: 'actor-a', key: CAPACITY_KEY, fields: { [CAPACITY_FIELD]: 14 } }]);
            expect(state.capacityTickets).toEqual({ [CAPACITY_KEY]: 14 });
            const issueCalls = state.calls.slice(before).filter(call => call.path === '/rest/api/3/issue/' + CAPACITY_KEY).map(call => call.method);
            expect(issueCalls, 'the validation GET precedes the one PUT').toEqual(['GET', 'PUT']);
            await server.allowCapacityPut(false);

            // The other member reads the ticket after the update and the settled stored number.
            const ticket = await b.request.get(server.baseUrl + '/api/capacity?' + new URLSearchParams({ sprint: '2027Q1', teams: 'Synthetic Team A' }));
            expect(ticket.status()).toBe(200);
            expect((await ticket.json()).entries).toEqual([{ teamName: 'Synthetic Team A', issueKey: CAPACITY_KEY, capacity: 14 }]);
            expect((await storedDocument(b, 101, TEAM_A)).planned).toEqual({ value: '14', source: 'jira' });
            expect(forbidden).toEqual([]);
        } finally { await server.allowCapacityPut(false); await a.close(); await b.close(); }
    });

    // Parked from Task 4: with a late readiness answer, does All Teams read the Team-info tickets twice for one scope?
    for (const [label, points] of [['every Team pointed', 5], ['Team B only unpointed', 0]]) test(`late readiness: the Jira capacity read per scope (${label})`, async ({ browser }, testInfo) => {
        await server.setStoryPoints('8102', points);
        const { a, b, pageA } = await contexts(browser);
        try {
            const before = (await server.inspect()).calls.length;
            const browserReads = [];
            pageA.on('request', request => {
                const url = new URL(request.url());
                if (url.pathname === '/api/capacity') browserReads.push(url.searchParams.get('teams'));
            });
            let readinessAnswered = false;
            await pageA.route('**/api/eng/story-readiness?*', async route => {
                await new Promise(resolve => setTimeout(resolve, 2500));
                await route.continue();
                readinessAnswered = true;
            });
            await openCards(pageA, '2027Q1');
            await expect.poll(() => readinessAnswered).toBe(true);
            await expect(pageA.locator('.planning-review-state-note', { hasText: /could not/i })).toHaveCount(0);
            await pageA.waitForTimeout(1500);
            const searches = (await server.inspect()).calls.slice(before).filter(call => /\bsummary\s*~/.test(call.jql || '')).map(call => call.jql);
            testInfo.annotations.push({ type: 'double-read', description: JSON.stringify({ label, browserReads, jiraSearches: searches.length }) });
            expect(new Set(searches).size, 'no Team-info search repeats for an identical scope').toBe(searches.length);
            expect(browserReads.at(-1), 'the settled read covers the card set').toBe('Synthetic Team A,Synthetic Team B');
            expect(searches).toHaveLength(browserReads.length);
            if (points) expect(browserReads, 'every Team pointed: one read even with late readiness').toEqual(['Synthetic Team A,Synthetic Team B']);
            expect(forbidden).toEqual([]);
        } finally { await server.setStoryPoints('8102', 5); await a.close(); await b.close(); }
    });

    test('sign-in expiry mid-save gives terminal recovery and never replays the save', async ({ browser }) => {
        const { a, b, pageA } = await contexts(browser);
        try {
            await openCards(pageA, '2027Q2');
            const sent = [];
            pageA.on('request', request => {
                if (request.method() !== 'GET' && /\/assignee-capacity$/.test(new URL(request.url()).pathname)) sent.push(request.postDataJSON());
            });
            const held = await holdPatches(pageA);
            await typeTeamNumber(pageA, TEAM_B, '7');
            await expect.poll(() => held.length).toBe(1);
            for (const sessionId of (await server.control('inspect', { actor: 'actor-a' })).actor.sessionIds) {
                await server.expireSession('actor-a', sessionId);
            }
            const answer = pageA.waitForResponse(response => isCapacityPatch(response, 102));
            await held[0].continue();
            expect((await answer).status()).toBe(401);
            const gate = pageA.getByRole('alertdialog');
            await expect(gate).toBeVisible();
            await expect(gate.getByRole('link', { name: 'Sign in again' })).toBeVisible();
            await pageA.waitForTimeout(1000);
            expect(sent, 'one PATCH, never replayed').toEqual([{ teamId: TEAM_B, planned: { value: '7', source: 'user' }, changes: [] }]);
            expect(held).toHaveLength(1);
            expect((await storedDocument(b, 102, TEAM_B)).planned, 'nothing was stored').toEqual({ value: '6', source: 'user' });
            expect(forbidden).toEqual([]);
        } finally { await a.close(); await b.close(); }
    });
});
