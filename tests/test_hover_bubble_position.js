const test = require('node:test');
const assert = require('node:assert/strict');

const loadModule = () => import('../frontend/src/ui/hoverBubblePosition.js');

test('resolveFloatingHoverPosition flips inside a bounded chart even on wide viewports', async () => {
    global.window = { innerWidth: 2048, innerHeight: 760 };
    const { resolveFloatingHoverPosition } = await loadModule();

    const point = resolveFloatingHoverPosition({
        x: 1516,
        y: 320,
        boundaryRect: { left: 20, right: 1520, top: 80, bottom: 640 },
        bubbleWidth: 260,
        bubbleHeight: 88,
        edgeGutter: 12,
        pointerGap: 12
    });

    assert.equal(point.side, 'left');
    assert.equal(point.x, 1508);
    assert.equal(point.y, 320);
});

test('resolveFloatingHoverPosition keeps right-side bubbles inside the boundary', async () => {
    global.window = { innerWidth: 2048, innerHeight: 760 };
    const { resolveFloatingHoverPosition } = await loadModule();

    const point = resolveFloatingHoverPosition({
        x: 26,
        y: 90,
        boundaryRect: { left: 20, right: 1520, top: 80, bottom: 640 },
        bubbleWidth: 260,
        bubbleHeight: 88,
        edgeGutter: 12,
        pointerGap: 12
    });

    assert.equal(point.side, 'right');
    assert.equal(point.x, 32);
    assert.equal(point.y, 136);
});

test('resolveFloatingHoverPosition preserves viewport edge and vertical inset clamps', async () => {
    global.window = { innerWidth: 1280, innerHeight: 720 };
    const { resolveFloatingHoverPosition } = await loadModule();

    const point = resolveFloatingHoverPosition({
        x: 1275,
        y: 20,
        bubbleWidth: 220,
        bubbleHeight: 72,
        edgeGutter: 12,
        pointerGap: 12,
        verticalInset: 56
    });

    assert.equal(point.side, 'left');
    assert.equal(point.x, 1268);
    assert.equal(point.y, 56);
});
