import { foundLine, isRendered, isToolbarNode, oneLine, writtenAddress } from '../pageElements';
import type { CheckState, PageCheck, PageIssue } from '../types';
import { words } from './locale';
import { pageCheck, pageIssue, type SectionContext, type SectionReport } from './api';

// More of the SEO panel's own Page, Links and Images sections (packages/toolbar/docs/page-checks-seo-page.md):
// the hreflang tags, how this page's images load and weigh, and the links to this site that answer
// with an error. Plain data and page elements only: `sections/pageExtras.tsx` shows the rows in the
// panel's sections.

const seo = (id: string) => ({ type: 'seo' as const, id });

/**
 * A check of the elements it found: `pass` without any, else `state` with them as its issues. Its
 * reason says how many, then the line they share (`shared`, said once instead of on every row, like
 * `sharedSummary` in `ChecksParts.tsx`), then `after`.
 */
function listed(id: string, label: string, issues: PageIssue[],
    { pass = '', found, after, shared = true }: { pass?: string; found: (n: number) => string; after?: string; shared?: boolean },
    state: CheckState = 'warn'): PageCheck {
    if (!issues.length) return pageCheck(id, label, 'pass', pass);
    const alike = issues.every(item => item.summary === issues[0]!.summary);
    return pageCheck(id, label, state, `${found(issues.length)}${shared && alike ? ` ${issues[0]!.summary}` : ''}${after ? ` ${after}` : ''}`, { issues });
}

function parse(href: string | null | undefined) {
    try { return href?.trim() ? new URL(href.trim(), document.baseURI) : undefined; } catch { return undefined; }
}

// hreflang

