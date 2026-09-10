import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../frontend/src/cohort/CohortGrid.jsx', import.meta.url), 'utf8');

test('Cohort Heatmap hover bubble renders above transformed and clipped graph panels', () => {
    assert.match(source, /import\s*\{\s*createPortal\s*\}\s*from\s*['"]react-dom['"]/);
    assert.match(source, /createPortal\([\s\S]*document\.body/);
});
