/**
 * UI Test for PRODUCT-33712: Focus/unfocus must not change bar positions
 *
 * This test verifies that:
 * - Bar x-positions remain stable when toggling focus mode
 * - Dependency edges are only drawn between visible bars
 * - No edges "shoot to the end" (use fallback coordinates)
 *
 * IMPORTANT: This test uses real Jira data from scenario-example.json.
 * Keep this file LOCAL ONLY - never commit to public repo.
 *
 * Prerequisites:
 * - Playwright installed: npm install -D @playwright/test
 * - Fixture available: tests/fixtures/scenario-example.json
 *
 * Run with: npx playwright test tests/ui/scenario_product_33712_focus_positions.spec.js
 */

// Uncomment when Playwright is available:
// const { test, expect } = require('@playwright/test');
// const fs = require('fs');
// const path = require('path');

// Test constants
const TODAY = '2026-01-29';
const EPIC_KEYS = ['PRODUCT-33713', 'PRODUCT-33715', 'PRODUCT-33716', 'PRODUCT-34063'];

/**
 * Load the scenario fixture
 */
function loadFixture() {
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'scenario-example.json');
    if (!fs.existsSync(fixturePath)) {
        throw new Error(`Fixture not found: ${fixturePath}\nPlease copy /mnt/data/scenario-example.json to tests/fixtures/scenario-example.json`);
    }
    return JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
}

/**
 * Freeze browser Date to TODAY for deterministic testing
 */
function getDateFreezeScript(dateString) {
    return `
        // Freeze Date to ${dateString} for deterministic testing
        const frozenDate = new Date('${dateString}T12:00:00Z');
        const OriginalDate = Date;

        Date = class extends OriginalDate {
            constructor(...args) {
                if (args.length === 0) {
                    super(frozenDate);
                } else {
                    super(...args);
                }
            }

            static now() {
                return frozenDate.getTime();
            }
        };

        Date.UTC = OriginalDate.UTC;
        Date.parse = OriginalDate.parse;
    `;
}

