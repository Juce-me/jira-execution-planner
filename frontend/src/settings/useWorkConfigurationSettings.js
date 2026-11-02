import * as React from 'react';

import { isAuthenticationRequiredError } from '../api/authRequired.js';
import {
    fetchWorkSprintValues,
    fetchWorkStructureConfig,
    saveWorkStructureConfig,
    testWorkConfiguration,
} from '../api/configApi.js';
import { issueTypeCatalogKey, loadIssueTypeCatalog } from './workConfigurationCatalogs.js';
import {
    DELIVERY_PROJECT_LIMIT_MESSAGE,
    MODEL_LEGACY,
    addProjectToEntry,
    adoptServerOwned,
    buildSaveRequest,
    catalogScopeFor,
    cloneBundle,
    dirtyConfigurationIds,
    entryById,
    fieldErrorFromServer,
    isPromotedBundle,
    missingSummary,
    patchBundleEntry,
    rebaseOntoLatest,
    removeProjectFromEntry,
    validateBundle,
} from './workConfigurationModel.js';

// Which editor mounts for the current workspace state.
//   legacy      unpromoted + flag off: the existing flat editor and Save are untouched
//   enabled     flag on: the Project config editor (virtual two-entry bundle until the first Save)
//   unavailable promoted + flag off: scoped guidance only, never the old forms
export function resolveWorkConfigMode({ featureEnabled, promoted }) {
    if (featureEnabled === true) return 'enabled';
    if (promoted === true) return 'unavailable';
    return 'legacy';
}

export const readWorkConfigBootstrap = (config) => ({
    featureEnabled: config?.workConfigurationsEnabled === true,
    promoted: config?.workConfigurationsPromoted === true,
    summaries: Array.isArray(config?.workConfigurationSummaries) ? config.workConfigurationSummaries : [],
    missingByConfiguration: config?.adminSettingsMissingByConfiguration && typeof config.adminSettingsMissingByConfiguration === 'object'
        ? config.adminSettingsMissingByConfiguration : {},
});

const stable = value => JSON.stringify(value);
const QUARTER_IN_NAME = /(\d{4}Q[1-4])/;

