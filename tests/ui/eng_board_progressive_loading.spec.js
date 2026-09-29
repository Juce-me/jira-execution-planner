const { spawn } = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installEngBoardDashboardFixture, selectedSprintId, selectedSprintName } = require('./eng_board_dashboard_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const python = path.join(repoRoot, '.venv', 'bin', 'python');
const baselineRevision = '40bffe730159ebadb1904b0188981c853fdf85ed';
const baselineRoot = path.join(repoRoot, 'tmp', 'board-190', 'baseline-source');
const activeCampaignChildren = new Set();
const campaignServer = String.raw`
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util, json, os, re, sys, threading, time
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse
baseline=os.environ.get('BOARD_BASELINE_ROOT')
if baseline:
    import backend.services, backend.routes
    def load(name,relative):
        spec=importlib.util.spec_from_file_location(name,os.path.join(baseline,relative)); module=importlib.util.module_from_spec(spec); sys.modules[name]=module; spec.loader.exec_module(module); return module
    stream_module=load('backend.services.eng_board_stream','backend/services/eng_board_stream.py'); backend.services.eng_board_stream=stream_module
    board_module=load('backend.services.eng_board','backend/services/eng_board.py'); backend.services.eng_board=board_module
    eng_board_routes=load('backend.routes.eng_board_routes','backend/routes/eng_board_routes.py'); backend.routes.eng_board_routes=eng_board_routes
else:
    from backend.routes import eng_board_routes
from backend.services.eng_board_stream import EngBoardRequestTransport
from tests.test_eng_board_routes import FakeResponse, board_query, board_snapshot, db_context, epic, child
if os.environ.get('BOARD_FIXTURE_STARTUP_FAILURE'):
    print('{malformed startup',flush=True); raise SystemExit(2)
class State:
    def __init__(self): self.lock=threading.Lock(); self.events=[]; self.gates={}; self.scenario='component_page_2'; self.sample='unset'; self.component_calls=0; self.parent_calls=0; self.update_id=0; self.eligible_counts={}; self.pending_update_ids=[]
    def record(self,event,**fields):
        with self.lock:
            self.events.append({'sampleId':self.sample,'event':event,'serverNs':time.monotonic_ns(),**fields})
            if len(self.events)>4096: del self.events[:-4096]
    def reset(self,scenario,sample):
        self.release_all()
        with self.lock: self.events=[]; self.gates={}; self.scenario=scenario; self.sample=sample; self.component_calls=0; self.parent_calls=0; self.update_id=0; self.eligible_counts={}; self.pending_update_ids=[]
    def eligible(self,stage,batch,count,complete):
        with self.lock:
            previous=self.eligible_counts.get(stage,0); self.eligible_counts[stage]=count
            membership_adding=count>previous; update_id=None
            if membership_adding and not complete:
                self.update_id+=1; update_id=f'{stage}-{self.update_id}'; self.pending_update_ids.append(update_id)
            self.events.append({'sampleId':self.sample,'event':'eligible_batch','serverNs':time.monotonic_ns(),'stage':stage,'batch':batch,'eligibleEpics':count,'complete':complete,'membershipAdding':membership_adding,'updateId':update_id})
    def candidate_updates(self):
        with self.lock: updates=list(self.pending_update_ids); self.pending_update_ids=[]; return updates
    def gate(self,name):
        with self.lock: gate=self.gates.setdefault(name,threading.Event())
        self.record('gate_wait',gate=name)
        ok=gate.wait(20); self.record('gate_released',gate=name,released=ok)
        if not ok: raise TimeoutError(name)
    def release(self,name):
        with self.lock: gate=self.gates.setdefault(name,threading.Event())
        gate.set()
    def release_all(self):
        with self.lock: gates=list(self.gates.values())
        for gate in gates: gate.set()
S=State()
OriginalWriter=eng_board_routes.EngBoardStreamWriter
class ObservedWriter(OriginalWriter):
    def prepare(self,frame):
        started=time.monotonic_ns(); encoded=super().prepare(frame)
        S.record('writer_prepare',frameType=frame.get('type'),sequence=frame.get('sequence'),serializationNs=time.monotonic_ns()-started,encodedBytes=len(encoded))
        return encoded
    def write(self,frame,**kwargs):
        started=time.monotonic_ns(); encoded=super().write(frame,**kwargs)
        S.record('writer_write',frameType=frame.get('type'),sequence=frame.get('sequence'),serializationNs=time.monotonic_ns()-started,encodedBytes=len(encoded))
        return encoded
eng_board_routes.EngBoardStreamWriter=ObservedWriter
def observe_batches(name,original):
    def wrapped(*args,**kwargs):
        batch=0
        for epics,complete in original(*args,**kwargs):
            batch+=1; S.eligible(name,batch,len(epics),complete)
            yield epics,complete
    return wrapped
eng_board_routes.eng_board.iter_component_epic_batches=observe_batches('component',eng_board_routes.eng_board.iter_component_epic_batches)
if hasattr(eng_board_routes.eng_board,'iter_team_epic_batches'):
    eng_board_routes.eng_board.iter_team_epic_batches=observe_batches('team',eng_board_routes.eng_board.iter_team_epic_batches)
def search(payload,**kwargs):
    jql=payload['jql']; token=payload.get('nextPageToken')
    if 'component in' in jql:
        S.component_calls+=1; call=S.component_calls
        if S.scenario in ('component_page_2','collapsed_first'):
            page=2 if token else 1
            if page==2: S.gate('component_page_2')
            status='Done' if S.scenario=='collapsed_first' and page==1 else 'To Do'
            body={'issues':[epic(f'ABC-{page}',status)],'isLast':page==2}
            if page==1: body['nextPageToken']='page-2'
        else:
            if S.scenario=='component_batch_2' and call==2: S.gate('component_batch_2')
            body={'issues':[epic(f'ABC-{call}','To Do')],'isLast':True}
        S.record('jira_page',stage='component_index',page=call,rows=len(body['issues']))
        return FakeResponse(body)
    if 'cf[30101]' in jql:
        rows=[child(f'WORK-{i}',f'ABC-{i}') for i in range(1,42)]
        S.record('jira_page',stage='team_work_discovery',page=1,rows=len(rows)); return FakeResponse({'issues':rows,'isLast':True})
    if 'issuetype = Epic' in jql:
        S.parent_calls+=1
        if S.scenario=='team_parent_lookup_2' and S.parent_calls==2: S.gate('team_parent_lookup_2')
        keys=re.findall(r'"(ABC-\d+)"',jql); rows=[epic(key,'To Do') for key in keys]
        S.record('jira_page',stage='team_parent_lookup',page=S.parent_calls,rows=len(rows)); return FakeResponse({'issues':rows,'isLast':True})
    if 'issuetype in' in jql:
        if S.scenario=='child_completion': S.gate('child_completion')
        keys=re.findall(r'"(ABC-\d+)"',jql); rows=[child('WORK-'+key.split('-')[-1],key) for key in keys]
        S.record('jira_page',stage='child_hydration',page=1,rows=len(rows)); return FakeResponse({'issues':rows,'isLast':True})
    return FakeResponse({'issues':[],'isLast':True})
class H(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*a): pass
    def send_json(self,status,value):
        body=json.dumps(value,separators=(',',':')).encode(); self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.send_header('Connection','close'); self.end_headers(); self.wfile.write(body); self.wfile.flush()
    def do_GET(self):
        p=urlparse(self.path); q=parse_qs(p.query)
        if p.path=='/__test__/health': return self.send_json(200,{'ok':True})
        if p.path=='/__test__/clock': return self.send_json(200,{'serverNs':time.monotonic_ns()})
        if p.path=='/__test__/events':
            with S.lock: rows=list(S.events)
            return self.send_json(200,{'events':rows})
        if p.path=='/__test__/release': S.release(q.get('gate',[''])[0]); return self.send_json(200,{'released':True})
        if p.path!='/api/eng/board': return self.send_json(404,{'error':'not_found'})
        scope=q.get('scope',['component'])[0]; focused=q.get('focusedColumnId',['todo'])[0]
        S.record('request_entry',stage='component_index',captureMs=None)
        components=tuple(f'C{i}' for i in range(41)) if S.scenario=='component_batch_2' else (() if S.scenario=='team_parent_lookup_2' else ('Component A',))
        teams=('team-a',) if S.scenario=='team_parent_lookup_2' else ()
        snap=board_snapshot(query=board_query(scope=scope,sprint_id=None,focused_column_id=focused),focused_column_id=focused,components=components,teams=teams)
        self.send_response(200); self.send_header('Content-Type','application/x-ndjson'); self.send_header('Cache-Control','no-store'); self.send_header('X-Accel-Buffering','no'); self.send_header('Transfer-Encoding','chunked'); self.end_headers()
        try:
            with patch.object(eng_board_routes,'_assert_current',return_value=db_context()):
                for line in eng_board_routes._frame_stream(SimpleNamespace(current_jira_search=search),snap,EngBoardRequestTransport()):
                    frame=json.loads(line); raw=line if isinstance(line,bytes) else line.encode(); updates=S.candidate_updates() if frame.get('membership')=='candidate' else []; S.record('frame_yield',frameType=frame['type'],sequence=frame['sequence'],membership=frame.get('membership'),eligibleUpdateIds=updates,bytes=len(raw),outcome=frame.get('outcome'),epicCount=frame.get('epicCount'),childCount=frame.get('childCount'),diagnostics=frame.get('diagnostics'))
                    self.wfile.write(f'{len(raw):X}\r\n'.encode()+raw+b'\r\n'); self.wfile.flush()
            self.wfile.write(b'0\r\n\r\n'); self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError): S.record('client_cancelled')
        except Exception as error:
            S.record('server_error',errorType=type(error).__name__,message=str(error)[:200])
            try: self.wfile.write(b'0\r\n\r\n'); self.wfile.flush()
            except Exception: pass
    def do_POST(self):
        p=urlparse(self.path); n=int(self.headers.get('Content-Length','0')); body=json.loads(self.rfile.read(n) or b'{}')
        if p.path=='/__test__/reset': S.reset(body.get('scenario','component_page_2'),body.get('sampleId','unset')); return self.send_json(200,{'reset':True})
        if p.path=='/__test__/release-all': S.release_all(); return self.send_json(200,{'released':True})
        return self.send_json(404,{'error':'not_found'})
s=ThreadingHTTPServer(('127.0.0.1',0),H); print(json.dumps({'port':s.server_address[1]}),flush=True)
try: s.serve_forever(poll_interval=.05)
finally: S.release_all(); s.server_close()
`;

async function terminateSpawnedChild(child, lines) {
    lines?.close();
    try {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill('SIGTERM');
        await Promise.race([
            new Promise(resolve => child.once('exit', resolve)),
            new Promise(resolve => setTimeout(resolve, 3000)),
        ]);
        if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
            await Promise.race([
                new Promise(resolve => child.once('exit', resolve)),
                new Promise(resolve => setTimeout(resolve, 3000)),
            ]);
        }
        if (child.exitCode === null && child.signalCode === null) throw new Error('campaign child did not terminate');
    } finally {
        activeCampaignChildren.delete(child);
    }
}

