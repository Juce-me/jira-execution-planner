import * as React from 'react';

export default function SettingsModal(props) {
    const {
        title = 'Dashboard Settings',
        subtitle = 'Configure data sources and field mapping so planning metrics are calculated correctly.',
        activeTab,
        tabs = [],
        isDirty = false,
        unsavedSectionsCount = 0,
        onRequestClose,
        validationMessages = [],
        showTestConfiguration = false,
        onTestConfiguration,
        testConfigurationDisabled = false,
        testConfigurationLabel = 'Test configuration',
        testConfigurationMessage = '',
        onCancel,
        onSave,
        saveDisabled = false,
        saveTitle = '',
        saveLabel = 'Save',
        showDiscardConfirm = false,
        onDiscard,
        onKeepEditing,
        children
    } = props;

    const handleCancel = onCancel || onRequestClose;

    return (
        <div
            className="group-modal-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={onRequestClose}
        >
            <div className="group-modal" onClick={(event) => event.stopPropagation()}>
                <div className="group-modal-header">
                    <div className="group-modal-title-wrap">
                        <div>
                            <div className="group-modal-title">{title}</div>
                            <div className="group-modal-subtitle">{subtitle}</div>
                        </div>
                    </div>
                    {isDirty && (
                        <div className="group-modal-dirty">Unsaved changes{unsavedSectionsCount > 0 ? ` \u00b7 ${unsavedSectionsCount}` : ''}</div>
                    )}
                </div>
                <div className="group-modal-tabs">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            className={`group-modal-tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={tab.onClick}
                            type="button"
                            disabled={tab.disabled}
                            title={tab.title || ''}
                        >{tab.label}</button>
                    ))}
                </div>
                {children}
                {validationMessages.length > 0 && (
                    <div className="group-modal-validation" role="alert" aria-live="polite">
                        {validationMessages.map((message) => (
                            <div key={message}>&bull; {message}</div>
                        ))}
                    </div>
                )}
                <div className="group-modal-footer">
                    {showTestConfiguration && (
                        <div className="group-modal-button-row">
                            <button
                                className="secondary compact"
                                onClick={onTestConfiguration}
                                disabled={testConfigurationDisabled}
                                type="button"
                            >
                                {testConfigurationLabel}
                            </button>
                            {testConfigurationMessage && (
                                <span className="group-modal-meta" aria-live="polite">{testConfigurationMessage}</span>
                            )}
                        </div>
                    )}
                    <div className="group-modal-button-row">
                        <button className="secondary compact lift-hover" onClick={handleCancel} type="button">
                            Cancel
                        </button>
                    </div>
                    <div className="group-modal-button-row">
                        <button
                            className="compact"
                            onClick={onSave}
                            disabled={saveDisabled}
                            title={saveTitle}
                            type="button"
                        >
                            {saveLabel}
                        </button>
                    </div>
                </div>
                {showDiscardConfirm && (
                    <div className="group-confirm-backdrop" role="dialog" aria-modal="true" onClick={onKeepEditing}>
                        <div className="group-confirm" onClick={(event) => event.stopPropagation()}>
                            <div className="group-confirm-title">Discard changes?</div>
                            <div className="group-confirm-actions">
                                <button className="secondary compact danger lift-hover" onClick={onDiscard} type="button">
                                    Discard
                                </button>
                                <button className="compact" onClick={onKeepEditing} type="button">
                                    Keep editing
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
