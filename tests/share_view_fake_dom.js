// A minimal DOM stand-in for the Share view focus tests (the repo has no jsdom). The modules under test pass their REAL selector strings to it:
// it evaluates compound selectors of tag, .class, [attr], [attr=value] and :not(.class), joined by descendant combinators, and the selector
// results were compared with Chromium's while it was written. Layout is one document-space box per element; a sticky element's viewport top is
// clamped to its sticky offset and to the bottom of its parent, and a collapsed alert body keeps its children's boxes exactly as the real one
// does (max-height 0 with overflow hidden does not remove a child's rect).

// data-epic-key <-> dataset.epicKey
const datasetKey = name => name.replace(/^data-/, '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());

function parseCompound(text) {
    const compound = { tag: null, classes: [], notClasses: [], attributes: [] };
    const token = /([a-z][a-z0-9]*)|\.([A-Za-z0-9_-]+)|\[([A-Za-z0-9_-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]|:not\(\.([A-Za-z0-9_-]+)\)/y;
    for (let index = 0; index < text.length; index = token.lastIndex) {
        token.lastIndex = index;
        const match = token.exec(text);
        if (!match) throw new Error(`Unsupported selector in the DOM stand-in: ${text}`);
        if (match[1]) compound.tag = match[1];
        else if (match[2]) compound.classes.push(match[2]);
        else if (match[3]) compound.attributes.push([datasetKey(match[3]), match[4] ?? match[5]]);
        else compound.notClasses.push(match[6]);
    }
    return compound;
}

function matchesCompound(element, compound) {
    if (compound.tag && element.tagName.toLowerCase() !== compound.tag) return false;
    if (!compound.classes.every(name => element.classList.contains(name))) return false;
    if (compound.notClasses.some(name => element.classList.contains(name))) return false;
    return compound.attributes.every(([name, value]) => (value === undefined ? element.dataset[name] !== undefined : element.dataset[name] === value));
}

function matchesChain(element, chain) {
    if (!matchesCompound(element, chain[chain.length - 1])) return false;
    let index = chain.length - 2;
    for (let ancestor = element.parentElement; ancestor && index >= 0; ancestor = ancestor.parentElement) {
        if (matchesCompound(ancestor, chain[index])) index -= 1;
    }
    return index < 0;
}

const parseSelector = selector => selector.split(',').map(part => part.trim().split(/\s+/).map(parseCompound));

export function createFakeDom({ innerHeight = 800 } = {}) {
    const state = { scrollY: 0, now: 0, nextId: 1, frames: new Map(), timers: new Map() };
    const listeners = new Map();   // `${target}:${name}` -> [{ handler, capture }]
    const listenerApi = target => ({
        addEventListener(name, handler, options) {
            const key = `${target}:${name}`;
            listeners.set(key, [...(listeners.get(key) || []), { handler, capture: options === true || options?.capture === true }]);
        },
        removeEventListener(name, handler, options) {
            const key = `${target}:${name}`;
            const capture = options === true || options?.capture === true;
            listeners.set(key, (listeners.get(key) || []).filter(entry => entry.handler !== handler || entry.capture !== capture));
        },
    });

    class FakeElement {
        constructor(tag, { className = '', id = '', dataset = {}, box = { top: 0, height: 0 }, sticky = null, text = '' } = {}, children = []) {
            this.tagName = tag.toUpperCase();
            this.id = id;
            this.dataset = { ...dataset };
            this.box = { ...box };
            this.sticky = sticky;
            this.textContent = text;
            this.children = [];
            this.parentElement = null;
            this.isConnected = true;
            this.offsetWidth = 0;
            const names = new Set(className.split(/\s+/).filter(Boolean));
            this.classList = { contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name) };
            for (const child of children) this.append(child);
        }
        append(child) { child.parentElement = this; this.children.push(child); return child; }
        descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
        getBoundingClientRect() {
            let top = this.sticky ? Math.max(this.box.top - state.scrollY, this.sticky.top) : this.box.top - state.scrollY;
            // A sticky box stays inside its parent: the end of an Epic pushes its pinned header up.
            const parent = this.parentElement;
            if (this.sticky && parent?.box.height > 0) top = Math.min(top, parent.box.top + parent.box.height - state.scrollY - this.box.height);
            return { top, bottom: top + this.box.height, height: this.box.height };
        }
        closest(selector) {
            const chains = parseSelector(selector);
            for (let node = this; node; node = node.parentElement) if (chains.some(chain => matchesCompound(node, chain[0]))) return node;
            return null;
        }
        querySelectorAll(selector) {
            const chains = parseSelector(selector);
            return this.descendants().filter(node => chains.some(chain => matchesChain(node, chain)));
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        // Moving focus or scrolling an element into view is exactly what a link reveal must never do.
        focus() { throw new Error('focus() must not be called'); }
        scrollIntoView() { throw new Error('scrollIntoView() must not be called'); }
    }

    const document = new FakeElement('html');
    Object.assign(document, { visibilityState: 'visible' }, listenerApi('document'));
    const win = {
        innerHeight,
        get scrollY() { return state.scrollY; },
        scrollCalls: [],
        scrollTo(options) {
            this.scrollCalls.push(options);
            state.scrollY = Math.max(0, options.top);
        },
        getComputedStyle: element => ({ position: element.sticky ? 'sticky' : 'static', top: element.sticky ? `${element.sticky.top}px` : 'auto' }),
        requestAnimationFrame(callback) { const id = state.nextId++; state.frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { state.frames.delete(id); },
        setTimeout(callback, delay) { const id = state.nextId++; state.timers.set(id, { callback, at: state.now + delay }); return id; },
        clearTimeout(id) { state.timers.delete(id); },
    };

    return {
        document, window: win,
        el: (tag, options, children) => new FakeElement(tag, options, children),
        append: (parent, ...nodes) => nodes.forEach(node => parent.append(node)),
        // One animation frame: due timers fire, then every queued rAF callback runs with the frame time.
        step(ms = 16) {
            state.now += ms;
            for (const [id, timer] of [...state.timers]) if (timer.at <= state.now) { state.timers.delete(id); timer.callback(); }
            const frames = [...state.frames];
            state.frames.clear();
            frames.forEach(([, callback]) => callback(state.now));
        },
        stepMs(total) { for (let elapsed = 0; elapsed < total; elapsed += 16) this.step(16); },
        // Time passes without a frame, as in a hidden tab where the browser stops running rAF callbacks.
        advanceClock(ms) { state.now += ms; },
        pendingFrames: () => state.frames.size,
        dispatch(target, event) { for (const entry of [...(listeners.get(`${target}:${event.type}`) || [])]) entry.handler(event); },
        listenerCount: () => [...listeners.values()].reduce((sum, entries) => sum + entries.length, 0),
        setScrollY(value) { state.scrollY = value; },
        // Installs the stand-ins as the globals measureStickyBottom and blinkElement read, and returns the restore function.
        install() {
            const previous = { document: globalThis.document, window: globalThis.window };
            globalThis.document = document;
            globalThis.window = win;
            return () => { globalThis.document = previous.document; globalThis.window = previous.window; };
        },
    };
}
