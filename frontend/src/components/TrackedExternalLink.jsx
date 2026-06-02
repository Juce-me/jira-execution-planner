import * as React from 'react';
import { trackExternalLinkOpened } from '../analytics/analytics.js';

export default function TrackedExternalLink({
    analyticsMeta,
    onClick,
    children,
    ...props
}) {
    const handleClick = (event) => {
        if (analyticsMeta) {
            try {
                trackExternalLinkOpened(analyticsMeta);
            } catch (err) {
                console.warn('Analytics external link skipped:', err.message);
            }
        }
        if (onClick) {
            onClick(event);
        }
    };

    return (
        <a {...props} onClick={handleClick}>
            {children}
        </a>
    );
}
