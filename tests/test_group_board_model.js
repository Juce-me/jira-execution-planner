const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

async function loadModule() {
    return import('../frontend/src/settings/groupBoardModel.js');
}

async function loadFixture() {
    return import('./fixtures/groupBoardReference.mjs');
}

function columns(...specs) {
    return specs.map((spec, index) => ({
        id: spec.id || `col-0000000${index}`,
        name: spec.name,
        colour: spec.colour || '#8c8c8c',
        star: Boolean(spec.star),
        min: spec.min ?? null,
        max: spec.max ?? null,
        statuses: (spec.statuses || []).slice(),
    }));
}

const COLUMN_ID_PATTERN = /^col-[0-9a-f]{8}$/;

/* ── The palette is duplicated in JS and Python; a drift is a silent coercion warning ───────── */

test('BOARD_COLUMN_COLOURS equals the Python palette, value for value and in order', async () => {
    const module = await loadModule();
    const source = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'group_board.py'), 'utf8');
    const block = source.match(/BOARD_COLUMN_COLOURS = \[([\s\S]*?)\n\]/);
    assert.ok(block, 'expected BOARD_COLUMN_COLOURS in backend/services/group_board.py');
    const pythonColours = [...block[1].matchAll(/'(#[0-9a-fA-F]{6})'/g)].map((match) => match[1]);
    assert.equal(pythonColours.length, 7);
    assert.deepEqual(module.BOARD_COLUMN_COLOURS, pythonColours);
    assert.equal(module.DEFAULT_COLUMN_COLOUR, pythonColours[0]);
});

/* ── Column ids: opaque lowercase hex, generated once, never reused ─────────────────────────── */

test('createColumnId returns a lowercase 8-hex id', async () => {
    const module = await loadModule();
    const id = module.createColumnId([], () => 0.5);
    assert.match(id, COLUMN_ID_PATTERN);
});

test('createColumnId never returns an id that is already used', async () => {
    const module = await loadModule();
    // A generator that always yields the same value would collide forever without the fallback.
    const first = module.createColumnId([], () => 0.5);
    const second = module.createColumnId([first], () => 0.5);
    assert.match(second, COLUMN_ID_PATTERN);
    assert.notEqual(second, first);
});

test('createColumnId avoids retired ids, so a deleted id cannot come back', async () => {
    const module = await loadModule();
    const retired = 'col-1a2b3c4d';
    const generated = [];
    let call = 0;
    // First draw reproduces the retired id exactly; the second draw is different.
    const sequence = () => {
        call += 1;
        return call <= 8 ? 0.5 : 0.9;
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
        generated.push(module.createColumnId([retired, ...generated], sequence));
    }
    assert.ok(!generated.includes(retired));
    assert.equal(new Set(generated).size, generated.length);
    generated.forEach((id) => assert.match(id, COLUMN_ID_PATTERN));
});

test('createColumnId with the real default generator produces distinct valid ids', async () => {
    const module = await loadModule();
    const used = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const id = module.createColumnId(used);
        assert.match(id, COLUMN_ID_PATTERN);
        used.push(id);
    }
    assert.equal(new Set(used).size, 50);
});

test('createColumn produces a grey, unstarred, empty column with a fresh id', async () => {
    const module = await loadModule();
    const column = module.createColumn({ usedIds: [], name: 'New column' });
    assert.match(column.id, COLUMN_ID_PATTERN);
    assert.equal(column.name, 'New column');
    assert.equal(column.colour, module.DEFAULT_COLUMN_COLOUR);
    assert.equal(column.star, false);
    assert.equal(column.min, null);
    assert.equal(column.max, null);
    assert.deepEqual(column.statuses, []);
});

/* ── Min/Max grammar (§5.8): parsed on blur, never coerced to 0 ─────────────────────────────── */

test('parseBoundInput clears the threshold on an empty value', async () => {
    const module = await loadModule();
    assert.deepEqual(module.parseBoundInput('', 12), { value: null, ok: true, reason: '' });
    assert.deepEqual(module.parseBoundInput('   ', 12), { value: null, ok: true, reason: '' });
});

