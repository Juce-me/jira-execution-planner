// Build the synthetic fixture using the actual Settings components and opt-in mapping rows.
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const outdir = path.join(root, 'tmp');
fs.mkdirSync(outdir, { recursive: true });
const result = esbuild.buildSync({
    entryPoints: [path.join(root, 'assets/mockups/quarterly-work-structure-fields.jsx')],
    bundle: true,
    outfile: path.join(outdir, 'quarterly-work-structure-fields.js'),
    format: 'iife',
    minify: true,
    metafile: true,
    define: { 'process.env.NODE_ENV': '"production"' },
});
fs.writeFileSync(path.join(outdir, 'quarterly-work-structure-fields.meta.json'), JSON.stringify(result.metafile, null, 2));
console.log('Built Settings mockup from JiraFieldSettings.jsx and its existing dependencies.');

if (process.argv.includes('--serve')) {
    const http = require('node:http');
    const requestedPort = process.argv.find(arg => arg.startsWith('--port='));
    const port = requestedPort ? Number(requestedPort.slice('--port='.length)) : 5062;
    if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535))) throw new Error('Use port 0 or a port from 1024 through 65535.');
    const mockupPath = '/assets/mockups/quarterly-work-structure-settings.html';
    const server = http.createServer((request, response) => {
        let pathname;
        try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
        catch { response.writeHead(400).end(); return; }
        if (pathname === '/') {
            response.writeHead(302, { Location: mockupPath }).end();
            return;
        }
        const allowed = pathname === mockupPath
            || pathname === '/tmp/quarterly-work-structure-fields.js'
            || /^\/frontend\/src\/styles\/[a-zA-Z0-9_/-]+\.css$/.test(pathname);
        if (!allowed || !['GET', 'HEAD'].includes(request.method)) {
            response.writeHead(404).end();
            return;
        }
        const file = path.resolve(root, '.' + pathname);
        if (!file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
        try {
            const body = fs.readFileSync(file);
            const type = pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.js') ? 'text/javascript' : 'text/html';
            response.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(request.method === 'HEAD' ? undefined : body);
        } catch { response.writeHead(404).end(); }
    });
    server.listen(port, '127.0.0.1', () => console.log('Mockup ready at http://localhost:' + server.address().port + mockupPath));
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    process.on('SIGTERM', () => server.close());
    process.on('SIGINT', () => server.close());
}
