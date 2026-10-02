// One-shot "skip the next department-wide dependency fetch" token for per-epic refresh.
// An entry is only honoured while its signature and the department load epoch both still match:
// a department load (global Refresh, scope or sprint change) bumps the epoch, so a stale entry
// armed for a discarded or never-applied epic refresh cannot swallow a legitimate fetch.
export function createDependencySkip() {
    let armed = null;
    return {
        arm(signature, epoch) {
            armed = { signature, epoch };
        },
        // Any consume attempt is one-shot: it returns true only for a matching signature and epoch,
        // and always leaves the skip disarmed, so a wrong prediction costs at most one normal fetch.
        consume(signature, epoch) {
            const entry = armed;
            armed = null;
            return Boolean(entry) && entry.signature === signature && entry.epoch === epoch;
        },
        disarm() {
            armed = null;
        },
        peek() {
            return armed ? { ...armed } : null;
        },
    };
}
