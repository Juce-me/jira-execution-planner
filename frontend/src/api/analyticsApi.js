export async function fetchAnalyticsContext() {
    const response = await fetch('/api/analytics/context', {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'jira-execution-planner' }
    });
    if (!response.ok) {
        return { enabled: false };
    }
    return response.json();
}
