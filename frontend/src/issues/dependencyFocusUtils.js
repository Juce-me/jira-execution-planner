export function buildDependencyKeySignature(tasks) {
    const keys = Array.from(new Set((tasks || []).map(task => task.key).filter(Boolean)));
    return keys.sort().join('|');
}

export function buildIssueByKey(tasks) {
    const map = new Map();
    (tasks || []).forEach(task => {
        if (task.key) {
            map.set(task.key, task);
        }
    });
    return map;
}

export function getBlockOtherKey(dep, taskKey) {
    if (!dep?.key || !taskKey) return '';
    return dep.key !== taskKey
        ? dep.key
        : (dep.prereqKey === taskKey ? dep.dependentKey : dep.prereqKey);
}

export function buildBlockLinkBuckets(entries, taskKey) {
    const blockedBy = [];
    const blocks = [];
    (entries || []).forEach(dep => {
        const otherKey = getBlockOtherKey(dep, taskKey);
        if (!otherKey) return;
        if (dep.dependentKey === taskKey) {
            blockedBy.push(otherKey);
            return;
        }
        if (dep.prereqKey === taskKey) {
            blocks.push(otherKey);
            return;
        }
        if (dep.direction === 'inward') {
            blockedBy.push(otherKey);
            return;
        }
        if (dep.direction === 'outward') {
            blocks.push(otherKey);
        }
    });
    return {
        blockedBy: Array.from(new Set(blockedBy)),
        blocks: Array.from(new Set(blocks))
    };
}

export function uniqueDependencyEntries(entries) {
    const seen = new Set();
    return (entries || []).filter(dep => {
        const key = `${dep.key}-${dep.direction}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function buildDependencyKeys(dependencyData, taskKey, action) {
    if (!taskKey) return [];
    const entries = ((dependencyData || {})[taskKey] || [])
        .filter(dep => dep.key && dep.category === 'dependency');
    const direction = action === 'dependents' ? 'inward' : 'outward';
    return uniqueDependencyEntries(entries)
        .filter(dep => dep.direction === direction)
        .map(dep => dep.key)
        .filter(Boolean);
}

export function buildBlockKeys(dependencyData, taskKey, action) {
    if (!taskKey) return [];
    const entries = ((dependencyData || {})[taskKey] || [])
        .filter(dep => dep.key && dep.category === 'block');
    const { blockedBy, blocks } = buildBlockLinkBuckets(entries, taskKey);
    return action === 'blocks' ? blocks : blockedBy;
}

export function buildFocusKeys(dependencyData, taskKey, action) {
    if (action === 'blocked-by' || action === 'blocks') {
        return buildBlockKeys(dependencyData, taskKey, action);
    }
    return buildDependencyKeys(dependencyData, taskKey, action);
}

export function buildDependencyFocusPayload({
    taskKey,
    action,
    dependencyData,
    issueByKey
}) {
    if (!taskKey || !action) return null;
    const dependencyKeys = buildFocusKeys(dependencyData, taskKey, action);
    const relatedKeys = Array.from(new Set([taskKey, ...dependencyKeys]));
    const missingKeys = dependencyKeys.filter(key => !issueByKey.has(key));
    return {
        taskKey,
        action,
        relatedKeys,
        dependencyKeys,
        missingKeys
    };
}
