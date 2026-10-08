import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const views = {
    stats: ['frontend/src/stats/StatsPanel.jsx', 'default'],
    scenario: ['frontend/src/scenario/ScenarioView.jsx', 'ScenarioView'],
    settings: ['frontend/src/settings/SettingsModalContainer.jsx', 'default'],
};
const slash = value => value.split(path.sep).join('/');
function effectiveOptions(mode) {
    return {
        entryPoints: ['frontend/src/dashboard.jsx'], bundle: true, minify: mode === 'production',
        sourcemap: true, format: 'esm', splitting: true, outdir: 'frontend/dist',
        chunkNames: 'chunks/[name]-[hash]', metafile: true, write: false,
        loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    };
}
function capture(root, mode) {
    const files = new Map();
    function visit(relative) {
        for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const name = `${relative}/${entry.name}`;
            if (entry.isDirectory()) visit(name);
            else if (entry.isFile()) files.set(name, fs.readFileSync(path.join(root, name)));
            else throw new Error(`Unsupported frontend source entry: ${name}`);
        }
    }
    visit('frontend/src');
    for (const name of ['package.json', 'package-lock.json', 'scripts/build_dashboard.mjs']) files.set(name, fs.readFileSync(path.join(root, name)));
    const hash = createHash('sha256');
    function record(name, bytes) {
        hash.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`); hash.update(bytes);
    }
    record('effective-options', Buffer.from(JSON.stringify(effectiveOptions(mode))));
    for (const name of [...files.keys()].sort()) record(name, files.get(name));
    return { files, buildId: hash.digest('hex') };
}
function snapshotPlugin(root, snapshot) {
    const sourceRoot = path.join(root, 'frontend/src') + path.sep;
    return { name: 'immutable-frontend-snapshot', setup(api) {
        api.onLoad({ filter: /./ }, args => {
            if (!args.path.startsWith(sourceRoot)) return;
            const relative = slash(path.relative(root, args.path));
            if (!snapshot.files.has(relative)) throw new Error(`Frontend source absent from build snapshot: ${relative}`);
            const extension = path.extname(args.path).slice(1);
            if (extension === 'css') return { contents: '', loader: 'empty' };
            const loader = { js: 'js', jsx: 'jsx', mjs: 'js', json: 'json' }[extension];
            if (!loader) throw new Error(`Unsupported frontend snapshot loader: ${relative}`);
            return { contents: snapshot.files.get(relative), loader, resolveDir: path.dirname(args.path) };
        });
    } };
}
function outputsFor(root, snapshot, result) {
    const dist = path.join(root, 'frontend/dist');
    const outputs = new Map(result.outputFiles.map(file => [slash(path.relative(dist, file.path)), file.contents]));
    const manifest = { schemaVersion: 1, buildId: snapshot.buildId, views: {} };
    for (const [id, [entry, exportName]] of Object.entries(views)) {
        const matches = Object.entries(result.metafile.outputs).filter(([name, info]) => name.endsWith('.js') && info.entryPoint && slash(path.relative(root, path.resolve(root, info.entryPoint))) === entry);
        if (matches.length !== 1) throw new Error(`Expected exactly one dynamic output for ${entry}`);
        const [name, info] = matches[0];
        const relative = slash(path.relative(dist, path.resolve(root, name)));
        const stem = path.basename(entry, '.jsx');
        if (!new RegExp(`^chunks/${stem}-[A-Z0-9]+\\.js$`).test(relative) || !info.exports.includes(exportName) || !outputs.has(relative)) throw new Error(`Invalid dynamic output for ${entry}`);
        manifest.views[id] = { path: relative, exportName };
    }
    outputs.set(`lazy-views-${snapshot.buildId}.json`, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    for (const name of outputs.keys()) {
        if (!/^(dashboard\.js(?:\.map)?|chunks\/[A-Za-z0-9_-]+\.js(?:\.map)?|lazy-views-[a-f0-9]{64}\.json)$/.test(name)) throw new Error(`Unexpected build output: ${name}`);
    }
    return outputs;
}
function publish(root, outputs, io) {
    const dist = path.join(root, 'frontend/dist');
    const ordered = [...outputs.keys()].sort((a, b) => Number(a.startsWith('dashboard.')) - Number(b.startsWith('dashboard.')) || a.localeCompare(b));
    const stale = [];
    const chunks = path.join(dist, 'chunks');
    if (io.existsSync(chunks)) for (const name of io.readdirSync(chunks)) {
        if (/\.js(?:\.map)?$/.test(name) && !outputs.has(`chunks/${name}`)) stale.push(`chunks/${name}`);
    }
    if (io.existsSync(dist)) for (const name of io.readdirSync(dist)) {
        if (/^lazy-views-[a-f0-9]{64}\.json$/.test(name) && !outputs.has(name)) stale.push(name);
    }
    const previous = new Map([...ordered, ...stale].map(name => {
        const target = path.join(dist, name);
        return [name, io.existsSync(target) ? io.readFileSync(target) : null];
    }));
    const staging = io.mkdtempSync(path.join(root, 'frontend/.dashboard-build-'));
    const touched = [];
    try {
        // Stage every byte before replacing any working output.
        for (const name of ordered) {
            const staged = path.join(staging, name);
            io.mkdirSync(path.dirname(staged), { recursive: true });
            io.writeFileSync(staged, outputs.get(name));
        }
        // Synchronous publication admits no watcher callback after final validation.
        for (const name of ordered) {
            const destination = path.join(dist, name);
            io.mkdirSync(path.dirname(destination), { recursive: true });
            touched.push(name);
            io.renameSync(path.join(staging, name), destination);
        }
        for (const name of stale) {
            touched.push(name);
            io.unlinkSync(path.join(dist, name));
        }
        io.rmSync(staging, { recursive: true, force: true });
    } catch (error) {
        const failures = [error];
        for (const name of touched.reverse()) {
            try {
                const destination = path.join(dist, name);
                const bytes = previous.get(name);
                if (bytes === null) io.rmSync(destination, { force: true });
                else io.writeFileSync(destination, bytes);
            } catch (rollbackError) { failures.push(rollbackError); }
        }
        try { io.rmSync(staging, { recursive: true, force: true }); }
        catch (cleanupError) { failures.push(cleanupError); }
        if (failures.length > 1) throw new AggregateError(failures, 'Build publication and rollback failed');
        throw error;
    }
}

export function createBuildCoordinator({ root = process.cwd(), mode = 'production', build = esbuild, publishFs = fs, onPublish = () => {} } = {}) {
    if (!['production', 'development'].includes(mode)) throw new Error(`Unsupported build mode: ${mode}`);
    root = path.resolve(root);
    let dirty = 0;
    let running = null;
    async function drain() {
        for (;;) {
            const generation = dirty;
            const snapshot = capture(root, mode);
            let outputs;
            try {
                const result = await build({ ...effectiveOptions(mode), absWorkingDir: root,
                    define: { ...effectiveOptions(mode).define, __JEP_DASHBOARD_BUILD_ID__: JSON.stringify(snapshot.buildId) },
                    plugins: [snapshotPlugin(root, snapshot)],
                });
                outputs = outputsFor(root, snapshot, result);
            } catch (error) {
                if (generation !== dirty || capture(root, mode).buildId !== snapshot.buildId) continue;
                throw error;
            }
            if (generation !== dirty || capture(root, mode).buildId !== snapshot.buildId) continue;
            publish(root, outputs, publishFs); onPublish(snapshot.buildId);
            return snapshot.buildId;
        }
    }
    return { invalidate() { dirty++; return running; }, requestBuild() {
        dirty++;
        if (!running) running = drain().finally(() => { running = null; });
        return running;
    } };
}

export function watchDashboard({ coordinator, root = process.cwd(), watch = fs.watch,
    setTimer = setTimeout, clearTimer = clearTimeout, onError = console.error } = {}) {
    let timer;
    const rebuild = () => coordinator.requestBuild().catch(onError);
    const watcher = watch(path.join(root, 'frontend/src'), { recursive: true }, () => {
        clearTimer(timer);
        timer = undefined;
        // Active builds observe invalidation immediately and drain the latest snapshot.
        // Only idle bursts need a timer; they must not queue an extra active rebuild.
        if (!coordinator.invalidate()) timer = setTimer(() => { timer = undefined; rebuild(); }, 50);
    });
    return { ready: rebuild(), close() { clearTimer(timer); watcher.close(); } };
}

async function main() {
    const watching = process.argv.includes('--watch');
    const coordinator = createBuildCoordinator({ mode: watching ? 'development' : 'production', onPublish: id => console.log(`Dashboard built: ${id}`) });
    if (!watching) { await coordinator.requestBuild(); return; }
    const session = watchDashboard({ coordinator });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { session.close(); process.exit(0); });
    await session.ready;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
