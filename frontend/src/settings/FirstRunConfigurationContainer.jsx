import * as React from 'react';

import FirstRunGroupSelectionModal from './FirstRunGroupSelectionModal.jsx';
import FirstRunGroupSetupChoice from './FirstRunGroupSetupChoice.jsx';

export default function FirstRunConfigurationContainer({
    closeFirstRunSetupChoice,
    configureFirstRunGroup,
    continueFirstRunSetupChoice,
    firstRunError,
    firstRunFavoriteGroupId,
    firstRunSaving,
    firstRunSetupChoice,
    groupPreferences,
    groupsConfig,
    openFirstRunSetupChoice,
    saveFirstRunGroupPreferences,
    selectFirstRunFavoriteGroup,
    setFirstRunSetupChoice,
}) {
    return (
        <>
            <FirstRunGroupSelectionModal
                groups={groupsConfig.groups || []}
                selectedGroupId={firstRunFavoriteGroupId}
                onSelectGroup={selectFirstRunFavoriteGroup}
                onContinue={saveFirstRunGroupPreferences}
                onAddDepartment={openFirstRunSetupChoice}
                onConfigureGroup={configureFirstRunGroup}
                saving={firstRunSaving}
                error={firstRunError}
                onboardingDone={groupPreferences.onboardingDone}
                setupChoiceOpen={Boolean(firstRunSetupChoice)}
            />
            {firstRunSetupChoice && (
                <FirstRunGroupSetupChoice
                    groups={groupsConfig.groups || []}
                    value={firstRunSetupChoice}
                    onChange={setFirstRunSetupChoice}
                    onBack={closeFirstRunSetupChoice}
                    onContinue={continueFirstRunSetupChoice}
                />
            )}
        </>
    );
}
