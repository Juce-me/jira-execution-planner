// User-safe copy for the work-configuration rejections an own-key Jira write or review call can return.
// None of these has touched Jira: the server compares the stamp before any Jira read or write.

export const WORK_WRITE_ERROR_MESSAGES = Object.freeze({
    configuration_scope_changed: 'The work configuration changed. Your change is kept but was not saved. Review it and try again.',
    issue_not_parent: 'Only the parent work item can be changed here. Nothing was changed in Jira.',
    review_quarter_unresolved: 'This quarter cannot be placed in order yet, so the layout cannot be saved. Your edits are kept.',
    configuration_required: 'Choose a quarter with a work configuration, then try again.',
    configuration_incomplete: 'This quarter\'s work configuration is incomplete. Finish it in Settings, then try again.',
    configuration_feature_disabled: 'Quarterly work configurations are not enabled.',
    invalid_configuration_id: 'The work configuration could not be identified. Reload and try again.',
    work_configuration_setup_required: 'Quarterly work configurations are not set up yet.',
});

export const workWriteErrorMessage = code => WORK_WRITE_ERROR_MESSAGES[code] || null;
export const isWorkWriteErrorCode = code => Object.prototype.hasOwnProperty.call(WORK_WRITE_ERROR_MESSAGES, code);
