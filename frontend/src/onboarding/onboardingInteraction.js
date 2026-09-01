function hasBooleanExpandedState(node) {
    const expanded = node?.getAttribute?.('aria-expanded');
    return expanded === 'true' || expanded === 'false';
}

function isNativelyDisabled(node) {
    if (node.disabled === true) return true;
    if (typeof node.matches !== 'function') return false;
    try {
        return node.matches(':disabled');
    } catch (_error) {
        return true;
    }
}

export function isExactMenuButtonTrigger(candidate, expectedTarget) {
    return Boolean(
        candidate
        && candidate === expectedTarget
        && candidate.isConnected === true
        && candidate.tagName === 'BUTTON'
        && !isNativelyDisabled(candidate)
        && candidate.getAttribute?.('aria-disabled') !== 'true'
        && candidate.getAttribute?.('aria-haspopup') === 'menu'
        && hasBooleanExpandedState(candidate)
    );
}

function childElements(node) {
    return Array.from(node?.children || []);
}

export function collectInteractionIsolationTargets({
    target,
    root,
    body,
    coachmark = null,
    shields = [],
    ownedPreviewPortal = null,
} = {}) {
    if (!target || !root || !body) return [];

    const fullPath = new Set();
    let pathNode = target;
    while (pathNode) {
        fullPath.add(pathNode);
        if (pathNode === body) break;
        pathNode = pathNode.parentElement;
    }
    if (!fullPath.has(root) || !fullPath.has(body)) return [];

    const exempt = new Set([coachmark, ...shields, ownedPreviewPortal].filter(Boolean));
    const result = [];
    const seen = new Set();
    const add = (node) => {
        if (!node || fullPath.has(node) || exempt.has(node) || seen.has(node)) return;
        seen.add(node);
        result.push(node);
    };

    pathNode = target;
    while (pathNode && pathNode !== root) {
        childElements(pathNode.parentElement).forEach((sibling) => {
            if (sibling !== pathNode) add(sibling);
        });
        pathNode = pathNode.parentElement;
    }
    childElements(body).forEach(add);
    return result;
}

function captureAttribute(node, name) {
    return {
        present: node.hasAttribute(name),
        value: node.getAttribute(name),
    };
}

function restoreAttribute(node, name, snapshot, beforeAttributeWrite) {
    const currentPresent = node.hasAttribute(name);
    const currentValue = node.getAttribute(name);
    if (currentPresent === snapshot.present && currentValue === snapshot.value) return;
    beforeAttributeWrite?.(node, name);
    if (snapshot.present) {
        node.setAttribute(name, snapshot.value);
    } else {
        node.removeAttribute(name);
    }
}

export function suppressForInteraction(node, beforeAttributeWrite) {
    const recordWrite = typeof beforeAttributeWrite === 'function' ? beforeAttributeWrite : null;
    const snapshot = {
        inertAttribute: captureAttribute(node, 'inert'),
        inertProperty: node.inert,
        ariaHidden: captureAttribute(node, 'aria-hidden'),
        ariaDescribedBy: captureAttribute(node, 'aria-describedby'),
    };
    const owned = {
        inertAttribute: !snapshot.inertAttribute.present,
        inertProperty: snapshot.inertProperty !== true,
        ariaHidden: snapshot.ariaHidden.value !== 'true',
    };

    if (owned.inertAttribute) {
        recordWrite?.(node, 'inert');
        node.setAttribute('inert', '');
    }
    if (owned.inertProperty && node.inert !== true) {
        recordWrite?.(node, 'inert');
        node.inert = true;
    }
    if (owned.ariaHidden) {
        recordWrite?.(node, 'aria-hidden');
        node.setAttribute('aria-hidden', 'true');
    }

    return { node, snapshot, owned };
}

export function restoreInteractionSuppression(record, beforeAttributeWrite) {
    if (!record?.node || !record.snapshot) return;
    const recordWrite = typeof beforeAttributeWrite === 'function' ? beforeAttributeWrite : null;
    const { node, snapshot } = record;
    if (node.inert !== snapshot.inertProperty) {
        recordWrite?.(node, 'inert');
        node.inert = snapshot.inertProperty;
    }
    restoreAttribute(node, 'inert', snapshot.inertAttribute, recordWrite);
    restoreAttribute(node, 'aria-hidden', snapshot.ariaHidden, recordWrite);
    restoreAttribute(node, 'aria-describedby', snapshot.ariaDescribedBy);
}

function descriptionTokens(value) {
    return String(value || '').trim().split(/\s+/).filter(Boolean);
}

export function appendAriaDescribedByToken(value, token) {
    const tokens = descriptionTokens(value);
    if (token && !tokens.includes(token)) tokens.push(token);
    return tokens.join(' ');
}

export function removeAriaDescribedByToken(value, token) {
    return descriptionTokens(value).filter((entry) => entry !== token).join(' ');
}
