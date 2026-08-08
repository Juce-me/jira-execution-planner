const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const summaryPath = path.join(repoRoot, 'frontend', 'src', 'styles', 'stats', 'summary.css');
const statsShellPath = path.join(repoRoot, 'frontend', 'src', 'styles', 'stats', 'shell.css');
const engEntrypointPath = path.join(repoRoot, 'frontend', 'src', 'styles', 'eng.css');
const legacyFiltersPath = path.join(repoRoot, 'frontend', 'src', 'styles', 'eng', 'filters.css');

test('stats summary drops only the orphaned singular stat-card family', () => {
    const css = fs.readFileSync(summaryPath, 'utf8');
    ['.stats {', '.stat-card', '.stat-value', '.stat-label', '.stats-note'].forEach((selector) => {
        assert.equal(css.includes(selector), false, `Expected orphaned ${selector} rules to be removed`);
    });
    ['.empty-state', '.planning-button', '.planning-panel', '.stats-panel'].forEach((selector) => {
        assert.equal(css.includes(selector), true, `Expected live ${selector} rules to remain`);
    });
});

test('live stats-card values retain their compact computed line height in the scoped owner', () => {
    const css = fs.readFileSync(statsShellPath, 'utf8');
    const rule = css.match(/\.stats-card \.stat-value\s*\{[^}]*\}/)?.[0] || '';
    assert.match(rule, /line-height:\s*1\s*;/);
});

test('ENG styles no longer import the deleted legacy filters partial', () => {
    const entrypoint = fs.readFileSync(engEntrypointPath, 'utf8');
    assert.equal(fs.existsSync(legacyFiltersPath), false, 'Expected the empty legacy filters partial to be deleted');
    assert.equal(entrypoint.includes('@import "./eng/filters.css";'), false);
    assert.equal(entrypoint.includes('@import "./eng/filter-bar.css";'), true);
    assert.equal(entrypoint.includes('@import "./eng/board.css";'), true);
});
