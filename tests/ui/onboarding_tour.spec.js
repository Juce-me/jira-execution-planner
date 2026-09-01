const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { installDashboardShell } = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const harnessUrl = 'http://onboarding-tour.test/';
const controllerHarnessUrl = 'http://onboarding-controller.test/';
let harnessJs;
let controllerHarnessJs;
let productionDashboardJs;
let dashboardCss;

test.beforeAll(() => {
    harnessJs = esbuild.buildSync({
        stdin: {
            resolveDir: repoRoot,
            loader: 'jsx',
            contents: `
                import * as React from 'react';
                import { createRoot } from 'react-dom/client';
                import OnboardingTour from './frontend/src/onboarding/OnboardingTour.jsx';
                import AuthRequiredGate from './frontend/src/components/AuthRequiredGate.jsx';
                import { publishAuthenticationRequired } from './frontend/src/api/authRequired.js';
                import PriorityTransitionMenu from './frontend/src/issues/PriorityTransitionMenu.jsx';
                import ProjectTrackTransitionMenu from './frontend/src/issues/ProjectTrackTransitionMenu.jsx';
                import StatusTransitionMenu from './frontend/src/issues/StatusTransitionMenu.jsx';

                function Harness() {
                    const [run, setRun] = React.useState(false);
                    const [done, setDone] = React.useState(false);
                    const [pending, setPending] = React.useState(false);
                    const [showPrimary, setShowPrimary] = React.useState(true);
                    const [showGroup, setShowGroup] = React.useState(true);
                    const [skipCount, setSkipCount] = React.useState(0);
                    const [engReadiness, setEngReadiness] = React.useState('settled');
                    const [hierarchyMask, setHierarchyMask] = React.useState(7);
                    const [editingMask, setEditingMask] = React.useState(7);
                    const [priorityVersion, setPriorityVersion] = React.useState(0);
                    const [showPriority, setShowPriority] = React.useState(true);
                    const [priorityOffscreen, setPriorityOffscreen] = React.useState(false);
                    const [dashboardFieldTop, setDashboardFieldTop] = React.useState(470);
                    const [showPriorityDuplicate, setShowPriorityDuplicate] = React.useState(false);
                    const [showSiblingPriority, setShowSiblingPriority] = React.useState(false);
                    const [previewSession, setPreviewSession] = React.useState(null);
                    const [openField, setOpenField] = React.useState('');
                    const [previewLoading, setPreviewLoading] = React.useState(false);
                    const [previewError, setPreviewError] = React.useState('');
                    const [previewOptions, setPreviewOptions] = React.useState('ready');
                    const [neighbourLeft, setNeighbourLeft] = React.useState(430);
                    const lifecycleRef = React.useRef([]);
                    const selectionRef = React.useRef([]);
                    const cleanupOrderRef = React.useRef([]);
                    const interactionOrderRef = React.useRef([]);
                    const finishCountRef = React.useRef(0);
                    const descriptorMatches = (left, right) => Boolean(left && right
                        && left.sessionId === right.sessionId
                        && left.stepId === right.stepId
                        && left.fieldKind === right.fieldKind
                        && left.issueKey === right.issueKey
                        && left.targetIdentity === right.targetIdentity);
                    const reportLifecycle = React.useCallback((descriptor, lifecycle) => {
                        lifecycleRef.current.push({ descriptor, ...lifecycle });
                        interactionOrderRef.current.push({ phase: 'lifecycle', fieldKind: descriptor?.fieldKind || '', state: lifecycle?.state || '' });
                        if (lifecycle?.state === 'closed') {
                            cleanupOrderRef.current.push({ phase: 'lifecycle', reason: lifecycle.reason || '' });
                        }
                        setPreviewSession((current) => {
                            if (!descriptorMatches(current, descriptor)) return current;
                            if (current.state === 'closed' && !['loading', 'auth_required'].includes(lifecycle?.state)) return current;
                            return { ...current, ...lifecycle };
                        });
                    }, []);
                    const targetChanged = React.useCallback((descriptor) => {
                        setPreviewSession(descriptor ? { ...descriptor, state: 'closed', reason: '' } : null);
                    }, []);
                    const requestPreviewClose = React.useCallback((descriptor, reason) => {
                        cleanupOrderRef.current.push({ phase: 'request', reason });
                        setOpenField('');
                        reportLifecycle(descriptor, { state: 'closed', reason });
                    }, [reportLifecycle]);
                    const previewFor = React.useCallback((fieldKind, issueKey) => (
                        previewSession?.fieldKind === fieldKind && previewSession?.issueKey === issueKey
                            ? previewSession
                            : null
                    ), [previewSession]);
                    const openPreview = React.useCallback((fieldKind) => {
                        interactionOrderRef.current.push({ phase: 'owner_open', fieldKind });
                        setOpenField(fieldKind);
                        setPreviewLoading(true);
                        setPreviewError('');
                    }, []);
                    const skipTour = React.useCallback(() => {
                        setSkipCount((count) => count + 1);
                        setRun(false);
                    }, []);
                    const finishTour = React.useCallback(() => {
                        finishCountRef.current += 1;
                        setRun(false);
                    }, []);
                    const scrollCountRef = React.useRef(0);
                    const scrollOptionsRef = React.useRef([]);
                    const targetMeasureCountRef = React.useRef(0);
                    const tourRenderCountRef = React.useRef(0);
                    const priorityRef = React.useCallback((node) => {
                        if (!node) return;
                        const target = node.querySelector('[data-priority-transition-trigger]') || node;
                        const nativeScrollIntoView = target.scrollIntoView.bind(target);
                        const nativeGetBoundingClientRect = target.getBoundingClientRect.bind(target);
                        target.scrollIntoView = (options) => {
                            scrollCountRef.current += 1;
                            scrollOptionsRef.current.push(options);
                            nativeScrollIntoView(options);
                        };
                        target.getBoundingClientRect = () => {
                            targetMeasureCountRef.current += 1;
                            return nativeGetBoundingClientRect();
                        };
                    }, []);

                    React.useLayoutEffect(() => {
                        window.__tourHarness = {
                            open: () => { setDone(false); setRun(true); },
                            closeWithDone: () => setDone(true),
                            reopenWithRunUnchanged: () => setDone(false),
                            setPending,
                            removePrimary: () => setShowPrimary(false),
                            removeGroup: () => setShowGroup(false),
                            setReadiness: setEngReadiness,
                            setHierarchyMask,
                            setEditingMask,
                            setPriorityOffscreen,
                            setDashboardFieldTop,
                            setShowPriorityDuplicate,
                            setShowSiblingPriority,
                            setPreviewLoading,
                            setPreviewError,
                            setPreviewOptions,
                            setOpenField,
                            setNeighbourLeft,
                            replacePriority: () => {
                                setShowPriority(false);
                                requestAnimationFrame(() => {
                                    setPriorityVersion((value) => value + 1);
                                    setShowPriority(true);
                                });
                            },
                            scrollCount: () => scrollCountRef.current,
                            scrollOptions: () => [...scrollOptionsRef.current],
                            targetMeasureCount: () => targetMeasureCountRef.current,
                            tourRenderCount: () => tourRenderCountRef.current,
                            lifecycle: () => [...lifecycleRef.current],
                            selections: () => [...selectionRef.current],
                            cleanupOrder: () => [...cleanupOrderRef.current],
                            interactionOrder: () => [...interactionOrderRef.current],
                            previewSession: () => previewSession,
                            emitLifecycle: reportLifecycle,
                            requireAuthentication: () => publishAuthenticationRequired({ loginUrl: '/login?reason=session_expired' }),
                            skipCount,
                            finishCount: () => finishCountRef.current,
                        };
                    });

                    return <>
                        <button id="prior-focus">Prior focus</button>
                        {showPrimary && <button data-onboarding-target="sprint" style={{ position: 'fixed', left: 40, top: 30 }}>Sprint main</button>}
                        <button data-onboarding-target="sprint" style={{ position: 'fixed', left: 520, top: 30 }}>Sprint compact</button>
                        {showGroup && <button data-onboarding-target="group" style={{ position: 'fixed', left: 40, top: 120 }}>Department</button>}
                        <button data-onboarding-target="refresh" style={{ position: 'fixed', left: 40, top: 210 }}>Refresh</button>
                        {Boolean(hierarchyMask & 4) && <div data-onboarding-target="hierarchy-initiative" style={{ position: 'absolute', left: 40, top: 300, width: 180, height: 40 }}>Initiative</div>}
                        {Boolean(hierarchyMask & 2) && <div data-onboarding-target="hierarchy-epic" style={{ position: 'absolute', left: 40, top: 350, width: 180, height: 40 }}>Epic</div>}
                        {Boolean(hierarchyMask & 1) && <div data-onboarding-target="hierarchy-story" style={{ position: 'absolute', left: 40, top: 400, width: 180, height: 40 }}>Story</div>}
                        {Boolean(editingMask & 4) && showPriority && <span
                            key={priorityVersion}
                            ref={priorityRef}
                            style={{ position: 'absolute', left: 40, top: priorityOffscreen ? 1250 + priorityVersion * 900 : dashboardFieldTop }}
                        ><PriorityTransitionMenu
                            issue={{ key: 'EPIC-1' }} fallbackIssueType="Epic" priorityLabel="High"
                            renderPriorityIcon={() => <span className="task-priority-icon high">Priority</span>}
                            isOpen={openField === 'priority'}
                            options={previewOptions === 'empty' ? { priorities: [{ id: 'current', name: 'High' }] } : { priorities: [{ id: '1', name: 'Highest' }, { id: '2', name: 'Medium' }] }}
                            optionsLoading={previewLoading}
                            error={previewError}
                            onOpen={() => openPreview('priority')}
                            onClose={() => setOpenField('')}
                            onSubmit={(value) => selectionRef.current.push({ fieldKind: 'priority', value })}
                            previewOnly={previewFor('priority', 'EPIC-1')}
                            onPreviewLifecycleChange={reportLifecycle}
                        /></span>}
                        {Boolean(editingMask & 4) && showPriorityDuplicate && <button
                            data-onboarding-target="editing-priority"
                            data-issue-kind="epic"
                            aria-haspopup="menu"
                            aria-expanded="false"
                            style={{ position: 'absolute', left: 360, top: 470 }}
                        >Priority visible duplicate</button>}
                        {showSiblingPriority && <span style={{ position: 'absolute', left: 520, top: 470 }}><PriorityTransitionMenu
                            issue={{ key: 'EPIC-2' }} fallbackIssueType="Epic" priorityLabel="Medium"
                            renderPriorityIcon={() => <span className="task-priority-icon medium">Sibling priority</span>}
                            isOpen={openField === 'priority-sibling'}
                            options={{ priorities: [{ id: '3', name: 'Highest' }, { id: '4', name: 'Low' }] }}
                            optionsLoading={previewLoading}
                            error={previewError}
                            onOpen={() => openPreview('priority-sibling')}
                            onClose={() => setOpenField('')}
                            onSubmit={(value) => selectionRef.current.push({ fieldKind: 'priority-sibling', value })}
                            previewOnly={previewFor('priority', 'EPIC-2')}
                            onPreviewLifecycleChange={reportLifecycle}
                        /></span>}
                        {Boolean(editingMask & 2) && <span style={{ position: 'absolute', left: 140, top: dashboardFieldTop }}><ProjectTrackTransitionMenu
                            epicKey="EPIC-1" currentTrack="Flexible" isOpen={openField === 'track'}
                            options={previewOptions === 'empty' ? { options: [{ value: 'Flexible' }] } : { options: [{ value: 'Committed' }, { value: 'Flexible' }] }}
                            optionsLoading={previewLoading} error={previewError}
                            onOpen={() => openPreview('track')} onClose={() => setOpenField('')}
                            onSubmit={(value) => selectionRef.current.push({ fieldKind: 'track', value })}
                            previewOnly={previewFor('track', 'EPIC-1')}
                            onPreviewLifecycleChange={reportLifecycle}
                        /></span>}
                        {Boolean(editingMask & 1) && <span style={{ position: 'absolute', left: 280, top: dashboardFieldTop }}><StatusTransitionMenu
                            issue={{ key: 'EPIC-1' }} fallbackIssueType="Epic" statusLabel="To Do"
                            isOpen={openField === 'status'}
                            options={previewOptions === 'empty' ? { targetStatuses: [{ name: 'To Do' }] } : { targetStatuses: [{ name: 'In Progress' }, { name: 'Done' }] }}
                            optionsLoading={previewLoading} error={previewError}
                            onOpen={() => openPreview('status')} onClose={() => setOpenField('')}
                            onSubmit={(value) => selectionRef.current.push({ fieldKind: 'status', value })}
                            previewOnly={previewFor('status', 'EPIC-1')}
                            onPreviewLifecycleChange={reportLifecycle}
                        /></span>}
                        <button id="neighbour-control" style={{ position: 'absolute', left: neighbourLeft, top: dashboardFieldTop }}>Neighbour</button>
                        <div id="unrelated-portal" aria-hidden="mixed" inert="legacy"><button>Portal action</button></div>
                        <React.Profiler id="onboarding-tour" onRender={() => { tourRenderCountRef.current += 1; }}>
                            <OnboardingTour
                                run={run}
                                onboardingDone={done}
                                engReadiness={engReadiness}
                                actionPending={pending}
                                onSkip={skipTour}
                                onFinish={finishTour}
                                previewSession={previewSession}
                                onPreviewTargetChange={targetChanged}
                                onPreviewLifecycleChange={reportLifecycle}
                                onRequestPreviewClose={requestPreviewClose}
                            />
                        </React.Profiler>
                    </>;
                }

                const root = createRoot(document.getElementById('root'));
                root.render(<AuthRequiredGate><Harness /></AuthRequiredGate>);
                window.__unmountTourHarness = () => root.unmount();
            `,
        },
        bundle: true,
        write: false,
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
    controllerHarnessJs = esbuild.buildSync({
        stdin: {
            resolveDir: repoRoot,
            loader: 'jsx',
            contents: `
                import * as React from 'react';
                import { createRoot } from 'react-dom/client';
                import OnboardingTour from './frontend/src/onboarding/OnboardingTour.jsx';
                import { isOnboardingAvailable } from './frontend/src/onboarding/onboardingSteps.js';
                import { useOnboardingController } from './frontend/src/onboarding/useOnboardingTour.js';

                function ControllerHarness() {
                    const [ready, setReady] = React.useState(false);
                    const [done, setDone] = React.useState(true);
                    const [showSettings, setShowSettings] = React.useState(true);
                    const [dirty, setDirty] = React.useState(false);
                    const [saving, setSaving] = React.useState(false);
                    const [authMode, setAuthMode] = React.useState('atlassian_oauth');
                    const [groupsSource, setGroupsSource] = React.useState('workspace_db');
                    const behaviorRef = React.useRef({ type: 'success' });
                    const writesRef = React.useRef([]);
                    const eventsRef = React.useRef([]);
                    const preservedRef = React.useRef({ sprint: 'S-42', group: 'platform', teams: ['alpha'], favorite: 'platform' });
                    const modeRef = React.useRef({ selectedView: 'epm', planning: true, stats: true, scenario: true, board: true });
                    const savePreference = React.useCallback((nextDone) => {
                        writesRef.current.push(nextDone);
                        const behavior = behaviorRef.current;
                        if (behavior.type === 'deferred') {
                            return new Promise((resolve, reject) => {
                                window.__resolveOnboardingWrite = () => resolve({ onboardingDone: nextDone });
                                window.__rejectOnboardingWrite = () => reject(new Error('Save failed.'));
                            });
                        }
                        if (behavior.type === 'error') {
                            const error = new Error('Save failed.');
                            error.status = behavior.status;
                            error.loginUrl = behavior.loginUrl;
                            return Promise.reject(error);
                        }
                        if (behavior.type === 'auth_required') {
                            const error = new Error('Authentication is required to continue.');
                            error.name = 'AuthenticationRequiredError';
                            error.status = 401;
                            error.code = 'auth_required';
                            error.loginUrl = behavior.loginUrl;
                            return Promise.reject(error);
                        }
                        if (behavior.type === 'mismatch') {
                            return Promise.resolve({ onboardingDone: !nextDone });
                        }
                        return Promise.resolve({ onboardingDone: nextDone });
                    }, []);
                    const prepareCatchUp = React.useCallback(() => {
                        modeRef.current = { selectedView: 'eng', planning: false, stats: false, scenario: false, board: false };
                    }, []);
                    const trackSettingsAction = React.useCallback((section, workflowAction, params) => {
                        eventsRef.current.push({ section, workflowAction, params });
                    }, []);
                    const onboardingAvailable = isOnboardingAvailable(authMode, groupsSource);
                    const controller = useOnboardingController({
                        bootstrapReady: ready && onboardingAvailable,
                        onboardingDone: done,
                        setOnboardingDone: setDone,
                        savePreference,
                        prepareCatchUp,
                        closeSettings: () => setShowSettings(false),
                        trackSettingsAction,
                    });
                    React.useLayoutEffect(() => {
                        window.__onboardingController = {
                            setBootstrap: (nextReady, nextDone) => { setReady(nextReady); setDone(nextDone); },
                            setBehavior: (behavior) => { behaviorRef.current = behavior; },
                            setAvailability: (nextAuthMode, nextGroupsSource) => {
                                setAuthMode(nextAuthMode);
                                setGroupsSource(nextGroupsSource);
                            },
                            setDirty,
                            setSaving,
                            replay: controller.replay,
                            snapshot: () => ({
                                ready, done, showSettings, dirty, saving, authMode, groupsSource,
                                run: controller.run, pending: controller.pending,
                                error: controller.error,
                                writes: [...writesRef.current], events: [...eventsRef.current],
                                preserved: preservedRef.current, mode: modeRef.current,
                            }),
                        };
                    });
                    return <>
                        <button data-onboarding-target="sprint">Sprint</button>
                        <button data-onboarding-target="refresh">Refresh</button>
                        <div data-onboarding-target="hierarchy">Hierarchy</div>
                        {showSettings && onboardingAvailable && (
                            <button
                                type="button"
                                onClick={() => { void controller.replay(); }}
                                disabled={dirty || saving || controller.pending}
                            >Run onboarding again</button>
                        )}
                        <OnboardingTour
                            run={controller.run}
                            onboardingDone={done}
                            onSkip={controller.skip}
                            onFinish={controller.finish}
                            actionPending={controller.pending}
                            actionError={controller.error}
                        />
                    </>;
                }
                createRoot(document.getElementById('root')).render(<ControllerHarness />);
            `,
        },
        bundle: true,
        write: false,
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
    productionDashboardJs = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'dashboard.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
    dashboardCss = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css')],
        bundle: true,
        write: false,
    }).outputFiles[0].text;
});

async function installControllerHarness(page) {
    await page.route(controllerHarnessUrl, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><head><style>${dashboardCss}</style></head><body><div id="root"></div><script>${controllerHarnessJs}</script></body></html>`,
    }));
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto(controllerHarnessUrl);
    await page.waitForFunction(() => Boolean(window.__onboardingController));
}

async function installHarness(page) {
    await page.addInitScript(() => {
        const lifecycle = {
            listenerAdds: { resize: 0, scroll: 0 },
            listenerRemoves: { resize: 0, scroll: 0 },
            authRequiredAdds: 0,
            authRequiredRemoves: 0,
            visualViewportAdds: { resize: 0, scroll: 0 },
            visualViewportRemoves: { resize: 0, scroll: 0 },
            documentListenerAdds: { pointerdown: 0, focusin: 0, keydown: 0 },
            documentListenerRemoves: { pointerdown: 0, focusin: 0, keydown: 0 },
            resizeObservers: 0,
            mutationObservers: 0,
            headings: [],
        };
        window.__tourLifecycle = lifecycle;
        const add = window.addEventListener.bind(window);
        const remove = window.removeEventListener.bind(window);
        window.addEventListener = (type, listener, options) => {
            if (type === 'resize' || type === 'scroll') lifecycle.listenerAdds[type] += 1;
            if (type === 'jep:authentication-required') lifecycle.authRequiredAdds += 1;
            return add(type, listener, options);
        };
        window.removeEventListener = (type, listener, options) => {
            if (type === 'resize' || type === 'scroll') lifecycle.listenerRemoves[type] += 1;
            if (type === 'jep:authentication-required') lifecycle.authRequiredRemoves += 1;
            return remove(type, listener, options);
        };
        const addDocument = document.addEventListener.bind(document);
        const removeDocument = document.removeEventListener.bind(document);
        document.addEventListener = (type, listener, options) => {
            if (type in lifecycle.documentListenerAdds) lifecycle.documentListenerAdds[type] += 1;
            return addDocument(type, listener, options);
        };
        document.removeEventListener = (type, listener, options) => {
            if (type in lifecycle.documentListenerRemoves) lifecycle.documentListenerRemoves[type] += 1;
            return removeDocument(type, listener, options);
        };
        if (window.visualViewport) {
            const addVisualViewport = window.visualViewport.addEventListener.bind(window.visualViewport);
            const removeVisualViewport = window.visualViewport.removeEventListener.bind(window.visualViewport);
            window.visualViewport.addEventListener = (type, listener, options) => {
                if (type === 'resize' || type === 'scroll') lifecycle.visualViewportAdds[type] += 1;
                return addVisualViewport(type, listener, options);
            };
            window.visualViewport.removeEventListener = (type, listener, options) => {
                if (type === 'resize' || type === 'scroll') lifecycle.visualViewportRemoves[type] += 1;
                return removeVisualViewport(type, listener, options);
            };
        }
        const NativeResizeObserver = window.ResizeObserver;
        window.ResizeObserver = class extends NativeResizeObserver {
            constructor(callback) {
                super(callback);
                lifecycle.resizeObservers += 1;
                this.connected = true;
            }
            disconnect() {
                if (this.connected) lifecycle.resizeObservers -= 1;
                this.connected = false;
                return super.disconnect();
            }
        };
        const NativeMutationObserver = window.MutationObserver;
        window.MutationObserver = class extends NativeMutationObserver {
            constructor(callback) {
                super(callback);
                this.tracked = false;
            }
            observe(target, options) {
                if (!this.tracked
                    && target?.id === 'root'
                    && options?.attributeFilter?.includes('aria-hidden')) {
                    lifecycle.mutationObservers += 1;
                    this.tracked = true;
                }
                return super.observe(target, options);
            }
            disconnect() {
                if (this.tracked) lifecycle.mutationObservers -= 1;
                this.tracked = false;
                return super.disconnect();
            }
        };
        add('DOMContentLoaded', () => {
            const headings = new NativeMutationObserver(() => {
                const text = document.querySelector('.onboarding-tour-card h2')?.textContent;
                if (text && lifecycle.headings.at(-1) !== text) lifecycle.headings.push(text);
            });
            headings.observe(document.body, { subtree: true, childList: true, characterData: true });
        });
    });
    await page.route(harnessUrl, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><head><style>${dashboardCss}</style></head><body><button id="outside-focus">Outside</button><div id="root"></div><script>${harnessJs}</script></body></html>`,
    }));
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto(harnessUrl);
    await page.waitForFunction(() => Boolean(window.__tourHarness));
}

