import * as React from 'react';

class LazyViewErrorBoundary extends React.Component {
    state = { error: null };

    static getDerivedStateFromError(error) {
        return { error };
    }

    render() {
        if (!this.state.error) return this.props.children;
        const canRetry = this.props.attempt === 0 && this.state.error?.code !== 'JEP_STALE_LAZY_BUILD';
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
    const View = React.useMemo(() => React.lazy(() => load(attempt)), [load, attempt]);
    return (
        <LazyViewErrorBoundary key={attempt} attempt={attempt} onRetry={() => setAttempt(1)}>
            <React.Suspense fallback={fallback}>{children(View)}</React.Suspense>
        </LazyViewErrorBoundary>
    );
}
