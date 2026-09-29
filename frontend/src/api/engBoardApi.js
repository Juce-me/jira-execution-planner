import {
    apiFetchHeaders,
    jsonOrStructuredError,
    readResponseStream,
    requireAuthentication,
} from './http.js';

export const ENG_BOARD_PROTOCOL_VERSION = 1;
export const ENG_BOARD_MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const ENG_BOARD_MAX_GENERATION_BYTES = 32 * 1024 * 1024;

const MAX = Object.freeze({
    identity: 256, name: 512, summary: 4096, url: 2048, timestamp: 128,
    columns: 100, epics: 1000, children: 10000, sprintIds: 100,
    statuses: 500, progress: 1000, failedColumns: 100,
});
const encoder = new TextEncoder();

export class EngBoardStreamError extends Error {
    constructor(code) {
        super(`ENG Board stream failed: ${code}`);
        this.name = 'EngBoardStreamError';
        this.code = code;
    }
}

function fail(code = 'invalid_frame') {
    throw new EngBoardStreamError(code);
}

function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    return value;
}

function exact(value, required, optional = []) {
    object(value);
    const allowed = new Set([...required, ...optional]);
    if (Object.keys(value).some(key => !allowed.has(key))) fail();
    if (required.some(key => !Object.prototype.hasOwnProperty.call(value, key))) fail();
}

function string(value, limit, { nullable = false, pattern = null } = {}) {
    if (nullable && value === null) return;
    if (typeof value !== 'string' || value.length === 0 || hasLoneSurrogate(value)
        || encoder.encode(value).byteLength > limit) fail();
    if (pattern && !pattern.test(value)) fail();
}

function hasLoneSurrogate(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            return true;
        }
    }
    return false;
}

function bool(value) {
    if (typeof value !== 'boolean') fail();
}

