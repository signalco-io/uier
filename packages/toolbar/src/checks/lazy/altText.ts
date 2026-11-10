import { elementKey, elementLabel, foundLine, isRendered, isToolbarNode, oneLine, writtenAddress } from '../pageElements';
import type { PageCheck, PageIssue } from '../types';
import { words } from './locale';
import { pageCheck, pageIssue, type SectionContext, type SectionReport } from './api';

// Alt text review (packages/toolbar/docs/page-checks-content.md): every image beside the text a
// screen reader reads for it, and the alt texts that say nothing. axe-core already reports images
// without alt text and alt text that repeats its link's text; whether alt text describes its image
// needs a person, so this lists them all and flags only what plain string rules can tell. The word
// lists are English.

/** What looks wrong in an alt text */
export type AltTextFlag = 'file-name' | 'prefix' | 'placeholder' | 'long';

export type AltTextImage = {
    /** Stable for the element: its row and its Highlight */
    key: string;
    /** The image (an `img`, an image button, a map's area, an svg or a `role="img"` element) */
    element: Element;
    /** What Highlight outlines and a comment is pinned to: the image, or for a map's area the image that uses the map */
    target: Element;
    label: string;
    /** `text`: read as `alt`; `decorative`: an empty alt or a presentation role; `missing`: nothing (the audit reports it) */
    state: 'text' | 'decorative' | 'missing';
    alt?: string;
    /** The address the page itself loaded, for the thumbnail; none for an inline svg or another element */
    src?: string;
    flags: AltTextFlag[];
};

export type AltTextDetails = { images: AltTextImage[] };

/** Alt text over this many characters is flagged as long */
export const longAltText = 150;

const imageExtension = /\.(?:avif|bmp|gif|heic|heif|ico|jfif|jpe?g|png|svg|tiff?|webp)$/i;
const cameraName = /^(?:IMG|DSC[FN]?|PXL|MVIMG|GOPR|DJI)[_-]?\d{3,}|^screen ?shot[ _-]?\d/i;
// A hash, a UUID, or a long token without spaces that has digits (`hero_banner_final_v2_2023`)
const hashName = /^[0-9a-f]{16,}$|^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$|^(?=\S*\d)[\w-]{20,}$/i;
const prefix = /^(?:(?:an?|the)\s+)?(?:image|picture|photo|photograph|graphic|illustration|icon|screenshot|pic|img)(?:\s+(?:of|showing|shows|depicting)\b|\s*:)/i;
// "logo" alone is fine: it says what the image is
const placeholders = new Set(['image', 'images', 'img', 'photo', 'photos', 'photograph', 'picture', 'pic', 'graphic', 'alt', 'alt text',
    'alt tag', 'untitled', 'untitled image', 'spacer', 'blank', 'placeholder', 'thumbnail', 'icon', 'null', 'undefined', 'none', 'todo',
    'tbd', 'description', 'image description', 'insert alt text', 'add alt text', 'dummy', 'filler']);

/** The file name of an address, without its folders and query */
function fileName(src: string | undefined) {
    try {
        return src && !/^data:/i.test(src) ? decodeURIComponent(new URL(src, document.baseURI).pathname.split('/').pop() ?? '') : '';
    } catch {
        return '';
    }
}

/** What looks wrong in an alt text: plain string rules, English words */
export function altTextFlags(alt: string, src?: string): AltTextFlag[] {
    const flags: AltTextFlag[] = [];
    const file = fileName(src).toLowerCase();
    const sameAsFile = file.length > 2 && /[\d_-]/.test(file) && [file, file.replace(/\.[^.]+$/, '')].includes(alt.toLowerCase());
    if (imageExtension.test(alt) || cameraName.test(alt) || hashName.test(alt) || sameAsFile) flags.push('file-name');
    if (prefix.test(alt)) flags.push('prefix');
    if (placeholders.has(alt.toLowerCase().replace(/[\s._:-]+/g, ' ').trim()) || !/\p{L}/u.test(alt)) flags.push('placeholder');
    if ([...alt].length > longAltText) flags.push('long');
    return flags;
}

/** The text of the elements `aria-labelledby` names */
function labelledBy(element: Element) {
    return oneLine(element.getAttribute('aria-labelledby')?.split(/\s+/).map(id => id && document.getElementById(id)?.textContent).join(' '), 2000);
}