async function startDiagnosticServer(sourceRoot = null, { forceStartupFailure = false } = {}) {
    const env = { ...process.env, CONFIG_STORAGE_BACKEND: 'jsonfile' };
    if (sourceRoot) env.BOARD_BASELINE_ROOT = sourceRoot;
    if (forceStartupFailure) env.BOARD_FIXTURE_STARTUP_FAILURE = '1';
    const child = spawn(python, ['-c', campaignServer], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    activeCampaignChildren.add(child);
    let lines = null;
    const messages = [];
    let stderr = '';
    try {
        lines = readline.createInterface({ input: child.stdout });
        child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-2000); });
        const startup = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => fail(new Error('campaign server startup timed out')), 10000);
            const cleanup = () => {
                clearTimeout(timeout); lines.off('line', onLine); child.off('error', onError); child.off('exit', onExit);
            };
            const fail = error => { cleanup(); reject(error); };
            const onError = error => fail(error);
            const onExit = (code, signal) => fail(new Error(`campaign server exited during startup (${code ?? signal}): ${stderr}`));
            const onLine = line => {
                let message;
                try { message = JSON.parse(line); } catch (error) { fail(new Error(`malformed campaign startup: ${error.message}`)); return; }
                messages.push(message);
                if (Number.isInteger(message.port) && message.port > 0) { cleanup(); resolve(message); }
            };
            lines.on('line', onLine); child.once('error', onError); child.once('exit', onExit);
        });
        return { child, origin: `http://127.0.0.1:${startup.port}`, messages, lines };
    } catch (error) {
        await terminateSpawnedChild(child, lines);
        throw error;
    }
}

