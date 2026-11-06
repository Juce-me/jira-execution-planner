const { DB_OAUTH_SETUP_TIMEOUT_MS, startDbOAuthServer } = require('./db_oauth_fixture');

const GROUP_ID = 'planning-synthetic';
const TEAM_A = '11111111-1111-4111-8111-111111111111';
const TEAM_B = '22222222-2222-4222-8222-222222222222';

async function startPlanningSharedPlanServer({ python, databaseUrl } = {}) {
    const server = await startDbOAuthServer({ python, databaseUrl, mode: 'planning' });
    return {
        ...server,
        async createContexts(browser) {
            const contexts = await server.createContexts(browser);
            try {
                return { ...contexts, pageA: await contexts.a.newPage(), pageB: await contexts.b.newPage() };
            } catch (error) { await contexts.a.close(); await contexts.b.close(); throw error; }
        },
        prepare: ({ promoted = false } = {}) => server.control('planningPrepare', { promoted }),
        inspect: () => server.control('planningInspect').then(result => result.planning),
        expireSession: (actor, sessionId) => server.control('expireSession', { actor, sessionId }),
        pauseSave: () => server.control('planningPauseSave'),
        releaseSave: () => server.control('planningReleaseSave'),
        dropNextAckAfterCommit: () => server.control('planningDropAck'),
        allowProviderReauth: (page, actor) => server.login(page, actor),
        readOperation: (operationId, actor = 'actor-a') => server.control('planningReadOperation', { operationId, actor })
            .then(result => result.planning),
    };
}

async function csrfHeaders(server, context) {
    const response = await context.request.get(server.baseUrl + '/api/auth/csrf',
        { headers: { 'X-Requested-With': 'jira-execution-planner' } });
    if (response.status() !== 200) throw new Error('Planning fixture CSRF bootstrap failed.');
    return { 'X-Requested-With': 'jira-execution-planner', 'X-CSRF-Token': (await response.json()).csrfToken };
}

module.exports = { DB_OAUTH_SETUP_TIMEOUT_MS, GROUP_ID, TEAM_A, TEAM_B, csrfHeaders, startPlanningSharedPlanServer };