/** What a screen reader reads for the image, in the order it looks for it */
function readAlt(element: Element): Pick<AltTextImage, 'state' | 'alt'> {
    const label = labelledBy(element) || oneLine(element.getAttribute('aria-label'), 2000);
    if (label) return { state: 'text', alt: label };
    const role = element.getAttribute('role')?.trim().split(/\s+/)[0]?.toLowerCase();
    if (role === 'presentation' || role === 'none') return { state: 'decorative' };
    const own = element.matches('img, input, area') ? element.getAttribute('alt')
        : element instanceof SVGSVGElement ? element.querySelector(':scope > title')?.textContent : null;
    const alt = oneLine(own, 2000);
    if (alt) return { state: 'text', alt };
    // An empty alt marks an image as decoration; an image button or a map's area needs one
    if (typeof own === 'string' && element instanceof HTMLImageElement) return { state: 'decorative' };
    const title = oneLine(element.getAttribute('title'), 2000);
    return title ? { state: 'text', alt: title } : { state: 'missing' };
}

/** The image an image map's area belongs to */
function mapImage(area: HTMLAreaElement) {
    const name = area.closest('map')?.name;
    return name ? document.querySelector(`img[usemap="#${CSS.escape(name)}"]`) ?? undefined : undefined;
}

/** The page's images as a screen reader meets them: rendered, not hidden from it, not the toolbar's */
export function pageImages(): AltTextImage[] {
    const images: AltTextImage[] = [];
    for (const element of document.querySelectorAll('img, input[type="image" i], area[href], svg, [role~="img" i]')) {
        if (isToolbarNode(element) || element.closest('[aria-hidden="true"]')) continue;
        // An svg is an image when it says so: a role, a label or a title (else it is decoration or part of a control)
        if (element instanceof SVGSVGElement && !element.matches('[role~="img" i], [aria-label], [aria-labelledby]') && !element.querySelector(':scope > title')) continue;
        const target = element instanceof HTMLAreaElement ? mapImage(element) : element;
        if (!target || !isRendered(target)) continue;
        const src = element instanceof HTMLImageElement ? element.currentSrc || undefined : element instanceof HTMLInputElement ? element.src || undefined : undefined;
        const read = readAlt(element);
        images.push({
            key: `alt-text:${elementKey(element)}`, element, target, label: elementLabel(element), ...read, src,
            flags: read.alt ? altTextFlags(read.alt, src) : []
        });
    }
    return images;
}

/** Each flag's check, in the toolbar's language: its row, its reason and what its comment says */
function flagChecks(): Record<AltTextFlag, { label: string; reason: (count: number) => string; comment: string }> {
    const { flags } = words().altText;
    return {
        'file-name': flags['file-name'],
        prefix: flags.prefix,
        placeholder: flags.placeholder,
        long: { label: flags.long.label, reason: count => flags.long.reason(count, longAltText), comment: flags.long.comment(longAltText) }
    };
}

/** What the comment calls the element */
function kind(element: Element) {
    const { kinds } = words().altText;
    return element instanceof HTMLInputElement ? kinds.input : element instanceof HTMLAreaElement ? kinds.area : kinds.image;
}

/**
 * Every image the page shows with its alt text, and a check for each kind of alt text that looks
 * wrong (an issue on each image). A few milliseconds of string work: it may run in the background.
 */
export function checkAltText({ path }: SectionContext): SectionReport<AltTextDetails> {
    const { altText: t, found } = words();
    const images = pageImages();
    if (!images.length) return { checks: [pageCheck('alt-text-images', t.images, 'none', t.noImages)], count: 0, details: { images } };
    const checks: PageCheck[] = [];
    const all = flagChecks();
    for (const flag of Object.keys(all) as AltTextFlag[]) {
        const { label, reason, comment } = all[flag];
        const issues: PageIssue[] = images.filter(image => image.flags.includes(flag)).map(image => {
            const issue = pageIssue(path, { type: 'accessibility', id: `alt-text-${flag}` }, image.element, `"${oneLine(image.alt, 80)}"`,
                `${t.commentStart(kind(image.element))} ${comment}${foundLine(found.altText, image.alt)}${foundLine(found.image, writtenAddress(image.src))}`);
            // A map's area is outlined and pinned on its image; its key and name stay its own
            return image.target === image.element ? issue : { ...issue, element: image.target };
        });
        // An alt text every issue shares (one image's) is the check's value: the rows then show only their images
        const shared = issues.every(issue => issue.summary === issues[0]?.summary) ? issues[0]?.summary : undefined;
        if (issues.length) checks.push(pageCheck(`alt-text-${flag}`, label, 'warn', reason(issues.length), { issues, value: shared }));
    }
    if (!checks.length && images.some(image => image.state === 'text')) {
        checks.push(pageCheck('alt-text-wording', t.wording, 'pass', t.wordingOk(longAltText)));
    }
    return { checks, count: images.length, details: { images } };
}
