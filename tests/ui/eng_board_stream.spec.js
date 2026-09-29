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
import time
import uuid
from flask import Flask, Response, request
from gunicorn.app.base import BaseApplication
from backend.services.eng_board_stream import (
    EngBoardChildScheduler, EngBoardRequestBudget, EngBoardStreamWriter,
)

app = Flask(__name__)

@app.get('/')
def index():
    return '<!doctype html><meta charset="utf-8"><title>Stream prototype</title>'

@app.get('/health')
def health():
    return {'ok': True}

@app.get('/api/eng/board')
def stream():
    focused = request.args.get('focusedColumnId') or 'todo'
    delay_scale = 2.0 if request.args.get('hold') == '1' else 1.0
    columns = [
        {'id': 'todo', 'name': 'Plan 🚀', 'color': '#123456',
         'statusNames': ['To Do'], 'terminal': False},
        {'id': 'doing', 'name': 'Doing', 'color': '#456789',
         'statusNames': ['In Progress'], 'terminal': False},
    ]
    columns.sort(key=lambda column: column['id'] != focused)

    def frames():
        started = time.monotonic()
        generation_id = str(uuid.uuid4())
        writer = EngBoardStreamWriter()
        def child_search(column_id, delay):
            def run(timeout):
                assert timeout[0] <= 5.0 and timeout[1] <= 30.0
                time.sleep(delay * delay_scale)
                return column_id
            return run

        scheduler = EngBoardChildScheduler([
            child_search(columns[0]['id'], 0.15),
            child_search(columns[1]['id'], 0.25),
            child_search('done', 0.10),
        ], budget=EngBoardRequestBudget.start())
        try:
            yield writer.write({
                'protocolVersion': 1, 'generationId': generation_id, 'sequence': 0,
                'type': 'start', 'scope': 'all_work', 'scopeVersion': 'prototype-scope',
                'scopeCohortDigest': 'a' * 64,
                'columns': columns,
            })
            sequence = 1
            focused_ms = None
            for column_id in scheduler.results():
                elapsed_ms = round((time.monotonic() - started) * 1000, 1)
                if focused_ms is None:
                    focused_ms = elapsed_ms
                yield writer.write({
                    'protocolVersion': 1, 'generationId': generation_id,
                    'sequence': sequence, 'type': 'progress', 'columnId': column_id,
                    'loadedChildren': 1, 'byEpic': [],
                })
                sequence += 1
            duration_ms = round((time.monotonic() - started) * 1000, 1)
            yield writer.write({
                'protocolVersion': 1, 'generationId': generation_id, 'sequence': sequence,
                'type': 'complete', 'outcome': 'success', 'authoritative': True,
                'epicCount': 3, 'childCount': 3,
                'diagnostics': {'indexMs': 1, 'focusedCompleteMs': focused_ms,
                                'durationMs': duration_ms,
                                'jiraRequests': scheduler.scheduled_searches,
                                'jiraPages': scheduler.scheduled_searches, 'jiraRetries': 0,
                                'peakChildSearches': scheduler.peak_child_searches,
                                'cacheState': 'miss', 'completeness': 'complete'},
            })
        finally:
            scheduler.retire()
    return Response(frames(), content_type='application/x-ndjson',
                    headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})

class PrototypeApplication(BaseApplication):
    def load_config(self):
        settings = {
            'bind': '127.0.0.1:${serverPort}', 'workers': 1, 'threads': 8,
            'timeout': 120, 'accesslog': None, 'errorlog': '-', 'loglevel': 'warning',
        }
        for key, value in settings.items():
            self.cfg.set(key, value)

    def load(self):
        return app

PrototypeApplication().run()
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
        stdio: 'inherit',
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (server.exitCode !== null) {
            throw new Error('isolated Flask stream prototype exited early');
        }
        try {
            if ((await fetch(`${baseUrl}/health`)).ok) return;
        } catch (error) {}
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('isolated Flask stream prototype did not become ready');
});

