export const ENG_ISSUE_MUTATION_CONCURRENCY = 4;

// Bounds Catch Up status/priority writes across the whole app and serializes writes for the
// same issue. Four active jobs leave browser connection headroom for option/auth requests while
// still letting a user move through several tasks without waiting for each Jira round trip.
export function createIssueMutationQueue({ maxConcurrency = ENG_ISSUE_MUTATION_CONCURRENCY } = {}) {
    const concurrency = Math.max(1, Math.floor(Number(maxConcurrency) || 1));
    const pending = [];
    const activeKeys = new Set();
    let activeCount = 0;

    const drain = () => {
        while (activeCount < concurrency) {
            const index = pending.findIndex(job => !activeKeys.has(job.issueKey));
            if (index < 0) return;

            const [job] = pending.splice(index, 1);
            activeCount += 1;
            activeKeys.add(job.issueKey);
            Promise.resolve()
                .then(job.run)
                .then(job.resolve, job.reject)
                .finally(() => {
                    activeCount -= 1;
                    activeKeys.delete(job.issueKey);
                    drain();
                });
        }
    };

    return {
        enqueue(issueKey, run) {
            const key = String(issueKey || '').trim().toUpperCase();
            if (!key || typeof run !== 'function') {
                return Promise.reject(new Error('issue mutation requires an issue key and runner'));
            }
            return new Promise((resolve, reject) => {
                pending.push({ issueKey: key, run, resolve, reject });
                drain();
            });
        },
    };
}

const sharedIssueMutationQueue = createIssueMutationQueue();

export function enqueueEngIssueMutation(issueKey, run) {
    return sharedIssueMutationQueue.enqueue(issueKey, run);
}

