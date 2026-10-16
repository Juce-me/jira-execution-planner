// Offline, copyable mapping handoff. This does not contact Google or mutate a container.
import { isolateAnalyticsPayload } from '../frontend/src/analytics/events.js';

const routing = new Set(['event', 'trigger', 'event_type', 'event_name', 'ga4_user_id', 'debug_mode']);
const payload = isolateAnalyticsPayload({
    event: 'userevent', trigger: 'userevent', event_type: 'event',
    event_name: 'settings_action', feature_name: 'settings'
});
console.log('GA4 parameter\tDLV value');
for (const name of Object.keys(payload).filter(name => !routing.has(name))) {
    console.log(`${name}\t{{DLV - ${name}}}`);
}
console.log('debug_mode\t{{DLV - debug_mode}}');
console.log('\nGoogle tag configuration only (never custom event parameters):');
console.log('send_page_view\tfalse');
console.log('user_id\t{{DLV - ga4_user_id}}');
console.log('Setup sequencing\tRun before both existing GA4 Event tags on every occurrence');