async function control(server, pathname, options) {
    const response = await fetch(`${server.origin}${pathname}`, options);
    if (!response.ok) throw new Error(`campaign control failed: ${response.status} ${pathname}`);
    return response.json();
}

async function stopServer(server) {
    try { await control(server, '/__test__/release-all', { method: 'POST' }); } catch (_) {}
    await terminateSpawnedChild(server.child, server.lines);
}

async function installPaintObserver(page, { sampleId, expectedKey, expectedScope }) {
    await page.addInitScript(expected => {
        window.__boardReducer = { sampleId: expected.sampleId, generationId: null, terminalReducedMs: null };
        window.__boardPaint = { sampleId: expected.sampleId, generationId: null, firstVisibleMs: null, key: null };
        const visibleFocusedCard = card => {
            if (!card?.isConnected || card.dataset.epicKey !== expected.expectedKey
                || !card.closest('.eng-board .col.is-focused')) return false;
            const style = getComputedStyle(card);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0) return false;
            const rect = card.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
                && rect.top < innerHeight && rect.left < innerWidth;
        };
        const inspect = () => {
            if (window.__boardPaint.firstVisibleMs !== null) return;
            const generationId = window.__boardReducer.generationId;
            const card = document.querySelector(
                `.eng-board .col.is-focused .ecard[data-epic-key="${expected.expectedKey}"]`);
            if (!generationId || !visibleFocusedCard(card)) return;
            requestAnimationFrame(() => {
                if (window.__boardReducer.generationId !== generationId || !visibleFocusedCard(card)) return;
                requestAnimationFrame(() => {
                    if (window.__boardReducer.generationId !== generationId || !visibleFocusedCard(card)) return;
                    window.__boardPaint = {
                        sampleId: expected.sampleId, generationId,
                        firstVisibleMs: performance.now(), key: card.dataset.epicKey,
                    };
                });
            });
        };
        window.__engBoardReducerObserved = event => {
            if (event.frameType === 'start') {
                if (event.scope !== expected.expectedScope) return;
                window.__boardReducer.generationId = event.generationId;
            }
            if (!window.__boardReducer.generationId
                || event.generationId !== window.__boardReducer.generationId) return;
            if (event.frameType === 'complete' || event.frameType === 'error') {
                window.__boardReducer.terminalReducedMs = event.at;
            }
            inspect();
        };
        addEventListener('DOMContentLoaded', () => {
            new MutationObserver(inspect).observe(document.documentElement, { childList: true, subtree: true });
            inspect();
        }, { once: true });
    }, { sampleId, expectedKey, expectedScope });
}

