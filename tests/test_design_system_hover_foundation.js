const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeDashboard, parseRules, splitCss } = require('../scripts/design_system_css.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const inHoverMedia = rule => rule.context.some(context => /^@media\s*\(hover:\s*hover\)$/.test(context));
const declaration = (rule, property) => rule.declarations.find(item => item.property === property)?.value;

// Disabled controls keep their resting cascade because migrated effects require
// both native and ARIA eligibility. No compensating disabled hover rule is needed.
for (const [file, hook] of [
    ['shared/controls.css', '.sprint-dropdown-toggle'],
    ['shared/controls.css', '.header-actions-row button.header-icon-button'],
    ['eng/controls.css', '.team-dropdown-toggle'],
    ['settings/dropdowns.css', '.group-dropdown-toggle'],
]) test(`${file} excludes disabled hover on ${hook}`, () => {
    const matches = parseRules(read(`frontend/src/styles/${file}`), file)
        .filter(rule => rule.selector.startsWith(hook) && rule.selector.includes(':hover'));
    assert.ok(matches.length, `${hook} has a positive hover treatment`);
    for (const rule of matches) {
        assert.ok(inHoverMedia(rule), `${hook} is hover-capability gated`);
        assert.ok(rule.selector.includes(':where(:not(:disabled))'));
        assert.ok(rule.selector.includes(':where(:not([aria-disabled="true"]))'));
    }
});

test('Scenario ordinary and selected toggles use eligible capability-gated rings', () => {
    const rules = parseRules(read('frontend/src/styles/scenario/shell.css'), 'scenario/shell.css');
    for (const [selector, shadow, color] of [
        ['.scenario-toggle:hover', 'var(--hover-overlay), var(--hover-ring)', 'var(--text-primary)'],
        ['.scenario-toggle.active:hover', 'var(--hover-ring)', 'var(--bg-primary)'],
    ]) {
        const rule = rules.find(rule => rule.selector === `${selector}:where(:enabled):where(:not([aria-disabled="true"]))`);
        assert.ok(inHoverMedia(rule));
        assert.equal(declaration(rule, 'box-shadow'), shadow);
        assert.equal(declaration(rule, 'color'), color);
        assert.equal(declaration(rule, 'background'), undefined);
    }
    assert.ok(!rules.some(rule => rule.selector.includes(':hover:where(:disabled')));
    assert.ok(!rules.some(rule => rule.selector.includes('.scenario-summary-toggle:hover')));
    const heading = rules.find(rule => rule.selector === '.scenario-card-toggle:hover:where(:not(:disabled)):where(:not([aria-disabled="true"]))');
    assert.ok(inHoverMedia(heading));
    assert.deepEqual(heading.declarations, [{ property: 'text-decoration', value: 'underline' }]);
    const source = read('frontend/src/scenario/ScenarioView.jsx');
    assert.match(source, /<h4 className="scenario-card-toggle" onClick=/);
    assert.ok(!source.includes('scenario-summary-toggle'));
});

test('Scenario native actions retain original focus separately from ordinary hover and inline underline', () => {
    const rules = parseRules(read('frontend/src/styles/scenario/warnings.css'), 'scenario/warnings.css');
    const link = rules.find(rule => rule.selector === '.scenario-link:hover:where(:enabled):where(:not([aria-disabled="true"]))');
    assert.ok(inHoverMedia(link));
    assert.deepEqual(link.declarations, [
        { property: 'color', value: '#0f172a' },
        { property: 'box-shadow', value: 'var(--hover-overlay), var(--hover-ring-inset)' },
    ]);
    const metadata = rules.find(rule => rule.selector === '.scenario-link:hover:where(:enabled):where(:not([aria-disabled="true"])):where(:not(:focus-visible)) .scenario-link-key');
    assert.ok(inHoverMedia(metadata));
    assert.equal(declaration(metadata,'color'),'var(--text-primary)');
    const focus = rules.find(rule => rule.selector === '.scenario-link:focus-visible');
    assert.equal(declaration(focus,'background'),'rgba(16, 185, 129, 0.14)');
    assert.equal(declaration(focus,'box-shadow'),'inset 0 0 0 1px rgba(16, 185, 129, 0.24)');
    assert.equal(declaration(focus,'outline'),'none');
    const exit = rules.find(rule => rule.selector === '.scenario-focus-exit:hover:where(:enabled):where(:not([aria-disabled="true"]))');
    assert.ok(inHoverMedia(exit));
    assert.equal(declaration(exit,'box-shadow'),'none');
    assert.equal(declaration(exit,'text-decoration'),'underline');
});

test('the three lifts and every transition-all declaration are removed', async () => {
    const { rules } = await analyzeDashboard();
    for (const rule of rules) {
        for (const { property, value } of rule.declarations) {
            if (/:(hover|active)\b/.test(rule.selector) && property === 'transform') {
                assert.notEqual(value, 'translateY(-1px)', `${rule.file}: ${rule.selector}`);
            }
            if (rule.selector.startsWith('.secondary.compact.lift-hover:hover') && property === 'box-shadow') {
                assert.equal(value, 'var(--hover-overlay), var(--hover-ring)', 'the former lift cannot retain elevation');
            }
            if (property === 'transition') {
                assert.ok(!splitCss(value, ',').some(({ text }) => /(?:^|\s)all(?:\s|$)/.test(text)), `${rule.file}: ${rule.selector}`);
            }
        }
    }
});

test('global enabled hover uses the overlay and ring without replacing selected or resting fill', () => {
    const rules = parseRules(read('frontend/src/styles/eng/controls.css'), 'controls.css');
    for (const selector of ['button:hover:where(:enabled):where(:not([aria-disabled="true"]))', 'button.secondary:hover:where(:enabled):where(:not([aria-disabled="true"]))']) {
        const matching = rules.filter(rule => rule.selector === selector);
        assert.equal(matching.length, 1, selector);
        const [rule] = matching;
        assert.ok(inHoverMedia(rule), selector);
        assert.equal(declaration(rule, 'box-shadow'), 'var(--hover-overlay), var(--hover-ring)');
        assert.deepEqual(rule.declarations.map(item => item.property), ['box-shadow']);
    }
    const button = rules.find(rule => rule.selector === 'button');
    assert.equal(declaration(button, 'background'), 'var(--text-primary)');
    assert.equal(declaration(button, 'color'), 'var(--bg-primary)');
    assert.match(declaration(button, 'transition'), /box-shadow var\(--motion-hover\)/);
    const secondary = rules.find(rule => rule.selector === 'button.secondary');
    assert.equal(declaration(secondary, 'background'), 'transparent');
    const disabled = rules.find(rule => rule.selector === 'button:disabled');
    assert.equal(declaration(disabled, 'opacity'), '0.5');
    assert.equal(declaration(disabled, 'cursor'), 'not-allowed');
    assert.ok(!rules.some(rule => /^button(?:\.secondary)?:hover$/.test(rule.selector) && declaration(rule, 'box-shadow')));
});

test('foundation token consumers are hover-capability and enabled gated', async () => {
    const { rules } = await analyzeDashboard();
    const consumers = rules.filter(rule => /:hover\b/.test(rule.selector)
        && rule.declarations.some(({ property, value }) => property === 'box-shadow' && /var\(--hover-/.test(value)));
    assert.ok(consumers.length >= 5, 'global, secondary, status, dependency and capacity consumers');
    for (const rule of consumers) {
        assert.ok(inHoverMedia(rule), `${rule.file}: ${rule.selector} is hover-capability gated`);
        assert.match(rule.selector, /:where\(:(?:enabled|not\(:disabled\))\)/, `${rule.file}: ${rule.selector} excludes disabled controls without increasing specificity`);
        assert.match(rule.selector, /:where\(:not\(\[aria-disabled=(?:"true"|true)\]\)\)/, `${rule.file}: ${rule.selector} excludes aria-disabled controls`);
        assert.ok(!rule.declarations.some(item => ['transform', 'scale', 'translate'].includes(item.property)));
    }
});

test('existing semantic tints, focus, placement, reveal and reset exceptions remain pinned', async () => {
    const current = await analyzeDashboard();
    assert.ok(!Object.keys(current.offenders).some(key => key.includes('stats/priority.css') && key.includes('transform')), 'obsolete capacity/card/button hover resets are gone');
    const status = read('frontend/src/styles/eng/status-transitions.css');
    assert.match(status, /filter:\s*brightness\(0\.94\)/);
    assert.match(status, /button\.status-pill:focus-visible\s*\{\s*outline:\s*2px solid rgba\(47, 128, 237, 0\.65\);\s*outline-offset:\s*1px;/);
    const dependency = read('frontend/src/styles/eng/dependencies.css');
    for (const tint of ['rgba(239, 68, 68, 0.16)', 'rgba(59, 130, 246, 0.16)', 'rgba(22, 163, 74, 0.12)']) assert.ok(dependency.includes(tint), tint);
    assert.match(read('frontend/src/styles/eng/controls.css'), /\.team-dropdown-toggle\.open svg\s*\{\s*transform:\s*rotate\(180deg\)/);
    assert.match(read('frontend/src/styles/settings/group-editor.css'), /transform:\s*translateX\(-105%\)/);
    assert.match(read('frontend/src/styles/eng/alerts.css'), /transform:\s*translate3d\(0, -18px, 0\) rotate\(0deg\)/);
    const priorityRules = parseRules(read('frontend/src/styles/stats/priority.css'), 'priority.css');
    const active = priorityRules.find(rule => rule.selector === '.epic-stat-toggle.active');
    assert.equal(declaration(active, 'background'), '#111');
    assert.equal(declaration(active, 'color'), '#fff');
});


test('shared controls consume their hover vocabulary without movement or fill replacement', () => {
    const gates = ':where(:not(:disabled)):where(:not([aria-disabled="true"]))';
    for (const [file, selector, shadow] of [
        ['shared/controls.css', '.sprint-dropdown-toggle:hover', 'var(--hover-overlay), var(--hover-ring)'],
        ['settings/dropdowns.css', '.group-dropdown-toggle:hover', 'var(--hover-overlay), var(--hover-ring)'],
        ['eng/controls.css', '.team-dropdown-toggle:hover', 'var(--hover-overlay), var(--hover-ring)'],
        ['eng/controls.css', '.team-dropdown-toggle.active-filter:hover', 'var(--hover-ring)'],
        ['eng/export.css', '.team-dropdown-toggle.active-filter.applied-filter:hover', 'var(--hover-ring)'],
    ]) {
        const rules = parseRules(read(`frontend/src/styles/${file}`), file);
        const matches = rules.filter(rule => rule.selector === selector + gates);
        assert.equal(matches.length, 1, selector);
        assert.ok(inHoverMedia(matches[0]), selector);
        const expected = [{ property: 'box-shadow', value: shadow }];
        assert.deepEqual(matches[0].declarations, expected);
    }
    const segmented = parseRules(read('frontend/src/styles/shared/controls.css'), 'shared/controls.css');
    const ordinary = segmented.find(rule => rule.selector === `.segmented-control-button:hover${gates}:where(:not(.active))`);
    assert.ok(ordinary && inHoverMedia(ordinary));
    assert.deepEqual(ordinary.declarations, [
        {property:'color',value:'var(--text-primary)'},
        {property:'box-shadow',value:'var(--hover-overlay), var(--hover-ring)'},
    ]);
    const active = segmented.find(rule => rule.selector === '.segmented-control-button.active');
    assert.equal(declaration(active,'box-shadow'),'0 1px 2px rgba(22, 22, 22, 0.18)');
    assert.equal(declaration(segmented.find(rule => rule.selector === '.segmented-control-button'),'position'),'relative');
    const pseudo = segmented.find(rule => rule.selector === '.segmented-control-button.active::before');
    assert.equal(declaration(pseudo,'position'),'absolute');
    assert.equal(declaration(pseudo,'inset'),'0');
    assert.equal(declaration(pseudo,'border-radius'),'inherit');
    assert.equal(declaration(pseudo,'pointer-events'),'none');
    const selectedRing = segmented.find(rule => rule.selector === `.segmented-control-button.active:hover${gates}::before`);
    assert.ok(selectedRing && inHoverMedia(selectedRing));
    assert.equal(declaration(selectedRing,'box-shadow'),'var(--hover-ring)');
    assert.equal(segmented.filter(rule => declaration(rule,'box-shadow')?.includes('0 1px 2px')).length,1,'selected elevation stays on the resting button');
    for (const selector of ['.header-actions-row button.header-icon-button:hover', '.search-clear:hover']) {
        const rules = parseRules(read('frontend/src/styles/shared/controls.css'), 'controls.css');
        const rule = rules.find(rule => rule.selector === selector + gates);
        assert.ok(rule && inHoverMedia(rule), selector);
        assert.equal(declaration(rule, 'background-image'), selector.includes('header-icon-button') ? 'none' : 'radial-gradient(circle closest-side, #f7f5f0 100%, transparent 100%)');
        assert.equal(declaration(rule, 'box-shadow'), selector.includes('header-icon-button') ? 'var(--hover-overlay), var(--hover-ring)' : 'none');
        assert.deepEqual(rule.declarations.map(item => item.property), ['background-image', 'box-shadow']);
    }
    for (const [file, selector] of [
        ['shared/controls.css', '.sprint-dropdown-option:where(button, [role="button"], [role="option"], [data-project-id], [data-epm-sort], [data-sub-goal-key]):hover'],
        ['shared/header.css', '.sprint-selector-control button.sprint-dropdown-option:hover'],
        ['eng/controls.css', '.team-dropdown-panel label.team-dropdown-option:where(:has(input:not(:disabled))):hover'],
        ['settings/dropdowns.css', '.group-dropdown-option:where(:has(.group-option-tags)):hover'],
    ]) {
        const rules = parseRules(read(`frontend/src/styles/${file}`), file);
        const rule = rules.find(rule => rule.selector === selector + gates);
        assert.ok(rule && inHoverMedia(rule), selector);
        assert.equal(declaration(rule, 'background'), 'var(--bg-primary)');
        assert.ok(!/var\(--hover-/.test(declaration(rule, 'box-shadow') || ''), selector);
    }
});

test('ENG filter and export controls pin the enabled hover vocabulary and preserve placement', () => {
    const gates = ':where(:enabled):where(:not([aria-disabled="true"]))';
    for (const [file, selector, properties] of [
        ['eng/filter-bar.css', '.fb-trigger:hover', { 'box-shadow': 'var(--hover-overlay), var(--hover-ring)' }],
        ['eng/filter-bar.css', '.fb-trigger-icon:where(:not([aria-pressed="true"])):hover', { 'background-image': 'none', 'box-shadow': 'var(--hover-overlay), var(--hover-ring)' }],
        ['eng/filter-bar.css', '.initiative-grouping-control .fb-trigger[aria-pressed="true"]:hover', { 'box-shadow': 'var(--hover-ring)' }],
        ['eng/filter-bar.css', '.chip-more:hover', { 'box-shadow': 'var(--hover-ring-inset)' }],
        ['eng/filter-bar.css', '.chip .x:hover', { 'background-image': 'radial-gradient(circle closest-side, #f7f5f0 100%, transparent 100%)', 'box-shadow': 'none' }],
        ['eng/filter-bar.css', '.chip-clear:hover', { 'text-decoration': 'underline', 'box-shadow': 'none' }],
        ['eng/filter-bar.css', '.pop-head .pop-all:hover', { 'text-decoration': 'underline', 'box-shadow': 'none' }],
        ['eng/filter-bar.css', '.pop-opt:hover', { background: 'var(--bg-primary)', 'box-shadow': 'none' }],
        ['eng/export.css', '.jira-export-menu-item:hover', { background: 'var(--bg-secondary)', color: 'var(--text-primary)', 'box-shadow': 'none' }],
        ['eng/export.css', 'button.toggle:hover', { 'box-shadow': 'var(--hover-overlay), var(--hover-ring)' }],
        ['eng/export.css', 'button.toggle.active:hover', { 'box-shadow': 'var(--hover-ring)' }],
        ['eng/export.css', 'button.toggle.applied-filter:hover', { 'box-shadow': 'var(--hover-ring)' }],
    ]) {
        const rules = parseRules(read(`frontend/src/styles/${file}`), file);
        const matches = rules.filter(rule => rule.selector === selector + gates);
        assert.equal(matches.length, 1, selector);
        assert.ok(inHoverMedia(matches[0]), selector);
        assert.deepEqual(matches[0].declarations, Object.entries(properties).map(([property,value])=>({property,value})), selector);
    }
    const filters = parseRules(read('frontend/src/styles/eng/filter-bar.css'), 'filters.css');
    assert.ok(!filters.some(rule=>rule.selector === ':where(.filterbar, .popover, .planning-review-popover) button:hover'));
    assert.equal(declaration(filters.find(rule=>rule.selector === '.fb-trigger-primary'),'background'),'var(--text-primary)');
    assert.equal(declaration(filters.find(rule=>rule.selector === '.initiative-grouping-control .fb-trigger[aria-pressed="true"]'),'background'),'var(--jira-initiative-accent-surface)');
    assert.equal(declaration(filters.find(rule=>rule.selector === '.initiative-grouping-control:hover .initiative-grouping-tooltip'),'transform'),'translate(-50%, 0)');
    assert.ok(filters.some(rule=>rule.selector === '.filterbar-wrap:has(.initiative-grouping-control:hover)' && declaration(rule,'z-index') === 'calc(var(--sticky-control-overlay-z) + 2)'));
});

test('ENG issue controls consume icons, underlines and unframed options while passive rows stay passive', () => {
    const gates = ':where(:not(:disabled)):where(:not([aria-disabled="true"]))';
    for(const [file,selector,properties] of [
        ['alerts.css','.alerts-panel-toggle:hover',{'box-shadow':'var(--hover-overlay), var(--hover-ring)'}],
        ['alerts.css','button.alerts-panel-summary-pill:hover',{'box-shadow':'var(--hover-ring)'}],
        ['alerts.css','button.alert-story-local-link:hover',{'text-decoration':'underline','box-shadow':'none'}],
        ['issues.css','.task-remove:hover',{'background-image':'none','box-shadow':'var(--hover-overlay), var(--hover-ring)'}],
        ['epics.css','.epic-header button.epic-refresh-button:hover',{'background-image':'none','box-shadow':'var(--hover-overlay), var(--hover-ring)'}],
        ['epics.css','button.epic-track-indicator:hover',{'background-image':'radial-gradient(circle closest-side, var(--bg-primary) 100%, transparent 100%)','box-shadow':'none'}],
        ['board.css','.eng-board .m-close:hover',{'background-image':'radial-gradient(circle closest-side, #f7f5f0 100%, transparent 100%)','box-shadow':'none'}],
        ['board.css','.eng-board .m-desc-retry:hover',{'box-shadow':'var(--hover-overlay), var(--hover-ring)'}],
        ['status-transitions.css','button.issue-person-editor-trigger:hover',{'text-decoration':'underline','box-shadow':'none'}],
        ['status-transitions.css','input.issue-person-editor-trigger:hover',{'border-bottom-color':'currentColor','box-shadow':'none'}],
    ]) {
        const rules=parseRules(read(`frontend/src/styles/eng/${file}`),file);
        const rule=rules.find(rule=>rule.selector===selector+gates);
        assert.ok(rule && inHoverMedia(rule),selector);
        for(const [property,value] of Object.entries(properties)) assert.equal(declaration(rule,property),value,selector);
    }
    for(const option of ['status-transition-option','priority-transition-option','project-track-transition-option','issue-person-editor-option']) {
        const rule=parseRules(read('frontend/src/styles/eng/status-transitions.css'),'status').find(rule=>rule.selector===`.${option}:hover${gates}`);
        assert.ok(rule && inHoverMedia(rule),option);
        assert.equal(declaration(rule,'box-shadow'),'none');
        assert.equal(declaration(rule,'background'),'var(--bg-primary)');
    }
    const issues=parseRules(read('frontend/src/styles/eng/issues.css'),'issues');
    assert.ok(!issues.some(rule=>['.task-item:hover','.task-item.status-killed:hover'].includes(rule.selector)));
    assert.ok(issues.some(rule=>rule.selector==='.task-item:hover .task-remove' && declaration(rule,'opacity')==='1'));
    assert.ok(issues.some(rule=>rule.selector==='.task-remove' && rule.context.includes('@media (hover: none)') && declaration(rule,'opacity')==='1'));
    const requirement=issues.find(rule=>rule.selector===`.task-list:not(.epm-issue-board) .epic-block > .story-requirement-card:hover${gates} .story-requirement-title`);
    assert.ok(requirement && inHoverMedia(requirement));assert.equal(declaration(requirement,'text-decoration'),'underline');
    assert.ok(!parseRules(read('frontend/src/styles/eng/alerts.css'),'alerts').some(rule=>rule.selector.startsWith('.alert-story:hover')));
    const board=parseRules(read('frontend/src/styles/eng/board.css'),'board');
    const outer=board.find(rule=>rule.selector==='.eng-board .ecard:hover' && rule.context.length===0 && declaration(rule,'box-shadow'));
    assert.equal(declaration(outer,'box-shadow'),'0 4px 12px var(--shadow)');
    assert.equal(declaration(outer,'border-color'),'var(--board-column-accent)');
    assert.equal(declaration(outer,'transform'),undefined);
});

test('ENG count and subtask pills retain their existing semantic hover palettes',()=>{
    const alerts=parseRules(read('frontend/src/styles/eng/alerts.css'),'alerts');
    assert.ok(!alerts.some(rule=>rule.selector.startsWith('.alert-chip:hover')),'passive alert counts do not acquire interactive feedback');
    const chip=alerts.find(rule=>rule.selector.startsWith('a.alert-chip:hover'));
    assert.ok(chip&&inHoverMedia(chip));assert.equal(declaration(chip,'background'),'#2a2a2a');assert.equal(declaration(chip,'box-shadow'),'var(--hover-ring)');
    const subtasks=parseRules(read('frontend/src/styles/eng/issues.css'),'issues').find(rule=>rule.selector.startsWith('.story-subtasks-toggle:hover'));
    assert.ok(subtasks&&inHoverMedia(subtasks));assert.equal(declaration(subtasks,'background'),'#eef4ff');assert.equal(declaration(subtasks,'border-color'),'rgba(89, 126, 247, 0.42)');assert.equal(declaration(subtasks,'color'),'var(--text-primary)');assert.equal(declaration(subtasks,'box-shadow'),'var(--hover-ring)');
    const neutralTouch=parseRules(read('frontend/src/styles/eng/board.css'),'board').find(rule=>rule.context.includes('@media (hover: none)') && rule.selector.startsWith('.eng-board .ecard:hover'));
    assert.ok(neutralTouch.selector.includes(':where(:not(.is-rejected))'));
    assert.ok(neutralTouch.selector.includes(':where(:not(.is-dragging))'));
});


test('Planning controls consume enabled vocabulary while chart placement and reveal are preserved', () => {
    const gates=':where(:not(:disabled)):where(:not([aria-disabled="true"]))';
    for(const [file, selector, properties] of [
        ['planning/actions.css','.planning-action-button:hover',{'color':'var(--text-primary)','box-shadow':'var(--hover-overlay), var(--hover-ring)'}],
        ['planning/actions.css','.planning-action-button.active:hover',{'color':'#389e0d','box-shadow':'var(--hover-ring)'}],
        ['planning/actions.css','.planning-icon-button:hover',{'background-image':'none','box-shadow':'var(--hover-overlay), var(--hover-ring)'}],
        ['planning/actions.css','.planning-icon-button[aria-pressed="true"]:hover',{'color':'var(--text-secondary)','background-image':'none','box-shadow':'var(--hover-ring)'}],
        ['planning/selection.css','.task-checkbox:hover',{'box-shadow':'var(--hover-ring)'}],
        ['planning/stat-cards.css','.uncheck-button:hover',{'color':'var(--text-primary)','box-shadow':'var(--hover-overlay), var(--hover-ring)'}],
        ['planning/stat-cards.css','.team-capacity-action:is(button, a):hover',{'background-image':'none','box-shadow':'var(--hover-overlay), var(--hover-ring)'}],
        ['planning/stat-cards.css','.team-capacity-editor-action:is(button):hover',{'background-image':'none','box-shadow':'var(--hover-overlay), var(--hover-ring)'}],
        ['eng/planning-review-table.css','.planning-review-heading:hover',{'box-shadow':'var(--hover-overlay), var(--hover-ring-inset)'}],
        ['eng/planning-review-table.css','.planning-review-input:hover',{'border-bottom-color':'currentColor','box-shadow':'none'}],
        ['eng/planning-review-table.css','.planning-review-capacity .epic-stat-toggle:hover',{'background':'#f1f5f9','color':'var(--text-secondary)','filter':'none','box-shadow':'var(--hover-ring-inset)'}],
        ['eng/planning-review-table.css','.planning-review-capacity .epic-stat-toggle.active:hover',{'background':'#ecfdf5','color':'#166534','border-color':'#86efac','filter':'none','box-shadow':'var(--hover-ring-inset)'}],
        ['eng/planning-review-table.css','.planning-review-column-action:hover',{'background-image':'radial-gradient(circle closest-side, #f7f5f0 100%, transparent 100%)','box-shadow':'none'}],
        ['eng/planning-review-table.css','.planning-review-drag:hover',{'background-image':'radial-gradient(circle closest-side, #f7f5f0 100%, transparent 100%)','box-shadow':'none'}],
        ['eng/planning-review-table.css','.planning-review-jira-link:hover',{'background-image':'radial-gradient(circle closest-side, #f7f5f0 100%, transparent 100%)','box-shadow':'none'}],
    ]) {
        const rule=parseRules(read(`frontend/src/styles/${file}`),file).find(rule=>rule.selector===selector+gates);
        assert.ok(rule&&inHoverMedia(rule),selector);
        assert.deepEqual(rule.declarations,Object.entries(properties).map(([property,value])=>({property,value})),selector);
    }
    const table=parseRules(read('frontend/src/styles/eng/planning-review-table.css'),'table');
    assert.ok(!table.some(rule=>rule.selector==='.planning-review-text-button:hover'),'no rendered consumer for legacy text-button');
    assert.ok(table.some(rule=>rule.selector==='.planning-review-boundary-hit:hover'&&declaration(rule,'box-shadow')==='none'),'transparent boundary hit region stays unframed');
    const capacity=parseRules(read('frontend/src/styles/planning/capacity.css'),'capacity');
    assert.equal(declaration(capacity.find(rule=>rule.selector==='.capacity-bar-fill[data-tooltip]:hover::after'&&declaration(rule,'right')==='0'),'transform'),'none');
    const cards=parseRules(read('frontend/src/styles/planning/stat-cards.css'),'cards');
    assert.ok(cards.some(rule=>rule.selector==='.team-stat-card.team-card:hover .team-capacity-action-rail'&&declaration(rule,'opacity')==='1'));
    assert.ok(cards.some(rule=>rule.context.includes('@media (hover: none)')&&rule.selector==='.team-capacity-action-rail'&&declaration(rule,'opacity')==='1'));
});


test('EPM actions and links use their vocabulary while progress placement and focus stay exact', () => {
    const gates=':where(:not(:disabled)):where(:not([aria-disabled="true"]))';
    const rules=parseRules(read('frontend/src/styles/epm/project-board.css'),'epm/project-board.css');
    const toggle=rules.find(rule=>rule.selector===`.epm-project-board-toggle:hover${gates}`);
    assert.ok(toggle && inHoverMedia(toggle));
    assert.deepEqual(toggle.declarations,[{property:'box-shadow',value:'var(--hover-overlay), var(--hover-ring)'}]);
    const icon=rules.find(rule=>rule.selector===`.group-gear-button.epm-project-collapse-all-button:hover${gates}`);
    assert.ok(icon && inHoverMedia(icon));
    assert.equal(declaration(icon,'background-image'),'none');
    assert.equal(declaration(icon,'background-color'),'var(--epm-project-accent-surface)');
    assert.equal(declaration(icon,'color'),'var(--epm-project-accent)');
    assert.equal(declaration(icon,'border-color'),'var(--epm-project-accent-soft)');
    assert.equal(declaration(icon,'box-shadow'),'var(--hover-overlay), var(--hover-ring)');
    for(const selector of ['.epm-project-board-name-link','.epm-project-board-update-meta-link']) {
        const link=rules.find(rule=>rule.selector===`${selector}:hover${gates}`);
        assert.ok(link && inHoverMedia(link),selector);
        assert.equal(declaration(link,'text-decoration'),'underline');
    }
    const duplicateRules=parseRules(read('frontend/src/styles/epm/duplicates.css'),'epm/duplicates.css');
    const duplicate=duplicateRules.find(rule=>rule.selector===`.epm-duplicates-issues a:hover${gates}`);
    assert.ok(duplicate && inHoverMedia(duplicate));
    assert.equal(declaration(duplicate,'text-decoration'),'underline');
    const focus=rules.find(rule=>rule.selector==='.epm-project-board-toggle:focus-visible');
    assert.equal(declaration(focus,'outline'),'2px solid var(--epm-project-accent)');
    assert.equal(declaration(focus,'outline-offset'),'2px');
    assert.equal(declaration(focus,'box-shadow'),'0 2px 8px rgba(7, 71, 166, 0.12)');
    const reveal=rules.filter(rule=>rule.selector==='.epm-project-progress:hover .epm-project-progress-tooltip');
    assert.equal(reveal.length,2);
    assert.deepEqual(reveal.map(rule=>[rule.context,declaration(rule,'transform')]),[[[],'translateX(-50%) translateY(0)'],[['@media (max-width: 640px)'],'translateY(0)']]);
    const tooltip=rules.find(rule=>rule.selector==='.epm-project-progress-tooltip' && rule.context.length===0);
    assert.equal(declaration(tooltip,'box-shadow'),'0 8px 18px rgba(9, 30, 66, 0.14)');
    assert.equal(declaration(tooltip,'pointer-events'),'none');
    assert.equal(declaration(tooltip,'transform'),'translateX(-50%) translateY(2px)');
});


test('Settings native and mixed consumers use enabled hover vocabulary without passive wrapper effects', () => {
    const gates=':where(:not(:disabled)):where(:not([aria-disabled="true"]))';
    for(const [file,selector,property,value] of [
        ['modal-shell.css','.group-gear-button:hover','background-image','none'],
        ['modal-shell.css','button.group-list-item:where(:not(.active)):hover','box-shadow','var(--hover-overlay), var(--hover-ring)'],
        ['modal-shell.css','button.group-list-item.active:hover','box-shadow','var(--hover-ring)'],
        ['team-groups.css','.group-modal-tab:hover','box-shadow','none'],
        ['team-groups.css','.group-modal-tab:hover','border-bottom-color','var(--text-secondary)'],
        ['team-groups.css','.group-modal-tab.active:hover','box-shadow','none'],
        ['team-groups.css','.group-modal-tab.active:hover','border-bottom-color','var(--accent)'],
        ['group-editor.css','.secondary.compact.danger:hover','box-shadow','var(--hover-overlay), var(--hover-ring)'],
        ['group-board.css','.board-add-column:hover','box-shadow','var(--hover-overlay), var(--hover-ring)'],
        ['group-board.css','.board-pick .component-chip:hover','box-shadow','var(--hover-ring-inset)'],
        ['team-selector.css','.group-list-select:hover','text-decoration','underline'],
        ['onboarding-tour.css','.onboarding-tour-action-next:hover','box-shadow','var(--hover-overlay), var(--hover-ring)'],
    ]) {
        const rule=parseRules(read(`frontend/src/styles/settings/${file}`),file).find(rule=>rule.selector===selector+gates);
        assert.ok(rule&&inHoverMedia(rule),selector);assert.equal(declaration(rule,property),value,selector);
    }
    for(const file of ['modal-shell.css','first-run.css']) {
        const rules=parseRules(read(`frontend/src/styles/settings/${file}`),file);
        assert.ok(!rules.some(rule=>['.group-list-item:hover','.department-first-run-option:hover'].includes(rule.selector)));
    }
    const stars=parseRules(read('frontend/src/styles/settings/team-selector.css'),'team-selector');
    assert.ok(stars.some(rule=>rule.selector==='button.group-list-star[aria-pressed="true"]:hover'+gates && declaration(rule,'box-shadow')==='var(--hover-ring)'));
});


test('Settings group list focus retains its independent original fill and outline',()=>{
    const focus=parseRules(read('frontend/src/styles/settings/modal-shell.css'),'shell').find(rule=>rule.selector==='.group-list-item:focus');
    assert.deepEqual(focus.declarations,[{property:'background',value:'#f7f5f0'},{property:'color',value:'var(--text-primary)'},{property:'box-shadow',value:'none'}]);
    const rules=parseRules(read('frontend/src/styles/settings/team-groups.css'),'groups');
    const outline=rules.find(rule=>rule.selector==='.group-list-item:focus-visible');
    assert.equal(declaration(outline,'outline'),'2px solid var(--accent)');
    assert.equal(declaration(outline,'outline-offset'),'2px');
    const board=parseRules(read('frontend/src/styles/settings/group-board.css'),'board');
    const hover=board.find(rule=>rule.selector.startsWith('.board-column-name:where(:not(:focus)):hover'));
    assert.ok(hover&&inHoverMedia(hover));
    assert.equal(declaration(board.find(rule=>rule.selector==='.board-column-name:focus'),'border-color'),'var(--accent)');

});

// User-approved semantic exception: preserve the old darker red hover and
// use the ring without the white overlay so its hover text remains readable.
test('Settings approved red onboarding exception retains darker hover with ring only',()=>{
    const rules=parseRules(read('frontend/src/styles/settings/onboarding-tour.css'),'tour');
    const hover=rules.find(rule=>rule.selector==='.onboarding-tour-action-skip-all.secondary:hover:where(:not(:disabled)):where(:not([aria-disabled="true"]))');
    assert.ok(hover&&inHoverMedia(hover));
    assert.deepEqual(hover.declarations,[
        {property:'border-color',value:'#d9363e'},
        {property:'background',value:'#d9363e'},
        {property:'color',value:'#fff'},
        {property:'box-shadow',value:'var(--hover-ring)'},
    ]);
    assert.ok(!declaration(hover,'box-shadow').includes('--hover-overlay'));
});


test('Settings Board icon circles preserve original actionable and semantic hover inks',()=>{
    const rules=parseRules(read('frontend/src/styles/settings/group-board.css'),'board');
    for(const [hook,ink] of [['.board-column-drag:hover','var(--accent)'],['.chip-grip:hover','var(--accent)'],['.board-column-star:where(:not([aria-pressed="true"])):hover','#e8b339']]) {
        const rule=rules.find(rule=>rule.selector===hook+':where(:not(:disabled)):where(:not([aria-disabled="true"]))');
        assert.ok(rule&&inHoverMedia(rule));assert.equal(declaration(rule,'color'),ink);
        assert.match(declaration(rule,'background-image'),/^radial-gradient\(circle closest-side,/);
        assert.equal(declaration(rule,'box-shadow'),'none');
    }
    const selected=rules.find(rule=>rule.selector==='.board-column-star[aria-pressed="true"]');
    assert.equal(declaration(selected,'color'),'#e8a11d');
});


test('Stats ownership preserves selection elevation, shared capacity and actual text owners', () => {
    const gates = ':where(:not(:disabled)):where(:not([aria-disabled="true"]))';
    const priority = parseRules(read('frontend/src/styles/stats/priority.css'), 'priority');
    const selected = priority.find(rule => rule.selector === '.stats-card.active');
    assert.equal(declaration(selected,'box-shadow'),'0 10px 22px rgba(26, 26, 26, 0.12)');
    const ring = priority.find(rule => rule.selector === `.stats-card.selectable.active:hover${gates}::before`);
    assert.ok(inHoverMedia(ring));
    assert.equal(declaration(ring,'box-shadow'),'var(--hover-ring)');
    const pseudo = priority.find(rule => rule.selector === '.stats-card.selectable.active::before');
    assert.equal(declaration(pseudo,'pointer-events'),'none');
    for (const owner of ['h4','.stats-note']) {
        const rule = priority.find(rule => rule.selector === `.stats-card.selectable:hover${gates}:where(:not(.active)) ${owner}`);
        assert.ok(inHoverMedia(rule));
        assert.equal(declaration(rule,'color'),'var(--text-primary)');
    }
    for (const [selector,shadow] of [
        ['.stats-toggle:hover','var(--hover-overlay), var(--hover-ring)'],
        ['.stats-toggle.active:hover','var(--hover-ring)'],
    ]) {
        const rule = priority.find(rule => rule.selector === `${selector}:where(:enabled):where(:not([aria-disabled="true"]))`);
        assert.ok(inHoverMedia(rule)); assert.equal(declaration(rule,'box-shadow'),shadow);
    }
    assert.equal(priority.filter(rule => declaration(rule,'box-shadow')?.includes('0 10px 22px')).length,1,'original selected shadow is not duplicated into hover');
    assert.ok(!parseRules(read('frontend/src/styles/stats/summary.css'),'summary').some(rule=>rule.selector==='.planning-button:hover'),'unused legacy hover removed without invented consumer');
    const capacity = parseRules(read('frontend/src/styles/stats/capacity-grid.css'),'capacity');
    assert.equal(declaration(capacity.find(rule=>rule.selector==='.capacity-header-toggle:hover:where(:enabled):where(:not([aria-disabled="true"]))'),'box-shadow'),'var(--hover-overlay), var(--hover-ring-inset)');
    assert.equal(declaration(priority.find(rule=>rule.selector==='.epic-stat-toggle:hover:where(:enabled):where(:not([aria-disabled="true"]))'),'filter'),'brightness(0.94)');
    assert.equal(declaration(parseRules(read('frontend/src/styles/stats/project-track.css'),'track').find(rule=>rule.selector==='.stacked-bar-strip:hover'),'box-shadow'),'0 2px 6px rgba(26, 26, 26, 0.18)');
    const track = parseRules(read('frontend/src/styles/stats/project-track.css'),'track');
    const phase = track.find(rule=>rule.selector===`a.project-track-phase-epic-link:hover${gates}`);
    assert.ok(inHoverMedia(phase)); assert.equal(declaration(phase,'text-decoration'),'underline');
    assert.equal(declaration(track.find(rule=>rule.selector==='a.project-track-phase-epic-link:focus-visible'),'text-decoration'),'underline');
});


test('actual cohort Jira action and Load more use ordinary hover without resting palette replacement',()=>{
    const rules=parseRules(read('frontend/src/styles/stats/cohort.css'),'cohort');
    for(const selector of ['.cohort-open-jira-button:hover:where(:not(:disabled)):where(:not([aria-disabled="true"]))','.cohort-open-more:hover:where(:enabled):where(:not([aria-disabled="true"]))']) {
        const rule=rules.find(rule=>rule.selector===selector);
        assert.ok(inHoverMedia(rule));
        assert.deepEqual(rule.declarations,[{property:'box-shadow',value:'var(--hover-overlay), var(--hover-ring)'}]);
    }
});


test('approved Scenario native lane preserves semantic blue fill with only a clipped eligible ring and separate focus',()=>{
    const rules=parseRules(read('frontend/src/styles/scenario/timeline.css'),'scenario/timeline.css');
    const hover=rules.find(rule=>rule.selector==='.scenario-lane-label:hover:where(:enabled):where(:not([aria-disabled="true"]))');
    assert.ok(inHoverMedia(hover));
    assert.deepEqual(hover.declarations,[
        {property:'background',value:'rgba(59, 130, 246, 0.08)'},
        {property:'color',value:'#0f172a'},
        {property:'box-shadow',value:'var(--hover-ring-inset)'},
    ]);
    const focus=rules.find(rule=>rule.selector==='.scenario-lane-label:focus-visible');
    assert.equal(declaration(focus,'background'),'rgba(59, 130, 246, 0.08)');
    assert.equal(declaration(focus,'color'),'#0f172a');
    assert.equal(declaration(focus,'box-shadow'),'inset 0 0 0 1px rgba(59, 130, 246, 0.18)');
    assert.ok(rules.indexOf(focus)>rules.indexOf(hover),'original focus paint wins on focused hover');
    assert.equal(declaration(rules.find(rule=>rule.selector==='.scenario-lane-label-container'),'overflow'),'hidden');
    for(const [selector,color] of [
        ['.scenario-lane-status.ok','var(--good)'],
        ['.scenario-lane-status.risk','#d4380d'],
        ['.scenario-lane-conflicts','#cf1322'],
    ]) assert.equal(declaration(rules.find(rule=>rule.selector===selector),'color'),color);
    assert.ok(!rules.some(rule=>rule.selector.includes('.scenario-lane-label:hover')&&declaration(rule,'transform')));
});
