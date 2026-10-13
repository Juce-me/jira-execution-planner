const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');

const repoRoot = path.join(__dirname, '../..');
const buildProbe = viewId => esbuild.buildSync({
    stdin: { resolveDir: repoRoot, loader: 'jsx', contents: `
        import * as React from 'react';
        import { createRoot } from 'react-dom/client';
        import LazyViewBoundary from './frontend/src/components/LazyViewBoundary.jsx';
        import { createLazyViewLoader } from './frontend/src/components/lazyViewLoaders.js';
        window.loadCalls = 0;
        const load = createLazyViewLoader({ viewId: '${viewId}', initialLoad: () => {
            window.loadCalls++;
            return import('/missing-StatsPanel.js');
        } });
        function App() {
            const [open, setOpen] = React.useState(true);
            const [tick, setTick] = React.useState(0);
            React.useEffect(() => { const timer = setInterval(() => setTick(n => n + 1), 10); return () => clearInterval(timer); }, []);
            return <><button onClick={() => setOpen(value => !value)}>Toggle view</button><span>{tick}</span>
                {open && <LazyViewBoundary load={load} fallback={<p>Loading Statistics…</p>}>{View => <View />}</LazyViewBoundary>}
            </>;
        }
        createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: false, format: 'iife', external: ['/missing-StatsPanel.js'],
    define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text;

for (const viewId of ['stats', 'scenario', 'settings']) test(`a missing ${viewId} chunk settles during parent updates and stays failed on reopen`, async ({ page }) => {
    await page.route('http://lazy.example/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.route('**/missing-StatsPanel.js', async route => {
        await new Promise(resolve => setTimeout(resolve, 50));
        await route.fulfill({ status: 404, contentType: 'text/html', body: 'Not found' });
    });
    await page.goto('http://lazy.example/');
    await page.addScriptTag({ content: buildProbe(viewId) });
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(page.getByText('Loading Statistics…', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.loadCalls)).toBe(1);
    await page.getByRole('button', { name: 'Toggle view' }).click();
    await page.getByRole('button', { name: 'Toggle view' }).click();
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.loadCalls)).toBe(1);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeVisible();
    await expect(page.getByText('Loading Statistics…', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.loadCalls)).toBe(1);
});
