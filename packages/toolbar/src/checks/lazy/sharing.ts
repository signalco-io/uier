import { foundLine, oneLine, writtenAddress } from '../pageElements';
import type { CheckState, PageCheck } from '../types';
import { words } from './locale';
import { pageCheck, pageIssue, type SectionContext, type SectionReport } from './api';

// Sharing: how the page looks when its link is shared or shown in search results. The Open Graph
// (https://ogp.me) and X card tags with the fallbacks platforms use, and the shared image loaded in
// this browser to measure it (packages/toolbar/docs/page-checks-seo-head.md).
//
// Sources for what is said about platforms:
// - Facebook's sharing guide on images, https://developers.facebook.com/docs/sharing/webmasters/images/:
//   "The minimum allowed image dimension is 200 x 200 pixels", "at least 1200 x 630 pixels for the best
//   display", "as close to 1.91:1 aspect ratio as possible to display the full image in Feed without any cropping".
// - X's cards markup, https://developer.x.com/en/docs/x-for-websites/cards/overview/markup: the card types
//   summary, summary_large_image, app and player; twitter:title, twitter:description and twitter:image
//   fall back to og:title, og:description and og:image; without twitter:card, "a summary card may be
//   rendered" when og:type, og:title and og:description are there.

/** What the section's own rows show: the search result snippet and the shared-link card */
export type SharingPreview = {
    search: { site: string; address: string; title: string; description: string };
    card: { site: string; title: string; description: string; image?: string };
};

export type SharingReport = SectionReport<SharingPreview>;

/** The page being checked: issue keys end with it */
let checkedPath = '';

/** The Open Graph and X card tags (`og:*`, `twitter:*`) by lowercase name, every value in page order */
type Tags = Map<string, string[]>;

function readTags(): Tags {
    const tags: Tags = new Map();
    for (const meta of document.querySelectorAll('meta[property], meta[name]')) {
        // Open Graph uses `property`, X `name`; both platforms read either
        const name = (meta.getAttribute('property') || meta.getAttribute('name') || '').trim().toLowerCase();
        const content = meta.getAttribute('content')?.trim();
        if (!/^(og|twitter):/.test(name) || !content) continue;
        tags.set(name, [...tags.get(name) ?? [], content]);
    }
    return tags;
}

const first = (tags: Tags, ...names: string[]) => names.map(name => tags.get(name)?.[0]).find(Boolean);

/** Whether the page's robots meta tags ask not to index it (`noindex` or `none`), as the Page section reads them */
function noindexPage() {
    return [...document.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]')]
        .some(tag => (tag.getAttribute('content') ?? '').toLowerCase().split(',').some(value => /^(noindex|none)$/.test(value.trim())));
}

/** An address written in full, with `http://` or `https://`, as the Open Graph protocol expects */
const isFullAddress = (value: string) => /^https?:\/\//i.test(value);

function resolved(value: string | undefined) {
    if (!value) return undefined;
    try {
        const url = new URL(value, document.baseURI);
        return /^https?:$/.test(url.protocol) ? url : undefined;
    } catch {
        return undefined;
    }
}

/** The same page: the origin and path, without a trailing slash (as the Page section compares the canonical link) */
const samePage = (a: URL, b: URL) => a.origin === b.origin && a.pathname.replace(/(.)\/+$/, '$1') === b.pathname.replace(/(.)\/+$/, '$1');

/** The image a shared link shows: `og:image` (its https `secure_url` for an http one), else X's `twitter:image` */
function sharedImage(tags: Tags): { tag: string; value: string; url?: URL } | undefined {
    const og = first(tags, 'og:image', 'og:image:url');
    const secure = first(tags, 'og:image:secure_url');
    const [tag, value] = og ? (/^http:/i.test(og) && secure && /^https:/i.test(secure) ? ['og:image:secure_url', secure] : ['og:image', og])
        : ['twitter:image', first(tags, 'twitter:image', 'twitter:image:src')];
    return value ? { tag, value, url: resolved(value) } : undefined;
}

