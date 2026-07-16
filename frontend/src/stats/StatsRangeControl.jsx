import * as React from 'react';
import ControlField from '../ui/ControlField.jsx';

const optionIndexFor = (options, value) => options.findIndex(
    (option) => String(option.value) === String(value)
);

export default function StatsRangeControl({
    idPrefix,
    kindLabel,
    options,
    startValue,
    endValue,
    onStartChange,
    onEndChange,
    active = true,
}) {
    const rootRef = React.useRef(null);
    const toggleRefs = React.useRef({ start: null, end: null });
    const [openEnd, setOpenEnd] = React.useState(null);
    const normalizedOptions = Array.isArray(options) ? options : [];

    const close = React.useCallback((focusEnd = null) => {
        setOpenEnd(null);
        if (focusEnd) {
            window.requestAnimationFrame(() => toggleRefs.current[focusEnd]?.focus());
        }
    }, []);

    React.useEffect(() => {
        if (!active) setOpenEnd(null);
    }, [active]);

    React.useEffect(() => {
        if (!openEnd) return undefined;
        const handlePointerDown = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setOpenEnd(null);
        };
        const handleFocusIn = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) setOpenEnd(null);
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close(openEnd);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [close, openEnd]);

    React.useEffect(() => {
        if (!openEnd) return undefined;
        const frame = window.requestAnimationFrame(() => {
            const dropdown = rootRef.current?.querySelector(`[data-range-end="${openEnd}"]`);
            const selected = dropdown?.querySelector('[role="option"][aria-selected="true"]');
            const first = dropdown?.querySelector('[role="option"]');
            (selected || first)?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [endValue, normalizedOptions.length, openEnd, startValue]);

    const focusOption = (end, index) => {
        const nodes = rootRef.current?.querySelectorAll(`[data-range-end="${end}"] [role="option"]`) || [];
        nodes[index]?.focus();
    };

    const renderDropdown = (end, value, onChange) => {
        const selectedIndex = optionIndexFor(normalizedOptions, value);
        const selected = normalizedOptions[selectedIndex] || normalizedOptions[0];
        const isOpen = openEnd === end;
        const listboxId = `${idPrefix}-${end}-listbox`;
        const accessibleLabel = `${end === 'start' ? 'Start' : 'End'} ${kindLabel.toLowerCase()}`;
        const choose = (option) => {
            onChange(option.value);
            close(end);
        };
        return (
            <div className="sprint-dropdown" data-range-end={end}>
                <button
                    type="button"
                    ref={(node) => { toggleRefs.current[end] = node; }}
                    className={`sprint-dropdown-toggle ${isOpen ? 'open' : ''}`}
                    aria-label={accessibleLabel}
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                    aria-controls={listboxId}
                    disabled={normalizedOptions.length === 0}
                    onClick={() => setOpenEnd(isOpen ? null : end)}
                    onKeyDown={(event) => {
                        if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
                            event.preventDefault();
                            setOpenEnd(end);
                        }
                    }}
                >
                    <span>{selected?.label || 'No options'}</span>
                    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                        <path d="M6 9L1 4h10z" />
                    </svg>
                </button>
                {isOpen && normalizedOptions.length > 0 && (
                    <div className="sprint-dropdown-panel">
                        <div id={listboxId} className="sprint-dropdown-list" role="listbox" aria-label={accessibleLabel}>
                            {normalizedOptions.map((option, index) => {
                                const selectedOption = String(option.value) === String(value);
                                return (
                                    <div
                                        key={option.value}
                                        className={`sprint-dropdown-option ${selectedOption ? 'selected' : ''}`}
                                        role="option"
                                        aria-selected={selectedOption}
                                        tabIndex={selectedOption || (selectedIndex < 0 && index === 0) ? 0 : -1}
                                        data-range-value={option.value}
                                        onClick={() => choose(option)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                                event.preventDefault();
                                                const delta = event.key === 'ArrowDown' ? 1 : -1;
                                                focusOption(end, (index + delta + normalizedOptions.length) % normalizedOptions.length);
                                            } else if (event.key === 'Home' || event.key === 'End') {
                                                event.preventDefault();
                                                focusOption(end, event.key === 'Home' ? 0 : normalizedOptions.length - 1);
                                            } else if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                choose(option);
                                            }
                                        }}
                                    >
                                        {option.label}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div ref={rootRef} className="stats-control-group" role="group" aria-label={`${kindLabel} range`} data-stats-range={idPrefix}>
            <div className="controls-label">{kindLabel}</div>
            <div className="view-filters">
                <ControlField label="Start" dataLabel={`Start ${kindLabel}`}>
                    {renderDropdown('start', startValue, onStartChange)}
                </ControlField>
                <ControlField label="End" dataLabel={`End ${kindLabel}`}>
                    {renderDropdown('end', endValue, onEndChange)}
                </ControlField>
            </div>
        </div>
    );
}