test('parseBoundInput accepts an integer in range, including 0', async () => {
    const module = await loadModule();
    assert.deepEqual(module.parseBoundInput('0', null), { value: 0, ok: true, reason: '' });
    assert.deepEqual(module.parseBoundInput('15', null), { value: 15, ok: true, reason: '' });
    assert.deepEqual(module.parseBoundInput(' 9999 ', null), { value: 9999, ok: true, reason: '' });
});

test('parseBoundInput rejects abc and reverts, never coercing to 0', async () => {
    const module = await loadModule();
    const result = module.parseBoundInput('abc', 15);
    assert.equal(result.ok, false);
    assert.equal(result.value, 15);
    assert.notEqual(result.value, 0);
    assert.ok(result.reason.length > 0);
});

test('parseBoundInput rejects 5x, -3 and 1.5 and reverts to the last valid value', async () => {
    const module = await loadModule();
    ['5x', '-3', '1.5', '1e3', '+4', ' 12 34'].forEach((raw) => {
        const result = module.parseBoundInput(raw, 7);
        assert.equal(result.ok, false, `${raw} must be rejected`);
        assert.equal(result.value, 7, `${raw} must revert`);
    });
});

test('parseBoundInput rejects 10000 as out of range and says so', async () => {
    const module = await loadModule();
    const result = module.parseBoundInput('10000', null);
    assert.equal(result.ok, false);
    assert.equal(result.value, null);
    assert.match(result.reason, /9999/);
});

test('parseBoundInput reverts to null when there is no last valid value', async () => {
    const module = await loadModule();
    const result = module.parseBoundInput('abc', null);
    assert.equal(result.ok, false);
    assert.equal(result.value, null);
});

/* ── Reorder (D46) — a separate system from status drag ─────────────────────────────────────── */

test('resolveInsertIndex inserts before the first midpoint the pointer has not passed', async () => {
    const module = await loadModule();
    const midpoints = [50, 150, 250];
    assert.equal(module.resolveInsertIndex(midpoints, 10), 0);
    assert.equal(module.resolveInsertIndex(midpoints, 49), 0);
    assert.equal(module.resolveInsertIndex(midpoints, 51), 1);
    assert.equal(module.resolveInsertIndex(midpoints, 149), 1);
    assert.equal(module.resolveInsertIndex(midpoints, 151), 2);
});

test('resolveInsertIndex appends past the last midpoint', async () => {
    const module = await loadModule();
    assert.equal(module.resolveInsertIndex([50, 150, 250], 400), 3);
    assert.equal(module.resolveInsertIndex([], 400), 0);
});

test('resolveInsertIndex treats a pointer exactly on a midpoint as past it', async () => {
    const module = await loadModule();
    assert.equal(module.resolveInsertIndex([50, 150], 50), 1);
});

test('moveColumn moves a column to the insert index and reports its new position', async () => {
    const module = await loadModule();
    const list = columns({ name: 'a' }, { name: 'b' }, { name: 'c' });
    const forward = module.moveColumn(list, 0, 2);
    assert.deepEqual(forward.columns.map((column) => column.name), ['b', 'a', 'c']);
    assert.equal(forward.index, 1);

    const append = module.moveColumn(list, 0, 3);
    assert.deepEqual(append.columns.map((column) => column.name), ['b', 'c', 'a']);
    assert.equal(append.index, 2);

    const backward = module.moveColumn(list, 2, 0);
    assert.deepEqual(backward.columns.map((column) => column.name), ['c', 'a', 'b']);
    assert.equal(backward.index, 0);
});

test('moveColumn is a no-op when the insert index resolves to the same slot', async () => {
    const module = await loadModule();
    const list = columns({ name: 'a' }, { name: 'b' }, { name: 'c' });
    assert.deepEqual(module.moveColumn(list, 1, 1).columns.map((c) => c.name), ['a', 'b', 'c']);
    assert.deepEqual(module.moveColumn(list, 1, 2).columns.map((c) => c.name), ['a', 'b', 'c']);
    assert.equal(module.moveColumn(list, 1, 2).index, 1);
});

