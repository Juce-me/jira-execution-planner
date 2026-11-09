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

// New (`rnd_2027`) model: the server stamps each Epic with `projectClassification` ('product'|'tech')
// from its Allocation (Board children carry it at the top level). The stamp decides before project
// keys, and Ad Hoc still wins over it. Its grouping parent is an Initiative, so Ad Hoc is keyed on
// the Initiative key that `epicKey`/`parentKey` carry.

function normalizeKey(value) {
    return String(value || '').trim().toUpperCase();
}

function projectStamp(issue) {
    const stamp = issue?.fields?.projectClassification ?? issue?.projectClassification;
    return stamp === 'product' || stamp === 'tech' ? stamp : null;
}

// Product/Tech side without Ad Hoc: the Allocation stamp when present, otherwise the project key.
export function isTechIssue(issue, techProjectKeys) {
    const stamp = projectStamp(issue);
    if (stamp) return stamp === 'tech';
    const techKeys = techProjectKeys instanceof Set ? techProjectKeys : new Set();
    const fields = issue?.fields || {};
    const rawProjectKey = fields.projectKey || issue?.projectKey
        || String(issue?.key || '').split('-')[0];
    const projectKey = normalizeKey(rawProjectKey);
    return Boolean(projectKey && techKeys.has(projectKey));
}

export function classifyCapacityIssue(issue, { techProjectKeys, adHocEpicSet } = {}) {
    const adHocKeys = adHocEpicSet instanceof Set ? adHocEpicSet : new Set();

    const fields = issue?.fields || {};
    // Story-level records carry their parent epic in `epicKey`/`parentKey`;
    // Epic-level cohort records carry their own key in `key`.
    const epicKey = normalizeKey(fields.epicKey || fields.parentKey || issue?.key);
    if (epicKey && adHocKeys.has(epicKey)) {
        return { projectType: 'product', capacityType: 'ad_hoc', productSubtype: 'ad_hoc' };
    }

    if (isTechIssue(issue, techProjectKeys)) {
        return { projectType: 'tech', capacityType: 'tech', productSubtype: null };
    }

    return { projectType: 'product', capacityType: 'product', productSubtype: 'standard' };
}
