const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '../..');
let port;
let baseUrl;
let server;
let clientBundle;

function prototypeSource(serverPort) { return String.raw`
import json
import time
from flask import Flask, Response
from backend.services.eng_board_stream import EngBoardStreamWriter

app = Flask(__name__)

@app.get('/')
def index():
    return '<!doctype html><meta charset="utf-8"><title>Stream prototype</title>'

@app.get('/health')
def health():
    return {'ok': True}

@app.get('/api/eng/board')
def stream():
    def frames():
        writer = EngBoardStreamWriter()
        yield writer.write({
            'protocolVersion': 1, 'generationId': 'prototype-generation', 'sequence': 0,
            'type': 'start', 'scope': 'all_work', 'scopeVersion': 'prototype-scope',
            'scopeCohortDigest': 'a' * 64,
            'columns': [{'id': 'todo', 'name': 'Plan 🚀', 'color': '#123456',
                         'statusNames': ['To Do'], 'terminal': False}],
        })
        time.sleep(0.75)
        yield writer.write({
            'protocolVersion': 1, 'generationId': 'prototype-generation', 'sequence': 1,
            'type': 'complete', 'outcome': 'success', 'authoritative': True,
            'epicCount': 0, 'childCount': 0,
            'diagnostics': {'indexMs': 1, 'focusedCompleteMs': None, 'durationMs': 750,
                            'jiraRequests': 0, 'jiraPages': 0, 'jiraRetries': 0,
                            'peakChildSearches': 0, 'cacheState': 'miss',
                            'completeness': 'complete'},
        })
    return Response(frames(), content_type='application/x-ndjson',
                    headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})

app.run(host='127.0.0.1', port=${serverPort}, debug=False, threaded=True, use_reloader=False)
`; }

test.beforeAll(async () => {
    // Avoid a separate test-process bind probe, which restricted sandboxes may
    // reject even though the approved Flask child can bind its own listener.
    port = 20_000 + (process.pid % 20_000);
    baseUrl = `http://127.0.0.1:${port}`;
    clientBundle = esbuild.buildSync({
        entryPoints: [path.join(root, 'frontend/src/api/engBoardApi.js')],
        bundle: true,
        write: false,
        format: 'iife',
        globalName: 'EngBoardStreamClient',
        platform: 'browser',
    }).outputFiles[0].text;
    server = spawn(path.join(root, '.venv/bin/python'), ['-u', '-c', prototypeSource(port)], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: '', TEST_DATABASE_URL: '' },
        stdio: 'ignore',
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
            if ((await fetch(`${baseUrl}/health`)).ok) return;
        } catch (error) {}
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('isolated Flask stream prototype did not become ready');
});

test.afterAll(() => {
    if (server && !server.killed) server.kill('SIGTERM');
});

test('real Flask stream renders a validated frame while the response remains open', async ({ page }) => {
    await page.goto(baseUrl);
    await page.addScriptTag({ content: clientBundle });
    await page.evaluate(() => {
        window.prototypeFrames = [];
        window.prototypeStartedAt = performance.now();
        window.prototypeRequest = window.EngBoardStreamClient.streamEngBoard({
            departmentId: 'synthetic-department',
            scope: 'all_work',
            onFrame(frame) {
                window.prototypeFrames.push({ frame, receivedAt: performance.now() });
            },
        }).then(frame => { window.prototypeTerminal = frame; });
    });

    await expect.poll(() => page.evaluate(() => window.prototypeFrames.length)).toBe(1);
    const first = await page.evaluate(() => ({
        frame: window.prototypeFrames[0].frame,
        elapsed: window.prototypeFrames[0].receivedAt - window.prototypeStartedAt,
        terminal: window.prototypeTerminal || null,
    }));
    expect(first.frame.type).toBe('start');
    expect(first.frame.columns[0].name).toBe('Plan 🚀');
    expect(first.elapsed).toBeLessThan(500);
    expect(first.terminal).toBeNull();

    await page.evaluate(() => window.prototypeRequest);
    expect(await page.evaluate(() => window.prototypeTerminal.type)).toBe('complete');
});
