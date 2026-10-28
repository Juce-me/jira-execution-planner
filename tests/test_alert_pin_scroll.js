const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'), 'utf8');
// B2 moved revealAlertBlock, scrollAfterPinClose, scrollBackToAlerts and closeAlertPin (bodies unchanged except the late-bound
// alertFlags getter and clearAlertPin) into this owner module; the scroll helpers they call stay in dashboard.jsx.
const pinSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'eng', 'useAlertPin.js'), 'utf8');

// The text of `const <name> = (...) => { ... };` up to the first line that closes it at the same indentation.
function arrowBody(name, text = source) {
    const start = text.indexOf(`const ${name} = `);
    assert.ok(start >= 0, `${name} not found`);
    const indent = text.slice(text.lastIndexOf('\n', start) + 1, start);
    const end = text.indexOf(`\n${indent}};`, start);
    assert.ok(end > start, `${name} has no closing line`);
    return text.slice(start, end);
}

test('scrollToAlertTarget lands below the landing stack from the shared offset model, with reduced-motion-aware behavior', () => {
    const body = arrowBody('scrollToAlertTarget');
    assert.match(body, /alertLandingTop\(\{ \.\.\.alertStackRef\.current, /);
    assert.match(body, /headerRef\.current/);
    assert.match(body, /prefersReducedMotion\(\)/);
    // Epic headers and the Planning panel sit below the alerts and never cover them; the DOM stack is not measured here.
    assert.doesNotMatch(body, /measureStickyBottom|epic-header|epicStickyTop|planning/i);
});

test('the landing stack ref is refreshed every render from the compact header, the filter bar and the pin tier only', () => {
    const decl = source.indexOf('const pinHeight = isCatchUpMode && alertPin ? PIN_HEIGHT : 0;');
    const assign = source.indexOf('alertStackRef.current = { compactHeight: compactHeaderOffset, filterBarHeight, pinHeight };');
    assert.ok(decl > 0 && assign > decl, 'assigned in render after pinHeight is derived');
    assert.match(source, /const alertStackRef = useRef\(\{\}\);/);
});

test('the scroll-to-top branch runs outside triggerAlertCelebration', () => {
    const body = arrowBody('scrollAfterPinClose', pinSource);
    assert.match(body, /outcome === 'top'/);
    assert.doesNotMatch(body, /triggerAlertCelebration/);
    const close = arrowBody('closeAlertPin', pinSource);
    const celebrate = close.indexOf('triggerAlertCelebration(');
    const scroll = close.indexOf('scrollAfterPinClose(');
    assert.ok(celebrate > 0 && scroll > celebrate, 'scroll runs after, not inside, the celebration call');
    assert.match(close, /scrollAfterPinClose\(outcome\.scroll, alertPin\.sectionId\)/);
});

test('the block scroll opens the alerts panel and the category before scrolling after two frames', () => {
    const body = arrowBody('revealAlertBlock', pinSource);
    const panel = body.indexOf('setShowAlertsPanel(true)');
    // The category flag setter is read through the late-bound getter (shareViewOptions.alertFlags in App()).
    const category = body.search(/getAlertFlags\(\)\[[^\]]+\]\?\.\[1\]\(true\)/);
    const frames = body.indexOf('afterTwoFrames(');
    const scroll = body.indexOf('scrollToAlertTarget(target())');
    assert.ok(panel >= 0 && category > panel && frames > category && scroll > frames, 'panel, category, two frames, then scroll');
    assert.match(body, /target = \(\) => document\.getElementById\(sectionId\)/);
    assert.match(source, /const afterTwoFrames = callback => window\.requestAnimationFrame\(\(\) => window\.requestAnimationFrame\(callback\)\);/);
});

test('back to alerts reuses the block reveal (panel, pinned category, two frames) and scrolls to its shell with a fallback, keeping the pin', () => {
    const line = pinSource.split('\n').find(text => text.includes('const scrollBackToAlerts = '));
    assert.ok(line, 'scrollBackToAlerts not found');
    assert.match(line, /=> revealAlertBlock\(alertPin\?\.sectionId, true, \(\) => /);
    assert.match(line, /\.alerts-panel-shell/);
    assert.match(line, /\[id\^="eng-alert-"\]/);
    assert.doesNotMatch(line, /setAlertPin/);
    assert.match(source, /onPinBack=\{scrollBackToAlerts\}/);
    assert.match(source, /getAlertFlags: \(\) => shareViewOptions\.alertFlags/);
});

test('scrollToTaskItem keeps its centered reveal and adjusts only while the pin is mounted', () => {
    const body = arrowBody('scrollToTaskItem');
    assert.match(body, /element\.scrollIntoView\(\{\n\s+behavior: prefersReducedMotion\(\) \? 'auto' : 'smooth',\n\s+block: 'center'\n\s+\}\);/);
    const guard = body.indexOf("if (!document.querySelector('[data-alert-pin]')) return;");
    const adjust = body.indexOf('clearCenteredTarget(');
    assert.ok(guard > 0 && adjust > guard, 'the pin guard precedes the adjustment');
    assert.ok(body.indexOf('afterTwoFrames(') < guard, 'the adjustment waits for the pin to lay out');
});

test('the Story clearance check counts the real sticky filter bar', () => {
    assert.match(arrowBody('scrollToTaskItem'), /measureStickyBottom\(\[\.\.\.STICKY_STACK_SELECTORS, '\.filterbar-wrap'\]\)/);
});
