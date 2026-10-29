const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { analyzeDashboard, parseRules, readRegistry } = require('../scripts/design_system_css.cjs');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

function load(entry) {
    const code = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'],
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports;
}

const copy = load('frontend/src/shareView/noticeCopy.js');
const ShareViewButton = load('frontend/src/shareView/ShareViewButton.jsx').default;

const LINK_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-share-view-icon="link"><g transform="rotate(-45 12 12)" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 7.5H7a4.5 4.5 0 0 0 0 9h2.5"></path><path d="M14.5 7.5H17a4.5 4.5 0 0 1 0 9h-2.5"></path><path d="M9.5 12h5"></path></g></svg>';
const button = (attributes) => `<button${attributes.disabled ? ' disabled=""' : ''} title="${attributes.title}" aria-label="Copy view link" data-share-view-control="" class="secondary compact header-icon-button" type="button">${LINK_ICON}</button><span class="planning-review-sr-only" role="status"></span>`;
const wrap = (surface, inner) => `<div data-share-view="${surface}">${inner}</div>`;
const defaultMarkup = (surface) => wrap(surface, button({ title: 'Copy view link' }));
const DISABLED_MARKUP = wrap('main', button({ disabled: true, title: 'Sharing is available once the view has loaded' }));
const PARTIAL_MARKUP = wrap('main', `${button({ title: 'Copy view link' })}<div class="jira-export-toast" role="status"><p>Part of this link was not applied: Teams and filters. Everything else was applied.</p><button type="button" class="secondary compact">Dismiss</button></div>`);

const { createShareViewCopyOwner } = load('frontend/src/shareView/useShareViewApply.js');
const fakeShare = (patch = {}) => ({
    copyOwner: createShareViewCopyOwner(),
    notice: null, dismissNotice() {}, captureShareUrl() { return { ok: true, url: 'unused', dropped: [] }; }, shareDisabled: false, applyTerminal: true, ...patch,
});
const render = ({ share, ...props } = {}) => renderToStaticMarkup(React.createElement(ShareViewButton, {
    surface: 'main', sourceSurface: 'catch_up', activeControlSurface: 'main', ...props, share: fakeShare(share),
}));

test('notice copy reads its approved strings and names categories only', () => {
    const { shareViewNoticeMessage, shareViewCopyMessage, shareViewDroppedCategories } = copy;
    const cases = [
        [{ kind: 'dropped', categories: ['group'] }, 'This link was not applied: its Department group is not available to you.'],
        [{ kind: 'dropped', categories: ['sprint'] }, 'This link was not applied: its Sprint is not available to you.'],
        [{ kind: 'dropped', categories: ['sprint', 'group'] }, 'This link was not applied: its Department group and Sprint are not available to you.'],
        [{ kind: 'dropped', categories: [] }, 'This link could not be applied right now, so your view was left as it was.'],
        [{ kind: 'dropped', categories: ['teams'] }, 'This link could not be applied right now, so your view was left as it was.'],
        [{ kind: 'partial', categories: ['teams', 'filters'] }, 'Part of this link was not applied: Teams and filters. Everything else was applied.'],
        [{ kind: 'partial', categories: ['focus', 'filters', 'teams', 'mode', 'bogus'] }, 'Part of this link was not applied: view mode, Teams, filters and highlighted item. Everything else was applied.'],
        [{ kind: 'partial', categories: ['focus'] }, 'Part of this link was not applied: highlighted item. Everything else was applied.'],
        [{ kind: 'partial', categories: [] }, 'Part of this link was not applied. Everything else was applied.'],
        [{ kind: 'invalid', categories: [] }, 'This link is not valid, so it was not applied. Ask the sender to copy it again.'],
        [{ kind: 'newer', categories: [] }, 'This link was made with a newer version of the app, so it was not applied. Update the app and open the link again.'],
        [{ kind: 'unknown', categories: [] }, ''],
        [null, ''],
    ];
    for (const [notice, message] of cases) assert.equal(shareViewNoticeMessage(notice), message, JSON.stringify(notice));

    assert.equal(shareViewCopyMessage({ type: 'copied', dropped: ['find', 'alertTeam', 'sort'] }), 'Link copied, without some details to keep it short: filters and highlighted item.');
    assert.equal(shareViewCopyMessage({ type: 'copied', dropped: [] }), '');
    assert.equal(shareViewCopyMessage({ type: 'manual', dropped: [] }), 'The browser did not allow copying. Select the link below and copy it.');
    assert.equal(shareViewCopyMessage({ type: 'manual', dropped: ['sort'] }), 'The browser did not allow copying. Select the link below and copy it. Left out to keep it short: filters.');
    assert.equal(shareViewCopyMessage({ type: 'refused', reason: 'too_long' }), 'This view has too many selections to fit in one link, so nothing was copied.');
    assert.equal(shareViewCopyMessage({ type: 'refused', reason: 'invalid_state' }), 'This view cannot be shared as a link right now, so nothing was copied.');

    // The encoder's dropped state keys map to notice categories; inherited object keys never do.
    assert.deepEqual(shareViewDroppedCategories(['find', 'focus', 'alerts', 'initiatives', 'sort', 'epic', 'bogus', '__proto__', 'constructor', 'toString']), ['filters', 'focus']);
    assert.deepEqual(shareViewDroppedCategories(undefined), []);

    // No combination of categories can put a value, id, count or URL into a message.
    const categories = ['group', 'sprint', 'mode', 'teams', 'filters', 'focus'];
    for (let mask = 0; mask < 2 ** categories.length; mask += 1) {
        const subset = categories.filter((_, index) => mask & (1 << index));
        for (const kind of ['dropped', 'partial']) {
            assert.match(shareViewNoticeMessage({ kind, categories: subset }), /^[A-Za-z ,.:]+$/);
        }
    }
});

