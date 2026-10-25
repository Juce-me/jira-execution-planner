const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.join(__dirname, '..');
const engViewSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'eng', 'EngView.jsx'), 'utf8');
const { renderAlertsPanel } = require('./share_view_alert_panel_fixture');
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

// Follow-up 1: the pin carries its category tone and the card header's icon.
const HEADER_LABELS = {
    'eng-alert-missing': 'Missing Info', 'eng-alert-blocked': 'Blocked', 'eng-alert-followup': 'Postponed Work', 'eng-alert-backlog': 'Backlog',
    'eng-alert-missing-team': 'Missing Team', 'eng-alert-missing-labels': 'Missing Labels', 'eng-alert-needs-stories': 'Stories Required',
    'eng-alert-waiting': 'Waiting for Stories', 'eng-alert-empty': 'Empty Epic', 'eng-alert-done': 'Epic Ready to Close',
};
const loadStyles = () => import('../frontend/src/eng/alertPin.js').then(module => module.ALERT_CATEGORY_STYLE);

test('every card header shows the same icon the pin uses for that category', async () => {
    const styles = await loadStyles();
    const markup = renderAlertsPanel();
    const titles = [...markup.matchAll(/<div class="alert-title">([^<]*)<\/div>/g)].map(match => match[1]);
    assert.equal(titles.length, 10);
    for (const [sectionId, label] of Object.entries(HEADER_LABELS)) {
        assert.ok(titles.includes(`${styles[sectionId].icon} ${label}`), `${sectionId}: header "${styles[sectionId].icon} ${label}" in ${titles.join(' | ')}`);
    }
});

test('the pin bar sets its category tone and shows the icon before the category label', async () => {
    const styles = await loadStyles();
    const AlertPinBar = load('AlertPinBar.jsx');
    for (const [sectionId, { tone, icon }] of Object.entries(styles)) {
        const markup = renderToStaticMarkup(React.createElement(AlertPinBar, { pin: { ...pin, sectionId, note: 'Label' }, onBack: () => {}, onClose: () => {} }));
        assert.match(markup, new RegExp(`data-tone="${tone}"`), sectionId);
        assert.match(markup, new RegExp(`<div class="alert-story-note">${icon} Label</div>`), sectionId);
    }
});

test('the pinned modifier styles each tone with the summary pill tint, a left accent and the tone colour on the label only', () => {
    const tints = { blocked: 'rgba(212, 56, 13, 0.1)', missing: 'rgba(250, 140, 22, 0.1)', empty: 'rgba(250, 140, 22, 0.1)', following: 'rgba(99, 102, 241, 0.1)', done: 'rgba(82, 196, 26, 0.1)' };
    for (const [tone, tint] of Object.entries(tints)) {
        const rule = alertsCss.match(new RegExp(`\\.alert-story--pinned\\[data-tone="${tone}"\\][^{]*\\{([^}]*)\\}`));
        assert.ok(rule, `${tone} rule`);
        assert.ok(rule[1].includes(tint), `${tone} tint ${tint}`);
    }
    assert.match(alertsCss, /\.alert-story\.alert-story--pinned\[data-tone\]\s*\{[^}]*box-shadow:\s*inset 3px 0 0 var\(--alert-pin-tone\)/);
    assert.match(alertsCss, /\.alert-story\.alert-story--pinned\[data-tone\]\s*\{[^}]*background:\s*linear-gradient\(var\(--alert-pin-tint\), var\(--alert-pin-tint\)\), var\(--bg-primary\)/);
    assert.match(alertsCss, /\.alert-story--pinned\[data-tone\] > \.alert-story-note\s*\{[^}]*color:\s*var\(--alert-pin-tone\)/);
    assert.doesNotMatch(alertsCss, /\.alert-story--pinned[^{]*\{[^}]*transition:\s*all/);
});

// Follow-up 1: the pin's title is the locate control, built like the list rows' alert-story-main.
function findMain(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const child of node) { const hit = findMain(child); if (hit) return hit; } return null; }
    if (node.props?.className === 'alert-story-main') return node;
    return findMain(node.props?.children);
}

test('the pin title is a button-role main that calls onLocate on click, Enter and Space only', () => {
    const AlertPinBar = load('AlertPinBar.jsx');
    const markup = renderToStaticMarkup(React.createElement(AlertPinBar, { pin, onBack: () => {}, onClose: () => {}, onLocate: () => {} }));
    assert.match(markup, /<div class="alert-story-main" role="button" tabindex="0">/);
    const calls = [];
    const main = findMain(AlertPinBar({ pin, onBack: () => {}, onClose: () => {}, onLocate: () => calls.push('locate') }));
    assert.ok(main, 'alert-story-main found');
    main.props.onClick({});
    for (const key of ['Enter', ' ', 'Tab', 'a']) {
        const event = { key, prevented: false, preventDefault() { this.prevented = true; } };
        main.props.onKeyDown(event);
        assert.equal(event.prevented, key === 'Enter' || key === ' ', `${JSON.stringify(key)} prevented`);
    }
    assert.deepEqual(calls, ['locate', 'locate', 'locate']);
});

test('EngView passes the locate handler to the pin, and the dashboard locates through the block reveal and findPinTarget', () => {
    assert.match(engViewSource, /<AlertPinBar[^>]*onLocate=\{onPinLocate\}/);
    const dashboard = fs.readFileSync(path.join(root, 'frontend', 'src', 'dashboard.jsx'), 'utf8');
    assert.match(dashboard, /const locateAlertPin = \(\) => revealAlertBlock\(alertPin\?\.sectionId, true, \(\) => findPinTarget\(document, alertPin, CSS\.escape\)\);/);
    assert.match(dashboard, /onPinLocate=\{locateAlertPin\}/);
});

// Follow-up 2: the pin is a rounded bordered card like the filter bar card (the app's 10px radius and border, no new value).
test('the pinned modifier is a 10px rounded card with the app border', () => {
    const rule = alertsCss.match(/\.alert-story\.alert-story--pinned\s*\{([^}]*)\}/);
    assert.ok(rule, 'pinned rule');
    assert.match(rule[1], /border:\s*1px solid var\(--border\);/);
    assert.match(rule[1], /border-radius:\s*10px;/);
    assert.match(rule[1], /box-sizing:\s*border-box;/);
});
