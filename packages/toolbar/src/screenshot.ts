import { runtimeAdapters } from './adapters';
/**
 * Screenshots of the commented part of the page, taken in the reviewer's browser when they post a
 * comment (automatic, issue #81).
 *
 * DOM content is drawn with the page's CSS (`modern-screenshot` renders a copy through an SVG
 * `foreignObject`), without the toolbar unless the comment reviews its controls on uier itself.
 * Unsupported content can be omitted. Only what
 * is in the window is drawn: the copy is shifted by the scroll position with a negative margin (a
 * transform would move fixed and sticky elements with it), and elements scrolled inside the page
 * keep their scroll. Then the region around the comment is cut out and encoded (WebP, else JPEG)
 * under the API's limits.
 *
 * The window and its scroll are read when the reviewer asks for the composer. Inner scroll and
 * offscreen checks, then the copy, run after the composer has been painted, in short pieces of work that let
 * the page handle input in between (#319). The content of blocks far from the window is left out:
 * nothing of it can be seen, and the copy keeps their boxes.
 *
 * What can't be drawn this way: images and fonts from other sites that don't allow it (CORS),
 * `<canvas>`, video and iframes. They show as empty space.
 */
import { createContext, destroyContext, domToCanvas } from 'modern-screenshot';
import { GEIST_FONTS_PATH } from '@uier/brand';
import { toolbarConfig } from './config';
import { getCommentItemRects, resolveAnchorElement } from './hooks/useCommentItemRects';
import { isCommentArea, type CommentItemPosition } from './components/@types/Comments';
import { toolbarReviewTarget, toolbarReviewSurfaces } from './toolbarReview';
import { getToolbarHost } from './mount';
import type { CommentDrawing } from './drawing';
import { paintDrawing } from './canvas/paint';

/** A screenshot sent to the API as a data URL; shown only on saved feedback. */
export type CapturedScreenshot = {
    dataUrl: string;
    /** Pixels */
    width: number;
    height: number;
};

/** A part of the window, in CSS pixels */
export type ScreenshotRegion = { left: number; top: number; width: number; height: number };

/**
 * A comment's drawing (canvas mode), painted over the screenshot: its area's top-left corner in the
 * window, measured with the region (docs/canvas-mode.md)
 */
export type ScreenshotDrawing = { drawing: CommentDrawing; left: number; top: number };

/** Room around the commented element or text */
const regionPadding = 24;
/** A small anchor (a word, an icon) still gets some of its surroundings */
const minimumRegion = { width: 360, height: 200 };
/** Under the API's limits (MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DIMENSION) */
const maxBytes = 480 * 1024;
const maxSide = 2400;
/** Sharper on high-density screens, but not larger than needed */
const maxScale = 2;
/** Marks elements scrolled inside the page while their copy is made */
const scrollAttribute = 'data-uier-screenshot-scroll';
/** The longest piece of capture work before the page gets to handle input again, in milliseconds */
const sliceMs = 8;

/** The window without its scrollbars (in quirks mode `<html>` is as tall as the page; `<body>` is the window) */
function windowSize() {
    const root = document.compatMode === 'CSS1Compat' ? document.documentElement : document.body;
    return { width: root.clientWidth || window.innerWidth, height: root.clientHeight || window.innerHeight };
}

/** The toolbar's own element (the host of its shadow root), which a screenshot leaves out */
export function toolbarHost(rootElement: HTMLElement | undefined): Element | null {
    const root = rootElement?.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
}

/** The whole window (feedback and bug reports are about the page) */
export function windowRegion(): ScreenshotRegion {
    const { width, height } = windowSize();
    return { left: 0, top: 0, width, height };
}

