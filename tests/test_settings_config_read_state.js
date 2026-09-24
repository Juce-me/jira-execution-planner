const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/settings/settingsConfigReadState.js');
}

test('held settings reads detect edits made after request start for every protected draft', async () => {
    const { createSettingsDraftReadGuard } = await loadModule();
    const sections = [
        'projects', 'board', 'capacity', 'priorityWeights', 'issueTypes',
        'sprintField', 'parentNameField', 'storyPointsField', 'teamField', 'deliveryOwnerField',
    ];
    const current = Object.fromEntries(sections.map(section => [section, `${section}-before`]));
    const guard = createSettingsDraftReadGuard(() => current);
    let acceptedAuthority = null;
    let acceptedCapability = null;
    let releaseRead;
    const heldRead = new Promise(resolve => { releaseRead = resolve; });
    const completion = heldRead.then(() => {
        acceptedAuthority = ['SERVER'];
        acceptedCapability = true;
        sections.forEach(section => {
            if (!guard.draftChanged(section)) current[section] = `${section}-server`;
        });
    });

    sections.forEach(section => { current[section] = `${section}-edited`; });
    releaseRead();
    await completion;

    assert.deepEqual(
        current,
        Object.fromEntries(sections.map(section => [section, `${section}-edited`])),
    );
    assert.deepEqual(acceptedAuthority, ['SERVER']);
    assert.equal(acceptedCapability, true);
});

test('held settings reads allow unchanged drafts to accept the current response', async () => {
    const { createSettingsDraftReadGuard } = await loadModule();
    const current = { projects: 'unchanged', board: 'unchanged' };
    const guard = createSettingsDraftReadGuard(() => current);

    assert.equal(guard.draftChanged('projects'), false);
    assert.equal(guard.draftChanged('board'), false);
});

test('held baseline acceptance recomputes aggregate Save eligibility from empty and changed baselines', async () => {
    const { acceptSettingsConfigBaseline } = await loadModule();
    const drafts = {
        projects: '[]',
        board: JSON.stringify({ boardId: '', boardName: '' }),
        capacity: JSON.stringify({ project: '', fieldId: '', fieldName: '' }),
        priorityWeights: '[]',
        issueTypes: JSON.stringify(['Story']),
    };
    const baselines = Object.fromEntries(Object.keys(drafts).map(section => [section, { current: '' }]));
    let baselineRevision = 0;
    let memoRevision = -1;
    let memoDirtyCount = 0;
    const readDirtyCount = () => {
        if (memoRevision === baselineRevision) return memoDirtyCount;
        memoRevision = baselineRevision;
        memoDirtyCount = Object.keys(drafts).filter(section => drafts[section] !== baselines[section].current).length;
        return memoDirtyCount;
    };
    let releaseResponse;
    const heldResponse = new Promise(resolve => { releaseResponse = resolve; });
    const completion = heldResponse.then(remote => {
        Object.entries(remote).forEach(([section, baseline]) => {
            acceptSettingsConfigBaseline(baselines[section], baseline, () => { baselineRevision += 1; });
        });
    });

    drafts.projects = JSON.stringify([{ key: 'EXTRA', type: 'product' }]);
    drafts.board = JSON.stringify({ boardId: '99', boardName: 'Local Board' });
    drafts.issueTypes = JSON.stringify(['Story', 'Bug']);
    baselineRevision += 1;
    assert.equal(readDirtyCount(), 5, 'all initial empty baselines differ from the rendered drafts');

    releaseResponse({
        projects: drafts.projects,
        board: JSON.stringify({ boardId: '42', boardName: 'Remote Board' }),
        capacity: drafts.capacity,
        priorityWeights: drafts.priorityWeights,
        issueTypes: drafts.issueTypes,
    });
    await completion;

    assert.equal(readDirtyCount(), 1, 'only the remote-different Board draft remains Save-eligible');
    assert.equal(readDirtyCount() > 0, true);
});

test('accepting an unchanged settings baseline does not invalidate memoized dirty state', async () => {
    const { acceptSettingsConfigBaseline } = await loadModule();
    const baselineRef = { current: 'same' };
    let invalidations = 0;

    const changed = acceptSettingsConfigBaseline(baselineRef, 'same', () => { invalidations += 1; });

    assert.equal(changed, false);
    assert.equal(invalidations, 0);
});
