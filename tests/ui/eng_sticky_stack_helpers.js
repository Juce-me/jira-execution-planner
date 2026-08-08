async function stickyScrollOffsets(page) {
    return page.evaluate(() => {
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        return [...new Set([0, 160, 420, maxScroll - 1]
            .map((offset) => Math.max(0, Math.min(maxScroll, offset))))];
    });
}

async function snapshotStickyStack(page) {
    return page.evaluate(() => {
        const rect = (node) => {
            const box = node?.getBoundingClientRect();
            return box && {
                top: box.top,
                bottom: box.bottom,
                left: box.left,
                right: box.right,
                width: box.width,
                height: box.height,
            };
        };
        const root = document.documentElement;
        const compactNode = document.querySelector('.compact-sticky-header.is-visible');
        const planningNode = document.querySelector('.planning-panel.open');
        const filterbarWrapNode = document.querySelector('.filterbar-wrap');
        const filterbarNode = filterbarWrapNode?.querySelector('.filterbar');
        const variableOwner = filterbarWrapNode?.closest('.container') || root;
        const epicNodes = [...document.querySelectorAll('.epic-header')];
        const pinnedEpicNode = epicNodes.find((node) => {
            const box = node.getBoundingClientRect();
            const stickyTop = Number.parseFloat(getComputedStyle(node).top);
            return box.bottom > 0 && Number.isFinite(stickyTop) && Math.abs(box.top - stickyTop) <= 1;
        }) || null;
        const compact = rect(compactNode);
        const planning = rect(planningNode);
        const filterbarWrap = rect(filterbarWrapNode);
        const filterbar = rect(filterbarNode);
        const epic = rect(pinnedEpicNode);
        const hitOwner = (box, selector) => {
            if (!box || box.width <= 0 || box.height <= 0) return false;
            const x = Math.max(0, Math.min(document.documentElement.clientWidth - 1, box.left + Math.min(60, box.width / 2)));
            const y = Math.max(0, Math.min(window.innerHeight - 1, box.top + Math.min(10, box.height / 2)));
            return Boolean(document.elementFromPoint(x, y)?.closest(selector));
        };
        return {
            scrollY: window.scrollY,
            compact,
            planning,
            filterbarWrap,
            filterbar,
            epic,
            compactVisible: Boolean(compactNode && compact && compact.height > 0),
            filterbarPinned: Boolean(filterbarWrap && Math.abs(
                filterbarWrap.top - Number.parseFloat(getComputedStyle(filterbarWrapNode).top)
            ) <= 1),
            pinnedEpic: Boolean(pinnedEpicNode),
            filterbarOwnsPoint: hitOwner(filterbar, '.filterbar-wrap'),
            epicOwnsPoint: hitOwner(epic, '.epic-header'),
            filterbarStickyTop: Number.parseFloat(getComputedStyle(variableOwner).getPropertyValue('--filterbar-sticky-top')),
            epicStickyTop: Number.parseFloat(getComputedStyle(variableOwner).getPropertyValue('--epic-sticky-top')),
        };
    });
}

async function collectStickySnapshots(page, settle) {
    const offsets = await stickyScrollOffsets(page);
    const snapshots = [];
    for (const offset of offsets) {
        await page.evaluate((y) => window.scrollTo(0, y), offset);
        await settle(page);
        snapshots.push(await snapshotStickyStack(page));
    }
    return snapshots;
}

module.exports = {
    collectStickySnapshots,
    snapshotStickyStack,
    stickyScrollOffsets,
};