// Uncomment when ready to implement:
/*
test.describe('PRODUCT-33712: Focus mode position stability', () => {
    let fixtureData;

    test.beforeAll(() => {
        fixtureData = loadFixture();
    });

    test('bar positions remain stable when toggling focus', async ({ page }) => {
        // Freeze Date to TODAY
        await page.addInitScript(getDateFreezeScript(TODAY));

        // Mock the scenario API endpoint
        await page.route('**/api/scenario', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(fixtureData)
            });
        });

        // Navigate to scenario planner page
        // TODO: Update with actual URL once UI structure is known
        await page.goto('http://localhost:5050/scenario-planner.html');

        // Wait for bars to render
        await page.waitForSelector('[data-issue-key]', { timeout: 5000 });

        // Record bar positions in unfocused mode
        const unfocusedPositions = {};
        for (const key of EPIC_KEYS) {
            const bar = await page.locator(`[data-issue-key="${key}"]`).first();
            if (await bar.count() > 0) {
                const box = await bar.boundingBox();
                unfocusedPositions[key] = { x: box.x, y: box.y, width: box.width };
            }
        }

        // Verify we found at least some bars
        expect(Object.keys(unfocusedPositions).length).toBeGreaterThan(0);

        // Toggle focus mode (focus on epic PRODUCT-33712 or one of its issues)
        // TODO: Update selector based on actual UI
        const focusToggle = await page.locator('[data-epic-key="PRODUCT-33712"]').first();
        await focusToggle.click();

        // Wait for focus animation/transition to complete
        await page.waitForTimeout(500);

        // Record bar positions in focused mode
        const focusedPositions = {};
        for (const key of EPIC_KEYS) {
            const bar = await page.locator(`[data-issue-key="${key}"]`).first();
            if (await bar.count() > 0) {
                const box = await bar.boundingBox();
                focusedPositions[key] = { x: box.x, y: box.y, width: box.width };
            }
        }

        // Verify positions are unchanged (within 1px tolerance)
        for (const key of Object.keys(unfocusedPositions)) {
            if (focusedPositions[key]) {
                expect(Math.abs(focusedPositions[key].x - unfocusedPositions[key].x)).toBeLessThan(1);
                console.log(`✓ ${key}: position stable (x=${unfocusedPositions[key].x.toFixed(1)})`);
            }
        }
    });

    test('dependency edges only render between visible bars', async ({ page }) => {
        // Freeze Date to TODAY
        await page.addInitScript(getDateFreezeScript(TODAY));

        // Mock the scenario API endpoint
        await page.route('**/api/scenario', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(fixtureData)
            });
        });

        // Navigate to scenario planner
        await page.goto('http://localhost:5050/scenario-planner.html');
        await page.waitForSelector('[data-issue-key]', { timeout: 5000 });

        // Get all dependency edges (SVG paths or similar)
        // TODO: Update selector based on actual implementation
        const edges = await page.locator('.dependency-edge, [data-dependency-edge]').all();

        // Get visible bars
        const visibleBars = await page.locator('[data-issue-key]').all();
        const visibleKeys = [];
        for (const bar of visibleBars) {
            const key = await bar.getAttribute('data-issue-key');
            if (key) visibleKeys.push(key);
        }

        // Verify each edge connects two visible bars
        for (const edge of edges) {
            const fromKey = await edge.getAttribute('data-from-key');
            const toKey = await edge.getAttribute('data-to-key');

            // Edge endpoints must reference visible bars
            expect(visibleKeys).toContain(fromKey);
            expect(visibleKeys).toContain(toKey);

            // Get edge path and verify it doesn't extend to "void"
            // (i.e., x-coordinates should be within timeline bounds, not at domain max)
            const pathData = await edge.getAttribute('d');
            // TODO: Parse SVG path and verify coordinates are reasonable

            console.log(`✓ Edge ${fromKey} -> ${toKey}: endpoints valid`);
        }
    });

    test('no edges shoot to timeline end fallback position', async ({ page }) => {
        // Freeze Date to TODAY
        await page.addInitScript(getDateFreezeScript(TODAY));

        // Mock the scenario API endpoint
        await page.route('**/api/scenario', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(fixtureData)
            });
        });

        await page.goto('http://localhost:5050/scenario-planner.html');
        await page.waitForSelector('[data-issue-key]', { timeout: 5000 });

        // Get timeline dimensions
        const timeline = await page.locator('.timeline, [data-timeline]').first();
        const timelineBox = await timeline.boundingBox();
        const timelineMaxX = timelineBox.x + timelineBox.width;

        // Get all edges
        const edges = await page.locator('.dependency-edge, [data-dependency-edge]').all();

        for (const edge of edges) {
            const pathData = await edge.getAttribute('d');

            // Parse SVG path and extract x-coordinates
            // Simple regex to find numbers after M (moveto) and L (lineto) commands
            const coords = pathData.match(/[ML]\s*(\d+\.?\d*)/g) || [];
            const xCoords = coords.map(c => parseFloat(c.substring(1).trim()));

            // Verify no coordinate is suspiciously close to timeline end
            // (within 5px suggests fallback positioning)
            for (const x of xCoords) {
                const distanceFromEnd = Math.abs(x - timelineMaxX);
                expect(distanceFromEnd).toBeGreaterThan(5);
            }
        }
    });
});
*/

// Placeholder test structure (uncomment and adapt when Playwright is set up)
console.log(`
UI test template created for PRODUCT-33712.

To use this test:
1. Install Playwright: npm install -D @playwright/test
2. Copy fixture: cp /mnt/data/scenario-example.json tests/fixtures/scenario-example.json
3. Uncomment the test code above
4. Update selectors to match actual UI implementation
5. Run: npx playwright test tests/ui/scenario_product_33712_focus_positions.spec.js

IMPORTANT: Keep this test LOCAL ONLY - never commit with real Jira data.
`);

module.exports = {};
