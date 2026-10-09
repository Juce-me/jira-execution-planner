import * as React from 'react';
import { STALE_LAZY_BUILD_CODE, isLazyLoadFailure } from './lazyViewLoaders.js';

// A lazy component outlives the boundary that created it. A view that resolved once renders synchronously when it is
// reopened; a new React.lazy around an already cached module still suspends and flashed the fallback on every open.
const lazyViews = new WeakMap();

function lazyViewFor(load, attempt) {
    const attempts = lazyViews.get(load) || new Map();
    lazyViews.set(load, attempts);
    if (!attempts.has(attempt)) {
        const View = React.lazy(() => load(attempt).then(module => {
            // The next fresh mount starts at attempt 0, so a successful retry serves it as well.
            attempts.set(0, View);
            return module;
        }, error => {
            attempts.delete(attempt);
            throw error;
        }));
        attempts.set(attempt, View);
    }
    return attempts.get(attempt);
}

class LazyViewErrorBoundary extends React.Component {
    state = { error: null };

    static getDerivedStateFromError(error) {
        return { error };
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        // Only chunk load failures are handled here. An exception thrown by the view itself is a bug and reaches the
        // app as it did before the views were lazy.
        if (!isLazyLoadFailure(error)) throw error;
        const canRetry = this.props.attempt === 0 && error.code !== STALE_LAZY_BUILD_CODE;
        return (
            <div className="stats-note" role="alert">
                {canRetry ? <><span>This view could not be loaded. </span><button type="button" className="secondary compact" onClick={this.props.onRetry}>Retry</button></>
                    : 'Reload the page to get the latest version'}
            </div>
        );
    }
}

export default function LazyViewBoundary({ load, fallback, children }) {
    const [attempt, setAttempt] = React.useState(0);
    const View = lazyViewFor(load, attempt);
    return (
        <LazyViewErrorBoundary key={attempt} attempt={attempt} onRetry={() => setAttempt(1)}>
            <React.Suspense fallback={fallback}>{children(View)}</React.Suspense>
        </LazyViewErrorBoundary>
    );
}