/** The region around these rectangles (window coordinates), with some room, within the window */
export function regionAround(rects: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>[]): ScreenshotRegion {
    const view = windowSize();
    if (!rects.length) {
        return windowRegion();
    }

    let left = Math.min(...rects.map(r => r.left)) - regionPadding;
    let top = Math.min(...rects.map(r => r.top)) - regionPadding;
    let right = Math.max(...rects.map(r => r.right)) + regionPadding;
    let bottom = Math.max(...rects.map(r => r.bottom)) + regionPadding;
    // Grow a small region around its centre
    const growX = Math.max(0, minimumRegion.width - (right - left)) / 2;
    const growY = Math.max(0, minimumRegion.height - (bottom - top)) / 2;
    left -= growX;
    right += growX;
    top -= growY;
    bottom += growY;

    left = Math.max(0, Math.floor(left));
    top = Math.max(0, Math.floor(top));
    right = Math.min(view.width, Math.ceil(right));
    bottom = Math.min(view.height, Math.ceil(bottom));
    return right > left && bottom > top
        ? { left, top, width: right - left, height: bottom - top }
        : windowRegion();
}

/** The part of the window a comment is about: its element, area or text, or the window for the page */
export function commentRegion(position: CommentItemPosition): ScreenshotRegion {
    if (position.type === 'page') {
        return windowRegion();
    }
    const rects: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>[] = getCommentItemRects(position);
    // A point comment: its whole element, around the point (an area is the region itself)
    const element = position.type === 'point' && !isCommentArea(position) ? resolveAnchorElement(position) : null;
    if (element) {
        rects.push(element.getBoundingClientRect());
    }
    return regionAround(rects);
}

const fontDataUrls = new Map<string, Promise<string | null>>();

function readAsDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/** A font file as a data URL (kept for the next screenshot), or `null` when it can't be read */
function fontDataUrl(url: string) {
    let dataUrl = fontDataUrls.get(url);
    if (!dataUrl) {
        dataUrl = fetch(url)
            .then(response => response.ok ? response.blob() : Promise.reject(new Error(`${response.status}`)))
            .then(readAsDataUrl)
            .catch(() => null);
        fontDataUrls.set(url, dataUrl);
    }
    return dataUrl;
}

/** `url(...)`s of CSS made absolute against the stylesheet they came from */
function absoluteUrls(css: string, base: string) {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote: string, url: string) => {
        if (/^(data|blob):/i.test(url)) {
            return match;
        }
        try {
            return `url("${new URL(url, base).href}")`;
        } catch {
            return match;
        }
    });
}

/**
 * The page's `@font-face` rules for the fonts it has loaded, with the font files inlined: an SVG
 * drawn as an image loads nothing from outside. Done here and not by the library, because the
 * library resolves relative font URLs with a `<base>` element that a page's CSP can forbid.
 */
async function fontFaceCss() {
    const rules: string[] = [];
    for (const sheet of [...document.styleSheets]) {
        // The toolbar's own font (src/runtime.tsx adds it to the page): the toolbar is not in the picture
        if (sheet.href === `${toolbarConfig.apiUrl}${GEIST_FONTS_PATH}`) {
            continue;
        }
        const base = sheet.href ?? document.baseURI;
        let cssRules: CSSRuleList | null = null;
        try {
            cssRules = sheet.cssRules;
        } catch {
            // Another site's stylesheet without CORS: read it again, if it allows that
        }
        if (cssRules) {
            const visit = (list: CSSRuleList) => {
                for (const rule of [...list]) {
                    if (rule instanceof CSSFontFaceRule) {
                        rules.push(absoluteUrls(rule.cssText, base));
                    } else if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList) {
                        visit(rule.cssRules);
                    }
                }
            };
            visit(cssRules);
        } else if (sheet.href) {
            // A fetch the page's CSP may not allow (connect-src): then its fonts fall back
            try {
                const css = await (await fetch(sheet.href)).text();
                for (const match of css.matchAll(/@font-face\s*{[^}]*}/g)) {
                    rules.push(absoluteUrls(match[0], sheet.href));
                }
            } catch {
                // Not readable: the text falls back to another font
            }
        }
    }

    // Only the faces the page loaded (a family can have many, e.g. one per script)
    const loaded = new Set([...document.fonts]
        .filter(font => font.status === 'loaded')
        .map(font => `${font.family.replace(/["']/g, '')}|${font.unicodeRange}`));
    const used = rules.filter((css) => {
        const family = /font-family:\s*["']?([^;"']+)/.exec(css)?.[1]?.trim();
        const range = /unicode-range:\s*([^;]+)/.exec(css)?.[1]?.trim() ?? 'U+0-10FFFF';
        return family !== undefined && loaded.has(`${family}|${range}`);
    });

    const inlined = await Promise.all(used.map(async (css) => {
        let result = css;
        for (const [, url] of css.matchAll(/url\("([^"]+)"\)/g)) {
            if (url && !url.startsWith('data:')) {
                const dataUrl = await fontDataUrl(url);
                if (dataUrl) {
                    result = result.replace(`url("${url}")`, `url("${dataUrl}")`);
                }
            }
        }
        return result;
    }));
    return inlined.join('\n');
}

