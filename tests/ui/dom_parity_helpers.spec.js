const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { captureDomParity } = require('./dom_parity_helpers');

let originalCaptureDir;
test.beforeEach(({}, testInfo) => {
    originalCaptureDir = process.env.JEP_DOM_PARITY_DIR;
    process.env.JEP_DOM_PARITY_DIR = testInfo.outputPath('dom-captures');
});
test.afterEach(() => {
    if (originalCaptureDir === undefined) delete process.env.JEP_DOM_PARITY_DIR;
    else process.env.JEP_DOM_PARITY_DIR = originalCaptureDir;
});

const destination = label => path.join(process.env.JEP_DOM_PARITY_DIR, `${label}.html`);
const snapshot = label => fs.readFileSync(destination(label), 'utf8');
async function capture(page, html, label) {
    await page.setContent(html);
    await captureDomParity(page, label, '#root');
    return snapshot(label);
}
async function rejectCapture(page, html, label, message) {
    await page.setContent(html);
    await expect(captureDomParity(page, label, '#root')).rejects.toThrow(message);
    expect(fs.existsSync(destination(label))).toBe(false);
}

function idFixture(first, second) {
    return `<section id="root"><label for="${first}">First</label><input id="${first}"><label for="${second}">Second</label><input id="${second}"><button aria-describedby="${first} ${second}">Action</button></section>`;
}

test('parity control: valid React ID renumbering preserves distinct identities', async ({ page }) => {
    const before = await capture(page, idFixture('_r_1_', '_r_2_'), 'before');
    const after = await capture(page, idFixture('_r_a_', '_r_b_'), 'after');
    expect(after).toBe(before);
    expect(before).toContain('id="_r_parity_0_"');
    expect(before).toContain('id="_r_parity_1_"');
});

test('parity control: repeated reference tokens retain order and multiplicity', async ({ page }) => {
    const html = await capture(page, '<section id="root"><span id="_r_1_">A</span><span id="_r_2_">B</span><button aria-labelledby="_r_1_ _r_2_ _r_1_">Action</button></section>', 'repeated');
    expect(html).toContain('aria-labelledby="_r_parity_0_ _r_parity_1_ _r_parity_0_"');
});

test('parity control: changing a reference to another existing target changes the capture', async ({ page }) => {
    const first = '<section id="root"><span id="_r_1_">A</span><span id="_r_2_">B</span><button aria-describedby="_r_1_">Action</button></section>';
    const before = await capture(page, first, 'before');
    const after = await capture(page, first.replace('aria-describedby="_r_1_"', 'aria-describedby="_r_2_"'), 'after');
    expect(after).not.toBe(before);
});

test('parity control: dangling identity references fail before writing', async ({ page }) => {
    for (const attribute of ['aria-describedby', 'aria-controls', 'for', 'headers', 'list', 'form']) {
        await rejectCapture(page, `<section id="root"><span ${attribute}="missing">Value</span></section>`, attribute, `dangling ${attribute}: missing`);
    }
});

test('parity control: duplicate captured IDs fail before writing', async ({ page }) => {
    await rejectCapture(page, '<section id="root"><span id="repeated">A</span><span id="repeated">B</span></section>', 'duplicate-id', 'duplicate id in capture: repeated');
});

test('parity control: unique external targets are normalized from the live document', async ({ page }) => {
    const before = await capture(page, '<span id="_r_1_">External</span><section id="root"><input aria-describedby="_r_1_"></section>', 'before');
    const after = await capture(page, '<span id="_r_z_">External</span><section id="root"><input aria-describedby="_r_z_"></section>', 'after');
    expect(after).toBe(before);
    expect(before).toContain('aria-describedby="_r_parity_0_"');
});

test('parity control: duplicate external targets fail before writing', async ({ page }) => {
    await rejectCapture(page, '<span id="external">A</span><span id="external">B</span><section id="root"><input aria-describedby="external"></section>', 'duplicate-external', 'duplicate aria-describedby target: external');
});

test('parity control: live form values, checked state and user text remain significant', async ({ page }) => {
    await page.setContent('<section id="root"><input id="text" value="initial"><input id="check" type="checkbox"><textarea>initial</textarea><select><option value="a">A</option><option value="b">B</option></select><p class="user-_r_a_">_r_a_ fetched 12:34 PM</p></section>');
    await page.locator('#text').fill('_r_b_ fetched 09:10 AM');
    await page.locator('#check').check();
    await page.locator('textarea').fill('edited text');
    await page.locator('select').selectOption('b');
    await captureDomParity(page, 'edited', '#root');
    const before = snapshot('edited');
    expect(before).toContain('data-parity-value="_r_b_ fetched 09:10 AM"');
    expect(before).toContain('data-parity-checked="true"');
    expect(before).toContain('data-parity-value="edited text"');
    expect(before).toContain('data-parity-value="b"');
    expect(before).toContain('_r_a_ fetched 12:34 PM');
    expect(before).toContain('class="user-_r_a_"');
    await page.locator('p').evaluate(node => { node.className = 'changed-class'; });
    await captureDomParity(page, 'changed-class', '#root');
    expect(snapshot('changed-class')).not.toBe(before);
    await page.locator('#text').fill('changed');
    await captureDomParity(page, 'changed', '#root');
    expect(snapshot('changed')).not.toBe(before);
});