const missingState = (noindex: boolean): CheckState => noindex ? 'none' : 'warn';

/** Several tags with the same text show the same; different ones are a platform's pick */
const differ = (values: string[]) => values.some(value => value !== values[0]);

function textCheck(id: string, label: string, tag: 'og:title' | 'og:description', values: string[], fallback: { name: string; value: string }): PageCheck {
    const { sharing: t, found } = words();
    if (values.length > 1 && !differ(values)) return pageCheck(id, label, 'none', t.sameTags(values.length, tag), { value: oneLine(values[0], 300) });
    if (values.length > 1) {
        return pageCheck(id, label, 'warn', t.manyTags(values.length, tag), {
            value: oneLine(values[0], 300),
            issues: [pageIssue(checkedPath, { type: 'seo', id }, undefined, t.manyTagsSummary(tag),
                `${t.manyTagsComment(values.length, tag, tag === 'og:title')}${foundLine(found.first(tag), values[0])}`)]
        });
    }
    if (values[0]) return pageCheck(id, label, 'pass', t.fromTag(tag), { value: oneLine(values[0], 300) });
    return fallback.value ? pageCheck(id, label, 'none', t.fallback(tag, fallback.name), { value: oneLine(fallback.value, 300) })
        : pageCheck(id, label, 'none', t.noFallback(tag, fallback.name));
}

function imageCheck(tags: Tags, noindex: boolean): PageCheck {
    const t = words().sharing;
    const id = 'share-image';
    const image = sharedImage(tags);
    const value = image && oneLine(writtenAddress(image.value), 300);
    const issue = (summary: string, comment: string) => [pageIssue(checkedPath, { type: 'seo', id }, undefined, summary, comment)];
    if (!image) {
        return pageCheck(id, t.image, missingState(noindex), t.noImage, {
            issues: noindex ? [] : issue(t.noImageSummary, t.noImageComment)
        });
    }
    if (image.tag === 'twitter:image') {
        return pageCheck(id, t.image, missingState(noindex), t.twitterOnly, {
            value, issues: noindex ? [] : issue(t.noImageSummary, `${t.twitterOnlyComment}${foundLine('twitter:image', value)}`)
        });
    }
    if (!image.url) {
        return pageCheck(id, t.image, 'warn', t.invalidImage(image.tag), {
            value, issues: issue(t.invalidImageSummary, `${t.invalidImageComment(image.tag)}${foundLine(image.tag, value)}`)
        });
    }
    if (!isFullAddress(image.value)) {
        return pageCheck(id, t.image, 'warn', t.relativeImage, {
            value, issues: issue(t.relativeImageSummary, `${t.relativeImageComment(image.tag)}${foundLine(image.tag, value)}`)
        });
    }
    return pageCheck(id, t.image, 'pass', first(tags, 'og:image:alt') ? t.imageAlt : t.imageNoAlt, { value });
}

