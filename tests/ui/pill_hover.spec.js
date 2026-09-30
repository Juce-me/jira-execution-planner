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
            await expect(control).toHaveCSS('box-shadow', 'rgba(47, 128, 237, 0.35) 0px 0px 0px 2px');
            await expect(control).not.toHaveCSS('background-color', 'rgb(47, 47, 47)');
            const label = await control.textContent();
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
