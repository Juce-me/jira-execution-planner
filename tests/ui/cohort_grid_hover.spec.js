const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');

const repoRoot = path.join(__dirname, '..', '..');
let cohortGridBundle;

test.beforeAll(() => {
    cohortGridBundle = esbuild.buildSync({
        stdin: {
            contents: `
                import React from 'react';
                import { createRoot } from 'react-dom/client';
                import CohortGrid from './frontend/src/cohort/CohortGrid.jsx';
                const model = {
                    columns: [{ key: 'elapsed-1', label: 'Q+1' }],
                    rows: [{
                        key: '2026Q1', label: '2026Q1', totalCreated: 1, openCount: 0,
                        cells: [{ index: 0, count: 1, statusCounts: { done: 1 } }]
                    }],
                    maxCellCount: 1
                };
                createRoot(document.getElementById('root')).render(
                    <CohortGrid model={model} selectedRowKey={null} onSelectRow={() => {}} />
                );
            `,
            resolveDir: repoRoot,
            loader: 'jsx',
        },
        bundle: true,
        write: false,
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
});

test('Cohort Heatmap hover bubble is a top-level fixed overlay', async ({ page }) => {
    await page.setContent('<main><div id="root"></div><section id="overlap-panel">Following graph panel</section></main>');
    const cohortCss = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'styles', 'stats', 'cohort.css'), 'utf8');
    await page.addStyleTag({ content: `
        :root { --border: #d8dee9; --sticky-control-overlay-z: 70; }
        ${cohortCss}
        #overlap-panel { position: relative; z-index: 2; height: 100px; background: white; }
    ` });
    await page.addScriptTag({ content: cohortGridBundle });

    const cell = page.locator('.cohort-cell.has-value');
    await expect(cell).toBeVisible();
    await cell.hover();

    const tooltip = page.locator('body > .cohort-grid-tooltip');
    await expect(tooltip).toBeVisible();
    const layer = await tooltip.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        node.style.pointerEvents = 'auto';
        const hit = document.elementFromPoint(rect.left + (rect.width / 2), rect.top + (rect.height / 2));
        node.style.pointerEvents = '';
        return {
            parentIsBody: node.parentElement === document.body,
            position: getComputedStyle(node).position,
            topmost: Boolean(hit && (hit === node || node.contains(hit))),
        };
    });
    expect(layer).toEqual({ parentIsBody: true, position: 'fixed', topmost: true });
    await page.screenshot({ path: path.join(repoRoot, 'test-results', 'cohort-grid-hover.png'), fullPage: true });
    await page.locator('#overlap-panel').hover();
    await expect(tooltip).toHaveCount(0);
});