function urlCheck(tags: Tags): PageCheck {
    const { sharing: t, found } = words();
    const id = 'share-url';
    const values = tags.get('og:url') ?? [];
    const canonicalHref = document.querySelector('link[rel~="canonical" i]')?.getAttribute('href')?.trim();
    const canonical = resolved(canonicalHref);
    const issue = (summary: string, comment: string) => [pageIssue(checkedPath, { type: 'seo', id }, undefined, summary, comment)];
    if (!values.length) return pageCheck(id, 'og:url', 'none', canonical ? t.noUrlCanonical : t.noUrl);
    const value = oneLine(writtenAddress(values[0]), 300);
    if (values.length > 1 && differ(values)) {
        return pageCheck(id, 'og:url', 'warn', t.urls(values.length), {
            value, issues: issue(t.urlsSummary, `${t.urlsComment(values.length)}${foundLine(found.first('og:url'), value)}`)
        });
    }
    const target = resolved(values[0]);
    if (!target || !isFullAddress(values[0]!)) {
        return pageCheck(id, 'og:url', 'warn', target ? t.relativeUrl : t.invalidUrl, {
            value, issues: issue(t.notFullSummary, `${t.notFullComment}${foundLine('og:url', value)}`)
        });
    }
    if (canonical) {
        return samePage(target, canonical) ? pageCheck(id, 'og:url', 'pass', t.matches, { value })
            : pageCheck(id, 'og:url', 'warn', t.differs, {
                value, issues: issue(t.differsSummary, `${t.differsComment}${foundLine('og:url', value)}${foundLine(found.canonical, writtenAddress(canonical.href))}`)
            });
    }
    return samePage(target, new URL(window.location.href)) ? pageCheck(id, 'og:url', 'pass', t.thisPage, { value })
        : pageCheck(id, 'og:url', 'warn', t.otherPage, {
            value, issues: issue(t.otherPageSummary, `${t.otherPageComment}${foundLine('og:url', value)}`)
        });
}

function xCardCheck(tags: Tags): PageCheck {
    const t = words().sharing;
    const id = 'share-x-card';
    const card = first(tags, 'twitter:card');
    if (!card) {
        return pageCheck(id, t.xCard, 'none', ['og:type', 'og:title', 'og:description'].every(name => first(tags, name))
            ? t.noCardSummary
            : t.noCard);
    }
    const value = oneLine(card, 80);
    // The card types X documents, and what each shows
    const known = (t.cards as Record<string, string>)[card.toLowerCase()];
    return known ? pageCheck(id, t.xCard, 'pass', known, { value })
        : pageCheck(id, t.xCard, 'warn', t.unknownCard, {
            value, issues: [pageIssue(checkedPath, { type: 'seo', id }, undefined, t.unknownCardSummary,
                `${t.unknownCardComment}${foundLine('twitter:card', value)}`)]
        });
}

/**
 * Reads the page's sharing tags now: a few `querySelectorAll` calls and no request, so it runs in
 * the background. The image is loaded by `checkSharingImage`, when the panel opens.
 */
export function checkSharing(context: SectionContext): SharingReport {
    checkedPath = context.path;
    const tags = readTags();
    const noindex = noindexPage();
    const title = oneLine(document.title, 1000);
    const description = oneLine(document.querySelector('meta[name="description" i]')?.getAttribute('content'), 1000);
    const host = window.location.host;
    const image = sharedImage(tags)?.url?.href;
    const t = words().sharing;
    return {
        checks: [
            textCheck('share-title', t.title, 'og:title', tags.get('og:title') ?? [], { name: t.fallbackNames.title, value: title }),
            textCheck('share-description', t.description, 'og:description', tags.get('og:description') ?? [], { name: t.fallbackNames.description, value: description }),
            imageCheck(tags, noindex),
            urlCheck(tags),
            xCardCheck(tags)
        ],
        details: {
            search: {
                site: oneLine(first(tags, 'og:site_name'), 80) || host,
                address: oneLine(`${host}${window.location.pathname === '/' ? '' : window.location.pathname}`, 120),
                // About what a result's line holds (the Page section's title check says the same)
                title: oneLine(title, 60),
                description: oneLine(description, 160)
            },
            card: {
                site: host,
                title: oneLine(first(tags, 'og:title') || title, 200),
                description: oneLine(first(tags, 'og:description') || description, 300),
                image
            }
        }
    };
}

type Measured = { status: 'loaded'; width: number; height: number } | { status: 'failed' } | { status: 'blocked' } | { status: 'timeout' };

/** How long the shared image may take to load */
const imageTimeout = 10_000;

/**
 * Loads an image without adding it to the page (no referrer, decoded off the main thread) and
 * measures it. An image the page's Content-Security-Policy blocks is told apart from one that does not
 * load by the `securitypolicyviolation` event, which can come a moment after the error.
 */
