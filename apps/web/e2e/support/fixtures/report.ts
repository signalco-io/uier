import type { PageFixture } from './types';

// The reporting core of the Accessibility and SEO panels (e2e/page-checks-report.spec.ts): a gallery
// of three images without alt text (one rule, one SEO check, three elements each), controls smaller
// than 24 px close together (WCAG 2.5.8 target size; the select has more options than a step of the
// background audit takes, so it is checked on its own), and text on a gradient, whose contrast
// axe-core cannot decide. `?many`: 40 more small controls with long ids, more than one comment lists,
// and two lines of faint text (contrast issues of the rule whose gradient is to review).

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const fixture: PageFixture = {
    css: `
        .report-gallery { display: flex; gap: 32px; margin: 16px 0; }
        .report-tools { display: flex; gap: 2px; margin: 32px 0; align-items: center; }
        .report-tool { width: 16px; height: 16px; padding: 0; border: 0; border-radius: 2px; font: 10px/16px sans-serif; background: rgb(225, 225, 225); color: rgb(20, 20, 20); }
        .report-size { width: 16px; height: 18px; padding: 0; font: 11px sans-serif; }
        .report-gradient { padding: 8px; background-image: linear-gradient(90deg, rgb(255, 255, 255), rgb(110, 110, 110)); color: rgb(80, 80, 80); }
        .report-faint { color: rgb(190, 190, 190); }`,
    body: url => `<section id="report-checks">
            <h2>Gallery</h2>
            <div class="report-gallery">
                <img id="gallery-1" src="${image}" width="48" height="48">
                <img id="gallery-2" src="${image}" width="48" height="48">
                <img id="gallery-3" src="${image}" width="48" height="48">
            </div>
            <div class="report-tools">
                <button id="tool-bold" class="report-tool" type="button" aria-label="Bold"></button>
                <button id="tool-italic" class="report-tool" type="button" aria-label="Italic"></button>
                <button id="tool-underline" class="report-tool" type="button" aria-label="Underline"></button>
            </div>
            <div class="report-tools">
                <select id="tool-size" class="report-size" aria-label="Text size">${Array.from({ length: 60 }, (_, i) => `<option>${i + 8} px</option>`).join('')}</select>
                <button id="tool-apply" class="report-tool" type="button" aria-label="Apply size"></button>
            </div>
            <p id="gradient-note" class="report-gradient">Offers change every week.</p>
            ${url.searchParams.has('many') ? `<div class="report-tools">${Array.from({ length: 40 }, (_, i) =>
                `<button id="toolbar-shortcut-button-number-${i + 1}" class="report-tool" type="button">${i + 1}</button>`).join('')}</div>
            <p id="fine-print-1" class="report-faint">Prices exclude tax.</p>
            <p id="fine-print-2" class="report-faint">Offers end on Friday.</p>` : ''}
        </section>`
};

export default fixture;
