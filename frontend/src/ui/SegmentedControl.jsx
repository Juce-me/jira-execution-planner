import * as React from 'react';

export default function SegmentedControl({ className = '', ariaLabel, options, value, onChange }) {
    const classes = ['segmented-control', className].filter(Boolean).join(' ');

    return (
        <div className={classes} role="radiogroup" aria-label={ariaLabel}>
            {options.map((option) => {
                const active = value === option.value;
                return (
                    <button
                        key={option.value}
                        className={`segmented-control-button ${active ? 'active' : ''}`}
                        onClick={() => onChange(option.value)}
                        role="radio"
                        aria-checked={active}
                        type="button"
                        disabled={option.disabled}
                        title={option.title}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