/**
 * Records inner scroll after the first paint, in cancellable pieces. The caller owns the marks
 * so even a capture cancelled during this scan removes every attribute it added.
 */
async function markScrolledElements(includeToolbar: boolean, slice: () => Promise<void>, marked: Element[]) {
    // A TreeWalker avoids materialising every descendant before the first yield. Start with the
    // body too: in standards mode it can be an independently scrolled container.
    const roots: Node[] = [document.body];
    const shadow = includeToolbar && getToolbarHost()?.shadowRoot;
    if (shadow) roots.push(shadow);
    for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node: Node | null = root;
        while (node) {
            await slice();
            if (node instanceof Element && node !== document.scrollingElement && (node.scrollTop || node.scrollLeft)) {
                node.setAttribute(scrollAttribute, `${node.scrollLeft},${node.scrollTop}`);
                marked.push(node);
            }
            node = walker.nextNode();
        }
    }
}

/**
 * In the copy: a marked element's children move by its scroll, and the mark goes. (A transform:
 * fixed and sticky elements inside such an element move with it, unlike in the page.)
 */
function restoreScroll(cloned: Node) {
    if (!(cloned instanceof Element)) {
        return;
    }
    // In the copy `<body>` is not the page's root: a `height: 100%` or `overflow` that makes the page
    // scroll would make it a clipped box, empty once shifted by the scroll
    if (cloned instanceof HTMLBodyElement && document.scrollingElement !== document.body) {
        cloned.style.overflow = 'visible';
        cloned.style.height = 'auto';
        cloned.style.maxHeight = 'none';
    }
    if (!cloned.hasAttribute(scrollAttribute)) {
        return;
    }
    const [left = 0, top = 0] = (cloned.getAttribute(scrollAttribute) ?? '').split(',').map(Number);
    cloned.removeAttribute(scrollAttribute);
    for (const child of [...cloned.children]) {
        if (child instanceof HTMLElement || child instanceof SVGElement) {
            child.style.transform = `translate(${-left}px, ${-top}px) ${child.style.transform}`.trim();
        }
    }
}

function pageBackground() {
    for (const element of [document.body, document.documentElement]) {
        const color = getComputedStyle(element).backgroundColor;
        if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) {
            return color;
        }
    }
    return '#ffffff';
}

function bytesOf(dataUrl: string) {
    return Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
}

/** WebP (JPEG where the browser can't make WebP), smaller in quality and then in size until it fits */
export function encodeScreenshot(source: HTMLCanvasElement): CapturedScreenshot {
    let canvas = source;
    for (let attempt = 0; attempt < 6; attempt++) {
        for (const quality of [0.85, 0.7, 0.55]) {
            let dataUrl = canvas.toDataURL('image/webp', quality);
            if (!dataUrl.startsWith('data:image/webp')) {
                dataUrl = canvas.toDataURL('image/jpeg', quality);
            }
            if (bytesOf(dataUrl) <= maxBytes) {
                return { dataUrl, width: canvas.width, height: canvas.height };
            }
        }
        canvas = resized(canvas, 0.75);
    }
    throw new Error('The screenshot is too large');
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
    return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
}

/** Like `encodeScreenshot`, with the browser encoding outside the page's main thread (`toBlob`) */
async function encodeScreenshotInBackground(source: HTMLCanvasElement, signal?: AbortSignal): Promise<CapturedScreenshot> {
    let canvas = source;
    for (let attempt = 0; attempt < 6; attempt++) {
        for (const quality of [0.85, 0.7, 0.55]) {
            let blob = await canvasBlob(canvas, 'image/webp', quality);
            if (blob?.type !== 'image/webp') {
                blob = await canvasBlob(canvas, 'image/jpeg', quality);
            }
            signal?.throwIfAborted();
            if (blob && blob.size <= maxBytes) {
                return { dataUrl: await readAsDataUrl(blob), width: canvas.width, height: canvas.height };
            }
        }
        canvas = resized(canvas, 0.75);
    }
    throw new Error('The screenshot is too large');
}

