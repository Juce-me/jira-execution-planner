import * as React from 'react';
import IssuePersonEditor from '../issues/IssuePersonEditor.jsx';
import { searchAssignableUsers } from '../api/assigneeCapacityApi.js';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY = 3;
// No Jira field: picking a person adds a row to the assignee capacity store (application storage), never writes Jira.
const METADATA = Object.freeze({ editable: true, me: null, currentValue: null, issueKey: '' });

const searchErrorText = error => (error?.code === 'jira_rate_limited'
    ? 'Jira is busy. Try again in a moment.'
    : 'People search failed. Try again.');

// Add assignee (#323): a wrapper over the shared person editor that searches people assignable in the workspace's
// selected Product and Tech projects (debounced, the previous search aborted) and hands the chosen person to `onAdd`.
export default function PlanningAssigneeAddPicker({ backendUrl, onAdd }) {
    const [open, setOpen] = React.useState(false);
    const [suggestions, setSuggestions] = React.useState([]);
    const [searching, setSearching] = React.useState(false);
    const [error, setError] = React.useState('');
    const [status, setStatus] = React.useState('');
    const timer = React.useRef(null);
    const abort = React.useRef(null);
    const stop = () => {
        if (timer.current != null) { clearTimeout(timer.current); timer.current = null; }
        abort.current?.abort(); abort.current = null;
    };
    React.useEffect(() => stop, []);
    const reset = () => { stop(); setSuggestions([]); setSearching(false); setError(''); setStatus(''); };
    const onSearch = value => {
        stop();
        setError(''); setStatus(''); setSuggestions([]);
        const query = String(value || '').trim();
        if (Array.from(query).length < MIN_QUERY) { setSearching(false); return; }
        setSearching(true);
        timer.current = setTimeout(async () => {
            timer.current = null;
            const controller = new AbortController();
            abort.current = controller;
            try {
                const result = await searchAssignableUsers(backendUrl, query, { signal: controller.signal });
                if (controller.signal.aborted) return;
                setSuggestions(result.users);
                if (result.reason === 'no_selected_projects') setStatus('No Product or Tech projects are selected to search in.');
            } catch (failure) {
                if (controller.signal.aborted || failure?.name === 'AbortError' || failure?.name === 'AuthenticationRequiredError') return;
                setError(searchErrorText(failure));
            } finally {
                if (abort.current === controller) { abort.current = null; setSearching(false); }
            }
        }, SEARCH_DEBOUNCE_MS);
    };
    return <IssuePersonEditor
        issueKey=""
        fieldLabel="Assignee to add"
        emptyLabel="Add assignee"
        matchQuery={null}
        maxOptions={10}
        isOpen={open}
        metadata={METADATA}
        suggestions={suggestions}
        searching={searching}
        error={error}
        statusMessage={status}
        onOpen={() => { reset(); setOpen(true); }}
        onClose={() => { reset(); setOpen(false); }}
        onSearch={onSearch}
        onSelect={person => { reset(); setOpen(false); onAdd({ accountId: person.accountId, displayName: person.displayName }); }}
    />;
}