test('ShareViewButton renders the header icon-button contract and compact export warning notice', () => {
    assert.equal(render(), defaultMarkup('main'));
    assert.equal(render({ surface: 'compact', activeControlSurface: 'compact' }), defaultMarkup('compact'));
    assert.equal(render({ share: { shareDisabled: true } }), DISABLED_MARKUP);
    const partial = { notice: { kind: 'partial', categories: ['teams', 'filters'] } };
    assert.equal(render({ share: partial }), PARTIAL_MARKUP);
    // Only the surface that is showing renders the notice.
    assert.equal(render({ activeControlSurface: 'compact', share: partial }), defaultMarkup('main'));
    assert.equal(render({ surface: 'compact', activeControlSurface: 'main', share: partial }), defaultMarkup('compact'));
    const epicMarkup = render({ surface: 'epic', activeControlSurface: 'epic', epicKey: 'PROJ-1', share: partial });
    assert.equal(epicMarkup.includes('jira-export-toast'), false, 'global apply feedback belongs only to the header');
    // An apply result with no copy renders nothing extra.
    assert.equal(render({ share: { notice: { kind: 'unknown', categories: [] } } }), defaultMarkup('main'));
});

test('the dashboard renders the Share control on both header surfaces through one helper, hidden in EPM and Scenario', async () => {
    const source = read('frontend/src/dashboard.jsx');
    assert.ok(source.includes("import ShareViewButton from './shareView/ShareViewButton.jsx';"));
    assert.equal(source.split('renderShareViewControl(').length - 1, 2, 'one call per surface; the definition is an arrow assignment');
    // Scenario hides the control but keeps its slot, so the header's search never shifts when the mode changes.
    assert.ok(source.includes("const renderShareViewControl = (surface) => selectedView === 'eng' && (activeEngMode === 'scenario'"));
    assert.ok(source.includes('? <span className="header-icon-reserve" aria-hidden="true" />'));
    assert.ok(source.includes('<ShareViewButton surface={surface} scopeKey={shareScopeKey} share={shareView} sourceSurface={analyticsToken(activeEngMode)} activeControlSurface={activeControlSurface} />'));

    const actions = source.slice(source.indexOf('className="header-actions-row"'), source.indexOf('className="view-selector"'));
    const searchAt = actions.indexOf("{renderSearchControl('main')}");
    const shareAt = actions.indexOf("{renderShareViewControl('main')}");
    assert.ok(searchAt >= 0 && searchAt < shareAt && shareAt < actions.indexOf('<JiraExportButton'), 'main: Search, Share, Jira export');
    assert.ok(shareAt < actions.indexOf('refresh-icon'), 'main: Share stays before the Refresh and Settings pair');

    const compact = source.slice(source.indexOf('className={`compact-sticky-header ${compactStickyVisible'), source.indexOf('{shouldRenderEngTaskList && !sprintsLoading && <EngFilterControls'));
    assert.ok(compact.indexOf('className="compact-sticky-header-search"') < compact.indexOf("{renderShareViewControl('compact')}"), 'compact: Share follows the Search container');
    assert.equal(compact.slice(compact.indexOf('className="compact-sticky-header-controls"'), compact.indexOf('className="compact-sticky-header-search"')).includes('renderShareViewControl'), false);

    // The analytics surface token the helper passes is always one of the fixed Share enum values.
    const { analyticsToken } = await import('../frontend/src/analytics/dashboardAnalytics.js');
    const { buildShareViewActionParams } = await import('../frontend/src/analytics/dashboardAnalytics.js');
    for (const mode of ['catch-up', 'planning', 'board', 'statistics']) {
        assert.equal(buildShareViewActionParams({ workflowAction: 'copy_link', result: 'success', sourceSurface: analyticsToken(mode) })?.source_surface, analyticsToken(mode), mode);
    }
});