async function openScenario(page, server, scenario, { sourceRoot = repoRoot, revision = 'current' } = {}) {
    await control(server, '/__test__/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, sampleId: `${scenario}-${revision}` }),
    });
    const browserRequests = [];
    const requestFailures = [];
    const pageErrors = [];
    const expectedScope = scenario === 'team_parent_lookup_2' ? 'all_work' : 'component';
    const isCampaignBoardUrl = value => {
        const url = new URL(value);
        return url.origin === server.origin && url.pathname === '/api/eng/board'
            && url.searchParams.get('scope') === expectedScope;
    };
    const network = { requestTimestamp: null, requestWallTime: null, data: [] };
    page.on('request', request => browserRequests.push(request.url()));
    page.on('requestfailed', request => requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on('pageerror', error => pageErrors.push(error.message));
    const sampleId = `${scenario}-${revision}`;
    const expectedKey = scenario === 'collapsed_first' ? 'ABC-2' : 'ABC-1';
    const fixture = await installEngBoardDashboardFixture(page, {
        sourceRoot, passthroughEngBoard: true, instrumentBoardOwner: true,
    });
    await installPaintObserver(page, { sampleId, expectedKey, expectedScope });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    let boardRequestId = null;
    cdp.on('Network.requestWillBeSent', event => {
        if (isCampaignBoardUrl(event.request.url)) {
            boardRequestId = event.requestId;
            network.requestTimestamp = event.timestamp;
            network.requestWallTime = event.wallTime;
        }
    });
    cdp.on('Network.dataReceived', event => {
        if (event.requestId === boardRequestId) {
            network.data.push({ timestamp: event.timestamp, dataLength: event.dataLength });
        }
    });
    await page.addInitScript(({ sprintId, sprintName }) => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
        selectedView: 'eng', selectedSprint: sprintId, sprintName, activeGroupId: 'grp-default',
        showBoard: true, showPlanning: false, showScenario: false, showAlertsPanel: false,
    })), { sprintId: selectedSprintId, sprintName: selectedSprintName });
    await page.goto(`${server.origin}/`, { waitUntil: 'domcontentloaded' });
    const sprint = page.getByRole('button', { name: 'Select sprint' }).first();
    await expect(sprint).toContainText(selectedSprintName);
    await sprint.click();
    const scopeName = scenario === 'team_parent_lookup_2' ? 'All work' : 'Component';
    const isHistoricalSelector = revision === baselineRevision;
    const option = isHistoricalSelector
        ? page.locator('.sprint-dropdown-option').filter({ hasText: new RegExp(`^${scopeName}$`) })
        : page.getByRole('option', { name: scopeName, exact: true });
    if (isHistoricalSelector) {
        await expect(option).toHaveAttribute('aria-disabled', 'false');
    } else {
        await expect(option).not.toHaveAttribute('aria-disabled');
        await expect(page.locator(`#${await option.getAttribute('aria-describedby')}`)).toHaveText('Ready');
    }
    const requestPromise = page.waitForRequest(request => isCampaignBoardUrl(request.url()));
    const requestStartMs = await page.evaluate(() => performance.now());
    await option.click();
    const request = await requestPromise;
    const requestUrl = new URL(request.url());
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    expect(requestUrl.origin).toBe(server.origin);
    expect(requestUrl.searchParams.get('departmentId')).toBe('grp-default');
    expect(requestUrl.searchParams.get('scope')).toBe(scopeName === 'All work' ? 'all_work' : 'component');
    const clock = await page.evaluate(async origin => {
        const samples = [];
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const start = performance.now();
            const response = await fetch(`${origin}/__test__/clock`);
            const body = await response.json();
            const end = performance.now();
            samples.push({ offsetMs: (start + end) / 2 - body.serverNs / 1e6, uncertaintyMs: (end - start) / 2 });
        }
        return samples.reduce((best, sample) => sample.uncertaintyMs < best.uncertaintyMs ? sample : best);
    }, server.origin);
    return { fixture, browserRequests, requestFailures, pageErrors, requestStartMs, requestUrl, clock, network, cdp, timeOrigin };
}

