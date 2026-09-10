const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { appBaseUrl, installDashboardShell } = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const screenshotDir = path.join(repoRoot, 'tmp', 'eng-issue-field-edits');
let harnessJs;
let dashboardCss;

test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
    harnessJs = esbuild.buildSync({
        stdin: {
            sourcefile: 'issue-field-editor-harness.jsx',
            resolveDir: repoRoot,
            loader: 'jsx',
            contents: `
                import * as React from 'react';
                import { createRoot } from 'react-dom/client';
                import IssuePersonEditor from './frontend/src/issues/IssuePersonEditor.jsx';
                import StoryPointsEditor from './frontend/src/issues/StoryPointsEditor.jsx';

                const people = [
                    { accountId: 'self', displayName: 'Current Person', eligibility: 'eligible' },
                    { accountId: 'inactive', displayName: 'Inactive Person', eligibility: 'ineligible', reason: 'inactive' },
                    { accountId: 'unverified', displayName: 'A Very Long Unverified Delivery Owner Name That Must Stay Inside The Popover', emailAddress: 'visible@example.test', eligibility: 'unverified' },
                    { accountId: 'eligible', displayName: 'Eligible Person', eligibility: 'eligible' },
                ];

                function Harness() {
                    const [personOpen, setPersonOpen] = React.useState(false);
                    const [pointsOpen, setPointsOpen] = React.useState(false);
                    const [query, setQuery] = React.useState('');
                    const [personSubmits, setPersonSubmits] = React.useState([]);
                    const [pointSubmits, setPointSubmits] = React.useState([]);
                    const [points, setPoints] = React.useState(0);
                    const [personEditable, setPersonEditable] = React.useState(true);
                    const [pointsEditable, setPointsEditable] = React.useState(true);
                    const [personSubmitting, setPersonSubmitting] = React.useState(false);
                    const [pointsSubmitting, setPointsSubmitting] = React.useState(false);
                    const [personError, setPersonError] = React.useState('');
                    const [pointsError, setPointsError] = React.useState('');
                    const [personRecovery, setPersonRecovery] = React.useState('');
                    const [pointsRecovery, setPointsRecovery] = React.useState('');
                    const [configurationChanged, setConfigurationChanged] = React.useState(false);
                    const [recoveryCalls, setRecoveryCalls] = React.useState([]);
                    const metadata = {
                        editable: personEditable,
                        currentValue: { accountId: 'owner', displayName: 'Existing Owner' },
                        me: people[0],
                        mappingRevision: 'synthetic-revision',
                    };
                    window.__issueEditorHarness = { personSubmits, pointSubmits, recoveryCalls, setPersonOpen, setPointsOpen, setPoints, setPersonEditable, setPointsEditable, setPersonSubmitting, setPointsSubmitting, setPersonError, setPointsError, setPersonRecovery, setPointsRecovery, setConfigurationChanged };
                    return <main style={{ minHeight: '1200px', padding: '24px' }}>
                        <button id="outside-target" type="button">Outside target</button>
                        <div style={{ position: 'fixed', right: '2px', bottom: '2px', display: 'flex', gap: '8px' }}>
                            <IssuePersonEditor
                                issueKey="DEMO-1"
                                field="assignee"
                                fieldLabel="Assignee"
                                currentValue={{ accountId: 'owner', displayName: 'Existing Owner' }}
                                isOpen={personOpen}
                                metadata={metadata}
                                suggestions={query.trim() === 'zzz' ? [] : (query.trim().length >= 3 ? people : [people[0]])}
                                query={query}
                                onOpen={() => setPersonOpen(true)}
                                onClose={() => setPersonOpen(false)}
                                onSearch={setQuery}
                                onSelect={(person) => setPersonSubmits(values => [...values, person.accountId])}
                                submitting={personSubmitting}
                                error={personError}
                                recoveryMode={personRecovery}
                                configurationChanged={configurationChanged}
                                jiraUrl="https://jira.example"
                                onReload={async () => { setRecoveryCalls(values => [...values, 'reload']); setPersonRecovery(''); }}
                                onCheckJira={async () => { setRecoveryCalls(values => [...values, 'check-person']); setConfigurationChanged(true); }}
                                triggerClassName="task-assignee"
                                useVisualViewport
                            />
                            <StoryPointsEditor
                                issueKey="DEMO-2"
                                currentValue={points}
                                isOpen={pointsOpen}
                                metadata={{ editable: pointsEditable, currentValue: points, mappingRevision: 'synthetic-revision' }}
                                onOpen={() => setPointsOpen(true)}
                                onClose={() => setPointsOpen(false)}
                                onSubmit={(value) => { setPointSubmits(values => [...values, value]); setPoints(value); return { value }; }}
                                submitting={pointsSubmitting}
                                error={pointsError}
                                recoveryMode={pointsRecovery}
                                configurationChanged={configurationChanged}
                                jiraUrl="https://jira.example"
                                onReload={async () => { setRecoveryCalls(values => [...values, 'reload-points']); setPointsRecovery(''); }}
                                onCheckJira={async () => { setRecoveryCalls(values => [...values, 'check-points']); setConfigurationChanged(true); }}
                                triggerClassName="task-inline-sp"
                                useVisualViewport
                            />
                        </div>
                    </main>;
                }
                createRoot(document.getElementById('root')).render(<Harness />);
            `,
        },
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
    dashboardCss = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css')],
        bundle: true,
        write: false,
    }).outputFiles[0].text;
});

