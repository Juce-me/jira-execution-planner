const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');

const repoRoot = path.join(__dirname, '..', '..');
const harnessUrl = 'http://onboarding-tour.test/';
const controllerHarnessUrl = 'http://onboarding-controller.test/';
let harnessJs;
let controllerHarnessJs;
let dashboardCss;

test.beforeAll(() => {
    harnessJs = esbuild.buildSync({
        stdin: {
            resolveDir: repoRoot,
            loader: 'jsx',
            contents: `
                import * as React from 'react';
                import { createRoot } from 'react-dom/client';
                import OnboardingTour from './frontend/src/onboarding/OnboardingTour.jsx';

                function Harness() {
                    const [run, setRun] = React.useState(false);
                    const [done, setDone] = React.useState(false);
                    const [pending, setPending] = React.useState(false);
                    const [showPrimary, setShowPrimary] = React.useState(true);
                    const [showGroup, setShowGroup] = React.useState(true);
                    const [skipCount, setSkipCount] = React.useState(0);

                    React.useLayoutEffect(() => {
                        window.__tourHarness = {
                            open: () => { setDone(false); setRun(true); },
                            closeWithDone: () => setDone(true),
                            reopenWithRunUnchanged: () => setDone(false),
                            setPending,
                            removePrimary: () => setShowPrimary(false),
                            removeGroup: () => setShowGroup(false),
                            skipCount,
                        };
                    });

                    return <>
                        <button id="prior-focus">Prior focus</button>
                        {showPrimary && <button data-onboarding-target="sprint" style={{ position: 'fixed', left: 40, top: 30 }}>Sprint main</button>}
                        <button data-onboarding-target="sprint" style={{ position: 'fixed', left: 520, top: 30 }}>Sprint compact</button>
                        {showGroup && <button data-onboarding-target="group" style={{ position: 'fixed', left: 40, top: 120 }}>Department</button>}
                        <button data-onboarding-target="refresh" style={{ position: 'fixed', left: 40, top: 210 }}>Refresh</button>
                        <div data-onboarding-target="hierarchy-epic" style={{ position: 'fixed', left: 40, top: 300, width: 180, height: 40 }}>Epic and stories</div>
                        <button data-onboarding-target="editing-priority" style={{ position: 'fixed', left: 40, top: 390 }}>Priority</button>
                        <OnboardingTour
                            run={run}
                            onboardingDone={done}
                            actionPending={pending}
                            onSkip={() => { setSkipCount((count) => count + 1); setRun(false); }}
                            onFinish={() => setRun(false)}
                        />
                    </>;
                }

                const root = createRoot(document.getElementById('root'));
                root.render(<Harness />);
                window.__unmountTourHarness = () => root.unmount();
            `,
        },
        bundle: true,
        write: false,
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
    controllerHarnessJs = esbuild.buildSync({
        stdin: {
            resolveDir: repoRoot,
            loader: 'jsx',
            contents: `
                import * as React from 'react';
                import { createRoot } from 'react-dom/client';
                import OnboardingTour from './frontend/src/onboarding/OnboardingTour.jsx';
                import { isOnboardingAvailable } from './frontend/src/onboarding/onboardingSteps.js';
                import { useOnboardingController } from './frontend/src/onboarding/useOnboardingTour.js';

                function ControllerHarness() {
                    const [ready, setReady] = React.useState(false);
                    const [done, setDone] = React.useState(true);
                    const [showSettings, setShowSettings] = React.useState(true);
                    const [dirty, setDirty] = React.useState(false);
                    const [saving, setSaving] = React.useState(false);
                    const [authMode, setAuthMode] = React.useState('atlassian_oauth');
                    const [groupsSource, setGroupsSource] = React.useState('workspace_db');
                    const behaviorRef = React.useRef({ type: 'success' });
                    const writesRef = React.useRef([]);
                    const eventsRef = React.useRef([]);
                    const preservedRef = React.useRef({ sprint: 'S-42', group: 'platform', teams: ['alpha'], favorite: 'platform' });
                    const modeRef = React.useRef({ selectedView: 'epm', planning: true, stats: true, scenario: true, board: true });
                    const savePreference = React.useCallback((nextDone) => {
                        writesRef.current.push(nextDone);
                        const behavior = behaviorRef.current;
                        if (behavior.type === 'deferred') {
                            return new Promise((resolve, reject) => {
                                window.__resolveOnboardingWrite = () => resolve({ onboardingDone: nextDone });
                                window.__rejectOnboardingWrite = () => reject(new Error('Save failed.'));
                            });
                        }
                        if (behavior.type === 'error') {
                            const error = new Error('Save failed.');
                            error.status = behavior.status;
                            error.loginUrl = behavior.loginUrl;
                            return Promise.reject(error);
                        }
                        if (behavior.type === 'auth_required') {
                            const error = new Error('Authentication is required to continue.');
                            error.name = 'AuthenticationRequiredError';
                            error.status = 401;
                            error.code = 'auth_required';
                            error.loginUrl = behavior.loginUrl;
                            return Promise.reject(error);
                        }
                        if (behavior.type === 'mismatch') {
                            return Promise.resolve({ onboardingDone: !nextDone });
                        }
                        return Promise.resolve({ onboardingDone: nextDone });
                    }, []);
                    const prepareCatchUp = React.useCallback(() => {
                        modeRef.current = { selectedView: 'eng', planning: false, stats: false, scenario: false, board: false };
                    }, []);
                    const trackSettingsAction = React.useCallback((section, workflowAction, params) => {
                        eventsRef.current.push({ section, workflowAction, params });
                    }, []);
                    const onboardingAvailable = isOnboardingAvailable(authMode, groupsSource);
                    const controller = useOnboardingController({
                        bootstrapReady: ready && onboardingAvailable,
                        onboardingDone: done,
                        setOnboardingDone: setDone,
                        savePreference,
                        prepareCatchUp,
                        closeSettings: () => setShowSettings(false),
                        trackSettingsAction,
                    });
                    React.useLayoutEffect(() => {
                        window.__onboardingController = {
                            setBootstrap: (nextReady, nextDone) => { setReady(nextReady); setDone(nextDone); },
                            setBehavior: (behavior) => { behaviorRef.current = behavior; },
                            setAvailability: (nextAuthMode, nextGroupsSource) => {
                                setAuthMode(nextAuthMode);
                                setGroupsSource(nextGroupsSource);
                            },
                            setDirty,
                            setSaving,
                            replay: controller.replay,
                            snapshot: () => ({
                                ready, done, showSettings, dirty, saving, authMode, groupsSource,
                                run: controller.run, pending: controller.pending,
                                error: controller.error,
                                writes: [...writesRef.current], events: [...eventsRef.current],
                                preserved: preservedRef.current, mode: modeRef.current,
                            }),
                        };
                    });
                    return <>
                        <button data-onboarding-target="sprint">Sprint</button>
                        <button data-onboarding-target="refresh">Refresh</button>
                        <div data-onboarding-target="hierarchy">Hierarchy</div>
                        {showSettings && onboardingAvailable && (
                            <button
                                type="button"
                                onClick={() => { void controller.replay(); }}
                                disabled={dirty || saving || controller.pending}
                            >Run onboarding again</button>
                        )}
                        <OnboardingTour
                            run={controller.run}
                            onboardingDone={done}
                            onSkip={controller.skip}
                            onFinish={controller.finish}
                            actionPending={controller.pending}
                            actionError={controller.error}
                        />
                    </>;
                }
                createRoot(document.getElementById('root')).render(<ControllerHarness />);
            `,
        },
        bundle: true,
        write: false,
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
    dashboardCss = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css')],
        bundle: true,
        write: false,
    }).outputFiles[0].text;
});

async function installControllerHarness(page) {
    await page.route(controllerHarnessUrl, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><head><style>${dashboardCss}</style></head><body><div id="root"></div><script>${controllerHarnessJs}</script></body></html>`,
    }));
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto(controllerHarnessUrl);
    await page.waitForFunction(() => Boolean(window.__onboardingController));
}

async function installHarness(page) {
    await page.addInitScript(() => {
        const lifecycle = {
            listenerAdds: { resize: 0, scroll: 0 },
            listenerRemoves: { resize: 0, scroll: 0 },
            resizeObservers: 0,
            mutationObservers: 0,
            headings: [],
        };
        window.__tourLifecycle = lifecycle;
        const add = window.addEventListener.bind(window);
        const remove = window.removeEventListener.bind(window);
        window.addEventListener = (type, listener, options) => {
            if (type === 'resize' || type === 'scroll') lifecycle.listenerAdds[type] += 1;
            return add(type, listener, options);
        };
        window.removeEventListener = (type, listener, options) => {
            if (type === 'resize' || type === 'scroll') lifecycle.listenerRemoves[type] += 1;
            return remove(type, listener, options);
        };
        const NativeResizeObserver = window.ResizeObserver;
        window.ResizeObserver = class extends NativeResizeObserver {
            constructor(callback) {
                super(callback);
                lifecycle.resizeObservers += 1;
                this.connected = true;
            }
            disconnect() {
                if (this.connected) lifecycle.resizeObservers -= 1;
                this.connected = false;
                return super.disconnect();
            }
        };
        const NativeMutationObserver = window.MutationObserver;
        window.MutationObserver = class extends NativeMutationObserver {
            constructor(callback) {
                super(callback);
                this.tracked = false;
            }
            observe(target, options) {
                if (!this.tracked
                    && target?.id === 'root'
                    && options?.attributeFilter?.includes('aria-hidden')) {
                    lifecycle.mutationObservers += 1;
                    this.tracked = true;
                }
                return super.observe(target, options);
            }
            disconnect() {
                if (this.tracked) lifecycle.mutationObservers -= 1;
                this.tracked = false;
                return super.disconnect();
            }
        };
        add('DOMContentLoaded', () => {
            const headings = new NativeMutationObserver(() => {
                const text = document.querySelector('.onboarding-tour-card h2')?.textContent;
                if (text && lifecycle.headings.at(-1) !== text) lifecycle.headings.push(text);
            });
            headings.observe(document.body, { subtree: true, childList: true, characterData: true });
        });
    });
    await page.route(harnessUrl, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><head><style>${dashboardCss}</style></head><body><button id="outside-focus">Outside</button><div id="root"></div><script>${harnessJs}</script></body></html>`,
    }));
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto(harnessUrl);
    await page.waitForFunction(() => Boolean(window.__tourHarness));
}

