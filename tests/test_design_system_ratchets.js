const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeCss, analyzeDashboard, baselineData, compareBaseline, baselineRegenerationErrors, readRegistry, safeShadow } = require('../scripts/design_system_css.cjs');

const analyze = (css, file = 'synthetic.css') => analyzeCss([{ file, css }]);
const compare = (current, baseline) => compareBaseline(current, baselineData(baseline), current.classHooks);

test('dashboard CSS matches the generated baseline and documented hook registry', async () => {
    const current = await analyzeDashboard();
    const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'design_system_baseline.json'), 'utf8'));
    assert.equal(baseline.version, 1);
    const errors = compareBaseline(current, baseline, readRegistry().classHooks);
    assert.deepEqual(errors, [], errors.join('\n'));
});

test('CSS identities separate source files, selector lists, nested contexts and duplicate occurrences', () => {
    const current = analyzeCss([
        { file: 'a.css', css: '.a:hover, .b:hover { transform: none; } .a:hover { transform: translateY(-1px); } @media (hover: hover) { @supports (display: grid) { .a:hover { transform: scale(1.1); } } }' },
        { file: 'b.css', css: '.a:hover { transform: none; }' },
    ]);
    const keys = Object.keys(current.offenders).map((key) => JSON.parse(key));
    assert.equal(keys.length, 5);
    assert.ok(keys.some(([file, context, selector, occurrence]) => file === 'a.css' && !context.length && selector === '.a:hover' && occurrence === 2));
    assert.ok(keys.some(([file, context]) => file === 'a.css' && context.length === 2));
    assert.ok(keys.some(([file]) => file === 'b.css'));
    const changed = analyzeCss([
        { file: 'a.css', css: '.a:hover, .b:hover { transform: none; } .a:hover { transform: scale(2); } @media (hover: hover) { @supports (display: grid) { .a:hover { transform: scale(1.1); } } }' },
        { file: 'b.css', css: '.a:hover { transform: none; }' },
    ]);
    assert.equal(compare(changed, current).length, 1);
    assert.match(compare(changed, current)[0], /Changed hover offender/);
});

test('nested style and conditional blocks fail closed instead of bypassing the baseline', () => {
    const baseline = analyze('.existing { color: red; }');
    for (const css of [
        '.existing { &:hover { transform: translateY(-1px); } }',
        '.existing:hover { @media (hover: hover) { transform: scale(2); } }',
        '.existing { color: red; @supports (display: grid) { &:active { translate: 0 -1px; } } }',
        '.existing { .new-pill { font-size: 99px; transition: all .2s; } }',
        '@media (hover: hover) { .existing { &:hover { box-shadow: 0 2px 4px #000; } } }',
    ]) {
        assert.throws(() => compare(analyze(css), baseline), /Unsupported nested CSS block in synthetic\.css: \.existing/);
    }
});

test('braces in quoted declaration values do not count as nested blocks', () => {
    const current = analyze('.existing:hover { content: "{ nested; }"; transform: none; }');
    assert.equal(current.rules.length, 1);
    assert.deepEqual(Object.values(current.offenders), ['none']);
});

test('property matching is exact, including text-transform and scale/translate longhands', () => {
    const current = analyze('.a:hover { text-transform: none; transform: none; scale: 1; translate: 0; } .b { transform: translateY(-1px); }');
    assert.deepEqual(Object.keys(current.offenders).map((key) => JSON.parse(key)[4]).sort(), ['scale', 'transform', 'translate']);
    assert.equal(Object.values(current.offenders).includes('translateY(-1px)'), false);
});

test('a grandfathered none reset cannot become a lift and duplicate declarations cannot collide', () => {
    const before = analyze('.a:hover { transform: none; transform: none; }');
    const after = analyze('.a:hover { transform: none; transform: translateY(-1px); }');
    assert.equal(Object.keys(before.offenders).length, 2);
    assert.equal(compare(after, before).length, 1);
    assert.match(compare(after, before)[0], /none -> translateY\(-1px\)/);
});

test('new and stale offenders and typography values both fail', () => {
    const before = analyze('.a:hover { transform: none; } .a { font-family: serif; font-size: 12px; border-radius: 4px; }');
    const after = analyze('.b:active { transform: scale(1.1); } .a { font-family: sans-serif; font-size: 13px; border-radius: 5px; }');
    const errors = compare(after, before);
    for (const property of ['font-family', 'font-size', 'border-radius']) {
        assert.ok(errors.some((error) => error.startsWith(`New ${property}:`)));
        assert.ok(errors.some((error) => error.startsWith(`Stale ${property}:`)));
    }
    assert.ok(errors.some((error) => error.startsWith('New hover offender:')));
    assert.ok(errors.some((error) => error.startsWith('Stale hover offender:')));
});

