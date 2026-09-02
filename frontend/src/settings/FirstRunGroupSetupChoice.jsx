import * as React from 'react';

const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled])';

export default function FirstRunGroupSetupChoice({ groups = [], value, onChange, onBack, onContinue }) {
    const modalRef = React.useRef(null);
    const validationRef = React.useRef(null);
    const [validation, setValidation] = React.useState('');
    const hasSources = groups.some(group => String(group?.id || '').trim());
    const duplicateNeedsSource = value.mode === 'duplicate' && !value.sourceGroupId;

    React.useEffect(() => {
        const checked = modalRef.current?.querySelector('input[type="radio"]:checked');
        (checked || modalRef.current?.querySelector(focusableSelector))?.focus();
    }, []);
    React.useEffect(() => {
        if (validation) validationRef.current?.focus();
    }, [validation]);
    React.useEffect(() => {
        const handleDocumentKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            onBack();
        };
        document.addEventListener('keydown', handleDocumentKeyDown);
        return () => document.removeEventListener('keydown', handleDocumentKeyDown);
    }, [onBack]);

    const update = (changes) => {
        setValidation('');
        onChange({ ...value, ...changes });
    };
    const submit = () => {
        if (duplicateNeedsSource) {
            setValidation('Choose a Department to duplicate.');
            return;
        }
        onContinue();
    };
    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onBack();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...(modalRef.current?.querySelectorAll(focusableSelector) || [])];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    return (
        <div className="department-first-run-backdrop department-first-run-choice-backdrop" role="dialog" aria-modal="true" aria-labelledby="first-run-add-department-title" onKeyDown={handleKeyDown} ref={modalRef}>
            <div className="department-first-run-modal department-first-run-choice">
                <div className="department-first-run-heading">
                    <div id="first-run-add-department-title" className="department-first-run-title">Add a Department</div>
                    <div className="department-first-run-subtitle">Choose how to prepare the Department before opening Team Groups.</div>
                </div>
                <label className="department-first-run-choice-option">
                    <input type="radio" name="first-run-setup-mode" checked={value.mode === 'create'} onChange={() => update({ mode: 'create', sourceGroupId: null })} />
                    <span>Create clean Department</span>
                </label>
                <label className="department-first-run-choice-option">
                    <input type="radio" name="first-run-setup-mode" checked={value.mode === 'duplicate'} disabled={!hasSources} onChange={() => update({ mode: 'duplicate' })} />
                    <span>Duplicate existing Department</span>
                </label>
                {!hasSources && <div className="department-first-run-choice-help">No existing Departments are available to duplicate.</div>}
                {value.mode === 'duplicate' && hasSources && (
                    <div className="department-first-run-choice-details">
                        <label>
                            <span>Department to duplicate</span>
                            <select aria-label="Department to duplicate" value={value.sourceGroupId || ''} onChange={(event) => update({ sourceGroupId: event.target.value || null })}>
                                <option value="">Choose a Department</option>
                                {groups.map(group => <option key={group.id} value={group.id}>{group.name || group.id}</option>)}
                            </select>
                        </label>
                        <label><input type="checkbox" checked={value.removeTeams} onChange={(event) => update({ removeTeams: event.target.checked })} /> Remove existing teams</label>
                        <label><input type="checkbox" checked={value.removeComponents} onChange={(event) => update({ removeComponents: event.target.checked })} /> Remove existing components</label>
                    </div>
                )}
                {validation && <div className="group-modal-warning" role="alert" tabIndex={-1} ref={validationRef}>{validation}</div>}
                <div className="department-first-run-actions">
                    <button className="secondary compact" type="button" onClick={onBack}>Back</button>
                    <button className="compact" type="button" onClick={submit}>Continue to Team Groups</button>
                </div>
            </div>
        </div>
    );
}
