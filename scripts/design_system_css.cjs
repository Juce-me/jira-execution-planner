const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const repoRoot = path.resolve(__dirname, '..');
const typographyProperties = ['font-family', 'font-size', 'border-radius'];

// Split only at CSS syntax boundaries, never inside functions, strings or attributes.
function splitCss(text, separators) {
    const parts = [];
    let start = 0;
    let quote = null;
    let depth = 0;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quote) {
            if (char === '\\') i += 1;
            else if (char === quote) quote = null;
        } else if (char === '"' || char === "'") quote = char;
        else if (char === '(' || char === '[') depth += 1;
        else if (char === ')' || char === ']') depth -= 1;
        else if (depth === 0 && separators.includes(char)) {
            parts.push({ text: text.slice(start, i).trim(), delimiter: char, end: i });
            start = i + 1;
        }
    }
    parts.push({ text: text.slice(start).trim(), delimiter: '', end: text.length });
    return parts;
}

function stripCssComments(css) {
    let result = '';
    let quote = null;
    for (let i = 0; i < css.length; i += 1) {
        const char = css[i];
        if (quote) {
            result += char;
            if (char === '\\') result += css[++i] || '';
            else if (char === quote) quote = null;
        } else if (char === '"' || char === "'") {
            quote = char;
            result += char;
        } else if (char === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2);
            if (end < 0) throw new Error('Unclosed CSS comment');
            result += ' ';
            i = end + 1;
        } else result += char;
    }
    return result;
}

// Formatting whitespace is not a CSS value; preserve quoted text verbatim.
function normalizeValue(value) {
    let result = '';
    let quote = null;
    let pendingSpace = false;
    for (let i = 0; i < value.length; i += 1) {
        const char = value[i];
        if (quote) {
            result += char;
            if (char === '\\') result += value[++i] || '';
            else if (char === quote) quote = null;
        } else if (/\s/.test(char)) pendingSpace = true;
        else {
            if (pendingSpace && result) result += ' ';
            pendingSpace = false;
            result += char;
            if (char === '"' || char === "'") quote = char;
        }
    }
    return result;
}

function parseRules(css, file) {
    const rules = [];
    const counts = new Map();
    let ruleId = 0;
    function walk(text, context) {
        const tokens = splitCss(text, '{};');
        for (let i = 0; i < tokens.length; i += 1) {
            if (tokens[i].delimiter !== '{') continue;
            const header = tokens[i].text;
            const start = tokens[i].end + 1;
            let depth = 1;
            let endIndex = i + 1;
            for (; endIndex < tokens.length; endIndex += 1) {
                if (tokens[endIndex].delimiter === '{') depth += 1;
                if (tokens[endIndex].delimiter === '}') depth -= 1;
                if (depth === 0) break;
            }
            if (depth !== 0) throw new Error(`Unclosed CSS block in ${file}`);
            const body = text.slice(start, tokens[endIndex].end);
            if (header.startsWith('@')) walk(body, [...context, header]);
            else {
                // esbuild preserves modern nesting. Until nested selectors are expanded
                // with their parent context, reject them rather than silently dropping
                // declarations from the ratchet inventory.
                if (splitCss(body, '{}').some(({ delimiter }) => delimiter)) {
                    throw new Error(`Unsupported nested CSS block in ${file}: ${header}`);
                }
                ruleId += 1;
                const currentRuleId = ruleId;
                const declarations = splitCss(body, ';').map(({ text: declaration }) => {
                    const colon = declaration.indexOf(':');
                    return colon < 0 ? null : {
                        property: declaration.slice(0, colon).trim(),
                        value: normalizeValue(declaration.slice(colon + 1).trim()),
                    };
                }).filter(Boolean);
                for (const { text: selector } of splitCss(header, ',')) {
                    const identity = JSON.stringify([file, context, selector]);
                    const occurrence = (counts.get(identity) || 0) + 1;
                    counts.set(identity, occurrence);
                    rules.push({ file, context, selector, occurrence, ruleId: currentRuleId, declarations });
                }
            }
            i = endIndex;
        }
    }
    walk(stripCssComments(css), []);
    return rules;
}

function safeShadow(value) {
    if (value === 'none') return true;
    return splitCss(value, ',').every(({ text: shadow }) =>
        /\binset\b/.test(shadow) || /^0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+\d*\.?\d+px(?:\s|$)/.test(shadow));
}

