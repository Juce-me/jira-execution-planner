import * as React from 'react';
import { isAuthenticationRequiredError, readPendingAuthenticationRequired } from '../api/authRequired.js';
import { fetchEditableIssueField, searchIssueFieldUsers, updateIssueField } from '../api/jiraIssueApi.js';
import { enqueueEngIssueMutations } from './engIssueMutationQueue.js';
import { hasIssueUserSearchThreshold, normalizeIssueUserSuggestions } from './engIssueFieldEditUtils.js';

const KNOWN_REJECTION_CODES = new Set([
    'invalid_json', 'invalid_issue_key', 'invalid_field', 'invalid_query', 'invalid_value', 'unsupported_field',
    'csrf_required', 'jira_oauth_required', 'jira_edit_forbidden', 'issue_not_found', 'field_not_editable',
    'issue_type_not_supported', 'field_mapping_changed', 'target_unavailable', 'stale_issue',
    'jira_field_rejected', 'jira_configuration_invalid', 'jira_rate_limited', 'jira_read_failed',
]);
const SUBMITTABLE_STATUSES = new Set(['ready', 'draft']);

const ERROR_MESSAGES = Object.freeze({
    stale_issue: 'This field changed in Jira. Reload it before saving again.',
    field_mapping_changed: 'The Jira field configuration changed. Reload before editing.',
    field_not_editable: 'This field is no longer editable in Jira.',
    target_unavailable: 'That person is no longer available for this field.',
    jira_field_rejected: 'Jira rejected this field value. Review the selection and try again.',
    jira_configuration_invalid: 'Jira rejected the configured field. Check the Jira field configuration.',
    jira_rate_limited: 'Jira is temporarily limiting requests. Try again later.',
    jira_read_failed: 'The latest Jira value could not be loaded. Reload and try again.',
    write_outcome_unknown: 'Jira may have received the change. Check Jira before submitting again.',
    auth_required: 'Authentication is required to continue.',
});

export function issueFieldErrorMessage(code) {
    return ERROR_MESSAGES[code] || 'The Jira field could not be updated.';
}

function abortError() {
    const error = new Error('Canceled before dispatch.');
    error.name = 'AbortError';
    return error;
}

function normalizedIssueKey(value) {
    return String(value || '').trim().toUpperCase();
}

function unknownSubmissionKey(editor) {
    return `${normalizedIssueKey(editor?.issueKey)}::${String(editor?.field || '')}`;
}

function mutationValue(field, value) {
    if (field === 'storyPoints' || value === null) return value;
    return { accountId: String(value?.accountId || '').trim() };
}

