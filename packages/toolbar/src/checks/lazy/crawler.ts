import { foundLine, isToolbarNode, oneLine, writtenAddress } from '../pageElements';
import { nextIdle } from '../pageIdle';
import type { CheckState, PageCheck } from '../types';
import { pageCheck, pageIssue, type SectionContext, type SectionReport } from './api';
import {
    aiCrawlers, keepsOut, pageKey, parseRobots, robotsHeader, robotsVerdict, searchCrawlers, sitemapEntries, textLinks, textShare,
    type AiCrawlerUse, type RobotsFile, type RobotsRule
} from './crawlerRules';

// The SEO panel's Crawlers section (packages/toolbar/docs/page-checks-crawler.md): what a crawler gets
// from this page, which the document alone cannot tell. A few same-origin requests without cookies:
// the page itself (its status, X-Robots-Tag and the HTML the server sends, against the rendered
// page), robots.txt, the sitemap and llms.txt. The site's files are kept per origin in this module
// while the page is open; Check again requests them again.

/** One AI crawler's verdict, for the section's list */
export type AiCrawlerVerdict = { token: string; by: string; use: string; allowed: boolean; rule?: string };

export type CrawlerDetails = { ai?: AiCrawlerVerdict[] };

export type CrawlerReport = SectionReport<CrawlerDetails>;

const timeout = 10_000;
const pageLimit = 5 * 1024 * 1024;
/** RFC 9309 asks crawlers to read at least 500 KiB */
const robotsLimit = 500 * 1024;
const llmsLimit = 1024 * 1024;
/** Sitemaps read for an origin at most: files (an index counts) and bytes in all */
const sitemapFiles = 5;
const sitemapBytes = 5 * 1024 * 1024;

/** The served HTML's share of the page's text that passes, and under which a page with enough text is worth a look */
const textPass = 0.9;
const textWarn = 0.5;
const textMinimum = 200;
/** The share of the page's link addresses in the served HTML that passes */
const linksPass = 0.9;

const htmlAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const csp = 'the site\'s Content-Security-Policy blocks';
const engines = 'No search engine confirms using it.';
const withoutCookies = 'a request without cookies';
const protectedSite = 'Sites under review are often protected on purpose.';
const javascript = 'Crawlers that do not run JavaScript get only the served HTML.';

type Received = {
    kind: 'response';
    status: number;
    statusText: string;
    url: string;
    redirected: boolean;
    contentType: string;
    headers: Headers;
    bytes: Uint8Array<ArrayBuffer>;
    truncated: boolean;
};

/** What a request got: a response, or why there is none (the site's CSP, a redirect the browser cannot follow, no answer in time) */
type Answer = Received | { kind: 'blocked' } | { kind: 'away' } | { kind: 'timeout' } | { kind: 'failed' };

type CspWatch = { blocked: () => Promise<boolean>; stop: () => void };

type Requests = { signal: AbortSignal; csp: CspWatch };

/** A row's builder: its id (after `crawl-`) and label once, then its state, reason and the rest */
const row = (id: string, label: string) => (state: CheckState, reason: string, more?: Parameters<typeof pageCheck>[4]) =>
    pageCheck(`crawl-${id}`, label, state, reason, more);

/** A warning's one issue, about the page */
const seoIssue = (path: string, id: string, summary: string, comment: string) =>
    [pageIssue(path, { type: 'seo', id: `crawl-${id}` }, undefined, summary, comment)];

/**
 * Listens for the site's Content-Security-Policy blocking a request to its own origin
 * (`connect-src` without it) while the section's requests run. The report is its own task, maybe
 * after the request failed, so `blocked` waits for it a moment.
 */
function watchCsp(): CspWatch {
    let seen = false;
    const waiting = new Set<() => void>();
    const listener = (event: SecurityPolicyViolationEvent) => {
        if (event.disposition !== 'enforce' || !event.effectiveDirective.startsWith('connect-src')) return;
        try {
            if (new URL(event.blockedURI).origin !== window.location.origin) return;
        } catch {
            return;
        }
        seen = true;
        for (const done of waiting) done();
    };
    document.addEventListener('securitypolicyviolation', listener);
    return {
        blocked: () => new Promise<boolean>(resolve => {
            const done = () => {
                window.clearTimeout(timer);
                waiting.delete(done);
                resolve(seen);
            };
            const timer = window.setTimeout(done, seen ? 0 : 200);
            waiting.add(done);
        }),
        stop: () => document.removeEventListener('securitypolicyviolation', listener)
    };
}