function measurementRecord({ scenario, evidence, events, paint, terminalReducedMs, settledPaintMs, revision = 'current' }) {
    const frames = events.filter(row => row.event === 'frame_yield');
    const first = type => frames.find(row => row.frameType === type);
    const candidate = frames.find(row => row.membership === 'candidate');
    const jiraPages = events.filter(row => row.event === 'jira_page');
    const serialization = events.filter(row => row.event === 'writer_prepare' || row.event === 'writer_write');
    const terminal = frames.at(-1);
    const browserTimestamp = timestamp => timestamp === null || evidence.network.requestTimestamp === null
        || evidence.network.requestWallTime === null ? null
        : evidence.network.requestWallTime * 1000 - evidence.timeOrigin
            + (timestamp - evidence.network.requestTimestamp) * 1000;
    const receivedAt = frame => {
        if (!frame) return null;
        const requiredBytes = frames.slice(0, frames.indexOf(frame) + 1).reduce((sum, row) => sum + row.bytes, 0);
        let receivedBytes = 0;
        const event = evidence.network.data.find(row => {
            receivedBytes += row.dataLength;
            return receivedBytes >= requiredBytes;
        });
        return event ? browserTimestamp(event.timestamp) : null;
    };
    const complete = first('complete');
    return {
        revision, environment_class: 'synthetic_loopback', scope_type: scenario === 'team_parent_lookup_2' ? 'all_work' : 'component', cache_category: 'cold', sample_number: 1,
        component_count: scenario === 'component_batch_2' ? 41 : scenario === 'team_parent_lookup_2' ? 0 : 1,
        team_count: scenario === 'team_parent_lookup_2' ? 1 : 0,
        admitted_epic_count: complete?.epicCount ?? null, scanned_work_count: scenario === 'team_parent_lookup_2' ? 41 : null,
        hydrated_child_count: complete?.childCount ?? null,
        request_start_ms: browserTimestamp(evidence.network.requestTimestamp), metadata_ms: receivedAt(first('start')),
        first_candidate_ms: receivedAt(candidate), first_visible_epic_ms: paint.firstVisibleMs,
        authoritative_index_ms: receivedAt(frames.find(row => row.frameType === 'index' && row.membership === 'authoritative')),
        first_column_ms: receivedAt(first('column')), terminal_received_ms: receivedAt(terminal), terminal_reduced_ms: terminalReducedMs,
        settled_paint_ms: settledPaintMs, server_capture_ms: null,
        server_discovery_ms: (() => { const start=events.find(row=>row.event==='request_entry'); const index=frames.find(row=>row.frameType==='index'&&row.membership==='authoritative'); return start&&index?(index.serverNs-start.serverNs)/1e6:null; })(),
        serialization_ms: serialization.reduce((sum,row)=>sum+row.serializationNs,0)/1e6, clock_alignment_uncertainty_ms: evidence.clock.uncertaintyMs,
        ndjson_bytes: frames.reduce((sum,row)=>sum+row.bytes,0), candidate_bytes: frames.filter(row=>row.membership==='candidate').reduce((sum,row)=>sum+row.bytes,0),
        candidate_frames: frames.filter(row=>row.membership==='candidate').length,
        coalesced_pages: coalescedProducerUpdates(events, frames),
        jira_requests: jiraPages.length, jira_pages: jiraPages.length, jira_retries: 0, max_query_bytes: null,
        peak_child_workers: complete?.diagnostics?.peakChildSearches ?? null, peak_progress_queue: null, peak_memory_bytes: null,
        terminal_outcome: complete?.outcome ?? (terminal?.frameType === 'error' ? 'error' : null), failure_operation: null, failure_phase: null, failure_limit: null, failure_observed: null,
    };
}

