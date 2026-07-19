import React, { useRef } from 'react';
import IssueFieldOptionMenu from './IssueFieldOptionMenu.jsx';
import { getProjectTrackEmoji, getProjectTrackLabel } from '../eng/engTaskUtils.js';
import { filterProjectTrackOptions } from '../eng/engProjectTrackTransitionUtils.js';

// Shared ENG Project Track change control used by Catch Up / Planning Epic headers.
// Presentational: all catalog/loading/submit state and handlers arrive as props from
// useEngProjectTrackTransitions, so this file never imports the project track API or hook.
export default function ProjectTrackTransitionMenu({
    epicKey, currentTrack = '', isOpen = false, options = null,
    optionsLoading = false, submitting = false, error = '', result = null,
    onOpen, onClose, onSubmit,
}) {
    const fieldRef = useRef(null);
    const stateLabel = getProjectTrackLabel(currentTrack);
    const visibleOptions = filterProjectTrackOptions(options && options.options, currentTrack);
    return (
        <span className="project-track-transition" ref={fieldRef}>
            <button
                type="button"
                className="epic-track-indicator"
                data-project-track-transition-trigger="true"
                data-issue-key={epicKey}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-label={`Project Track: ${stateLabel}. Change Project Track`}
                title={`Project Track: ${stateLabel}. Change Project Track`}
                disabled={submitting && !isOpen}
                onClick={() => (isOpen ? onClose?.() : onOpen?.(epicKey, currentTrack))}
            >
                {getProjectTrackEmoji(currentTrack)}
            </button>
            {isOpen && (
                <IssueFieldOptionMenu
                    blockClass="project-track-transition"
                    issueKey={epicKey}
                    menuLabel="Change Project Track"
                    loading={optionsLoading}
                    loadingLabel="Loading Project Track options..."
                    error={error}
                    showEmpty={!optionsLoading && !error && visibleOptions.length === 0}
                    emptyLabel="No other Project Track available."
                    options={visibleOptions}
                    optionKey={option => option.value}
                    optionLabel={option => option.value}
                    renderMarker={option => (
                        <span className="project-track-option-marker" aria-hidden="true">
                            {getProjectTrackEmoji(option.value)}
                        </span>
                    )}
                    onSelect={option => onSubmit?.(option.value, epicKey)}
                    disabled={submitting}
                    result={result === 'success' ? 'Updated Project Track.' : ''}
                    onEscape={() => onClose?.()}
                    dismissRef={fieldRef}
                />
            )}
        </span>
    );
}
