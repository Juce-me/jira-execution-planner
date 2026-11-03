import * as React from 'react';
import { buildJiraBrowseLinkAnalytics } from '../analytics/externalLinks.js';
import TrackedExternalLink from '../components/TrackedExternalLink.jsx';
import WorkTypeGlyph from '../issues/WorkTypeGlyph.jsx';
import { WORK_MODEL_LEGACY, resolveEntityNames } from './engWorkModel.js';

const LEGACY_NAMES = resolveEntityNames(WORK_MODEL_LEGACY);

// The missing child's type glyph: the dashed placeholder bookmark at level 0, otherwise the level's own glyph.
function StoryRequirementIcon({ level, InitiativeIcon }) {
    return (
        <span className="story-requirement-icon" aria-hidden="true">
            {level >= 1 ? <WorkTypeGlyph level={level} InitiativeIcon={InitiativeIcon} /> : <svg viewBox="0 0 24 24" fill="none">
                <path
                    d="M7 4h10a2 2 0 0 1 2 2v14l-7-4-7 4V6a2 2 0 0 1 2-2Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray="3 2"
                    strokeLinejoin="round"
                />
                <path d="M9 9h6M9 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>}
        </span>
    );
}

export default function StoryRequirementCard({
    requirement = null,
    requirementId: requirementIdProp,
    epicKey: epicKeyProp,
    epicSummary: epicSummaryProp = '',
    teamId: teamIdProp,
    teamName: teamNameProp,
    sprintName: sprintNameProp,
    sprintState: sprintStateProp,
    jiraUrl,
    sourceSurface = 'catch_up',
    highlighted = false,
    entityNames = LEGACY_NAMES,
    InitiativeIcon = null,
}) {
    const requirementId = requirementIdProp ?? requirement?.targetId ?? requirement?.id;
    const epicKey = epicKeyProp ?? requirement?.epicKey ?? requirement?.epic?.key;
    const epicSummary = epicSummaryProp || requirement?.epic?.summary || '';
    const teamId = teamIdProp ?? requirement?.team?.id;
    const teamName = teamNameProp ?? requirement?.team?.name;
    const sprintName = sprintNameProp ?? requirement?.sprint?.name;
    const sprintState = sprintStateProp ?? requirement?.sprint?.state;
    const normalizedSprintState = String(sprintState || '').trim().toLowerCase();
    if (!['active', 'future'].includes(normalizedSprintState)) return null;

    const normalizedEpicKey = String(epicKey || '').trim();
    const normalizedTeamName = String(teamName || '').trim();
    const normalizedSprintName = String(sprintName || '').trim();
    if (!normalizedEpicKey || !normalizedTeamName || !normalizedSprintName) return null;

    const jiraBaseUrl = String(jiraUrl || '').replace(/\/+$/, '');
    const href = jiraBaseUrl ? `${jiraBaseUrl}/browse/${encodeURIComponent(normalizedEpicKey)}` : '#';
    const urgency = normalizedSprintState === 'active'
        ? 'Current sprint · action needed'
        : 'Future sprint · plan ahead';
    const accessibleEpic = String(epicSummary || '').trim()
        ? `${normalizedEpicKey}, ${String(epicSummary).trim()}`
        : normalizedEpicKey;
    const { child, parent } = entityNames;
    const accessibleName = `${accessibleEpic}: ${child} required for ${normalizedTeamName}, target sprint ${normalizedSprintName}. Opens the ${parent} in Jira to create the ${child}.`;

    return (
        <TrackedExternalLink
            id={requirementId || undefined}
            className={`story-requirement-card story-requirement-${normalizedSprintState} ${highlighted ? 'story-requirement-highlight' : ''}`.trim()}
            data-story-requirement-id={requirementId || undefined}
            data-epic-key={normalizedEpicKey}
            data-team-id={teamId || undefined}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={accessibleName}
            analyticsMeta={buildJiraBrowseLinkAnalytics({
                issueKind: 'epic',
                sourceSurface,
            })}
        >
            <span className="story-requirement-primary">
                <StoryRequirementIcon level={entityNames.childLevel} InitiativeIcon={InitiativeIcon} />
                <span className="story-requirement-title-line">
                    <span className="story-requirement-title">{child} required</span>
                    <span className="story-requirement-instruction">
                        Create in Jira.
                    </span>
                </span>
            </span>
            <span className="story-requirement-meta">
                <span className="story-requirement-pill">Team: {normalizedTeamName}</span>
                <span className="story-requirement-pill">Target sprint: {normalizedSprintName}</span>
                <span className="story-requirement-urgency">{urgency}</span>
            </span>
        </TrackedExternalLink>
    );
}