async function openTour(page) {
    await page.evaluate(() => window.__tourHarness.open());
    await expect(page.getByRole('dialog')).toBeVisible();
}

test('portal, focus trap, pending Skip and Escape, and focus restoration work together', async ({ page }) => {
    await installHarness(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#prior-focus').focus();
    await openTour(page);

    const dialog = page.getByRole('dialog');
    expect(await dialog.evaluate((node) => node.parentElement.parentElement === document.body)).toBe(true);
    await expect(dialog).toBeFocused();
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    await expect(page.locator('.onboarding-tour-spotlight')).toHaveCSS('transition-duration', '0s');

    await page.getByRole('button', { name: 'Next' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Skip onboarding' })).toBeFocused();

    await page.evaluate(() => window.__tourHarness.setPending(true));
    await expect(page.getByRole('button', { name: 'Skip onboarding' })).toBeDisabled();
    await dialog.press('Escape');
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.__tourHarness.setPending(false));
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden', /.+/);
    await expect(page.locator('#root')).not.toHaveAttribute('inert', /.+/);
    expect(await page.locator('#root').evaluate((node) => node.inert)).toBe(false);
    await expect(page.locator('#prior-focus')).toBeFocused();
    expect(await page.evaluate(() => window.__tourHarness.skipCount)).toBe(1);

    await openTour(page);
    await page.getByRole('dialog').press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.__tourHarness.skipCount)).toBe(2);
});

