const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { measure, contrast } = require('./design_system_hover_helpers');

const repoRoot = path.resolve(__dirname, '../..');
let script;
let css;
test.beforeAll(() => {
    css = esbuild.buildSync({ entryPoints: [path.join(repoRoot, 'frontend/src/styles/dashboard.css')], bundle: true, write: false }).outputFiles[0].text;
    script = esbuild.buildSync({
        stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Bar from './frontend/src/eng/PlanningProjectSplitBar.jsx'; import Panel from './frontend/src/eng/PlanningOverviewPanel.jsx'; window.renderBar = props => createRoot(document.getElementById('root')).render(<Panel compact={props.compact} projects={<Bar {...props}/>}/>);`, resolveDir: repoRoot, loader: 'jsx' },
        bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
});

async function darkPixels(page, box) {
    const png = await page.screenshot({ clip: box, animations: 'disabled' });
    return page.evaluate(async data => {
        const image = new Image(); image.src = data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 80 && pixels[i + 1] < 80 && pixels[i + 2] < 80) dark++;
        return dark;
    }, 'data:image/png;base64,' + png.toString('base64'));
}

async function paintedMarker(page) {
    const box = await page.locator('.capacity-bar-marker-line').boundingBox();
    // Sample a painted dash inside the fill, not the extension below it.
    return darkPixels(page, { x: box.x, y: box.y, width: box.width, height: 3 });
}

async function paintedReadout(page, fill) {
    const box = await fill.evaluate(n => {
        const s = getComputedStyle(n, '::after'); const r = n.getBoundingClientRect();
        const width = parseFloat(s.width) + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
        const height = parseFloat(s.height) + parseFloat(s.paddingTop) + parseFloat(s.paddingBottom);
        const matrix = new DOMMatrix(s.transform === 'none' ? undefined : s.transform);
        const x = r.x + (s.left === 'auto' ? r.width - parseFloat(s.right) - width : parseFloat(s.left)) + matrix.m41;
        const y = r.y + (s.top === 'auto' ? r.height - parseFloat(s.bottom) - height : parseFloat(s.top)) + matrix.m42;
        return { x: x + 3, y: y + 3, width: width - 6, height: height - 6 };
    });
    expect(await darkPixels(page, box), 'readout background actually paints above the panel').toBeGreaterThan(50);
}

test('compact narrow touch bar retains its target and readable summary', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 400 }, hasTouch: true });
    const page = await context.newPage();
    await page.setContent('<div style="margin:100px 20px" id="root"></div>');
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
    await page.evaluate(() => window.renderBar({ selectedProjectEntries: [{ id: 'PRODUCT', storyPoints: 65 }, { id: 'TECH', storyPoints: 35 }], excludedProjectStats: {}, compact: true }));
    await expect(page.locator('.planning-compact-readout')).toHaveText('Product 65.0 · Tech 35.0 SP');
    await page.locator('.project-bar-fill.tech').tap();
    expect(await paintedMarker(page), 'touch inspection retains the target dash').toBeGreaterThanOrEqual(2);
    const summary = await measure(page.locator('.planning-compact-readout'));
    for (const selector of ['.product', '.tech']) {
        const paint = await measure(page.locator('.project-bar-fill' + selector));
        expect(contrast(summary.text, paint.fill), `compact text over ${selector}`).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({ path: testInfo.outputPath('compact-touch.png'), animations: 'disabled' });
    await context.close();
});

for (const scenario of [
    { name: 'Tech', product: 65, adHoc: 0, hover: '.tech' },
    { name: 'Product', product: 90, adHoc: 0, hover: '.product' },
    { name: 'Ad Hoc', product: 90, adHoc: 30, hover: '.product-adhoc' },
]) {
    test(`${scenario.name} hover keeps the target painted above tinted project fills`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 1000, height: 400 });
        await page.setContent('<div style="margin:100px 40px" id="root"></div>');
        await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
        await page.evaluate(s => window.renderBar({ selectedProjectEntries: [{ id: 'PRODUCT', storyPoints: s.product }, { id: 'TECH', storyPoints: 100 - s.product }], excludedProjectStats: {}, adHocProductSP: s.adHoc }), scenario);
        const bar = page.locator('.project-bar-graph'); await expect(bar).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('rest.png'), animations: 'disabled' });
        const fill = page.locator('.project-bar-fill' + scenario.hover);
        await fill.hover(); await page.waitForTimeout(200);
        await page.screenshot({ path: testInfo.outputPath('hover.png'), animations: 'disabled' });
        expect(await paintedMarker(page), 'target dash remains visible within the hovered fill').toBeGreaterThanOrEqual(2);
        for (const selector of ['.product', '.tech']) {
            const segment = page.locator('.project-bar-fill' + selector);
            const paint = await measure(segment);
            if (!(await segment.locator('.capacity-bar-fill-label').count())) continue;
            const ink = await segment.locator('.capacity-bar-fill-label').evaluate(n => getComputedStyle(n).color);
            const rgb = ink.match(/[\d.]+/g).map(Number);
            const brightness = Number(paint.filter.match(/brightness\(([\d.]+)\)/)?.[1] || 1);
            expect(contrast(rgb.map(c => c * brightness), paint.fill), `${selector} label contrast`).toBeGreaterThanOrEqual(4.5);
            expect(contrast([26, 26, 26], paint.fill), `${selector} target marker contrast`).toBeGreaterThanOrEqual(3);
            expect(Math.min(...paint.fill), `${selector} uses a light tinted fill`).toBeGreaterThan(150);
        }
        expect(await fill.getAttribute('data-tooltip')).toContain('SP');
        const readout = await fill.evaluate(n => {
            const s = getComputedStyle(n, '::after');
            return { content: s.content, width: parseFloat(s.width), height: parseFloat(s.height), visibility: s.visibility, opacity: s.opacity, background: s.backgroundColor, color: s.color };
        });
        expect(readout.content).not.toBe('none');
        expect(readout.width).toBeGreaterThan(50);
        expect(readout.height).toBeGreaterThan(5);
        expect(readout.visibility).toBe('visible');
        expect(readout.opacity).toBe('1');
        expect(contrast(readout.background.match(/[\d.]+/g).map(Number), readout.color.match(/[\d.]+/g).map(Number))).toBeGreaterThanOrEqual(4.5);
        await paintedReadout(page, fill);
        await page.locator('.planning-panel').evaluate(n => n.classList.add('stuck'));
        expect(await fill.evaluate(n => getComputedStyle(n, '::after').top)).not.toBe('auto');
        await paintedReadout(page, fill);
        await page.screenshot({ path: testInfo.outputPath('stuck-hover.png'), animations: 'disabled' });
    });
}