function coalescedProducerUpdates(events, frames = events.filter(row => row.event === 'frame_yield')) {
    const eligibleIds = new Set();
    for (const update of events.filter(row => row.event === 'eligible_batch' && row.updateId)) {
        if (eligibleIds.has(update.updateId)) throw new Error(`duplicate eligible update ID: ${update.updateId}`);
        eligibleIds.add(update.updateId);
    }
    const assignedIds = new Set();
    let combinedUpdates = 0;
    for (const frame of frames.filter(row => row.membership === 'candidate')) {
        if (!Array.isArray(frame.eligibleUpdateIds) || frame.eligibleUpdateIds.length === 0) {
            throw new Error('candidate frame is missing eligible update correlation');
        }
        const frameIds = new Set(frame.eligibleUpdateIds);
        if (frameIds.size !== frame.eligibleUpdateIds.length) {
            throw new Error('candidate frame contains duplicate eligible update IDs');
        }
        for (const updateId of frameIds) {
            if (!eligibleIds.has(updateId)) throw new Error(`candidate frame references unknown eligible update ID: ${updateId}`);
            if (assignedIds.has(updateId)) throw new Error(`eligible update ID assigned to multiple candidates: ${updateId}`);
            assignedIds.add(updateId);
        }
        combinedUpdates += Math.max(0, frameIds.size - 1);
    }
    return eligibleIds.size - assignedIds.size + combinedUpdates;
}

function timingEvidence(evidence, events) {
    const frames = events.filter(row => row.event === 'frame_yield');
    const aligned = row => row ? row.serverNs / 1e6 + evidence.clock.offsetMs : null;
    return {
        server_yields: frames.map(row => ({
            sequence: row.sequence, frame_type: row.frameType, membership: row.membership ?? null,
            browser_aligned_ms: aligned(row), bytes: row.bytes,
        })),
        browser_data_chunks: evidence.network.data.map(row => ({
            browser_ms: evidence.network.requestTimestamp === null || evidence.network.requestWallTime === null ? null
                : evidence.network.requestWallTime * 1000 - evidence.timeOrigin
                    + (row.timestamp - evidence.network.requestTimestamp) * 1000,
            bytes: row.dataLength,
        })),
        writer_serialization: events.filter(row => row.event === 'writer_prepare' || row.event === 'writer_write').map(row => ({
            operation: row.event === 'writer_prepare' ? 'prepare' : 'write',
            sequence: row.sequence, frame_type: row.frameType,
            duration_ms: row.serializationNs / 1e6, encoded_bytes: row.encodedBytes,
        })),
        discovery_batches: events.filter(row => row.event === 'eligible_batch'),
    };
}