async function mountHarness(page, viewport) {
    await page.setViewportSize(viewport);
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: harnessJs,
    }));
    await page.route('**/frontend/dist/dashboard.css', route => route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: dashboardCss,
    }));
    await page.goto(appBaseUrl);
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
}

async function expectInsideViewport(locator, viewport) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(7);
    expect(box.y).toBeGreaterThanOrEqual(7);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`person combobox is bounded and keyboard accessible at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await mountHarness(page, viewport);
        await page.evaluate(() => {
            const viewportApi = window.visualViewport;
            window.__visualViewportListeners = { added: 0, removed: 0 };
            if (!viewportApi) return;
            const add = viewportApi.addEventListener.bind(viewportApi);
            const remove = viewportApi.removeEventListener.bind(viewportApi);
            viewportApi.addEventListener = (type, listener, options) => {
                if (type === 'resize' || type === 'scroll') window.__visualViewportListeners.added += 1;
                return add(type, listener, options);
            };
            viewportApi.removeEventListener = (type, listener, options) => {
                if (type === 'resize' || type === 'scroll') window.__visualViewportListeners.removed += 1;
                return remove(type, listener, options);
            };
        });
        const trigger = page.getByRole('combobox', { name: 'Assignee: Existing Owner' });
        const closedTriggerHeight = await trigger.evaluate(element => element.getBoundingClientRect().height);
        await trigger.click();
        const input = page.getByRole('combobox', { name: 'Search Assignee' });
        await expect(page.locator('.issue-person-editor-menu .component-search-input')).toHaveCount(0);
        await expect(input).toBeFocused();
        await expect(input).toBeEditable();
        await expect(input).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByRole('option', { name: /Current Person/ })).toBeVisible();
        await expect(page.getByText(/Type at least 3 characters/)).toBeVisible();
        await expectInsideViewport(page.locator('.issue-person-editor-menu'), viewport);
        expect(await input.evaluate(element => element.getBoundingClientRect().height)).toBe(closedTriggerHeight);

        await input.fill('zzz');
        await expect(page.getByText(/No people found/)).toBeVisible();

        await input.fill('ali');
        await expect(page.getByRole('option', { name: /Inactive Person/ })).toBeDisabled();
        await input.press('ArrowDown');
        const unverifiedId = await page.getByRole('option', { name: /Long Unverified/ }).getAttribute('id');
        await expect(input).toHaveAttribute('aria-activedescendant', unverifiedId);
        await page.screenshot({ path: path.join(screenshotDir, `person-after-${viewport.width}x${viewport.height}.png`) });
        await input.press('Enter');
        await input.press('Enter');
        await expect.poll(() => page.evaluate(() => window.__issueEditorHarness.personSubmits)).toEqual(['unverified']);

        await page.evaluate(() => window.__issueEditorHarness.setPersonOpen(true));
        await expect(input).toBeFocused();
        await input.press('Escape');
        await expect(page.getByRole('combobox', { name: 'Assignee: Existing Owner' })).toBeFocused();
        await page.getByRole('combobox', { name: 'Assignee: Existing Owner' }).click();
        await page.getByRole('button', { name: 'Outside target' }).click();
        await expect(page.locator('.issue-person-editor-menu')).toHaveCount(0);
        await expect(page.getByRole('combobox', { name: 'Assignee: Existing Owner' })).toBeFocused();
        await expect.poll(() => page.evaluate(() => {
            const counts = window.__visualViewportListeners;
            return counts.added > 0 && counts.added === counts.removed;
        })).toBe(true);
    });
}

test('story points stays inline, rejects blank, saves Enter once, and discards on blur', async ({ page }) => {
    await mountHarness(page, { width: 390, height: 844 });
    const input = page.getByRole('textbox', { name: 'Story Points' });
    await expect(page.getByRole('dialog', { name: 'Edit Story Points' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save Story Points' })).toHaveCount(0);
    await input.click();
    await expect(input).toBeFocused();
    await expect(input).toBeEditable();
    await expect(input).toHaveValue('0');
    await expect(input).toHaveCSS('min-width', '23px');
    expect(await input.evaluate(element => {
        const inputStyle = getComputedStyle(element);
        const slotStyle = getComputedStyle(element.parentElement);
        return ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']
            .every(property => inputStyle[property] === slotStyle[property]);
    })).toBe(true);
    await input.fill('');
    await input.press('Enter');
    await expect(page.locator('.story-points-editor-feedback')).toContainText('non-negative number');
    expect(await page.evaluate(() => window.__issueEditorHarness.pointSubmits)).toEqual([]);

    await input.fill('2.0');
    await input.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__issueEditorHarness.pointSubmits)).toEqual([2]);
    await expect(input).toHaveValue('2');

    await input.click();
    await expect(input).toBeEditable();
    await input.fill('2');
    await input.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__issueEditorHarness.pointSubmits)).toEqual([2]);

    await input.click();
    await input.fill('3');
    await page.getByRole('button', { name: 'Outside target' }).click();
    await expect(input).toHaveValue('2');
    expect(await page.evaluate(() => window.__issueEditorHarness.pointSubmits)).toEqual([2]);
});

test('missing Jira Story Points render as 0 in the inline input', async ({ page }) => {
    await mountHarness(page, { width: 390, height: 844 });
    await page.evaluate(() => window.__issueEditorHarness.setPoints(null));
    const input = page.getByRole('textbox', { name: 'Story Points' });
    const unit = page.locator('.story-points-editor-unit');
    await expect(input).toHaveValue('0');
    await expect(unit).toHaveText('SP');
    await expect(unit).toHaveCSS('margin-left', '2px');
    expect(await unit.evaluate(element => getComputedStyle(element).color))
        .not.toBe(await input.evaluate(element => getComputedStyle(element).color));
    await page.screenshot({ path: path.join(screenshotDir, 'story-points-unit-390x844.png') });
});

test('editors fail closed before editable metadata and allow retry after a rejected save', async ({ page }) => {
    await mountHarness(page, { width: 390, height: 844 });
    await page.evaluate(() => {
        window.__issueEditorHarness.setPersonEditable(false);
        window.__issueEditorHarness.setPointsEditable(false);
        window.__issueEditorHarness.setPersonOpen(true);
    });
    const personInput = page.getByRole('combobox', { name: 'Search Assignee' });
    await expect(personInput).toBeDisabled();
    await expect(page.getByRole('option', { name: /Current Person/ })).toBeDisabled();
    expect(await page.evaluate(() => window.__issueEditorHarness.personSubmits)).toEqual([]);

    await page.evaluate(() => window.__issueEditorHarness.setPersonEditable(true));
    await expect(personInput).toBeEnabled();
    await personInput.fill('ali');
    await page.getByRole('option', { name: /Eligible Person/ }).click();
    await expect.poll(() => page.evaluate(() => window.__issueEditorHarness.personSubmits)).toEqual(['eligible']);
    await page.evaluate(() => {
        window.__issueEditorHarness.setPersonSubmitting(true);
        window.__issueEditorHarness.setPersonSubmitting(false);
        window.__issueEditorHarness.setPersonError('Jira rejected this field value.');
    });
    await page.getByRole('option', { name: /Long Unverified/ }).click();
    await expect.poll(() => page.evaluate(() => window.__issueEditorHarness.personSubmits)).toEqual(['eligible', 'unverified']);

    await page.evaluate(() => window.__issueEditorHarness.setPointsOpen(true));
    const pointsInput = page.getByRole('textbox', { name: 'Story Points' });
    await expect(pointsInput).toHaveAttribute('readonly', '');
    await page.evaluate(() => window.__issueEditorHarness.setPointsEditable(true));
    await expect(pointsInput).toBeEditable();
    await pointsInput.fill('3');
    await pointsInput.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__issueEditorHarness.pointSubmits)).toEqual([3]);
    await page.evaluate(() => {
        window.__issueEditorHarness.setPointsOpen(true);
        window.__issueEditorHarness.setPointsSubmitting(true);
        window.__issueEditorHarness.setPointsSubmitting(false);
        window.__issueEditorHarness.setPointsError('Jira rejected this field value.');
    });
    await expect(pointsInput).toBeEditable();
    await pointsInput.fill('4');
    await pointsInput.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__issueEditorHarness.pointSubmits)).toEqual([3, 4]);
});

test('person recovery stays explicit while inline Story Points recovery runs without extra controls', async ({ page }) => {
    await mountHarness(page, { width: 390, height: 844 });
    await page.evaluate(() => {
        window.__issueEditorHarness.setPersonOpen(true);
        window.__issueEditorHarness.setPersonError('This field changed in Jira.');
        window.__issueEditorHarness.setPersonRecovery('reload');
    });
    const personInput = page.getByRole('combobox', { name: 'Search Assignee' });
    await expect(personInput).toBeDisabled();
    const personOption = page.getByRole('option', { name: /Current Person/ });
    await expect(personOption).toBeDisabled();
    await personOption.dispatchEvent('click');
    expect(await page.evaluate(() => window.__issueEditorHarness.personSubmits)).toEqual([]);
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect.poll(() => page.evaluate(() => window.__issueEditorHarness.recoveryCalls)).toEqual(['reload']);
    await expect(personInput).toBeFocused();
    await expect(personInput).toBeEnabled();
    await personOption.click();
    await expect.poll(() => page.evaluate(() => window.__issueEditorHarness.personSubmits)).toEqual(['self']);

    await page.evaluate(() => {
        window.__issueEditorHarness.setPersonOpen(false);
        window.__issueEditorHarness.setPointsOpen(true);
        window.__issueEditorHarness.setPointsError('Jira may have received the change.');
        window.__issueEditorHarness.setPointsRecovery('check_jira');
    });
    const pointsInput = page.getByRole('textbox', { name: 'Story Points' });
    await expect(pointsInput).toHaveAttribute('readonly', '');
    expect(await page.evaluate(() => window.__issueEditorHarness.pointSubmits)).toEqual([]);
    await expect.poll(() => page.evaluate(() => window.__issueEditorHarness.recoveryCalls)).toEqual(['reload', 'check-points']);
    await expect(pointsInput).toHaveAttribute('title', 'Jira field configuration changed. Review the issue in Jira before trying again.');
    expect(await page.evaluate(() => window.__issueEditorHarness.pointSubmits)).toEqual([]);
    await page.evaluate(() => window.__issueEditorHarness.setPointsRecovery(''));
    await expect(pointsInput).toBeEditable();
    await pointsInput.fill('3');
    await pointsInput.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__issueEditorHarness.pointSubmits)).toEqual([3]);
});
