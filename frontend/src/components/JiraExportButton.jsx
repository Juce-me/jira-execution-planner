import * as React from 'react';
import { trackExternalLinkOpened } from '../analytics/analytics.js';
import { buildJiraIssueListLinkAnalytics } from '../analytics/externalLinks.js';
import { normalizeJiraExportKeys, openJiraIssueSearch } from '../jiraExportUtils.mjs';

function pluralize(count, singular, plural) {
    return count === 1 ? singular : plural;
}

export default function JiraExportButton({
    jiraUrl,
    epicKeys = [],
    storyKeys = [],
    className = '',
    opener,
    sourceSurface = 'dashboard',
}) {
    const [isOpen, setIsOpen] = React.useState(false);
    const [warning, setWarning] = React.useState('');
    const rootRef = React.useRef(null);
    const warningTimerRef = React.useRef(null);
    const normalizedEpicKeys = React.useMemo(() => normalizeJiraExportKeys(epicKeys), [epicKeys]);
    const normalizedStoryKeys = React.useMemo(() => normalizeJiraExportKeys(storyKeys), [storyKeys]);
    const keyMap = {
        epics: normalizedEpicKeys,
        stories: normalizedStoryKeys
    };
    const hasAnyKeys = normalizedEpicKeys.length > 0 || normalizedStoryKeys.length > 0;
    const isHidden = !String(jiraUrl || '').trim();
    const triggerTitle = hasAnyKeys ? 'Open visible issues in Jira' : 'No visible issues to open in Jira';

    React.useEffect(() => {
        const handleDocumentClick = (event) => {
            if (!rootRef.current || rootRef.current.contains(event.target)) return;
            setIsOpen(false);
        };
        document.addEventListener('mousedown', handleDocumentClick);
        return () => document.removeEventListener('mousedown', handleDocumentClick);
    }, []);

    React.useEffect(() => () => {
        if (warningTimerRef.current) {
            window.clearTimeout(warningTimerRef.current);
        }
    }, []);

    if (isHidden) {
        return null;
    }

    const showOverflowWarning = (count) => {
        setWarning(`Opening ${count} issues may exceed Jira URL limits.`);
        if (warningTimerRef.current) {
            window.clearTimeout(warningTimerRef.current);
        }
        warningTimerRef.current = window.setTimeout(() => setWarning(''), 4500);
    };

    const openKind = (issueKind) => {
        const keys = keyMap[issueKind];
        if (!keys.length) return;
        const result = openJiraIssueSearch({
            jiraUrl,
            keys,
            opener,
            onOverflow: showOverflowWarning
        });
        if (result.opened) {
            trackExternalLinkOpened(buildJiraIssueListLinkAnalytics({
                issueKind: issueKind === 'epics' ? 'epic' : 'story',
                issueCount: result.keyCount,
                sourceSurface
            }));
        }
        setIsOpen(false);
    };

    const renderMenuItem = (issueKind, label, singular, plural) => {
        const keys = keyMap[issueKind];
        const count = keys.length;
        return (
            <button
                type="button"
                className="jira-export-menu-item"
                role="menuitem"
                onClick={() => openKind(issueKind)}
                disabled={count === 0}
                title={count ? `Open ${count} ${pluralize(count, singular, plural)} in Jira` : `No ${plural} visible`}
            >
                <span>{label}</span>
                <span className="jira-export-menu-count">{count}</span>
            </button>
        );
    };

    return (
        <div className={`jira-export ${className}`.trim()} ref={rootRef}>
            <button
                type="button"
                className="secondary compact jira-export-icon-button"
                onClick={() => setIsOpen(open => !open)}
                disabled={!hasAnyKeys}
                title={triggerTitle}
                aria-label="Open Jira issue menu"
                aria-haspopup="menu"
                aria-expanded={isOpen}
            >
                <svg
                    className="jira-export-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                >
                    <path className="jira-export-icon-mark jira-export-icon-mark-secondary" d="M11.8 3.2 3 12l8.8 8.8 3-3L9 12l5.8-5.8-3-3z" />
                    <path className="jira-export-icon-mark" d="M12.2 3.2 21 12l-8.8 8.8-3-3L15 12 9.2 6.2l3-3z" />
                </svg>
            </button>
            {isOpen && hasAnyKeys && (
                <div className="jira-export-menu" role="menu">
                    {renderMenuItem('epics', 'Open epics', 'epic', 'epics')}
                    {renderMenuItem('stories', 'Open stories', 'story', 'stories')}
                </div>
            )}
            {warning && (
                <div className="jira-export-toast" role="status">
                    {warning}
                </div>
            )}
        </div>
    );
}