test('root accessibility state restores exact pre-existing attribute values and inert property', async ({ page }) => {
    await installHarness(page);
    await page.locator('#outside-focus').focus();
    await page.evaluate(() => {
        const root = document.getElementById('root');
        root.setAttribute('aria-hidden', 'legacy-hidden');
        root.setAttribute('inert', 'legacy-inert');
    });
    await openTour(page);
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'legacy-hidden');
    await expect(page.locator('#root')).toHaveAttribute('inert', 'legacy-inert');
    expect(await page.locator('#root').evaluate((node) => node.inert)).toBe(true);
    await expect(page.locator('#outside-focus')).toBeFocused();
});

test('mutation retargets visible duplicates, removes vanished optional steps, and reopen starts at step one', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    const initialLeft = await page.locator('.onboarding-tour-spotlight').evaluate((node) => node.getBoundingClientRect().left);
    await page.evaluate(() => window.__tourHarness.removePrimary());
    await expect.poll(() => page.locator('.onboarding-tour-spotlight').evaluate((node) => node.getBoundingClientRect().left)).toBeGreaterThan(initialLeft + 300);

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading')).toHaveText('Set your Department scope');
    await page.evaluate(() => window.__tourHarness.removeGroup());
    await expect(page.getByRole('heading')).toHaveText('Request fresh data');

    await page.evaluate(() => window.__tourHarness.closeWithDone());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => {
        window.__tourLifecycle.headings = [];
        window.__tourHarness.reopenWithRunUnchanged();
    });
    await expect(page.getByRole('heading')).toHaveText('Choose a sprint');
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.headings[0])).toBe('Choose a sprint');
});

