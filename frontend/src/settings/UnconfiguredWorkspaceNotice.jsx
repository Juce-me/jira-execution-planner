import * as React from 'react';
import EmptyState from '../ui/EmptyState.jsx';

export default function UnconfiguredWorkspaceNotice({ canEditSettings, adminContacts, onOpenSettings }) {
    return (
        <section role="alert" aria-label="Dashboard configuration">
            <EmptyState className="unconfigured-workspace-notice" title="This dashboard is not configured yet.">
                {canEditSettings ? (
                    <>
                        <p>Choose the Jira scope projects and source Board to start loading work.</p>
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
