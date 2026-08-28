const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');

const repoRoot = path.join(__dirname, '..', '..');
const harnessUrl = 'http://onboarding-tour.test/';
let harnessJs;
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
    dashboardCss = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css')],
        bundle: true,
        write: false,
    }).outputFiles[0].text;
});

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
