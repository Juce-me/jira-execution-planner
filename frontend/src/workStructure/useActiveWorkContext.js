import * as React from 'react';
import { getActiveWorkContext, subscribeActiveWorkContext } from './requestContext.js';

// The accepted work-configuration context as React state, for readers that cannot be handed it as a prop.
export function useActiveWorkContext() {
    const [context, setContext] = React.useState(getActiveWorkContext);
    React.useEffect(() => {
        setContext(getActiveWorkContext());
        return subscribeActiveWorkContext(() => setContext(getActiveWorkContext()));
    }, []);
    return context;
}