function resized(source: HTMLCanvasElement, factor: number) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * factor));
    canvas.height = Math.max(1, Math.round(source.height * factor));
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
}

/** After the next frame (the composer that started the capture) is painted; soon, when the tab is hidden */
function afterNextPaint() {
    return new Promise<void>((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 0));
        setTimeout(resolve, 100);
    });
}

/** Gives the page a turn: its input, rendering and other tasks run before the capture goes on */
function yieldToPage() {
    const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (scheduler?.yield) {
        return scheduler.yield();
    }
    // Not `setTimeout`: repeated, it waits at least 4 ms each time
    return new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            resolve();
        };
        channel.port2.postMessage(null);
    });
}

/** Called between pieces of work: yields once the current piece has taken `sliceMs`, and stops a cancelled capture */
function timeSlices(signal: AbortSignal | undefined) {
    let started = performance.now();
    return async () => {
        signal?.throwIfAborted();
        if (performance.now() - started < sliceMs) {
            return;
        }
        await yieldToPage();
        signal?.throwIfAborted();
        started = performance.now();
    };
}

/** Displays whose size in the copy is their own (`width` and `height`), whatever is in them */
const blockDisplays = new Set(['block', 'flow-root', 'list-item', 'flex', 'grid', 'table']);
/** Displays whose block children are laid out one after the other, each below the one before */
const flowDisplays = new Set(['block', 'flow-root', 'list-item']);

/**
 * What the copy can leave out of an element far from the window: all of it below the window in a
 * block's flow (nothing before it moves), or its content (the copy keeps every element's `width`
 * and `height`, so a block keeps its size). Above the window a first child's top margin that
 * collapses through the block would move everything after it.
 */
function leaveOutOf(element: Element, rect: DOMRect, windowBottom: number): 'element' | 'content' | undefined {
    if (!(element instanceof HTMLElement)) {
        return undefined;
    }
    const style = getComputedStyle(element);
    if (!blockDisplays.has(style.display)) {
        return undefined;
    }
    const parent = element.parentElement && getComputedStyle(element.parentElement);
    if (rect.top > windowBottom) {
        // Not in columns, which balance their content
        return parent && flowDisplays.has(parent.display) && parent.columnCount === 'auto' && parent.columnWidth === 'auto'
            ? 'element'
            : (element.firstChild ? 'content' : undefined);
    }
    const ownTop = (style.display !== 'block' && style.display !== 'list-item')
        || parseFloat(style.paddingTop) > 0 || parseFloat(style.borderTopWidth) > 0
        || !['visible', 'clip'].includes(style.overflowY) || style.float !== 'none'
        || style.position === 'absolute' || style.position === 'fixed'
        || /flex|grid/.test(parent?.display ?? '');
    return ownTop && element.firstChild ? 'content' : undefined;
}

/**
 * The page's elements the copy can leave out, or whose content it can: they and everything in them
 * are more than a window's width or height away from it (an element's box holds what is in it,
 * unless it is positioned, transformed or overflows: then that content has its own box, measured too).
 * A sticky element is kept wherever it is, with all of it: the copy places it again.
 */
