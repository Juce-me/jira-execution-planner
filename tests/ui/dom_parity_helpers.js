const fs = require('node:fs');
const path = require('node:path');

// Opt-in snapshots; use a fresh gitignored directory for each capture run.
async function captureDomParity(page, label, selector) {
    const dir = process.env.JEP_DOM_PARITY_DIR;
    if (!dir) return;
    await page.locator(selector).first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {
        throw new Error(`captureDomParity(${label}): selector not found: ${selector}`);
    });
    await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const animations = document.getAnimations({ subtree: true });
        await Promise.race([
            Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))),
            new Promise((resolve) => window.setTimeout(resolve, 1200)),
        ]);
        await new Promise(requestAnimationFrame);
    });
    const html = await page.locator(selector).first().evaluate((root) => {
        const all = (node) => [node, ...node.querySelectorAll('*')];
        const sources = all(root);
        const clone = root.cloneNode(true);
        const copies = all(clone);
        const referenceAttributes = [
            'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns',
            'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto',
            'for', 'headers', 'list', 'form',
        ];
        const singleReferences = new Set(['for', 'list', 'form', 'aria-activedescendant']);
        const ids = new Map();
        const reactIds = new Map();
        // The full live document is authoritative: labels/descriptions may be outside the capture.
        // Assign by document order, retaining distinct identities and every repeated reference.
        for (const node of root.ownerDocument.querySelectorAll('[id]')) {
            const id = node.id;
            if (!ids.has(id)) ids.set(id, []);
            ids.get(id).push(node);
            if (/^_r_[0-9a-z]+_$/.test(id) && !reactIds.has(id)) reactIds.set(id, `_r_parity_${reactIds.size}_`);
        }
        const canonical = (id) => reactIds.get(id) || id;
        const targets = (value, attribute) => singleReferences.has(attribute)
            ? [value.trim()].filter(Boolean) : value.trim().split(/\s+/).filter(Boolean);
        // Existing Settings tab strips unmount inactive panels. Keep only these exact legacy
        // unselected-tab/panel pairs; the selected sibling must still have its unique live panel.
        // Evidence: AdminSettingsTabs.jsx, EpmSettings.jsx, dashboard.jsx Department tab strip.
        const deferredPanels = new Map([
            ['Admin settings sections', ['admin-settings', ['scope', 'source', 'mapping', 'capacity', 'priorityWeights', 'access', 'performance']]],
            ['Departments settings sections', ['department-settings', ['teams', 'labels', 'boards']]],
            ['EPM settings sections', ['epm-settings', ['scope', 'projects']]],
        ]);
        function isDeferredPanel(node, attribute, id) {
            if (attribute !== 'aria-controls' || node.getAttribute('role') !== 'tab' || node.getAttribute('aria-selected') !== 'false') return false;
            const strip = node.closest('[role="tablist"]');
            const pattern = deferredPanels.get(strip?.getAttribute('aria-label'));
            if (!pattern) return false;
            const [prefix, sections] = pattern;
            if (!sections.some((section) => node.id === `${prefix}-${section}-tab` && id === `${prefix}-${section}-panel`)) return false;
            const selected = [...strip.querySelectorAll('[role="tab"][aria-selected="true"]')];
            if (selected.length !== 1) return false;
            const active = selected[0];
            const section = sections.find((name) => active.id === `${prefix}-${name}-tab` && active.getAttribute('aria-controls') === `${prefix}-${name}-panel`);
            const panels = ids.get(`${prefix}-${section}-panel`) || [];
            return Boolean(section && panels.length === 1 && panels[0].getAttribute('role') === 'tabpanel');
        }
        // StatsRangeControl mounts each exact listbox only while its toggle is open.
        function isDeferredStatsRange(node, attribute, id) {
            if (attribute !== 'aria-controls' || !node.matches('button.sprint-dropdown-toggle[aria-haspopup="listbox"][aria-expanded="false"]')) return false;
            const dropdown = node.parentElement;
            const field = dropdown?.parentElement;
            const filters = field?.parentElement;
            const group = filters?.parentElement;
            if (!dropdown?.matches('.sprint-dropdown[data-range-end]') || !field?.matches('.control-field')
                || !filters?.matches('.view-filters') || !group?.matches('[data-stats-range][role="group"]')) return false;
            const prefix = group.getAttribute('data-stats-range');
            const labels = new Map([
                ['excluded-capacity-sprint', 'Sprint range'],
                ['mono-cross-sprint', 'Sprint range'],
                ['project-track-sprint', 'Sprint range'],
                ['lead-times-quarter', 'Quarter range'],
            ]);
            const end = dropdown.getAttribute('data-range-end');
            return labels.has(prefix) && group.getAttribute('aria-label') === labels.get(prefix)
                && ['start', 'end'].includes(end) && id === `${prefix}-${end}-listbox`;
        }
        sources.forEach((source, index) => {
            const copy = copies[index];
            if (source.id) {
                if (ids.get(source.id)?.length !== 1) throw new Error(`duplicate id in capture: ${source.id}`);
                copy.setAttribute('id', canonical(source.id));
            }
            for (const attribute of referenceAttributes) {
                if (!source.hasAttribute(attribute)) continue;
                const references = targets(source.getAttribute(attribute), attribute);
                for (const id of references) {
                    const matches = ids.get(id) || [];
                    if (!matches.length && !isDeferredPanel(source, attribute, id) && !isDeferredStatsRange(source, attribute, id)) throw new Error(`dangling ${attribute}: ${id}`);
                    if (matches.length > 1) throw new Error(`duplicate ${attribute} target: ${id}`);
                }
                copy.setAttribute(attribute, references.map(canonical).join(' '));
            }
            // Normalize only DOM identity attributes. Text and input values, including strings
            // resembling React ids or fetch timestamps, remain significant.
            if (source.matches('input, select, textarea')) {
                if ('checked' in source) copy.setAttribute('data-parity-checked', String(source.checked));
                if ('value' in source) copy.setAttribute('data-parity-value', String(source.value));
            }
        });
        // This app-owned wall-clock readout is the only text normalization (EpmSettings.jsx).
        for (const meta of clone.querySelectorAll('#epm-settings-projects-panel .epm-projects-header-actions .group-modal-meta[aria-live="polite"]')) {
            for (const node of meta.childNodes) if (node.nodeType === Node.TEXT_NODE) {
                node.textContent = node.textContent.replace(/(\bfetched )\d{1,2}:\d{2}(?:[\s\u202f]?[AP]M)?/gi, '$1HH:MM');
            }
        }
        return clone.outerHTML;
    });
    const normalized = html.replace(/></g, '>\n<');
    fs.mkdirSync(dir, { recursive: true });
    const destination = path.join(dir, `${label}.html`);
    try {
        fs.writeFileSync(destination, `${normalized}\n`, { flag: 'wx' });
    } catch (error) {
        if (error.code === 'EEXIST') throw new Error(`captureDomParity(${label}): duplicate label or nonempty capture directory`);
        throw error;
    }
}

module.exports = { captureDomParity };