test('hover elevation and transition all are captured while rings and inset overlays are allowed', () => {
    const current = analyze('.a:hover { box-shadow: 0 2px 4px #000; } .b:active { box-shadow: 0 0 0 1px #2f80ed, 0 0 0 3px rgba(47, 128, 237, .25); } .c:hover { box-shadow: inset 0 0 0 100px #000; } .d:hover { box-shadow: none; } .e { transition: color .2s, all .3s; }');
    assert.equal(Object.keys(current.offenders).length, 2);
    assert.equal(safeShadow('0 0 0 1px #000, 0 2px 4px #000'), false);
    assert.equal(safeShadow('0 0 2px 1px #000'), false);
    assert.equal(safeShadow('inset 0 1px 3px rgba(0, 0, 0, .2)'), true);
});

test('hook names use complete classes and require registry membership, including new names', () => {
    const before = analyze('.status-pill, .action-button, .kind-chip, .kind-badge, .kind-btn, .status-pill--pending { color: red; }');
    assert.deepEqual(before.classHooks, ['action-button', 'kind-badge', 'kind-btn', 'kind-chip', 'status-pill']);
    assert.ok(compareBaseline(before, baselineData(before), []).some((error) => error.includes('registered class hook')));
    const after = analyze('.other-pill { color: red; }');
    const errors = compareBaseline(after, baselineData(before), before.classHooks);
    assert.ok(errors.some((error) => error === 'New registered class hook: other-pill'));
    assert.ok(errors.some((error) => error === 'Stale class hook baseline: status-pill'));
});

test('commas and semicolons in functions, strings and attributes preserve selectors and values', () => {
    const current = analyze('[data-label="a,b"] .kind-pill:hover, :is(.x, .y):hover { font-family: "a;b", serif; box-shadow: 0 2px 4px rgba(0, 0, 0, .2); }');
    assert.equal(current.rules.length, 2);
    assert.deepEqual(current.typography['font-family'], ['"a;b", serif']);
    assert.equal(Object.keys(current.offenders).length, 2);
});


test('comments are stripped without destroying quoted values or hiding property identity', () => {
    const current = analyze('/* .ignored:hover { transform: scale(2); } */ .kind-pill:hover { text-transform: none; /* note */ transform: none; font-family: "a/*b*/  c", serif; }');
    assert.equal(Object.keys(current.offenders).length, 1);
    assert.deepEqual(current.typography['font-family'], ['"a/*b*/  c", serif']);
});


test('baseline regeneration rejects growth and changed grandfathered values', () => {
    const before = analyze('.kind-pill:hover { transform: none; } .a { font-family: serif; font-size: 12px; border-radius: 4px; }');
    const baseline = baselineData(before);
    for (const [css, expected] of [
        ['.kind-pill:hover { transform: translateY(-1px); }', /Changed hover offender/],
        ['.other:hover { scale: 1.1; }', /New hover offender/],
        ['.a { font-family: sans-serif; }', /New font-family/],
        ['.a { font-size: 13px; }', /New font-size/],
        ['.a { border-radius: 5px; }', /New border-radius/],
        ['.other-pill { color: red; }', /New class hook baseline/],
    ]) {
        assert.ok(baselineRegenerationErrors(analyze(css), baseline).some((error) => expected.test(error)), css);
    }
    assert.deepEqual(baselineRegenerationErrors(before, baseline), []);
    assert.deepEqual(baselineRegenerationErrors(before, { ...baseline, version: 2 }), ['Baseline version must remain unchanged']);
});

test('baseline regeneration permits initial creation and stale removals only', () => {
    const before = analyze('.kind-pill:hover { transform: none; } .a { font-family: serif; font-size: 12px; border-radius: 4px; }');
    const after = analyze('.a { color: red; }');
    assert.deepEqual(baselineRegenerationErrors(before, null), []);
    assert.ok(compare(after, before).some((error) => error.startsWith('Stale ')));
    assert.deepEqual(baselineRegenerationErrors(after, baselineData(before)), []);
});