async function farFromWindow(view: { width: number; height: number }, slice: () => Promise<void>) {
    const near = { left: -view.width, top: -view.height, right: 2 * view.width, bottom: 2 * view.height };
    const rects = new Map<Element, DOMRect>();
    const far = { elements: new Set<Element>(), content: new Set<Element>() };
    const collect = async (element: Element): Promise<void> => {
        await slice();
        const rect = rects.get(element);
        // Page input can add children while the scan yields. Keep unmeasured content.
        if (!rect) return;
        const leaveOut = leaveOutOf(element, rect, near.bottom);
        if (leaveOut === 'element') {
            far.elements.add(element);
        } else if (leaveOut === 'content') {
            far.content.add(element);
        } else {
            for (const child of element.children) await collect(child);
        }
    };
    // Whether the element or anything in it is near the window. A shadow root's content isn't
    // measured, nor a sticky element's: it is all kept.
    const visit = async (element: Element): Promise<boolean> => {
        await slice();
        const rect = element.getBoundingClientRect();
        rects.set(element, rect);
        if (element.shadowRoot || getComputedStyle(element).position === 'sticky') {
            return true;
        }
        let isNear = rect.right >= near.left && rect.left <= near.right && rect.bottom >= near.top && rect.top <= near.bottom;
        const farChildren: Element[] = [];
        for (const child of element.children) {
            if (await visit(child)) {
                isNear = true;
            } else {
                farChildren.push(child);
            }
        }
        if (isNear) {
            for (const child of farChildren) await collect(child);
        }
        return isNear;
    };
    if (document.body) {
        await visit(document.body);
    }
    return far;
}

/**
 * A screenshot of a region of the window. Page feedback excludes the toolbar host; comments
 * reviewing uier's own controls include its review surfaces, without annotations or instructions.
 */
export async function captureScreenshot(region: ScreenshotRegion, exclude: Element | null, includeToolbar = false, signal?: AbortSignal, drawing?: ScreenshotDrawing): Promise<CapturedScreenshot> {
    if (runtimeAdapters()) {
        const captured = await runtimeAdapters()!.capture(region);
        return drawing ? withDrawing(captured, region, drawing, signal) : captured;
    }
    // As the page is now, like the region (measured just before)
    const view = windowSize();
    const scroll = { x: window.scrollX, y: window.scrollY };
    const scale = Math.min(window.devicePixelRatio || 1, maxScale);
    const reviewRoot = includeToolbar ? getToolbarHost()?.shadowRoot : undefined;
    const marked: Element[] = [];
    let page: HTMLCanvasElement;
    try {
        await afterNextPaint();
        const slice = timeSlices(signal);
        await markScrolledElements(includeToolbar, slice, marked);
        // Measured again only if the page did not scroll meanwhile (otherwise all of it is copied)
        const far = window.scrollX === scroll.x && window.scrollY === scroll.y
            ? await farFromWindow(view, slice)
            : { elements: new Set<Element>(), content: new Set<Element>() };
        // Input can scroll the page during the scan. In that case keep the full copy rather
        // than pruning with rectangles measured against two different scroll positions.
        if (window.scrollX !== scroll.x || window.scrollY !== scroll.y) {
            far.elements.clear();
            far.content.clear();
        }
        await slice();
        const cssText = await fontFaceCss();
        await slice();
        const context = await createContext(document.documentElement, {
            width: view.width,
            height: view.height,
            scale,
            backgroundColor: pageBackground(),
            // Inline threads, annotations and placement controls stay out. A decorative element's
            // content (`data-uier-decorative`, README) keeps its box without the animation.
            filter: node => node !== exclude
                && !(node instanceof Element && (node.hasAttribute('data-uier-thread')
                    || node.matches('[data-uier-outline],[data-uier-comment],[data-uier-capture-exclude]')
                    || (reviewRoot && node.getRootNode() === reviewRoot
                        && !node.matches('style,[data-uier-root]') && !node.closest(toolbarReviewSurfaces)
                        && !node.querySelector(toolbarReviewSurfaces))))
                && !node.parentElement?.closest('[data-uier-decorative]')
                && !far.elements.has(node as Element)
                && !(node.parentElement && far.content.has(node.parentElement)),
            // The scroll position as a margin, not a transform: fixed and sticky elements stay put.
            // `<html>` is not the page's root in the copy: its overflow would clip it.
            style: { marginTop: `${-scroll.y}px`, marginLeft: `${-scroll.x}px`, overflow: 'visible' },
            font: cssText ? { cssText } : false,
            // The library first waits for every image and video of the page to load: not long, as
            // lazy images below the window never do
            timeout: 1_000,
            onCloneEachNode: async (cloned) => {
                restoreScroll(cloned);
                await slice();
            },
            onCloneNode: slice,
            onEmbedNode: slice,
            onCreateForeignObjectSvg: slice
        });
        // Then images are fetched to be drawn: that may take longer
        context.timeout = 10_000;
        // The library reads elements' default styles in a frame it fills with `srcdoc`: loaded
        // between two pieces of work, that replaces the frame's document (without a `<body>` at
        // first). This one keeps its first, empty document.
        const sandbox = document.createElement('iframe');
        sandbox.setAttribute('data-uier-capture-exclude', '');
        sandbox.setAttribute('aria-hidden', 'true');
        sandbox.tabIndex = -1;
        Object.assign(sandbox.style, { position: 'fixed', width: '0', height: '0', border: '0', visibility: 'hidden' });
        document.body.appendChild(sandbox);
        context.sandbox = sandbox;
        try {
            page = await domToCanvas(context);
        } finally {
            destroyContext(context);
        }
        await slice();
    } finally {
        for (const element of marked) element.removeAttribute(scrollAttribute);
    }

    // The region, at most `maxSide` pixels on a side
    const fit = Math.min(1, maxSide / (region.width * scale), maxSide / (region.height * scale));
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(region.width * scale * fit));
    crop.height = Math.max(1, Math.round(region.height * scale * fit));
    const context = crop.getContext('2d');
    context?.drawImage(
        page,
        region.left * scale, region.top * scale, region.width * scale, region.height * scale,
        0, 0, crop.width, crop.height);
    if (context && drawing) {
        const pixels = scale * fit;
        paintDrawing(context, drawing.drawing, (drawing.left - region.left) * pixels, (drawing.top - region.top) * pixels, pixels);
    }
    return encodeScreenshotInBackground(crop, signal);
}