/** A language, optionally with a script and a region (`en`, `zh-Hant-TW`, `es-419`), or `x-default` */
const hreflangValue = /^(?:x-default|[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?)$/i;
const withoutTrailingSlash = (path: string) => path.length > 1 ? path.replace(/\/+$/, '') : path;
/** An address without its hash and trailing slash, to compare pages; `query` keeps the query */
const pageKey = (url: URL, query = false) => `${url.origin}${withoutTrailingSlash(url.pathname)}${query ? url.search : ''}`;
/** A tag as a comment names it: its value and address as written (without a query) */
const tagText = (tag: Element) => `hreflang="${oneLine(tag.getAttribute('hreflang'), 40)}" href="${oneLine(writtenAddress(tag.getAttribute('href')), 120)}"`;
const quoted = (values: string[]) => {
    const shown = values.slice(0, 3).map(value => `"${oneLine(value, 40)}"`).join(', ');
    return values.length > 3 ? words().pageExtras.more(shown, values.length - 3) : shown;
};
/** The comment's lines naming the tags, as many as fit in `room` characters */
function tagLines(tags: Element[], room: number) {
    let lines = '';
    for (const tag of tags) {
        const line = foundLine(words().found.tag, tagText(tag), 260);
        if (lines.length + line.length > room) break;
        lines += line;
    }
    return lines;
}

/**
 * The page's `link rel="alternate" hreflang` tags, when it has some: valid values, absolute
 * addresses, one tag per value, and this page among them (with a canonical link to another page,
 * the canonical address). Each kind of problem is one issue about the page naming its tags.
 */
export function checkHreflang({ path }: SectionContext): SectionReport | undefined {
    const tags = [...document.querySelectorAll('link[rel~="alternate" i][hreflang]')].filter(tag => !isToolbarNode(tag));
    if (!tags.length) return undefined;
    const t = words().pageExtras;
    const issues: PageIssue[] = [];
    const add = (id: string, found: Element[], summary: string, sentence: string) => {
        const comment = t.seo(sentence);
        issues.push(pageIssue(path, seo(id), undefined, summary, `${comment}${tagLines(found, 990 - comment.length)}`));
    };
    const tagsHave = t.tagsHave;

    // `UK` is not a region code: the United Kingdom is `GB`
    const invalid = tags.filter(tag => !hreflangValue.test(tag.getAttribute('hreflang')?.trim() ?? '') || /-uk$/i.test(tag.getAttribute('hreflang')?.trim() ?? ''));
    if (invalid.length) {
        add('hreflang-value', invalid, t.invalidSummary(quoted(invalid.map(tag => tag.getAttribute('hreflang') ?? ''))),
            t.invalidSentence(tagsHave(invalid.length)));
    }
    const relative = tags.filter(tag => !/^https?:\/\//i.test(tag.getAttribute('href')?.trim() ?? '') || !parse(tag.getAttribute('href')));
    if (relative.length) {
        add('hreflang-address', relative, t.relativeSummary(quoted(relative.map(tag => writtenAddress(tag.getAttribute('href')) || t.none))),
            t.relativeSentence(tagsHave(relative.length)));
    }
    const byValue = new Map<string, Element[]>();
    for (const tag of tags) {
        const value = tag.getAttribute('hreflang')?.trim().toLowerCase() ?? '';
        byValue.set(value, [...byValue.get(value) ?? [], tag]);
    }
    const repeated = [...byValue].filter(([, list]) => list.length > 1);
    if (repeated.length) {
        const values = quoted(repeated.map(([value]) => value));
        add('hreflang-duplicate', repeated.flatMap(([, list]) => list), t.duplicateSummary(values),
            t.duplicateSentence(values));
    }

    // This page is among them; with a canonical link to another page, that page is
    const addresses = tags.flatMap(tag => parse(tag.getAttribute('href')) ?? []);
    const canonicals = [...document.querySelectorAll('link[rel~="canonical" i]')];
    const canonical = canonicals.length === 1 ? parse(canonicals[0]!.getAttribute('href')) : undefined;
    const here = new URL(window.location.href);
    const elsewhere = canonical && /^https?:$/.test(canonical.protocol) && pageKey(canonical) !== pageKey(here) ? canonical : undefined;
    if (elsewhere && !addresses.some(url => pageKey(url, true) === pageKey(elsewhere, true))) {
        add('hreflang-canonical', [], t.canonicalSummary(writtenAddress(elsewhere.href)),
            t.canonicalSentence(writtenAddress(elsewhere.href)));
    } else if (!elsewhere && !addresses.some(url => pageKey(url) === pageKey(here))) {
        add('hreflang-self', [], t.selfSummary, t.selfSentence(tags.length));
    }

    const value = [...byValue.keys()].map(item => item || t.noValue).join(', ');
    return {
        checks: [issues.length
            ? pageCheck('hreflang', t.versions, 'warn', issues.length === 1 ? issues[0]!.summary : t.problems(issues.length), { value, issues })
            : pageCheck('hreflang', t.versions, 'pass', t.hreflangOk(tags.length, Boolean(elsewhere)), { value })]
    };
}

// Images

/** Over this, an image's file is heavy (its bytes as transferred, without headers) */
export const heavyImageBytes = 500_000;
/** Shown at least this large (CSS pixels), an image far below the first window is worth loading lazily */
const largeImageArea = 200 * 200;
/** An oversized file has at least this many more pixels than the screen needs */
const extraPixels = 250_000;

const sizeText = (bytes: number) => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
const imageLine = (image: HTMLImageElement) => foundLine(words().found.image, writtenAddress(image.getAttribute('src') || image.currentSrc));
const isVector = (address: string) => /\.svg(?:[?#]|$)/i.test(address) || /^data:image\/svg/i.test(address);
const hasNumber = (image: HTMLImageElement, name: string) => /^\s*\d/.test(image.getAttribute(name) ?? '');

/**
 * The image file's own pixels. `naturalWidth` is corrected by the density of a `srcset` candidate, so
 * the chosen candidate's `w` (its width as the page states it) or `x` descriptor gives them back.
 */
function filePixels(image: HTMLImageElement) {
    const picture = image.parentElement instanceof HTMLPictureElement ? [...image.parentElement.querySelectorAll('source[srcset]')] : [];
    for (const set of [image.getAttribute('srcset'), ...picture.map(source => source.getAttribute('srcset'))]) {
        for (const candidate of (set ?? '').split(/,\s+/)) {
            const [address, descriptor = ''] = candidate.trim().split(/\s+/);
            if (!address || parse(address)?.href !== image.currentSrc) continue;
            const [, number, unit] = /^(\d+(?:\.\d+)?)([wx])$/.exec(descriptor) ?? [];
            if (unit === 'w') return { width: Number(number), height: Number(number) * image.naturalHeight / image.naturalWidth };
            if (unit === 'x') return { width: image.naturalWidth * Number(number), height: image.naturalHeight * Number(number) };
        }
    }
    return { width: image.naturalWidth, height: image.naturalHeight };
}

/**
 * The page's rendered `img` elements, read once (their boxes and computed styles):
 * - dimensions: no `width` and `height` attributes and no CSS `aspect-ratio`, in the page's flow and,
 *   once loaded, shown at the file's own proportions (else CSS sizes it);
 * - size: the file is more than twice as large as shown on this screen (times its pixel ratio) in both
 *   directions, and at least 250,000 pixels more; vector images are left out;
 * - loading: `loading="lazy"` on the largest contentful element (`largestPaint`) or in the first window
 *   (the top of the page, one window high); a note for large images from two windows down without it;
 * - weight: files over 500 KB, where the browser reports their size (`PerformanceResourceTiming`:
 *   this site's images and other sites' sent with `Timing-Allow-Origin`).
 */
export function checkImages({ path }: SectionContext, { largestPaint }: { largestPaint?: Element } = {}): SectionReport | undefined {
    const images = [...document.images].filter(image => isRendered(image) && !isToolbarNode(image));
    if (!images.length) return undefined;
    const ratio = window.devicePixelRatio || 1;
    const windowHeight = window.innerHeight;
    const timings = new Map((performance.getEntriesByType?.('resource') ?? []).map(entry => [entry.name, entry as PerformanceResourceTiming]));
    const t = words().pageExtras;
    const unsized: PageIssue[] = [];
    const oversized: PageIssue[] = [];
    const lazy: PageIssue[] = [];
    const eager: PageIssue[] = [];
    const heavy: PageIssue[] = [];
    const files = new Set<string>();
    let measured = 0;

    for (const image of images) {
        const box = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        const top = box.top + window.scrollY;
        const loaded = image.complete && image.naturalWidth > 0;
        const address = image.currentSrc;

        const followsFile = !loaded || !box.width || !box.height
            || Math.abs(box.width / box.height / (image.naturalWidth / image.naturalHeight) - 1) < 0.02;
        if (!(hasNumber(image, 'width') && hasNumber(image, 'height')) && style.aspectRatio === 'auto' && !/^(?:absolute|fixed)$/.test(style.position)
            && followsFile && !(loaded && image.naturalWidth <= 1 && image.naturalHeight <= 1)) {
            unsized.push(pageIssue(path, seo('image-dimensions'), image, t.unsizedSummary, `${t.unsizedComment}${imageLine(image)}`));
        }

        if (loaded && box.width && box.height && !isVector(address)) {
            const file = filePixels(image);
            const needed = { width: box.width * ratio, height: box.height * ratio };
            if (file.width > 2 * needed.width && file.height > 2 * needed.height && file.width * file.height - needed.width * needed.height >= extraPixels) {
                const [width, height, shownWidth, shownHeight] = [file.width, file.height, box.width, box.height].map(Math.round);
                const screen = ratio === 1 ? '' : t.screenRatio(Math.round(needed.width), Math.round(needed.height), ratio);
                oversized.push(pageIssue(path, seo('image-size'), image, t.oversizedSummary(width!, height!, shownWidth!, shownHeight!),
                    `${t.oversizedComment(width!, height!, shownWidth!, shownHeight!, screen)}${imageLine(image)}`));
            }
        }

        const isLazy = image.getAttribute('loading')?.trim().toLowerCase() === 'lazy';
        const largest = image === largestPaint;
        if (isLazy && (largest || (top < windowHeight && top + box.height > 0))) {
            lazy.push(pageIssue(path, seo('image-loading'), image, largest ? t.largestSummary : t.firstWindowSummary,
                `${t.lazyComment(largest)}${imageLine(image)}`));
        } else if (!isLazy && !largest && top >= 2 * windowHeight && box.width * box.height >= largeImageArea) {
            eager.push(pageIssue(path, seo('image-offscreen'), image, t.offscreenSummary, `${t.offscreenComment}${imageLine(image)}`));
        }

        // Each file once: the browser reports a file's size for this site's images and those sent with Timing-Allow-Origin
        if (!/^https?:/i.test(address) || files.has(address)) continue;
        files.add(address);
        const bytes = timings.get(address)?.encodedBodySize ?? 0;
        if (bytes > 0) measured++;
        if (bytes > heavyImageBytes) {
            heavy.push(pageIssue(path, seo('image-weight'), image, `${sizeText(bytes)}.`,
                `${t.heavyComment(sizeText(bytes), sizeText(heavyImageBytes))}${imageLine(image)}`));
        }
    }

    const onScreen = ratio === 1 ? '' : t.onScreen(ratio);
    const weight = !files.size ? []
        : !measured ? [pageCheck('image-weight', t.weight, 'none', t.weightUnknown)]
            : [listed('image-weight', t.weight, heavy, {
                pass: t.weightOk(measured === files.size, measured, files.size, sizeText(heavyImageBytes)),
                found: n => t.heavy(n, sizeText(heavyImageBytes))
            })];
    return {
        checks: [
            listed('image-dimensions', t.dimensions, unsized, {
                pass: t.dimensionsOk,
                found: t.unsized,
                shared: false,
                after: t.shifts(unsized.length)
            }),
            listed('image-size', t.size, oversized, {
                pass: t.sizeOk(onScreen),
                found: n => t.oversized(n, onScreen)
            }),
            listed('image-loading', t.lazy, lazy, {
                pass: t.lazyOk,
                found: t.lazyFound,
                after: t.delays
            }),
            ...eager.length ? [listed('image-offscreen', t.below, eager, {
                found: t.belowFound,
                shared: false,
                after: t.belowAfter
            }, 'none')] : [],
            ...weight
        ]
    };
}

// Links that do not answer

/** Addresses requested at most, a few at a time, each given `linkTimeout` ms */
export const linkLimit = 100;
const linkConcurrency = 4;
const linkTimeout = 10_000;

/**
 * Addresses that look like they do something instead of showing a page (sign out, delete,
 * unsubscribe, add to cart, confirm with a token): never requested, a link check changes nothing
 */
const actionAddress = /(?:^|[^a-z0-9])(?:log[-_]?out|sign[-_]?out|log[-_]?off|sign[-_]?off|delete|remove|destroy|unsubscribe|subscribe|cancel|revoke|deactivate|activate|disable|trash|purge|reset|add[-_]?to[-_]?cart|empty[-_]?cart|confirm|approve|reject|accept|decline|unfollow|unlike|vote|toggle|verify|(?:wp[-_]?)?nonce|csrf|token)(?:$|[^a-z0-9])/i;

/** How far Check links got: addresses answered of those to request, and whether Stop or the site's CSP ended it */
export type LinkStatusDetails = { checked: number; total: number; stopped: boolean; blocked: boolean };
export type LinkStatusOptions = {
    /** Stops the check: what was checked so far is the report */
    stop?: AbortSignal;
    /** After each address: how many of how many */
    onProgress?: (checked: number, total: number) => void;
};

type Answer = { status: number } | { redirect: true } | { timeout: true } | { failed: true };

const isError = (status: number) => status === 404 || status === 410 || status >= 500;

/** One address's answer: `HEAD`, then `GET` when the server refuses `HEAD` or answers it with an error (some answer `HEAD` differently) */
async function answer(address: string, signal: AbortSignal): Promise<Answer> {
    const ask = async (method: 'HEAD' | 'GET') => {
        const response = await fetch(address, {
            method, mode: 'same-origin', credentials: 'same-origin', redirect: 'manual', cache: 'no-store',
            signal: AbortSignal.any([signal, AbortSignal.timeout(linkTimeout)])
        });
        // Only the status counts: the page itself is not downloaded
        void response.body?.cancel().catch(() => { });
        return response;
    };
    try {
        let response = await ask('HEAD');
        if (response.status === 405 || response.status === 501 || isError(response.status)) response = await ask('GET');
        return response.type === 'opaqueredirect' ? { redirect: true } : { status: response.status };
    } catch (error) {
        if (signal.aborted) throw signal.reason;
        return error instanceof DOMException && error.name === 'TimeoutError' ? { timeout: true } : { failed: true };
    }
}

/**
 * Requests this page's links to its own site and reports the ones that answer with an error: only
 * same-origin `http(s)` addresses, without their hash, each once, in the page's order, at most
 * `linkLimit`, a few at a time, with the reviewer's session (same-origin credentials), without
 * following redirects. Never links that look like actions (`actionAddress`), `download` links or
 * links a script sends with another method (`data-method`). Stopped (`stop`), it reports what it
 * checked; cancelled (`context.signal`), it throws.
 */
export async function checkLinkStatus({ path, signal }: SectionContext, { stop, onProgress }: LinkStatusOptions = {}): Promise<SectionReport<LinkStatusDetails>> {
    const links = [...document.querySelectorAll<HTMLAnchorElement | HTMLAreaElement>('a[href], area[href]')].filter(link => !isToolbarNode(link));
    const byAddress = new Map<string, Element[]>();
    let otherSites = 0;
    let actions = 0;
    let notWeb = 0;
    for (const link of links) {
        const url = parse(link.getAttribute('href'));
        if (!url || !/^https?:$/.test(url.protocol)) {
            notWeb++;
            continue;
        }
        if (url.origin !== window.location.origin) {
            otherSites++;
            continue;
        }
        let written = `${url.pathname}${url.search}`;
        try { written = decodeURIComponent(written); } catch { /* Kept as written. */ }
        const method = (link.getAttribute('data-method') ?? link.getAttribute('data-turbo-method') ?? 'get').trim().toLowerCase();
        if (link.hasAttribute('download') || method !== 'get' || actionAddress.test(written)) {
            actions++;
            continue;
        }
        url.hash = '';
        byAddress.set(url.href, [...byAddress.get(url.href) ?? [], link]);
    }
    const addresses = [...byAddress.keys()].slice(0, linkLimit);
    const total = addresses.length;

    // A site's CSP without its own origin in `connect-src` blocks every request: one note, not errors
    let blocked = false;
    const onViolation = (event: SecurityPolicyViolationEvent) => {
        if (/^(?:connect|default)-src/.test(event.effectiveDirective || event.violatedDirective)) blocked = true;
    };
    const ended = new AbortController();
    const requests = AbortSignal.any([signal, ended.signal, ...stop ? [stop] : []]);
    const answers = new Map<string, Answer>();
    document.addEventListener('securitypolicyviolation', onViolation);
    try {
        onProgress?.(0, total);
        let next = 0;
        const worker = async () => {
            while (next < total && !requests.aborted) {
                const address = addresses[next++]!;
                let result: Answer;
                try { result = await answer(address, requests); } catch (error) {
                    if (signal.aborted) throw error;
                    return; // Stopped, or blocked: the rest is not requested
                }
                if ('failed' in result) {
                    // The violation's event comes in a task of its own
                    await new Promise(resolve => window.setTimeout(resolve, 50));
                    if (blocked) ended.abort();
                }
                if (requests.aborted) return;
                answers.set(address, result);
                onProgress?.(answers.size, total);
            }
        };
        await Promise.all(Array.from({ length: Math.min(linkConcurrency, total) }, worker));
        signal.throwIfAborted();
    } finally {
        ended.abort();
        document.removeEventListener('securitypolicyviolation', onViolation);
    }

    const stopped = !blocked && answers.size < total;
    const { pageExtras: t, found } = words();
    const linkText = (link: Element) => oneLine(link.textContent) || oneLine(link.getAttribute('aria-label')) || oneLine(link.getAttribute('title'));
    /** An issue on every link of each address whose answer `said` names: its summary and the comment's sentence */
    const issuesOf = (id: string, said: (result: Answer) => { summary: string; sentence: string } | undefined) =>
        [...answers].flatMap(([address, result]) => {
            const words = said(result);
            return words === undefined ? [] : byAddress.get(address)!.map(link => pageIssue(path, seo(id), link, `${words.summary}.`,
                `${t.seo(words.sentence)}${foundLine(found.linkText, linkText(link))}${foundLine(found.address, writtenAddress(link.getAttribute('href')))}`));
        });
    const status = (test: (status: number) => boolean, sentence: (answered: string) => string = answered => answered) => (result: Answer) =>
        'status' in result && test(result.status)
            ? { summary: t.answers(result.status), sentence: sentence(t.answeredWith(result.status, t.statusNames[result.status])) }
            : undefined;

    const errors = issuesOf('link-status', status(isError));
    const access = issuesOf('link-access', status(code => code === 401 || code === 403, t.signIn));
    const redirects = issuesOf('link-redirect', result => 'redirect' in result ? { summary: t.redirectsSummary, sentence: t.redirectsSentence } : undefined);
    const silent = issuesOf('link-no-answer', result => 'timeout' in result ? { summary: t.noAnswerSummary(linkTimeout / 1000), sentence: t.noAnswerSentence(linkTimeout / 1000) }
        : 'failed' in result ? { summary: t.failedSummary, sentence: t.failedSentence } : undefined);
    const notRequested = [
        otherSites && t.otherSites(otherSites),
        actions && t.actions(actions),
        notWeb && t.notWeb(notWeb)
    ].filter(Boolean);

    const checked = stopped ? t.stoppedAfter(answers.size, total)
        : byAddress.size > total ? t.firstOf(total, byAddress.size)
            : t.checkedAll(total);
    const result = blocked
        ? pageCheck('link-status', t.status, 'none', t.blocked)
        : !total ? pageCheck('link-status', t.status, 'none', t.noLinks)
            : { ...listed('link-status', t.status, errors, {
                pass: stopped ? t.noneFailed : t.allAnswered,
                found: t.errors
            }), value: checked };
    return {
        checks: blocked ? [result] : [
            result,
            ...access.length ? [listed('link-access', t.access, access, { found: t.accessFound }, 'none')] : [],
            ...redirects.length ? [listed('link-redirect', t.redirects, redirects, {
                found: t.redirectsFound, shared: false
            }, 'none')] : [],
            ...silent.length ? [listed('link-no-answer', t.noAnswer, silent, { found: t.noAnswerFound }, 'none')] : [],
            ...notRequested.length ? [pageCheck('link-skipped', t.notRequested, 'none', `${notRequested.join(', ')}.`)] : []
        ],
        details: { checked: answers.size, total, stopped, blocked }
    };
}
