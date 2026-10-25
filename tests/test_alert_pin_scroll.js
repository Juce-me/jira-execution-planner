const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'), 'utf8');

// The text of `const <name> = (...) => { ... };` up to the first line that closes it at the same indentation.
function arrowBody(name) {
    const start = source.indexOf(`const ${name} = `);
    assert.ok(start >= 0, `${name} not found`);
    const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
    const end = source.indexOf(`\n${indent}};`, start);
    assert.ok(end > start, `${name} has no closing line`);
    return source.slice(start, end);
}

test('scrollToAlertTarget lands below the measured sticky stack with reduced-motion-aware behavior', () => {
    const body = arrowBody('scrollToAlertTarget');
    assert.match(body, /scrollTargetTop\(/);
    assert.match(body, /measureStickyBottom\(\)/);
    assert.match(body, /prefersReducedMotion\(\)/);
});

test('the scroll-to-top branch runs outside triggerAlertCelebration', () => {
    const body = arrowBody('scrollAfterPinClose');
    assert.match(body, /outcome === 'top'/);
    assert.doesNotMatch(body, /triggerAlertCelebration/);
    const close = arrowBody('closeAlertPin');
    const celebrate = close.indexOf('triggerAlertCelebration(');
    const scroll = close.indexOf('scrollAfterPinClose(');
    assert.ok(celebrate > 0 && scroll > celebrate, 'scroll runs after, not inside, the celebration call');
    assert.match(close, /scrollAfterPinClose\(outcome\.scroll, alertPin\.sectionId\)/);
});

test('the block scroll opens the alerts panel and the category before scrolling after two frames', () => {
    const body = arrowBody('revealAlertBlock');
    const panel = body.indexOf('setShowAlertsPanel(true)');
    const category = body.search(/alertFlags\[[^\]]+\]\?\.\[1\]\(true\)/);
    const frames = body.indexOf('afterTwoFrames(');
    const scroll = body.indexOf('scrollToAlertTarget(document.getElementById(sectionId))');
    assert.ok(panel >= 0 && category > panel && frames > category && scroll > frames, 'panel, category, two frames, then scroll');
    assert.match(source, /const afterTwoFrames = callback => window\.requestAnimationFrame\(\(\) => window\.requestAnimationFrame\(callback\)\);/);
});

test('back to alerts opens the panel, then scrolls to its shell with a fallback, and keeps the pin', () => {
    const body = arrowBody('scrollBackToAlerts');
    assert.ok(body.indexOf('setShowAlertsPanel(true)') < body.indexOf('afterTwoFrames('));
    assert.match(body, /\.alerts-panel-shell/);
    assert.match(body, /\[id\^="eng-alert-"\]/);
    assert.doesNotMatch(body, /setAlertPin/);
    assert.match(source, /onPinBack=\{scrollBackToAlerts\}/);
});

test('scrollToTaskItem keeps its centered reveal and adjusts only while the pin is mounted', () => {
    const body = arrowBody('scrollToTaskItem');
    assert.match(body, /element\.scrollIntoView\(\{\n\s+behavior: prefersReducedMotion\(\) \? 'auto' : 'smooth',\n\s+block: 'center'\n\s+\}\);/);
    const guard = body.indexOf("if (!document.querySelector('[data-alert-pin]')) return;");
    const adjust = body.indexOf('clearCenteredTarget(');
    assert.ok(guard > 0 && adjust > guard, 'the pin guard precedes the adjustment');
    assert.ok(body.indexOf('afterTwoFrames(') < guard, 'the adjustment waits for the pin to lay out');
});
