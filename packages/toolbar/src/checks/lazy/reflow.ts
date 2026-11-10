import { elementLabel, foundLine, isToolbarNode, oneLine } from '../pageElements';
import type { PageIssue } from '../types';
import { pageCheck, pageIssue, type SectionContext, type SectionReport } from './api';

// Zoom and text spacing (packages/toolbar/docs/page-checks-content.md): reflow (WCAG 1.4.10) at the
// window's width, and text spacing (WCAG 1.4.12) applied to the page while the reviewer looks.

/** The width WCAG 1.4.10 asks a page to fit without scrolling sideways (1280 px at 400% zoom) */
export const reflowWidth = 320;
/** Elements listed per check; the count says how many were found */
const listed = 20;

/** What was measured, and how a reviewer gets to the width WCAG asks for */
function checkedAt(width: number) {
    if (width <= reflowWidth) return `Checked at ${width} px, within the ${reflowWidth} px WCAG 1.4.10 asks for.`;
    // A phone or tablet cannot narrow its window
    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(hover: hover)').matches) return `Checked at ${width} px, this screen's width. WCAG 1.4.10 asks for ${reflowWidth} px.`;
    return `Checked at ${width} px. WCAG 1.4.10 asks for ${reflowWidth} px (1280 px at 400% zoom): narrow the window or zoom in, then check again.`;
}

/** Whether the element clips or scrolls what overflows it sideways (a table, code or a carousel in a scroll box) */
const holdsOverflow = (style: CSSStyleDeclaration) => style.overflowX !== 'visible';

/**
 * Why an element sticking out does not count, if it does not: the ancestor (or itself) that is
 * fixed, or holds its overflow (scrolls or clips it). The page's own `html` and `body` do not hold it.
 */
function excludedBy(element: Element): Element | undefined {
    for (let current: Element | null = element; current && current !== document.body && current !== document.documentElement; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.position === 'fixed' || (current !== element && holdsOverflow(style))) return current;
    }
    return undefined;
}

/**
 * Reflow at the window's current width: whether the page scrolls sideways, and the elements whose
 * right edge is beyond the document's width (the outermost of them; not inside a box that scrolls
 * or clips sideways on purpose, not fixed, not hidden, not the toolbar).
 */
export function checkReflow({ path }: SectionContext): SectionReport {
    const root = document.documentElement;
    // The width the page is laid out in, without a scrollbar. Not `innerWidth`: on a phone it grows
    // with content wider than the screen (the layout viewport widens to it)
    const width = root.clientWidth;
    // The viewport takes `html`'s overflow, or `body`'s when `html`'s is visible
    const rootStyle = getComputedStyle(root);
    const viewportOverflow = rootStyle.overflowX !== 'visible' ? rootStyle.overflowX : document.body ? getComputedStyle(document.body).overflowX : 'visible';
    const clipped = viewportOverflow === 'hidden' || viewportOverflow === 'clip';
    const scrolls = !clipped && root.scrollWidth > width + 1;
    const found: { element: Element; by: number }[] = [];
    let skipped: Element | undefined;
    for (const element of document.body?.getElementsByTagName('*') ?? []) {
        // Inside an outermost one already found, or one left out
        if (skipped?.contains(element) || (element instanceof SVGElement && element.ownerSVGElement)) continue;
        const rect = element.getBoundingClientRect();
        const right = rect.right + scrollX;
        // Parked entirely beyond a page that does not scroll sideways: off-canvas, not cut off
        if (right <= width + 1 || !rect.width || !rect.height || (clipped && rect.left + scrollX >= width) || isToolbarNode(element)) continue;
        const by = excludedBy(element);
        const style = getComputedStyle(element);
        if (by || style.visibility === 'hidden' || style.opacity === '0') {
            skipped = by ?? element;
            continue;
        }
        found.push({ element, by: Math.round(right - width) });
        skipped = element;
    }
    const asks = `WCAG 1.4.10 (Reflow) asks for no sideways scrolling at ${reflowWidth} px.`;
    const issues: PageIssue[] = found.slice(0, listed).map(({ element, by }) => pageIssue(path, { type: 'accessibility', id: 'reflow' }, element,
        `Sticks out by ${by} px.`,
        `Accessibility: At ${width} px wide, this element sticks out ${by} px past the page's edge, so ${scrolls ? 'the page scrolls sideways' : 'it is cut off'}. ${asks}${foundLine('Element', elementLabel(element))}`));
    const reason = checkedAt(width);
    const measure = `${width} px`;
    if (!found.length && !scrolls) {
        // A pass only at the width WCAG asks for; wider, a note of what was measured
        return { checks: [pageCheck('reflow', 'Reflow', width <= reflowWidth ? 'pass' : 'none', reason, { measure, value: 'Nothing sticks out, and the page does not scroll sideways.' })] };
    }
    // One element says by how much here: its row then shows only its name
    const elements = found.length === 1 ? `1 element sticks out by ${found[0]!.by} px`
        : found.length ? `${found.length} elements stick out${found.length > listed ? ` (the first ${listed} listed)` : ''}` : '';
    const value = scrolls ? `The page scrolls sideways.${elements ? ` ${elements}.` : ''}` : `${elements} and ${found.length === 1 ? 'is' : 'are'} cut off.`;
    if (!found.length) {
        // Scrolls, but nothing the check can name (an element in a shadow root, a negative margin): about the page
        issues.push(pageIssue(path, { type: 'accessibility', id: 'reflow' }, undefined, 'The page scrolls sideways.',
            `Accessibility: At ${width} px wide, the page scrolls sideways: its content is ${root.scrollWidth} px wide. ${asks}`));
    }
    return { checks: [pageCheck('reflow', 'Reflow', 'warn', reason, { measure, value, issues })] };
}

