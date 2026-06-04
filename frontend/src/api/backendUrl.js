const DEFAULT_BACKEND_PORT = 5050;

export function resolveBackendUrl(windowLike = window) {
    if (windowLike.BACKEND_URL) return windowLike.BACKEND_URL;
    const location = windowLike.location || {};
    const protocol = String(location.protocol || '');
    if (protocol === 'http:' || protocol === 'https:') {
        return location.origin;
    }
    return `http://localhost:${DEFAULT_BACKEND_PORT}`;
}