test('Share reuses registered controls and foundation hover with attribute-scoped Epic discovery and notice placement', async () => {
    const current = await analyzeDashboard();
    const controlsFile = 'frontend/src/styles/shared/controls.css';
    // Zero new class hooks: the registered set is untouched and no stylesheet names a Share class.
    assert.deepEqual(current.classHooks, readRegistry().classHooks);
    assert.equal(current.rules.some(rule => /\.share-view/.test(rule.selector)), false, 'no Share class in any selector');

    // The compact surface joins the base and glyph rules of the shared header icon button; both selectors carry identical declarations.
    for (const suffix of ['', ' svg']) {
        const main = current.rules.filter(rule => rule.selector === `.header-actions-row button.header-icon-button${suffix}` && rule.file === controlsFile);
        const compact = current.rules.filter(rule => rule.selector === `.compact-sticky-header button.header-icon-button${suffix}` && rule.file === controlsFile);
        assert.equal(main.length, 1, `main${suffix}`);
        assert.equal(compact.length, 1, `compact${suffix}`);
        assert.deepEqual(compact[0].declarations, main[0].declarations, `compact${suffix} declarations`);
        assert.deepEqual(compact[0].context, main[0].context);
    }
    assert.equal(current.rules.some(rule => rule.selector.includes('.compact-sticky-header button.header-icon-button:hover')), false, 'no copy of the header hover rule');

    // Dependency pin: the compact control gets its hover from the global foundation rule for `button.secondary`, which needs the control
    // to carry `secondary` (IconButton variant) and the foundation rule to stay in place. The header's own hover rule is untouched.
    const source = (file) => parseRules(read(`frontend/src/styles/${file}`), file);
    const foundation = source('eng/controls.css').find(rule => rule.selector === 'button.secondary:hover:where(:enabled):where(:not([aria-disabled="true"]))');
    assert.ok(foundation && foundation.context.some(context => /^@media\s*\(hover:\s*hover\)$/.test(context)));
    assert.deepEqual(foundation.declarations, [{ property: 'box-shadow', value: 'var(--hover-overlay), var(--hover-ring)' }]);
    const headerHover = source('shared/controls.css').filter(rule => rule.selector.includes('.header-actions-row button.header-icon-button:hover'));
    assert.equal(headerHover.length, 1);
    assert.deepEqual(headerHover[0].declarations, [{ property: 'background-image', value: 'none' }, { property: 'box-shadow', value: 'var(--hover-overlay), var(--hover-ring)' }]);

    // Share adds only placement/layout resets; the export surfaces retain their own palette, scale and paint.
    const feedbackRules = current.rules.filter(rule => rule.selector.startsWith('[data-share-view] > :is(.jira-export-menu, .jira-export-toast)'));
    assert.ok(feedbackRules.length >= 3);
    for (const rule of feedbackRules) {
        assert.equal(rule.file, controlsFile);
        for (const declaration of rule.declarations) assert.ok(
            ['width', 'min-width', 'margin'].includes(declaration.property), declaration.property);
    }
    assert.equal(read(controlsFile).includes('server-unavailable-banner'), false, 'Share no longer overrides recovery banners');
    const epicRules = current.rules.filter(rule => rule.selector.includes('data-share-view=epic'));
    assert.ok(epicRules.some(rule => rule.selector.includes('.epic-header:hover')));
    assert.ok(epicRules.some(rule => rule.context.some(context => context.includes('hover: none'))));

    const component = read('frontend/src/shareView/ShareViewButton.jsx');
    for (const required of [
        'variant="secondary compact"', 'className="header-icon-button"', 'data-share-view-control=""', 'data-share-view={surface}',
        'className={notice.url ? "jira-export-menu" : "jira-export-toast"}', 'className="secondary compact"',
        'className="search-input"', 'className="planning-review-sr-only"',
    ]) assert.ok(component.includes(required), required);
    assert.equal(/className="[^"]*share-view/.test(component), false, 'no Share class in the component');
    assert.equal(component.split('navigator.clipboard.writeText').length - 1, 1);
    for (const forbidden of ['window.location', 'history.', 'execCommand', 'console.', 'dangerouslySetInnerHTML', 'dataLayer', 'trackEvent', 'trackProductEvent', 'localStorage']) {
        assert.equal(component.includes(forbidden), false, `ShareViewButton must not use ${forbidden}`);
    }
    assert.ok(component.includes("import { trackShareViewAction } from '../analytics/dashboardAnalytics.js';"));
});

