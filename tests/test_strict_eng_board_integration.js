import test from 'node:test';
import assert from 'node:assert/strict';
import { strictEngBoardViewProps } from '../frontend/src/eng/useStrictEngBoardIntegration.js';

test('strict Board view props contain data state but no scope control', () => {
    const owner = {
        data: {
            status: 'complete', error: null, scope: { type: 'sprint', sprintId: 22 },
            setScope: () => {}, retry: () => {},
        },
    };
    const props = strictEngBoardViewProps({
        active: true, owner, model: { columns: [], authoritative: true, stale: false },
        legacyLoading: false, legacyError: null, legacyRetry: () => {},
    });

    assert.deepEqual(props.strictColumns, []);
    assert.equal(props.loading, false);
    assert.equal(props.scope, undefined);
    assert.equal(props.onScopeChange, undefined);
});

test('strict Board hard-limit copy distinguishes cold partial data from a stale complete snapshot', () => {
    const cold = strictEngBoardViewProps({
        active: true,
        owner: { data: { status: 'error', error: { code: 'scope_too_large' }, retry: () => {} } },
        model: { columns: [], authoritative: false, stale: false },
        legacyLoading: false, legacyError: null, legacyRetry: () => {},
    });
    assert.equal(cold.error, 'Board limit reached; this result is incomplete.');

    const stale = strictEngBoardViewProps({
        active: true,
        owner: { data: { status: 'error', error: { code: 'scope_too_large' }, retry: () => {} } },
        model: { columns: [], authoritative: true, stale: true },
        legacyLoading: false, legacyError: null, legacyRetry: () => {},
    });
    assert.equal(stale.error, 'Refresh reached the Board limit.');
});

test('strict Board errors stay sanitized and never expose terminal diagnostics', () => {
    const props = strictEngBoardViewProps({
        active: true,
        owner: { data: {
            status: 'error', retry: () => {},
            error: { code: 'scope_too_large', phase: 'index', jql: 'secret project query' },
        } },
        model: { columns: [], authoritative: false, stale: false },
        legacyLoading: false, legacyError: null, legacyRetry: () => {},
    });
    assert.equal(props.error, 'Board limit reached; this result is incomplete.');
    assert.doesNotMatch(props.error, /index|secret|project query/i);
});