test('parity control: opt-in disabled is a no-op without reading the page or writing', async () => {
    const dir = process.env.JEP_DOM_PARITY_DIR;
    delete process.env.JEP_DOM_PARITY_DIR;
    await captureDomParity({ locator() { throw new Error('disabled capture read the page'); } }, 'disabled', '#missing');
    expect(fs.existsSync(dir)).toBe(false);
});

test('parity control: duplicate labels reject without replacing the first file', async ({ page }) => {
    const first = await capture(page, '<section id="root"><input value="retained draft"></section>', 'same-label');
    await page.setContent('<section id="root">replacement</section>');
    await expect(captureDomParity(page, 'same-label', '#root')).rejects.toThrow('duplicate label or nonempty capture directory');
    expect(snapshot('same-label')).toBe(first);
    await page.setContent('<div class="group-modal"><input value="retained auth draft"></div><section role="alertdialog">Sign in again</section>');
    await captureDomParity(page, 'auth-expired-draft', '.group-modal');
    await captureDomParity(page, 'auth-expired-recovery', '[role="alertdialog"]');
    expect(snapshot('auth-expired-draft')).toContain('data-parity-value="retained auth draft"');
    expect(snapshot('auth-expired-recovery')).toContain('Sign in again');
    expect(snapshot('auth-expired-draft')).not.toBe(snapshot('auth-expired-recovery'));
    expect(fs.readdirSync(process.env.JEP_DOM_PARITY_DIR).sort()).toEqual(['auth-expired-draft.html', 'auth-expired-recovery.html', 'same-label.html']);
});

function tabsFixture(label = 'Admin settings sections', prefix = 'admin-settings', selectedPanel = true) {
    return `<section id="root"><div role="tablist" aria-label="${label}"><button id="${prefix}-scope-tab" role="tab" aria-selected="true" aria-controls="${prefix}-scope-panel">Scope</button><button id="${prefix}-source-tab" role="tab" aria-selected="false" aria-controls="${prefix}-source-panel">Source</button></div>${selectedPanel ? `<div id="${prefix}-scope-panel" role="tabpanel">Scope form</div>` : ''}</section>`;
}

test('parity control: only exact known inactive tab and panel pairs may be deferred', async ({ page }) => {
    const admin = await capture(page, tabsFixture(), 'admin');
    expect(admin).toContain('aria-controls="admin-settings-source-panel"');
    const department = tabsFixture('Departments settings sections', 'department-settings').replaceAll('-scope-', '-teams-').replaceAll('-source-', '-labels-');
    await capture(page, department, 'departments');
    const epm = tabsFixture('EPM settings sections', 'epm-settings').replaceAll('-source-', '-projects-');
    await capture(page, epm, 'epm');
});

test('parity control: unknown deferred pairs and missing selected panels fail', async ({ page }) => {
    await rejectCapture(page, tabsFixture('Unknown sections'), 'unknown-strip', 'dangling aria-controls');
    await rejectCapture(page, tabsFixture().replace('admin-settings-source-panel', 'admin-settings-unknown-panel'), 'unknown-pair', 'dangling aria-controls');
    await rejectCapture(page, tabsFixture('Admin settings sections', 'admin-settings', false), 'missing-selected', 'dangling aria-controls');
    await rejectCapture(page, tabsFixture().replace('role="tabpanel"', 'role="region"'), 'wrong-selected-role', 'dangling aria-controls');
});

test('parity control: clock normalization is scoped to the exact app-owned readout', async ({ page }) => {
    const html = '<section id="root"><div id="epm-settings-projects-panel"><div class="epm-projects-header-actions"><span class="group-modal-meta" aria-live="polite">3 projects · fetched 10:11 PM<span>fetched 09:12 PM</span></span><span class="group-modal-meta">fetched 07:08 PM</span></div></div><p class="group-modal-meta" aria-live="polite">fetched 05:06 PM</p><input value="fetched 03:04 PM"></section>';
    const before = await capture(page, html, 'before');
    const after = await capture(page, html.replace('fetched 10:11 PM', 'fetched 12:13 PM'), 'after');
    expect(after).toBe(before);
    expect(before).toContain('fetched HH:MM');
    for (const retained of ['fetched 09:12 PM', 'fetched 07:08 PM', 'fetched 05:06 PM', 'fetched 03:04 PM']) expect(before).toContain(retained);
    const changed = await capture(page, html.replace('fetched 05:06 PM', 'fetched 08:09 PM'), 'changed-outside-readout');
    expect(changed).not.toBe(before);
});