export function createEngIssueFieldEditController(options = {}) {
    let runtimeOptions = options;
    let enqueueMutation = options.enqueueMutation || enqueueEngIssueMutations;
    const fetchEditableField = options.fetchEditableField || fetchEditableIssueField;
    const searchUsers = options.searchUsers || searchIssueFieldUsers;
    const updateField = options.updateField || updateIssueField;
    const getContextKey = () => runtimeOptions.getContextKey?.() || '';
    const isAuthLocked = () => runtimeOptions.isAuthLocked
        ? runtimeOptions.isAuthLocked()
        : Boolean(readPendingAuthenticationRequired());
    const debounceMs = Number.isFinite(options.debounceMs) ? Math.max(0, options.debounceMs) : 300;
    const listeners = new Set();
    const pendingTokens = new Map();
    const submissions = new Set();
    let sequence = 0;
    let metadataRequest = null;
    let searchRequest = null;
    let searchTimer = null;
    const unknownSubmissions = new Map();
    let state = {
        activeEditor: null, status: 'closed', metadata: null, suggestions: [], searchQuery: '', searching: false,
        pendingIssueKeys: new Set(), outcome: null, errorCode: '', errorMessage: '',
    };

    const publish = patch => {
        state = { ...state, ...patch };
        listeners.forEach(listener => listener());
    };
    const isCurrentEditor = id => state.activeEditor?.id === id;
    const enterAuthRequired = () => {
        publish({ status: 'auth-required', activeEditor: null, errorCode: 'auth_required', errorMessage: issueFieldErrorMessage('auth_required') });
        runtimeOptions.onAuthRecoveryRequired?.();
    };
    const cancelSearch = () => {
        if (searchTimer) {
            clearTimeout(searchTimer.timer);
            searchTimer.resolve(null);
            searchTimer = null;
        }
        searchRequest?.controller.abort();
        searchRequest = null;
    };
    const addPending = (key, token) => {
        const tokens = pendingTokens.get(key) || new Set();
        tokens.add(token);
        pendingTokens.set(key, tokens);
        publish({ pendingIssueKeys: new Set(pendingTokens.keys()) });
    };
    const removePending = (key, token) => {
        const tokens = pendingTokens.get(key);
        tokens?.delete(token);
        if (!tokens?.size) pendingTokens.delete(key);
        publish({ pendingIssueKeys: new Set(pendingTokens.keys()) });
    };
    const canDispatch = frozen => !frozen.controller.signal.aborted
        && !isAuthLocked()
        && getContextKey() === frozen.contextKey;

    const loadMetadata = async (editor, { reconciliation = false, recoveryStatus = '' } = {}) => {
        metadataRequest?.controller.abort();
        const controller = new AbortController();
        const token = ++sequence;
        metadataRequest = { controller, token };
        if (!reconciliation && isCurrentEditor(editor.id)) publish({ status: 'loading', errorCode: '', errorMessage: '' });
        try {
            const result = await fetchEditableField(runtimeOptions.backendUrl || '', editor.issueKey, editor.field, { signal: controller.signal });
            if (metadataRequest?.token !== token || (!reconciliation && !isCurrentEditor(editor.id))) return null;
            if (!reconciliation) {
                publish({
                    metadata: result,
                    suggestions: normalizeIssueUserSuggestions(result?.me, []),
                    status: result?.editable ? 'ready' : 'rejected',
                    errorCode: result?.editable ? '' : result?.reason || 'field_not_editable',
                    errorMessage: result?.editable ? '' : issueFieldErrorMessage(result?.reason || 'field_not_editable'),
                });
            }
            return result;
        } catch (error) {
            if (error?.name === 'AbortError') return null;
            if (isAuthenticationRequiredError(error)) {
                enterAuthRequired();
                return null;
            }
            if (!reconciliation && isCurrentEditor(editor.id)) {
                const code = error?.code || 'jira_read_failed';
                publish({
                    status: recoveryStatus || 'rejected',
                    ...(recoveryStatus ? { outcome: { status: recoveryStatus } } : {}),
                    errorCode: code,
                    errorMessage: issueFieldErrorMessage(code),
                });
            }
            return null;
        } finally {
            if (metadataRequest?.token === token) metadataRequest = null;
        }
    };

    const openEditor = descriptor => {
        cancelSearch();
        metadataRequest?.controller.abort();
        submissions.forEach(submission => {
            if (!submission.dispatched) submission.controller.abort();
        });
        const editor = {
            id: ++sequence,
            issueKey: normalizedIssueKey(descriptor?.issueKey),
            field: descriptor?.field,
            issueKind: descriptor?.issueKind || '',
            sourceSurface: descriptor?.sourceSurface || '',
        };
        runtimeOptions.onAction?.('open', editor);
        publish({
            activeEditor: editor, status: 'loading', metadata: null, suggestions: [], searchQuery: '', searching: false,
            outcome: null, errorCode: '', errorMessage: '',
        });
        return loadMetadata(editor);
    };

    const closeEditor = reason => {
        if (reason === 'unchanged' && state.activeEditor) {
            runtimeOptions.onAction?.('submit', state.activeEditor);
            runtimeOptions.onAction?.('result', state.activeEditor, 'unchanged');
        }
        cancelSearch();
        metadataRequest?.controller.abort();
        metadataRequest = null;
        submissions.forEach(submission => {
            if (!submission.dispatched) submission.controller.abort();
        });
        publish({ activeEditor: null, status: 'closed', metadata: null, suggestions: [], searchQuery: '', searching: false });
    };

    const search = queryValue => {
        const query = String(queryValue || '').trim();
        const editor = state.activeEditor;
        const metadata = state.metadata;
        cancelSearch();
        publish({
            searchQuery: query,
            searching: hasIssueUserSearchThreshold(query),
            suggestions: normalizeIssueUserSuggestions(metadata?.me, []),
        });
        if (!editor || !metadata || !hasIssueUserSearchThreshold(query)) return Promise.resolve(null);
        const editorId = editor.id;
        const searchToken = ++sequence;
        return new Promise(resolve => {
            const timer = setTimeout(async () => {
                searchTimer = null;
                const controller = new AbortController();
                searchRequest = { controller, token: searchToken };
                try {
                    const result = await searchUsers(runtimeOptions.backendUrl || '', editor.issueKey, {
                        field: editor.field, query,
                    }, { signal: controller.signal });
                    if (searchRequest?.token !== searchToken || !isCurrentEditor(editorId) || state.searchQuery !== query) return resolve(null);
                    publish({ suggestions: normalizeIssueUserSuggestions(metadata.me, result?.options), searching: false });
                    resolve(result);
                } catch (error) {
                    if (isAuthenticationRequiredError(error)) {
                        enterAuthRequired();
                        return resolve(null);
                    }
                    if (error?.name !== 'AbortError' && searchRequest?.token === searchToken && isCurrentEditor(editorId)) {
                        const code = error?.code || 'jira_read_failed';
                        publish({ searching: false, errorCode: code, errorMessage: issueFieldErrorMessage(code) });
                    }
                    resolve(null);
                } finally {
                    if (searchRequest?.token === searchToken) searchRequest = null;
                }
            }, debounceMs);
            searchTimer = { timer, resolve };
        });
    };

    const submit = async value => {
        const editor = state.activeEditor;
        const metadata = state.metadata;
        if (!editor || !SUBMITTABLE_STATUSES.has(state.status) || !metadata?.editable || !metadata.mappingRevision) return null;
        if (unknownSubmissions.has(unknownSubmissionKey(editor))) return null;
        if (isAuthLocked()) {
            enterAuthRequired();
            return null;
        }
        runtimeOptions.onAction?.('submit', editor);
        const token = ++sequence;
        const editState = runtimeOptions.issueEditState;
        const frozen = {
            token, editor: { ...editor }, metadata, desiredValue: value, mutation: null,
            contextKey: getContextKey(), backendUrl: runtimeOptions.backendUrl || '', editState,
            controller: new AbortController(), dispatched: false,
        };
        submissions.add(frozen);
        addPending(editor.issueKey, token);
        if (isCurrentEditor(editor.id)) publish({ status: 'queued', outcome: null, errorCode: '', errorMessage: '' });
        try {
            const response = await enqueueMutation([editor.issueKey], async () => {
                if (!canDispatch(frozen)) throw abortError();
                frozen.dispatched = true;
                frozen.mutation = frozen.editState?.beginMutation?.(editor.issueKey, editor.field, metadata.mappingRevision);
                if (isCurrentEditor(editor.id)) publish({ status: 'saving' });
                return updateField(frozen.backendUrl, editor.issueKey, {
                    field: editor.field,
                    value: mutationValue(editor.field, value),
                    baseValue: mutationValue(editor.field, metadata.currentValue),
                    baseUpdated: metadata.baseUpdated,
                    mappingRevision: metadata.mappingRevision,
                });
            }, { signal: frozen.controller.signal, shouldStart: () => canDispatch(frozen) });
            if (getContextKey() !== frozen.contextKey || isAuthLocked()) return null;
            frozen.editState?.confirmMutation?.(frozen.mutation, response?.value, { mappingRevision: response?.mappingRevision ?? metadata.mappingRevision });
            unknownSubmissions.delete(unknownSubmissionKey(editor));
            runtimeOptions.onConfirm?.({ issueKey: editor.issueKey, field: editor.field, value: response?.value, response, frozenContext: frozen.contextKey });
            runtimeOptions.onAction?.('result', editor, response?.result === 'unchanged' ? 'unchanged' : 'success');
            if (isCurrentEditor(editor.id)) publish({ status: 'confirmed', outcome: { status: 'confirmed', response }, errorCode: '', errorMessage: '' });
            return response;
        } catch (error) {
            if (getContextKey() !== frozen.contextKey) return null;
            if (isAuthenticationRequiredError(error)) {
                enterAuthRequired();
                return null;
            }
            if (error?.name === 'AbortError' && !frozen.dispatched) {
                if (isAuthLocked()) enterAuthRequired();
                return null;
            }
            const code = error?.code || (frozen.dispatched ? 'write_outcome_unknown' : 'jira_issue_field_failed');
            const unknown = frozen.dispatched && (code === 'write_outcome_unknown' || !KNOWN_REJECTION_CODES.has(code));
            if (unknown) {
                frozen.editState?.markUnknown?.(frozen.mutation);
                unknownSubmissions.set(unknownSubmissionKey(editor), frozen);
                runtimeOptions.onUnknown?.({ issueKey: editor.issueKey, field: editor.field, frozenContext: frozen.contextKey });
                runtimeOptions.onAction?.('result', editor, 'unknown');
                if (!state.activeEditor || isCurrentEditor(editor.id)) {
                    publish({ outcome: { status: 'unknown' }, status: 'unknown', errorCode: 'write_outcome_unknown', errorMessage: issueFieldErrorMessage('write_outcome_unknown') });
                }
            } else if (isCurrentEditor(editor.id)) {
                const conflict = code === 'stale_issue' || code === 'field_mapping_changed';
                runtimeOptions.onAction?.('result', editor, conflict ? 'conflict' : 'failure');
                publish({
                    status: conflict ? 'conflict' : 'draft',
                    outcome: { status: conflict ? 'conflict' : 'rejected' },
                    errorCode: code, errorMessage: issueFieldErrorMessage(code),
                    ...(code === 'stale_issue' && Object.prototype.hasOwnProperty.call(error, 'currentValue')
                        ? { metadata: { ...metadata, currentValue: error.currentValue, baseUpdated: error.baseUpdated, mappingRevision: error.mappingRevision } }
                        : {}),
                });
            }
            return null;
        } finally {
            submissions.delete(frozen);
            removePending(editor.issueKey, token);
        }
    };

    const reload = () => state.activeEditor
        ? loadMetadata(state.activeEditor, { recoveryStatus: state.status === 'conflict' ? 'conflict' : '' })
        : Promise.resolve(null);

    const checkJira = async () => {
        const activeEditor = state.activeEditor;
        const frozen = activeEditor ? unknownSubmissions.get(unknownSubmissionKey(activeEditor)) : null;
        if (!frozen || !frozen.metadata.mappingRevision || getContextKey() !== frozen.contextKey) return null;
        const editorId = activeEditor.id;
        const submissionKey = unknownSubmissionKey(activeEditor);
        let observed;
        try {
            observed = await fetchEditableField(frozen.backendUrl, frozen.editor.issueKey, frozen.editor.field);
        } catch (error) {
            if (getContextKey() !== frozen.contextKey || unknownSubmissions.get(submissionKey) !== frozen || !isCurrentEditor(editorId)) return null;
            if (isAuthenticationRequiredError(error)) enterAuthRequired();
            else publish({ outcome: { status: 'unknown' }, status: 'unknown', errorCode: 'jira_read_failed', errorMessage: issueFieldErrorMessage('jira_read_failed') });
            return null;
        }
        if (getContextKey() !== frozen.contextKey || unknownSubmissions.get(submissionKey) !== frozen || !isCurrentEditor(editorId)) return null;
        if (!observed?.mappingRevision || observed.mappingRevision !== frozen.metadata.mappingRevision) {
            publish({ outcome: { status: 'unknown', configurationChanged: true }, status: 'unknown' });
            return observed;
        }
        frozen.editState?.confirmMutation?.(frozen.mutation, observed.currentValue, { mappingRevision: observed.mappingRevision });
        runtimeOptions.onConfirm?.({ issueKey: frozen.editor.issueKey, field: frozen.editor.field, value: observed.currentValue, observed: true, frozenContext: frozen.contextKey });
        unknownSubmissions.delete(unknownSubmissionKey(frozen.editor));
        publish({ outcome: { status: 'observed', value: observed.currentValue }, status: 'ready', metadata: observed, errorCode: '', errorMessage: '' });
        return observed;
    };

    const contextChanged = ({ authChanged = false } = {}) => {
        cancelSearch();
        metadataRequest?.controller.abort();
        submissions.forEach(submission => {
            if (!submission.dispatched) submission.controller.abort();
        });
        if (authChanged) unknownSubmissions.clear();
        publish({ activeEditor: null, status: 'closed', metadata: null, suggestions: [], searching: false });
    };

    return {
        getState: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        openEditor, closeEditor, search, submit, reload, checkJira, contextChanged,
        configureQueue(next) { enqueueMutation = next; },
        configure(next) { runtimeOptions = { ...runtimeOptions, ...next }; },
    };
}

export function useEngIssueFieldEdits(options) {
    const controller = React.useMemo(() => createEngIssueFieldEditController(options), [options.backendUrl, options.issueEditState]);
    controller.configure(options);
    const state = React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
    const contextKey = options.getContextKey?.() || '';
    const priorContextRef = React.useRef(contextKey);
    React.useEffect(() => {
        if (priorContextRef.current !== contextKey) controller.contextChanged({ authChanged: true });
        priorContextRef.current = contextKey;
    }, [contextKey, controller]);
    React.useEffect(() => () => controller.contextChanged({ authChanged: true }), [controller]);
    return { ...state, ...controller };
}
