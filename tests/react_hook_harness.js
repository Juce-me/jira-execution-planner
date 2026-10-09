const path = require('node:path');
const esbuild = require('esbuild');

// A minimal React runtime (state, refs, effects with cleanup, memo, callback) for driving hooks in node tests:
// `render()` runs the hook and commits its effects, and a state setter only stores the value until the next render.
function createRuntime() {
    const cells = [];
    let index = 0;
    let pending = [];
    const sameDeps = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
    const react = {
        useState(initial) {
            const slot = index++;
            if (!(slot in cells)) {
                const cell = { value: typeof initial === 'function' ? initial() : initial };
                cell.set = (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next; };
                cells[slot] = cell;
            }
            return [cells[slot].value, cells[slot].set];
        },
        useRef(initial) {
            const slot = index++;
            if (!(slot in cells)) cells[slot] = { current: initial };
            return cells[slot];
        },
        useMemo(factory, deps) {
            const slot = index++;
            const previous = cells[slot];
            if (previous && sameDeps(deps, previous.deps)) return previous.value;
            cells[slot] = { value: factory(), deps };
            return cells[slot].value;
        },
        useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
        useEffect(effect, deps) {
            const slot = index++;
            const previous = cells[slot];
            if (!previous) cells[slot] = { deps: undefined, cleanup: null };
            if (!previous || !sameDeps(deps, previous.deps)) pending.push({ slot, effect, deps });
        },
    };
    react.useLayoutEffect = react.useEffect;
    return {
        react,
        begin() { index = 0; pending = []; },
        commit() {
            const run = pending;
            pending = [];
            run.forEach(({ slot, effect, deps }) => {
                cells[slot].cleanup?.();
                cells[slot].deps = deps;
                cells[slot].cleanup = effect() || null;
            });
        },
        unmount() { cells.forEach(cell => cell?.cleanup?.()); },
    };
}

// Bundles the REAL hook from `entry` and replaces only the externals named in `modules` (and React) with stubs.
function mountBundledHook({ entry, exportName, modules = {}, makeProps }) {
    const runtime = createRuntime();
    const code = esbuild.buildSync({
        entryPoints: [entry],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        external: ['react', ...Object.keys(modules)],
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, name => (name === 'react' ? runtime.react : modules[name]));
    const hook = module.exports[exportName];
    let result;
    return {
        render(overrides = {}) {
            runtime.begin();
            result = hook({ ...makeProps(), ...overrides });
            runtime.commit();
            return result;
        },
        get result() { return result; },
        unmount: () => runtime.unmount(),
    };
}

module.exports = { createRuntime, mountBundledHook };
