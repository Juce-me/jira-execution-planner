const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');

function contrast(a, b) {
    const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + .05) / (values[1] + .05);
}
async function measure(control) {
    return control.evaluate(node => {
        const rgb = value => {
            const srgb = value.match(/^color\(srgb\s+([^)]+)\)$/);
            if (srgb) {
                const values = (srgb[1].match(/[\d.]+/g) || []).map(Number);
                return values.map((channel, index) => index < 3 ? channel * 255 : channel);
            }
            if (!/^rgba?\(/.test(value)) throw new Error(`Unsupported computed color: ${value}`);
            return (value.match(/[\d.]+/g) || []).map(Number);
        };
        const over = (front, back) => { const alpha = front.length > 3 ? front[3] : 1; return front.slice(0, 3).map((c, i) => c * alpha + back[i] * (1 - alpha)); };
        const rect = element => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
        const style = getComputedStyle(node);
        const before = getComputedStyle(node, '::before');
        const ancestors = []; for (let p = node.parentElement; p; p = p.parentElement) ancestors.unshift(p);
        let card = [255, 255, 255]; ancestors.forEach(p => {card = over(rgb(getComputedStyle(p).backgroundColor), card);});
        let fill = over(rgb(style.backgroundColor), card);
        if (style.backgroundImage.startsWith('radial-gradient(')) {
            const tint = style.backgroundImage.match(/(?:rgba?\([^)]+\)|color\(srgb\s+[^)]+\))/)?.[0];
            if (tint) fill = over(rgb(tint), fill);
        }
        const color = rgb(style.color);
        if (/inset.*999px|999px.*inset/.test(style.boxShadow)) {
            const alpha = Number(style.getPropertyValue('--overlay-pct').trim()) / 100;
            if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) throw new Error('Invalid hover overlay percentage');
            fill = color.slice(0, 3).map((c, i) => c * alpha + fill[i] * (1 - alpha));
        }
        const brightness = Number(style.filter.match(/brightness\(([\d.]+)\)/)?.[1] || 1);
        fill = fill.map(c => Math.min(255, c * brightness));
        const text = color.slice(0, 3).map(c => Math.min(255, c * brightness));
        const ranges = []; const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); while(walker.nextNode()) { if (!walker.currentNode.textContent.trim()) continue; const range = document.createRange(); range.selectNodeContents(walker.currentNode); ranges.push([...range.getClientRects()].map(r => [r.x, r.y, r.width, r.height])); }
        return { box: rect(node), ranges, background: style.backgroundColor, backgroundImage: style.backgroundImage, beforeImage: before.backgroundImage, beforeShadow: before.boxShadow, textDecoration: style.textDecorationLine, color: style.color, border: style.borderColor, borderWidth: style.borderWidth, borderStyle: style.borderStyle, bottomBorder: rgb(style.borderBottomColor), radius: style.borderRadius, shadow: style.boxShadow, filter: style.filter, transform: style.transform, opacity: style.opacity, fill, text, card, disabled: node.matches(':disabled,[aria-disabled="true"]'), font: style.font, letterSpacing: style.letterSpacing, className: node.className, inlineStyle: node.getAttribute('style'), transition: style.transitionProperty };
    });
}
function evidenceDir(testInfo) {
    const dir = path.join(__dirname, '../../test-results/design-system-part-2', process.env.JEP_HOVER_PHASE || 'pr3-after', testInfo.project.name || testInfo.project.use.browserName || 'browser');
    fs.mkdirSync(dir, { recursive: true }); return dir;
}
async function hoverEvidence(page, control, testInfo, label, options = {}) {
    await expect(control).toBeVisible(); await control.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest'}));
    if(options.restTarget) await options.restTarget.hover(); else await page.mouse.move(1,1);
    await page.waitForTimeout(450);
    await expect.poll(()=>control.evaluate(node=>node.matches(':hover'))).toBe(false);
    const rest = await measure(control);
    const restTextSamples = options.readableDescendants ? await measureDescendantText(control) : null;
    const dir = evidenceDir(testInfo); const filename = label.replace(/[^a-z0-9-]/gi, '-');
    await page.screenshot({ path: path.join(dir, `${filename}-rest.png`), clip: {x:rest.box[0],y:rest.box[1],width:rest.box[2],height:rest.box[3]}, animations: 'disabled' });
    await control.hover(); await page.waitForTimeout(450);
    await expect.poll(()=>control.evaluate(node=>node.matches(':hover'))).toBe(true);
    const hover = await measure(control);
    const hoverRingShadow = options.ringPseudo ? hover.beforeShadow : hover.shadow;
    await page.screenshot({ path: path.join(dir, `${filename}-hover.png`), clip: {x:hover.box[0],y:hover.box[1],width:hover.box[2],height:hover.box[3]}, animations: 'disabled' });
    let ringPixels=null;
    if(options.pill || options.foundation) {
        const box=hover.box; const png=await page.screenshot({clip:{x:Math.max(0,box[0]-3),y:Math.max(0,box[1]-3),width:box[2]+6,height:box[3]+6},animations:'disabled'});
        fs.writeFileSync(path.join(dir,`${filename}-ring.png`),png);
        ringPixels=await page.evaluate(async ({data,width})=>{const img=new Image(); img.src=data; await img.decode(); const canvas=document.createElement('canvas'); canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const scale=canvas.width/width; const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let count=0,bottom=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){if(x>6*scale&&x<canvas.width-7*scale&&y>6*scale&&y<canvas.height-7*scale)continue;const i=(y*canvas.width+x)*4;if(pixels[i]>=35&&pixels[i]<=65&&pixels[i+1]>=105&&pixels[i+1]<=145&&pixels[i+2]>=210&&pixels[i+2]<=250){count++;if(y>=canvas.height-7*scale&&y<canvas.height-2*scale&&x>6*scale&&x<canvas.width-7*scale)bottom++;}}return {all:count,bottom};},{data:'data:image/png;base64,'+png.toString('base64'),width:box[2]+6});
    }
    const cssOwnership=await control.evaluate(node=>{const matches=[];const walk=rules=>{for(const rule of rules){if(rule.cssRules)walk(rule.cssRules);else if(rule.selectorText){try{if(node.matches(rule.selectorText))matches.push({selector:rule.selectorText,declarations:rule.style.cssText});}catch{}}}};for(const sheet of document.styleSheets){try{walk(sheet.cssRules);}catch{}}return matches;});
    const textSamples = options.readableDescendants ? await measureDescendantText(control) : null;
    if (textSamples) expect(textSamples.length, `${label} visible text owners`).toBeGreaterThan(0);
    const textContrast = textSamples ? Math.min(...textSamples.map(sample => sample.contrast)) : contrast(hover.text, hover.fill);
    const evidence = { rest, hover, ringPixels, cssOwnership, ...(textSamples ? { restTextSamples, textSamples } : {}), textContrast, ringContrast: contrast([47,128,237], hover.card) };
    fs.writeFileSync(path.join(dir, `${filename}.json`), JSON.stringify(evidence, null, 2));
    // Capture mode collects the old behavior completely, before the fail-first run.
    if (process.env.JEP_HOVER_CAPTURE_ONLY === '1') return evidence;
    expect(hover.box, `${label} stationary box`).toEqual(rest.box);
    expect(hover.ranges, `${label} stationary text`).toEqual(rest.ranges);
    expect(hover.font, `${label} stationary text font`).toBe(rest.font);
    expect(hover.radius, `${label} unchanged control shape`).toBe(rest.radius);
    expect(hover.borderWidth, `${label} unchanged border width`).toBe(rest.borderWidth);
    expect(hover.borderStyle, `${label} unchanged border style`).toBe(rest.borderStyle);
    if (hover.backgroundImage.includes('radial-gradient') && parseFloat(rest.borderWidth) > 0
        && rest.borderStyle !== 'none' && !/rgba\([^)]*, 0\)$/.test(rest.border)) {
        const circularFrame = Math.abs(rest.box[2] - rest.box[3]) < .01 && parseFloat(rest.radius) >= rest.box[2] / 2;
        expect(circularFrame, `${label} circular paint must match its visible frame`).toBe(true);
    }
    expect(hover.letterSpacing, `${label} stationary text spacing`).toBe(rest.letterSpacing);
    if (textSamples) expect(textSamples.map(({text,font,letterSpacing}) => ({text,font,letterSpacing})), `${label} stationary descendant type`).toEqual(restTextSamples.map(({text,font,letterSpacing}) => ({text,font,letterSpacing})));
    if (options.disabled || rest.disabled) expect(hover, `${label} disabled hover`).toEqual(rest);
    if (options.unchangedFill !== false) expect(hover.background, `${label} resting fill retained`).toBe(rest.background);
    if (options.semanticHover) {
        // Exact pre-migration semantic colors are intentional palette debt;
        // preserve them instead of accepting a lower numeric contrast threshold.
        expect(hover.color, `${label} semantic hover ink`).toBe(options.semanticHover.color);
        expect(hover.background, `${label} semantic hover fill`).toBe(options.semanticHover.background);
        expect(hover.filter, `${label} semantic hover filter`).toBe(options.semanticHover.filter || 'none');
        if (options.pill) expect(hover.shadow, `${label} semantic pill has ring without overlay`).not.toContain('999px');
    }
    if (options.pill || options.foundation) expect(ringPixels.all, `${label} painted ring pixels at clipped edges`).toBeGreaterThan(4);
    if(options.clipped) expect(ringPixels.bottom, `${label} painted bottom ring survives clipping`).toBeGreaterThan(4);
    if (options.foundation || options.pill) {
        expect(hoverRingShadow, `${label} foundation ring`).toContain('rgb(47, 128, 237)');
        expect(evidence.ringContrast).toBeGreaterThanOrEqual(3);
        if(options.semanticHover) {
            // The exact palette/filter and no-overlay assertions above pin the
            // existing composed treatment, while ring paint/contrast stay strict.
        } else if(options.iconOnly) {
            // Selected icon-only toggles carry no text. Preserve their existing
            // semantic glyph palette while separately proving the ring's contrast.
            expect(evidence.textContrast, `${label} semantic glyph contrast retained`).toBe(contrast(rest.text, rest.fill));
        } else if(options.preserveContrast) {
            // Existing semantic status colors and their preserved 0.94 brightness
            // have known contrast debt; PR2 must not make that treatment worse.
            const baselineContrast=contrast(rest.text.map(c=>c*.94),rest.fill.map(c=>c*.94));
            expect(evidence.textContrast + .001, `${label} semantic palette contrast retained`).toBeGreaterThanOrEqual(baselineContrast);
        } else expect(evidence.textContrast, `${label} composed text contrast`).toBeGreaterThanOrEqual(options.minimumContrast || 4.5);
    }
    if (options.foundation) expect(hover.shadow, `${label} overlay`).toMatch(/999px/);
    if (options.tab) {
        expect(hover.shadow, `${label} tab has no button frame or shading`).toBe('none');
        expect(hover.backgroundImage, `${label} tab has no circle paint`).toBe('none');
        expect(hover.bottomBorder[3] ?? 1, `${label} visible bottom underline`).toBe(1);
        expect(contrast(hover.bottomBorder, hover.fill), `${label} tab underline contrast`).toBeGreaterThanOrEqual(3);
        expect(evidence.textContrast, `${label} tab text contrast`).toBeGreaterThanOrEqual(4.5);
        if (options.selectedTab) {
            expect(hover.color, `${label} selected ink retained`).toBe(rest.color);
            expect(hover.bottomBorder, `${label} selected underline retained`).toEqual(rest.bottomBorder);
        } else expect(hover.bottomBorder, `${label} inactive tab adds underline`).not.toEqual(rest.bottomBorder);
    }
    if (options.selected) {
        expect(hover.background, `${label} selected fill`).toBe(rest.background);
        expect(hover.color, `${label} selected ink`).toBe(rest.color);
        expect(hover.border, `${label} selected border`).toBe(rest.border);
        if (textSamples) expect(textSamples.map(({color,fill}) => ({color,fill})), `${label} selected descendant ink and fill`).toEqual(restTextSamples.map(({color,fill}) => ({color,fill})));
        expect(hover.shadow, `${label} selected ring without overlay`).not.toMatch(/999px/);
        if (options.ringPseudo) expect(hover.shadow, `${label} selected resting shadow retained`).toBe(rest.shadow);
    }
    if (options.icon) {
        expect(`${hover.backgroundImage} ${hover.beforeImage}`, `${label} tinted circle`).toContain('radial-gradient');
        expect(hover.shadow, `${label} icon has no button frame`).toBe('none');
    }
    if (options.rowTint || options.underline) {
        if (options.semanticHover) {
            // Exact original hover palette is checked above.
        } else if (options.preserveContrast) {
            // Existing amber metadata text is separate palette debt. Underlining
            // must preserve its exact ink, composed fill and contrast.
            expect(hover.text, `${label} semantic ink retained`).toEqual(rest.text);
            expect(hover.fill, `${label} semantic fill retained`).toEqual(rest.fill);
            expect(evidence.textContrast, `${label} semantic text contrast retained`).toBe(contrast(rest.text, rest.fill));
        } else expect(evidence.textContrast, `${label} composed text contrast`).toBeGreaterThanOrEqual(4.5);
    }
    if (options.rowTint) {
        expect(hover.background, `${label} option row tint`).not.toBe(rest.background);
        expect(hover.shadow, `${label} option has no button frame`).toBe('none');
    }
    if (options.underline) {
        expect(hover.textDecoration, `${label} underline`).toContain('underline');
        expect(hover.shadow, `${label} text action has no button frame`).toBe('none');
    }
    return evidence;
}
// Container ink is insufficient when a card's heading/note has its own color.
// Compose each visible text owner's fill, including ancestor hover overlays.
async function measureDescendantText(control) {
    const samples = await control.evaluate(node => {
        const rgb = value => {
            const srgb = value.match(/^color\(srgb\s+([^)]+)\)$/);
            if (srgb) return (srgb[1].match(/[\d.]+/g) || []).map(Number).map((c, i) => i < 3 ? c * 255 : c);
            if (!/^rgba?\(/.test(value)) throw new Error(`Unsupported computed color: ${value}`);
            return (value.match(/[\d.]+/g) || []).map(Number);
        };
        const over = (front, back) => front.slice(0, 3).map((c, i) => c * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
        const result = [];
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const text = walker.currentNode;
            if (!text.textContent.trim()) continue;
            const range = document.createRange(); range.selectNodeContents(text);
            if (![...range.getClientRects()].some(r => r.width && r.height)) continue;
            const owner = text.parentElement;
            const chain = []; for (let p = owner; p; p = p.parentElement) chain.unshift(p);
            let fill = [255, 255, 255];
            for (const p of chain) {
                const s = getComputedStyle(p);
                // This check is for flat reporting-card text; never silently
                // approximate image, filter or opacity compositing.
                if (s.backgroundImage !== 'none' || s.filter !== 'none' || s.opacity !== '1') {
                    throw new Error(`Unsupported text compositing on ${p.className}`);
                }
                fill = over(rgb(s.backgroundColor), fill);
                if (/inset.*999px|999px.*inset/.test(s.boxShadow)) {
                    const alpha = Number(s.getPropertyValue('--overlay-pct').trim()) / 100;
                    if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) throw new Error('Invalid hover overlay percentage');
                    fill = over([...rgb(s.color).slice(0, 3), alpha], fill);
                }
            }
            const style = getComputedStyle(owner);
            const color = style.color;
            result.push({ text: text.textContent.trim(), className: owner.className, color, font: style.font, letterSpacing: style.letterSpacing, ink: over(rgb(color), fill), fill });
        }
        return result;
    });
    return samples.map(sample => ({ ...sample, contrast: contrast(sample.ink, sample.fill) }));
}
module.exports = { contrast, measure, measureDescendantText, evidenceDir, hoverEvidence };