test('active observers and window listeners clean up on unmount', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    expect(await page.evaluate(() => window.__tourLifecycle.resizeObservers)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__tourLifecycle.mutationObservers)).toBeGreaterThan(0);
    await page.evaluate(() => window.__unmountTourHarness());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.resizeObservers)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.mutationObservers)).toBe(0);
    const lifecycle = await page.evaluate(() => window.__tourLifecycle);
    expect(lifecycle.listenerRemoves).toEqual(lifecycle.listenerAdds);
    await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden', /.+/);
    await expect(page.locator('#root')).not.toHaveAttribute('inert', /.+/);
});

test('automatic run waits for definitive bootstrap readiness and preserves scope state', async ({ page }, testInfo) => {
    await installControllerHarness(page);
    await page.evaluate(() => window.__onboardingController.setBootstrap(false, false));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => window.__onboardingController.setBootstrap(true, null));
    await expect.poll(() => page.evaluate(() => window.__onboardingController.snapshot().done)).toBeNull();
    await page.waitForTimeout(50);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => window.__onboardingController.setBootstrap(true, false));
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.evaluate(() => window.__onboardingController.setBootstrap(false, false));
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.evaluate(() => window.__onboardingController.setBootstrap(true, false));
    await expect(page.getByRole('dialog')).toBeVisible();

    const state = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(state.writes).toEqual([]);
    expect(state.preserved).toEqual({ sprint: 'S-42', group: 'platform', teams: ['alpha'], favorite: 'platform' });
    expect(state.mode).toEqual({ selectedView: 'eng', planning: false, stats: false, scenario: false, board: false });
    expect(state.events).toEqual([{ section: 'onboarding', workflowAction: 'started', params: { source_surface: 'first_run' } }]);
    const actionGeometry = await page.getByRole('dialog').evaluate((dialog) => {
        const dialogRect = dialog.getBoundingClientRect();
        return Array.from(dialog.querySelectorAll('.onboarding-tour-actions button')).map((button) => {
            const rect = button.getBoundingClientRect();
            return {
                left: rect.left,
                right: rect.right,
                dialogLeft: dialogRect.left,
                dialogRight: dialogRect.right,
            };
        });
    });
    for (const rect of actionGeometry) {
        expect(rect.left).toBeGreaterThanOrEqual(rect.dialogLeft);
        expect(rect.right).toBeLessThanOrEqual(rect.dialogRight);
    }
    await page.screenshot({
        path: testInfo.outputPath('onboarding-tour-desktop.png'),
        animations: 'disabled',
    });
});