async function runHeldScenario(page, scenario, gate, {
    expectEarlyPaint = true, expectedCoalesced = 0, expectedHeldCandidateFrames = 0,
    revision = 'current', outputLabel = revision, sourceRoot = repoRoot,
} = {}) {
    const server = await startDiagnosticServer(revision === baselineRevision ? baselineRoot : null);
    const outputDir = path.join(repoRoot, 'tmp', 'board-190', outputLabel);
    let released = false;
    let evidence = null;
    try {
        evidence = await openScenario(page, server, scenario, { sourceRoot, revision });
        await expect.poll(async () => (await control(server, '/__test__/events')).events
            .some(row => row.event === 'gate_wait' && row.gate === gate)).toBe(true);
        const heldEvents = (await control(server, '/__test__/events')).events;
        expect(heldEvents.filter(row => row.event === 'frame_yield' && row.membership === 'candidate')).toHaveLength(
            expectedHeldCandidateFrames);
        const expectedKey = scenario === 'collapsed_first' ? 'ABC-2' : 'ABC-1';
        if (expectEarlyPaint) {
            await expect(page.locator(`.eng-board .col.is-focused .ecard[data-epic-key="${expectedKey}"]`)).toBeVisible();
            await expect.poll(() => page.evaluate(() => window.__boardPaint.firstVisibleMs)).not.toBeNull();
        } else {
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.waitForTimeout(100);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            expect(await page.evaluate(() => window.__boardPaint.firstVisibleMs)).toBeNull();
            await expect(page.locator(
                `.eng-board .col.is-focused .ecard[data-epic-key="${expectedKey}"]`)).not.toBeVisible();
        }
        fs.mkdirSync(outputDir, { recursive: true });
        await page.screenshot({ path: path.join(outputDir, `${scenario}-held.png`), animations: 'disabled' });
        await control(server, `/__test__/release?gate=${gate}`); released = true;
        await expect.poll(async () => (await control(server, '/__test__/events')).events
            .some(row => row.event === 'frame_yield' && row.frameType === 'complete')).toBe(true);
        await expect(page.locator('.board-data-state')).toHaveCount(0);
        if (!expectEarlyPaint) await expect.poll(() => page.evaluate(() => window.__boardPaint.firstVisibleMs)).not.toBeNull();
        await expect.poll(() => page.evaluate(() => window.__boardReducer.terminalReducedMs)).not.toBeNull();
        const reducer = await page.evaluate(() => window.__boardReducer);
        const terminalReducedMs = reducer.terminalReducedMs;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const settledPaintMs = await page.evaluate(() => performance.now());
        const paint = await page.evaluate(() => window.__boardPaint);
        const { events } = await control(server, '/__test__/events');
        expect(events.some(row => row.event === 'server_error')).toBe(false);
        expect(evidence.requestFailures.filter(row => row.error !== 'net::ERR_ABORTED')).toEqual([]);
        expect(evidence.pageErrors).toEqual([]);
        expect(paint.sampleId).toBe(`${scenario}-${revision}`);
        expect(paint.generationId).toBe(reducer.generationId);
        expect(paint.key).toBe(scenario === 'collapsed_first' ? 'ABC-2' : 'ABC-1');
        const writtenBytes = events.filter(row => row.event === 'writer_write')
            .reduce((sum, row) => sum + row.encodedBytes, 0);
        const yieldedBytes = events.filter(row => row.event === 'frame_yield')
            .reduce((sum, row) => sum + row.bytes, 0);
        expect(writtenBytes).toBe(yieldedBytes);
        const record = measurementRecord({ scenario, evidence, events, paint, terminalReducedMs, settledPaintMs, revision });
        const serializationNs = events.filter(row => row.event === 'writer_prepare' || row.event === 'writer_write')
            .reduce((sum, row) => sum + row.serializationNs, 0);
        expect(serializationNs).toBeGreaterThan(0);
        expect(record.serialization_ms).toBe(serializationNs / 1e6);
        expect(record.coalesced_pages).toBe(expectedCoalesced);
        fs.writeFileSync(path.join(outputDir, `${scenario}.json`), `${JSON.stringify({
            record, timing_evidence: timingEvidence(evidence, events), events,
        }, null, 2)}\n`);
        return record;
    } finally {
        if (evidence?.cdp) try { await evidence.cdp.detach(); } catch (_) {}
        if (!released) try { await control(server, `/__test__/release?gate=${gate}`); } catch (_) {}
        await stopServer(server);
    }
}

function materializeBaseline() {
    for (const target of [
        path.join(repoRoot, 'tmp', 'board-190', 'current'),
        path.join(repoRoot, 'tmp', 'board-190', 'baseline'),
        baselineRoot,
    ]) fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(baselineRoot, { recursive: true });
    const files = execFileSync('git', ['ls-tree', '-r', '--name-only', baselineRevision, '--', 'frontend/src'], { cwd: repoRoot, encoding: 'utf8' })
        .trim().split('\n').filter(Boolean);
    files.push('backend/services/eng_board.py', 'backend/services/eng_board_stream.py', 'backend/routes/eng_board_routes.py');
    for (const relative of files) {
        const destination = path.join(baselineRoot, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, execFileSync('git', ['show', `${baselineRevision}:${relative}`], { cwd: repoRoot }));
    }
}

test.beforeAll(() => materializeBaseline());

