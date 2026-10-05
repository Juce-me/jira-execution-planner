import * as React from 'react';

import { createSettingsDraftReadGuard } from './settingsConfigReadState.js';
import {
    fetchPriorityWeightsConfig as requestPriorityWeightsConfig,
    savePriorityWeightsConfig as requestSavePriorityWeightsConfig,
} from '../api/configApi.js';
import { DEFAULT_PRIORITY_WEIGHT_ROWS, clonePriorityWeightRows } from '../stats/priorityWeights.js';

export function usePriorityWeightsSettings({
    BACKEND_URL,
    acceptSettingsConfigBaseline,
    clearServerConnectionError,
    commitSharedConfigRevision,
    reportServerConnectionError,
    settingsConfigBaselineRevision,
    settingsDraftSnapshotRef,
    sharedConfigRevisionRef,
}) {
    const [priorityWeightsDraft, setPriorityWeightsDraft] = React.useState(() => clonePriorityWeightRows(DEFAULT_PRIORITY_WEIGHT_ROWS));
    const [priorityWeightsSource, setPriorityWeightsSource] = React.useState('default');
    const [effectivePriorityWeightsRows, setEffectivePriorityWeightsRows] = React.useState(() => clonePriorityWeightRows(DEFAULT_PRIORITY_WEIGHT_ROWS));
    const priorityWeightsBaselineRef = React.useRef(JSON.stringify(clonePriorityWeightRows(DEFAULT_PRIORITY_WEIGHT_ROWS)));
    const draftSnapshot = JSON.stringify(priorityWeightsDraft);

    const isPriorityWeightsDirty = React.useMemo(() => {
        return JSON.stringify(priorityWeightsDraft) !== priorityWeightsBaselineRef.current;
    }, [priorityWeightsDraft, settingsConfigBaselineRevision]);

    const priorityWeightsValidationError = React.useMemo(() => {
        for (const row of (priorityWeightsDraft || [])) {
            const label = String(row?.priority || '').trim() || 'Priority';
            const numeric = Number(row?.weight);
            if (Number.isNaN(numeric) || !Number.isFinite(numeric)) {
                return `Priority weight must be numeric for ${label}.`;
            }
            if (numeric < 0) {
                return `Priority weight must be non-negative for ${label}.`;
            }
        }
        return '';
    }, [priorityWeightsDraft]);
    const priorityWeightsSum = React.useMemo(() => {
        return (priorityWeightsDraft || []).reduce((acc, row) => {
            const numeric = Number(row?.weight);
            if (Number.isNaN(numeric) || !Number.isFinite(numeric)) return acc;
            return acc + numeric;
        }, 0);
    }, [priorityWeightsDraft]);

    const loadPriorityWeightsConfig = async ({ shouldApplyDraft = () => true } = {}) => {
        const preserveDraft = isPriorityWeightsDirty;
        const draftReadGuard = createSettingsDraftReadGuard(() => settingsDraftSnapshotRef.current);
        try {
            const response = await requestPriorityWeightsConfig(BACKEND_URL);
            if (!response.ok) return;
            const data = await response.json();
            const rows = clonePriorityWeightRows(data.weights);
            clearServerConnectionError();
            if (!preserveDraft && !draftReadGuard.draftChanged('priorityWeights') && shouldApplyDraft()) {
                setPriorityWeightsDraft(rows);
            }
            setEffectivePriorityWeightsRows(rows);
            setPriorityWeightsSource(String(data.source || 'default'));
            acceptSettingsConfigBaseline(priorityWeightsBaselineRef, JSON.stringify(rows));
        } catch (err) {
            if (!reportServerConnectionError(err)) {
                console.error('Failed to load priority weights config:', err);
            }
        }
    };

    const savePriorityWeightsConfig = async () => {
        const data = await requestSavePriorityWeightsConfig(BACKEND_URL, (priorityWeightsDraft || []).map((row) => ({
            priority: String(row.priority || '').trim(),
            weight: Number(row.weight)
        })), sharedConfigRevisionRef.current);
        commitSharedConfigRevision(data);
        const rows = clonePriorityWeightRows(data.weights);
        setPriorityWeightsDraft(rows);
        setEffectivePriorityWeightsRows(rows);
        setPriorityWeightsSource(String(data.source || 'config'));
        acceptSettingsConfigBaseline(priorityWeightsBaselineRef, JSON.stringify(rows));
    };

    const updatePriorityWeightDraft = (priorityName, nextValue) => {
        setPriorityWeightsDraft((prev) => (prev || []).map((row) => (
            row.priority === priorityName ? { ...row, weight: nextValue } : row
        )));
    };

    const resetPriorityWeightsDraft = () => {
        setPriorityWeightsDraft(clonePriorityWeightRows(DEFAULT_PRIORITY_WEIGHT_ROWS));
    };

    const applyLoaded = (sharedConfig, shouldPreserveSettingsDraft) => {
        const weightRows = clonePriorityWeightRows(sharedConfig.statsPriorityWeights);
        if (!shouldPreserveSettingsDraft('priorityWeights')) setPriorityWeightsDraft(weightRows);
        setEffectivePriorityWeightsRows(weightRows);
        setPriorityWeightsSource(sharedConfig.statsPriorityWeights ? 'config' : 'default');
        acceptSettingsConfigBaseline(priorityWeightsBaselineRef, JSON.stringify(weightRows));
    };

    return {
        priorityWeightsDraft,
        setPriorityWeightsDraft,
        priorityWeightsSource,
        effectivePriorityWeightsRows,
        isPriorityWeightsDirty,
        priorityWeightsValidationError,
        priorityWeightsSum,
        loadPriorityWeightsConfig,
        savePriorityWeightsConfig,
        updatePriorityWeightDraft,
        resetPriorityWeightsDraft,
        applyLoaded,
        draftSnapshot,
    };
}
