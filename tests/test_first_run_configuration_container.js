const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Server-render probe for FirstRunConfigurationContainer (ST4 R4b): the stateless container returns the first-run
// Department picker and, while a setup choice is staged, the setup-choice dialog, as one fragment. Both children
// are replaced by stubs that record the props they receive, so forwarding is observable. DOM identity with the
// former inline JSX is proved by the Playwright first-run specs, not here.
const containerPath = path.join(__dirname, '../frontend/src/settings/FirstRunConfigurationContainer.jsx');
const source = fs.readFileSync(containerPath, 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '../frontend/src/dashboard.jsx'), 'utf8');
const PROP_NAMES = ['closeFirstRunSetupChoice', 'configureFirstRunGroup', 'continueFirstRunSetupChoice', 'firstRunError', 'firstRunFavoriteGroupId', 'firstRunSaving', 'firstRunSetupChoice', 'groupPreferences', 'groupsConfig', 'openFirstRunSetupChoice', 'saveFirstRunGroupPreferences', 'selectFirstRunFavoriteGroup', 'setFirstRunSetupChoice'];

let containerPromise;
function loadContainer() {
    containerPromise = containerPromise || buildContainer();
    return containerPromise;
}

async function buildContainer() {
    const stubPlugin = {
        name: 'stub-children',
        setup(build) {
            build.onResolve({ filter: /^\.\/(FirstRunGroupSelectionModal|FirstRunGroupSetupChoice)\.jsx$/ }, (args) => ({ path: path.basename(args.path, '.jsx'), namespace: 'stub' }));
            build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
                loader: 'js',
                contents: `const React = require('react');
module.exports = function ${args.path}(props) {
    (globalThis.__stubProps = globalThis.__stubProps || {})['${args.path}'] = props;
    return React.createElement('i', { 'data-stub': '${args.path}' });
};`,
            }));
        },
    };
    const code = (await esbuild.build({
        entryPoints: [containerPath], bundle: true, write: false, format: 'cjs', platform: 'node',
        external: ['react', 'react-dom'], loader: { '.jsx': 'jsx' }, plugins: [stubPlugin],
    })).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports.default;
}

const fn = (name) => Object.assign(() => {}, { displayName: name });
function propsFor(overrides = {}) {
    return {
        closeFirstRunSetupChoice: fn('close'),
        configureFirstRunGroup: fn('configure'),
        continueFirstRunSetupChoice: fn('continue'),
        firstRunError: 'boom',
        firstRunFavoriteGroupId: 'g2',
        firstRunSaving: true,
        firstRunSetupChoice: null,
        groupPreferences: { onboardingDone: false, onboardingRequired: true },
        groupsConfig: { groups: [{ id: 'g1' }, { id: 'g2' }] },
        openFirstRunSetupChoice: fn('open'),
        saveFirstRunGroupPreferences: fn('save'),
        selectFirstRunFavoriteGroup: fn('select'),
        setFirstRunSetupChoice: fn('set'),
        ...overrides,
    };
}

async function render(overrides) {
    const Container = await loadContainer();
    globalThis.__stubProps = {};
    const props = propsFor(overrides);
    const markup = renderToStaticMarkup(React.createElement(Container, props));
    return { markup, stubs: globalThis.__stubProps, props };
}

