const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.join(__dirname, '..');
const engViewSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'eng', 'EngView.jsx'), 'utf8');
const alertsCss = fs.readFileSync(path.join(root, 'frontend', 'src', 'styles', 'eng', 'alerts.css'), 'utf8');

function load(file) {
    const entry = path.join(root, 'frontend', 'src', 'eng', file);
    const code = esbuild.buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.jsx': 'jsx' } }).outputFiles[0].text;
    const loaded = { exports: {} };
    new Function('module', 'exports', 'require', code)(loaded, loaded.exports, require);
    return loaded.exports.default;
}

const pin = { kind: 'story', identity: 'S-1', sectionId: 'eng-alert-missing', key: 'S-1', title: 'Synthetic story', note: 'Missing Story Points' };
const count = (markup, needle) => markup.split(needle).length - 1;

test('the pin bar renders one static snapshot row with back, title, note and dismiss', () => {
    const AlertPinBar = load('AlertPinBar.jsx');
    const markup = renderToStaticMarkup(React.createElement(AlertPinBar, { pin, onBack: () => {}, onClose: () => {} }));
    assert.equal(count(markup, 'alert-story--pinned'), 1);
    assert.equal(count(markup, 'class="task-remove alert-remove"'), 1);
    assert.match(markup, /aria-label="Back to alerts"/);
    assert.match(markup, /icon-button--sm/);
    assert.ok(markup.indexOf('Back to alerts') < markup.indexOf('Synthetic story'), 'back button precedes the title');
    assert.match(markup, /S-1/);
    assert.match(markup, /Missing Story Points/);
    assert.match(markup, /title="Dismiss from alerts"/);
    assert.doesNotMatch(markup, /alert-action|alert-pill|task-status|status-pill/);
});

test('EngView hosts the pin outside the loading ternary and renders nothing without a pin', () => {
    assert.match(engViewSource, /alertPin &&\s*<AlertPinBar/);
    assert.ok(engViewSource.indexOf('<AlertPinBar') < engViewSource.indexOf('{loading ? ('), 'pin host precedes the loading ternary');
});

test('the pin modifier styles only the pin row and uses the published variables', () => {
    assert.match(alertsCss, /\.alert-story--pinned\s*\{[^}]*top:\s*var\(--alert-pin-top\)/);
    assert.match(alertsCss, /\.alert-story--pinned\s*\{[^}]*height:\s*var\(--alert-pin-height\)/);
    assert.doesNotMatch(alertsCss, /\.alert-story--pinned[^{]*:hover[^{]*\{[^}]*transform/);
});
