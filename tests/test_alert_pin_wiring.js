const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'), 'utf8');

// The body of the first `useEffect(() => { ... }, [deps]);` that contains `marker`.
function effectContaining(marker) {
    const index = source.indexOf(marker);
    assert.ok(index >= 0, `marker not found: ${marker}`);
    const start = source.lastIndexOf('useEffect(() => {', index);
    const depsMatch = /\}, \[([^\]]*)\]\);/g;
    depsMatch.lastIndex = index;
    const match = depsMatch.exec(source);
    assert.ok(start >= 0 && match, `no effect around: ${marker}`);
    return { body: source.slice(start, match.index), deps: match[1].split(',').map(dep => dep.trim()).filter(Boolean) };
}

test('epicStickyTop adds the pin height to its sum', () => {
    const match = source.match(/const epicStickyTop = ([^;]+);/);
    assert.ok(match, 'epicStickyTop declaration not found');
    assert.match(match[1], /\bpinHeight\b/);
    assert.match(match[1], /compactStickyTop/);
    assert.match(match[1], /planningStickyHeight/);
    assert.match(match[1], /filterBarHeight/);
});

test('pinHeight is derived in render from isCatchUpMode and the pin, never set by an effect', () => {
    assert.match(source, /const pinHeight = isCatchUpMode && alertPin \? PIN_HEIGHT : 0;/);
    assert.ok(source.indexOf('const pinHeight =') < source.indexOf('const epicStickyTop ='));
    assert.doesNotMatch(source, /setPinHeight/);
});

test('the pin is cleared in the effect that clears dismissed Story requirements, keyed on the pin scope and leaving Catch Up', () => {
    const { body, deps } = effectContaining('setDismissedStoryRequirementIds([]);');
    assert.match(body, /pinScopeKey\(\{ groupId: activeGroupId, sprintId: selectedSprint \}\)/);
    assert.match(body, /setAlertPin\(null\)/);
    assert.match(body, /isCatchUpMode/);
    assert.deepEqual([...deps].sort(), ['activeGroupId', 'isCatchUpMode', 'selectedSprint']);
    assert.ok(!deps.includes('selectedTeams'));
});

test('no other effect clears the pin, and the confetti-clearing effect does not touch it', () => {
    const clears = source.match(/setAlertPin\(null\)/g) || [];
    // One in the scope effect (scope change), one in the same effect (leaving Catch Up), one in closeAlertPin.
    assert.equal(clears.length, 3);
    const confetti = effectContaining('setAlertCelebrationPieces([]);\n            }, [selectedSprint, activeGroupId, selectedTeams]);');
    assert.doesNotMatch(confetti.body, /setAlertPin/);
});

test('dismissAlertItem accepts an option that suppresses only its built-in celebration', () => {
    const start = source.indexOf('const dismissAlertItem = (taskKey, { suppressCelebration = false } = {}) => {');
    assert.ok(start >= 0, 'dismissAlertItem signature with suppressCelebration not found');
    const body = source.slice(start, source.indexOf('\n            };', start));
    assert.match(body, /if \(resolvedTypes\.length && !suppressCelebration\) \{\s*triggerAlertCelebration\(\{ types: resolvedTypes \}\);/);
    assert.match(body, /alertDismissedRef\.current = true;\s*setDismissedAlertKeys\(/);
});

test('closeAlertPin resolves from the rendered collections and the cohort settle state, and dismisses without a double burst', () => {
    const start = source.indexOf('const closeAlertPin = () => {');
    assert.ok(start >= 0, 'closeAlertPin not found');
    const body = source.slice(start, source.indexOf('\n            };', start));
    assert.match(body, /resolvePinClose\(alertPin, alertIdentitiesBySection\(visibleAlertCollections\), \{ loading: !alertCohortSettled \}\)/);
    assert.match(body, /dismissAlertItem\(alertPin\.identity, \{ suppressCelebration: true \}\)/);
    assert.match(body, /dismissStoryRequirement\(/);
    assert.match(body, /triggerAlertCelebration\(/);
    assert.match(body, /scrollAfterPinClose\(outcome\.scroll\)/);
});

test('the alert cohort settle state flips beside every alertCohortRef set and clear', () => {
    assert.match(source, /const \[alertCohortSettled, setAlertCohortSettled\] = useState\(false\);/);
    assert.match(source, /alertCohortRef\.current = alertCohortToken;\s*setAlertCohortSettled\(false\);/);
    // Settled only when the finishing cohort is still the current one; the existing token-checked clear is kept verbatim.
    assert.match(source, /\.finally\(\(\) => \{ if \(alertCohortRef\.current === alertCohortToken\) setAlertCohortSettled\(true\); if \(alertCohortRef\.current === alertCohortToken\) alertCohortRef\.current = null;/);
    // Any cleanup (scope change, rearm, leaving Catch Up) invalidates the cohort.
    assert.match(source, /return \(\) => \{ cancelled = true; setAlertCohortSettled\(false\); alertController\.abort\(\); if \(alertCohortRef\.current === alertCohortToken\) alertCohortRef\.current = null;/);
});

test('EngView receives the pin, its handlers and its sticky variables; the panel receives pinAlert', () => {
    assert.match(source, /alertPin=\{isCatchUpMode \? alertPin : null\}/);
    assert.match(source, /onPinBack=\{/);
    assert.match(source, /onPinClose=\{closeAlertPin\}/);
    assert.match(source, /'--alert-pin-top': `\$\{compactStickyTop \+ filterBarHeight\}px`/);
    assert.match(source, /'--alert-pin-height': `\$\{PIN_HEIGHT\}px`/);
    const alertProps = source.slice(source.indexOf('alertProps={{'), source.indexOf('}}', source.indexOf('alertProps={{')));
    assert.match(alertProps, /\bpinAlert,/);
});
