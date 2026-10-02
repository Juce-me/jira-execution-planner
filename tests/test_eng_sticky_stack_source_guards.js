const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const dashboard = read('frontend', 'src', 'dashboard.jsx');
const filterBar = read('frontend', 'src', 'eng', 'EngFilterBar.jsx');
const engControls = read('frontend', 'src', 'eng', 'EngFilterControls.jsx');
const boardView = read('frontend', 'src', 'eng', 'EngBoardView.jsx');
const shellCss = read('frontend', 'src', 'styles', 'shared', 'shell.css');
const filterBarCss = read('frontend', 'src', 'styles', 'eng', 'filter-bar.css');

test('the filter bar owns a tier and sticky top separate from Planning', () => {
    assert.match(shellCss, /--sticky-filterbar-z:\s*55\s*;/);
    const wrapperRule = filterBarCss.match(/\.filterbar-wrap\s*\{([^}]*)\}/s)?.[1] || '';
    assert.match(wrapperRule, /top:\s*var\(--filterbar-sticky-top(?:,\s*0px)?\)/);
    assert.match(wrapperRule, /z-index:\s*var\(--sticky-filterbar-z\)/);
    assert.doesNotMatch(wrapperRule, /--sticky-planning-z/);
});

test('the outer filter bar reports its initial height and clears it on unmount', () => {
    assert.match(filterBar, /ref=\{wrapRef\}/);
    assert.match(filterBar, /new ResizeObserver\(reportHeight\)/);
    assert.match(filterBar, /getBoundingClientRect\(\)\.height/);
    assert.match(filterBar, /reportHeight\(\)/);
    assert.match(filterBar, /return \(\) => \{[\s\S]*onHeightChange\?\.\(0\)/);
});

test('Dashboard derives shared controls C plus F plus P sticky offsets', () => {
    assert.match(dashboard, /const planningStickyHeight = showPlanning \? planningOffset : 0;/);
    assert.match(dashboard, /const filterBarStickyTop = compactStickyTop;/);
    assert.match(dashboard, /const epicStickyTop = compactStickyTop \+ planningStickyHeight \+ filterBarHeight;/);
    assert.match(dashboard, /'--filterbar-sticky-top': `\$\{filterBarStickyTop\}px`/);
    assert.match(dashboard, /const handleFilterBarHeightChange = React\.useCallback/);
});

test('sticky epic focus uses the same C plus P plus F boundary', () => {
    const focusEffect = dashboard.match(/useEffect\(\(\) => \{\s*const computeStickyEpicFocus[\s\S]*?\}, \[([^\]]+)\]\);/);
    assert.ok(focusEffect, 'Expected the sticky epic focus effect');
    assert.match(focusEffect[0], /const stickyTop = Math\.max\(0, Number\(epicStickyTop\) \|\| 0\);/);
    assert.match(focusEffect[1], /\bepicStickyTop\b/);
    assert.doesNotMatch(focusEffect[0], /\+ planningOffset/);
});

test('shared Catch Up/Planning controls and Board wire the height callback', () => {
    assert.match(engControls, /onFilterBarHeightChange,/);
    assert.match(engControls, /<EngFilterBar[\s\S]*?onHeightChange=\{onFilterBarHeightChange\}/);
    assert.match(boardView, /onFilterBarHeightChange,/);
    assert.match(boardView, /<EngFilterBar[\s\S]*?onHeightChange=\{onFilterBarHeightChange\}/);
    const dashboardWires = dashboard.match(/onFilterBarHeightChange=\{handleFilterBarHeightChange\}/g) || [];
    assert.equal(dashboardWires.length, 2);
});

test('open filter and sort overlays lift the sticky wrapper context', () => {
    assert.match(filterBarCss, /\.filterbar-wrap:has\(\.popover\)/);
    assert.match(filterBarCss, /\.filterbar-wrap:has\(\.eng-epic-sort-dropdown \.sprint-dropdown-panel\)/);
    assert.match(filterBarCss, /\.filterbar-wrap:has\(\.initiative-grouping-control:hover\)/);
    assert.match(filterBarCss, /\.filterbar-wrap:has\(\.initiative-grouping-control:focus-within\)/);
    assert.match(filterBarCss, /z-index:\s*calc\(var\(--sticky-control-overlay-z\) \+ 2\)/);
});