function analyzeCss(sources) {
    const rules = sources.flatMap(({ file, css }) => parseRules(css, file));
    const values = Object.fromEntries(typographyProperties.map((property) => [property, new Set()]));
    const offenders = {};
    const classHooks = new Set();
    for (const rule of rules) {
        for (const match of rule.selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
            if (/(?:-pill|-chip|-badge|-btn|-button)$/.test(match[1])) classHooks.add(match[1]);
        }
        const propertyCounts = new Map();
        for (const { property, value } of rule.declarations) {
            if (values[property]) values[property].add(value);
            const propertyOccurrence = (propertyCounts.get(property) || 0) + 1;
            propertyCounts.set(property, propertyOccurrence);
            const interactive = /:(?:hover|active)\b/.test(rule.selector);
            const offender = (interactive && ['transform', 'scale', 'translate'].includes(property))
                || (property === 'transition' && splitCss(value, ',').some(({ text }) => /(?:^|\s)all(?:\s|$)/.test(text)))
                || (interactive && property === 'box-shadow' && !safeShadow(value));
            if (offender) {
                const key = JSON.stringify([rule.file, rule.context, rule.selector, rule.occurrence, property, propertyOccurrence]);
                if (Object.hasOwn(offenders, key)) throw new Error(`CSS identity collision: ${key}`);
                offenders[key] = value;
            }
        }
    }
    return {
        version: 1,
        typography: Object.fromEntries(typographyProperties.map((property) => [property, [...values[property]].sort()])),
        offenders: Object.fromEntries(Object.entries(offenders).sort(([a], [b]) => a.localeCompare(b))),
        classHooks: [...classHooks].sort(),
        rules,
    };
}

async function analyzeDashboard() {
    const result = await esbuild.build({
        absWorkingDir: repoRoot,
        entryPoints: ['frontend/src/styles/dashboard.css'],
        bundle: true,
        write: false,
        legalComments: 'none',
    });
    // esbuild's file boundary comments retain import ownership before comments are stripped.
    const css = result.outputFiles[0].text;
    const markers = [...css.matchAll(/^\/\* (frontend\/src\/styles\/[^\n]+\.css) \*\/$/gm)];
    if (!markers.length) throw new Error('esbuild CSS source boundaries missing');
    const sources = markers.map((marker, index) => ({
        file: marker[1],
        css: css.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? css.length),
    }));
    return analyzeCss(sources);
}

function baselineData(analysis) {
    return { version: analysis.version, typography: analysis.typography, offenders: analysis.offenders, classHooks: analysis.classHooks };
}

function compareBaseline(current, baseline, registeredHooks) {
    const errors = [];
    function exactSet(label, actual, allowed) {
        for (const value of actual) if (!allowed.includes(value)) errors.push(`New ${label}: ${value}`);
        for (const value of allowed) if (!actual.includes(value)) errors.push(`Stale ${label}: ${value}`);
    }
    for (const property of typographyProperties) exactSet(property, current.typography[property], baseline.typography[property]);
    for (const [key, value] of Object.entries(current.offenders)) {
        if (!Object.hasOwn(baseline.offenders, key)) errors.push(`New hover offender: ${key} = ${value}`);
        else if (baseline.offenders[key] !== value) errors.push(`Changed hover offender: ${key}: ${baseline.offenders[key]} -> ${value}`);
    }
    for (const key of Object.keys(baseline.offenders)) if (!Object.hasOwn(current.offenders, key)) errors.push(`Stale hover offender: ${key}`);
    exactSet('class hook baseline', current.classHooks, baseline.classHooks);
    exactSet('registered class hook', current.classHooks, registeredHooks);
    return errors;
}

function baselineRegenerationErrors(current, baseline) {
    if (!baseline) return [];
    if (current.version !== baseline.version) return ['Baseline version must remain unchanged'];
    // Regeneration may remove obsolete allowances, but may never create or change one.
    return compareBaseline(current, baseline, current.classHooks)
        .filter((error) => !error.startsWith('Stale '));
}

function readRegistry() {
    const doc = fs.readFileSync(path.join(repoRoot, 'docs/design-system.md'), 'utf8');
    const blocks = [...doc.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
    if (blocks.length !== 1) throw new Error('Expected one design system registry JSON block');
    return JSON.parse(blocks[0][1]);
}

module.exports = { repoRoot, splitCss, parseRules, safeShadow, analyzeCss, analyzeDashboard, baselineData, compareBaseline, baselineRegenerationErrors, readRegistry };