test('moveColumn never mutates the input array', async () => {
    const module = await loadModule();
    const list = columns({ name: 'a' }, { name: 'b' });
    module.moveColumn(list, 0, 2);
    assert.deepEqual(list.map((column) => column.name), ['a', 'b']);
});

test('shiftColumn moves one place and clamps at both ends', async () => {
    const module = await loadModule();
    const list = columns({ name: 'a' }, { name: 'b' }, { name: 'c' });
    const right = module.shiftColumn(list, 0, 1);
    assert.deepEqual(right.columns.map((column) => column.name), ['b', 'a', 'c']);
    assert.equal(right.index, 1);

    const left = module.shiftColumn(list, 2, -1);
    assert.deepEqual(left.columns.map((column) => column.name), ['a', 'c', 'b']);
    assert.equal(left.index, 1);

    const clampedLeft = module.shiftColumn(list, 0, -1);
    assert.deepEqual(clampedLeft.columns.map((column) => column.name), ['a', 'b', 'c']);
    assert.equal(clampedLeft.index, 0);

    const clampedRight = module.shiftColumn(list, 2, 1);
    assert.deepEqual(clampedRight.columns.map((column) => column.name), ['a', 'b', 'c']);
    assert.equal(clampedRight.index, 2);
});

test('describeColumnMove states the new position for the live region', async () => {
    const module = await loadModule();
    assert.equal(module.describeColumnMove('Analysis', 1, 7), 'Analysis moved to position 2 of 7');
});

/* ── The + Add status picker (D38) ──────────────────────────────────────────────────────────── */

test('buildStatusPickerRows lists every status the column does not hold, orphans first', async () => {
    const module = await loadModule();
    const list = columns(
        { id: 'col-aaaaaaaa', name: 'To do', statuses: ['To Do'] },
        { id: 'col-bbbbbbbb', name: 'Doing', statuses: ['In Progress', 'Release'] },
    );
    const rows = module.buildStatusPickerRows({
        columns: list,
        columnId: 'col-aaaaaaaa',
        statuses: ['To Do', 'Analysis', 'In Progress', 'Release', 'Pending'],
    });
    assert.deepEqual(rows, [
        { status: 'Analysis', fromColumnId: null, fromColumnName: null },
        { status: 'Pending', fromColumnId: null, fromColumnName: null },
        { status: 'In Progress', fromColumnId: 'col-bbbbbbbb', fromColumnName: 'Doing' },
        { status: 'Release', fromColumnId: 'col-bbbbbbbb', fromColumnName: 'Doing' },
    ]);
});

test('buildStatusPickerRows is never dead in the reference configuration', async () => {
    const module = await loadModule();
    const fixture = await loadFixture();
    const board = fixture.referenceBoard();
    board.columns.forEach((column) => {
        const rows = module.buildStatusPickerRows({
            columns: board.columns,
            columnId: column.id,
            statuses: fixture.REFERENCE_STATUS_NAMES,
        });
        assert.equal(rows.length, fixture.REFERENCE_STATUS_NAMES.length - column.statuses.length);
        assert.ok(rows.every((row) => row.fromColumnId && row.fromColumnId !== column.id));
    });
});

/* ── Assigning moves, it never copies ───────────────────────────────────────────────────────── */

test('assignStatusToColumn removes the status from the column that held it', async () => {
    const module = await loadModule();
    const list = columns(
        { id: 'col-aaaaaaaa', name: 'To do', statuses: ['To Do'] },
        { id: 'col-bbbbbbbb', name: 'Doing', statuses: ['In Progress', 'Release'] },
    );
    const next = module.assignStatusToColumn(list, 'Release', 'col-aaaaaaaa');
    assert.deepEqual(next[0].statuses, ['To Do', 'Release']);
    assert.deepEqual(next[1].statuses, ['In Progress']);
    const seen = next.flatMap((column) => column.statuses);
    assert.equal(new Set(seen).size, seen.length);
});

