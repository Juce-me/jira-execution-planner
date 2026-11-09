// Shared Product/Tech capacity classification.
//
// Ad Hoc capacity (which includes business-as-usual work) is INCLUDED Product
// capacity that can additionally be reported as Ad Hoc. It is never subtracted
// from capacity and never hides stories — that remains the job of
// `excludedCapacityEpics`, handled by callers BEFORE classification.
//
// Legacy: membership in `adHocEpicSet` WINS over `techProjectKeys`: a story under a
// configured Ad Hoc epic counts as Product even when its project key is Tech.
//
// Return mapping (projectType / capacityType / productSubtype):
//   Ad Hoc          -> 'product' / 'ad_hoc'  / 'ad_hoc'
//   ordinary Product-> 'product' / 'product' / 'standard'
//   ordinary Tech   -> 'tech'    / 'tech'    / null
//   DELIVERY only: Ad Hoc on Tech/No Allocation -> 'tech'|'none' / 'ad_hoc' / null,
//                  No Allocation -> 'none' / 'none' / null

// New (`rnd_2027`, DELIVERY) model: the server stamps every issue with `projectClassification`
// ('product'|'tech'|'none') from its Initiative's Allocation (Board children carry it at the top level).
// The stamp decides before project keys; 'none' is No Allocation, never Product. Ad Hoc follows the
// stamp: it keeps capacityType 'ad_hoc' on the stamped side. Its grouping parent is an Initiative, so
// Ad Hoc is keyed on the Initiative key that `epicKey`/`parentKey` carry. Legacy (no stamp) is unchanged.

function normalizeKey(value) {
    return String(value || '').trim().toUpperCase();
}

function projectStamp(issue) {
    const stamp = issue?.fields?.projectClassification ?? issue?.projectClassification;
    return stamp === 'product' || stamp === 'tech' || stamp === 'none' ? stamp : null;
}

// Side without Ad Hoc: the Allocation stamp when present ('product'|'tech'|'none'), otherwise the
// project key ('product'|'tech'; Legacy is never 'none').
export function projectClassOf(issue, techProjectKeys) {
    const stamp = projectStamp(issue);
    if (stamp) return stamp;
    const techKeys = techProjectKeys instanceof Set ? techProjectKeys : new Set();
    const fields = issue?.fields || {};
    const rawProjectKey = fields.projectKey || issue?.projectKey
        || String(issue?.key || '').split('-')[0];
    const projectKey = normalizeKey(rawProjectKey);
    return projectKey && techKeys.has(projectKey) ? 'tech' : 'product';
}

export function isTechIssue(issue, techProjectKeys) {
    return projectClassOf(issue, techProjectKeys) === 'tech';
}

export function classifyCapacityIssue(issue, { techProjectKeys, adHocEpicSet } = {}) {
    const adHocKeys = adHocEpicSet instanceof Set ? adHocEpicSet : new Set();

    const fields = issue?.fields || {};
    // Story-level records carry their parent epic in `epicKey`/`parentKey`;
    // Epic-level cohort records carry their own key in `key`.
    const epicKey = normalizeKey(fields.epicKey || fields.parentKey || issue?.key);
    const stamp = projectStamp(issue);
    if (epicKey && adHocKeys.has(epicKey)) {
        if (stamp === 'tech' || stamp === 'none') return { projectType: stamp, capacityType: 'ad_hoc', productSubtype: null };
        return { projectType: 'product', capacityType: 'ad_hoc', productSubtype: 'ad_hoc' };
    }

    if (stamp === 'none') {
        return { projectType: 'none', capacityType: 'none', productSubtype: null };
    }

    if (isTechIssue(issue, techProjectKeys)) {
        return { projectType: 'tech', capacityType: 'tech', productSubtype: null };
    }

    return { projectType: 'product', capacityType: 'product', productSubtype: 'standard' };
}
