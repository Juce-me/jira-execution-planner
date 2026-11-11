const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

// Playwright keeps this module for the worker's lifetime. Browser contexts and
// mutable fixtures remain test-scoped; only compiled dashboard bytes are reused.
const cache = new Map();
const maxEntries = 16;

function ordered(value) {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') {
        if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('non-JSON option');
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
    }
    if (['function', 'symbol', 'bigint', 'undefined'].includes(typeof value)) throw new Error('non-JSON option');
    return value;
}

function keyFor(options) {
    if (options.write !== false || options.plugins?.length || options.stdin || options.metafile
        || options.entryPoints?.length !== 1 || typeof options.entryPoints[0] !== 'string') return null;
    const cwd = path.resolve(options.absWorkingDir || process.cwd());
    const entry = path.resolve(cwd, options.entryPoints[0]);
    if (!entry.endsWith(path.join('frontend', 'src', 'dashboard.jsx'))) return null;
    try { return JSON.stringify({ cwd, options: ordered({ ...options, entryPoints: [entry] }) }); }
    catch (_) { return null; }
}

function stamp(file) {
    try {
        const stat = fs.statSync(file, { bigint: true });
        return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return 'absent';
        throw error;
    }
}

function dependencies(options, result) {
    const cwd = path.resolve(options.absWorkingDir || process.cwd());
    const files = new Set([path.join(cwd, 'package-lock.json')]);
    for (const input of Object.keys(result.metafile.inputs)) {
        const file = path.resolve(cwd, input);
        files.add(file);
        // Package metadata participates in module resolution even though esbuild
        // does not list it as an input. Track absent files as well as existing ones.
        for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
            files.add(dir); // New candidates can change extension/package resolution.
            files.add(path.join(dir, 'package.json'));
            if (dir === cwd || dir === path.dirname(dir)) break;
        }
    }
    return [...files].map(file => [file, stamp(file)]);
}

function freshResult(result) {
    return { ...result, errors: [...result.errors], warnings: [...result.warnings],
        outputFiles: result.outputFiles.map(output => {
            const contents = new Uint8Array(output.contents);
            return { ...output, contents, get text() { return new TextDecoder().decode(contents); } };
        }) };
}

function remember(key, entry, options, result) {
    const inputs = dependencies(options, result);
    delete result.metafile;
    entry.result = result;
    entry.inputs = inputs;
    if (cache.get(key) === entry) {
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    }
    return freshResult(result);
}

function existing(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.result && !entry.inputs.every(([file, before]) => stamp(file) === before)) {
        cache.delete(key);
        return null;
    }
    return entry;
}

function buildSync(options) {
    const key = keyFor(options);
    if (!key) return esbuild.buildSync(options);
    const hit = existing(key);
    if (hit?.result) return freshResult(hit.result);
    const entry = {};
    cache.set(key, entry);
    try { return remember(key, entry, options, esbuild.buildSync({ ...options, metafile: true })); }
    catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
}

async function build(options) {
    const key = keyFor(options);
    if (!key) return esbuild.build(options);
    const hit = existing(key);
    if (hit?.result) return freshResult(hit.result);
    if (hit?.pending) { await hit.pending; return build(options); }
    const entry = {};
    cache.set(key, entry);
    entry.pending = esbuild.build({ ...options, metafile: true });
    try { return remember(key, entry, options, await entry.pending); }
    catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
}

module.exports = { ...esbuild, build, buildSync };
