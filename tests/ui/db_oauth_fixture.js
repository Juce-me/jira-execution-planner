const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

// Source isolation and DB migrations have a separate budget from browser assertions.
const DB_OAUTH_SETUP_TIMEOUT_MS = 90000;

// The owned cluster needs initdb/pg_ctl/createdb: pass JEP_TEST_PG_BIN through, or
// the directory of the initdb on PATH, as tests/postgres_cluster.py resolves them.
function postgresBinDir() {
    if (process.env.JEP_TEST_PG_BIN) return process.env.JEP_TEST_PG_BIN;
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (dir && fs.existsSync(path.join(dir, 'initdb'))) return dir;
    }
    return '';
}

// Every app import happens in the Python launcher's fresh synthetic checkout.
// Only explicitly selected executable paths are inherited; never process.env.
async function startDbOAuthServer({ python, databaseUrl, mode = 'app', historical = false, forceStartupFailure = false } = {}) {
    const root = path.resolve(__dirname, '..', '..');
    const executable = python || process.env.JEP_TEST_PYTHON || path.join(root, '.venv', 'bin', 'python');
    const args = ['-s', path.join(root, 'tests', 'fixtures', 'db_oauth_server.py')];
    if (databaseUrl) args.push('--database-url', databaseUrl);
    args.push('--mode', mode);
    if (historical) args.push('--historical');
    if (forceStartupFailure) args.push('--force-startup-failure');
    const startupStarted = performance.now();
    const env = { PATH: '/usr/bin:/bin', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' };
    const pgBin = postgresBinDir();
    if (pgBin) env.JEP_TEST_PG_BIN = pgBin;
    const child = spawn(executable, args, {
        cwd: root, env,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let sequence = 0;
    let stopped = false;
    const pending = new Map();
    const ready = new Promise((resolve, reject) => pending.set('ready', { resolve, reject }));
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        const id = message.ready ? 'ready' : message.id;
        const handler = pending.get(id);
        if (!handler) return;
        pending.delete(id);
        if (message.ok === false) handler.reject(new Error(message.error));
        else handler.resolve(message);
    });
    // Include only fixed diagnostic categories, never arbitrary server output or
    // callback query strings, in browser failures.
    let diagnostic = 'Synthetic fixture phase: launcher';
    const timings = [];
    const diagnosticLines = readline.createInterface({ input: child.stderr });
    diagnosticLines.on('line', line => {
        if (/^Synthetic fixture timing: [a-z-]+=\d+ms$/.test(line)) timings.push(line.replace('Synthetic fixture timing: ', ''));
        if (/^Synthetic (?:fixture phase: [a-z-]+|DB\/OAuth fixture failed: [a-z-]+\/[A-Za-z]+)$/.test(line)
            && !(line.endsWith('launcher/SystemExit') && diagnostic.includes('fixture failed:'))) diagnostic = line;
        if (line === 'Operation not permitted') diagnostic = 'Owned loopback binding was denied.';
    });
    const fail = () => {
        for (const handler of pending.values()) handler.reject(new Error('Synthetic DB/OAuth fixture stopped. ' + diagnostic));
        pending.clear();
    };
    child.on('exit', fail);
    child.on('error', fail);
    const exited = new Promise(resolve => child.once('close', resolve));
    async function control(command, values = {}) {
        const id = ++sequence;
        const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        child.stdin.write(JSON.stringify({ id, command, ...values }) + '\n');
        return response;
    }
    async function stop() {
        if (stopped) return;
        stopped = true;
        if (child.exitCode === null) {
            if (mode === 'app' || mode === 'measurement' || mode === 'planning') {
                await Promise.race([control('stop').catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000).unref())]);
            } else child.kill('SIGTERM');
            child.stdin.end();
            await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 12000).unref())]);
            if (child.exitCode === null) child.kill('SIGTERM');
            await exited;
        }
        // Drain diagnostics before closing readers: exit can precede stderr EOF.
        await exited;
        lines.close();
        diagnosticLines.close();
        if (startup && diagnostic.startsWith('Synthetic DB/OAuth fixture failed:')
            && !diagnostic.endsWith('/KeyboardInterrupt')) {
            const message = diagnostic.endsWith('/ClusterError')
                ? 'Owned PostgreSQL fixture cleanup failed. ' : 'Owned fixture shutdown failed. ';
            throw new Error(message + diagnostic);
        }
    }
    let startup;
    const timer = setTimeout(() => {
        const handler = pending.get('ready');
        if (handler) handler.reject(new Error(`Synthetic DB/OAuth fixture startup timed out after ${Math.round(performance.now() - startupStarted)}ms. ${diagnostic}; ${timings.join(', ')}`));
    }, DB_OAUTH_SETUP_TIMEOUT_MS);
    try { startup = await ready; } catch (error) { await stop(); throw error; }
    finally { clearTimeout(timer); }
    console.log(`Synthetic DB/OAuth fixture startup: ${Math.round(performance.now() - startupStarted)}ms; ${timings.join(', ')}`);
    const baseUrl = startup.baseUrl;
    const unhandledExternalRequests = [];

    async function login(page, actor = 'actor-a') {
        await control('selectActor', { actor });
        // This is the provider boundary only. Login, state/PKCE cookie, callback,
        // encrypted tokens and opaque session creation remain real application code.
        const provider = 'https://synthetic-oauth.invalid/**';
        const handler = async route => {
            const authorization = new URL(route.request().url());
            const callback = new URL('/api/auth/atlassian/callback', baseUrl);
            callback.searchParams.set('state', authorization.searchParams.get('state'));
            callback.searchParams.set('code', 'synthetic-provider-code');
            await route.fulfill({ status: 302, headers: { location: callback.href } });
        };
        await page.route(provider, handler);
        try {
            // Routing a redirect's subsequent request is browser-dependent.
            // Read the real login redirect without following it, then make the
            // provider URL the routed navigation's initial request.
            const entry = await page.context().request.get(baseUrl + '/api/auth/atlassian/login', { maxRedirects: 0 });
            if (entry.status() !== 302) throw new Error('Synthetic OAuth login did not redirect.');
            const authorization = new URL(entry.headers().location);
            const syntheticProvider = new URL('https://synthetic-oauth.invalid/authorize');
            syntheticProvider.searchParams.set('state', authorization.searchParams.get('state'));
            await page.goto(syntheticProvider.href);
        }
        finally { await page.unroute(provider, handler); }
        return (await control('inspect', { actor })).actor;
    }

    async function createContext(browser, actor = 'actor-a') {
        const context = await browser.newContext();
        try {
            context.on('response', response => {
                const origin = new URL(response.url()).origin;
                if (origin !== baseUrl && origin !== 'https://synthetic-oauth.invalid') {
                    unhandledExternalRequests.push(origin);
                }
            });
            await context.route('**/*', route => {
                if (new URL(route.request().url()).origin === baseUrl) return route.continue();
                return route.abort('blockedbyclient');
            });
            await control('selectActor', { actor });
            const entry = await context.request.get(baseUrl + '/api/auth/atlassian/login', { maxRedirects: 0 });
            if (entry.status() !== 302) throw new Error('Synthetic OAuth login did not redirect.');
            const authorization = new URL(entry.headers().location);
            const callback = new URL('/api/auth/atlassian/callback', baseUrl);
            callback.searchParams.set('state', authorization.searchParams.get('state'));
            callback.searchParams.set('code', 'synthetic-provider-code');
            const response = await context.request.get(callback.href, { maxRedirects: 0 });
            if (response.status() !== 302) throw new Error('Synthetic OAuth callback failed.');
            return context;
        } catch (error) { await context.close(); throw error; }
    }
    async function createContexts(browser) {
        const a = await createContext(browser, 'actor-a');
        try { return { a, b: await createContext(browser, 'actor-b') }; }
        catch (error) { await a.close(); throw error; }
    }
    async function quarterlyConfiguration(action) {
        if (!['begin', 'enable', 'disable', 'restore'].includes(action)) throw new Error('Invalid quarterly fixture transition.');
        return control('quarterlyConfiguration', { action });
    }
    return { baseUrl, baseURL: baseUrl, createContext, createContexts, login, control, quarterlyConfiguration, stop, unhandledExternalRequests };
}

module.exports = { DB_OAUTH_SETUP_TIMEOUT_MS, startDbOAuthServer };
