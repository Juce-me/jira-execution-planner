import * as React from 'react';
import { issueTypeIconUrl } from '../api/jiraCatalogApi.js';

// The Jira type glyph of a work row. A new-model role with a configured type (`typeId`) draws that type's own Jira icon,
// read through the same-origin `issueTypeIconUrl` route in the same svg box; if the image fails, or without
// `typeId`, the glyph is chosen by the hierarchy level of the role's configured type: 0 the bookmark, 1 the bolt, 2 or
// more the App's Initiative lightbulb (passed in, never redrawn here). The caller's wrapper owns the title and the box;
// without `InitiativeIcon` a level of 2 or more falls back to the bolt.
export default function WorkTypeGlyph({ level = 0, InitiativeIcon = null, typeId = null, size = 16 }) {
    const [failedTypeId, setFailedTypeId] = React.useState(null);
    if (typeId && failedTypeId !== typeId) {
        return (
            <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
                <image href={issueTypeIconUrl(typeId)} width="16" height="16" onError={() => setFailedTypeId(typeId)} />
            </svg>
        );
    }
    if (level >= 2 && InitiativeIcon) return <InitiativeIcon size={size} title={null} />;
    if (level >= 1) {
        return (
            <svg viewBox="0 0 16 16" fill="none">
                <path
                    clipRule="evenodd"
                    d="m10.271.050656c.2887.111871.479.38969.479.699344v4.63515l3.1471.62941c.2652.05303.4812.24469.5655.50161s.0238.53933-.1584.73914l-7.74997 8.49999c-.20863.2288-.53644.3059-.82517.194-.28874-.1118-.47905-.3896-.47905-.6993v-4.6351l-3.14708-.62947c-.26515-.05303-.48123-.24468-.56553-.5016-.08431-.25692-.02379-.53933.1584-.73915l7.75-8.499996c.20863-.2288201.53643-.305899.8252-.194028zm-6.57276 8.724134 3.05177.61036v3.92915l5.55179-6.08909-3.05179-.61036v-3.9291z"
                    fill="#bf63f3"
                    fillRule="evenodd"
                />
            </svg>
        );
    }
    return (
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 4h10a2 2 0 012 2v14l-7-4-7 4V6a2 2 0 012-2z" stroke="#55A630" strokeWidth="2" strokeLinejoin="round"/>
        </svg>
    );
}
