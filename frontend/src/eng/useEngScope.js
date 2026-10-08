import * as React from 'react';

export function useEngScope({
    activeGroupId, selectedSprint, selectedSprintInfo, isAllTeamsSelected, selectedTeamSet, teamNameById, teamOptions, capacityTasks, techProjectKeys, excludedEpicSet, adHocEpicSet, adHocEpicSignature
}) {
    return React.useMemo(() => ({
        activeGroupId, selectedSprint, selectedSprintInfo, isAllTeamsSelected, selectedTeamSet, teamNameById, teamOptions, capacityTasks, techProjectKeys, excludedEpicSet, adHocEpicSet, adHocEpicSignature
    }), [activeGroupId, selectedSprint, selectedSprintInfo, isAllTeamsSelected, selectedTeamSet, teamNameById, teamOptions, capacityTasks, techProjectKeys, excludedEpicSet, adHocEpicSet, adHocEpicSignature]);
}
