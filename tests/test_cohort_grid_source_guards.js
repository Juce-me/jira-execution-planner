import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../frontend/src/cohort/CohortGrid.jsx', import.meta.url), 'utf8');

test('Cohort Heatmap hover bubble renders above transformed and clipped graph panels', () => {
    assert.match(source, /import\s*\{\s*createPortal\s*\}\s*from\s*['"]react-dom['"]/);
    assert.match(source, /createPortal\([\s\S]*document\.body/);
});

test('Cohort Heatmap renders the Open column only behind showOpen and takes its empty message as a prop', () => {
    assert.match(source, /function CohortGrid\(\{[^}]*\bshowOpen = true\b/);
    assert.match(source, /function CohortGrid\(\{[^}]*\bemptyMessage = 'No cohort records for current filters\.'/);
    assert.match(source, /\{showOpen && <th className="cohort-row-total">Open<\/th>\}/);
    assert.match(source, /\{showOpen && <td className="cohort-row-metric">\{row\.openCount\}<\/td>\}/);
    assert.match(source, /<div className="cohort-empty">\{emptyMessage\}<\/div>/);
});