test('the historical mock preserves unchanged header markup and feedback copy', () => {
    const mock = read('assets/mockups/share-view-control-194.html').replaceAll('Copy link to this view', 'Copy view link');
    const fragment = (name) => {
        const match = mock.match(new RegExp(`<!-- fragment:${name} -->([\\s\\S]*?)<!-- /fragment:${name} -->`));
        assert.ok(match, `mock fragment ${name}`);
        return match[1];
    };
    assert.equal(fragment('default'), render(), 'regenerate the mock with tmp/share-view-mock/generate.mjs and re-ask for acceptance if the markup changes');
    assert.equal(fragment('compact'), render({ surface: 'compact', activeControlSurface: 'compact' }));
    assert.equal(fragment('disabled'), render({ share: { shareDisabled: true } }));
    // The operator corrected the historical mock's recovery surface; only its feedback strings still apply.
    const message = (name) => fragment(name).match(/<p>([\s\S]*?)<\/p>/)[1].replace(/&amp;/g, '&');
    assert.equal(message('notice-partial'), copy.shareViewNoticeMessage({ kind: 'partial', categories: ['teams', 'filters'] }));
    assert.equal(message('notice-fallback'), copy.shareViewCopyMessage({ type: 'manual', dropped: ['sort'] }));
    assert.equal(message('notice-copied-dropped'), copy.shareViewCopyMessage({ type: 'copied', dropped: ['find', 'alertTeam'] }));
    assert.ok(mock.includes('id="repo-css"') && mock.includes('--control-height: 38px'), 'the mock inlines the repository stylesheet verbatim');
    // The unchanged header frame and glyph selectors still match the historical mock.
    for (const suffix of ['', ' svg']) {
        assert.ok(mock.includes(`.header-actions-row button.header-icon-button${suffix},\n.compact-sticky-header button.header-icon-button${suffix} {`), `mock selector list${suffix}`);
    }
    assert.equal(mock.includes('.compact-sticky-header button.header-icon-button:hover'), false, 'the mock adds no hover rule');
});

