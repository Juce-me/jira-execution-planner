export const fetchIssuesLookup = (backendUrl, keys, { signal } = {}) =>
    fetch(`${backendUrl}/api/issues/lookup?keys=${encodeURIComponent((keys || []).join(','))}`, {
        signal
    });
