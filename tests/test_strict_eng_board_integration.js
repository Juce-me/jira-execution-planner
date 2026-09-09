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