// Exercise the real component's asynchronous closures with the existing hook runtime.
function deferredControl() {
    const { createRuntime } = require('./react_hook_harness');
    const runtime = createRuntime();
    const source = esbuild.buildSync({ entryPoints: [path.join(repoRoot, 'frontend/src/shareView/ShareViewButton.jsx')], bundle: true,
        write: false, format: 'cjs', platform: 'node', external: ['react'] }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', source)(module, module.exports, name => name === 'react' ? { ...React, ...runtime.react } : require(name));
    const pending = [];
    const oldWindow = globalThis.window;
    const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    globalThis.window = { clearTimeout() {}, setTimeout() { return 1; } };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: url => new Promise((resolve, reject) => pending.push({ url, resolve, reject })) } } });
    let props = { surface: 'main', activeControlSurface: 'main', sourceSurface: 'catch_up', share: fakeShare({ captureShareUrl: () => ({ ok: true, url: 'https://example.test/?v=1&find=first', dropped: [] }) }) };
    return {
        pending,
        render(patch = {}) { props = { ...props, ...patch }; runtime.begin(); const tree = module.exports.default(props); runtime.commit(); return tree; },
        unmount: () => runtime.unmount(),
        restore() { globalThis.window = oldWindow; if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else delete globalThis.navigator; },
    };
}
const controlInput = tree => tree.props.children.at(-1)?.props.children[1] || undefined;

test('a deferred clipboard rejection cannot resurrect feedback after its surface hides and returns', async () => {
    const rig = deferredControl();
    try {
        const click = rig.render().props.children[0].props.onClick();
        assert.equal(rig.pending.length, 1, 'capture and clipboard invocation stay synchronous');
        rig.render({ activeControlSurface: 'compact' });
        rig.pending[0].reject(new Error('denied'));
        await click;
        assert.equal(controlInput(rig.render({ activeControlSurface: 'main' })), undefined);
    } finally { rig.unmount(); rig.restore(); }
});

test('a newer copy supersedes older clipboard completions in either order', async () => {
    for (const olderSucceeds of [false, true]) {
        const rig = deferredControl();
        try {
            const first = rig.render().props.children[0].props.onClick();
            const second = rig.render({ share: fakeShare({ captureShareUrl: () => ({ ok: true, url: 'https://example.test/?v=1&find=second', dropped: [] }) }) }).props.children[0].props.onClick();
            rig.pending[1].reject(new Error('second denied'));
            await second;
            if (olderSucceeds) rig.pending[0].resolve(); else rig.pending[0].reject(new Error('first denied'));
            await first;
            assert.equal(controlInput(rig.render()).props.value, 'https://example.test/?v=1&find=second');
        } finally { rig.unmount(); rig.restore(); }
    }
});

test('an unmounted copy ignores a deferred clipboard completion', async () => {
    const rig = deferredControl();
    try {
        const click = rig.render().props.children[0].props.onClick();
        rig.unmount();
        rig.pending[0].reject(new Error('denied'));
        await click;
        assert.equal(controlInput(rig.render()), undefined);
    } finally { rig.restore(); }
});

test('a new refused copy clears the previous copied indicator when it supersedes its timer', async () => {
    const rig = deferredControl();
    try {
        const copied = rig.render().props.children[0].props.onClick();
        rig.pending[0].resolve();
        await copied;
        assert.equal(rig.render().props.children[1].props.children, 'View link copied');
        await rig.render({ share: fakeShare({ captureShareUrl: () => ({ ok: false, reason: 'too_long' }) }) }).props.children[0].props.onClick();
        assert.equal(rig.render().props.children[1].props.children, '');
    } finally { rig.unmount(); rig.restore(); }
});

test('Epic copy feedback ignores stale scope and target completions', async () => {
    for (const succeeds of [false, true]) for (const patch of [{ scopeKey: 'group-b:42' }, { epicKey: 'PROJ-2' }, { sourceSurface: 'planning' }]) {
        const rig = deferredControl();
        try {
            const tree = rig.render({ surface: 'epic', activeControlSurface: 'epic', epicKey: 'PROJ-1', scopeKey: 'group-a:41' });
            assert.match(tree.props.children[0].props['aria-label'], /PROJ-1/);
            const click = tree.props.children[0].props.onClick();
            rig.render(patch);
            if (succeeds) rig.pending[0].resolve(); else rig.pending[0].reject(new Error('denied'));
            await click;
            const current = rig.render();
            assert.equal(controlInput(current), undefined);
            assert.equal(current.props.children[1].props.children, '');
        } finally { rig.unmount(); rig.restore(); }
    }
});

