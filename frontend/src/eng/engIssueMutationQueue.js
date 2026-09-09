export const ENG_ISSUE_MUTATION_CONCURRENCY = 4;

// Bounds every ENG issue write across the document and atomically serializes jobs sharing any
// issue key. Four active jobs leave browser connection headroom for option/auth requests while
// still letting a user move through several issues without waiting for each Jira round trip.
export function createIssueMutationQueue({ maxConcurrency = ENG_ISSUE_MUTATION_CONCURRENCY } = {}) {
    const concurrency = Math.max(1, Math.floor(Number(maxConcurrency) || 1));
    const pending = [];
    const activeKeys = new Set();
    let activeCount = 0;

    const drain = () => {
        while (activeCount < concurrency) {
            const index = pending.findIndex(job => job.issueKeys.every(key => !activeKeys.has(key)));
            if (index < 0) return;

            const [job] = pending.splice(index, 1);
            job.removeAbortListener?.();
            if (job.signal?.aborted || (job.shouldStart && !job.shouldStart())) {
                job.reject(abortError());
                continue;
            }
            activeCount += 1;
            job.issueKeys.forEach(key => activeKeys.add(key));
            Promise.resolve()
                .then(() => {
                    if (job.signal?.aborted || (job.shouldStart && !job.shouldStart())) throw abortError();
                    return job.run();
                })
                .then(job.resolve, job.reject)
                .finally(() => {
                    activeCount -= 1;
                    job.issueKeys.forEach(key => activeKeys.delete(key));
                    drain();
                });
        }
    };

    const abortError = () => {
        const error = new Error('Issue mutation was canceled before dispatch.');
        error.name = 'AbortError';
        return error;
    };

    const enqueueMany = (issueKeys, run, { signal, shouldStart } = {}) => {
        const keys = Array.from(new Set((Array.isArray(issueKeys) ? issueKeys : [])
            .map(value => String(value || '').trim().toUpperCase())
            .filter(Boolean))).sort();
        if (!keys.length || typeof run !== 'function') {
            return Promise.reject(new Error('issue mutation requires issue keys and a runner'));
        }
        if (signal?.aborted || (shouldStart && !shouldStart())) return Promise.reject(abortError());
        return new Promise((resolve, reject) => {
            const job = { issueKeys: keys, run, resolve, reject, signal, shouldStart, removeAbortListener: null };
            if (signal) {
                const onAbort = () => {
                    const index = pending.indexOf(job);
                    if (index < 0) return;
                    pending.splice(index, 1);
                    job.removeAbortListener?.();
                    reject(abortError());
                    drain();
                };
                signal.addEventListener('abort', onAbort, { once: true });
                job.removeAbortListener = () => signal.removeEventListener('abort', onAbort);
            }
            pending.push(job);
            drain();
        });
    };

    return {
        enqueueMany,
        enqueue(issueKey, run, options) {
            return enqueueMany([issueKey], run, options);
        },
    };
}

const sharedIssueMutationQueue = createIssueMutationQueue();

export function enqueueEngIssueMutations(issueKeys, run, options) {
    return sharedIssueMutationQueue.enqueueMany(issueKeys, run, options);
}

export function enqueueEngIssueMutation(issueKey, run, options) {
    return sharedIssueMutationQueue.enqueue(issueKey, run, options);
}
