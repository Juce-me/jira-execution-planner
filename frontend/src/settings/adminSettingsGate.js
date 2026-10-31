import * as React from 'react';

// The config bootstrap reports administrator settings that block ENG loading (DB/OAuth only).
const GATED_ADMIN_SETTINGS_TABS = ['scope', 'source'];

export const ADMIN_SETTINGS_GATE_PENDING = Object.freeze({ status: 'pending', missing: [], contacts: [] });

export function resolveAdminSettingsGate(config) {
    // After promotion setup is per configuration (`adminSettingsMissingByConfiguration`) and is never
    // an auto-open or ENG-blocking gate; the flat `adminSettingsMissing` list describes the old model.
    const promoted = config?.workConfigurationsPromoted === true;
    const reported = !promoted && Array.isArray(config?.adminSettingsMissing) ? config.adminSettingsMissing : [];
    const missing = GATED_ADMIN_SETTINGS_TABS.filter(tab => reported.includes(tab));
    const contacts = Array.isArray(config?.adminContacts)
        ? config.adminContacts.filter(name => typeof name === 'string' && name.trim())
        : [];
    return { status: missing.length ? 'missing' : 'clear', missing, contacts };
}

export function firstMissingAdminSettingsTab(missing) {
    return GATED_ADMIN_SETTINGS_TABS.find(tab => (missing || []).includes(tab)) || GATED_ADMIN_SETTINGS_TABS[0];
}

// Holds the gate and opens Admin settings once per unconfigured episode for editors.
export function useAdminSettingsGate({ canEditSettings, openSettings }) {
    const [gate, setGate] = React.useState(ADMIN_SETTINGS_GATE_PENDING);
    const autoOpenedRef = React.useRef(false);
    React.useEffect(() => {
        if (gate.status !== 'missing') {
            autoOpenedRef.current = false;
            return;
        }
        if (!canEditSettings || autoOpenedRef.current) return;
        autoOpenedRef.current = true;
        openSettings(firstMissingAdminSettingsTab(gate.missing));
    }, [gate.status, canEditSettings]);
    const applyConfig = React.useCallback((config) => {
        const next = resolveAdminSettingsGate(config);
        setGate(next);
        return next;
    }, []);
    return [gate, applyConfig, setGate];
}

// Per-configuration missing setup after promotion, for display only (never a gate).
export function resolveMissingByConfiguration(config) {
    const raw = config?.adminSettingsMissingByConfiguration;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw)
        .filter(([, list]) => Array.isArray(list))
        .map(([id, list]) => [id, list.filter(item => typeof item === 'string')]));
}