function measureImage(address: string, signal: AbortSignal): Promise<Measured> {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const image = new Image();
        let blocked = false;
        let errorTimer: number | undefined;
        const onViolation = (event: SecurityPolicyViolationEvent) => {
            if (event.effectiveDirective === 'img-src' && event.blockedURI && address.startsWith(event.blockedURI)) blocked = true;
        };
        const end = () => {
            window.clearTimeout(timer);
            window.clearTimeout(errorTimer);
            document.removeEventListener('securitypolicyviolation', onViolation, true);
            signal.removeEventListener('abort', abort);
            image.onload = image.onerror = null;
            // Stops a download still running
            image.removeAttribute('src');
        };
        const done = (result: Measured) => {
            end();
            resolve(result);
        };
        const abort = () => {
            end();
            reject(signal.reason);
        };
        const timer = window.setTimeout(() => done({ status: 'timeout' }), imageTimeout);
        document.addEventListener('securitypolicyviolation', onViolation, true);
        signal.addEventListener('abort', abort, { once: true });
        image.onload = () => done({ status: 'loaded', width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => {
            errorTimer = window.setTimeout(() => done(blocked ? { status: 'blocked' } : { status: 'failed' }), 150);
        };
        image.referrerPolicy = 'no-referrer';
        image.decoding = 'async';
        image.src = address;
    });
}

/** The common size of a large link card (Facebook's sharing guide), and the smallest image it allows */
const large = { width: 1200, height: 630 };
const smallest = 200;

const declaredSize = (tags: Tags) => {
    const [width, height] = ['og:image:width', 'og:image:height'].map(name => Number.parseInt(first(tags, name) ?? '', 10));
    return width && height ? { width, height } : undefined;
};

/**
 * Loads the shared image (a request, so when the panel opens) and says whether it loads and its
 * real size, compared with 1200 × 630, the common size of a large link card. Nothing without an image.
 */
export async function checkSharingImage(context: SectionContext): Promise<SectionReport | undefined> {
    const tags = readTags();
    const image = sharedImage(tags);
    if (!image?.url) return undefined;
    const id = 'share-image-size';
    const result = await measureImage(image.url.href, context.signal);
    // After the image loaded: in the language the toolbar has now
    const t = words().sharing;
    const label = t.imageSize;
    const value = oneLine(writtenAddress(image.value), 300);
    if (result.status === 'blocked') return { checks: [pageCheck(id, label, 'none', t.blocked)] };
    if (result.status === 'timeout') return { checks: [pageCheck(id, label, 'none', t.timeout(imageTimeout / 1000))] };
    if (result.status === 'failed') {
        return {
            checks: [pageCheck(id, label, 'warn', t.failed, {
                issues: [pageIssue(context.path, { type: 'seo', id }, undefined, t.failedSummary,
                    `${t.failedComment(image.tag)}${foundLine(image.tag, value)}`)]
            })]
        };
    }
    const { width, height } = result;
    const measure = `${width} × ${height}`;
    if (width < smallest || height < smallest) {
        return {
            checks: [pageCheck(id, label, 'warn', t.tooSmall(smallest), {
                measure, issues: [pageIssue(context.path, { type: 'seo', id }, undefined, t.tooSmallSummary,
                    `${t.tooSmallComment(image.tag, measure, smallest)}${foundLine(image.tag, value)}`)]
            })]
        };
    }
    const ratio = width / height;
    const notes = [
        width < large.width || height < large.height ? t.underLarge(large.width, large.height) : '',
        Math.abs(ratio / 1.91 - 1) > 0.15 ? t.shape(Math.round(ratio * 100) / 100) : ''
    ];
    const declared = declaredSize(tags);
    if (declared && (declared.width !== width || declared.height !== height)) notes.push(t.declared(declared.width, declared.height));
    const reason = notes.filter(Boolean).join(' ');
    return { checks: [pageCheck(id, label, reason ? 'none' : 'pass', reason || t.large(large.width, large.height), { measure })] };
}
