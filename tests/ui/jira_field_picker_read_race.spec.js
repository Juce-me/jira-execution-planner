const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { appBaseUrl, installDashboardShell } = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const fieldPaths = [
    '/api/sprint-field/config',
    '/api/parent-name-field/config',
    '/api/story-points-field/config',
    '/api/team-field/config',
    '/api/delivery-owner-field/config',
];
let harnessJs;

test.beforeAll(() => {
    harnessJs = esbuild.buildSync({
        stdin: {
            sourcefile: 'jira-field-picker-read-race-harness.jsx',
            resolveDir: repoRoot,
            loader: 'jsx',
            contents: `
                import * as React from 'react';
                import { createRoot } from 'react-dom/client';
                import { useJiraFieldPickers } from './frontend/src/settings/useJiraFieldPickers.js';
                import { createSettingsDraftReadGuard } from './frontend/src/settings/settingsConfigReadState.js';

                function Harness() {
                    const pickers = useJiraFieldPickers({ backendUrl: '', jiraFields: [] });
                    const generationRef = React.useRef(0);
                    const snapshotRef = React.useRef({});
                    snapshotRef.current = {
                        sprintField: JSON.stringify({ fieldId: pickers.sprintFieldIdDraft, fieldName: pickers.sprintFieldNameDraft }),
                        parentNameField: JSON.stringify({ fieldId: pickers.parentNameFieldIdDraft, fieldName: pickers.parentNameFieldNameDraft }),
                        storyPointsField: JSON.stringify({ fieldId: pickers.storyPointsFieldIdDraft, fieldName: pickers.storyPointsFieldNameDraft }),
                        teamField: JSON.stringify({ fieldId: pickers.teamFieldIdDraft, fieldName: pickers.teamFieldNameDraft }),
                        deliveryOwnerField: JSON.stringify({ fieldId: pickers.deliveryOwnerFieldIdDraft, fieldName: pickers.deliveryOwnerFieldNameDraft }),
                    };
                    const startParentFallback = async () => {
                        const generation = generationRef.current + 1;
                        generationRef.current = generation;
                        const shouldApplyResult = () => generationRef.current === generation;
                        const draftReadGuard = createSettingsDraftReadGuard(() => snapshotRef.current);
                        const response = await fetch('/api/config?includeViewConfig=true');
                        const config = await response.json();
                        if (!shouldApplyResult()) return false;
                        if (config.sharedConfig) return true;
                        await pickers.loadAllFieldConfigs({
                            shouldApplyResult,
                            readOptionsForField: section => draftReadGuard.fieldReadOptions(section),
                        });
                        return shouldApplyResult();
                    };
                    window.__pickerHarness = {
                        startParentFallback,
                        invalidate: () => { generationRef.current += 1; },
                        editSprint: (fieldId, fieldName) => {
                            pickers.setSprintFieldIdDraft(fieldId);
                            pickers.setSprintFieldNameDraft(fieldName);
                        },
                    };
                    return <main>
                        <output data-testid="sprint-value">{pickers.sprintFieldIdDraft}|{pickers.sprintFieldNameDraft}</output>
                        <output data-testid="team-value">{pickers.teamFieldIdDraft}|{pickers.teamFieldNameDraft}</output>
                        <output data-testid="dirty-count">{pickers.dirtyFieldConfigCount}</output>
                        <button type="button" disabled={!pickers.anyFieldConfigDirty}>Save</button>
                    </main>;
                }

                createRoot(document.getElementById('root')).render(<Harness />);
            `,
        },
        bundle: true,
        write: false,
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
});

async function mountHarness(page) {
    const parentRoutes = [];
    const fieldRoutes = [];
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: harnessJs,
    }));
    await page.route('**/api/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/config') {
            parentRoutes.push(route);
            return;
        }
        if (fieldPaths.includes(pathname)) {
            fieldRoutes.push(route);
            return;
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(appBaseUrl);
    return { parentRoutes, fieldRoutes };
}

function fieldPayload(pathname, generation) {
    const values = {
        '/api/sprint-field/config': [`customfield_sprint_${generation}`, `Sprint ${generation}`],
        '/api/parent-name-field/config': [`customfield_parent_${generation}`, `Parent ${generation}`],
        '/api/story-points-field/config': [`customfield_points_${generation}`, `Points ${generation}`],
        '/api/team-field/config': [`customfield_team_${generation}`, `Team ${generation}`],
        '/api/delivery-owner-field/config': [`customfield_owner_${generation}`, `Owner ${generation}`],
    }[pathname];
    return { fieldId: values[0], fieldName: values[1] };
}

async function fulfillFieldBatch(routes, generation) {
    await Promise.all(routes.map(route => {
        const pathname = new URL(route.request().url()).pathname;
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(fieldPayload(pathname, generation)),
        });
    }));
}

test('actual fallback loaders preserve interim edits and reject a stale generation', async ({ page }) => {
    const { parentRoutes, fieldRoutes } = await mountHarness(page);
    await page.evaluate(() => {
        window.__pickerPending = window.__pickerHarness.startParentFallback();
    });
    await expect.poll(() => parentRoutes.length).toBe(1);
    await page.evaluate(() => window.__pickerHarness.editSprint('customfield_local', 'Local sprint'));
    await parentRoutes[0].fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authMode: 'atlassian_oauth' }),
    });
    await expect.poll(() => fieldRoutes.length).toBe(fieldPaths.length);
    await fulfillFieldBatch(fieldRoutes.slice(0, fieldPaths.length), 1);
    await page.evaluate(() => window.__pickerPending);

    await expect(page.getByTestId('sprint-value')).toHaveText('customfield_local|Local sprint');
    await expect(page.getByTestId('team-value')).toHaveText('customfield_team_1|Team 1');
    await expect(page.getByTestId('dirty-count')).toHaveText('1');
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();

    await page.evaluate(() => window.__pickerHarness.editSprint('customfield_sprint_1', 'Sprint 1'));
    await expect(page.getByTestId('dirty-count')).toHaveText('0');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

    await page.evaluate(() => {
        window.__pickerPending = window.__pickerHarness.startParentFallback();
    });
    await expect.poll(() => parentRoutes.length).toBe(2);
    await parentRoutes[1].fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authMode: 'atlassian_oauth' }),
    });
    await expect.poll(() => fieldRoutes.length).toBe(fieldPaths.length * 2);
    await page.evaluate(() => window.__pickerHarness.invalidate());
    await fulfillFieldBatch(fieldRoutes.slice(fieldPaths.length), 2);
    await page.evaluate(() => window.__pickerPending);

    await expect(page.getByTestId('sprint-value')).toHaveText('customfield_sprint_1|Sprint 1');
    await expect(page.getByTestId('team-value')).toHaveText('customfield_team_1|Team 1');
    await expect(page.getByTestId('dirty-count')).toHaveText('0');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
});