export function useWorkConfigurationSettings({
    BACKEND_URL,
    visible = false,
    jiraFields = [],
    selectedSprintName = '',
    setGroupTesting = () => {},
    setGroupTestMessage = () => {},
    onDraftReplaced = () => {},
}) {
    const [flags, setFlags] = React.useState({ featureEnabled: false, promoted: false, summaries: [], missingByConfiguration: {} });
    const mode = resolveWorkConfigMode(flags);
    const [loadState, setLoadState] = React.useState('idle'); // idle | loading | ready | error
    const [loadError, setLoadError] = React.useState('');
    const [revision, setRevision] = React.useState(0);
    const [userCanEdit, setUserCanEdit] = React.useState(false);
    const [baseline, setBaselineState] = React.useState(null);
    const [draft, setDraftState] = React.useState(null);
    const baselineRef = React.useRef(null);
    const draftRef = React.useRef(null);
    const promotedRef = React.useRef(false);
    const [promoted, setPromoted] = React.useState(false);
    const explicitClearsRef = React.useRef(new Set());
    const [fieldErrors, setFieldErrors] = React.useState({});
    const [saveFeedback, setSaveFeedback] = React.useState('');
    const [activeId, setActiveId] = React.useState('legacy');
    const [ui, setUi] = React.useState({});
    const [technicalIds, setTechnicalIds] = React.useState(false);
    const [drawerOpen, setDrawerOpen] = React.useState(false);
    const [limitMessages, setLimitMessages] = React.useState({});
    const [typeCatalogs, setTypeCatalogs] = React.useState({});
    const loadGenerationRef = React.useRef(0);
    const onDraftReplacedRef = React.useRef(onDraftReplaced);
    onDraftReplacedRef.current = onDraftReplaced;
    const [catalogRetry, setCatalogRetry] = React.useState(0);
    const [sprintValues, setSprintValues] = React.useState({ state: 'idle', values: [] });
    const [sprintValuesTick, setSprintValuesTick] = React.useState(0);

    const setDraft = React.useCallback((next) => {
        draftRef.current = next;
        setDraftState(next);
    }, []);
    const setBaseline = React.useCallback((next) => {
        baselineRef.current = next;
        setBaselineState(next);
    }, []);

    const applyBootstrap = React.useCallback((config) => {
        const next = readWorkConfigBootstrap(config);
        setFlags(previous => (stable(previous) === stable(next) ? previous : next));
        return next;
    }, []);

    const acceptEnvelope = React.useCallback((envelope, { keepDraft = false } = {}) => {
        const bundle = envelope.workConfigurations;
        const wasDirty = draftRef.current && stable(draftRef.current) !== stable(baselineRef.current);
        setBaseline(cloneBundle(bundle));
        if (keepDraft && wasDirty) setDraft(adoptServerOwned(draftRef.current, bundle));
        else setDraft(cloneBundle(bundle));
        const isPromoted = envelope.promoted === true || isPromotedBundle(bundle);
        promotedRef.current = isPromoted;
        setPromoted(isPromoted);
        if (Number.isInteger(envelope.configRevision)) setRevision(envelope.configRevision);
        if (typeof envelope.userCanEditSettings === 'boolean') setUserCanEdit(envelope.userCanEditSettings);
    }, [setBaseline, setDraft]);

    const reload = React.useCallback(async ({ keepDraft = false } = {}) => {
        const generation = ++loadGenerationRef.current;
        setLoadState('loading');
        setLoadError('');
        try {
            const envelope = await fetchWorkStructureConfig(BACKEND_URL);
            if (generation !== loadGenerationRef.current) return false;
            acceptEnvelope(envelope, { keepDraft });
            if (!keepDraft) { explicitClearsRef.current = new Set(); setFieldErrors({}); onDraftReplacedRef.current(); }
            setLoadState('ready');
            return true;
        } catch (error) {
            if (generation !== loadGenerationRef.current) return false;
            if (isAuthenticationRequiredError(error)) return false;
            setLoadError(error?.message || 'Project configurations could not be loaded.');
            setLoadState('error');
            return false;
        }
    }, [BACKEND_URL, acceptEnvelope]);

    // The editor bundle is read when Settings first needs it, never at app bootstrap.
    React.useEffect(() => {
        if (mode === 'enabled' && visible && loadState === 'idle') void reload();
    }, [mode, visible, loadState, reload]);

    // Scope boundary options: every Sprint value the saved sources observed, whatever the current ranges.
    // Re-read after a committed Save (a Board or project change can alter the sources) and on Retry.
    React.useEffect(() => {
        if (mode !== 'enabled' || !visible || loadState !== 'ready') return undefined;
        const controller = new AbortController();
        setSprintValues(previous => ({ state: 'loading', values: previous.values }));
        fetchWorkSprintValues(BACKEND_URL, { signal: controller.signal }).then(result => {
            if (controller.signal.aborted) return;
            setSprintValues({ state: 'ready', values: Array.isArray(result?.sprintValues) ? result.sprintValues : [] });
        }).catch(error => {
            if (controller.signal.aborted || isAuthenticationRequiredError(error)) return;
            setSprintValues({ state: 'error', values: [] });
        });
        return () => controller.abort();
    }, [BACKEND_URL, mode, visible, loadState, revision, sprintValuesTick]);

    const entries = draft?.configurations || [];
    const active = entryById(draft, activeId) || entries[0] || null;
    const activeEntryId = active?.id || activeId;
    const uiFor = id => ui[id] || {};
    const tabFor = id => ui[id]?.tab || 'scope';
    const setTab = React.useCallback((id, tab) => setUi(previous => ({ ...previous, [id]: { ...previous[id], tab } })), []);
    const setSearch = React.useCallback((id, key, value) => setUi(previous => {
        const entryUi = previous[id] || {};
        const search = entryUi.search || {};
        const resolved = typeof value === 'function' ? value(search[key]) : value;
        return { ...previous, [id]: { ...entryUi, search: { ...search, [key]: resolved } } };
    }), []);
    const selectConfiguration = React.useCallback((id) => {
        setActiveId(id);
        setDrawerOpen(false);
    }, []);

    const patch = React.useCallback((id, entryPatch) => {
        setSaveFeedback('');
        const next = patchBundleEntry(draftRef.current, id, entryPatch);
        setDraft(next);
        const after = entryById(next, id);
        setFieldErrors(previous => {
            if (!previous[id]) return previous;
            const remaining = { ...previous[id] };
            const patched = typeof entryPatch === 'function' ? entryPatch(entryById(draftRef.current, id) || {}) : entryPatch;
            for (const slot of Object.keys(patched?.hierarchy || {})) delete remaining[slot];
            return { ...previous, [id]: remaining };
        });
        if (after && (after.scope.projects || []).length) explicitClearsRef.current.delete(id);
    }, [setDraft]);

    const addProject = React.useCallback((id, key, type) => {
        const entry = entryById(draftRef.current, id);
        if (!entry) return false;
        const { projects, rejected } = addProjectToEntry(entry, key, type);
        if (rejected) {
            setLimitMessages(previous => ({ ...previous, [id]: DELIVERY_PROJECT_LIMIT_MESSAGE }));
            return false;
        }
        setLimitMessages(previous => (previous[id] ? { ...previous, [id]: '' } : previous));
        patch(id, { scope: { projects } });
        return true;
    }, [patch]);

    const removeProject = React.useCallback((id, key) => {
        const entry = entryById(draftRef.current, id);
        if (!entry) return;
        const projects = removeProjectFromEntry(entry, key);
        if (!projects.length) explicitClearsRef.current.add(id);
        setLimitMessages(previous => (previous[id] ? { ...previous, [id]: '' } : previous));
        patch(id, { scope: { projects } });
        if (!projects.length) explicitClearsRef.current.add(id);
    }, [patch]);

    const validation = React.useMemo(() => validateBundle(draft), [draft]);
    const dirtyIds = React.useMemo(() => dirtyConfigurationIds(baseline, draft), [baseline, draft]);
    const dirty = dirtyIds.length > 0;

    // --- issue-type catalog for the saved entry (loading | error | unscoped | ready) ---------------
    const savedActive = entryById(baseline, activeEntryId);
    const quarterHint = (QUARTER_IN_NAME.exec(String(selectedSprintName || '')) || [])[1] || '';
    const catalogScope = savedActive ? catalogScopeFor(savedActive, '') : null;
    const catalogKey = catalogScope ? issueTypeCatalogKey(BACKEND_URL, catalogScope) : '';
    React.useEffect(() => {
        if (mode !== 'enabled' || !visible || !savedActive || loadState !== 'ready') return undefined;
        const id = savedActive.id;
        if (!(savedActive.scope.projects || []).length) {
            setTypeCatalogs(previous => ({ ...previous, [id]: { state: 'unscoped', types: [], key: catalogKey } }));
            return undefined;
        }
        let cancelled = false;
        setTypeCatalogs(previous => (previous[id]?.key === catalogKey && previous[id]?.state === 'ready'
            ? previous : { ...previous, [id]: { state: 'loading', types: previous[id]?.types || [], key: catalogKey } }));
        loadIssueTypeCatalog(BACKEND_URL, catalogScope).then(({ types }) => {
            if (cancelled) return;
            setTypeCatalogs(previous => ({ ...previous, [id]: { state: 'ready', types, key: catalogKey } }));
        }).catch(error => {
            if (cancelled || isAuthenticationRequiredError(error)) return;
            const state = error?.code === 'configuration_incomplete' ? 'unscoped' : 'error';
            setTypeCatalogs(previous => ({ ...previous, [id]: { state, types: [], key: catalogKey, message: error?.message || '' } }));
        });
        return () => { cancelled = true; };
    }, [mode, visible, loadState, catalogKey, catalogRetry]);

    const typeCatalogFor = id => {
        const saved = entryById(baselineRef.current, id);
        const current = typeCatalogs[id];
        const expected = saved ? issueTypeCatalogKey(BACKEND_URL, catalogScopeFor(saved, '')) : '';
        // An answer for a superseded saved scope is never presented as current.
        if (!current || current.key !== expected) return { state: (saved?.scope.projects || []).length ? 'loading' : 'unscoped', types: [] };
        return current;
    };
    const retryTypeCatalog = () => {
        setTypeCatalogs({});
        setCatalogRetry(value => value + 1);
    };

    const catalogHintFor = entry => {
        const catalog = typeCatalogFor(entry.id);
        return {
            types: catalog.state === 'ready' ? Object.fromEntries(catalog.types.map(type => [type.id, type])) : null,
            fields: Array.isArray(jiraFields) ? jiraFields : null,
        };
    };

    // --- save -----------------------------------------------------------------------------------
    const save = async (baseRevision) => {
        const requested = cloneBundle(draftRef.current);
        const request = buildSaveRequest({
            baseline: baselineRef.current,
            draft: requested,
            promoted: promotedRef.current,
            baseRevision,
            explicitClears: explicitClearsRef.current,
        });
        let result;
        try {
            result = await saveWorkStructureConfig(BACKEND_URL, request);
        } catch (error) {
            const payload = error?.payload;
            if (error?.status === 409 && payload?.error === 'workspace_config_conflict') {
                error.payload = { ...payload, currentRevision: payload.configRevision };
            }
            const failure = fieldErrorFromServer(payload);
            if (failure) {
                setFieldErrors(previous => ({
                    ...previous,
                    [failure.configurationId]: { ...(previous[failure.configurationId] || {}), [failure.slot]: failure.message },
                }));
            }
            throw error;
        }
        const saved = result.workConfigurations;
        const unchangedSince = stable(draftRef.current) === stable(requested);
        setBaseline(cloneBundle(saved));
        setDraft(unchangedSince ? cloneBundle(saved) : adoptServerOwned(draftRef.current, saved));
        promotedRef.current = true;
        setPromoted(true);
        setFlags(previous => (previous.promoted ? previous : { ...previous, promoted: true }));
        if (Number.isInteger(result.configRevision)) setRevision(result.configRevision);
        explicitClearsRef.current = new Set();
        setFieldErrors({});
        const summary = missingSummary(saved, entry => catalogHintFor(entry));
        setSaveFeedback(summary ? `Saved. Incomplete mappings — ${summary}` : '');
        return result;
    };

    // Keep mine: re-target the whole draft at the latest bundle (server-owned parts adopted, every
    // editor-owned part kept) so one retry is a single CAS against the revision the server reported.
    const prepareKeepMine = (latest) => {
        if (!latest?.workConfigurations) return;
        const rebased = rebaseOntoLatest(draftRef.current, latest.workConfigurations);
        setBaseline(rebased.baseline);
        setDraft(rebased.draft);
        promotedRef.current = rebased.promoted;
        setPromoted(rebased.promoted);
        if (Number.isInteger(latest.configRevision)) setRevision(latest.configRevision);
    };

    const restoreDraft = React.useCallback((captured) => {
        if (captured) setDraft(cloneBundle(captured));
    }, []);

    const discard = () => {
        if (!baselineRef.current) return;
        setDraft(cloneBundle(baselineRef.current));
        explicitClearsRef.current = new Set();
        setFieldErrors({});
        setLimitMessages({});
        setSaveFeedback('');
    };

    const testSaved = async () => {
        const saved = entryById(baselineRef.current, activeEntryId);
        if (!saved) return;
        setGroupTesting(true);
        setGroupTestMessage('');
        try {
            if (dirty) {
                setGroupTestMessage('Save your changes before testing the saved configuration.');
                return;
            }
            const response = await testWorkConfiguration(BACKEND_URL, {
                configurationId: saved.id,
                configurationRevision: saved.revision,
            });
            const payload = await response.json().catch(() => ({}));
            const name = saved.name;
            if (payload?.error === 'configuration_scope_changed' || response.status === 409) {
                setGroupTestMessage(`${name}: the configuration changed; reload and retry.`);
            } else if (payload?.status === 'ok' || payload?.ok === true) {
                setGroupTestMessage(`${name}: saved configuration looks good.`);
            } else if (Array.isArray(payload?.missingFields) && payload.missingFields.length) {
                setGroupTestMessage(`${name}: saved configuration is incomplete — missing ${payload.missingFields.join(', ')}.`);
            } else if (!response.ok) {
                setGroupTestMessage(`${name}: the test could not be completed (${payload?.code || payload?.error || response.status}).`);
            } else {
                setGroupTestMessage(`${name}: the test result is unknown.`);
            }
        } catch (error) {
            if (!isAuthenticationRequiredError(error)) setGroupTestMessage('The configuration test could not be completed.');
        } finally {
            setGroupTesting(false);
        }
    };

    // Catalog defaults for the shared Department drawer and scoped reads: the configuration whose range
    // contains the viewed quarter; undefined when no quarter can be resolved.
    const scopeForQuarter = (quarter) => {
        if (!quarter || !baseline) return null;
        const ordinal = Number(quarter.slice(0, 4)) * 4 + Number(quarter.slice(-1));
        const entry = baseline.configurations.find(item => {
            const from = item.fromQuarter ? Number(item.fromQuarter.slice(0, 4)) * 4 + Number(item.fromQuarter.slice(-1)) : -Infinity;
            const through = item.throughQuarter ? Number(item.throughQuarter.slice(0, 4)) * 4 + Number(item.throughQuarter.slice(-1)) : Infinity;
            return ordinal >= from && ordinal <= through;
        });
        return entry ? catalogScopeFor(entry, quarter) : null;
    };

    return {
        mode,
        active: mode === 'enabled',
        unavailable: mode === 'unavailable',
        featureEnabled: flags.featureEnabled,
        summaries: flags.summaries,
        missingByConfiguration: flags.missingByConfiguration,
        applyBootstrap,
        loadState,
        loadError,
        reload,
        revision,
        promoted,
        userCanEdit,
        baseline,
        bundle: draft,
        entries,
        activeEntry: active,
        activeId: activeEntryId,
        selectConfiguration,
        drawerOpen,
        setDrawerOpen,
        tabFor,
        setTab,
        uiFor,
        setSearch,
        technicalIds,
        setTechnicalIds,
        patch,
        addProject,
        removeProject,
        limitMessages,
        validation,
        validationMessages: validation.messages,
        fieldErrors,
        dirty,
        dirtyIds,
        saveFeedback,
        typeCatalogFor,
        retryTypeCatalog,
        sprintValues,
        retrySprintValues: () => setSprintValuesTick(value => value + 1),
        catalogHintFor,
        save,
        prepareKeepMine,
        discard,
        restoreDraft,
        testSaved,
        scopeForQuarter,
        quarterHint,
        isLegacy: entry => entry?.model === MODEL_LEGACY,
    };
}
