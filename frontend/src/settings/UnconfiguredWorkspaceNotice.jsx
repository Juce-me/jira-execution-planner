import * as React from 'react';
import EmptyState from '../ui/EmptyState.jsx';

const MISSING_LABELS = [
    [/^scope\.projects/, 'Jira projects'],
    [/^scope\.boardId/, 'source Board'],
    [/^fields\.sprint/, 'Sprint field'],
    [/^fields\.storyPoints/, 'Story Points field'],
    [/^fields\.team/, 'Team field'],
    [/^fields\.parentName/, 'Parent name field'],
    [/^hierarchy\.planning/, 'planning issue type'],
    [/^hierarchy\.parent/, 'parent issue type'],
    [/^hierarchy\.ancestor/, 'ancestor issue type'],
    [/^hierarchy\./, 'issue type mapping'],
];
const SOURCE_PATHS = /^(scope\.projects|scope\.boardId|fields\.sprint)/;

// Missing setup paths from the bootstrap, as unique readable names.
function missingSetupNames(paths) {
    const names = [];
    for (const path of Array.isArray(paths) ? paths : []) {
        const label = MISSING_LABELS.find(([pattern]) => pattern.test(String(path)))?.[1] || null;
        if (label && !names.includes(label)) names.push(label);
    }
    return names;
}

const OBSERVED_GUIDANCE = 'No Jira Sprint has been observed for this quarter; refresh or choose a source Board.';

function ScopedGuidance({ scope }) {
    const names = missingSetupNames(scope.missing);
    const missingSource = (scope.missing || []).some(path => SOURCE_PATHS.test(String(path)));
    if (scope.status === 'not_observed') return <p>{OBSERVED_GUIDANCE}</p>;
    if (scope.status === 'no_configuration') return <p>No project configuration covers {scope.quarter}.</p>;
    return (
        <>
            {names.length > 0 && <p>Missing: {names.join(', ')}.</p>}
            {missingSource && <p>No source is set up: choose a source Board, or Jira projects with a Sprint field.</p>}
        </>
    );
}

export default function UnconfiguredWorkspaceNotice({ canEditSettings, adminContacts, onOpenSettings, scope = null }) {
    const title = scope
        ? (scope.status === 'not_observed'
            ? `${scope.quarter} has no Sprint yet.`
            : `${scope.configurationName || 'This configuration'} is not ready for ${scope.quarter}.`)
        : 'This dashboard is not configured yet.';
    return (
        <section role="alert" aria-label="Dashboard configuration" data-quarter-notice={scope ? scope.quarter : undefined}>
            <EmptyState className="unconfigured-workspace-notice" title={title}>
                {scope && <ScopedGuidance scope={scope} />}
                {canEditSettings ? (
                    <>
                        {!scope && <p>Choose the Jira scope projects and source Board to start loading work.</p>}
                        <button type="button" onClick={onOpenSettings}>Open admin settings</button>
                    </>
                ) : adminContacts.length > 0 ? (
                    <>
                        <p>Reach out to a tool admin to configure it:</p>
                        <ul className="unconfigured-workspace-admins">
                            {adminContacts.map(name => <li key={name}>{name}</li>)}
                        </ul>
                    </>
                ) : (
                    <p>No tool admin is set up yet. Reach out to the person who runs this app.</p>
                )}
            </EmptyState>
        </section>
    );
}
