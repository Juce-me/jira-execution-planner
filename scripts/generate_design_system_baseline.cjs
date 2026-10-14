const fs = require('node:fs');
const path = require('node:path');
const { repoRoot, analyzeDashboard, baselineData, baselineRegenerationErrors, safeShadow, validatedShadowTokens } = require('./design_system_css.cjs');

(async () => {
    const analysis = await analyzeDashboard();
    const baselinePath = path.join(repoRoot, 'tests/design_system_baseline.json');
    const existing = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
    const errors = baselineRegenerationErrors(analysis, existing);
    if (errors.length) throw new Error(`Baseline regeneration rejected:\n${errors.join('\n')}`);
    fs.writeFileSync(baselinePath, `${JSON.stringify(baselineData(analysis), null, 2)}\n`);
    const shadowTokens = validatedShadowTokens(analysis.rules);
    const duplicates = analysis.rules.filter((rule) => rule.occurrence > 1);
    const blocks = new Map();
    for (const rule of analysis.rules) {
        const key = JSON.stringify([rule.file, rule.ruleId]);
        if (!blocks.has(key)) blocks.set(key, { ...rule, selectors: [] });
        blocks.get(key).selectors.push(rule.selector);
    }
    const declarations = [...blocks.values()].flatMap((rule) => rule.declarations);
    const interactiveDeclarations = [...blocks.values()]
        .filter((rule) => rule.selectors.some((selector) => /:(?:hover|active)\b/.test(selector)))
        .flatMap((rule) => rule.declarations);
    console.log(JSON.stringify({
        sourceFiles: new Set(analysis.rules.map((rule) => rule.file)).size,
        hoverSelectors: analysis.rules.filter((rule) => /:hover\b/.test(rule.selector)).length,
        hoverOccurrences: analysis.rules.reduce((count, rule) => count + (rule.selector.match(/:hover\b/g) || []).length, 0),
        hoverSourceFiles: new Set(analysis.rules.filter((rule) => /:hover\b/.test(rule.selector)).map((rule) => rule.file)).size,
        declarations: {
            transformNone: declarations.filter(({ property, value }) => property === 'transform' && value === 'none').length,
            textTransformNone: declarations.filter(({ property, value }) => property === 'text-transform' && value === 'none').length,
            hoverActiveTransformNone: interactiveDeclarations.filter(({ property, value }) => property === 'transform' && value === 'none').length,
            hoverActiveTransformNonNone: interactiveDeclarations.filter(({ property, value }) => property === 'transform' && value !== 'none').length,
            transitionAll: declarations.filter(({ property, value }) => property === 'transition' && /(?:^|[\s,])all(?:[\s,]|$)/.test(value)).length,
            hoverActiveShadowOffenders: interactiveDeclarations.filter(({ property, value }) => property === 'box-shadow' && !safeShadow(value, shadowTokens)).length,
        },
        offenderIdentities: {
            transform: Object.keys(analysis.offenders).filter((key) => JSON.parse(key)[4] === 'transform').length,
            transition: Object.keys(analysis.offenders).filter((key) => JSON.parse(key)[4] === 'transition').length,
            boxShadow: Object.keys(analysis.offenders).filter((key) => JSON.parse(key)[4] === 'box-shadow').length,
        },
        typography: Object.fromEntries(Object.entries(analysis.typography).map(([property, values]) => [property, values.length])),
        offenders: Object.keys(analysis.offenders).length,
        classHooks: analysis.classHooks.length,
        duplicateSelectors: duplicates.map(({ file, context, selector, occurrence }) => ({ file, context, selector, occurrence })),
    }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