test('assignStatusToColumn assigns an orphan without touching anything else', async () => {
    const module = await loadModule();
    const list = columns({ id: 'col-aaaaaaaa', name: 'To do', statuses: ['To Do'] });
    const next = module.assignStatusToColumn(list, 'Pending', 'col-aaaaaaaa');
    assert.deepEqual(next[0].statuses, ['To Do', 'Pending']);
    assert.deepEqual(list[0].statuses, ['To Do'], 'input is not mutated');
});

test('assignStatusToColumn is a no-op when the column already holds the status', async () => {
    const module = await loadModule();
    const list = columns({ id: 'col-aaaaaaaa', name: 'To do', statuses: ['To Do', 'Pending'] });
    const next = module.assignStatusToColumn(list, 'Pending', 'col-aaaaaaaa');
    assert.deepEqual(next[0].statuses, ['To Do', 'Pending']);
});

test('removeStatusFromColumns sends a status back to the leftover pool', async () => {
    const module = await loadModule();
    const list = columns({ id: 'col-aaaaaaaa', name: 'To do', statuses: ['To Do', 'Pending'] });
    const next = module.removeStatusFromColumns(list, 'Pending');
    assert.deepEqual(next[0].statuses, ['To Do']);
    assert.deepEqual(module.unmappedStatuses(['To Do', 'Pending', 'Analysis'], next), ['Pending', 'Analysis']);
});

test('setStarredColumn keeps at most one star and lets the last one be released', async () => {
    const module = await loadModule();
    const list = columns(
        { id: 'col-aaaaaaaa', name: 'A' },
        { id: 'col-bbbbbbbb', name: 'B', star: true },
    );
    const moved = module.setStarredColumn(list, 'col-aaaaaaaa');
    assert.deepEqual(moved.map((column) => column.star), [true, false]);
    const released = module.setStarredColumn(moved, 'col-aaaaaaaa');
    assert.deepEqual(released.map((column) => column.star), [false, false]);
});

/* ── Counts, breaches and stale statuses ────────────────────────────────────────────────────── */

test('columnEpicCount sums the epics of the statuses the column holds', async () => {
    const module = await loadModule();
    const fixture = await loadFixture();
    const board = fixture.referenceBoard();
    const counts = board.columns.map((column) => module.columnEpicCount(column, fixture.REFERENCE_EPICS_BY_STATUS));
    assert.deepEqual(counts, [18, 11, 9, 7, 2, 26, 14]);
    assert.equal(counts.reduce((total, value) => total + value, 0), 87);
});

test('describeBreach reports over max and under min, and nothing in range', async () => {
    const module = await loadModule();
    assert.deepEqual(module.describeBreach({ statuses: ['a'], min: null, max: 20 }, 26), { dir: 'over', by: 6, limit: 20 });
    assert.deepEqual(module.describeBreach({ statuses: ['a'], min: 15, max: null }, 11), { dir: 'under', by: 4, limit: 15 });
    assert.equal(module.describeBreach({ statuses: ['a'], min: 5, max: 20 }, 9), null);
    assert.equal(module.describeBreach({ statuses: [], min: 5, max: 20 }, 0), null, 'an empty column is an error, not a breach');
});

test('a red accent does not make a column breach', async () => {
    const module = await loadModule();
    const fixture = await loadFixture();
    const board = fixture.referenceBoard();
    const external = board.columns.find((column) => column.name === 'External block');
    assert.equal(external.colour, '#ff4d4f');
    assert.equal(module.describeBreach(external, module.columnEpicCount(external, fixture.REFERENCE_EPICS_BY_STATUS)), null);
});

test('staleColumnStatuses flags stored statuses that no longer exist on the board', async () => {
    const module = await loadModule();
    const list = columns({ id: 'col-aaaaaaaa', name: 'A', statuses: ['To Do', 'Retired'] });
    assert.deepEqual(module.staleColumnStatuses(list, ['To Do', 'Analysis']), ['Retired']);
    assert.deepEqual(module.staleColumnStatuses(list, []), [], 'no catalog means nothing can be judged stale');
    assert.deepEqual(module.staleColumnStatuses(list, null), []);
});

