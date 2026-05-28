import * as React from 'react';

export default function PlanningProjectSplitBar({
    selectedProjectEntries,
    excludedProjectStats,
}) {
    const projectTotal = selectedProjectEntries.reduce((sum, e) => sum + e.storyPoints, 0);
    const productEntry = selectedProjectEntries.find(e => e.id === 'PRODUCT');
    const techEntry = selectedProjectEntries.find(e => e.id === 'TECH');
    const productSP = productEntry ? productEntry.storyPoints : 0;
    const techSP = techEntry ? techEntry.storyPoints : 0;
    const productPct = projectTotal > 0 ? (productSP / projectTotal) * 100 : 0;
    const techPct = projectTotal > 0 ? (techSP / projectTotal) * 100 : 0;
    const excludedProduct = excludedProjectStats['PRODUCT'] || 0;
    const excludedTech = excludedProjectStats['TECH'] || 0;
    const excludedTotal = excludedProduct + excludedTech;
    const targetPct = 70;

    return (
        <>
            <div className="planning-stats compact" style={{ marginTop: '0.35rem' }}>
                <div className="planning-stat">
                    <span className="planning-stat-label" data-tooltip="Planning capacity split: 70% Product / 30% Tech (tech-heavy teams may aim for 10% / 90%). Selected effort excludes excluded epics.">Selected SP by Project:</span>
                </div>
            </div>
            {projectTotal === 0 && excludedTotal === 0 ? (
                <div className="planning-stat" style={{ marginTop: '0.3rem' }}>
                    <span className="planning-stat-value">No tasks selected</span>
                </div>
            ) : (
                <div className="project-bar-graph">
                    <div className="capacity-bar-track">
                        {/* Product fill */}
                        <div
                            className="project-bar-fill product"
                            style={{ width: `${productPct}%`, borderRadius: techPct > 0 ? '6px 0 0 6px' : '6px' }}
                            data-tooltip={`Product: ${productSP.toFixed(1)} SP (${productPct.toFixed(0)}% of selected).${excludedProduct > 0 ? ` Excluded: ${excludedProduct.toFixed(1)} SP.` : ''}`}
                        >
                            {productPct > 15 && (
                                <span className="capacity-bar-fill-label">Product {productPct.toFixed(0)}% · {productSP.toFixed(1)} SP</span>
                            )}
                        </div>
                        {/* Tech fill */}
                        {techPct > 0 && (
                        <div
                            className="project-bar-fill tech"
                            style={{ left: `${productPct}%`, width: `${techPct}%` }}
                            data-tooltip={`Tech: ${techSP.toFixed(1)} SP (${techPct.toFixed(0)}% of selected).${excludedTech > 0 ? ` Excluded: ${excludedTech.toFixed(1)} SP.` : ''}`}
                        >
                            {techPct > 15 && (
                                <span className="capacity-bar-fill-label">Tech {techPct.toFixed(0)}% · {techSP.toFixed(1)} SP</span>
                            )}
                        </div>
                        )}
                        {/* 70% target marker */}
                        <div className="capacity-bar-marker" style={{ left: `${targetPct}%` }}>
                            <div className="capacity-bar-marker-line dashed" />
                            <div className="capacity-bar-marker-label">Target<br/>{targetPct}% / {100 - targetPct}%</div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
