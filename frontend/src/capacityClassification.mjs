// Shared Product/Tech capacity classification.
//
// Ad Hoc capacity (which includes business-as-usual work) is INCLUDED Product
// capacity that can additionally be reported as Ad Hoc. It is never subtracted
// from capacity and never hides stories — that remains the job of
// `excludedCapacityEpics`, handled by callers BEFORE classification.
//
// Membership in `adHocEpicSet` WINS over `techProjectKeys`: a story under a
// configured Ad Hoc epic counts as Product even when its project key is Tech.
//
// Return mapping (projectType / capacityType / productSubtype):
//   Ad Hoc          -> 'product' / 'ad_hoc'  / 'ad_hoc'
//   ordinary Product-> 'product' / 'product' / 'standard'
//   ordinary Tech   -> 'tech'    / 'tech'    / null

function normalizeKey(value) {
    return String(value || '').trim().toUpperCase();
}

export function classifyCapacityIssue(issue, { techProjectKeys, adHocEpicSet } = {}) {
    const techKeys = techProjectKeys instanceof Set ? techProjectKeys : new Set();
    const adHocKeys = adHocEpicSet instanceof Set ? adHocEpicSet : new Set();

    const fields = issue?.fields || {};
    // Story-level records carry their parent epic in `epicKey`/`parentKey`;
    // Epic-level cohort records carry their own key in `key`.
    const epicKey = normalizeKey(fields.epicKey || fields.parentKey || issue?.key);
    if (epicKey && adHocKeys.has(epicKey)) {
        return { projectType: 'product', capacityType: 'ad_hoc', productSubtype: 'ad_hoc' };
    }

    const rawProjectKey = fields.projectKey || issue?.projectKey
        || String(issue?.key || '').split('-')[0];
    const projectKey = normalizeKey(rawProjectKey);
    if (projectKey && techKeys.has(projectKey)) {
        return { projectType: 'tech', capacityType: 'tech', productSubtype: null };
    }

    return { projectType: 'product', capacityType: 'product', productSubtype: 'standard' };
}
