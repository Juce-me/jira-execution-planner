const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const test = require('node:test');

const helperUrl = pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'controlDropdownUtils.mjs')).href;

test('exclusive dropdown state includes the EPM project and sub-goal pickers', async () => {
    const { getNextExclusiveDropdownState } = await import(helperUrl);

    assert.deepStrictEqual(
        getNextExclusiveDropdownState('project', false),
        { sprint: false, group: false, team: false, project: true, subGoal: false }
    );
    assert.deepStrictEqual(
        getNextExclusiveDropdownState('project', true),
        { sprint: false, group: false, team: false, project: false, subGoal: false }
    );
    assert.deepStrictEqual(
        getNextExclusiveDropdownState('sprint', false),
        { sprint: true, group: false, team: false, project: false, subGoal: false }
    );
    assert.deepStrictEqual(
        getNextExclusiveDropdownState('subGoal', false),
        { sprint: false, group: false, team: false, project: false, subGoal: true }
    );
});