async function openTour(page) {
    await page.evaluate(() => window.__tourHarness.open());
    await expect(page.getByRole('dialog')).toBeVisible();
}

async function advanceToHeading(page, heading) {
    for (let index = 0; index < 20; index += 1) {
        if (await page.getByRole('heading', { name: heading }).count()) return;
        await page.getByRole('button', { name: 'Next' }).click();
    }
    throw new Error(`Did not reach onboarding heading: ${heading}; saw ${await page.evaluate(() => window.__tourLifecycle.headings.join(' > '))}`);
}

async function collectTourSteps(page, { advancePreview } = {}) {
    const steps = [];
    for (let index = 0; index < 20; index += 1) {
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        steps.push({
            title: await page.getByRole('heading').textContent(),
            progress: await page.locator('.onboarding-tour-progress').textContent(),
            state: await page.locator('[data-onboarding-tour]').getAttribute('data-onboarding-state'),
        });
        const title = steps.at(-1).title;
        const advanceFallback = async () => {
            const next = page.getByRole('button', { name: 'Next' });
            if (!await next.count()) return false;
            await next.click();
            return true;
        };
        if (/^Preview (?:Priority|Project Track|Status) options$/.test(title) && advancePreview) {
            await advancePreview({ page, title, advanceFallback });
            if (!await page.locator('[data-onboarding-tour]').count()) break;
        } else {
            if (!await advanceFallback()) break;
        }
    }
    return steps;
}

async function advancePreviewOrFallback(page, title, advanceFallback) {
    if (await page.getByRole('button', { name: 'Next' }).count()) {
        expect(await advanceFallback()).toBe(true);
        return;
    }
    const field = title.includes('Priority') ? 'priority'
        : title.includes('Project Track') ? 'project-track'
            : 'status';
    const trigger = page.locator(`[data-${field}-transition-trigger][data-issue-key="EPIC-1"]`);
    await trigger.click();
    await page.evaluate(() => {
        window.__tourHarness.setPreviewError('');
        window.__tourHarness.setPreviewLoading(false);
        window.__tourHarness.setPreviewOptions('ready');
    });
    const menu = page.locator(`[data-${field}-transition-menu]`);
    await expect(menu).toBeFocused();
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-settled', 'ready');
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-focused', 'true');
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-cleanup', 'false');
    await menu.press('Escape');
    await expect(page.getByRole('heading')).not.toHaveText(title);
}

const productionFixtureUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const productionSprintId = 7301;
const productionSprintName = '2026Q3 Sprint 7';
const productionOptionCatalogRoutes = new Set([
    '/api/issues/priorities/options',
    '/api/issues/project-track/options',
    '/api/issues/transitions/options',
]);
const productionOptionCatalogMethods = {
    '/api/issues/priorities/options': 'GET',
    '/api/issues/project-track/options': 'GET',
    '/api/issues/transitions/options': 'POST',
};
const productionMutationRoutes = [
    '/api/issues/priorities',
    '/api/issues/project-track',
    '/api/issues/transitions',
];
const productionFieldContracts = {
    priority: {
        heading: 'Preview Priority options',
        nextHeading: 'Preview Project Track options',
        triggerHook: 'priority',
        menuHook: 'priority',
        optionRoute: '/api/issues/priorities/options',
        mutationRoute: '/api/issues/priorities',
        analyticsEventName: 'issue_priority_action',
        analyticsAction: 'priority_options_open',
        analyticsFeatureName: 'eng_priority_changes',
        errorMessage: 'Priority choices are unavailable.',
    },
    track: {
        heading: 'Preview Project Track options',
        nextHeading: 'Preview Status options',
        triggerHook: 'project-track',
        menuHook: 'project-track',
        optionRoute: '/api/issues/project-track/options',
        mutationRoute: '/api/issues/project-track',
        analyticsEventName: 'issue_project_track_action',
        analyticsAction: 'project_track_options_open',
        analyticsFeatureName: 'eng_project_track_changes',
        errorMessage: 'Project Track choices are unavailable.',
    },
    status: {
        heading: 'Preview Status options',
        nextHeading: 'Continue in Jira',
        triggerHook: 'status',
        menuHook: 'status',
        optionRoute: '/api/issues/transitions/options',
        mutationRoute: '/api/issues/transitions',
        analyticsEventName: 'issue_status_action',
        analyticsAction: 'status_options_open',
        analyticsFeatureName: 'eng_status_transitions',
        errorMessage: 'Status choices are unavailable.',
    },
};

function productionStory(key, epicKey, priority = 'High') {
    return {
        id: key,
        key,
        fields: {
            summary: `${key} synthetic story`,
            status: { name: 'To Do' },
            priority: { name: priority },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Synthetic Owner' },
            updated: '2026-08-01T00:00:00.000+0000',
            customfield_10004: 3,
            epicKey,
            parentSummary: `${epicKey} synthetic epic`,
            projectKey: 'SYN',
            teamId: 'team-synthetic',
            teamName: 'Synthetic Team',
            sprint: [{ id: productionSprintId, name: productionSprintName, state: 'active' }],
            subtaskSummary: null,
        },
    };
}

function productionEpic(key, priority, projectTrack) {
    return {
        key,
        summary: `${key} synthetic epic`,
        status: { name: 'In Progress' },
        priority: { name: priority },
        projectTrack,
        assignee: { displayName: 'Synthetic Lead' },
        teamId: 'team-synthetic',
        teamName: 'Synthetic Team',
        labels: ['synthetic_team_label'],
        sprint: [{ id: productionSprintId, name: productionSprintName, state: 'active' }],
    };
}

function optionResponse(field, mode) {
    if (field === 'priority') {
        return mode === 'empty'
            ? { priorities: [{ id: '2', name: 'High', rank: 20 }], source: 'jira' }
            : { priorities: [{ id: '1', name: 'Highest', rank: 10 }, { id: '2', name: 'High', rank: 20 }, { id: '3', name: 'Medium', rank: 30 }], source: 'jira' };
    }
    if (field === 'track') {
        return mode === 'empty'
            ? { options: [{ value: 'Flexible' }], source: 'jira' }
            : { options: [{ value: 'Flexible' }, { value: 'Committed' }], source: 'jira' };
    }
    return mode === 'empty'
        ? { issues: [], targetStatuses: [] }
        : {
            issues: [{ key: 'SYN-EPIC-A', issueType: 'Epic', currentStatus: 'In Progress', transitions: [] }],
            targetStatuses: [{ name: 'To Do', availableCount: 1, blockedCount: 0 }, { name: 'Done', availableCount: 1, blockedCount: 0 }],
        };
}