function number(value, { integer = false, nullable = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
    if (nullable && value === null) return;
    if (!Number.isFinite(value) || value < 0 || value > maximum || (integer && !Number.isInteger(value))) fail();
}

function oneOf(value, choices) {
    if (!choices.includes(value)) fail();
}

function array(value, limit, item) {
    if (!Array.isArray(value) || value.length > limit) fail();
    value.forEach(item);
}

function named(value) {
    exact(value, ['id', 'name']);
    string(value.id, MAX.identity);
    string(value.name, MAX.name);
}

function nullableNamed(value) {
    if (value !== null) named(value);
}

function person(value) {
    exact(value, ['accountId', 'displayName', 'avatarUrl']);
    string(value.accountId, MAX.identity);
    string(value.displayName, MAX.name);
    string(value.avatarUrl, MAX.url, { nullable: true });
}

function nullablePerson(value) {
    if (value !== null) person(value);
}

function column(value) {
    exact(value, ['id', 'name', 'color', 'statusNames', 'terminal']);
    string(value.id, MAX.identity);
    string(value.name, MAX.name);
    string(value.color, MAX.name);
    array(value.statusNames, MAX.statuses, item => string(item, MAX.name));
    bool(value.terminal);
}

function parent(value) {
    if (value === null) return;
    exact(value, ['key', 'summary', 'issueType']);
    string(value.key, MAX.identity);
    string(value.summary, MAX.summary);
    named(value.issueType);
}

function epic(value) {
    exact(value, [
        'key', 'summary', 'status', 'priority', 'assignee', 'deliveryOwner', 'projectTrack',
        'updated', 'parent', 'columnId',
    ]);
    string(value.key, MAX.identity);
    string(value.summary, MAX.summary);
    named(value.status);
    nullableNamed(value.priority);
    nullablePerson(value.assignee);
    nullablePerson(value.deliveryOwner);
    string(value.projectTrack, MAX.name, { nullable: true });
    string(value.updated, MAX.timestamp, { nullable: true });
    parent(value.parent);
    string(value.columnId, MAX.identity);
}

function child(value) {
    exact(value, [
        'key', 'epicKey', 'summary', 'status', 'priority', 'issueType', 'assignee', 'updated',
        'storyPoints', 'team', 'project', 'projectClassification', 'sprintIds',
    ]);
    string(value.key, MAX.identity);
    string(value.epicKey, MAX.identity);
    string(value.summary, MAX.summary);
    named(value.status);
    nullableNamed(value.priority);
    named(value.issueType);
    nullablePerson(value.assignee);
    string(value.updated, MAX.timestamp, { nullable: true });
    number(value.storyPoints, { nullable: true });
    nullableNamed(value.team);
    named(value.project);
    oneOf(value.projectClassification, ['product', 'tech', 'other']);
    array(value.sprintIds, MAX.sprintIds, item => number(item, { integer: true }));
}

function diagnostics(value, expectedCompleteness = null) {
    exact(value, [
        'indexMs', 'focusedCompleteMs', 'durationMs', 'jiraRequests', 'jiraPages', 'jiraRetries',
        'peakChildSearches', 'cacheState', 'completeness',
    ]);
    number(value.indexMs);
    number(value.focusedCompleteMs, { nullable: true });
    number(value.durationMs);
    number(value.jiraRequests, { integer: true });
    number(value.jiraPages, { integer: true });
    number(value.jiraRetries, { integer: true });
    number(value.peakChildSearches, { integer: true, maximum: 2 });
    oneOf(value.cacheState, ['hit', 'miss', 'mixed', 'unknown']);
    oneOf(value.completeness, ['complete', 'partial']);
    if (expectedCompleteness && value.completeness !== expectedCompleteness) fail();
}

function progress(value) {
    exact(value, ['epicKey', 'loadedChildren', 'statusCounts']);
    string(value.epicKey, MAX.identity);
    number(value.loadedChildren, { integer: true });
    object(value.statusCounts);
    if (Object.keys(value.statusCounts).length > MAX.statuses) fail();
    for (const [key, count] of Object.entries(value.statusCounts)) {
        string(key, MAX.name);
        number(count, { integer: true });
    }
}

function validateBody(frame) {
    const base = ['protocolVersion', 'generationId', 'sequence', 'type'];
    switch (frame.type) {
        case 'start':
            exact(frame, [...base, 'scope', 'scopeVersion', 'scopeCohortDigest', 'columns']);
            oneOf(frame.scope, ['all_work', 'component', 'sprint']);
            string(frame.scopeVersion, MAX.identity);
            string(frame.scopeCohortDigest, 64, { pattern: /^[0-9a-f]{64}$/ });
            array(frame.columns, MAX.columns, column);
            return false;
        case 'index':
            exact(frame, [...base, 'epics', 'membership']);
            array(frame.epics, MAX.epics, epic);
            oneOf(frame.membership, ['candidate', 'authoritative']);
            return false;
        case 'progress':
            exact(frame, [...base, 'columnId', 'loadedChildren', 'byEpic']);
            string(frame.columnId, MAX.identity);
            number(frame.loadedChildren, { integer: true });
            array(frame.byEpic, MAX.progress, progress);
            return false;
        case 'column':
            exact(frame, [...base, 'columnId', 'epics', 'children', 'authoritative']);
            string(frame.columnId, MAX.identity);
            array(frame.epics, MAX.epics, epic);
            array(frame.children, MAX.children, child);
            if (frame.authoritative !== true) fail();
            return false;
        case 'column_error':
            exact(frame, [...base, 'columnId', 'code', 'retryable']);
            string(frame.columnId, MAX.identity);
            if (frame.code !== 'jira_unavailable' || frame.retryable !== true) fail();
            return false;
        case 'complete':
            if (frame.outcome === 'success') {
                exact(frame, [...base, 'outcome', 'authoritative', 'epicCount', 'childCount', 'diagnostics']);
                if (frame.authoritative !== true) fail();
                number(frame.epicCount, { integer: true });
                number(frame.childCount, { integer: true });
                diagnostics(frame.diagnostics, 'complete');
            } else if (frame.outcome === 'partial_error') {
                exact(frame, [...base, 'outcome', 'authoritative', 'failedColumnIds', 'diagnostics']);
                if (frame.authoritative !== false) fail();
                array(frame.failedColumnIds, MAX.failedColumns, item => string(item, MAX.identity));
                diagnostics(frame.diagnostics, 'partial');
            } else fail();
            return true;
        case 'error':
            exact(frame, [...base, 'code'], ['diagnostics']);
            oneOf(frame.code, [
                'auth_required', 'scope_changed', 'scope_too_large', 'deadline_exceeded',
                'invalid_page', 'board_data_invalid', 'board_config_invalid',
                'storage_unavailable', 'jira_unavailable',
            ]);
            if (frame.code === 'auth_required' && Object.prototype.hasOwnProperty.call(frame, 'diagnostics')) fail();
            if (frame.diagnostics !== undefined) diagnostics(frame.diagnostics, 'partial');
            return true;
        default:
            fail();
    }
}

export function validateEngBoardFrame(frame, state = {}) {
    object(frame);
    if (frame.protocolVersion !== ENG_BOARD_PROTOCOL_VERSION) fail();
    string(frame.generationId, MAX.identity);
    number(frame.sequence, { integer: true });
    string(frame.type, MAX.name);
    if (state.sequence === undefined) {
        if (frame.sequence !== 0 || frame.type !== 'start') fail();
        state.generationId = frame.generationId;
    } else if (frame.sequence !== state.sequence + 1) {
        fail('duplicate_sequence');
    }
    if (state.generationId !== frame.generationId) fail();
    const terminal = validateBody(frame);
    state.sequence = frame.sequence;
    state.terminal = terminal;
    return terminal;
}

function append(left, right) {
    const joined = new Uint8Array(left.byteLength + right.byteLength);
    joined.set(left);
    joined.set(right, left.byteLength);
    return joined;
}

export async function consumeEngBoardResponse(response, {
    signal, onFrame = () => {}, maxFrameBytes = ENG_BOARD_MAX_FRAME_BYTES,
    maxTotalBytes = ENG_BOARD_MAX_GENERATION_BYTES,
} = {}) {
    if (!response.ok) return jsonOrStructuredError(response, 'ENG Board');
    if (!String(response.headers.get('Content-Type') || '').toLowerCase().startsWith('application/x-ndjson')) {
        try {
            await response.body?.cancel?.();
        } catch (error) {
            // The protocol error is authoritative even if body cancellation races EOF.
        }
        fail('invalid_content_type');
    }
    const state = {};
    let pending = new Uint8Array();
    let totalBytes = 0;
    let terminalFrame = null;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    await readResponseStream(response, {
        signal,
        onChunk: async (chunk, stop, throwIfStopped) => {
            if (!ArrayBuffer.isView(chunk) || chunk.BYTES_PER_ELEMENT !== 1) fail('invalid_stream_chunk');
            chunk = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            totalBytes += chunk.byteLength;
            if (totalBytes > maxTotalBytes) fail('generation_too_large');
            pending = append(pending, chunk);
            while (true) {
                throwIfStopped();
                const newline = pending.indexOf(10);
                if (newline < 0) {
                    if (pending.byteLength > maxFrameBytes) fail('frame_too_large');
                    break;
                }
                const rawLine = pending.slice(0, newline);
                pending = pending.slice(newline + 1);
                const line = rawLine.at(-1) === 13 ? rawLine.slice(0, -1) : rawLine;
                if (line.byteLength === 0 || line.byteLength > maxFrameBytes) fail('frame_too_large');
                let decoded;
                try {
                    decoded = decoder.decode(line);
                } catch (error) {
                    fail('invalid_utf8');
                }
                let frame;
                try {
                    frame = JSON.parse(decoded);
                } catch (error) {
                    fail('invalid_frame');
                }
                const terminal = validateEngBoardFrame(frame, state);
                if (frame.type === 'error' && frame.code === 'auth_required') {
                    stop();
                    requireAuthentication({}, response.status);
                }
                await onFrame(frame, { payloadBytes: line.byteLength + 1 });
                if (terminal) {
                    if (pending.byteLength !== 0) fail('invalid_frame');
                    terminalFrame = frame;
                    stop();
                    return;
                }
            }
        },
    });
    if (!terminalFrame) fail('unexpected_eof');
    return terminalFrame;
}

export async function streamEngBoard({
    backendUrl = '', departmentId, scope, sprintId, focusedColumnId, refresh = false,
    signal, onFrame, maxFrameBytes, maxTotalBytes,
}) {
    const params = new URLSearchParams({
        departmentId: String(departmentId || ''), scope: String(scope || ''), refresh: refresh ? '1' : '0',
    });
    if (sprintId !== undefined && sprintId !== null) params.set('sprintId', String(sprintId));
    if (focusedColumnId) params.set('focusedColumnId', String(focusedColumnId));
    const response = await apiFetchHeaders(`${backendUrl}/api/eng/board?${params}`, {
        method: 'GET', signal, headers: { Accept: 'application/x-ndjson' },
    });
    return consumeEngBoardResponse(response, { signal, onFrame, maxFrameBytes, maxTotalBytes });
}
