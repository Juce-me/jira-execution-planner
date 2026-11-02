import * as React from 'react';
import { makeFieldSearchResults, makeFieldKeyDown } from './useJiraFieldPickers.js';

// Optional Settings mappings reuse the existing selected-chip and field-search interaction.
export default function MappingPickerRow({ mapping, kind = 'field', showTechnicalFieldIds, mappingHoverKey, setMappingHoverKey }) {
    const [query, setQuery] = React.useState('');
    const [open, setOpen] = React.useState(false);
    const [index, setIndex] = React.useState(0);
    const { items: matches, total } = makeFieldSearchResults(query, mapping.options || []);
    // An optional extra choice for typed text the list cannot offer (Scope boundaries: a canonical Sprint value).
    const typed = mapping.typedOption ? mapping.typedOption(query, mapping.options || []) : null;
    const items = typed ? [...matches, typed] : matches;
    const selected = mapping.selected;
    const hoverKey = mapping.previewKey;
    const select = option => {
        if (!option || option.disabled) return;
        mapping.onSelect(option);
        setQuery('');
        setOpen(false);
        setIndex(0);
    };
    React.useEffect(() => { if (index >= items.length) setIndex(0); }, [index, items.length]);
    // The results list can open below a short scrolling panel (phone width); bring it into view.
    const resultsRef = React.useRef(null);
    React.useEffect(() => {
        if (open && items.length && resultsRef.current?.scrollIntoView) resultsRef.current.scrollIntoView({ block: 'nearest' });
    }, [open, items.length, query]);
    const handleKeyDown = makeFieldKeyDown(items, index, setIndex,
        id => select(items.find(option => option.id === id)), () => {}, setQuery, setOpen);
    return (
        <div
            className={`group-projects-subsection${hoverKey && mappingHoverKey === hoverKey ? ' is-linked-hover' : ''}`}
            data-map-key={hoverKey || mapping.key}
            data-mapping-key={mapping.key}
            data-mapping-status={mapping.status || undefined}
            onMouseEnter={hoverKey ? () => setMappingHoverKey(hoverKey) : undefined}
            onMouseLeave={hoverKey ? () => setMappingHoverKey(null) : undefined}
        >
            <div className="team-selector-label">{mapping.label}{mapping.optional ? ' (optional)' : mapping.required ? ' (required)' : ''}</div>
            {mapping.helper && <div className="group-field-helper">{mapping.helper}</div>}
            <div className="capacity-inline-row">
                {selected ? (
                    <div className={`selected-team-chip${kind === 'hierarchy' ? ' issue-type-chip' : ''}`} title={selected.id}>
                        <span className="team-name"><strong>{selected.name}</strong>{showTechnicalFieldIds && selected.id && <span className="field-id-hint">({selected.id})</span>}</span>
                        <button className="remove-btn" type="button" title="Remove" aria-label={`Remove ${mapping.label}`} onClick={() => { setQuery(''); setOpen(false); setIndex(0); mapping.onRemove(); }}>&times;</button>
                    </div>
                ) : (
                    <div className="team-search-wrapper capacity-inline-search">
                        <input
                            type="text" className="team-search-input" aria-label={`Search ${mapping.label}`}
                            placeholder={kind === 'hierarchy' ? 'Search issue types...' : kind === 'sprint' ? 'Search Sprint values...' : 'Search fields...'} value={query}
                            onChange={event => { setQuery(event.target.value); setOpen(true); setIndex(0); }}
                            onFocus={() => setOpen(true)} onBlur={() => { window.setTimeout(() => setOpen(false), 120); }} onKeyDown={handleKeyDown}
                        />
                        {open && items.length === 0 && mapping.emptyMessage && query.trim() && (
                            <div className="team-search-results" onMouseDown={event => event.preventDefault()}>
                                <div className="team-search-result-item is-empty" role="status">{mapping.emptyMessage}</div>
                            </div>
                        )}
                        {open && items.length > 0 && (
                            <div className="team-search-results" ref={resultsRef} onMouseDown={event => event.preventDefault()}>
                                {items.map((option, optionIndex) => (
                                    <div key={option.id} className={`team-search-result-item ${optionIndex === index ? 'active' : ''}`} aria-disabled={option.disabled || undefined} onClick={() => select(option)}>
                                        <strong>{option.name}</strong> <span style={{ opacity: 0.5 }}>({option.detail ?? option.id})</span>
                                    </div>
                                ))}
                                {total > matches.length && <div className="team-search-more">+{total - matches.length} more matches — keep typing to narrow.</div>}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
