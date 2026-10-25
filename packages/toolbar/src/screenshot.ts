/**
 * Screenshots of the commented part of the page, taken in the reviewer's browser when they post a
 * comment (automatic, issue #81).
 *
 * The page is drawn the way the browser shows it (`modern-screenshot` renders a copy of the DOM
 * through an SVG `foreignObject`, so the page's own CSS applies), without the toolbar. Only what
 * is in the window is drawn: the copy is shifted by the scroll position with a negative margin (a
 * transform would move fixed and sticky elements with it), and elements scrolled inside the page
 * keep their scroll. Then the region around the comment is cut out and encoded (WebP, else JPEG)
 * under the API's limits.
 *
 * What can't be drawn this way: images and fonts from other sites that don't allow it (CORS),
 * `<canvas>`, video and iframes. They show as empty space.
 */
import { createContext, destroyContext, domToCanvas } from 'modern-screenshot';
import { GEIST_FONTS_URL } from '@uier/brand';
import { getCommentItemRects, resolveAnchorElement } from './hooks/useCommentItemRects';
import type { CommentItemPosition } from './components/@types/Comments';

/** A screenshot for a new comment: sent to the API as a data URL, shown in the composer */
export type CapturedScreenshot = {
    dataUrl: string;
    /** Pixels */
    width: number;
    height: number;
};

/** A part of the window, in CSS pixels */
export type ScreenshotRegion = { left: number; top: number; width: number; height: number };

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

/** The part of the window a comment is about: its element or text, or the window for the page */
export function commentRegion(position: CommentItemPosition): ScreenshotRegion {
    if (position.type === 'page') {
        return windowRegion();
    }
    const rects: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>[] = getCommentItemRects(position);
    // A point comment: its whole element, around the point
    const element = position.type === 'point' ? resolveAnchorElement(position) : null;
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
        // The toolbar's own font (src/index.tsx adds it to the page): the toolbar is not in the picture
        if (sheet.href === GEIST_FONTS_URL) {
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
 * Marks the elements scrolled inside the page (not the page itself, which is shifted as a whole),
 * so their copies can show the same scroll. Returns the clean-up.
 */
function markScrolledElements() {
    const marked: Element[] = [];
    for (const element of document.body.querySelectorAll('*')) {
        if (element !== document.scrollingElement && (element.scrollTop || element.scrollLeft)) {
            element.setAttribute(scrollAttribute, `${element.scrollLeft},${element.scrollTop}`);
            marked.push(element);
        }
    }
    if (document.body !== document.scrollingElement && (document.body.scrollTop || document.body.scrollLeft)) {
        document.body.setAttribute(scrollAttribute, `${document.body.scrollLeft},${document.body.scrollTop}`);
        marked.push(document.body);
    }
    return () => marked.forEach(element => element.removeAttribute(scrollAttribute));
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
function encode(source: HTMLCanvasElement): CapturedScreenshot {
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

function resized(source: HTMLCanvasElement, factor: number) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * factor));
    canvas.height = Math.max(1, Math.round(source.height * factor));
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
}

/**
 * A screenshot of a region of the window (window coordinates), without the toolbar (`exclude`,
 * its host element)
 */
export async function captureScreenshot(region: ScreenshotRegion, exclude: Element | null): Promise<CapturedScreenshot> {
    // As the page is now, like the region (measured just before)
    const view = windowSize();
    const scroll = { x: window.scrollX, y: window.scrollY };
    const scale = Math.min(window.devicePixelRatio || 1, maxScale);
    const cssText = await fontFaceCss();
    const unmark = markScrolledElements();
    let page: HTMLCanvasElement;
    try {
        const context = await createContext(document.documentElement, {
            width: view.width,
            height: view.height,
            scale,
            backgroundColor: pageBackground(),
            filter: node => node !== exclude && !(node instanceof Element && node.hasAttribute('data-uier-thread')),
            // The scroll position as a margin, not a transform: fixed and sticky elements stay put.
            // `<html>` is not the page's root in the copy: its overflow would clip it.
            style: { marginTop: `${-scroll.y}px`, marginLeft: `${-scroll.x}px`, overflow: 'visible' },
            font: cssText ? { cssText } : false,
            // The library first waits for every image and video of the page to load: not long, as
            // lazy images below the window never do
            timeout: 1_000,
            onCloneEachNode: restoreScroll
        });
        // Then images are fetched to be drawn: that may take longer
        context.timeout = 10_000;
        try {
            page = await domToCanvas(context);
        } finally {
            destroyContext(context);
        }
    } finally {
        unmark();
    }

    // The region, at most `maxSide` pixels on a side
    const fit = Math.min(1, maxSide / (region.width * scale), maxSide / (region.height * scale));
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(region.width * scale * fit));
    crop.height = Math.max(1, Math.round(region.height * scale * fit));
    crop.getContext('2d')?.drawImage(
        page,
        region.left * scale, region.top * scale, region.width * scale, region.height * scale,
        0, 0, crop.width, crop.height);
    return encode(crop);
}

/** Start once from the feedback event, keep the promise with the draft, and never block text on failure. */
export async function captureCommentScreenshot(position: CommentItemPosition, rootElement: HTMLElement | undefined): Promise<string | undefined> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const capture = captureScreenshot(commentRegion(position), toolbarHost(rootElement));
        return await Promise.race([
            capture.then(image => image.dataUrl),
            new Promise<undefined>(resolve => { timeout = setTimeout(resolve, 15_000); })
        ]);
    } catch (error) {
        console.warn('uier: Automatic screenshot capture failed', error);
        return undefined;
    } finally {
        clearTimeout(timeout);
    }
}
