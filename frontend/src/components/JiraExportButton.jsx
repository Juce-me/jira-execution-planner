import * as React from 'react';
import { trackExternalLinkOpened } from '../analytics/analytics.js';
import { buildJiraIssueListLinkAnalytics } from '../analytics/externalLinks.js';
import { normalizeJiraExportKeys, openJiraIssueSearch } from '../jiraExportUtils.mjs';
import IconButton from '../ui/IconButton.jsx';
import JiraMarkIcon from '../ui/JiraMarkIcon.jsx';

const DEFAULT_WORK_ITEM_LABELS = Object.freeze({
    label: 'Open work items',
    singular: 'work item',
    plural: 'work items',
});

function pluralize(count, singular, plural) {
    return count === 1 ? singular : plural;
}

function exportLabel(value, fallback) {
    return String(value || '').trim() || fallback;
}

export default function JiraExportButton({
    jiraUrl,
    epicKeys = [],
    storyKeys = [],
    workItemKeys,
    workItemLabels = DEFAULT_WORK_ITEM_LABELS,
    className = '',
    opener,
    sourceSurface = 'dashboard',
    onboardingTarget = '',
}) {
    const [isOpen, setIsOpen] = React.useState(false);
    const [warning, setWarning] = React.useState('');
    const rootRef = React.useRef(null);
    const warningTimerRef = React.useRef(null);
    const normalizedEpicKeys = React.useMemo(() => normalizeJiraExportKeys(epicKeys), [epicKeys]);
    const normalizedStoryKeys = React.useMemo(() => normalizeJiraExportKeys(storyKeys), [storyKeys]);
    const normalizedWorkItemKeys = React.useMemo(
        () => normalizeJiraExportKeys(workItemKeys || []),
        [workItemKeys],
    );
    const hasWorkItemExport = workItemKeys !== undefined;
    const resolvedWorkItemLabels = {
        label: exportLabel(workItemLabels?.label, DEFAULT_WORK_ITEM_LABELS.label),
        singular: exportLabel(workItemLabels?.singular, DEFAULT_WORK_ITEM_LABELS.singular),
        plural: exportLabel(workItemLabels?.plural, DEFAULT_WORK_ITEM_LABELS.plural),
    };
    const keyMap = {
        epics: normalizedEpicKeys,
        stories: normalizedStoryKeys,
        work_items: normalizedWorkItemKeys,
    };
    const hasAnyKeys = normalizedEpicKeys.length > 0
        || (hasWorkItemExport ? normalizedWorkItemKeys.length > 0 : normalizedStoryKeys.length > 0);
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
                issueKind: issueKind === 'epics' ? 'epic' : issueKind === 'work_items' ? 'mixed' : 'story',
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
            <IconButton
                variant="secondary compact"
                className="header-icon-button jira-export-icon-button"
                onClick={() => setIsOpen(open => !open)}
                disabled={!hasAnyKeys}
                title={triggerTitle}
                aria-label="Open Jira issue menu"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                data-onboarding-target={onboardingTarget || undefined}
            >
                <JiraMarkIcon className="jira-export-icon" />
            </IconButton>
            {isOpen && hasAnyKeys && (
                <div className="jira-export-menu" role="menu">
                    {renderMenuItem('epics', 'Open epics', 'epic', 'epics')}
                    {hasWorkItemExport
                        ? renderMenuItem(
                            'work_items', resolvedWorkItemLabels.label,
                            resolvedWorkItemLabels.singular,
                            resolvedWorkItemLabels.plural,
                        )
                        : renderMenuItem('stories', 'Open stories', 'story', 'stories')}
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
