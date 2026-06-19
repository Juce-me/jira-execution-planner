import * as React from 'react';

export default function PlanningProjectSplitBar({
    selectedProjectEntries,
    excludedProjectStats,
    adHocProductSP = 0,
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
    // Ad Hoc is INCLUDED Product capacity, reported as a Product subsegment — never
    // styled as excluded. It is already counted inside productSP.
    const adHocSP = Math.min(adHocProductSP, productSP);
    const hasAdHoc = adHocSP > 0;
    // Width of the Ad Hoc subsegment relative to the whole bar (sits inside Product).
    const adHocPct = productSP > 0 ? (adHocSP / productSP) * productPct : 0;

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
                            data-tooltip={`Product: ${productSP.toFixed(1)} SP (${productPct.toFixed(0)}% of selected).${hasAdHoc ? ` Incl. Ad Hoc: ${adHocSP.toFixed(1)} SP.` : ''}${excludedProduct > 0 ? ` Excluded: ${excludedProduct.toFixed(1)} SP.` : ''}`}
                        >
                            {productPct > 15 && (
                                <span className="capacity-bar-fill-label">Product {productPct.toFixed(0)}% · {productSP.toFixed(1)} SP{hasAdHoc && productPct > 30 ? ` · Ad Hoc ${adHocSP.toFixed(1)}` : ''}</span>
                            )}
                        </div>
                        {/* Ad Hoc Product subsegment: included Product capacity reported separately */}
                        {hasAdHoc && (
                            <div
                                className="project-bar-fill product-adhoc"
                                style={{ left: `${Math.max(0, productPct - adHocPct)}%`, width: `${adHocPct}%`, borderRadius: techPct > 0 ? 0 : '0 6px 6px 0' }}
                                data-tooltip={`Ad Hoc (included Product): ${adHocSP.toFixed(1)} SP of ${productSP.toFixed(1)} Product SP.`}
                            />
                        )}
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
