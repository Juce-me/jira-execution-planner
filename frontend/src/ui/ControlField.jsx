import * as React from 'react';

export default function ControlField({ label, className = '', children, dataLabel = label }) {
    const classes = ['control-field', className].filter(Boolean).join(' ');

    return (
        <div className={classes} data-label={dataLabel}>
            {label && <span className="control-label">{label}</span>}
            {children}
        </div>
    );
}
