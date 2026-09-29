import * as React from 'react';

export function createSettingsDraftReadGuard(readCurrentSnapshot) {
    const requestSnapshot = { ...(readCurrentSnapshot() || {}) };
    const draftChanged = section => (readCurrentSnapshot() || {})[section] !== requestSnapshot[section];
    return {
        draftChanged,
        fieldReadOptions(section, { preserveDraft = false } = {}) {
            return {
                requestDraft: requestSnapshot[section],
                preserveDraft: preserveDraft || draftChanged(section),
            };
        },
    };
}

export function acceptSettingsConfigBaseline(baselineRef, nextBaseline, onBaselineChanged = () => {}) {
    const changed = baselineRef.current !== nextBaseline;
    baselineRef.current = nextBaseline;
    if (changed) onBaselineChanged();
    return changed;
}

export function useSettingsConfigBaselineRevision() {
    const [baselineRevision, setBaselineRevision] = React.useState(0);
    const acceptBaseline = React.useCallback(
        (baselineRef, nextBaseline) => acceptSettingsConfigBaseline(
            baselineRef,
            nextBaseline,
            () => setBaselineRevision(revision => revision + 1),
        ),
        [],
    );
    return { baselineRevision, acceptBaseline };
}
