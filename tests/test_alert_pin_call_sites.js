const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { alertsPanelTree } = require('./share_view_alert_panel_fixture');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngAlertsPanel.jsx'), 'utf8');

// Every row's alert-story-main / alert-story-link / alert-action element, with the handler props it carries.
function collect(node, found = []) {
    if (Array.isArray(node)) { node.forEach(child => collect(child, found)); return found; }
    if (!node || typeof node !== 'object' || !node.props) return found;
    const { className = '' } = node.props;
    if (typeof className === 'string' && /\balert-(story-main|story-link|action)\b/.test(className)) found.push(node);
    collect(node.props.children, found);
    return found;
}

const SECTION_NOTES = {
    'eng-alert-missing': 'Missing info', 'eng-alert-blocked': 'Blocked', 'eng-alert-followup': 'Postponed', 'eng-alert-backlog': 'Backlog',
    'eng-alert-missing-team': 'Missing team', 'eng-alert-missing-labels': 'Missing labels', 'eng-alert-needs-stories': 'Stories required',
    'eng-alert-waiting': 'Waiting', 'eng-alert-empty': 'Empty epic', 'eng-alert-done': 'Ready to close',
};

function fireAll(extra = {}) {
    const pins = [];
    const navigations = [];
    const tree = alertsPanelTree({ overrides: {
        pinAlert: spec => pins.push(spec),
        handleAlertStoryClick: key => navigations.push(key),
        handleStoryRequirementClick: entry => navigations.push(entry.id),
        ...extra,
    } });
    const nodes = collect(tree);
    const results = [];
    for (const node of nodes) {
        for (const handler of ['onClick', 'onKeyDown']) {
            if (typeof node.props[handler] !== 'function') continue;
            const before = pins.length;
            const event = { key: 'Enter', preventDefault() { this.prevented = true; }, stopPropagation() {}, prevented: false };
            node.props[handler](event);
            results.push({ node, handler, event, pins: pins.slice(before) });
        }
    }
    return { results, pins, navigations };
}

test('every alert row interaction that has a handler pins exactly one alert with the card snapshot', () => {
    const { results } = fireAll();
    assert.ok(results.length >= 30, `expected many handlers, found ${results.length}`);
    for (const { node, handler, pins } of results) {
        assert.equal(pins.length, 1, `${node.props.className} ${handler} must pin once`);
        const [pin] = pins;
        assert.equal(pin.note, SECTION_NOTES[pin.sectionId]);
        assert.ok(pin.key && pin.title, 'key and title are set');
    }
});

test('every external alert-action link pins without cancelling the browser navigation', () => {
    // Description (not Story Points) missing renders Fix fields as an external Jira link.
    const overrides = { missingAlertTeams: [{ id: 't1', name: 'Team t1', items: [{ task: { key: 'S-1', fields: { summary: 'Synthetic story S-1' } }, missingFields: ['Description'] }] }] };
    const tree = alertsPanelTree({ overrides: { ...overrides, pinAlert: () => {} } });
    const external = collect(tree).filter(node => node.props.target === '_blank' && /\balert-action\b/.test(node.props.className));
    assert.equal(external.length, 6);
    const { results } = fireAll(overrides);
    for (const node of external) {
        const hit = results.find(result => result.node.props === node.props || result.node.props.href === node.props.href && result.node.props.className === node.props.className);
        assert.ok(hit && hit.handler === 'onClick', `external action has an onClick: ${node.props.href}`);
        assert.equal(hit.event.prevented, false);
        assert.equal(node.props.target, '_blank');
    }
});

test('each of the ten categories pins with its own sectionId, key and kind', () => {
    const { pins } = fireAll();
    const bySection = {};
    for (const pin of pins) (bySection[pin.sectionId] ||= []).push(pin);
    assert.deepEqual(Object.keys(bySection).sort(), Object.keys(SECTION_NOTES).sort());
    const expectedKey = { 'eng-alert-missing': 'S-1', 'eng-alert-blocked': 'S-2', 'eng-alert-followup': ['S-3', 'E-3'], 'eng-alert-backlog': 'E-4',
        'eng-alert-missing-team': 'E-5', 'eng-alert-missing-labels': 'E-6', 'eng-alert-needs-stories': 'E-7', 'eng-alert-waiting': 'E-8',
        'eng-alert-empty': 'E-9', 'eng-alert-done': 'E-10' };
    for (const [section, list] of Object.entries(bySection)) {
        for (const pin of list) {
            assert.ok([].concat(expectedKey[section]).includes(pin.key), `${section} key ${pin.key}`);
            if (section === 'eng-alert-needs-stories') {
                assert.equal(pin.kind, 'requirement');
                assert.equal(pin.identity, 'n1');
            } else {
                assert.equal(pin.kind, 'issue');
                assert.equal(pin.identity, pin.key);
            }
        }
    }
    assert.match(bySection['eng-alert-blocked'][0].title, /^Synthetic story S-2$/);
    assert.match(bySection['eng-alert-done'][0].title, /^Synthetic epic E-10$/);
});

test('dismiss buttons never pin, and the existing navigation still runs after the pin', () => {
    const { navigations } = fireAll();
    assert.ok(navigations.includes('S-2') && navigations.includes('E-3') && navigations.includes('n1'));
    const tree = alertsPanelTree({ overrides: { pinAlert: () => { throw new Error('dismiss pinned'); }, dismissAlertItem: () => {}, dismissStoryRequirement: () => {} } });
    const walk = node => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== 'object' || !node.props) return;
        if (/\balert-remove\b/.test(node.props.className || '')) node.props.onClick({ preventDefault() {}, stopPropagation() {} });
        walk(node.props.children);
    };
    walk(tree);
});

test('source: every alert-story-link, alert-action and Stories-required closure goes through pinFor', () => {
    assert.match(source, /const pinFor = \(/);
    const handlerCalls = source.match(/handleAlertStoryClick\(/g) || [];
    // The only direct calls live in openAlertStory (pins first); every row uses openAlertStory or pinFor.
    assert.equal(handlerCalls.length, 1); // the call in openAlertStory (the destructured prop name is not a call)
    assert.match(source, /const openAlertStory = [^]*?pinFor\(sectionId, key, title\);\s*handleAlertStoryClick\(key, \.\.\.args\);/);
    assert.doesNotMatch(source, /onClick=\{\(\) => handleStoryRequirementClick/);
    const actions = (source.match(/className="alert-action"/g) || []).length;
    const pinnedActions = (source.match(/className="alert-action"[^]*?(?:openAlertStory|pinFor|navigateToStory)\(/g) || []).length;
    assert.equal(actions, 7);
    assert.equal(pinnedActions, actions);
});

// Follow-up 2: nothing looks alert rows up by id any more, so the rows carry no data-alert-id.
test('alert row containers carry no data-alert-id', () => {
    assert.doesNotMatch(source, /data-alert-id/);
});
