const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const cssPath = path.join(__dirname, '../../frontend/dist/dashboard.css');

for (const mode of ['catch-up', 'planning']) {
    test(`${mode} pills glow without moving or losing contrast`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.setContent(`<style>${fs.readFileSync(cssPath, 'utf8')}</style>
            <div class="task-list"><div class="epic-block">
                <div class="epic-header"><div class="epic-title"><div class="epic-title-row">
                    <span class="epic-name">Synthetic epic</span>
                    ${mode === 'planning' ? `<button class="epic-stat-toggle active"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" /></svg>Included</button>
                    <button class="epic-stat-toggle">Excluded</button>` : ''}
                </div></div><div class="epic-meta"><span class="task-status in-progress">In Progress</span></div></div>
                <div class="task-item"><div class="dependency-strip">
                    <button class="dependency-count" data-dep-chip="blocked-by">Blocked by 1</button>
                    <button class="dependency-count" data-dep-chip="blocks">Blocks 1</button>
                    <button class="dependency-count unblocked" data-dep-chip="blocked-by">Unblocked 1</button>
                    <button class="dependency-count active" data-dep-chip="blocks">Blocks 2</button>
                </div></div>
            </div></div>`);
        // Freeze the card entrance animation before comparing hover geometry.
        await page.addStyleTag({ content: '* { animation: none !important; }' });
        const controls = page.locator('.epic-stat-toggle, .dependency-count');
        await page.locator('.task-list').screenshot({ path: testInfo.outputPath('rest.png') });
        for (const control of await controls.all()) {
            const resting = await control.boundingBox();
            await control.hover();
            await expect(control).toHaveCSS('transform', 'none');
            const inset = await control.evaluate(node => node.classList.contains('dependency-count'));
            const suffix = inset ? ' inset' : '';
            await expect(control).toHaveCSS('box-shadow', `rgb(47, 128, 237) 0px 0px 0px 1px${suffix}, rgba(47, 128, 237, 0.25) 0px 0px 0px 3px${suffix}`);
            // Assert the existing semantic fill, rather than merely excluding one dark colour.
            const label = await control.textContent();
            const fills = { Included: 'rgb(17, 17, 17)', Excluded: 'rgb(255, 255, 255)', 'Blocked by 1': 'rgba(239, 68, 68, 0.16)', 'Blocks 1': 'rgba(59, 130, 246, 0.16)', 'Unblocked 1': 'rgba(22, 163, 74, 0.12)', 'Blocks 2': 'rgba(59, 130, 246, 0.16)' };
            await expect(control).toHaveCSS('background-color', fills[label]);
            const contrast = await control.evaluate(node => {
                const rgba = value => (value.match(/[\d.]+/g) || []).map(Number);
                const layers = [];
                for (let parent = node; parent; parent = parent.parentElement) layers.push(rgba(getComputedStyle(parent).backgroundColor));
                let fill = [255, 255, 255];
                for (const color of layers.reverse()) { const alpha = color[3] ?? 1; fill = fill.map((channel, index) => (color[index] || 0) * alpha + channel * (1 - alpha)); }
                const style = getComputedStyle(node);
                const brightness = Number(style.filter.match(/brightness\(([^)]+)\)/)?.[1] ?? 1);
                const ink = rgba(style.color).slice(0, 3);
                const luminance = rgb => rgb.map(channel => Math.min(255, channel * brightness) / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
                const values = [luminance(ink), luminance(fill)].sort((a, b) => b - a);
                return (values[0] + 0.05) / (values[1] + 0.05);
            });
            expect(contrast, `${label} text on its composited fill`).toBeGreaterThanOrEqual(4.5);
            if (label === 'Included') await expect(control).toHaveCSS('color', 'rgb(255, 255, 255)');
            if (label.startsWith('Blocked')) await expect(control).toHaveCSS('color', 'rgb(127, 29, 29)');
            if (label.startsWith('Blocks')) await expect(control).toHaveCSS('color', 'rgb(29, 78, 216)');
            if (label.startsWith('Unblocked')) await expect(control).toHaveCSS('color', 'rgb(22, 101, 52)');
            await page.locator('.task-list').screenshot({ path: testInfo.outputPath(`${label}-hover.png`) });
            const hovered = await control.boundingBox();
            expect(hovered.y).toBe(resting.y);
            expect(hovered.height).toBe(resting.height);
        }
        if (mode === 'planning') {
            const included = page.locator('.epic-stat-toggle.active');
            await expect(included).toHaveCSS('font-size', '10px');
            await expect(included).toHaveCSS('border-radius', '8px');
            expect((await included.boundingBox()).height).toBeLessThan(24);
        }
    });
}
