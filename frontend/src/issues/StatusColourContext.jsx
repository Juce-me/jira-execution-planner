import React from 'react';
import { buildStatusStyle, resolveStatusColumnColour } from './statusColumnColours.js';

const noStatusStyle = () => undefined;
const StatusColourContext = React.createContext(noStatusStyle);

export function StatusColourProvider({ columns, enabled, children }) {
    const value = React.useMemo(() => (
        enabled
            ? (status) => buildStatusStyle(resolveStatusColumnColour(columns, status))
            : noStatusStyle
    ), [columns, enabled]);
    return <StatusColourContext.Provider value={value}>{children}</StatusColourContext.Provider>;
}

export function useStatusColourStyle() {
    return React.useContext(StatusColourContext);
}