/**
 * WCAG 1.4.12's values, for every element of the page but the toolbar's host and inline thread slots
 * (the `:not(#…)` also outweighs the page's own rules). Letter and word spacing are inherited, so the
 * host keeps the values it had (its shadow root resets them too: the toolbar's text never changes).
 */
function spacingRules() {
    const host = document.getElementById('uier-toolbar');
    const style = host && isToolbarNode(host) ? getComputedStyle(host) : undefined;
    return `*:not(#uier-toolbar):not([data-uier-thread]) { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p:not(#uier-toolbar):not([data-uier-thread]) { margin-bottom: 2em !important; }
${style ? `#uier-toolbar { letter-spacing: ${style.letterSpacing} !important; word-spacing: ${style.wordSpacing} !important; }` : ''}`;
}

let spacing: CSSStyleSheet | undefined;

function detach(sheet: CSSStyleSheet) {
    if (spacing === sheet) spacing = undefined;
    if (document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = document.adoptedStyleSheets.filter(adopted => adopted !== sheet);
}

/** Takes text spacing off the page: exactly the sheet `applyTextSpacing` added, nothing else */
export function removeTextSpacing() {
    if (spacing) detach(spacing);
}

/** Whether text spacing is on the page */
export function textSpacingApplied() {
    return !!spacing && document.adoptedStyleSheets.includes(spacing);
}

/** The next frame, or the signal's reason once it is aborted */
function nextFrame(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const abort = () => {
            cancelAnimationFrame(frame);
            reject(signal.reason);
        };
        const frame = requestAnimationFrame(() => {
            signal.removeEventListener('abort', abort);
            resolve();
        });
        signal.addEventListener('abort', abort, { once: true });
    });
}

/** The page's own block boxes, whether each one's content overflows it now */
function overflowing(elements: readonly HTMLElement[]) {
    return elements.map(element => (element.clientHeight > 0 || element.clientWidth > 0)
        && (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1));
}

/** Whether the element's content (its text and boxes, not their margins) reaches past its padding box */
function contentLeaves(element: HTMLElement) {
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const content = range.getBoundingClientRect();
    const right = box.left + element.clientLeft + element.clientWidth;
    const bottom = box.top + element.clientTop + element.clientHeight;
    return content.right > right + 1 || content.bottom > bottom + 1;
}

const spacingValues = 'line height 1.5, paragraph spacing 2 em, letter spacing 0.12 em, word spacing 0.16 em';

/**
 * Text spacing (WCAG 1.4.12) as a mode: applies the criterion's values to the page with a
 * constructed stylesheet (a site's CSP may block a `<style>` element, never this), measures what no
 * longer fits, and leaves the spacing on so the reviewer can look. `removeTextSpacing` takes it off;
 * a cancelled or failed check takes it off itself. Reported: boxes with text that fit it before and
 * no longer do, that clip it (`overflow` hidden or clip) or have a fixed size it spills out of. A box
 * that scrolls keeps its text in reach and is left out.
 */
export async function applyTextSpacing({ path, signal }: SectionContext): Promise<SectionReport> {
    signal.throwIfAborted();
    removeTextSpacing();
    // A marquee moves its own text: like a box that scrolls, it is left out
    const elements = [...document.body?.getElementsByTagName('*') ?? []]
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element.localName !== 'marquee' && !isToolbarNode(element));
    const before = overflowing(elements);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(spacingRules());
    spacing = sheet;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    try {
        // Laid out with it, and the page's own resize observers have run
        await nextFrame(signal);
        await nextFrame(signal);
        const after = overflowing(elements);
        const found = elements.flatMap((element, index) => {
            if (before[index] || !after[index] || !element.isConnected) return [];
            const style = getComputedStyle(element);
            const scrollable = /auto|scroll/.test(style.overflowX + style.overflowY);
            // As shown: a line break is a space
            const text = oneLine(element.innerText);
            // Only text that leaves the box: a paragraph's new bottom margin alone overflows it too
            return scrollable || !text || style.visibility === 'hidden' || !contentLeaves(element) ? []
                : [{ element, text, clips: /hidden|clip/.test(style.overflowX + style.overflowY) }];
        });
        const issues = found.slice(0, listed).map(({ element, text, clips }) => pageIssue(path, { type: 'accessibility', id: 'text-spacing' }, element,
            `${clips ? 'Cut off' : 'Spills out'}: "${oneLine(text, 60)}"`,
            `Accessibility: With WCAG 1.4.12 text spacing (${spacingValues}), this element's text no longer fits: it ${clips ? 'is cut off' : 'spills out of its box'}. It fits without it. Let the box grow with its text instead of a fixed height or width.${foundLine('Element', elementLabel(element))}${foundLine('Text', text, 120)}`));
        const reason = `Measured with ${spacingValues}. Look at the page too: overlapping text is found only where a box overflows.`;
        return {
            checks: [found.length
                ? pageCheck('text-spacing', 'Text spacing', 'warn', reason, {
                    issues, value: found.length === 1 ? `1 element no longer fits its text. ${issues[0]!.summary}`
                        : `${found.length} elements no longer fit their text${found.length > listed ? ` (the first ${listed} listed)` : ''}.`
                })
                : pageCheck('text-spacing', 'Text spacing', 'pass', reason, { value: 'No text is newly cut off.' })]
        };
    } catch (error) {
        // Cancelled (a newer check, Check again, the page left) or failed: nothing is left on the page
        detach(sheet);
        throw error;
    }
}
