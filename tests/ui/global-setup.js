const fs = require('node:fs');
const path = require('node:path');

// Fail fast when the gitignored frontend build is missing or incomplete (mirrors backend/frontend_build.py).
const root = path.resolve(__dirname, '..', '..');
const dist = path.join(root, 'frontend', 'dist');
const hint = 'run `npm run build` first (`npm ci && npm run build` on a fresh checkout)';
const LOCAL_IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"'?#]+)/g;

function missingBuild() {
    if (!fs.existsSync(dist)) return 'frontend/dist is absent';
    const html = fs.readFileSync(path.join(root, 'jira-dashboard.html'), 'utf8');
    const required = new Set([...html.matchAll(/frontend\/dist\/([^"'\s>?#]+)/g)].map(match => match[1]));
    const manifests = fs.readdirSync(dist).filter(name => /^lazy-views-[a-f0-9]{64}\.json$/.test(name));
    if (manifests.length !== 1) return `expected exactly one lazy-views-*.json, found ${manifests.length}`;
    required.add(manifests[0]);
    const entries = ['dashboard.js'];
    for (const view of Object.values(JSON.parse(fs.readFileSync(path.join(dist, manifests[0]), 'utf8')).views)) entries.push(view.path);
    for (const name of [...required, ...entries]) if (!fs.existsSync(path.join(dist, name))) return `${name} is missing`;
    const seen = new Set();
    const pending = entries.map(name => path.join(dist, name));
    while (pending.length) {
        const current = pending.pop();
        if (seen.has(current)) continue;
        seen.add(current);
        for (const [, target] of fs.readFileSync(current, 'utf8').matchAll(LOCAL_IMPORT)) {
            const file = path.resolve(path.dirname(current), target);
            if (!file.startsWith(dist + path.sep)) continue;
            if (!fs.existsSync(file)) return `${path.relative(dist, file)} (imported by ${path.basename(current)}) is missing`;
            pending.push(file);
        }
    }
    return null;
}

module.exports = async function globalSetup() {
    const missing = missingBuild();
    if (missing) throw new Error(`Frontend build is incomplete: ${missing}. ${hint}.`);
};