test.afterAll(async () => {
    if (server && server.exitCode === null) {
        server.kill('SIGTERM');
        await Promise.race([
            new Promise(resolve => server.once('exit', resolve)),
            new Promise(resolve => setTimeout(resolve, 2000)),
        ]);
    }
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
            focusedColumnId: 'doing',
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
    expect(first.frame.columns[0].id).toBe('doing');
    expect(first.elapsed).toBeLessThan(100);
    expect(first.terminal).toBeNull();

    await page.evaluate(() => window.prototypeRequest);
    const terminal = await page.evaluate(() => ({
        type: window.prototypeTerminal.type,
        elapsed: performance.now() - window.prototypeStartedAt,
    }));
    expect(terminal.type).toBe('complete');
    expect(terminal.elapsed).toBeLessThan(2000);
});

test('browser abort retires immediately and later server frames cannot mutate delivery', async ({ page }) => {
    await page.goto(baseUrl);
    await page.addScriptTag({ content: clientBundle });
    await page.evaluate(() => {
        window.abortFrames = [];
        window.abortController = new AbortController();
        window.abortRequest = window.EngBoardStreamClient.streamEngBoard({
            departmentId: 'synthetic-department', scope: 'all_work',
            focusedColumnId: 'doing', signal: window.abortController.signal,
            onFrame(frame) { window.abortFrames.push(frame); },
        }).then(
            () => { window.abortOutcome = 'unexpected-success'; },
            error => { window.abortOutcome = error.name; window.abortSettledAt = performance.now(); },
        );
    });
    await expect.poll(() => page.evaluate(() => window.abortFrames.length)).toBe(1);
    const abortedAt = await page.evaluate(() => {
        const value = performance.now();
        window.abortController.abort();
        return value;
    });
    await expect.poll(() => page.evaluate(() => window.abortOutcome)).toBe('AbortError');
    const retirementMs = await page.evaluate(value => window.abortSettledAt - value, abortedAt);
    expect(retirementMs).toBeLessThan(100);
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.abortFrames.length)).toBe(1);
});

test('deployment-equivalent concurrent streams meet synthetic timing and work ceilings', async ({ page }) => {
    await page.goto(baseUrl);
    await page.addScriptTag({ content: clientBundle });
    const samples = await page.evaluate(async () => Promise.all(
        Array.from({ length: 6 }, async (_value, index) => {
            const startedAt = performance.now();
            let firstFrameMs = null;
            let firstContentMs = null;
            const terminal = await window.EngBoardStreamClient.streamEngBoard({
                departmentId: `synthetic-${index}`, scope: 'all_work',
                focusedColumnId: index % 2 ? 'doing' : 'todo',
                onFrame(frame) {
                    const elapsed = performance.now() - startedAt;
                    if (firstFrameMs === null) firstFrameMs = elapsed;
                    if (firstContentMs === null && frame.type === 'progress') firstContentMs = elapsed;
                },
            });
            return {
                firstFrameMs, firstContentMs, fullCompletionMs: performance.now() - startedAt,
                diagnostics: terminal.diagnostics,
            };
        }),
    ));
    const percentile95 = values => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
    const timing = {
        concurrentRequests: samples.length,
        maxFirstFrameMs: Math.max(...samples.map(value => value.firstFrameMs)),
        maxFirstContentMs: Math.max(...samples.map(value => value.firstContentMs)),
        fullCompletionP95Ms: percentile95(samples.map(value => value.fullCompletionMs)),
    };
    console.log(`ENG_BOARD_SYNTHETIC_TIMINGS ${JSON.stringify(timing)}`);
    expect(timing.maxFirstFrameMs).toBeLessThan(100);
    expect(timing.maxFirstContentMs).toBeLessThan(2000);
    expect(timing.fullCompletionP95Ms).toBeLessThanOrEqual(4000);
    for (const sample of samples) {
        expect(sample.diagnostics.peakChildSearches).toBe(2);
        expect(sample.diagnostics.jiraRequests).toBe(3);
        expect(sample.diagnostics.jiraPages).toBe(3);
        expect(sample.diagnostics.completeness).toBe('complete');
    }
});
