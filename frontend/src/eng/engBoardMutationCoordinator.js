export function createEngBoardMutationCoordinator() {
    let tail = Promise.resolve();
    let releaseActive = null;
    return {
        async enqueue(_issueKey, mutation) {
            let release;
            const completed = new Promise(resolve => { release = resolve; });
            const previous = tail;
            tail = previous.then(() => completed);
            await previous;
            releaseActive = release;
            return mutation();
        },
        complete() {
            const release = releaseActive;
            releaseActive = null;
            release?.();
        },
    };
}