/** A stream's bytes, at most `limit` of them */
async function readBytes(stream: ReadableStream<Uint8Array> | null, limit: number) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    const reader = stream?.getReader();
    while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.byteLength > limit) {
            chunks.push(value.subarray(0, limit - size));
            size = limit;
            truncated = true;
            void reader.cancel().catch(() => undefined);
            break;
        }
        chunks.push(value);
        size += value.byteLength;
    }
    const bytes = new Uint8Array(new ArrayBuffer(size));
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return { bytes, truncated };
}

const anonymous = { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' } as const;

/**
 * One same-origin GET the way an anonymous crawler asks: no cookies, no cache, no referrer, redirects
 * followed, at most `timeout` ms and `limit` bytes. Throws only when the section's check is cancelled.
 */
async function request(url: string, limit: number, { signal, csp }: Requests, accept = '*/*'): Promise<Answer> {
    const timer = AbortSignal.timeout(timeout);
    try {
        const response = await fetch(url, { ...anonymous, headers: { Accept: accept }, signal: AbortSignal.any([signal, timer]) });
        const { bytes, truncated } = await readBytes(response.body, limit);
        return {
            kind: 'response', status: response.status, statusText: response.statusText, url: response.url, redirected: response.redirected,
            contentType: response.headers.get('content-type') ?? '', headers: response.headers, bytes, truncated
        };
    } catch {
        signal.throwIfAborted();
        if (timer.aborted) return { kind: 'timeout' };
        if (await csp.blocked()) return { kind: 'blocked' };
        // A redirect the browser could not follow (to another site): asked again without following it
        try {
            const response = await fetch(url, { ...anonymous, redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) });
            if (response.type === 'opaqueredirect') return { kind: 'away' };
        } catch {
            signal.throwIfAborted();
        }
        return { kind: 'failed' };
    }
}

const ok = (answer: Answer): answer is Received => answer.kind === 'response' && answer.status >= 200 && answer.status < 300;