/* ── Validation: two severities ─────────────────────────────────────────────────────────────── */

test('validateComposerBoard is clean for the reference configuration', async () => {
    const module = await loadModule();
    const fixture = await loadFixture();
    const result = module.validateComposerBoard(fixture.referenceBoard().columns);
    assert.deepEqual(result.errors, []);
});

test('validateComposerBoard reports an empty column and blocks', async () => {
    const module = await loadModule();
    const list = columns({ name: 'Analysis', statuses: [] }, { name: 'Done', statuses: ['Done'] });
    const result = module.validateComposerBoard(list);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Analysis/);
});

test('validateComposerBoard does not block on a Min/Max breach', async () => {
    const module = await loadModule();
    const fixture = await loadFixture();
    const board = fixture.referenceBoard();
    // Analysis breaches under min 15 and In progress breaches over max 20 in this very fixture.
    const breaching = board.columns.filter(
        (column) => module.describeBreach(column, module.columnEpicCount(column, fixture.REFERENCE_EPICS_BY_STATUS)),
    );
    assert.equal(breaching.length, 2);
    assert.deepEqual(module.validateComposerBoard(board.columns).errors, []);
});

test('validateComposerBoard reports a blank, over-long or duplicate name', async () => {
    const module = await loadModule();
    assert.equal(module.validateComposerBoard(columns({ name: '   ', statuses: ['a'] })).errors.length, 1);
    assert.equal(module.validateComposerBoard(columns({ name: 'x'.repeat(41), statuses: ['a'] })).errors.length, 1);
    const duplicate = module.validateComposerBoard(columns(
        { name: 'Done', statuses: ['a'] },
        { name: 'DONE', statuses: ['b'] },
    ));
    assert.equal(duplicate.errors.length, 1);
    assert.match(duplicate.errors[0], /DONE/);
});

test('validateComposerBoard reports min greater than max', async () => {
    const module = await loadModule();
    const result = module.validateComposerBoard(columns({ name: 'A', statuses: ['a'], min: 9, max: 4 }));
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /min/i);
});

test('validateComposerBoard reports more than one star and more than twelve columns', async () => {
    const module = await loadModule();
    const twoStars = columns(
        { name: 'A', statuses: ['a'], star: true },
        { name: 'B', statuses: ['b'], star: true },
    );
    assert.equal(twoStars.filter((column) => column.star).length, 2);
    assert.ok(module.validateComposerBoard(twoStars).errors.some((message) => /one column/i.test(message)));

    const thirteen = columns(...Array.from({ length: 13 }, (unused, index) => ({
        id: `col-000000${String(index).padStart(2, '0')}`,
        name: `C${index}`,
        statuses: [`s${index}`],
    })));
    assert.ok(module.validateComposerBoard(thirteen).errors.some((message) => /12 columns/.test(message)));
});

test('validateComposerBoard reports a status held by two columns', async () => {
    const module = await loadModule();
    const list = columns(
        { name: 'A', statuses: ['Done'] },
        { name: 'B', statuses: ['Done'] },
    );
    assert.ok(module.validateComposerBoard(list).errors.some((message) => /Done/.test(message)));
});

test('validateComposerBoard rejects a present board with zero columns', async () => {
    const module = await loadModule();
    assert.ok(module.validateComposerBoard([]).errors.some((message) => /at least one column/i.test(message)));
});