test('diagnoses strict Component owner activation and Board request routing', async ({ page }) => {
    expect(coalescedProducerUpdates([
        { event: 'eligible_batch', updateId: 'component-1' },
        { event: 'eligible_batch', updateId: 'component-2' },
        { event: 'frame_yield', membership: 'candidate', eligibleUpdateIds: ['component-1', 'component-2'] },
    ])).toBe(1);
    expect(() => coalescedProducerUpdates([
        { event: 'eligible_batch', updateId: 'component-1' },
        { event: 'frame_yield', membership: 'candidate' },
    ])).toThrow(/missing eligible update correlation/);
    expect(() => coalescedProducerUpdates([
        { event: 'eligible_batch', updateId: 'component-1' },
        { event: 'frame_yield', membership: 'candidate', eligibleUpdateIds: ['unknown-1'] },
    ])).toThrow(/unknown eligible update ID/);
    expect(() => coalescedProducerUpdates([
        { event: 'eligible_batch', updateId: 'component-1' },
        { event: 'frame_yield', membership: 'candidate', eligibleUpdateIds: ['component-1', 'component-1'] },
    ])).toThrow(/duplicate eligible update IDs/);
    expect(() => coalescedProducerUpdates([
        { event: 'eligible_batch', updateId: 'component-1' },
        { event: 'frame_yield', membership: 'candidate', eligibleUpdateIds: ['component-1'] },
        { event: 'frame_yield', membership: 'candidate', eligibleUpdateIds: ['component-1'] },
    ])).toThrow(/assigned to multiple candidates/);
    await expect(startDiagnosticServer(null, { forceStartupFailure: true })).rejects.toThrow(
        /malformed campaign startup/);
    expect(activeCampaignChildren.size).toBe(0);
    const server = await startDiagnosticServer();
    const browserRequests = [];
    page.on('request', request => browserRequests.push(request.url()));
    const fixture = await installEngBoardDashboardFixture(page, { sourceRoot: repoRoot, passthroughEngBoard: true });
    await page.addInitScript(({ sprintId, sprintName }) => localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({
        selectedView: 'eng', selectedSprint: sprintId, sprintName, activeGroupId: 'grp-default',
        showBoard: true, showPlanning: false, showScenario: false, showAlertsPanel: false,
    })), { sprintId: selectedSprintId, sprintName: selectedSprintName });
    try {
        await page.goto(`${server.origin}/`, { waitUntil: 'domcontentloaded' });
        const sprint = page.getByRole('button', { name: 'Select sprint' }).first();
        await expect(sprint).toContainText(selectedSprintName);
        await sprint.click();
        const component = page.getByRole('option', { name: 'Component', exact: true });
        await expect(component).not.toHaveAttribute('aria-disabled');
        await expect(page.locator(`#${await component.getAttribute('aria-describedby')}`)).toHaveText('Ready');
        await component.click();
        await expect(sprint).toContainText('Component');
        await expect.poll(() => browserRequests.some(url => url.includes('/api/eng/board?'))).toBe(true);
        await expect.poll(() => fixture.apiRoutes.some(row => row.path.startsWith('/api/eng/board?'))).toBe(true);
        await expect.poll(async () => {
            const response=await fetch(`${server.origin}/__test__/events`); const body=await response.json();
            return body.events.some(row => row.event==='request_entry');
        }).toBe(true);
        expect(fixture.boardRouteAction).toBe('continue');
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jira_dashboard_ui_prefs_v1')))).toMatchObject({
            selectedSprint: selectedSprintId, activeGroupId: 'grp-default', showBoard: true,
        });
    } finally {
        await stopServer(server);
    }
});

test('current production pager paints a focused Component Epic while page 2 is held', async ({ page }) => {
    await runHeldScenario(page, 'component_page_2', 'component_page_2', { expectedHeldCandidateFrames: 1 });
});

for (const [scenario, gate, expectEarlyPaint, expectedCoalesced, expectedHeldCandidateFrames] of [
    ['component_batch_2', 'component_batch_2', true, 0, 1],
    ['team_parent_lookup_2', 'team_parent_lookup_2', true, 1, 1],
    ['child_completion', 'child_completion', true, 0, 0],
    ['collapsed_first', 'component_page_2', false, 0, 1],
]) {
    test(`joined current ${scenario} schedule preserves real paint ordering`, async ({ page }) => {
        await runHeldScenario(page, scenario, gate, {
            expectEarlyPaint, expectedCoalesced, expectedHeldCandidateFrames,
        });
    });
}

for (const [scenario, gate, expectEarlyPaint, expectedCoalesced, expectedHeldCandidateFrames] of [
    ['component_page_2', 'component_page_2', false, 0, 0],
    ['component_batch_2', 'component_batch_2', true, 0, 1],
    ['team_parent_lookup_2', 'team_parent_lookup_2', false, 0, 0],
    ['child_completion', 'child_completion', true, 0, 0],
    ['collapsed_first', 'component_page_2', false, 0, 0],
]) {
    test(`joined baseline ${scenario} schedule records the historical paint boundary`, async ({ page }) => {
        await runHeldScenario(page, scenario, gate, {
            expectEarlyPaint, expectedCoalesced, expectedHeldCandidateFrames,
            revision: baselineRevision, outputLabel: 'baseline', sourceRoot: baselineRoot,
        });
    });
}