test('the shared control captures an explicit Epic synchronously and names its successful destination', async () => {
    const rig = deferredControl();
    let captured;
    try {
        const share = fakeShare({ captureShareUrl: focus => { captured = focus; return { ok: true, url: 'https://example.test/?v=1&epic=PROJ-1', dropped: [] }; } });
        const click = rig.render({ surface: 'epic', activeControlSurface: 'epic', epicKey: 'PROJ-1', share }).props.children[0].props.onClick();
        assert.deepEqual(captured, { kind: 'epic', key: 'PROJ-1' });
        assert.equal(rig.pending.length, 1);
        rig.pending[0].resolve(); await click;
        assert.equal(rig.render().props.children[1].props.children, 'Epic PROJ-1 link copied');
    } finally { rig.unmount(); rig.restore(); }
});

test('a Story row control captures a Story target and names it in its label and destination', async () => {
    const rig = deferredControl();
    let captured;
    try {
        const share = fakeShare({ captureShareUrl: focus => { captured = focus; return { ok: true, url: 'https://example.test/?v=1&story=PROJ-11', dropped: [] }; } });
        const tree = rig.render({ surface: 'epic', activeControlSurface: 'epic', epicKey: 'PROJ-11', issueKind: 'story', share });
        assert.equal(tree.props.children[0].props['aria-label'], 'Copy link to Story PROJ-11');
        const click = tree.props.children[0].props.onClick();
        assert.deepEqual(captured, { kind: 'story', key: 'PROJ-11' });
        rig.pending[0].resolve(); await click;
        assert.equal(rig.render().props.children[1].props.children, 'Story PROJ-11 link copied');
    } finally { rig.unmount(); rig.restore(); }
});

test('ordinary clipboard success announces its destination without rendering a feedback surface', async () => {
    for (const epicKey of [undefined, 'PROJ-1']) {
        const rig = deferredControl();
        try {
            const click = rig.render(epicKey ? { surface: 'epic', activeControlSurface: 'epic', epicKey } : {}).props.children[0].props.onClick();
            rig.pending[0].resolve();
            await click;
            const tree = rig.render();
            assert.equal(tree.props.children[1].props.children, epicKey ? 'Epic PROJ-1 link copied' : 'View link copied');
            assert.equal(Boolean(tree.props.children.at(-1)), false, 'ordinary success must not render a popup, warning or Dismiss');
        } finally { rig.unmount(); rig.restore(); }
    }
});

test('every alert group label is its own copy-link control for its card anchor, with no separate icon', () => {
    const panel = read('frontend/src/eng/EngAlertsPanel.jsx');
    const anchors = [...panel.matchAll(/renderTeamCount\('(\w+)', group, /g)].map(match => match[1]);
    assert.deepEqual(anchors.sort(), ['backlog', 'blocked', 'done', 'empty', 'followup', 'followupEpics', 'missing', 'missingLabels', 'missingTeam', 'needsStories', 'waiting'].sort());
    assert.equal((panel.match(/<div className="alert-team-header">/g) || []).length, anchors.length, 'no group header is left without it');
    assert.equal(panel.includes('renderAlertShareControl?.(\'') , false, 'the control is rendered only through the label helper, never as a sibling icon');
    assert.match(panel, /const renderTeamCount = \(anchor, group, text\) => renderAlertShareControl\?\.\(anchor, group, text\) \|\| <span>\{text\}<\/span>;/);
    assert.match(read('frontend/src/dashboard.jsx'), /renderAlertShareControl = \(anchor, group, labelText\)[\s\S]*?labelText=\{labelText\}/);
});

test('ShareViewButton with labelText renders the count text as the only control', () => {
    const markup = render({ surface: 'epic', activeControlSurface: 'epic', alertTarget: { anchor: 'blocked', id: 't1' }, labelText: '2 stories blocked' });
    assert.match(markup, /<button type="button" class="alert-team-count"[^>]*aria-label="Copy link to this alert group: 2 stories blocked"[^>]*>2 stories blocked<\/button>/);
    assert.equal((markup.match(/<button/g) || []).length, 1);
    assert.equal(markup.includes('data-share-view-icon="link"'), false, 'no link icon beside the label');
});
