import * as React from 'react';
import { resolveEntityNames } from './engWorkModel.js';

// EntityNames for the viewed configuration: the active summary's captured `roleTypes`, refreshed by the names a full
// Catch Up read observed (`observed = {digest, planning, parent}`). Memoized on values, so an equal observation
// rebuilt each render keeps the same object.
export function useWorkEntityNames({ workModel, activeSummary, observed }) {
    const digest = activeSummary?.digest ?? null;
    const roleTypes = activeSummary?.roleTypes ?? null;
    const observedDigest = observed?.digest ?? null;
    const observedPlanning = observed?.planning ?? null;
    const observedParent = observed?.parent ?? null;
    return React.useMemo(
        () => resolveEntityNames(workModel, roleTypes, { digest: observedDigest, planning: observedPlanning, parent: observedParent }, digest),
        [workModel, roleTypes, digest, observedDigest, observedPlanning, observedParent],
    );
}
