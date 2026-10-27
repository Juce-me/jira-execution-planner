import { useEffect, useState } from 'react';

import { isAuthenticationRequiredError } from '../api/authRequired.js';
import { saveEpmPreferences } from '../api/epmApi.js';

// Owner-private "Enable EPM view" preference: a boolean draft over the saved value, saved through its
// own preferences POST body ({viewEnabled} only), never through token or EPM-config payloads.
export function useEpmViewPreference({ BACKEND_URL, savedViewEnabled, trackSettingsAction }) {
    const [saved, setSaved] = useState(savedViewEnabled === true);
    const [draft, setDraft] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        setSaved(savedViewEnabled === true);
    }, [savedViewEnabled]);

    const checked = draft === null ? saved : draft;
    const isDirty = draft !== null && draft !== saved;

    const setChecked = (value) => {
        setError('');
        setDraft(value === saved ? null : value === true);
    };

    const discard = () => {
        setError('');
        setDraft(null);
    };

    // Resolves { ok, error }; an authentication loss rethrows so the shared save keeps its auth path.
    const save = async () => {
        if (!isDirty) return { ok: true };
        setSaving(true);
        setError('');
        try {
            const payload = await saveEpmPreferences(BACKEND_URL, { viewEnabled: draft });
            setSaved(payload?.epmViewEnabled === true);
            setDraft(null);
            trackSettingsAction?.('epm', 'save_result', { result: 'success' });
            return { ok: true };
        } catch (err) {
            if (isAuthenticationRequiredError(err)) throw err;
            const message = err?.message || 'The EPM view preference could not be saved.';
            setError(message);
            trackSettingsAction?.('epm', 'save_result', { result: 'failure' });
            return { ok: false, error: message };
        } finally {
            setSaving(false);
        }
    };

    return { checked, discard, error, isDirty, save, savedEnabled: saved, saving, setChecked };
}