async function installProductionOnboardingFixture(page, {
    field = 'priority',
    mode = 'success',
    errorStatus = 403,
} = {}) {
    const calls = [];
    const stories = [
        productionStory('SYN-STORY-A', 'SYN-EPIC-A', 'High'),
        productionStory('SYN-STORY-B', 'SYN-EPIC-B', 'Medium'),
    ];
    const epics = {
        'SYN-EPIC-A': productionEpic('SYN-EPIC-A', 'High', 'Flexible'),
        'SYN-EPIC-B': productionEpic('SYN-EPIC-B', 'Medium', 'Committed'),
    };
    const groupsPayload = {
        version: 1,
        configRevision: 1,
        source: 'workspace_db',
        defaultGroupId: 'group-synthetic',
        groups: [{
            id: 'group-synthetic',
            name: 'Synthetic Department',
            teamIds: ['team-synthetic'],
            teamLabels: { 'team-synthetic': 'synthetic_team_label' },
            labels: ['synthetic_team_label'],
            excludedCapacityEpics: [],
        }],
        preferences: {
            onboardingRequired: false,
            onboardingDone: false,
            customized: true,
            visibleGroupIds: ['group-synthetic'],
            effectiveVisibleGroupIds: ['group-synthetic'],
            activeGroupId: 'group-synthetic',
        },
    };

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installDashboardShell(page);
    await page.route('**/frontend/dist/dashboard.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: productionDashboardJs,
    }));
    await page.route('**/frontend/dist/dashboard.css', route => route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: dashboardCss,
    }));
    await page.route('https://www.googletagmanager.com/**', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '',
    }));
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        let body = null;
        try {
            body = request.postDataJSON();
        } catch (_error) {
            body = request.postData() || null;
        }
        calls.push({
            method: request.method(),
            pathname: url.pathname,
            params: Object.fromEntries(url.searchParams.entries()),
            body,
        });
        const json = (payload, status = 200) => route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(payload),
        });

        if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 204, body: '' });
        if (url.pathname === '/api/auth/status') {
            return json({ authMode: 'atlassian_oauth', authenticated: true, email: 'synthetic@example.invalid' });
        }
        if (url.pathname === '/api/auth/csrf') return json({ csrfToken: 'synthetic-csrf' });
        if (url.pathname === '/api/me/connections/home-token') return json({ connected: false });
        if (url.pathname === '/api/analytics/context') {
            return json({ enabled: true, gtmContainerId: 'GTM-SYNTHETIC', measurementId: 'G-SYNTHETIC', ga4UserId: 'synthetic-user' });
        }
        if (url.pathname === '/api/config') {
            return json({
                jiraUrl: 'https://jira.example.invalid',
                capacityProject: '',
                authMode: 'atlassian_oauth',
                projectsConfigured: true,
                environmentConfigExists: true,
                userCanEditSettings: true,
                groupQueryTemplateEnabled: false,
                epm: { version: 2, labelPrefix: '', scope: {}, projects: {} },
            });
        }
        if (url.pathname === '/api/version') return json({ enabled: false });
        if (url.pathname === '/api/groups-config') return json(groupsPayload);
        if (url.pathname === '/api/projects/selected') return json({ selected: [] });
        if (url.pathname === '/api/stats/priority-weights-config') return json({ weights: [], source: 'test' });
        if (url.pathname === '/api/sprints') {
            return json({ sprints: [{ id: productionSprintId, name: productionSprintName, state: 'active' }] });
        }
        if (url.pathname === '/api/tasks-with-team-name') {
            const purpose = url.searchParams.get('purpose');
            const project = url.searchParams.get('project');
            if (purpose || project === 'tech') return json({ issues: [], epics: {}, epicsInScope: [], names: {} });
            return json({ issues: stories, epics, epicsInScope: Object.values(epics), names: {} });
        }
        if (url.pathname === '/api/issues/subtasks') return json({ parentKey: '', sprint: '', cached: false, summary: null, subtasks: [] });
        if (url.pathname === '/api/missing-info') return json({ issues: [], epics: [], count: 0, epicCount: 0 });
        if (url.pathname === '/api/backlog-epics') return json({ epics: [] });
        if (url.pathname === '/api/capacity') return json({ enabled: false, capacity: [], teams: [], totalCapacity: 0 });
        if (url.pathname === '/api/dependencies') return json({ dependencies: {} });
        if (url.pathname === '/api/me/onboarding' && request.method() === 'POST') {
            return json({ onboardingDone: true });
        }

        const contract = productionFieldContracts[field];
        if (url.pathname === contract.optionRoute) {
            if (mode === 'auth') {
                return json({ error: 'authentication_required', loginUrl: '/login?reason=session_expired' }, 401);
            }
            if (mode === 'error') {
                return json({ error: `${field}_options_failed`, message: contract.errorMessage }, errorStatus);
            }
            return json(optionResponse(field, mode));
        }
        if (url.pathname === '/api/issues/priorities/options') return json(optionResponse('priority', 'success'));
        if (url.pathname === '/api/issues/project-track/options') return json(optionResponse('track', 'success'));
        if (url.pathname === '/api/issues/transitions/options') return json(optionResponse('status', 'success'));
        if (url.pathname === '/api/issues/priorities' || url.pathname === '/api/issues/project-track' || url.pathname === '/api/issues/transitions') {
            return json({ error: 'forbidden_test_mutation' }, 500);
        }
        return json({});
    });
    await page.addInitScript((prefs) => {
        window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs));
    }, {
        selectedView: 'eng',
        selectedSprint: productionSprintId,
        sprintName: productionSprintName,
        activeGroupId: 'group-synthetic',
        showPlanning: false,
        showBoard: false,
        showScenario: false,
        showStats: false,
        showAlertsPanel: false,
    });
    await page.goto(`${productionFixtureUrl}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Choose a sprint' })).toBeVisible({ timeout: 15000 });
    return { calls };
}

function productionTrigger(page, field, issueKey = 'SYN-EPIC-A') {
    const hook = productionFieldContracts[field].triggerHook;
    return page.locator(`[data-${hook}-transition-trigger][data-issue-key="${issueKey}"]`);
}

function productionMenu(page, field, issueKey = 'SYN-EPIC-A') {
    const hook = productionFieldContracts[field].menuHook;
    return page.locator(`[data-${hook}-transition-menu][data-issue-key="${issueKey}"]`);
}

function fieldCalls(calls, pathname, method) {
    return calls.filter(call => call.pathname === pathname && (!method || call.method === method));
}

function assertProductionRequestSafety(calls) {
    productionMutationRoutes.forEach((pathname) => {
        expect(fieldCalls(calls, pathname, 'POST')).toEqual([]);
    });
    const fieldRequests = calls.filter(call => /^\/api\/issues\/(?:priorities|project-track|transitions)(?:\/|$)/.test(call.pathname));
    fieldRequests.forEach((call) => {
        expect(productionOptionCatalogRoutes.has(call.pathname)).toBe(true);
        expect(call.method).toBe(productionOptionCatalogMethods[call.pathname]);
    });
}

const productionOnboardingActionAllowlist = new Set(['started', 'completed', 'skipped']);

function assertNoPreviewMutationAnalytics(events, {
    expectedOnboardingActions = [],
} = {}) {
    expect(events.some(entry => /_change_(?:submit|result)$/.test(entry?.workflow_action || ''))).toBe(false);
    const onboardingEvents = events.filter(entry => (
        entry?.event_name === 'settings_action'
        && entry?.section === 'onboarding'
    ));
    onboardingEvents.forEach((entry) => {
        expect(productionOnboardingActionAllowlist.has(entry.workflow_action)).toBe(true);
    });
    expect(onboardingEvents.map(entry => entry.workflow_action)).toEqual(expectedOnboardingActions);
    events.forEach((entry) => {
        expect(entry).not.toHaveProperty('issue_key');
        expect(entry).not.toHaveProperty('issue_keys');
        expect(entry).not.toHaveProperty('step_id');
        expect(entry).not.toHaveProperty('raw_content');
        expect(JSON.stringify(entry)).not.toMatch(/SYN-(?:EPIC|STORY)|Highest|Medium|Committed|Flexible|To Do|Done/);
    });
}

test('production analytics guard rejects non-taxonomy onboarding step events', () => {
    const allowedActions = ['started', 'completed', 'skipped'];
    const allowedEvents = allowedActions.map(workflowAction => ({
        event_name: 'settings_action',
        section: 'onboarding',
        workflow_action: workflowAction,
    }));
    expect(() => assertNoPreviewMutationAnalytics(allowedEvents, {
        expectedOnboardingActions: allowedActions,
    })).not.toThrow();
    expect(() => assertNoPreviewMutationAnalytics([
        ...allowedEvents,
        {
            event_name: 'settings_action',
            section: 'onboarding',
            workflow_action: 'step_view',
        },
    ], {
        expectedOnboardingActions: [...allowedActions, 'step_view'],
    })).toThrow();
});

async function expectProductionSpotlightAligned(page, field, issueKey = 'SYN-EPIC-A') {
    const hook = productionFieldContracts[field].triggerHook;
    await expect.poll(() => page.locator('.onboarding-tour-spotlight').evaluate((spotlight, selector) => {
        const trigger = document.querySelector(selector);
        if (!trigger) return null;
        const triggerRect = trigger.getBoundingClientRect();
        const spotlightRect = spotlight.getBoundingClientRect();
        return {
            left: Math.round((spotlightRect.left + 6 - triggerRect.left) * 10) / 10,
            top: Math.round((spotlightRect.top + 6 - triggerRect.top) * 10) / 10,
            right: Math.round((spotlightRect.right - 6 - triggerRect.right) * 10) / 10,
            bottom: Math.round((spotlightRect.bottom - 6 - triggerRect.bottom) * 10) / 10,
        };
    }, `[data-${hook}-transition-trigger][data-issue-key="${issueKey}"]`)).toEqual({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    });
}

async function exerciseReadOnlyPreviewInputs(page, field, issueKey = 'SYN-EPIC-A') {
    const contract = productionFieldContracts[field];
    const menu = productionMenu(page, field, issueKey);
    const options = menu.getByRole('menuitem');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(0);

    const activeId = async () => menu.getAttribute('aria-activedescendant');
    const optionId = async index => options.nth(index).getAttribute('id');
    await expect.poll(activeId).toBe(await optionId(0));
    await menu.press('ArrowDown');
    await expect.poll(activeId).toBe(await optionId(optionCount > 1 ? 1 : 0));
    await menu.press('ArrowUp');
    await expect.poll(activeId).toBe(await optionId(0));
    await menu.press('End');
    await expect.poll(activeId).toBe(await optionId(optionCount - 1));
    await menu.press('Home');
    await expect.poll(activeId).toBe(await optionId(0));

    await menu.press('Enter');
    await expect(page.getByRole('heading')).toHaveText(contract.heading);
    await expect(menu).toBeVisible();
    await menu.press(' ');
    await expect(page.getByRole('heading')).toHaveText(contract.heading);
    await expect(menu).toBeVisible();
    const clickableOption = options.last();
    const optionBox = await clickableOption.boundingBox();
    expect(optionBox).not.toBeNull();
    const optionHit = await page.evaluate(({ x, y }) => (
        document.elementFromPoint(x, y)?.closest('[role="menuitem"]')?.id || ''
    ), {
        x: optionBox.x + optionBox.width / 2,
        y: optionBox.y + optionBox.height / 2,
    });
    expect(optionHit).toBe(await clickableOption.getAttribute('id'));
    await page.mouse.click(optionBox.x + optionBox.width / 2, optionBox.y + optionBox.height / 2);
    await expect(page.getByRole('heading')).toHaveText(contract.heading);
    await expect(menu).toBeVisible();
}

async function invokeProductionOwnerBridge(page, field, descriptorOverride) {
    return productionTrigger(page, field).evaluate((node, override) => {
        // Intentional white-box boundary: production exposes no lifecycle event, so this one
        // helper walks the shipped React prop chain to exercise the real dashboard owner bridge.
        const fiberKey = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
        const queue = fiberKey ? [node[fiberKey]] : [];
        const visited = new Set();
        const ownerTrace = [];
        while (queue.length) {
            const fiber = queue.shift();
            if (!fiber || visited.has(fiber)) continue;
            visited.add(fiber);
            const props = fiber.memoizedProps;
            const ownerName = fiber.type?.displayName || fiber.type?.name || String(fiber.elementType || fiber.tag);
            ownerTrace.push(`${ownerName}[preview=${Boolean(props?.previewOnly)},lifecycle=${typeof props?.onPreviewLifecycleChange === 'function'}]`);
            if (props?.previewOnly && typeof props.onPreviewLifecycleChange === 'function') {
                const descriptor = { ...props.previewOnly, ...override };
                props.onPreviewLifecycleChange(descriptor, { state: 'ready', reason: '' });
                const tuple = value => ({
                    sessionId: value.sessionId,
                    stepId: value.stepId,
                    fieldKind: value.fieldKind,
                    issueKey: value.issueKey,
                    targetIdentity: value.targetIdentity,
                });
                return { current: tuple(props.previewOnly), sent: tuple(descriptor) };
            }
            queue.push(fiber.return, fiber.alternate, fiber.alternate?.return);
        }
        throw new Error(`Production onboarding owner bridge was not found. Owner trace: ${ownerTrace.slice(0, 24).join(' > ') || 'empty'}`);
    }, descriptorOverride);
}

async function productionFieldValueSnapshot(page, field, issueKey = 'SYN-EPIC-A') {
    const trigger = productionTrigger(page, field, issueKey);
    return trigger.evaluate(node => ({
        ariaLabel: node.getAttribute('aria-label'),
        text: node.textContent.trim(),
    }));
}

async function productionIssueSnapshot(page, issueKey = 'SYN-EPIC-A') {
    return page.locator(`.epic-block:has([data-issue-key="${issueKey}"])`).first().evaluate((node, key) => {
        const trigger = hook => node.querySelector(`[data-${hook}-transition-trigger][data-issue-key="${key}"]`);
        return {
            key,
            summary: node.querySelector('.epic-link')?.getAttribute('aria-label') || '',
            priority: trigger('priority')?.getAttribute('aria-label') || '',
            track: trigger('project-track')?.getAttribute('aria-label') || '',
            status: trigger('status')?.textContent.trim() || '',
            storyKeys: Array.from(node.querySelectorAll('.task-item[data-task-key]')).map(story => story.dataset.taskKey),
        };
    }, issueKey);
}

async function advanceProductionTourTo(page, heading) {
    for (let index = 0; index < 20; index += 1) {
        if (await page.getByRole('heading', { name: heading }).count()) return;
        const next = page.getByRole('button', { name: 'Next' });
        if (await next.count()) {
            await next.click();
            continue;
        }
        const currentHeading = await page.locator('.onboarding-tour-card h2').textContent();
        const field = Object.keys(productionFieldContracts).find(candidate => (
            productionFieldContracts[candidate].heading === currentHeading
        ));
        if (!field) throw new Error(`Production tour could not reach ${heading}.`);
        await productionTrigger(page, field).click();
        const menu = productionMenu(page, field);
        await expect(menu).toBeFocused();
        await menu.press('Escape');
    }
    throw new Error(`Production tour did not reach ${heading}.`);
}

function assertNoUnsafePreviewAnalytics(events, contract, analyticsOptions) {
    assertNoPreviewMutationAnalytics(events, analyticsOptions);
    const actionEvents = events.filter(entry => entry?.event_name === contract.analyticsEventName);
    expect(actionEvents.filter(entry => entry.workflow_action === contract.analyticsAction)).toHaveLength(1);
    actionEvents.forEach((entry) => {
        expect(entry).toMatchObject({
            event: 'userevent',
            trigger: 'userevent',
            event_type: 'event',
            event_name: contract.analyticsEventName,
            workflow_action: contract.analyticsAction,
            feature_name: contract.analyticsFeatureName,
            source_surface: 'catch_up',
            selected_count_bucket: '1_5',
        });
        expect(['epics', 'stories']).toContain(entry.issue_type_mix);
        expect(entry).not.toHaveProperty('issue_key');
        expect(entry).not.toHaveProperty('issue_keys');
        expect(entry).not.toHaveProperty('step_id');
        expect(entry).not.toHaveProperty('raw_content');
        expect(entry).not.toHaveProperty('priority_bucket');
        expect(entry).not.toHaveProperty('value_state');
        expect(entry).not.toHaveProperty('status_bucket');
        expect(JSON.stringify(entry)).not.toMatch(/SYN-(?:EPIC|STORY)|Highest|Medium|Committed|Flexible|To Do|Done/);
    });
}

test('production Catch Up Priority preview owns only the exact Epic control and never writes Jira', async ({ page }) => {
    const { calls } = await installProductionOnboardingFixture(page, { field: 'priority', mode: 'success' });
    const contract = productionFieldContracts.priority;
    await advanceProductionTourTo(page, contract.heading);

    const target = productionTrigger(page, 'priority');
    const siblingIssue = productionTrigger(page, 'priority', 'SYN-EPIC-B');
    const siblingKind = productionTrigger(page, 'track');
    const identity = await target.getAttribute('data-onboarding-target-identity');
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-state', 'interactive_closed');
    await expectProductionSpotlightAligned(page, 'priority');

    await siblingKind.evaluate(node => node.click());
    await expect(page.getByRole('heading')).toHaveText(contract.heading);
    await expect(productionMenu(page, 'track')).not.toHaveAttribute('data-onboarding-preview-owner', /.+/);
    await siblingKind.evaluate(node => node.click());
    await expect(productionMenu(page, 'track')).toHaveCount(0);
    await expect(page.getByRole('heading')).toHaveText(contract.heading);

    const before = await productionIssueSnapshot(page);
    await target.click();
    const menu = productionMenu(page, 'priority');
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute('data-onboarding-preview-owner', identity);
    await expect(menu.locator('[role="menuitem"]')).toHaveCount(2);
    await expect(menu.locator('button[role="menuitem"]')).toHaveCount(0);
    await expect(menu.locator('[role="menuitem"]:focus')).toHaveCount(0);
    await expect(siblingIssue).toHaveAttribute('aria-expanded', 'false');
    await expect(siblingIssue).not.toHaveAttribute('aria-describedby', /.+/);
    await expect(productionMenu(page, 'priority', 'SYN-EPIC-B')).toHaveCount(0);
    await exerciseReadOnlyPreviewInputs(page, 'priority');
    expect(await productionIssueSnapshot(page)).toEqual(before);
    assertProductionRequestSafety(calls);

    await menu.press('Escape');
    await expect(page.getByRole('heading')).toHaveText(contract.nextHeading);
    await expect(menu).toHaveCount(0);
    assertProductionRequestSafety(calls);
    assertNoUnsafePreviewAnalytics(await page.evaluate(() => window.dataLayer || []), contract);
});

for (const field of ['track', 'status']) {
    const label = field === 'track' ? 'Project Track' : 'Status';
    test(`production Catch Up ${label} preview resolves its exact Epic owner and never writes Jira`, async ({ page }) => {
        const { calls } = await installProductionOnboardingFixture(page, { field, mode: 'success' });
        const contract = productionFieldContracts[field];
        await advanceProductionTourTo(page, contract.heading);

        const target = productionTrigger(page, field);
        const wrongField = field === 'track' ? 'status' : 'priority';
        const wrongTrigger = productionTrigger(page, wrongField);
        const identity = await target.getAttribute('data-onboarding-target-identity');
        await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-state', 'interactive_closed');
        await expectProductionSpotlightAligned(page, field);
        await wrongTrigger.evaluate(node => node.click());
        await expect(page.getByRole('heading')).toHaveText(contract.heading);
        await expect(productionMenu(page, wrongField)).not.toHaveAttribute('data-onboarding-preview-owner', /.+/);
        await wrongTrigger.evaluate(node => node.click());
        await expect(productionMenu(page, wrongField)).toHaveCount(0);

        const before = await productionIssueSnapshot(page);
        await target.click();
        const menu = productionMenu(page, field);
        await expect(menu).toBeFocused();
        await expect(menu).toHaveAttribute('data-onboarding-preview-owner', identity);
        await expect(menu.locator('[role="menuitem"]')).toHaveCount(field === 'track' ? 1 : 2);
        await expect(menu.locator('button[role="menuitem"]')).toHaveCount(0);
        await expect(menu.locator('[role="menuitem"]:focus')).toHaveCount(0);
        await exerciseReadOnlyPreviewInputs(page, field);
        expect(await productionIssueSnapshot(page)).toEqual(before);
        assertProductionRequestSafety(calls);

        await menu.press('Escape');
        await expect(page.getByRole('heading')).toHaveText(contract.nextHeading);
        await expect(menu).toHaveCount(0);
        assertProductionRequestSafety(calls);
        assertNoUnsafePreviewAnalytics(await page.evaluate(() => window.dataLayer || []), contract);
    });
}

for (const field of ['priority', 'track', 'status']) {
    const contract = productionFieldContracts[field];
    const label = field === 'track' ? 'Project Track' : field[0].toUpperCase() + field.slice(1);

    test(`production ${label} same-field sibling remains a normal non-preview control`, async ({ page }) => {
        const { calls } = await installProductionOnboardingFixture(page, { field, mode: 'success' });
        await advanceProductionTourTo(page, contract.heading);
        const sibling = productionTrigger(page, field, 'SYN-EPIC-B');
        await expect(sibling).not.toHaveAttribute('aria-describedby', /.+/);

        await sibling.evaluate(node => node.click());
        const menu = productionMenu(page, field, 'SYN-EPIC-B');
        await expect(menu).toBeVisible();
        await expect(menu).not.toHaveClass(/is-preview-only/);
        await expect(menu).not.toHaveAttribute('data-onboarding-preview-owner', /.+/);
        await expect(menu.locator('button[role="menuitem"]').first()).toBeVisible();
        await expect(menu.locator('[role="menuitem"][aria-disabled="true"]')).toHaveCount(0);
        await expect(page.getByRole('heading')).toHaveText(contract.heading);
        await sibling.evaluate(node => node.click());
        await expect(menu).toHaveCount(0);
        await expect(page.getByRole('heading')).toHaveText(contract.heading);

        assertProductionRequestSafety(calls);
        assertNoUnsafePreviewAnalytics(await page.evaluate(() => window.dataLayer || []), contract);
    });

    test(`production ${label} owner bridge rejects every stale descriptor tuple member`, async ({ page }) => {
        const { calls } = await installProductionOnboardingFixture(page, { field, mode: 'success' });
        await advanceProductionTourTo(page, contract.heading);
        const target = productionTrigger(page, field);
        await expect(target).toHaveAttribute('aria-describedby', /.+/);
        const targetIdentity = await target.getAttribute('data-onboarding-target-identity');
        const expectedTuple = {
            sessionId: expect.any(Number),
            stepId: `editing-${field}`,
            fieldKind: field,
            issueKey: 'SYN-EPIC-A',
            targetIdentity,
        };

        const wrongDescriptors = [
            { sessionId: 'onboarding-stale-session' },
            { stepId: 'editing-stale-step' },
            { fieldKind: field === 'priority' ? 'status' : 'priority' },
            { issueKey: 'SYN-EPIC-B' },
            { targetIdentity: 'stale-target-identity' },
        ];
        for (const override of wrongDescriptors) {
            const bridge = await invokeProductionOwnerBridge(page, field, override);
            expect(bridge.current).toEqual(expectedTuple);
            expect(bridge.sent).toEqual({ ...bridge.current, ...override });
            await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-state', 'interactive_closed');
            await expect(productionMenu(page, field)).toHaveCount(0);
            await expect(page.getByRole('heading')).toHaveText(contract.heading);
        }

        await target.click();
        const menu = productionMenu(page, field);
        await expect(menu).toBeFocused();
        await expect(menu).toHaveAttribute('data-onboarding-preview-owner', targetIdentity);
        await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-state', 'preview_ready');
        await menu.press('Escape');
        await expect(page.getByRole('heading')).toHaveText(contract.nextHeading);
        assertProductionRequestSafety(calls);
        assertNoUnsafePreviewAnalytics(await page.evaluate(() => window.dataLayer || []), contract);
    });
}

test('production dashboard reaches IssueCard Story preview owners when the Epic field target is unavailable', async ({ page }) => {
    const { calls } = await installProductionOnboardingFixture(page, { field: 'priority', mode: 'success' });
    await advanceProductionTourTo(page, 'See the delivery Stories');
    await page.locator('.epic-header [data-priority-transition-trigger]').evaluateAll(nodes => {
        nodes.forEach(node => { node.disabled = true; });
    });
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading')).toHaveText('Preview Priority options');

    const storyPriority = productionTrigger(page, 'priority', 'SYN-STORY-A');
    await expect(storyPriority).toHaveAttribute('aria-describedby', /.+/);
    await expect(storyPriority.locator('xpath=ancestor::*[@data-task-key="SYN-STORY-A"]')).toHaveCount(1);
    await storyPriority.click();
    const storyPriorityMenu = productionMenu(page, 'priority', 'SYN-STORY-A');
    await expect(storyPriorityMenu).toBeFocused();
    await expect(storyPriorityMenu).toHaveAttribute(
        'data-onboarding-preview-owner',
        await storyPriority.getAttribute('data-onboarding-target-identity'),
    );
    await expect(productionMenu(page, 'priority', 'SYN-STORY-B')).toHaveCount(0);
    await expect(productionTrigger(page, 'priority', 'SYN-STORY-B')).not.toHaveAttribute('aria-describedby', /.+/);
    await storyPriorityMenu.press('Escape');

    await expect(page.getByRole('heading')).toHaveText('Preview Project Track options');
    const epicTrack = productionTrigger(page, 'track', 'SYN-EPIC-A');
    await expect(epicTrack).toHaveAttribute('aria-describedby', /.+/);
    await epicTrack.click();
    const trackMenu = productionMenu(page, 'track', 'SYN-EPIC-A');
    await expect(trackMenu).toBeFocused();
    await page.locator('.epic-header [data-status-transition-trigger]').evaluateAll(nodes => {
        nodes.forEach(node => { node.disabled = true; });
    });
    await trackMenu.press('Escape');

    await expect(page.getByRole('heading')).toHaveText('Preview Status options');
    const storyStatus = productionTrigger(page, 'status', 'SYN-STORY-A');
    await expect(storyStatus).toHaveAttribute('aria-describedby', /.+/);
    await expect(storyStatus.locator('xpath=ancestor::*[@data-task-key="SYN-STORY-A"]')).toHaveCount(1);
    await storyStatus.click();
    const storyStatusMenu = productionMenu(page, 'status', 'SYN-STORY-A');
    await expect(storyStatusMenu).toBeFocused();
    await expect(storyStatusMenu).toHaveAttribute(
        'data-onboarding-preview-owner',
        await storyStatus.getAttribute('data-onboarding-target-identity'),
    );
    await expect(productionMenu(page, 'status', 'SYN-STORY-B')).toHaveCount(0);
    await storyStatusMenu.press('Escape');

    assertProductionRequestSafety(calls);
    const analytics = await page.evaluate(() => window.dataLayer || []);
    Object.values(productionFieldContracts).forEach(contract => assertNoUnsafePreviewAnalytics(analytics, contract));
});

for (const field of ['priority', 'track', 'status']) {
    const contract = productionFieldContracts[field];
    const label = field === 'track' ? 'Project Track' : field[0].toUpperCase() + field.slice(1);

    test(`production ${label} explicit-empty preview advances only after close with zero Jira mutation`, async ({ page }) => {
        const { calls } = await installProductionOnboardingFixture(page, { field, mode: 'empty' });
        await advanceProductionTourTo(page, contract.heading);
        const before = await productionFieldValueSnapshot(page, field);
        await productionTrigger(page, field).click();
        const menu = productionMenu(page, field);
        await expect(menu).toBeFocused();
        await expect(menu.locator('[role="menuitem"]')).toHaveCount(0);
        await expect(menu.getByRole('status')).toContainText('0 choices available.');
        await expect(page.getByRole('heading')).toHaveText(contract.heading);
        await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
        expect(await productionFieldValueSnapshot(page, field)).toEqual(before);
        assertProductionRequestSafety(calls);

        await menu.press('Escape');
        await expect(page.getByRole('heading')).toHaveText(contract.nextHeading);
        await expect(menu).toHaveCount(0);
        assertProductionRequestSafety(calls);
        assertNoUnsafePreviewAnalytics(await page.evaluate(() => window.dataLayer || []), contract);
    });

    test(`production ${label} options error closes to an honest fallback Next with zero Jira mutation`, async ({ page }) => {
        const errorStatus = field === 'track' ? 500 : 403;
        const { calls } = await installProductionOnboardingFixture(page, { field, mode: 'error', errorStatus });
        await advanceProductionTourTo(page, contract.heading);
        const before = await productionFieldValueSnapshot(page, field);
        await productionTrigger(page, field).click();
        const menu = productionMenu(page, field);
        await expect(menu).toBeFocused();
        await expect(menu).toContainText(contract.errorMessage);
        await expect(menu.getByRole('status')).toContainText('Choices could not be loaded.');
        await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
        expect(fieldCalls(calls, contract.optionRoute)).toHaveLength(1);
        assertProductionRequestSafety(calls);

        await menu.press('Escape');
        await expect(page.getByRole('heading')).toHaveText(contract.heading);
        await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
        await expect(menu).toHaveCount(0);
        expect(await productionFieldValueSnapshot(page, field)).toEqual(before);
        assertProductionRequestSafety(calls);
        assertNoUnsafePreviewAnalytics(await page.evaluate(() => window.dataLayer || []), contract);
        await page.getByRole('button', { name: 'Next' }).click();
        await expect(page.getByRole('heading')).toHaveText(contract.nextHeading);
    });

    test(`production ${label} options 401 enters the global auth lock and cleans preview state`, async ({ page }) => {
        const { calls } = await installProductionOnboardingFixture(page, { field, mode: 'auth' });
        await advanceProductionTourTo(page, contract.heading);
        await productionTrigger(page, field).click();

        const lock = page.getByRole('alertdialog', { name: 'Sign in required' });
        await expect(lock).toBeVisible();
        await expect(lock.getByRole('link', { name: 'Sign in again' })).toBeFocused();
        await expect(page.locator('[data-onboarding-tour]')).toHaveCount(0);
        await expect(productionMenu(page, field)).toHaveCount(0);
        await expect(page.locator('.onboarding-tour-preview-portal')).toHaveCount(0);
        expect(fieldCalls(calls, contract.optionRoute)).toHaveLength(1);
        assertProductionRequestSafety(calls);
        assertNoUnsafePreviewAnalytics(await page.evaluate(() => window.dataLayer || []), contract);
    });
}

test('production cached Priority and Status repeat previews stay read-only without duplicate options-open events', async ({ page }) => {
    const { calls } = await installProductionOnboardingFixture(page, { field: 'priority', mode: 'success' });
    await advanceProductionTourTo(page, 'Preview Priority options');
    const openClose = async (field) => {
        await productionTrigger(page, field).click();
        const menu = productionMenu(page, field);
        await expect(menu).toBeFocused();
        await menu.press('Escape');
    };

    await openClose('priority');
    await expect(page.getByRole('heading')).toHaveText('Preview Project Track options');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading')).toHaveText('Preview Priority options');
    await openClose('priority');
    expect(fieldCalls(calls, '/api/issues/priorities/options')).toHaveLength(1);
    expect((await page.evaluate(() => window.dataLayer || [])).filter(entry => (
        entry?.event_name === 'issue_priority_action' && entry.workflow_action === 'priority_options_open'
    ))).toHaveLength(1);

    await openClose('track');
    await expect(page.getByRole('heading')).toHaveText('Preview Status options');
    await openClose('status');
    await expect(page.getByRole('heading')).toHaveText('Continue in Jira');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading')).toHaveText('Preview Status options');
    await openClose('status');
    expect(fieldCalls(calls, '/api/issues/transitions/options')).toHaveLength(1);
    expect((await page.evaluate(() => window.dataLayer || [])).filter(entry => (
        entry?.event_name === 'issue_status_action' && entry.workflow_action === 'status_options_open'
    ))).toHaveLength(1);
    assertProductionRequestSafety(calls);
    assertNoPreviewMutationAnalytics(await page.evaluate(() => window.dataLayer || []));
});

test('production Status preview reaches the open terminal step and only explicit Finish persists once', async ({ page }) => {
    const { calls } = await installProductionOnboardingFixture(page, { field: 'status', mode: 'success' });
    await advanceProductionTourTo(page, 'Preview Status options');
    await productionTrigger(page, 'status').click();
    const menu = productionMenu(page, 'status');
    await expect(menu).toBeFocused();
    await menu.press('Escape');
    await expect(page.getByRole('heading')).toHaveText('Continue in Jira');
    expect(fieldCalls(calls, '/api/me/onboarding', 'POST')).toEqual([]);

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading')).toHaveText('Tour complete');
    await expect(page.locator('[data-onboarding-tour]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish' })).toBeVisible();
    expect(fieldCalls(calls, '/api/me/onboarding', 'POST')).toEqual([]);
    assertProductionRequestSafety(calls);

    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.locator('[data-onboarding-tour]')).toHaveCount(0);
    expect(fieldCalls(calls, '/api/me/onboarding', 'POST')).toHaveLength(1);
    expect(fieldCalls(calls, '/api/me/onboarding', 'POST')[0].body).toEqual({ onboardingDone: true });
    assertProductionRequestSafety(calls);
    assertNoUnsafePreviewAnalytics(
        await page.evaluate(() => window.dataLayer || []),
        productionFieldContracts.status,
        { expectedOnboardingActions: ['completed'] },
    );
});

test('step collector delegates preview progression before requiring a Next fallback', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await expect(page.locator('[aria-live="polite"]')).toHaveCount(1);
    await expect(page.locator('.onboarding-tour-progress')).toHaveAttribute('aria-live', 'polite');
    await advanceToHeading(page, 'Preview Priority options');
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
    await page.evaluate(() => { window.__previewCallbackCount = 0; });

    await collectTourSteps(page, {
        advancePreview: async ({ page: callbackPage }) => {
            await callbackPage.evaluate(() => {
                window.__previewCallbackCount += 1;
                window.__tourHarness.closeWithDone();
            });
            await expect(callbackPage.getByRole('dialog')).toHaveCount(0);
        },
    });

    expect(await page.evaluate(() => window.__previewCallbackCount)).toBe(1);
});

test('interactive preview uses an exact clickable hole, real owner lifecycle, and read-only focus model', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    const trigger = page.locator('[data-priority-transition-trigger][data-issue-key="EPIC-1"]');
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
    await expect(page.locator('#root')).not.toHaveAttribute('inert', /.+/);
    const pointerAddsBeforeOpen = await page.evaluate(() => window.__tourLifecycle.documentListenerAdds.pointerdown);

    const hitTest = await trigger.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const points = [
            [rect.left + rect.width / 2, rect.top + rect.height / 2],
            [rect.left + 1, rect.top + rect.height / 2],
            [rect.right - 1, rect.top + rect.height / 2],
            [rect.left + rect.width / 2, rect.top + 1],
            [rect.left + rect.width / 2, rect.bottom - 1],
        ];
        return points.map(([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return hit === node || node.contains(hit);
        });
    });
    expect(hitTest).toEqual([true, true, true, true, true]);
    await trigger.click();
    await expect.poll(() => page.evaluate(() => window.__tourHarness.previewSession()?.state)).toBe('loading');
    expect((await page.evaluate(() => window.__tourHarness.interactionOrder())).slice(0, 2)).toEqual([
        { phase: 'owner_open', fieldKind: 'priority' },
        { phase: 'lifecycle', fieldKind: 'priority', state: 'loading' },
    ]);
    const loadingMenu = page.locator('[data-priority-transition-menu]');
    await expect(loadingMenu).toBeFocused();
    await expect(loadingMenu).toHaveAttribute('aria-label', 'Change priority. Read-only preview.');
    await expect(loadingMenu).not.toHaveAttribute('aria-activedescendant', /.+/);

    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    const menu = page.locator('[data-priority-transition-menu]');
    await expect(menu).toBeVisible();
    expect(await page.evaluate(() => window.__tourLifecycle.documentListenerAdds.pointerdown)).toBe(pointerAddsBeforeOpen);
    await expect(menu).toContainText('Read-only preview');
    await expect(menu).toHaveAttribute('aria-label', 'Change priority. Read-only preview.');
    await expect(menu).toBeFocused();
    const items = menu.getByRole('menuitem');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toHaveAttribute('aria-disabled', 'true');
    await menu.press('End');
    await expect(menu).toHaveAttribute('aria-activedescendant', await items.last().getAttribute('id'));
    await menu.press('Home');
    await expect(menu).toHaveAttribute('aria-activedescendant', await items.first().getAttribute('id'));
    await menu.press('ArrowDown');
    await expect(menu).toHaveAttribute('aria-activedescendant', await items.last().getAttribute('id'));
    await menu.press('Enter');
    await menu.press(' ');
    const optionRect = await items.last().boundingBox();
    await page.mouse.click(optionRect.x + optionRect.width / 2, optionRect.y + optionRect.height / 2);
    await items.last().evaluate((node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.locator('.onboarding-tour-shield').first().dispatchEvent('pointerdown');
    await page.locator('.onboarding-tour-card').dispatchEvent('pointerdown');
    await expect(menu).toBeVisible();
    expect(await page.evaluate(() => window.__tourHarness.previewSession()?.state)).toBe('ready');
    expect(await page.evaluate(() => window.__tourHarness.selections())).toEqual([]);

    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-settled', 'ready');
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-focused', 'true');
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-cleanup', 'false');
    expect((await page.evaluate(() => window.__tourHarness.cleanupOrder()))
        .filter((entry) => entry.reason === 'target_loss')).toEqual([]);
    await trigger.click();
    await expect(page.getByRole('heading')).toHaveText('Preview Project Track options');
    expect((await page.evaluate(() => window.__tourHarness.lifecycle()))
        .filter((entry) => entry.state === 'closed' && entry.reason === 'same_trigger')).toHaveLength(1);
    expect((await page.evaluate(() => window.__tourHarness.cleanupOrder()))
        .filter((entry) => entry.reason === 'target_loss')).toEqual([]);
    const trackTrigger = page.locator('[data-project-track-transition-trigger][data-issue-key="EPIC-1"]');
    await trackTrigger.focus();
    await trackTrigger.press(' ');
    await expect.poll(() => page.evaluate(() => window.__tourHarness.previewSession()?.state)).toBe('loading');
    await trackTrigger.press(' ');
    await expect(page.getByRole('heading')).toHaveText('Preview Project Track options');
    await expect(page.locator('[data-project-track-transition-menu]')).toHaveCount(0);
});

test('interactive explicit-empty preview is labelled, focused, and advances once only after Escape', async ({ page }) => {
    await installHarness(page);
    await page.evaluate(() => window.__tourHarness.setPreviewOptions('empty'));
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    await page.locator('[data-priority-transition-trigger]').click();
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    const menu = page.locator('[data-priority-transition-menu]');
    await expect(menu).toBeFocused();
    await expect(menu).toContainText('No other priorities available.');
    await expect(menu).toHaveAttribute('aria-label', 'Change priority. Read-only preview.');
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-settled', 'empty');
    await menu.press('Escape');
    await expect(page.getByRole('heading')).toHaveText('Preview Project Track options');
});

test('interactive preview announces loading, ready, empty, and error through one polite atomic status', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    await page.locator('[data-priority-transition-trigger]').click();
    const menu = page.locator('[data-priority-transition-menu]');
    const liveStatus = menu.getByRole('status');
    const assertSingleStatus = async (text) => {
        await expect(liveStatus).toHaveCount(1);
        await expect(liveStatus).toHaveAttribute('aria-live', 'polite');
        await expect(liveStatus).toHaveAttribute('aria-atomic', 'true');
        await expect(liveStatus).toContainText(text);
        await expect(menu.getByRole('alert')).toHaveCount(0);
        await expect(page.locator('[aria-live="polite"]')).toHaveCount(1);
        expect(await page.locator('[aria-live="polite"]').evaluate((node) => node === document.querySelector('[data-priority-transition-menu] [role="status"]'))).toBe(true);
        await expect(page.locator('.onboarding-tour-progress')).not.toHaveAttribute('aria-live', /.+/);
    };

    await assertSingleStatus('Loading choices.');
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    await assertSingleStatus('2 choices available.');
    await page.evaluate(() => window.__tourHarness.setPreviewOptions('empty'));
    await assertSingleStatus('0 choices available.');
    await page.evaluate(() => window.__tourHarness.setPreviewError('Priority options failed.'));
    await assertSingleStatus('Choices could not be loaded.');
});

test('interactive ready lifecycle stays render, measure, and focus-listener stable across repeated focus paths', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    const trigger = page.locator('[data-priority-transition-trigger]');
    await trigger.click();
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    const menu = page.locator('[data-priority-transition-menu]');
    await expect(menu).toBeFocused();
    await page.waitForTimeout(50);

    const beforeDuplicate = await page.evaluate(() => ({
        renders: window.__tourHarness.tourRenderCount(),
        measures: window.__tourHarness.targetMeasureCount(),
        focusAdds: window.__tourLifecycle.documentListenerAdds.focusin,
        focusRemoves: window.__tourLifecycle.documentListenerRemoves.focusin,
        keyAdds: window.__tourLifecycle.documentListenerAdds.keydown,
        keyRemoves: window.__tourLifecycle.documentListenerRemoves.keydown,
    }));
    const descriptor = await page.evaluate(() => window.__tourHarness.previewSession());
    for (let index = 0; index < 5; index += 1) {
        await page.evaluate((ownedDescriptor) => {
            window.__tourHarness.emitLifecycle(ownedDescriptor, { state: 'ready', reason: '' });
        }, descriptor);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    }
    for (let index = 0; index < 5; index += 1) {
        await menu.focus();
        await menu.press('Tab');
        await expect(trigger).toBeFocused();
        await trigger.press('Shift+Tab');
        await expect(menu).toBeFocused();
    }
    await page.waitForTimeout(100);
    const afterDuplicate = await page.evaluate(() => ({
        renders: window.__tourHarness.tourRenderCount(),
        measures: window.__tourHarness.targetMeasureCount(),
        focusAdds: window.__tourLifecycle.documentListenerAdds.focusin,
        focusRemoves: window.__tourLifecycle.documentListenerRemoves.focusin,
        keyAdds: window.__tourLifecycle.documentListenerAdds.keydown,
        keyRemoves: window.__tourLifecycle.documentListenerRemoves.keydown,
    }));
    expect(afterDuplicate.renders - beforeDuplicate.renders).toBeLessThanOrEqual(6);
    expect(afterDuplicate.measures - beforeDuplicate.measures).toBeLessThanOrEqual(30);
    expect(afterDuplicate.focusAdds).toBe(beforeDuplicate.focusAdds);
    expect(afterDuplicate.focusRemoves).toBe(beforeDuplicate.focusRemoves);
    expect(afterDuplicate.keyAdds).toBe(beforeDuplicate.keyAdds);
    expect(afterDuplicate.keyRemoves).toBe(beforeDuplicate.keyRemoves);

    const stableCounts = await page.evaluate(() => ({
        renders: window.__tourHarness.tourRenderCount(),
        measures: window.__tourHarness.targetMeasureCount(),
    }));
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => ({
        renders: window.__tourHarness.tourRenderCount(),
        measures: window.__tourHarness.targetMeasureCount(),
    }))).toEqual(stableCounts);
});

test('interactive sibling issue and different field owners cannot become preview or progression evidence', async ({ page }) => {
    await installHarness(page);
    await page.evaluate(() => window.__tourHarness.setShowSiblingPriority(true));
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    const owned = await page.evaluate(() => window.__tourHarness.previewSession());
    const sibling = page.locator('[data-priority-transition-trigger][data-issue-key="EPIC-2"]');
    await sibling.evaluate((node) => node.click());
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    const siblingMenu = page.locator('[data-priority-transition-menu][data-issue-key="EPIC-2"]');
    await expect(siblingMenu).toHaveCount(1);
    await expect(siblingMenu).not.toHaveAttribute('data-onboarding-preview-owner', /.+/);
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.documentListenerAdds.pointerdown)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__tourHarness.previewSession()?.state)).toBe('closed');

    await page.evaluate((descriptor) => {
        window.__tourHarness.emitLifecycle({ ...descriptor, fieldKind: 'track' }, { state: 'ready', reason: '' });
        window.__tourHarness.emitLifecycle({ ...descriptor, issueKey: 'EPIC-2' }, { state: 'closed', reason: 'escape' });
    }, owned);
    await expect(page.getByRole('heading')).toHaveText('Preview Priority options');
    await page.evaluate(() => window.__tourHarness.setOpenField(''));
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.documentListenerRemoves.pointerdown))
        .toBe(await page.evaluate(() => window.__tourLifecycle.documentListenerAdds.pointerdown));

    await page.locator('[data-priority-transition-trigger][data-issue-key="EPIC-1"]').click();
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    const ownedMenu = page.locator('[data-priority-transition-menu][data-issue-key="EPIC-1"]');
    await expect(ownedMenu).toBeFocused();
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-settled', 'ready');
    await ownedMenu.press('Escape');
    await expect(page.getByRole('heading')).toHaveText('Preview Project Track options');
});

test('interactive shields cover visual padding and unrelated portals restore exactly on cleanup', async ({ page }) => {
    await installHarness(page);
    await page.evaluate(() => {
        const portal = document.createElement('div');
        portal.id = 'body-portal';
        portal.setAttribute('aria-hidden', 'mixed');
        portal.setAttribute('inert', 'legacy');
        portal.innerHTML = '<button>Body portal action</button>';
        document.body.appendChild(portal);
    });
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    const trigger = page.locator('[data-priority-transition-trigger][data-issue-key="EPIC-1"]');
    const geometry = await trigger.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const paddingPoint = document.elementFromPoint(rect.left - 3, rect.top + rect.height / 2);
        const outsidePoint = document.elementFromPoint(rect.right + 3, rect.top + rect.height / 2);
        return {
            paddingShield: paddingPoint?.classList.contains('onboarding-tour-shield'),
            outsideShield: outsidePoint?.classList.contains('onboarding-tour-shield'),
        };
    });
    expect(geometry).toEqual({ paddingShield: true, outsideShield: true });
    await expect(page.locator('#body-portal')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#body-portal')).toHaveAttribute('inert', 'legacy');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('#body-portal')).toHaveAttribute('aria-hidden', 'mixed');
    await expect(page.locator('#body-portal')).toHaveAttribute('inert', 'legacy');
    expect(await page.locator('#body-portal').evaluate((node) => node.inert)).toBe(true);
});

test('interactive loading, error fallback, Escape, duplicate lifecycle, and replacement never multi-advance', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    const trigger = page.locator('[data-priority-transition-trigger][data-issue-key="EPIC-1"]');
    await trigger.click();
    await expect.poll(() => page.evaluate(() => window.__tourHarness.previewSession()?.state)).toBe('loading');
    await trigger.click();
    await expect(page.getByRole('heading')).toHaveText('Preview Priority options');
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);

    await trigger.dblclick();
    await expect(page.getByRole('heading')).toHaveText('Preview Priority options');
    await expect(page.locator('[data-priority-transition-menu]')).toHaveCount(0);

    await trigger.click();
    await page.evaluate(() => {
        window.__tourHarness.setPreviewLoading(false);
        window.__tourHarness.setPreviewError('Options unavailable.');
    });
    await expect(page.locator('[data-priority-transition-menu]')).toContainText('Options unavailable.');
    await page.locator('[data-priority-transition-menu]').press('Escape');
    await expect(page.getByRole('heading')).toHaveText('Preview Priority options');
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();

    await page.evaluate(() => {
        window.__tourHarness.setPreviewError('');
        window.__tourHarness.setPreviewOptions('ready');
        window.__tourHarness.replacePriority();
    });
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
    await page.locator('[data-priority-transition-trigger][data-issue-key="EPIC-1"]').click();
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    await expect(page.locator('[data-priority-transition-menu]')).toBeFocused();
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-settled', 'ready');
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-focused', 'true');
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-cleanup', 'false');
    await page.locator('[data-priority-transition-menu]').press('Escape');
    await expect(page.getByRole('heading')).toHaveText('Preview Project Track options');
    await page.evaluate(() => {
        const stale = window.__tourHarness.lifecycle().find((entry) => entry.descriptor.stepId === 'editing-priority')?.descriptor;
        if (stale) window.__tourHarness.setOpenField('');
    });
    await expect(page.getByRole('heading')).toHaveText('Preview Project Track options');
});

test('interactive focus islands, native keyboard activation, section cleanup, and manual fallback isolation remain exact', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    await advanceToHeading(page, 'Preview Priority options');
    const trigger = page.locator('[data-priority-transition-trigger][data-issue-key="EPIC-1"]');
    const back = page.getByRole('button', { name: 'Back' });
    const sectionSkip = page.getByRole('button', { name: 'Skip this section' });
    const tourSkip = page.getByRole('button', { name: 'Skip onboarding' });
    await trigger.focus();
    await trigger.press('Tab');
    await expect(back).toBeFocused();
    await back.press('Tab');
    await expect(sectionSkip).toBeFocused();
    await sectionSkip.press('Tab');
    await expect(tourSkip).toBeFocused();
    await tourSkip.press('Tab');
    await expect(trigger).toBeFocused();
    await trigger.press('Shift+Tab');
    await expect(tourSkip).toBeFocused();
    await trigger.focus();
    await trigger.press('Enter');
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    const menu = page.locator('[data-priority-transition-menu]');
    await expect(menu).toBeFocused();
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-settled', 'ready');
    await menu.press('Tab');
    await expect(trigger).toBeFocused();
    await trigger.press('Tab');
    await expect(back).toBeFocused();
    await back.press('Shift+Tab');
    await expect(trigger).toBeFocused();
    await trigger.press('Shift+Tab');
    await expect(menu).toBeFocused();
    await page.getByRole('button', { name: 'Skip this section' }).click();
    await expect(page.getByRole('heading')).toHaveText('Tour complete');
    const cleanup = await page.evaluate(() => window.__tourHarness.cleanupOrder());
    expect(cleanup).toContainEqual({ phase: 'request', reason: 'cleanup' });
    expect(cleanup.filter((entry) => entry.phase === 'request' && entry.reason === 'cleanup')).toHaveLength(1);
});

test('interactive Escape closes the exact preview once from every focus-island location and advances only settled states', async ({ page }) => {
    await installHarness(page);
    const openPriorityPreview = async (state = 'ready') => {
        await openTour(page);
        if (state === 'empty') await page.evaluate(() => window.__tourHarness.setPreviewOptions('empty'));
        await advanceToHeading(page, 'Preview Priority options');
        await page.locator('[data-priority-transition-trigger]').click();
        if (state !== 'loading') await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
        if (state === 'error') await page.evaluate(() => window.__tourHarness.setPreviewError('Priority options failed.'));
        await expect(page.locator('[data-priority-transition-menu]')).toBeFocused();
    };
    const resetHarness = async () => {
        await page.reload();
        await page.waitForFunction(() => Boolean(window.__tourHarness));
    };
    const readyFocusLocations = [
        '[data-priority-transition-menu]',
        '[data-priority-transition-trigger]',
        'button:has-text("Back")',
        'button:has-text("Skip this section")',
        'button:has-text("Skip onboarding")',
    ];
    for (let index = 0; index < readyFocusLocations.length; index += 1) {
        if (index) await resetHarness();
        await openPriorityPreview('ready');
        const location = page.locator(readyFocusLocations[index]).first();
        await location.focus();
        await location.press('Escape');
        await expect(page.getByRole('heading')).toHaveText('Preview Project Track options');
        await expect(page.locator('[data-priority-transition-menu]')).toHaveCount(0);
        expect((await page.evaluate(() => window.__tourHarness.lifecycle()))
            .filter((entry) => entry.state === 'closed' && entry.reason === 'escape')).toHaveLength(1);
    }

    await resetHarness();
    await openPriorityPreview('loading');
    await page.locator('[data-priority-transition-trigger]').focus();
    await page.locator('[data-priority-transition-trigger]').press('Escape');
    await expect(page.getByRole('heading')).toHaveText('Preview Priority options');
    await expect(page.locator('[data-priority-transition-menu]')).toHaveCount(0);

    await resetHarness();
    await openPriorityPreview('empty');
    await page.getByRole('button', { name: 'Back' }).focus();
    await page.getByRole('button', { name: 'Back' }).press('Escape');
    await expect(page.getByRole('heading')).toHaveText('Preview Project Track options');

    await resetHarness();
    await openPriorityPreview('error');
    await page.getByRole('button', { name: 'Skip onboarding' }).focus();
    await page.getByRole('button', { name: 'Skip onboarding' }).press('Escape');
    await expect(page.getByRole('heading')).toHaveText('Preview Priority options');
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
    expect((await page.evaluate(() => window.__tourHarness.lifecycle()))
        .filter((entry) => entry.state === 'closed' && entry.reason === 'escape')).toHaveLength(1);
});

test('interactive Back and tour Skip latch cleanup before the owned close callback and never advance', async ({ page }) => {
    await installHarness(page);
    const openReadyPriority = async () => {
        await openTour(page);
        await advanceToHeading(page, 'Preview Priority options');
        await page.locator('[data-priority-transition-trigger]').click();
        await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
        await expect(page.locator('[data-priority-transition-menu]')).toBeFocused();
    };

    await openReadyPriority();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading')).toHaveText('See the delivery Stories');
    expect((await page.evaluate(() => window.__tourHarness.cleanupOrder())).slice(-2)).toEqual([
        { phase: 'request', reason: 'cleanup' },
        { phase: 'lifecycle', reason: 'cleanup' },
    ]);

    await page.reload();
    await page.waitForFunction(() => Boolean(window.__tourHarness));
    await openReadyPriority();
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await page.evaluate(() => window.__tourHarness.cleanupOrder())).slice(-2)).toEqual([
        { phase: 'request', reason: 'cleanup' },
        { phase: 'lifecycle', reason: 'cleanup' },
    ]);
});

test('interactive coarse-pointer targets reach 44px without row shift and unsafe neighbour overlap falls back', async ({ page }) => {
    await installHarness(page);
    await page.evaluate(() => {
        const nativeMatchMedia = window.matchMedia.bind(window);
        window.matchMedia = (query) => query === '(pointer: coarse)'
            ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} }
            : nativeMatchMedia(query);
    });
    const priorityWrapper = page.locator('[data-priority-transition-trigger]').locator('..');
    const trackWrapper = page.locator('[data-project-track-transition-trigger]').locator('..');
    const statusWrapper = page.locator('[data-status-transition-trigger]').locator('..');
    const before = {
        priority: await priorityWrapper.evaluate((node) => node.getBoundingClientRect().toJSON()),
        track: await trackWrapper.evaluate((node) => node.getBoundingClientRect().toJSON()),
        status: await statusWrapper.evaluate((node) => node.getBoundingClientRect().toJSON()),
    };
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    const assertExpandedWithoutRowShift = async (field, trigger, wrapper) => {
        const expanded = await trigger.evaluate((node) => node.getBoundingClientRect().toJSON());
        const after = await wrapper.evaluate((node) => node.getBoundingClientRect().toJSON());
        expect(expanded.width).toBeGreaterThanOrEqual(44);
        expect(expanded.height).toBeGreaterThanOrEqual(44);
        expect(after.left).toBeCloseTo(before[field].left, 1);
        expect(after.width).toBeCloseTo(before[field].width, 1);
    };
    const priorityTrigger = page.locator('[data-priority-transition-trigger]');
    await assertExpandedWithoutRowShift('priority', priorityTrigger, priorityWrapper);
    await priorityTrigger.click();
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    const priorityMenu = page.locator('[data-priority-transition-menu]');
    await expect(priorityMenu).toBeFocused();
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-settled', 'ready');
    await priorityMenu.press('Escape');

    const trackTrigger = page.locator('[data-project-track-transition-trigger]');
    await expect(page.getByRole('heading')).toHaveText('Preview Project Track options');
    await assertExpandedWithoutRowShift('track', trackTrigger, trackWrapper);
    await trackTrigger.click();
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    const trackMenu = page.locator('[data-project-track-transition-menu]');
    await expect(trackMenu).toBeFocused();
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-preview-settled', 'ready');
    await trackMenu.press('Escape');

    const statusTrigger = page.locator('[data-status-transition-trigger]');
    await expect(page.getByRole('heading')).toHaveText('Preview Status options');
    await assertExpandedWithoutRowShift('status', statusTrigger, statusWrapper);

    await page.evaluate(() => window.__tourHarness.closeWithDone());
    await page.evaluate(() => window.__tourHarness.setEditingMask(2));
    const trackRect = await page.locator('[data-project-track-transition-trigger]').evaluate((node) => node.getBoundingClientRect().toJSON());
    await page.evaluate((left) => window.__tourHarness.setNeighbourLeft(left), trackRect.left + trackRect.width / 2);
    await expect.poll(() => page.locator('#neighbour-control').evaluate((node) => node.getBoundingClientRect().left))
        .toBeCloseTo(trackRect.left + trackRect.width / 2, 0);
    await page.evaluate(() => window.__tourHarness.open());
    await advanceToHeading(page, 'Preview Project Track options');
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-state', 'fallback');
});

test('interactive unmount sets cleanup before owner close and balances focus and geometry listeners', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    await page.locator('[data-priority-transition-trigger]').click();
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    await expect(page.locator('[data-priority-transition-menu]')).toBeFocused();
    await page.evaluate(() => window.__unmountTourHarness());
    await expect(page.locator('[data-onboarding-tour]')).toHaveCount(0);
    const cleanup = await page.evaluate(() => window.__tourHarness?.cleanupOrder?.() || []);
    expect(cleanup).toContainEqual({ phase: 'request', reason: 'unmount' });
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.resizeObservers)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.mutationObservers)).toBe(0);
    const lifecycle = await page.evaluate(() => window.__tourLifecycle);
    expect(lifecycle.listenerRemoves).toEqual(lifecycle.listenerAdds);
    expect(lifecycle.visualViewportRemoves).toEqual(lifecycle.visualViewportAdds);
    expect(lifecycle.documentListenerRemoves).toEqual(lifecycle.documentListenerAdds);
});

test('interactive geometry follows visual viewport events and wheel and touch paths keep controls unobscured', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    const trigger = page.locator('[data-priority-transition-trigger]');
    await trigger.evaluate((node) => {
        window.__targetRectReads = 0;
        const nativeGetBoundingClientRect = node.getBoundingClientRect.bind(node);
        node.getBoundingClientRect = () => {
            window.__targetRectReads += 1;
            return nativeGetBoundingClientRect();
        };
    });
    const readsBeforeViewportEvent = await page.evaluate(() => window.__targetRectReads);
    await page.evaluate(() => window.visualViewport.dispatchEvent(new Event('resize')));
    await expect.poll(() => page.evaluate(() => window.__targetRectReads)).toBeGreaterThan(readsBeforeViewportEvent);

    const scrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    const triggerBox = await trigger.boundingBox();
    await page.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
    await page.mouse.wheel(0, 180);
    await trigger.evaluate((node) => node.dispatchEvent(new TouchEvent('touchmove', {
        bubbles: true,
        cancelable: true,
        touches: [],
    })));
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(scrollBefore);
    await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

    await trigger.click();
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    const menu = page.locator('[data-priority-transition-menu]');
    await expect(menu).toBeFocused();
    const rects = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
        return {
            target: rect('[data-priority-transition-trigger]'),
            menu: rect('[data-priority-transition-menu]'),
            coachmark: rect('.onboarding-tour-card'),
        };
    });
    const overlaps = (left, right) => left.left < right.right && left.right > right.left
        && left.top < right.bottom && left.bottom > right.top;
    expect(overlaps(rects.coachmark, rects.target)).toBe(false);
    expect(overlaps(rects.coachmark, rects.menu)).toBe(false);
});

test('interactive visual viewport offsets bound target, menu, coachmark, spotlight, and shields with balanced listeners', async ({ page }) => {
    await installHarness(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    await page.evaluate(() => {
        const state = { width: 800, height: 620, offsetLeft: 10, offsetTop: 20 };
        ['width', 'height', 'offsetLeft', 'offsetTop'].forEach((key) => {
            Object.defineProperty(window.visualViewport, key, {
                configurable: true,
                get: () => state[key],
            });
        });
        window.__setTourVisualViewport = (next) => Object.assign(state, next);
        window.visualViewport.dispatchEvent(new Event('scroll'));
        window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const listenersBeforeMenu = await page.evaluate(() => ({ ...window.__tourLifecycle.visualViewportAdds }));
    const trigger = page.locator('[data-priority-transition-trigger]');
    await expect.poll(() => trigger.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === node || node.contains(hit);
    })).toBe(true);
    await trigger.click();
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    const menu = page.locator('[data-priority-transition-menu]');
    await expect(menu).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.visualViewportAdds.resize))
        .toBeGreaterThan(listenersBeforeMenu.resize);
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.visualViewportAdds.scroll))
        .toBeGreaterThan(listenersBeforeMenu.scroll);

    const before = await page.evaluate(() => ({
        shieldLeft: document.querySelector('.onboarding-tour-shield').getBoundingClientRect().left,
        shieldTop: document.querySelector('.onboarding-tour-shield').getBoundingClientRect().top,
    }));
    await page.evaluate(() => {
        window.__setTourVisualViewport({ width: 760, height: 600, offsetLeft: 20, offsetTop: 40 });
        window.visualViewport.dispatchEvent(new Event('scroll'));
        window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const geometry = await page.evaluate(() => {
        const readRect = (selector) => {
            const rect = document.querySelector(selector).getBoundingClientRect();
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        };
        return {
            viewport: {
                left: window.visualViewport.offsetLeft,
                top: window.visualViewport.offsetTop,
                right: window.visualViewport.offsetLeft + window.visualViewport.width,
                bottom: window.visualViewport.offsetTop + window.visualViewport.height,
            },
            target: readRect('[data-priority-transition-trigger]'),
            menu: readRect('[data-priority-transition-menu]'),
            coachmark: readRect('.onboarding-tour-card'),
            spotlight: readRect('.onboarding-tour-spotlight'),
            shields: Array.from(document.querySelectorAll('.onboarding-tour-shield')).map((node) => {
                const rect = node.getBoundingClientRect();
                return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
            }),
        };
    });
    const contained = (rect) => rect.left >= geometry.viewport.left && rect.top >= geometry.viewport.top
        && rect.right <= geometry.viewport.right && rect.bottom <= geometry.viewport.bottom;
    const overlaps = (left, right) => left.left < right.right && left.right > right.left
        && left.top < right.bottom && left.bottom > right.top;
    expect(contained(geometry.target)).toBe(true);
    expect(contained(geometry.menu)).toBe(true);
    expect(contained(geometry.coachmark)).toBe(true);
    expect(contained(geometry.spotlight)).toBe(true);
    geometry.shields.forEach((shield) => {
        expect(contained(shield)).toBe(true);
        expect(overlaps(shield, geometry.target)).toBe(false);
    });
    expect(geometry.shields[0].left).toBe(geometry.viewport.left);
    expect(geometry.shields[0].top).toBe(geometry.viewport.top);
    expect(geometry.shields[3].left).toBe(geometry.viewport.left);
    expect(geometry.shields[3].bottom).toBe(geometry.viewport.bottom);
    expect(overlaps(geometry.coachmark, geometry.target)).toBe(false);
    expect(overlaps(geometry.coachmark, geometry.menu)).toBe(false);
    expect(geometry.shields[0].left === before.shieldLeft && geometry.shields[0].top === before.shieldTop).toBe(false);
    expect(await trigger.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === node || node.contains(hit);
    })).toBe(true);

    await page.evaluate(() => window.__unmountTourHarness());
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.visualViewportRemoves))
        .toEqual(await page.evaluate(() => window.__tourLifecycle.visualViewportAdds));
});

test('interactive target ancestor scroll lock restores exact prior overflow state', async ({ page }) => {
    await installHarness(page);
    await page.evaluate(() => {
        document.documentElement.style.setProperty('overflow-x', 'clip', 'important');
        document.documentElement.style.setProperty('overflow-y', 'scroll');
        document.body.style.setProperty('overflow', 'auto');
    });
    const ancestor = page.locator('[data-priority-transition-trigger]').locator('..');
    await ancestor.evaluate((node) => {
        node.style.display = 'block';
        node.style.width = '100px';
        node.style.height = '60px';
        node.style.boxSizing = 'border-box';
        node.style.paddingLeft = '10px';
        node.style.paddingTop = '10px';
        node.style.paddingRight = '200px';
        node.style.paddingBottom = '100px';
        node.style.overflow = 'auto';
        node.scrollLeft = 3;
        node.scrollTop = 4;
    });
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    await expect(ancestor).toHaveCSS('overflow', 'hidden');
    await expect(page.locator('html')).toHaveCSS('overflow-x', 'hidden');
    await expect(page.locator('html')).toHaveCSS('overflow-y', 'hidden');
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(ancestor).toHaveCSS('overflow', 'auto');
    expect(await ancestor.evaluate((node) => ({
        overflow: node.style.overflow,
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
    }))).toEqual({ overflow: 'auto', scrollLeft: 3, scrollTop: 4 });
    expect(await page.evaluate(() => ({
        htmlOverflowX: document.documentElement.style.getPropertyValue('overflow-x'),
        htmlOverflowXPriority: document.documentElement.style.getPropertyPriority('overflow-x'),
        htmlOverflowY: document.documentElement.style.getPropertyValue('overflow-y'),
        bodyOverflow: document.body.style.getPropertyValue('overflow'),
    }))).toEqual({
        htmlOverflowX: 'clip',
        htmlOverflowXPriority: 'important',
        htmlOverflowY: 'scroll',
        bodyOverflow: 'auto',
    });
});

test('interactive preview uses an honest manual fallback when no non-overlapping coachmark placement fits', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    await page.evaluate(() => {
        const state = { width: 320, height: 240, offsetLeft: 0, offsetTop: 0 };
        ['width', 'height', 'offsetLeft', 'offsetTop'].forEach((key) => {
            Object.defineProperty(window.visualViewport, key, {
                configurable: true,
                get: () => state[key],
            });
        });
        window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('[data-onboarding-tour]')).toHaveAttribute('data-onboarding-state', 'fallback');
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
});

test('interactive late lifecycle responses and stale session descriptors are ignored after close', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    const trigger = page.locator('[data-priority-transition-trigger]');
    await trigger.click();
    const descriptor = await page.evaluate(() => {
        const current = window.__tourHarness.previewSession();
        return {
            sessionId: current.sessionId,
            stepId: current.stepId,
            fieldKind: current.fieldKind,
            issueKey: current.issueKey,
            targetIdentity: current.targetIdentity,
        };
    });
    await trigger.click();
    await page.evaluate((staleDescriptor) => {
        window.__tourHarness.emitLifecycle(staleDescriptor, { state: 'ready', reason: '' });
        window.__tourHarness.emitLifecycle({ ...staleDescriptor, sessionId: staleDescriptor.sessionId - 1 }, { state: 'empty', reason: '' });
    }, descriptor);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(await page.evaluate(() => window.__tourHarness.previewSession()?.state)).toBe('closed');
    await expect(page.getByRole('heading')).toHaveText('Preview Priority options');
    await expect(page.locator('[data-priority-transition-menu]')).toHaveCount(0);
});

test('interactive target replacement closes old ownership before rebinding and ignores its late response', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    await page.locator('[data-priority-transition-trigger]').click();
    const oldDescriptor = await page.evaluate(() => window.__tourHarness.previewSession());
    await page.evaluate(() => window.__tourHarness.replacePriority());
    await expect(page.locator('[data-priority-transition-trigger]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__tourHarness.previewSession()?.targetIdentity))
        .not.toBe(oldDescriptor.targetIdentity);
    const cleanup = await page.evaluate(() => window.__tourHarness.cleanupOrder());
    const targetLoss = cleanup.filter((entry) => entry.reason === 'target_loss');
    expect(targetLoss.slice(0, 2)).toEqual([
        { phase: 'request', reason: 'target_loss' },
        { phase: 'lifecycle', reason: 'target_loss' },
    ]);
    await page.evaluate((descriptor) => {
        window.__tourHarness.emitLifecycle(descriptor, { state: 'ready', reason: '' });
    }, oldDescriptor);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(await page.evaluate(() => window.__tourHarness.previewSession()?.state)).toBe('closed');
    await expect(page.getByRole('heading')).toHaveText('Preview Priority options');
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
});

test('real authentication-required event performs owned preview cleanup without advancing and removes the tour surface', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    await page.locator('[data-priority-transition-trigger]').click();
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    await expect(page.locator('[data-priority-transition-menu]')).toBeFocused();
    const headingCount = await page.evaluate(() => window.__tourLifecycle.headings.length);

    await page.evaluate(() => window.__tourHarness.requireAuthentication());

    const authDialog = page.getByRole('alertdialog');
    await expect(authDialog).toBeVisible();
    await expect(authDialog.getByRole('heading', { name: 'Sign in required' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in again' })).toBeFocused();
    await expect(page.locator('[data-priority-transition-menu]')).toHaveCount(0);
    await expect(page.locator('.onboarding-tour-preview-portal')).toHaveCount(0);
    await expect(page.locator('[data-onboarding-tour]')).toHaveCount(0);
    await expect(page.locator('[data-onboarding-preview-owner]')).toHaveCount(0);
    await expect(page.locator('[data-priority-transition-trigger]')).not.toHaveAttribute('aria-describedby', /.+/);
    await expect(page.locator('#root > div').first()).toHaveAttribute('aria-hidden', 'true');
    expect((await page.evaluate(() => window.__tourHarness.cleanupOrder())).slice(-2)).toEqual([
        { phase: 'request', reason: 'auth_required' },
        { phase: 'lifecycle', reason: 'auth_required' },
    ]);
    expect((await page.evaluate(() => window.__tourHarness.lifecycle()))
        .filter((entry) => entry.state === 'closed' && entry.reason === 'auth_required')).toHaveLength(1);
    expect(await page.evaluate(() => window.__tourLifecycle.headings.length)).toBe(headingCount);
    expect(await page.evaluate(() => window.__tourHarness.skipCount)).toBe(0);

    const listenersBeforeUnmount = await page.evaluate(() => ({
        adds: window.__tourLifecycle.authRequiredAdds,
        removes: window.__tourLifecycle.authRequiredRemoves,
    }));
    expect(listenersBeforeUnmount.adds).toBeGreaterThan(listenersBeforeUnmount.removes);
    await page.evaluate(() => window.__unmountTourHarness());
    expect(await page.evaluate(() => ({
        adds: window.__tourLifecycle.authRequiredAdds,
        removes: window.__tourLifecycle.authRequiredRemoves,
    }))).toEqual({ adds: listenersBeforeUnmount.adds, removes: listenersBeforeUnmount.adds });
});

test('portal, focus trap, pending Skip and Escape, and focus restoration work together', async ({ page }) => {
    await installHarness(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#prior-focus').focus();
    await openTour(page);

    const dialog = page.getByRole('dialog');
    expect(await dialog.evaluate((node) => node.parentElement.parentElement === document.body)).toBe(true);
    await expect(dialog).toBeFocused();
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    await expect(page.locator('.onboarding-tour-spotlight')).toHaveCSS('transition-duration', '0s');

    await page.getByRole('button', { name: 'Next' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Skip onboarding' })).toBeFocused();

    await page.evaluate(() => window.__tourHarness.setPending(true));
    await expect(page.getByRole('button', { name: 'Skip onboarding' })).toBeDisabled();
    await dialog.press('Escape');
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.__tourHarness.setPending(false));
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden', /.+/);
    await expect(page.locator('#root')).not.toHaveAttribute('inert', /.+/);
    expect(await page.locator('#root').evaluate((node) => node.inert)).toBe(false);
    await expect(page.locator('#prior-focus')).toBeFocused();
    expect(await page.evaluate(() => window.__tourHarness.skipCount)).toBe(1);

    await openTour(page);
    await page.getByRole('dialog').press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.__tourHarness.skipCount)).toBe(2);
});

test('root accessibility state restores exact pre-existing attribute values and inert property', async ({ page }) => {
    await installHarness(page);
    await page.locator('#outside-focus').focus();
    await page.evaluate(() => {
        const root = document.getElementById('root');
        root.setAttribute('aria-hidden', 'legacy-hidden');
        root.setAttribute('inert', 'legacy-inert');
    });
    await openTour(page);
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'legacy-hidden');
    await expect(page.locator('#root')).toHaveAttribute('inert', 'legacy-inert');
    expect(await page.locator('#root').evaluate((node) => node.inert)).toBe(true);
    await expect(page.locator('#outside-focus')).toBeFocused();
});

test('readiness mixed tour-owned suppression never bypasses non-owned hidden or aria state', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    await expect(page.locator('.onboarding-tour-spotlight')).toBeVisible();
    await page.evaluate(() => { document.getElementById('root').style.display = 'none'; });
    await expect(page.locator('.onboarding-tour-spotlight')).toHaveCount(0);
    await page.evaluate(() => { document.getElementById('root').style.display = ''; });
    await expect(page.locator('.onboarding-tour-spotlight')).toBeVisible();

    await page.evaluate(() => { document.getElementById('root').removeAttribute('aria-hidden'); });
    await expect(page.locator('.onboarding-tour-spotlight')).toBeVisible();
    await page.evaluate(() => { document.getElementById('root').setAttribute('aria-hidden', 'true'); });
    await expect(page.locator('.onboarding-tour-spotlight')).toHaveCount(0);
    await page.evaluate(() => { document.getElementById('root').removeAttribute('aria-hidden'); });
    await expect(page.locator('.onboarding-tour-spotlight')).toBeVisible();

    await page.evaluate(() => { document.getElementById('root').removeAttribute('inert'); });
    await expect(page.locator('.onboarding-tour-spotlight')).toBeVisible();
    await page.evaluate(() => { document.getElementById('root').setAttribute('inert', ''); });
    await expect(page.locator('.onboarding-tour-spotlight')).toHaveCount(0);
    await page.evaluate(() => { document.getElementById('root').removeAttribute('inert'); });
    await expect(page.locator('.onboarding-tour-spotlight')).toBeVisible();
    await page.getByRole('button', { name: 'Skip onboarding' }).click();

    await page.evaluate(() => {
        const root = document.getElementById('root');
        root.setAttribute('aria-hidden', 'true');
        root.removeAttribute('inert');
        root.inert = false;
    });
    await openTour(page);
    await expect(page.getByRole('heading')).toHaveText('Choose a sprint');
    await expect(page.locator('.onboarding-tour-spotlight')).toHaveCount(0);
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#root')).toHaveAttribute('inert', '');

    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');
    expect(await page.locator('#root').evaluate((node) => ({
        hasInert: node.hasAttribute('inert'),
        inert: node.inert,
    }))).toEqual({ hasInert: false, inert: false });
});

test('mutation retargets visible duplicates, removes vanished optional steps, and reopen starts at step one', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    const initialLeft = await page.locator('.onboarding-tour-spotlight').evaluate((node) => node.getBoundingClientRect().left);
    await page.evaluate(() => window.__tourHarness.removePrimary());
    await expect.poll(() => page.locator('.onboarding-tour-spotlight').evaluate((node) => node.getBoundingClientRect().left)).toBeGreaterThan(initialLeft + 300);

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading')).toHaveText('Set your Department scope');
    await page.evaluate(() => window.__tourHarness.removeGroup());
    await expect(page.getByRole('heading')).toHaveText('Request fresh data');

    await page.evaluate(() => window.__tourHarness.closeWithDone());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => {
        window.__tourLifecycle.headings = [];
        window.__tourHarness.reopenWithRunUnchanged();
    });
    await expect(page.getByRole('heading')).toHaveText('Choose a sprint');
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.headings[0])).toBe('Choose a sprint');
});

test('readiness holds hierarchy and editing steps during loading and terminal errors expose fallback only', async ({ page }) => {
    await installHarness(page);
    await page.evaluate(() => window.__tourHarness.setReadiness('loading'));
    await openTour(page);
    await advanceToHeading(page, 'Start with the Initiative');
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
    await expect(page.locator('.onboarding-tour-spotlight')).toHaveCount(0);

    await page.evaluate(() => window.__tourHarness.setReadiness('settled'));
    await expect(page.locator('.onboarding-tour-spotlight')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();

    await advanceToHeading(page, 'Preview Priority options');
    await page.evaluate(() => window.__tourHarness.setReadiness('terminal-error'));
    await expect(page.locator('.onboarding-tour-spotlight')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
});

test('offscreen target scrolls once on step entry, does not fight user scroll, and scrolls on replacement', async ({ page }) => {
    await installHarness(page);
    await page.evaluate(() => window.__tourHarness.setPriorityOffscreen(true));
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    await expect(page.locator('.onboarding-tour-spotlight')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__tourHarness.scrollCount())).toBe(1);
    expect(await page.evaluate(() => window.__tourHarness.scrollOptions())).toEqual([
        { behavior: 'instant', block: 'center', inline: 'nearest' },
    ]);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__tourHarness.scrollCount())).toBe(1);

    await page.evaluate(() => window.__tourHarness.replacePriority());
    await expect.poll(() => page.evaluate(() => window.__tourHarness.scrollCount())).toBe(2);
    await expect(page.locator('.onboarding-tour-spotlight')).toBeVisible();

    await page.evaluate(() => window.__tourHarness.setEditingMask(3));
    await expect(page.getByRole('heading')).toHaveText('Preview Priority options');
    await expect(page.locator('.onboarding-tour-spotlight')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
    await page.evaluate(() => window.__tourHarness.setEditingMask(7));
    await expect(page.locator('.onboarding-tour-spotlight')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
});

test('interactive Priority, Project Track, and Status previews stay viewport-fixed on a scrolled dashboard', async ({ page }) => {
    await installHarness(page);
    await page.evaluate(() => window.__tourHarness.setDashboardFieldTop(1400));
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    const fields = [
        {
            heading: 'Preview Priority options',
            trigger: '[data-priority-transition-trigger]',
            menu: '[data-priority-transition-menu]',
            nextHeading: 'Preview Project Track options',
        },
        {
            heading: 'Preview Project Track options',
            trigger: '[data-project-track-transition-trigger]',
            menu: '[data-project-track-transition-menu]',
            nextHeading: 'Preview Status options',
        },
        {
            heading: 'Preview Status options',
            trigger: '[data-status-transition-trigger]',
            menu: '[data-status-transition-menu]',
            nextHeading: 'Tour complete',
        },
    ];
    const assertViewportContainedWithoutOverlap = async ({ trigger, menu }) => {
        await expect(page.locator(menu)).toHaveCSS('position', 'fixed');
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const geometry = await page.evaluate(({ triggerSelector, menuSelector }) => {
            const readRect = (selector) => {
                const rect = document.querySelector(selector).getBoundingClientRect();
                return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
            };
            return {
                viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
                target: readRect(triggerSelector),
                menu: readRect(menuSelector),
                coachmark: readRect('.onboarding-tour-card'),
            };
        }, { triggerSelector: trigger, menuSelector: menu });
        const isContained = (rect) => rect.left >= 0 && rect.top >= 0
            && rect.right <= geometry.viewport.width && rect.bottom <= geometry.viewport.height;
        const overlaps = (left, right) => left.left < right.right && left.right > right.left
            && left.top < right.bottom && left.bottom > right.top;
        expect(isContained(geometry.target)).toBe(true);
        expect(isContained(geometry.menu)).toBe(true);
        expect(isContained(geometry.coachmark)).toBe(true);
        expect(overlaps(geometry.coachmark, geometry.target)).toBe(false);
        expect(overlaps(geometry.coachmark, geometry.menu)).toBe(false);
    };

    for (const field of fields) {
        await expect(page.getByRole('heading')).toHaveText(field.heading);
        await expect.poll(() => page.locator(field.trigger).evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return hit === node || node.contains(hit);
        })).toBe(true);
        await page.locator(field.trigger).click();
        await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
        await expect(page.locator(field.menu)).toBeFocused();
        await assertViewportContainedWithoutOverlap(field);
        await page.locator(field.menu).press('Escape');
        await expect(page.getByRole('heading')).toHaveText(field.nextHeading);
    }
});

test('offscreen duplicate resolution prefers a later visible candidate without needless scrolling', async ({ page }) => {
    await installHarness(page);
    await page.evaluate(() => {
        window.__tourHarness.setPriorityOffscreen(true);
        window.__tourHarness.setShowPriorityDuplicate(true);
    });
    await openTour(page);
    await advanceToHeading(page, 'Preview Priority options');
    const duplicateRect = await page.locator('button', { hasText: 'Priority visible duplicate' }).evaluate((node) => ({
        left: node.getBoundingClientRect().left,
    }));
    await expect.poll(() => page.locator('.onboarding-tour-spotlight').evaluate((node, duplicateLeft) => (
        Math.abs((node.getBoundingClientRect().left + 6) - duplicateLeft)
    ), duplicateRect.left)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => window.__tourHarness.scrollCount())).toBe(0);
});

test('hierarchy matrix and editing presence matrix retain deterministic order and compact only all-absent groups', async ({ page }) => {
    await installHarness(page);
    const hierarchyTitles = ['Start with the Initiative', 'Follow the Epic', 'See the delivery Stories'];
    const editingTitles = ['Preview Priority options', 'Preview Project Track options', 'Preview Status options'];
    for (let mask = 0; mask < 8; mask += 1) {
        await page.evaluate(({ hierarchyMask }) => {
            window.__tourHarness.setPriorityOffscreen(false);
            window.__tourHarness.setHierarchyMask(hierarchyMask);
            window.__tourHarness.setEditingMask(7);
            window.__tourHarness.open();
        }, { hierarchyMask: mask });
        await expect(page.getByRole('dialog')).toBeVisible();
        const steps = await collectTourSteps(page, {
            advancePreview: async ({ page: callbackPage, title, advanceFallback }) => {
                await advancePreviewOrFallback(callbackPage, title, advanceFallback);
            },
        });
        const expectedTotal = mask ? 10 : 8;
        expect(steps.map((step) => step.progress)).toEqual(
            Array.from({ length: expectedTotal }, (_value, index) => `Step ${index + 1} of ${expectedTotal}`)
        );
        const hierarchyHeadings = steps.map((step) => step.title).filter((title) => (
            hierarchyTitles.includes(title) || title === 'Follow work from goal to delivery'
        ));
        expect(hierarchyHeadings).toEqual(mask ? hierarchyTitles : ['Follow work from goal to delivery']);
        const hierarchyStates = steps.filter((step) => (
            hierarchyTitles.includes(step.title) || step.title === 'Follow work from goal to delivery'
        )).map((step) => step.state);
        expect(hierarchyStates).toEqual(mask
            ? [Boolean(mask & 4), Boolean(mask & 2), Boolean(mask & 1)].map((present) => present ? 'target' : 'fallback')
            : ['fallback']);
        await page.evaluate(() => window.__tourHarness.closeWithDone());
        await expect(page.getByRole('dialog')).toHaveCount(0);
    }

    for (let mask = 0; mask < 8; mask += 1) {
        await page.evaluate(({ editingMask }) => {
            window.__tourHarness.setHierarchyMask(7);
            window.__tourHarness.setEditingMask(editingMask);
            window.__tourHarness.open();
        }, { editingMask: mask });
        await expect(page.getByRole('dialog')).toBeVisible();
        const steps = await collectTourSteps(page, {
            advancePreview: async ({ page: callbackPage, title, advanceFallback }) => {
                await advancePreviewOrFallback(callbackPage, title, advanceFallback);
            },
        });
        const expectedTotal = mask ? 10 : 8;
        expect(steps.map((step) => step.progress)).toEqual(
            Array.from({ length: expectedTotal }, (_value, index) => `Step ${index + 1} of ${expectedTotal}`)
        );
        const editingHeadings = steps.map((step) => step.title).filter((title) => (
            editingTitles.includes(title) || title === 'Preview Jira fields safely'
        ));
        expect(editingHeadings).toEqual(mask ? editingTitles : ['Preview Jira fields safely']);
        const editingStates = steps.filter((step) => (
            editingTitles.includes(step.title) || step.title === 'Preview Jira fields safely'
        )).map((step) => step.state);
        expect(editingStates).toEqual(mask
            ? [Boolean(mask & 4), Boolean(mask & 2), Boolean(mask & 1)].map((present) => present ? 'interactive_closed' : 'fallback')
            : ['fallback']);
        await page.evaluate(() => window.__tourHarness.closeWithDone());
        await expect(page.getByRole('dialog')).toHaveCount(0);
    }
});

test('active observers and window listeners clean up on unmount', async ({ page }) => {
    await installHarness(page);
    await openTour(page);
    expect(await page.evaluate(() => window.__tourLifecycle.resizeObservers)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__tourLifecycle.mutationObservers)).toBeGreaterThan(0);
    await page.evaluate(() => window.__unmountTourHarness());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.resizeObservers)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__tourLifecycle.mutationObservers)).toBe(0);
    const lifecycle = await page.evaluate(() => window.__tourLifecycle);
    expect(lifecycle.listenerRemoves).toEqual(lifecycle.listenerAdds);
    await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden', /.+/);
    await expect(page.locator('#root')).not.toHaveAttribute('inert', /.+/);
});

test('automatic run waits for definitive bootstrap readiness and preserves scope state', async ({ page }, testInfo) => {
    await installControllerHarness(page);
    await page.evaluate(() => window.__onboardingController.setBootstrap(false, false));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => window.__onboardingController.setBootstrap(true, null));
    await expect.poll(() => page.evaluate(() => window.__onboardingController.snapshot().done)).toBeNull();
    await page.waitForTimeout(50);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => window.__onboardingController.setBootstrap(true, false));
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.evaluate(() => window.__onboardingController.setBootstrap(false, false));
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.evaluate(() => window.__onboardingController.setBootstrap(true, false));
    await expect(page.getByRole('dialog')).toBeVisible();

    const state = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(state.writes).toEqual([]);
    expect(state.preserved).toEqual({ sprint: 'S-42', group: 'platform', teams: ['alpha'], favorite: 'platform' });
    expect(state.mode).toEqual({ selectedView: 'eng', planning: false, stats: false, scenario: false, board: false });
    expect(state.events).toEqual([{ section: 'onboarding', workflowAction: 'started', params: { source_surface: 'first_run' } }]);
    const actionGeometry = await page.getByRole('dialog').evaluate((dialog) => {
        const dialogRect = dialog.getBoundingClientRect();
        return Array.from(dialog.querySelectorAll('.onboarding-tour-actions button')).map((button) => {
            const rect = button.getBoundingClientRect();
            return {
                left: rect.left,
                right: rect.right,
                dialogLeft: dialogRect.left,
                dialogRight: dialogRect.right,
            };
        });
    });
    for (const rect of actionGeometry) {
        expect(rect.left).toBeGreaterThanOrEqual(rect.dialogLeft);
        expect(rect.right).toBeLessThanOrEqual(rect.dialogRight);
    }
    await page.screenshot({
        path: testInfo.outputPath('onboarding-tour-desktop.png'),
        animations: 'disabled',
    });
});

test('automatic start and Settings replay require Atlassian OAuth workspace DB mode', async ({ page }) => {
    await installControllerHarness(page);
    await page.evaluate(() => {
        window.__onboardingController.setAvailability('basic', 'workspace_db');
        window.__onboardingController.setBootstrap(true, false);
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run onboarding again' })).toHaveCount(0);
    expect((await page.evaluate(() => window.__onboardingController.snapshot())).writes).toEqual([]);

    await page.evaluate(() => window.__onboardingController.setAvailability('atlassian_oauth', 'jsonfile'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run onboarding again' })).toHaveCount(0);

    await page.evaluate(() => window.__onboardingController.setAvailability('atlassian_oauth', 'workspace_db'));
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip onboarding' })).toBeVisible();
    const state = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(state.writes).toEqual([]);
    expect(state.events).toEqual([
        { section: 'onboarding', workflowAction: 'started', params: { source_surface: 'first_run' } },
    ]);
});

test('skip persists before close and a shared pending guard deduplicates Escape', async ({ page }) => {
    await installControllerHarness(page);
    await page.evaluate(() => {
        window.__onboardingController.setBehavior({ type: 'deferred' });
        window.__onboardingController.setBootstrap(true, false);
    });
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await page.getByRole('dialog').press('Escape');
    const pendingState = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(pendingState.writes).toEqual([true]);
    expect(pendingState.events.filter(event => event.workflowAction === 'skipped')).toEqual([]);
    await page.evaluate(() => window.__resolveOnboardingWrite());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const state = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(state.events.filter(event => event.workflowAction === 'skipped')).toEqual([
        { section: 'onboarding', workflowAction: 'skipped', params: { source_surface: 'first_run', result: 'success' } },
    ]);
});

test('authentication-required completion defers to the global lock and other failures remain retryable', async ({ page }) => {
    await installControllerHarness(page);
    await page.evaluate(() => {
        window.__onboardingController.setBehavior({ type: 'auth_required', loginUrl: '/login?reason=session_expired' });
        window.__onboardingController.setBootstrap(true, false);
    });
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveCount(0);
    const authState = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(authState.pending).toBe(false);
    expect(authState.error).toBe('');
    expect(authState.events.filter(event => event.workflowAction === 'skipped')).toEqual([]);

    await page.evaluate(() => window.__onboardingController.setBehavior({ type: 'mismatch' }));
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(page.getByRole('alert')).toHaveText('Saved onboarding preference could not be verified. Please retry.');
    expect((await page.evaluate(() => window.__onboardingController.snapshot())).events.filter(event => event.workflowAction === 'skipped')).toEqual([]);
    await page.evaluate(() => window.__onboardingController.setBehavior({ type: 'success' }));
    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await page.evaluate(() => window.__onboardingController.snapshot())).events.filter(event => event.workflowAction === 'skipped')).toEqual([
        { section: 'onboarding', workflowAction: 'skipped', params: { source_surface: 'first_run', result: 'success' } },
    ]);
});

test('settings replay is disabled while dirty and starts only after false persistence succeeds', async ({ page }) => {
    await installControllerHarness(page);
    await page.evaluate(() => window.__onboardingController.setDirty(true));
    await expect(page.getByRole('button', { name: 'Run onboarding again' })).toBeDisabled();
    await page.evaluate(() => window.__onboardingController.setDirty(false));
    await page.getByRole('button', { name: 'Run onboarding again' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run onboarding again' })).toHaveCount(0);
    const state = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(state.writes).toEqual([false]);
    expect(state.events.at(-1)).toEqual({ section: 'onboarding', workflowAction: 'started', params: { source_surface: 'settings' } });
});

test('Finish persists completion before closing and emits completed once', async ({ page }) => {
    await installControllerHarness(page);
    await page.evaluate(() => {
        window.__onboardingController.setBehavior({ type: 'deferred' });
        window.__onboardingController.setBootstrap(true, false);
    });
    await expect(page.getByRole('dialog')).toBeVisible();
    while (await page.getByRole('button', { name: 'Next' }).count()) {
        await page.getByRole('button', { name: 'Next' }).click();
    }
    await page.getByRole('button', { name: 'Finish' }).click();
    const pendingState = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(pendingState.writes).toEqual([true]);
    expect(pendingState.events.filter(event => event.workflowAction === 'completed')).toEqual([]);
    await page.evaluate(() => window.__resolveOnboardingWrite());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const state = await page.evaluate(() => window.__onboardingController.snapshot());
    expect(state.writes).toEqual([true]);
    expect(state.events.filter(event => event.workflowAction === 'completed')).toEqual([
        { section: 'onboarding', workflowAction: 'completed', params: { source_surface: 'first_run', result: 'success' } },
    ]);
});

test('interrupted reload restarts at the first eligible step', async ({ page }) => {
    await installControllerHarness(page);
    await page.evaluate(() => window.__onboardingController.setBootstrap(true, false));
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading')).toHaveText('Request fresh data');
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__onboardingController));
    await page.evaluate(() => window.__onboardingController.setBootstrap(true, false));
    await expect(page.getByRole('heading')).toHaveText('Choose a sprint');
});

test('mobile dashboard tour stays closed and desktop-to-mobile resize cleans an active preview without persistence', async ({ page }, testInfo) => {
    await installHarness(page);
    await page.setViewportSize({ width: 390, height: 700 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.__tourHarness.open());
    await expect(page.locator('[data-onboarding-tour]')).toHaveCount(0);
    await expect(page.locator('.onboarding-tour-card')).toHaveCount(0);
    await expect(page.locator('.onboarding-tour-spotlight')).toHaveCount(0);
    expect(await page.evaluate(() => ({
        skipped: window.__tourHarness.skipCount,
        finished: window.__tourHarness.finishCount(),
    }))).toEqual({ skipped: 0, finished: 0 });
    await page.screenshot({
        path: testInfo.outputPath('onboarding-tour-mobile.png'),
        animations: 'disabled',
    });

    await page.setViewportSize({ width: 900, height: 700 });
    await expect(page.getByRole('heading')).toHaveText('Choose a sprint');
    const portalSnapshot = await page.locator('#unrelated-portal').evaluate((node) => ({
        ariaHidden: node.getAttribute('aria-hidden'),
        inert: node.getAttribute('inert'),
        inertProperty: node.inert,
    }));
    await advanceToHeading(page, 'Preview Priority options');
    await page.locator('[data-priority-transition-trigger]').click();
    await page.evaluate(() => window.__tourHarness.setPreviewLoading(false));
    await expect(page.locator('[data-priority-transition-menu]')).toBeFocused();
    const headingsBeforeResize = await page.evaluate(() => [...window.__tourLifecycle.headings]);

    await page.setViewportSize({ width: 760, height: 700 });
    await expect(page.locator('[data-onboarding-tour]')).toHaveCount(0);
    await expect(page.locator('[data-priority-transition-menu]')).toHaveCount(0);
    await expect(page.locator('.onboarding-tour-preview-portal')).toHaveCount(0);
    await expect(page.locator('[data-priority-transition-trigger]')).not.toHaveAttribute('aria-describedby', /.+/);
    expect(await page.locator('#unrelated-portal').evaluate((node) => ({
        ariaHidden: node.getAttribute('aria-hidden'),
        inert: node.getAttribute('inert'),
        inertProperty: node.inert,
    }))).toEqual(portalSnapshot);
    expect((await page.evaluate(() => window.__tourHarness.cleanupOrder())).slice(-2)).toEqual([
        { phase: 'request', reason: 'target_loss' },
        { phase: 'lifecycle', reason: 'target_loss' },
    ]);
    expect(await page.evaluate(() => window.__tourLifecycle.headings)).toEqual(headingsBeforeResize);
    expect(await page.evaluate(() => ({
        skipped: window.__tourHarness.skipCount,
        finished: window.__tourHarness.finishCount(),
        state: window.__tourHarness.previewSession()?.state ?? null,
    }))).toEqual({ skipped: 0, finished: 0, state: null });
    const lifecycle = await page.evaluate(() => window.__tourLifecycle);
    expect(lifecycle.listenerRemoves).toEqual(lifecycle.listenerAdds);
    expect(lifecycle.visualViewportRemoves).toEqual(lifecycle.visualViewportAdds);
    expect(lifecycle.documentListenerRemoves).toEqual(lifecycle.documentListenerAdds);
});