/** A screenshot taken without the toolbar (a packaged client's), with the drawing painted over it */
async function withDrawing(captured: CapturedScreenshot, region: ScreenshotRegion, drawing: ScreenshotDrawing, signal?: AbortSignal) {
    const image = new Image();
    image.src = captured.dataUrl;
    await image.decode();
    signal?.throwIfAborted();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return captured;
    context.drawImage(image, 0, 0);
    const pixels = canvas.width / Math.max(1, region.width);
    paintDrawing(context, drawing.drawing, (drawing.left - region.left) * pixels, (drawing.top - region.top) * pixels, pixels);
    return encodeScreenshotInBackground(canvas, signal);
}

const runningCaptures = new WeakMap<Promise<string | undefined>, AbortController>();

/**
 * Start once from the feedback event, keep the promise with the draft, and never block text on failure.
 * A comment's drawing is painted over its area.
 */
export function captureCommentScreenshot(position: CommentItemPosition, rootElement: HTMLElement | undefined, drawing?: CommentDrawing): Promise<string | undefined> {
    const controller = new AbortController();
    // Where the drawing's area is now, like the region
    const area = drawing ? getCommentItemRects(position)[0] : undefined;
    const overlay = drawing && area ? { drawing, left: area.left, top: area.top } : undefined;
    const capture = (async () => {
        let timeout: number | undefined;
        try {
            const includeToolbar = Boolean(toolbarReviewTarget(resolveAnchorElement(position)));
            const image = captureScreenshot(commentRegion(position), includeToolbar ? null : toolbarHost(rootElement), includeToolbar, controller.signal, overlay);
            return await Promise.race([
                image.then(image => image.dataUrl),
                new Promise<undefined>(resolve => { timeout = window.setTimeout(resolve, 15_000); })
            ]);
        } catch (error) {
            if (!controller.signal.aborted) {
                console.warn('uier: Automatic screenshot capture failed', error);
            }
            return undefined;
        } finally {
            clearTimeout(timeout);
            // Timed out: the rest of the work stops too
            controller.abort();
        }
    })();
    runningCaptures.set(capture, controller);
    void capture.then(() => runningCaptures.delete(capture));
    return capture;
}

/**
 * Stops a capture that is still being taken (Omit screenshot): its work ends at the next piece,
 * and it resolves `undefined`. Returns whether it was still being taken.
 */
export function cancelCommentScreenshot(capture: Promise<string | undefined> | undefined) {
    const controller = capture && runningCaptures.get(capture);
    controller?.abort();
    return Boolean(controller);
}
