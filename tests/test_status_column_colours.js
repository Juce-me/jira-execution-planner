const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const srcRoot = path.join(__dirname, '..', 'frontend', 'src');

async function loadResolver() {
    return import('../frontend/src/issues/statusColumnColours.js');
}

const COLUMNS = [
    { id: 'col-00000001', name: 'Open', colour: '#8c8c8c', statuses: ['To Do'] },
    { id: 'col-00000002', name: 'Doing', colour: '#597ef7', statuses: ['In Progress', 'In Review'] },
    { id: 'col-00000003', name: 'Finished', colour: '#52c41a', statuses: ['Done'] },
];

test('resolveStatusColumnColour returns the colour of the column holding the status', async () => {
    const { resolveStatusColumnColour } = await loadResolver();
    assert.equal(resolveStatusColumnColour(COLUMNS, 'To Do'), '#8c8c8c');
    assert.equal(resolveStatusColumnColour(COLUMNS, 'In Review'), '#597ef7');
    assert.equal(resolveStatusColumnColour(COLUMNS, 'Done'), '#52c41a');
});

test('an unmapped status resolves to null, never to the first column', async () => {
    const { resolveStatusColumnColour } = await loadResolver();
    assert.equal(resolveStatusColumnColour(COLUMNS, 'Analysis'), null);
});

test('missing board, empty columns and malformed shapes resolve to null', async () => {
    const { resolveStatusColumnColour } = await loadResolver();
    for (const columns of [undefined, null, [], 'columns', {}, 7]) {
        assert.equal(resolveStatusColumnColour(columns, 'To Do'), null, String(columns));
    }
    assert.equal(resolveStatusColumnColour([null, { colour: '#8c8c8c', statuses: 'To Do' }, { colour: '#8c8c8c' }], 'To Do'), null);
    assert.equal(resolveStatusColumnColour([null, ...COLUMNS], 'To Do'), '#8c8c8c', 'a null entry is skipped');
});

test('a duplicated status resolves to the first column, and an invalid first colour is not replaced by a later owner', async () => {
    const { resolveStatusColumnColour } = await loadResolver();
    const duplicated = [
        { colour: '#597ef7', statuses: ['In Progress'] },
        { colour: '#ff4d4f', statuses: ['In Progress'] },
    ];
    assert.equal(resolveStatusColumnColour(duplicated, 'In Progress'), '#597ef7');
    const invalidFirst = [
        { colour: '#ffa940', statuses: ['In Progress'] },
        { colour: '#ff4d4f', statuses: ['In Progress'] },
    ];
    assert.equal(resolveStatusColumnColour(invalidFirst, 'In Progress'), null);
});

test('matching is exact: no case folding, no trimming, blank or null status resolves to null', async () => {
    const { resolveStatusColumnColour } = await loadResolver();
    assert.equal(resolveStatusColumnColour(COLUMNS, 'in progress'), null);
    assert.equal(resolveStatusColumnColour(COLUMNS, ' In Progress '), null);
    for (const status of ['', '   ', null, undefined]) {
        assert.equal(resolveStatusColumnColour(COLUMNS, status), null, String(status));
    }
});

test('a colour outside the enum resolves to null instead of the default grey', async () => {
    const { resolveStatusColumnColour } = await loadResolver();
    assert.equal(resolveStatusColumnColour([{ colour: 'red', statuses: ['Done'] }], 'Done'), null);
    assert.equal(resolveStatusColumnColour([{ statuses: ['Done'] }], 'Done'), null);
});

const tintOf = (colour) => `color-mix(in srgb, ${colour} 28%, var(--bg-secondary))`;

test('buildStatusStyle is the filter-popover tint with primary text, one frozen object per colour, undefined for null', async () => {
    const { buildStatusStyle } = await loadResolver();
    const { BOARD_COLUMN_COLOURS } = await import('../frontend/src/settings/groupBoardModel.js');
    for (const colour of BOARD_COLUMN_COLOURS) {
        const style = buildStatusStyle(colour);
        assert.deepEqual({ ...style }, { background: tintOf(colour), color: 'var(--text-primary)' });
        assert.equal(buildStatusStyle(colour), style, 'same object across calls');
        assert.ok(Object.isFrozen(style));
    }
    assert.equal(buildStatusStyle(null), undefined);
    assert.equal(buildStatusStyle('#ffa940'), undefined);
});

test('the primary text on every colour tint is readable (at least 4.5:1) with the theme variables', async () => {
    const { BOARD_COLUMN_COLOURS } = await import('../frontend/src/settings/groupBoardModel.js');
    const shell = require('node:fs').readFileSync(path.join(srcRoot, 'styles', 'shared', 'shell.css'), 'utf8');
    const variable = (name) => shell.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))[1];
    const channels = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const luminance = (rgb) => {
        const [r, g, b] = rgb.map((value) => value / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const base = channels(variable('bg-secondary'));
    const text = luminance(channels(variable('text-primary')));
    for (const colour of BOARD_COLUMN_COLOURS) {
        const mixed = channels(colour).map((value, index) => value * 0.28 + base[index] * 0.72);
        const lighter = Math.max(luminance(mixed), text);
        const darker = Math.min(luminance(mixed), text);
        assert.ok((lighter + 0.05) / (darker + 0.05) >= 4.5, `${colour} tint contrast`);
    }
});

