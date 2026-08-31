const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
    return import('../frontend/src/onboarding/onboardingInteraction.js');
}

function fakeElement({
    id = '',
    tagName = 'DIV',
    attrs = {},
    disabled = false,
    inert = false,
    isConnected = true,
} = {}) {
    const attributes = new Map(Object.entries(attrs));
    const node = {
        id,
        tagName,
        disabled,
        inert,
        isConnected,
        parentElement: null,
        children: [],
        append(...children) {
            children.forEach((child) => {
                child.parentElement = node;
                node.children.push(child);
            });
        },
        hasAttribute(name) {
            return attributes.has(name);
        },
        getAttribute(name) {
            return attributes.has(name) ? attributes.get(name) : null;
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        removeAttribute(name) {
            attributes.delete(name);
        },
    };
    return node;
}

function nativeMenuButton(overrides = {}) {
    return fakeElement({
        tagName: 'BUTTON',
        attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
        ...overrides,
    });
}

test('eligible menu trigger is the exact enabled connected native button with boolean aria-expanded', async () => {
    const { isExactMenuButtonTrigger } = await loadModule();
    const expected = nativeMenuButton();
    const other = nativeMenuButton();

    assert.equal(isExactMenuButtonTrigger(expected, expected), true);
    expected.setAttribute('aria-expanded', 'true');
    assert.equal(isExactMenuButtonTrigger(expected, expected), true);
    assert.equal(isExactMenuButtonTrigger(other, expected), false);
});

test('menu trigger eligibility rejects wrappers, nested children, and non-native controls', async () => {
    const { isExactMenuButtonTrigger } = await loadModule();
    const wrapper = fakeElement({ attrs: { 'aria-expanded': 'false' } });
    const button = nativeMenuButton();
    const nestedChild = fakeElement({ tagName: 'SPAN', attrs: { 'aria-expanded': 'false' } });
    const roleButton = fakeElement({ attrs: { role: 'button', 'aria-expanded': 'false' } });
    const input = fakeElement({ tagName: 'INPUT', attrs: { type: 'button', 'aria-expanded': 'false' } });
    wrapper.append(button);
    button.append(nestedChild);

    assert.equal(isExactMenuButtonTrigger(wrapper, wrapper), false);
    assert.equal(isExactMenuButtonTrigger(nestedChild, nestedChild), false);
    assert.equal(isExactMenuButtonTrigger(roleButton, roleButton), false);
    assert.equal(isExactMenuButtonTrigger(input, input), false);
});

test('menu trigger eligibility rejects disabled, disconnected, and non-boolean expansion states', async () => {
    const { isExactMenuButtonTrigger } = await loadModule();
    const disabled = nativeMenuButton({ disabled: true });
    const ariaDisabled = nativeMenuButton({ attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-disabled': 'true' } });
    const disconnected = nativeMenuButton({ isConnected: false });
    const missingPopup = nativeMenuButton({ attrs: { 'aria-expanded': 'false' } });
    const missingExpanded = nativeMenuButton({ attrs: { 'aria-haspopup': 'menu' } });
    const mixedCaseExpanded = nativeMenuButton({ attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'TRUE' } });
    const invalidExpanded = nativeMenuButton({ attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'open' } });

    [disabled, ariaDisabled, disconnected, missingPopup, missingExpanded, mixedCaseExpanded, invalidExpanded]
        .forEach((node) => assert.equal(isExactMenuButtonTrigger(node, node), false));
    assert.equal(isExactMenuButtonTrigger(null, null), false);
});

test('isolation targets contain each non-path sibling through root and unrelated body containers', async () => {
    const { collectInteractionIsolationTargets } = await loadModule();
    const body = fakeElement({ id: 'body', tagName: 'BODY' });
    const root = fakeElement({ id: 'root' });
    const bodyPortal = fakeElement({ id: 'unrelated-body-portal' });
    const bodyContainer = fakeElement({ id: 'unrelated-body-container' });
    const section = fakeElement({ id: 'section' });
    const sectionSibling = fakeElement({ id: 'section-sibling' });
    const row = fakeElement({ id: 'row' });
    const rowSibling = fakeElement({ id: 'row-sibling' });
    const target = nativeMenuButton({ id: 'target' });
    const targetSibling = fakeElement({ id: 'target-sibling' });
    body.append(root, bodyPortal, bodyContainer);
    root.append(section, sectionSibling);
    section.append(row, rowSibling);
    row.append(target, targetSibling);

    const targets = collectInteractionIsolationTargets({ target, root, body });

    assert.deepEqual(targets.map((node) => node.id), [
        'target-sibling',
        'row-sibling',
        'section-sibling',
        'unrelated-body-portal',
        'unrelated-body-container',
    ]);
    [target, row, section, root, body].forEach((node) => assert.equal(targets.includes(node), false));
});

test('isolation exemptions apply only to the exact coachmark, shields, and owned preview portal', async () => {
    const { collectInteractionIsolationTargets } = await loadModule();
    const body = fakeElement({ tagName: 'BODY' });
    const root = fakeElement({ id: 'root' });
    const target = nativeMenuButton({ id: 'target' });
    const sibling = fakeElement({ id: 'sibling' });
    const coachmark = fakeElement({ id: 'coachmark' });
    const coachmarkChild = fakeElement({ id: 'coachmark-child' });
    const shieldA = fakeElement({ id: 'shield-a' });
    const shieldB = fakeElement({ id: 'shield-b' });
    const ownedPreviewPortal = fakeElement({ id: 'owned-preview' });
    const lookalikePreviewPortal = fakeElement({ id: 'lookalike-preview' });
    body.append(root, coachmark, shieldA, shieldB, ownedPreviewPortal, lookalikePreviewPortal);
    root.append(target, sibling);
    coachmark.append(coachmarkChild);

    const targets = collectInteractionIsolationTargets({
        target,
        root,
        body,
        coachmark,
        shields: [shieldA, shieldB],
        ownedPreviewPortal,
    });

    assert.deepEqual(targets.map((node) => node.id), ['sibling', 'lookalike-preview']);
    assert.equal(targets.includes(coachmarkChild), false);
    assert.equal(targets.includes(ownedPreviewPortal), false);
});

test('suppression snapshots and restores exact attributes and inert property for root and portals', async () => {
    const {
        suppressForInteraction,
        restoreInteractionSuppression,
    } = await loadModule();
    const rootSibling = fakeElement({
        attrs: {
            inert: 'legacy-inert-value',
            'aria-hidden': 'false',
            'aria-describedby': ' before  description ',
        },
        inert: false,
    });
    const portal = fakeElement({
        attrs: {
            'aria-hidden': '',
            'aria-describedby': '',
        },
        inert: true,
    });
    const rootBefore = {
        inertAttribute: rootSibling.getAttribute('inert'),
        inertProperty: rootSibling.inert,
        ariaHidden: rootSibling.getAttribute('aria-hidden'),
        ariaDescribedBy: rootSibling.getAttribute('aria-describedby'),
    };
    const portalBefore = {
        hasInert: portal.hasAttribute('inert'),
        inertProperty: portal.inert,
        ariaHidden: portal.getAttribute('aria-hidden'),
        ariaDescribedBy: portal.getAttribute('aria-describedby'),
    };

    const records = [rootSibling, portal].map(suppressForInteraction);
    assert.equal(rootSibling.inert, true);
    assert.equal(rootSibling.getAttribute('inert'), 'legacy-inert-value');
    assert.equal(rootSibling.getAttribute('aria-hidden'), 'true');
    assert.equal(portal.inert, true);
    assert.equal(portal.getAttribute('inert'), '');
    assert.equal(portal.getAttribute('aria-hidden'), 'true');

    records.slice().reverse().forEach(restoreInteractionSuppression);
    assert.deepEqual({
        inertAttribute: rootSibling.getAttribute('inert'),
        inertProperty: rootSibling.inert,
        ariaHidden: rootSibling.getAttribute('aria-hidden'),
        ariaDescribedBy: rootSibling.getAttribute('aria-describedby'),
    }, rootBefore);
    assert.deepEqual({
        hasInert: portal.hasAttribute('inert'),
        inertProperty: portal.inert,
        ariaHidden: portal.getAttribute('aria-hidden'),
        ariaDescribedBy: portal.getAttribute('aria-describedby'),
    }, portalBefore);
});

test('suppression records distinguish tour-owned changes from pre-existing suppression', async () => {
    const { suppressForInteraction } = await loadModule();
    const unsuppressed = fakeElement();
    const preSuppressed = fakeElement({ attrs: { inert: '', 'aria-hidden': 'true' }, inert: true });

    const owned = suppressForInteraction(unsuppressed).owned;
    const preserved = suppressForInteraction(preSuppressed).owned;

    assert.deepEqual(owned, {
        inertAttribute: true,
        inertProperty: true,
        ariaHidden: true,
    });
    assert.deepEqual(preserved, {
        inertAttribute: false,
        inertProperty: false,
        ariaHidden: false,
    });
});

test('description token helpers append once and remove only the coachmark token', async () => {
    const {
        appendAriaDescribedByToken,
        removeAriaDescribedByToken,
    } = await loadModule();

    assert.equal(appendAriaDescribedByToken(null, 'tour-description'), 'tour-description');
    assert.equal(appendAriaDescribedByToken('field-help error-help', 'tour-description'), 'field-help error-help tour-description');
    assert.equal(appendAriaDescribedByToken('field-help tour-description', 'tour-description'), 'field-help tour-description');
    assert.equal(removeAriaDescribedByToken('field-help tour-description error-help', 'tour-description'), 'field-help error-help');
    assert.equal(removeAriaDescribedByToken('field-help error-help', 'tour-description'), 'field-help error-help');
    assert.equal(removeAriaDescribedByToken('tour-description', 'tour-description'), '');
});