function decode(answer: Received) {
    try {
        return new TextDecoder(/charset=["']?([\w-]+)/i.exec(answer.contentType)?.[1] || 'utf-8').decode(answer.bytes);
    } catch {
        return new TextDecoder().decode(answer.bytes);
    }
}

/** A text file that is an HTML page instead (a single-page app's server answers every address with it) */
const isHtml = (answer: Received, text: string) => /html/i.test(answer.contentType) || /^\s*<(!doctype html|html)[\s>]/i.test(text);

/** `404 Not Found` (its reason phrase as sent: none over HTTP/2) */
const statusLine = (answer: Received) => `${answer.status} ${oneLine(answer.statusText, 40)}`.trim();

/** What a request for a file got, after "robots.txt ...": "answers 503 Service Unavailable" */
function answered(answer: Answer) {
    return answer.kind === 'response' ? `answers ${statusLine(answer)}`
        : answer.kind === 'timeout' ? 'did not answer within 10 seconds'
            : answer.kind === 'away' ? 'redirects where the browser cannot follow'
                : answer.kind === 'blocked' ? 'is blocked by the site\'s Content-Security-Policy' : 'could not be requested';
}

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const percent = (share: number) => `${Math.floor(share * 100)}%`;
const names = (list: readonly string[]) => list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
const requested = (address: string) => foundLine('Requested without cookies', `GET ${writtenAddress(address)}`);
const pathOf = (address: string) => new URL(address).pathname;

// The site's files, kept per origin while the page is open. Another page of the site reuses them; a
// page checked again (Check again) reads them again.
type SitemapFile = { url: string; what: string };

type Sitemaps = {
    /** robots.txt names sitemaps; else /sitemap.xml is tried */
    named: boolean;
    /** robots.txt was read (it may name none) */
    robotsRead: boolean;
    queue: string[];
    queued: Set<string>;
    read: SitemapFile[];
    /** Every page address read (`pageKey`), with the file that lists it */
    listed: Map<string, string>;
    bytes: number;
    truncated: boolean;
    /** Sitemaps on another origin: not read */
    elsewhere: string[];
    failed: SitemapFile[];
    /** /sitemap.xml (not named) is not there */
    missing: boolean;
    lock: Promise<unknown>;
};

type SiteFiles = { paths: Set<string>; robots?: Promise<Answer>; llms?: Promise<Answer>; sitemaps?: Sitemaps };

const sites = new Map<string, SiteFiles>();

function siteFiles(origin: string, path: string) {
    let files = sites.get(origin);
    if (!files || files.paths.has(path)) sites.set(origin, files = { paths: new Set() });
    files.paths.add(path);
    return files;
}

/** A file's answer from this origin's memory, else (also when that request ended without a response) a new request */
async function shared(files: SiteFiles, key: 'robots' | 'llms', load: () => Promise<Answer>, signal: AbortSignal): Promise<Answer> {
    try {
        const answer = await files[key];
        if (answer?.kind === 'response') return answer;
    } catch (error) {
        // Kept from a check that was cancelled: this one asks again
        if (signal.aborted) throw error;
    }
    if (key === 'robots') files.sitemaps = undefined;
    return files[key] = load();
}

function sitemapsOf(file: RobotsFile | undefined): Sitemaps {
    const origin = window.location.origin;
    const queue: string[] = [];
    const elsewhere: string[] = [];
    for (const line of file?.sitemaps ?? []) {
        try {
            const url = new URL(line, `${origin}/robots.txt`);
            if (url.origin !== origin) elsewhere.push(url.href);
            else if (!queue.includes(url.href)) queue.push(url.href);
        } catch { /* Not an address. */ }
    }
    const named = Boolean(file?.sitemaps.length);
    if (!named) queue.push(`${origin}/sitemap.xml`);
    return {
        named, robotsRead: Boolean(file), queue, queued: new Set(queue), read: [], listed: new Map(), bytes: 0, truncated: false,
        elsewhere, failed: [], missing: false, lock: Promise.resolve()
    };
}

async function readSitemap(state: Sitemaps, url: string, answer: Answer) {
    const what = (text: string) => ({ url, what: text });
    // Not there: /sitemap.xml tried because robots.txt names none is no sitemap; a named one is a gap
    const absent = answer.kind === 'response' && answer.status >= 400 && answer.status < 500;
    if (!ok(answer)) {
        if (!state.named && absent) state.missing = true;
        else state.failed.push(what(answered(answer)));
        return;
    }
    state.bytes += answer.bytes.byteLength;
    let text = decode(answer);
    let { truncated } = answer;
    // A gzip file (`sitemap.xml.gz`) unpacked
    if (answer.bytes[0] === 0x1f && answer.bytes[1] === 0x8b) {
        try {
            const unpacked = await readBytes(new Blob([answer.bytes]).stream().pipeThrough(new DecompressionStream('gzip')), sitemapBytes);
            text = new TextDecoder().decode(unpacked.bytes);
            truncated ||= unpacked.truncated;
        } catch {
            state.failed.push(what('could not be unpacked'));
            return;
        }
    }
    if (isHtml(answer, text)) {
        if (state.named) state.failed.push(what('is an HTML page'));
        else state.missing = true;
        return;
    }
    state.truncated ||= truncated;
    const { index, locations } = sitemapEntries(text);
    for (const location of locations) {
        if (index) {
            let next: URL;
            try { next = new URL(location, answer.url); } catch { continue; }
            if (next.origin !== window.location.origin) state.elsewhere.push(next.href);
            else if (!state.queued.has(next.href)) {
                state.queued.add(next.href);
                state.queue.push(next.href);
            }
        } else {
            const key = pageKey(location, answer.url);
            if (key && !state.listed.has(key)) state.listed.set(key, url);
        }
    }
    state.read.push(what(index ? `a sitemap index of ${count(locations.length, 'sitemap')}` : count(locations.length, 'address', 'addresses')));
}

/**
 * The sitemap file that lists the page (`pageKey`), reading more of the origin's sitemaps when it is
 * not among those read: one file at a time, an index's sitemaps after it, until it is found or the
 * bounds are reached. One reader at a time per origin.
 */
function findListed(state: Sitemaps, key: string, requests: Requests): Promise<string | undefined> {
    const find = state.lock.then(async () => {
        while (!state.listed.has(key) && state.queue.length && state.read.length + state.failed.length < sitemapFiles && state.bytes < sitemapBytes) {
            const url = state.queue[0]!;
            const answer = await request(url, sitemapBytes - state.bytes, requests);
            state.queue.shift();
            await readSitemap(state, url, answer);
        }
        return state.listed.get(key);
    });
    state.lock = find.catch(() => undefined);
    return find;
}

/** What a page tells crawlers, read from a document: the live page or the HTML the server sends */
type PageFacts = {
    title?: string;
    description?: string;
    canonical?: string;
    /** The robots and googlebot meta tags, `robots: noindex` */
    robots?: string;
    noindex: boolean;
    h1: string[];
    links: Set<string>;
    text: string;
};

const skipped = new Set(['script', 'style', 'noscript', 'template']);

/** A document's text, as `textContent` without scripts, styles, `noscript`, templates and the toolbar */
function pageText(root: Element | null) {
    if (!root) return '';
    const parts: string[] = [];
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: node => !(node instanceof Element) ? NodeFilter.FILTER_ACCEPT
            : skipped.has(node.localName) || node.hasAttribute('data-uier-thread') || (node.id === 'uier-toolbar' && isToolbarNode(node))
                ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.nodeValue ?? '');
    return parts.join('');
}

function pageFacts(doc: Document, base: string): PageFacts {
    const resolve = (href: string | null | undefined) => {
        const value = href?.trim();
        if (!value) return undefined;
        try { return new URL(value, base).href; } catch { return value; }
    };
    const robotsTags = [...doc.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]')].map(tag => ({
        name: (tag.getAttribute('name') ?? '').toLowerCase(),
        directives: (tag.getAttribute('content') ?? '').toLowerCase().split(',').map(directive => directive.trim()).filter(Boolean)
    }));
    const links = new Set<string>();
    for (const link of doc.querySelectorAll('a[href], area[href]')) {
        const href = resolve(link.getAttribute('href'));
        if (href && /^https?:/i.test(href)) links.add(href);
    }
    return {
        title: oneLine(doc.title, 1000) || undefined,
        description: oneLine(doc.querySelector('meta[name="description" i]')?.getAttribute('content'), 1000) || undefined,
        canonical: resolve(doc.querySelector('link[rel~="canonical" i]')?.getAttribute('href')),
        robots: robotsTags.map(tag => `${tag.name}: ${tag.directives.join(', ')}`).join('; ') || undefined,
        noindex: robotsTags.some(tag => keepsOut(tag.directives)),
        h1: [...doc.querySelectorAll('h1')].map(heading => oneLine(heading.textContent, 1000)),
        links,
        text: pageText(doc.body)
    };
}