test('automatic start and Settings replay require Atlassian OAuth workspace DB mode', async ({ page }) => {
    await installControllerHarness(page);
    await page.evaluate(() => {
        window.__onboardingController.setAvailability('basic', 'workspace_db');
        window.__onboardingController.setBootstrap(true, false);
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run onboarding again' })).toHaveCount(0);
    expect((await page.evaluate(() => window.__onboardingController.snapshot())).writes).toEqual([]);

    await page.evaluate(() => window.__onboardingController.setAvailability('atlassian_oauth', 'jsonfile'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run onboarding again' })).toHaveCount(0);

    await page.evaluate(() => window.__onboardingController.setAvailability('atlassian_oauth', 'workspace_db'));
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip onboarding' })).toBeVisible();
    const state = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(state.writes).toEqual([]);
    expect(state.events).toEqual([
        { section: 'onboarding', workflowAction: 'started', params: { source_surface: 'first_run' } },
    ]);
});

test('skip persists before close and a shared pending guard deduplicates Escape', async ({ page }) => {
    await installControllerHarness(page);
    await page.evaluate(() => {
        window.__onboardingController.setBehavior({ type: 'deferred' });
        window.__onboardingController.setBootstrap(true, false);
    });
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await page.getByRole('dialog').press('Escape');
    const pendingState = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(pendingState.writes).toEqual([true]);
    expect(pendingState.events.filter(event => event.workflowAction === 'skipped')).toEqual([]);
    await page.evaluate(() => window.__resolveOnboardingWrite());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const state = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(state.events.filter(event => event.workflowAction === 'skipped')).toEqual([
        { section: 'onboarding', workflowAction: 'skipped', params: { source_surface: 'first_run', result: 'success' } },
    ]);
});

test('authentication-required completion defers to the global lock and other failures remain retryable', async ({ page }) => {
    await installControllerHarness(page);
    await page.evaluate(() => {
        window.__onboardingController.setBehavior({ type: 'auth_required', loginUrl: '/login?reason=session_expired' });
        window.__onboardingController.setBootstrap(true, false);
    });
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveCount(0);
    const authState = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(authState.pending).toBe(false);
    expect(authState.error).toBe('');
    expect(authState.events.filter(event => event.workflowAction === 'skipped')).toEqual([]);

    await page.evaluate(() => window.__onboardingController.setBehavior({ type: 'mismatch' }));
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(page.getByRole('alert')).toHaveText('Saved onboarding preference could not be verified. Please retry.');
    expect((await page.evaluate(() => window.__onboardingController.snapshot())).events.filter(event => event.workflowAction === 'skipped')).toEqual([]);
    await page.evaluate(() => window.__onboardingController.setBehavior({ type: 'success' }));
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await page.evaluate(() => window.__onboardingController.snapshot())).events.filter(event => event.workflowAction === 'skipped')).toEqual([
        { section: 'onboarding', workflowAction: 'skipped', params: { source_surface: 'first_run', result: 'success' } },
    ]);
});

test('settings replay is disabled while dirty and starts only after false persistence succeeds', async ({ page }) => {
    await installControllerHarness(page);
    await page.evaluate(() => window.__onboardingController.setDirty(true));
    await expect(page.getByRole('button', { name: 'Run onboarding again' })).toBeDisabled();
    await page.evaluate(() => window.__onboardingController.setDirty(false));
    await page.getByRole('button', { name: 'Run onboarding again' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run onboarding again' })).toHaveCount(0);
    const state = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(state.writes).toEqual([false]);
    expect(state.events.at(-1)).toEqual({ section: 'onboarding', workflowAction: 'started', params: { source_surface: 'settings' } });
});

test('Finish persists completion before closing and emits completed once', async ({ page }) => {
    await installControllerHarness(page);
    await page.evaluate(() => {
        window.__onboardingController.setBehavior({ type: 'deferred' });
        window.__onboardingController.setBootstrap(true, false);
    });
    await expect(page.getByRole('dialog')).toBeVisible();
    while (await page.getByRole('button', { name: 'Next' }).count()) {
        await page.getByRole('button', { name: 'Next' }).click();
    }
    await page.getByRole('button', { name: 'Finish' }).click();
    const pendingState = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(pendingState.writes).toEqual([true]);
    expect(pendingState.events.filter(event => event.workflowAction === 'completed')).toEqual([]);
    await page.evaluate(() => window.__resolveOnboardingWrite());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const state = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(state.writes).toEqual([true]);
    expect(state.events.filter(event => event.workflowAction === 'completed')).toEqual([
        { section: 'onboarding', workflowAction: 'completed', params: { source_surface: 'first_run', result: 'success' } },
    ]);
});

test('interrupted reload restarts at the first eligible step', async ({ page }) => {
    await installControllerHarness(page);
    await page.evaluate(() => window.__onboardingController.setBootstrap(true, false));
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading')).toHaveText('Request fresh data');
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__onboardingController));
    await page.evaluate(() => window.__onboardingController.setBootstrap(true, false));
    await expect(page.getByRole('heading')).toHaveText('Choose a sprint');
});

test('mobile coachmark and spotlight stay within the viewport', async ({ page }, testInfo) => {
    await installHarness(page);
    await page.setViewportSize({ width: 390, height: 700 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openTour(page);

    for (const selector of ['.onboarding-tour-card', '.onboarding-tour-spotlight']) {
        const rect = await page.locator(selector).evaluate((node) => {
            const bounds = node.getBoundingClientRect();
            return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
        });
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.top).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(390);
        expect(rect.bottom).toBeLessThanOrEqual(700);
    }
    await page.screenshot({
        path: testInfo.outputPath('onboarding-tour-mobile.png'),
        animations: 'disabled',
    });
});
