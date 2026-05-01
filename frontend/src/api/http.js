export async function json(response, label) {
    if (!response.ok) {
        throw new Error(`${label} error ${response.status}`);
    }
    return response.json();
}

export function getJson(url, label, options = {}) {
    return fetch(url, options).then(response => json(response, label));
}

export function postJson(url, body, label, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    return fetch(url, {
        ...options,
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    }).then(response => json(response, label));
}
