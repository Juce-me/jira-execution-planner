import * as React from 'react';
import { SCENARIO_BAR_HEIGHT } from './scenarioUtils.js';

function ScenarioBar({ issueKey, className, style, href, displaySummary, dateSource, registerRef, onClick, onMouseDown, onMouseEnter, onMouseMove, onMouseLeave, onFocus, onBlur }) {
    return (
        <a
            key={issueKey}
            className={className}
            style={style}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            ref={registerRef}
            onClick={onClick}
            onMouseDown={onMouseDown}
            onMouseEnter={onMouseEnter}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
            onFocus={onFocus}
            onBlur={onBlur}
        >
            <div className="scenario-bar-inner">
                <div className="scenario-bar-summary">{displaySummary}</div>
                {dateSource && dateSource !== 'computed' && (
                    <span className={`scenario-date-badge scenario-date-badge-${dateSource}`}>
                        {dateSource}
                    </span>
                )}
            </div>
        </a>
    );
}

export default React.memo(ScenarioBar);