/** The rows comparing the HTML the server sends with the rendered page */
function servedChecks(live: PageFacts, served: PageFacts, page: Received, path: string, address: string): PageCheck[] {
    const sent = `${requested(address)}${foundLine('Answer', statusLine(page))}`;

    const h1 = row('served-h1', 'Served h1');
    const firstH1 = live.h1.find(Boolean) ?? live.h1[0];
    const h1Check = firstH1 === undefined ? h1('none', 'No h1 on the page.')
        : served.h1.includes(firstH1) ? h1('pass', 'The server sends the h1.', { value: firstH1 || undefined })
            : served.h1.length ? h1('none', 'The h1 is changed by JavaScript.', { value: `Served: ${served.h1[0] || 'an empty h1'}` })
                : h1('warn', `The h1 is added by JavaScript. ${javascript}`, {
                    value: firstH1 || undefined,
                    issues: seoIssue(path, 'served-h1', 'The h1 is added by JavaScript.',
                        `SEO: The h1 is added by JavaScript: the HTML the server sends has none. ${javascript}${sent}${foundLine('h1 on the page', firstH1)}`)
                });

    const text = row('served-text', 'Served text');
    const share = textShare(live.text, served.text);
    const measure = percent(share.share);
    const cut = page.truncated ? ' (its first 5 MB)' : '';
    const measured = `The server sends ${measure} of the page's text${cut}.`;
    const textCheck = !share.characters ? text('none', 'No text on the page.')
        : share.share >= textPass ? text('pass', measured, { measure })
            : share.share < textWarn && share.characters >= textMinimum
                ? text('warn', `${measured} The rest is added by JavaScript.`, {
                    measure,
                    issues: seoIssue(path, 'served-text', 'Most of the text is added by JavaScript.',
                        `SEO: The HTML the server sends has ${measure} of the page's text${cut}; the rest is added by JavaScript. ${javascript}${sent}${foundLine('Measured', `${share.found.toLocaleString('en-US')} of ${count(share.characters, 'character')} of the page's text are in the served HTML`)}`)
                })
                : text('none', measured, { measure });

    const parts = [
        { name: 'title', page: live.title, served: served.title },
        { name: 'meta description', page: live.description, served: served.description },
        { name: 'canonical link', page: live.canonical, served: served.canonical },
        { name: 'robots meta tag', page: live.robots, served: served.robots }
    ];
    const differences = [
        { verb: 'added', list: parts.filter(part => part.page && !part.served) },
        { verb: 'changed', list: parts.filter(part => part.page && part.served && part.page !== part.served) },
        { verb: 'removed', list: parts.filter(part => !part.page && part.served) }
    ].filter(({ list }) => list.length);
    const different = differences.flatMap(({ list }) => list);
    const present = parts.filter(part => part.page);
    const head = row('served-head', 'Served head');
    const headCheck = different.length
        ? head('none', differences.map(({ verb, list }) => `The ${names(list.map(part => part.name))} ${list.length > 1 ? 'are' : 'is'} ${verb} by JavaScript.`).join(' '),
            { value: different.length === 1 && different[0]!.served ? `Served: ${oneLine(different[0]!.served)}` : undefined })
        : present.length ? head('pass', `The served HTML has the page's ${names(present.map(part => part.name))}.`)
            : head('none', 'No title, meta description, canonical link or robots meta tag.');

    const links = row('served-links', 'Served links');
    const pageLinks = [...live.links];
    const found = pageLinks.filter(link => served.links.has(link)).length;
    const linkCount = { measure: `${found} of ${pageLinks.length}` };
    const linksCheck = !pageLinks.length ? links('none', 'No links on the page.')
        : found === pageLinks.length ? links('pass', 'The server sends every link address of the page.', linkCount)
            : links(found / pageLinks.length >= linksPass ? 'pass' : 'none',
                `The server sends ${found} of the page's ${count(pageLinks.length, 'link address', 'link addresses')}. The others are added or changed by JavaScript.`, linkCount);

    return [h1Check, textCheck, headCheck, linksCheck];
}

/** The Response row: what a request without cookies for this page got */
function responseCheck(page: Answer, path: string, address: string, samePage: boolean): PageCheck {
    const status = row('status', 'Response');
    if (page.kind === 'timeout') return status('none', 'Not checked: no answer within 10 seconds.');
    if (page.kind === 'away') return status('none', `A request without cookies is redirected where the browser cannot follow it. ${protectedSite}`);
    if (page.kind !== 'response') return status('none', 'Not checked: the request failed.');
    const measure = String(page.status);
    if (page.status === 401 || page.status === 403) return status('none', `The server refuses ${withoutCookies}. ${protectedSite}`, { measure });
    if (page.redirected && !samePage) {
        return status('none', `A request without cookies is redirected to another page. ${protectedSite}`, { measure, value: writtenAddress(page.url) });
    }
    if (page.status >= 400) {
        return status('warn', `The server answers ${statusLine(page)} to ${withoutCookies}.`, {
            measure,
            issues: seoIssue(path, 'status', `The page answers ${page.status} to ${withoutCookies}.`,
                `SEO: A request for this page without cookies, like a crawler's, gets ${statusLine(page)} instead of the page.${requested(address)}${foundLine('Answer', statusLine(page))}`)
        });
    }
    if (!ok(page)) return status('none', `The server answers ${statusLine(page)}.`, { measure });
    if (page.redirected && page.url !== address) {
        return status('none', 'A request without cookies is redirected to this address first.', { measure, value: writtenAddress(page.url) });
    }
    return status('pass', `The server sends the page to ${withoutCookies}.`, { measure });
}

/** Who a header's noindex is for: "search engines", "Google" or the crawlers it names; empty for nobody */
function noindexFor(rules: Map<string, string[]>) {
    const agents = [...rules].filter(([, directives]) => keepsOut(directives)).map(([agent]) => agent);
    return agents.includes('*') ? 'search engines' : names(agents.map(agent => agent === 'googlebot' ? 'Google' : agent === 'bingbot' ? 'Bing' : agent));
}

function headerCheck(page: Received, live: PageFacts): PageCheck {
    const header = row('x-robots-tag', 'X-Robots-Tag');
    const value = page.headers.get('x-robots-tag');
    if (!value) return header('pass', 'Not sent: the response adds no indexing rules.');
    const who = noindexFor(robotsHeader(value));
    const shown = { value: oneLine(value) };
    if (!who) {
        return live.noindex ? header('none', 'No noindex in the header, but the robots meta tag has one.', shown)
            : header('pass', 'No noindex in the header.', shown);
    }
    return header('none', `The response asks ${who} not to index the page.${live.robots && !live.noindex ? ' The robots meta tag does not.' : ''}`, shown);
}

/** Why a robots.txt has no rules to evaluate, as the reason of its rows; nothing when it has */
function robotsUnread(robots: Answer, text: string | undefined): { state: CheckState; reason: string } | undefined {
    const anyCrawler = 'every crawler may read the site.';
    if (robots.kind === 'blocked') return { state: 'none', reason: `Not checked: ${csp} this request.` };
    if (robots.kind !== 'response') return { state: 'none', reason: `Not read: robots.txt ${answered(robots)}.` };
    if (robots.status === 404 || robots.status === 410) return { state: 'pass', reason: `No robots.txt: ${anyCrawler}` };
    if (robots.status >= 400 && robots.status < 500) return { state: 'none', reason: `robots.txt ${answered(robots)}, which counts as none: ${anyCrawler}` };
    if (robots.status >= 500) return { state: 'none', reason: `robots.txt ${answered(robots)}. RFC 9309 asks crawlers to treat every page as blocked then.` };
    if (!ok(robots)) return { state: 'none', reason: `Not read: robots.txt ${answered(robots)}.` };
    if (text !== undefined && isHtml(robots, text)) return { state: 'none', reason: `robots.txt is an HTML page without rules: ${anyCrawler}` };
    return undefined;
}

/** What an AI crawler's requests are for, after its vendor's name ("OpenAI, training AI models") */
const aiUses: Record<AiCrawlerUse, string> = {
    training: 'training AI models',
    search: 'AI search',
    user: 'a user\'s request',
    data: 'open web data'
};

function robotsChecks(robots: Answer, file: RobotsFile | undefined, unread: ReturnType<typeof robotsUnread>, target: string,
    indexable: boolean, why: string, path: string, address: string): { checks: PageCheck[]; ai?: AiCrawlerVerdict[] } {
    const search = row('robots', 'Search crawlers');
    const aiRow = row('robots-ai', 'AI crawlers');
    if (unread || !file || robots.kind !== 'response') {
        const { state, reason } = unread ?? { state: 'none' as const, reason: 'Not read.' };
        return { checks: [search(state, reason), aiRow('none', reason)] };
    }
    const cut = robots.truncated ? ' Its first 500 KiB were read, as RFC 9309 allows.' : '';
    const crawlers = [...searchCrawlers.map(token => ({ token, name: token })), { token: '*', name: 'other crawlers' }]
        .map(crawler => ({ ...crawler, verdict: robotsVerdict(file, crawler.token, target) }));
    const blocked = crawlers.filter(crawler => !crawler.verdict.allowed);
    const blockedNames = names(blocked.map(crawler => crawler.name));
    const rules = [...new Set(blocked.map(crawler => crawler.verdict.rule).filter((rule): rule is RobotsRule => Boolean(rule)))];
    const searchCheck = !blocked.length ? search('pass', `${names(crawlers.map(crawler => crawler.name))} may read this page.${cut}`)
        : search(indexable ? 'warn' : 'none', `robots.txt blocks ${blockedNames} from this page.${why}${cut}`, {
            value: rules[0]?.text,
            issues: indexable ? seoIssue(path, 'robots', 'robots.txt blocks search crawlers from this page.',
                `SEO: robots.txt blocks ${blockedNames} from this page.${requested(robots.url)}${foundLine('Answer', statusLine(robots))}${rules.slice(0, 3).map(rule => foundLine(`Line ${rule.line}`, rule.text)).join('')}${foundLine('Page', writtenAddress(address))}`) : undefined
        });
    const ai = aiCrawlers.map(({ token, by, use }) => {
        const verdict = robotsVerdict(file, token, target);
        return { token, by, use: aiUses[use], allowed: verdict.allowed, rule: verdict.rule?.text };
    });
    const aiBlocked = ai.filter(crawler => !crawler.allowed).map(crawler => crawler.token);
    const allowed = ai.length - aiBlocked.length;
    const aiCheck = aiRow('none', `${allowed === ai.length ? 'All' : `${allowed} of`} ${ai.length} AI crawlers checked may read this page. Blocking them is the site owner's choice.${cut}`,
        { value: aiBlocked.length ? `Blocked: ${aiBlocked.join(', ')}` : undefined });
    return { checks: [searchCheck, aiCheck], ai };
}

/**
 * The Sitemap row: whether the sitemaps list the page (`key`, its canonical address when it has one).
 * `unlisted` says why the page needs no listing (a noindex page); undefined when it may be indexed,
 * which makes a page missing from sitemaps read in full worth a look.
 */
async function sitemapCheck(state: Sitemaps, key: string | undefined, lookup: string, unlisted: string | undefined,
    path: string, requests: Requests): Promise<PageCheck> {
    const sitemap = row('sitemap', 'Sitemap');
    if (!state.queue.length && !state.read.length && state.elsewhere.length && !state.failed.length) {
        return sitemap('none', 'robots.txt names a sitemap on another site, which is not read.', { value: writtenAddress(state.elsewhere[0]) });
    }
    const found = key ? await findListed(state, key, requests) : undefined;
    if (found) return sitemap('pass', `Listed in ${pathOf(found)}.`);
    if (state.missing && !state.read.length) return sitemap('none', `No sitemap: ${state.robotsRead ? 'robots.txt names none, and ' : ''}/sitemap.xml is not there.`);
    const failed = state.failed[0] && `${pathOf(state.failed[0].url)} ${state.failed[0].what}.`;
    if (!state.read.length && failed) return sitemap('none', `Not read: ${failed}`);
    const gap = failed || (state.truncated || state.bytes >= sitemapBytes ? 'The sitemaps are over 5 MB, the most read.'
        : state.queue.length ? `The sitemaps have more than ${sitemapFiles} files, the most read.`
            : state.elsewhere.length && 'A sitemap on another site is not read.');
    const addresses = count(state.listed.size, 'address', 'addresses');
    if (gap) return sitemap('none', `Not listed in the ${addresses} read. ${gap}`);
    const files = state.read.length === 1 ? pathOf(state.read[0]!.url) : `${state.read.length} sitemap files`;
    if (unlisted !== undefined) return sitemap('none', `Not listed in ${files}.${unlisted}`);
    return sitemap('warn', `Not listed in ${files} (${addresses}).`, {
        issues: seoIssue(path, 'sitemap', 'The page is not listed in the sitemap.',
            `SEO: This page is not listed in the site's sitemap, read in full.${foundLine('Page', writtenAddress(lookup))}${state.read.slice(0, 5).map(file => foundLine('Sitemap', `${writtenAddress(file.url)}: ${file.what}`)).join('')}`)
    });
}

function llmsCheck(llms: Answer, here: string | undefined): PageCheck {
    const llmsRow = row('llms', 'llms.txt');
    if (llms.kind === 'blocked') return llmsRow('none', `Not checked: ${csp} this request.`);
    if (llms.kind === 'response' && llms.status >= 400 && llms.status < 500) return llmsRow('none', `No llms.txt. ${engines}`);
    if (!ok(llms)) return llmsRow('none', `Not read: llms.txt ${answered(llms)}.`);
    const text = decode(llms);
    if (isHtml(llms, text)) return llmsRow('none', `No llms.txt: the address answers with an HTML page. ${engines}`);
    // A page's Markdown version, as the llms.txt proposal suggests, counts as the page
    const links = new Set(textLinks(text).map(link => pageKey(link, llms.url)?.replace(/(\/index\.html)?\.md$/, '')));
    return llmsRow('none', `${here && links.has(here) ? 'Found, and it links' : 'Found; it does not link'} this page. ${engines}`,
        { value: oneLine(/^#\s+(.+)$/m.exec(text)?.[1]) || undefined });
}

/**
 * What a crawler gets from this page: the page's own response (status, X-Robots-Tag, the HTML the
 * server sends against the rendered page), what robots.txt allows search and AI crawlers, whether
 * the sitemap lists the page, and llms.txt. Requests without cookies, same-origin only; a site whose
 * CSP blocks them gets one note instead.
 */
export async function checkCrawler({ path, signal }: SectionContext): Promise<CrawlerReport> {
    const note = 'Requested without cookies';
    const origin = window.location.origin;
    const address = window.location.href.replace(/#.*$/, '');
    const watch = watchCsp();
    const requests: Requests = { signal, csp: watch };
    try {
        const page = await request(address, pageLimit, requests, htmlAccept);
        if (page.kind === 'blocked') return { checks: [row('blocked', 'Requests')('none', `Not checked: ${csp} requests to its own origin.`)], note };
        const files = siteFiles(origin, path);
        const [robots, llms] = await Promise.all([
            shared(files, 'robots', () => request(`${origin}/robots.txt`, robotsLimit, requests), signal),
            shared(files, 'llms', () => request(`${origin}/llms.txt`, llmsLimit, requests), signal)
        ]);
        const robotsText = ok(robots) ? decode(robots) : undefined;
        const unread = robotsUnread(robots, robotsText);
        const robotsFile = robotsText !== undefined && !unread ? parseRobots(robotsText) : undefined;
        files.sitemaps ??= sitemapsOf(robotsFile);

        await nextIdle(signal, { soon: true });
        const live = pageFacts(document, document.baseURI);
        const samePage = page.kind === 'response' && pageKey(page.url) === pageKey(address);
        const thePage = ok(page) && samePage ? page : undefined;
        const header = thePage?.headers.get('x-robots-tag');
        const noindex = live.noindex || Boolean(header && noindexFor(robotsHeader(header)));
        // A page the request did not get (a sign-in, an error) is not in search results either way
        const reachable = page.kind !== 'response' || Boolean(thePage);
        const why = noindex ? ' The page asks search engines not to index it.' : '';

        const checks: PageCheck[] = [responseCheck(page, path, address, samePage)];
        if (thePage) checks.push(headerCheck(thePage, live));
        const url = new URL(address);
        const robotsRows = robotsChecks(robots, robotsFile, unread, `${url.pathname}${url.search}`, !noindex && reachable, why, path, address);
        checks.push(...robotsRows.checks);
        // The canonical address when the page has one: that is the one a sitemap lists
        const lookup = live.canonical && /^https?:/i.test(live.canonical) ? live.canonical : address;
        const unlisted = noindex ? ' Not needed on a noindex page.' : pageKey(lookup) !== pageKey(address) ? ' The canonical link points to another page.'
            : reachable ? undefined : '';
        checks.push(await sitemapCheck(files.sitemaps, pageKey(lookup), lookup, unlisted, path, requests));

        if (!thePage) {
            // The Response row says what the request got instead
            checks.push(row('served', 'Served HTML')('none', 'Not compared: the request did not get this page.'));
        } else if (thePage.contentType && !/html|xml/i.test(thePage.contentType)) {
            checks.push(row('served', 'Served HTML')('none', `Not compared: the server sends ${oneLine(thePage.contentType.split(';')[0], 60)}.`));
        } else {
            await nextIdle(signal, { soon: true });
            const served = new DOMParser().parseFromString(decode(thePage), 'text/html');
            let base = thePage.url;
            try { base = new URL(served.querySelector('base[href]')?.getAttribute('href') ?? '', base).href; } catch { /* The response's address. */ }
            checks.push(...servedChecks(live, pageFacts(served, base), thePage, path, address));
        }
        checks.push(llmsCheck(llms, pageKey(address)));
        return { checks, note, details: { ai: robotsRows.ai } };
    } finally {
        watch.stop();
    }
}
