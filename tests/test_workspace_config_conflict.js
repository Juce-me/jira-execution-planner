import assert from 'node:assert/strict';
import test from 'node:test';

import {
    committedWorkspaceSectionLabels,
    rebaseWorkspaceConfigSave,
    workspaceConfigConflictMessages,
} from '../frontend/src/settings/workspaceConfigConflict.js';

test('rebase uses the server revision and preserves dirty section payload', () => {
    assert.deepEqual(
        rebaseWorkspaceConfigSave({ boardId: '7' }, { currentRevision: 4 }),
        { boardId: '7', baseRevision: 4 }
    );
});

test('conflict copy names committed and pending sections', () => {
    const lines = workspaceConfigConflictMessages({
        savedSections: ['Scope projects'],
        pendingSections: ['Jira board', 'EPM settings'],
    });
    assert.match(lines.join(' '), /Scope projects/);
    assert.match(lines.join(' '), /Jira board/);
    assert.match(lines.join(' '), /EPM settings/);
});

test('committed labels stay in save order', () => {
    assert.deepEqual(
        committedWorkspaceSectionLabels({ projects: true, board: true, issueTypes: true }),
        ['Scope projects', 'Jira board', 'Issue types'],
    );
});
