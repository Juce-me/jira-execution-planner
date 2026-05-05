import * as React from 'react';
import { normalizeJiraExportKeys, openJiraIssueSearch } from '../jiraExportUtils.mjs';

function pluralize(count, singular, plural) {
    return count === 1 ? singular : plural;
}

export default function JiraExportButton({
    jiraUrl,
    epicKeys = [],
    storyKeys = [],
    defaultIssueKind = 'stories',
    className = '',
    opener,
}) {
    const [isOpen, setIsOpen] = React.useState(false);
    const [warning, setWarning] = React.useState('');
    const rootRef = React.useRef(null);
    const warningTimerRef = React.useRef(null);
    const normalizedEpicKeys = React.useMemo(() => normalizeJiraExportKeys(epicKeys), [epicKeys]);
    const normalizedStoryKeys = React.useMemo(() => normalizeJiraExportKeys(storyKeys), [storyKeys]);
    const defaultKind = defaultIssueKind === 'epics' ? 'epics' : 'stories';
    const keyMap = {
        epics: normalizedEpicKeys,
        stories: normalizedStoryKeys
    };
    const defaultKeys = keyMap[defaultKind];
    const hasAnyKeys = normalizedEpicKeys.length > 0 || normalizedStoryKeys.length > 0;
    const isHidden = !String(jiraUrl || '').trim();
    const defaultSingular = defaultKind === 'epics' ? 'epic' : 'story';
    const defaultPlural = defaultKind === 'epics' ? 'epics' : 'stories';
    const defaultTitle = defaultKeys.length
        ? `Open ${defaultKeys.length} ${pluralize(defaultKeys.length, defaultSingular, defaultPlural)} in Jira`
        : `No ${defaultPlural} visible to open in Jira`;

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
        openJiraIssueSearch({
            jiraUrl,
            keys,
            opener,
            onOverflow: showOverflowWarning
        });
        setIsOpen(false);
    };

    const renderMenuItem = (issueKind, label, singular, plural) => {
        const keys = keyMap[issueKind];
        const count = keys.length;
        const isDefault = issueKind === defaultKind;
        return (
            <button
                type="button"
                className={`jira-export-menu-item ${isDefault ? 'active' : ''}`}
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
            <div className="jira-export-split">
                <button
                    type="button"
                    className="secondary compact jira-export-primary"
                    onClick={() => openKind(defaultKind)}
                    disabled={defaultKeys.length === 0}
                    title={defaultTitle}
                >
                    Open in Jira
                </button>
                <button
                    type="button"
                    className="secondary compact jira-export-caret"
                    onClick={() => setIsOpen(open => !open)}
                    disabled={!hasAnyKeys}
                    title={hasAnyKeys ? defaultTitle : 'No visible issues to open in Jira'}
                    aria-label="Choose Jira export issue type"
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                >
                    ▾
                </button>
            </div>
            {isOpen && hasAnyKeys && (
                <div className="jira-export-menu" role="menu">
                    {renderMenuItem('epics', 'Epics only', 'epic', 'epics')}
                    {renderMenuItem('stories', 'Stories only', 'story', 'stories')}
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