let kitPromise;
function loadKit() {
    kitPromise = kitPromise || esbuild.build({
        stdin: {
            contents: `
                export { default as StatusPill } from './ui/StatusPill.jsx';
                export { StatusColourProvider, useStatusColourStyle } from './issues/StatusColourContext.jsx';
            `,
            resolveDir: srcRoot,
            loader: 'js',
        },
        bundle: true, write: false, format: 'cjs', platform: 'node',
        external: ['react', 'react-dom'], loader: { '.jsx': 'jsx' },
    }).then((result) => {
        const module = { exports: {} };
        new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require);
        return module.exports;
    });
    return kitPromise;
}

const h = React.createElement;

test('StatusPill without a provider is byte-identical with or without the status prop and never emits a status attribute', async () => {
    const { StatusPill } = await loadKit();
    const plain = renderToStaticMarkup(h(StatusPill, { label: 'In Progress', className: 'task-status in-progress' }));
    const withStatus = renderToStaticMarkup(h(StatusPill, { label: 'In Progress', className: 'task-status in-progress', status: 'In Progress' }));
    assert.equal(withStatus, plain);
    assert.doesNotMatch(withStatus, / status=/);
    const button = renderToStaticMarkup(h(StatusPill, { label: 'In Progress', interactive: true, className: 'task-status', 'aria-haspopup': 'menu' }));
    const buttonWithStatus = renderToStaticMarkup(h(StatusPill, { label: 'In Progress', interactive: true, className: 'task-status', 'aria-haspopup': 'menu', status: 'In Progress' }));
    assert.equal(buttonWithStatus, button);
    assert.doesNotMatch(buttonWithStatus, / status=/);
});

test('StatusPill reads the provider for span and button, keeping other attributes', async () => {
    const { StatusPill, StatusColourProvider } = await loadKit();
    const inProvider = (props, enabled = true) => renderToStaticMarkup(
        h(StatusColourProvider, { columns: COLUMNS, enabled }, h(StatusPill, { label: 'In Progress', className: 'task-status', ...props })),
    );
    const span = inProvider({ status: 'In Progress', 'data-x': '1' });
    assert.match(span, /<span[^>]*style="background:color-mix\(in srgb, #597ef7 28%, var\(--bg-secondary\)\);color:var\(--text-primary\)"/);
    assert.match(span, /data-x="1"/);
    const button = inProvider({ status: 'In Progress', interactive: true, disabled: true, 'aria-label': 'Change status', 'data-y': '2' });
    assert.match(button, /<button[^>]*style="background:color-mix\(in srgb, #597ef7 28%, var\(--bg-secondary\)\);color:var\(--text-primary\)"/);
    assert.match(button, /disabled=""/);
    assert.match(button, /aria-label="Change status"/);
    assert.match(button, /data-y="2"/);
    assert.doesNotMatch(button, / status=/);
});

test('StatusPill leaves unmapped statuses, disabled providers and pills without status untouched', async () => {
    const { StatusPill, StatusColourProvider } = await loadKit();
    const render = (props, providerProps) => renderToStaticMarkup(
        h(StatusColourProvider, { columns: COLUMNS, enabled: true, ...providerProps }, h(StatusPill, { label: 'X', className: 'task-status', ...props })),
    );
    assert.doesNotMatch(render({ status: 'Analysis' }), /style=/);
    assert.doesNotMatch(render({ status: 'In Progress' }, { enabled: false }), /style=/);
    assert.doesNotMatch(render({}), /style=/);
});

test('a caller style is kept except for background and color, which the inherited colour wins', async () => {
    const { StatusPill, StatusColourProvider } = await loadKit();
    const markup = renderToStaticMarkup(h(
        StatusColourProvider, { columns: COLUMNS, enabled: true },
        h(StatusPill, { label: 'Done', status: 'Done', style: { background: 'red', color: 'black', margin: '2px' } }),
    ));
    assert.match(markup, /style="background:color-mix\(in srgb, #52c41a 28%, var\(--bg-secondary\)\);color:var\(--text-primary\);margin:2px"/);
    const unmapped = renderToStaticMarkup(h(
        StatusColourProvider, { columns: COLUMNS, enabled: true },
        h(StatusPill, { label: 'Analysis', status: 'Analysis', style: { margin: '2px' } }),
    ));
    assert.match(unmapped, /style="margin:2px"/);
});

test('useStatusColourStyle is a no-op outside a provider and recolours inside one', async () => {
    const { useStatusColourStyle, StatusColourProvider } = await loadKit();
    const seen = [];
    function Probe() {
        seen.push(useStatusColourStyle()('Done'));
        return null;
    }
    renderToStaticMarkup(h(Probe));
    renderToStaticMarkup(h(StatusColourProvider, { columns: COLUMNS, enabled: true }, h(Probe)));
    renderToStaticMarkup(h(StatusColourProvider, { columns: COLUMNS, enabled: false }, h(Probe)));
    renderToStaticMarkup(h(StatusColourProvider, { columns: 'malformed', enabled: true }, h(Probe)));
    assert.deepEqual(seen.map((style) => style && { ...style }), [undefined, { background: tintOf('#52c41a'), color: 'var(--text-primary)' }, undefined, undefined]);
});
