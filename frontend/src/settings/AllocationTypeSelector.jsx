import * as React from 'react';
import { searchAllocationOptions } from '../api/jiraCatalogApi.js';
import { isAuthenticationRequiredError } from '../api/authRequired.js';

// The saved DELIVERY metadata is the only catalog source, independent of the viewed quarter.
export function savedAllocationSource(bundle) {
    const entry = bundle?.configurations?.find(item => item.model === 'rnd_2027');
    const fieldId = entry?.fields?.allocation?.fieldId || '';
    return fieldId ? { fieldId, projectKey: entry.scope?.projects?.[0]?.key || '', issueTypeId: entry.hierarchy?.parentIssueTypeId || '' } : null;
}

export default function AllocationTypeSelector({ backendUrl, group, savedWorkConfigurations, setGroupDraft }) {
    const [query, setQuery] = React.useState('');
    const [open, setOpen] = React.useState(false);
    const [catalog, setCatalog] = React.useState({ options: [], complete: false, loading: false, query: '', sourceKey: '' });
    const source = savedAllocationSource(savedWorkConfigurations);
    const sourceKey = JSON.stringify(source);
    const typed = query.trim();
    React.useEffect(() => {
        setCatalog({ options: [], complete: false, loading: Boolean(source && typed), query: typed, sourceKey });
        if (!source || !typed) return undefined;
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            try {
                const response = await searchAllocationOptions(backendUrl, { ...source, query: typed, signal: controller.signal });
                if (!response.ok) throw new Error('Allocation values unavailable');
                const payload = await response.json();
                if (!controller.signal.aborted) setCatalog({ options: payload.options || [], complete: payload.complete === true, loading: false, query: typed, sourceKey });
            } catch (error) {
                if (!controller.signal.aborted && !isAuthenticationRequiredError(error)) setCatalog({ options: [], complete: false, loading: false, query: typed, sourceKey });
            }
        }, 220);
        return () => { window.clearTimeout(timer); controller.abort(); };
    }, [backendUrl, group.id, typed, sourceKey]);
    const items = group.allocationTypes || [];
    const mapped = new Set(items.map(item => item.value));
    const current = catalog.query === typed && catalog.sourceKey === sourceKey ? catalog : { options: [], complete: false, loading: true };
    const options = current.options.filter(item => typeof item.value === 'string' && !mapped.has(item.value) && item.value.toLowerCase().includes(typed.toLowerCase())).slice(0, 20);
    if (typed && typed.length <= 255 && !current.complete && !current.loading && !mapped.has(typed) && !options.some(item => item.value === typed)) options.push({ value: typed });
    const patch = update => setGroupDraft(previous => ({ ...previous, groups: (previous?.groups || []).map(candidate => candidate.id === group.id ? { ...candidate, allocationTypes: update(candidate.allocationTypes || []) } : candidate) }));
    const add = (value, type) => {
        patch(previous => previous.length >= 200 || previous.some(item => item.value === value) ? previous : [...previous, { value, type }]);
        setQuery(''); setOpen(false);
    };
    return <>
        <div className="group-projects-subsection" data-allocation-types>
            <div className="team-selector-label">DELIVERY Allocation</div>
            <div className="group-field-helper">{source ? 'Selected Initiative Allocation values define this Department’s Allocation Board. Classify each as Product or Tech; blank and unmapped values have No Allocation.' : 'Ask an administrator to save the DELIVERY Allocation field in Project config → Field mapping to list its values.'}</div>
            <div className="team-search-wrapper">{!open ? <button type="button" className="secondary compact" disabled={!source || items.length >= 200} onClick={() => setOpen(true)}>Add Allocation value</button> : <>
                <input autoFocus type="text" className="team-search-input" placeholder="Search Allocation values to add..." aria-label="Search Allocation values" value={query} maxLength={255} disabled={!source || items.length >= 200}
                    onChange={event => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)}
                    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); } }} />
                {open && typed && <div className="team-search-results" onMouseDown={event => event.preventDefault()}>
                    {current.loading ? <div className="team-search-result-item is-empty">Searching Allocation values...</div> : options.length === 0 ? <div className="team-search-result-item is-empty">No values found</div> : options.map(option => <div key={option.value} className="team-search-result-item">
                        <span className="project-result-label"><strong>{option.value}</strong></span>
                        <span className="project-result-actions">
                            <button type="button" className="project-type-btn product" onClick={() => add(option.value, 'product')}>Product</button>
                            <button type="button" className="project-type-btn tech" onClick={() => add(option.value, 'tech')}>Tech</button>
                        </span>
                    </div>)}
                </div>}
            </>}</div>
            {typed && !current.loading && !current.complete && <div className="group-field-helper">Jira listed only some values here; type a value to add it.</div>}
        </div>
        {['product', 'tech'].map(type => <div key={type} className="group-projects-subsection" data-allocation-type={type}>
            <div className="team-selector-label">{type === 'product' ? 'Product' : 'Tech'}</div>
            {items.filter(item => item.type === type).length === 0 ? <div className="team-selector-empty">No {type} values.</div> : <div className="selected-teams-list">
                {items.filter(item => item.type === type).map(item => <div key={item.value} className={`selected-team-chip ${type}-chip`}>
                    <span className="team-name"><strong>{item.value}</strong></span>
                    <button className="remove-btn" type="button" title="Remove value" aria-label={`Remove ${type} value ${item.value}`} onClick={() => patch(previous => previous.filter(value => value.value !== item.value))}>&times;</button>
                </div>)}
            </div>}
        </div>)}
    </>;
}