test('validateComposerBoard rejects malformed and duplicate column ids before normalization', async () => {
    const module = await loadModule();
    const malformed = columns({ id: 'analysis', name: 'Analysis', statuses: ['Analysis'] });
    assert.ok(module.validateComposerBoard(malformed).errors.some((message) => /valid column id/i.test(message)));

    const duplicate = columns(
        { id: 'col-1a2b3c4d', name: 'Analysis', statuses: ['Analysis'] },
        { id: 'col-1a2b3c4d', name: 'Done', statuses: ['Done'] },
    );
    assert.ok(module.validateComposerBoard(duplicate).errors.some((message) => /repeats another column's id/i.test(message)));
});

test('validateComposerBoard returns errors instead of throwing for arbitrary imported members', async () => {
    const module = await loadModule();
    [null, 'oops', 42, true, [], { id: 'col-1a2b3c4d', name: 'A' }].forEach((member) => {
        let result;
        assert.doesNotThrow(() => { result = module.validateComposerBoard([member]); });
        assert.ok(result.errors.length > 0);
    });
});

test('validatePresentGroupBoards skips absent boards but validates raw present drafts', async () => {
    const module = await loadModule();
    assert.deepEqual(module.validatePresentGroupBoards([{ id: 'plain', name: 'Plain group' }]), []);

    const errors = module.validatePresentGroupBoards([
        { id: 'empty', name: 'Empty board', board: { columns: [] } },
        { id: 'raw', name: 'Raw ids', board: { columns: [
            { id: 'not-valid', name: 'A', statuses: ['A'] },
            { id: 'not-valid', name: 'B', statuses: ['B'] },
        ] } },
    ]);
    assert.ok(errors.some((message) => /Empty board:.*at least one column/i.test(message)));
    assert.ok(errors.some((message) => /Raw ids:.*valid column id/i.test(message)));
    assert.ok(errors.some((message) => /Raw ids:.*repeats another column's id/i.test(message)));
});

test('normalize then validate keeps a legacy nullish board absent but preserves explicit empty', async () => {
    const { validatePresentGroupBoards } = await loadModule();
    const { normalizeGroupsConfig } = await import('../frontend/src/settings/groupConfigUtils.js');
    const normalized = normalizeGroupsConfig({
        groups: [
            { id: 'legacy', name: 'Legacy', board: undefined },
            { id: 'empty', name: 'Explicit empty', board: { columns: [] } },
        ],
    });

    assert.equal(Object.hasOwn(normalized.groups[0], 'board'), false);
    assert.deepEqual(normalized.groups[1].board, { columns: [] });
    assert.deepEqual(validatePresentGroupBoards([normalized.groups[0]]), []);
    assert.ok(validatePresentGroupBoards([normalized.groups[1]]).some((message) => /at least one column/i.test(message)));
});

/* ── Stored shape: what the composer hands the validator Task 6 shipped ─────────────────────── */

test('toStoredBoard preserves a present empty board when the final column is deleted', async () => {
    const module = await loadModule();
    assert.deepEqual(module.toStoredBoard([]), { columns: [] });
});

test('toStoredBoard round-trips the reference configuration unchanged', async () => {
    const module = await loadModule();
    const fixture = await loadFixture();
    assert.deepEqual(module.toStoredBoard(fixture.referenceBoard().columns), fixture.referenceBoard());
});

test('toStoredBoard trims names, keeps ids and cannot emit a colour outside the enum', async () => {
    const module = await loadModule();
    const stored = module.toStoredBoard(columns({
        id: 'col-1a2b3c4d',
        name: '  Analysis  ',
        colour: '#2f80ed',
        statuses: ['Analysis'],
        min: '15',
        max: '',
    }));
    assert.equal(stored.columns[0].name, 'Analysis');
    assert.equal(stored.columns[0].id, 'col-1a2b3c4d');
    assert.ok(module.BOARD_COLUMN_COLOURS.includes(stored.columns[0].colour));
    assert.equal(stored.columns[0].colour, module.DEFAULT_COLUMN_COLOUR);
    assert.equal(stored.columns[0].min, 15);
    assert.equal(stored.columns[0].max, null);
});

test('toStoredBoard emits only the seven schema fields, in the stored shape', async () => {
    const module = await loadModule();
    const stored = module.toStoredBoard(columns({ name: 'A', statuses: ['a'] }));
    assert.deepEqual(Object.keys(stored.columns[0]).sort(), ['colour', 'id', 'max', 'min', 'name', 'star', 'statuses']);
    assert.deepEqual(Object.keys(stored).sort(), ['columns']);
});

test('fromStoredBoard reads a stored board into editable columns', async () => {
    const module = await loadModule();
    const fixture = await loadFixture();
    const editable = module.fromStoredBoard(fixture.referenceBoard());
    assert.equal(editable.length, 7);
    assert.deepEqual(editable.map((column) => column.name), [
        'To do', 'Analysis', 'Ready to start', 'Accepted in Q', 'External block', 'In progress', 'Done',
    ]);
    assert.equal(editable.filter((column) => column.star).length, 1);
    editable.forEach((column) => assert.match(column.id, COLUMN_ID_PATTERN));
});

test('fromStoredBoard reads an absent board as zero columns', async () => {
    const module = await loadModule();
    assert.deepEqual(module.fromStoredBoard(null), []);
    assert.deepEqual(module.fromStoredBoard(undefined), []);
    assert.deepEqual(module.fromStoredBoard({}), []);
});

test('fromStoredBoard repairs an id that does not match the schema', async () => {
    const module = await loadModule();
    const editable = module.fromStoredBoard({
        columns: [{ id: 'in-progress', name: 'In progress', colour: '#597ef7', star: true, min: null, max: null, statuses: ['In Progress'] }],
    });
    assert.match(editable[0].id, COLUMN_ID_PATTERN);
    assert.equal(editable[0].name, 'In progress');
});

test('fromStoredBoard coerces an out-of-enum colour to the default grey', async () => {
    const module = await loadModule();
    const editable = module.fromStoredBoard({
        columns: [{ id: 'col-1a2b3c4d', name: 'In progress', colour: '#2f80ed', star: false, min: null, max: null, statuses: ['In Progress'] }],
    });
    assert.equal(editable[0].colour, module.DEFAULT_COLUMN_COLOUR);
});

// normalizeGroupsConfig (groupConfigUtils.js) only checks that `board.columns` itself is an
// array — it shallow-copies the array without normalizing each element, so a pasted Import JSON
// payload can hand fromStoredBoard any of these element shapes. Every one must become a blank,
// well-formed column instead of throwing.
test('fromStoredBoard is total: no malformed column element shape throws', async () => {
    const module = await loadModule();
    const malformedColumnShapes = [
        ['a null element', null],
        ['a string element', 'oops'],
        ['a number element', 42],
        ['a boolean element', true],
        ['an array element', [1, 2, 3]],
        ['a nested object with wrong field types', {
            id: 123, name: {}, statuses: 'not-an-array', colour: 5, star: 'yes', min: {}, max: [],
        }],
    ];
    malformedColumnShapes.forEach(([label, shape]) => {
        let editable;
        assert.doesNotThrow(() => {
            editable = module.fromStoredBoard({ columns: [shape] });
        }, `fromStoredBoard threw on ${label}`);
        assert.equal(editable.length, 1, `expected one column for ${label}`);
        const [column] = editable;
        assert.match(column.id, COLUMN_ID_PATTERN, `expected a valid id for ${label}`);
        assert.equal(typeof column.name, 'string', `expected a string name for ${label}`);
        assert.ok(Array.isArray(column.statuses), `expected an array of statuses for ${label}`);
        column.statuses.forEach((status) => assert.equal(typeof status, 'string', `expected only string statuses for ${label}`));
    });

    // `undefined` cannot survive a real JSON.parse inside an array (JSON has no such literal), so
    // it never reaches this function through the Import JSON UI — but the same type guard covers
    // it, so a non-JSON caller is protected too.
    assert.doesNotThrow(() => module.fromStoredBoard({ columns: [undefined] }));

    // A status array can itself carry garbage: only the real string status must survive. A
    // non-string status (the object, the null, the number) would otherwise reach
    // <StatusPill label={status}> unchanged and crash React on render.
    const [withMixedStatuses] = module.fromStoredBoard({
        columns: [{ name: 'A', statuses: [{}, 'Real Status', null, 42] }],
    });
    assert.deepEqual(withMixedStatuses.statuses, ['Real Status']);
});