test('the container takes the 13 documented props and its first parameter is destructured', () => {
    const signature = source.slice(source.indexOf('({\n') + 3, source.indexOf('\n}) {'));
    assert.deepEqual(signature.split('\n').map((line) => line.trim().replace(/,$/, '')), PROP_NAMES);
    assert.ok(source.startsWith("import * as React from 'react';"));
    assert.equal(/\buse[A-Z]\w*\(/.test(source), false, 'the container is stateless: no hook');
});

test('the picker receives the group list, the favorite, the actions and the saving and error state', async () => {
    const { stubs, props } = await render({ firstRunSetupChoice: null });
    const picker = stubs.FirstRunGroupSelectionModal;
    assert.deepEqual(Object.keys(picker), ['groups', 'selectedGroupId', 'onSelectGroup', 'onContinue', 'onAddDepartment', 'onConfigureGroup', 'saving', 'error', 'onboardingDone', 'setupChoiceOpen']);
    assert.equal(picker.groups, props.groupsConfig.groups);
    assert.equal(picker.selectedGroupId, 'g2');
    assert.equal(picker.onSelectGroup, props.selectFirstRunFavoriteGroup);
    assert.equal(picker.onContinue, props.saveFirstRunGroupPreferences);
    assert.equal(picker.onAddDepartment, props.openFirstRunSetupChoice);
    assert.equal(picker.onConfigureGroup, props.configureFirstRunGroup);
    assert.equal(picker.saving, true);
    assert.equal(picker.error, 'boom');
    assert.equal(picker.onboardingDone, false);
    assert.equal(picker.setupChoiceOpen, false);
});

test('a missing group list renders as an empty list and onboardingDone is read from the preferences', async () => {
    const { stubs } = await render({ groupsConfig: {}, groupPreferences: { onboardingDone: true } });
    assert.deepEqual(stubs.FirstRunGroupSelectionModal.groups, []);
    assert.equal(stubs.FirstRunGroupSelectionModal.onboardingDone, true);
});

test('the setup choice renders only while a choice is staged and receives the staged value and its actions', async () => {
    const closed = await render({ firstRunSetupChoice: null });
    assert.equal(closed.stubs.FirstRunGroupSetupChoice, undefined);
    assert.equal(closed.markup, '<i data-stub="FirstRunGroupSelectionModal"></i>');
    const choice = { mode: 'duplicate', sourceGroupId: 'g1', removeTeams: false, removeComponents: false };
    const { stubs, props, markup } = await render({ firstRunSetupChoice: choice });
    const setup = stubs.FirstRunGroupSetupChoice;
    assert.deepEqual(Object.keys(setup), ['groups', 'value', 'onChange', 'onBack', 'onContinue']);
    assert.equal(setup.groups, props.groupsConfig.groups);
    assert.equal(setup.value, choice);
    assert.equal(setup.onChange, props.setFirstRunSetupChoice);
    assert.equal(setup.onBack, props.closeFirstRunSetupChoice);
    assert.equal(setup.onContinue, props.continueFirstRunSetupChoice);
    assert.equal(stubs.FirstRunGroupSelectionModal.setupChoiceOpen, true);
    assert.equal(markup, '<i data-stub="FirstRunGroupSelectionModal"></i><i data-stub="FirstRunGroupSetupChoice"></i>', 'a fragment: sibling elements and no wrapper');
});

test('the dashboard keeps the onboarding and settings-closed wrapper and passes the 13 props explicitly, without a spread', () => {
    const start = dashboardSource.indexOf('{groupPreferences.onboardingRequired && !showGroupManage && (\n');
    assert.notStrictEqual(start, -1);
    const end = dashboardSource.indexOf('/>\n', start);
    const callSource = dashboardSource.slice(start, end);
    assert.match(callSource, /^\{groupPreferences\.onboardingRequired && !showGroupManage && \(\n\s+<FirstRunConfigurationContainer\n/);
    assert.equal(callSource.includes('{...'), false, 'no spread attribute (the interface checker skips elements with one)');
    const attributes = [...callSource.matchAll(/\n\s+(\w+)=\{(\w+)\}/g)];
    assert.deepEqual(attributes.map((match) => match[1]), PROP_NAMES);
    assert.deepEqual(attributes.map((match) => match[2]), PROP_NAMES, 'each prop passes the App binding of the same name');
    assert.equal(dashboardSource.includes('<FirstRunGroupSelectionModal'), false);
    assert.equal(dashboardSource.includes('<FirstRunGroupSetupChoice'), false);
    assert.ok(dashboardSource.indexOf('<FirstRunConfigurationContainer') < dashboardSource.indexOf('<OnboardingTour'), 'the container precedes the unchanged tour');
});
