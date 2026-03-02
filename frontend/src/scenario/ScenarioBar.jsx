import * as React from 'react';
import { SCENARIO_BAR_HEIGHT } from './scenarioUtils.js';

function ScenarioBar({ issueKey, className, style, href, displaySummary, registerRef, onClick, onMouseEnter, onMouseMove, onMouseLeave, onFocus, onBlur }) {
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
            onMouseEnter={onMouseEnter}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
            onFocus={onFocus}
            onBlur={onBlur}
        >
            <div className="scenario-bar-inner">
                <div className="scenario-bar-summary">{displaySummary}</div>
            </div>
        </a>
    );
}

export default React.memo(ScenarioBar);
