import { foundLine, isToolbarNode, oneLine, writtenAddress } from '../pageElements';
import { nextIdle } from '../pageIdle';
import type { CheckState, PageCheck } from '../types';
import { words } from './locale';
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
    const said = words().crawler.answered;
    return answer.kind === 'response' ? said.response(statusLine(answer))
        : answer.kind === 'timeout' ? said.timeout
            : answer.kind === 'away' ? said.away
                : answer.kind === 'blocked' ? said.blocked : said.failed;
}

const percent = (share: number) => `${Math.floor(share * 100)}%`;
const names = (list: readonly string[]) => list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} ${words().crawler.and} ${list.at(-1)}`;
const requested = (address: string) => foundLine(words().found.requested, `GET ${writtenAddress(address)}`);
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
            state.failed.push(what(words().crawler.unpacked));
            return;
        }
    }
    if (isHtml(answer, text)) {
        if (state.named) state.failed.push(what(words().crawler.htmlPage));
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
    state.read.push(what(index ? words().crawler.sitemapIndex(locations.length) : words().crawler.addresses(locations.length)));
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
    const { crawler: t, found: names_ } = words();
    const sent = `${requested(address)}${foundLine(names_.answer, statusLine(page))}`;

    const h1 = row('served-h1', t.servedH1);
    const firstH1 = live.h1.find(Boolean) ?? live.h1[0];
    const h1Check = firstH1 === undefined ? h1('none', t.noH1)
        : served.h1.includes(firstH1) ? h1('pass', t.h1Sent, { value: firstH1 || undefined })
            : served.h1.length ? h1('none', t.h1Changed, { value: t.served(served.h1[0] || t.emptyH1) })
                : h1('warn', t.h1Added(t.javascript), {
                    value: firstH1 || undefined,
                    issues: seoIssue(path, 'served-h1', t.h1AddedSummary,
                        `${t.h1AddedComment(t.javascript)}${sent}${foundLine(names_.pageH1, firstH1)}`)
                });

    const text = row('served-text', t.servedText);
    const share = textShare(live.text, served.text);
    const measure = percent(share.share);
    const cut = page.truncated ? t.firstMb : '';
    const measured = t.textMeasured(measure, cut);
    const textCheck = !share.characters ? text('none', t.noText)
        : share.share >= textPass ? text('pass', measured, { measure })
            : share.share < textWarn && share.characters >= textMinimum
                ? text('warn', t.restAdded(measured), {
                    measure,
                    issues: seoIssue(path, 'served-text', t.textSummary,
                        `${t.textComment(measure, cut, t.javascript)}${sent}${foundLine(names_.measured, t.textMeasuredLine(share.found, share.characters))}`)
                })
                : text('none', measured, { measure });

    const parts = [
        { name: t.parts.title, page: live.title, served: served.title },
        { name: t.parts.description, page: live.description, served: served.description },
        { name: t.parts.canonical, page: live.canonical, served: served.canonical },
        { name: t.parts.robots, page: live.robots, served: served.robots }
    ];
    const differences = [
        { verb: 'added' as const, list: parts.filter(part => part.page && !part.served) },
        { verb: 'changed' as const, list: parts.filter(part => part.page && part.served && part.page !== part.served) },
        { verb: 'removed' as const, list: parts.filter(part => !part.page && part.served) }
    ].filter(({ list }) => list.length);
    const different = differences.flatMap(({ list }) => list);
    const present = parts.filter(part => part.page);
    const head = row('served-head', t.servedHead);
    const headCheck = different.length
        ? head('none', differences.map(({ verb, list }) => t.changedBy(names(list.map(part => part.name)), list.length > 1, verb)).join(' '),
            { value: different.length === 1 && different[0]!.served ? t.served(oneLine(different[0]!.served)) : undefined })
        : present.length ? head('pass', t.headPresent(names(present.map(part => part.name))))
            : head('none', t.noHead);

    const links = row('served-links', t.servedLinks);
    const pageLinks = [...live.links];
    const found = pageLinks.filter(link => served.links.has(link)).length;
    const linkCount = { measure: t.linksOf(found, pageLinks.length) };
    const linksCheck = !pageLinks.length ? links('none', t.noLinks)
        : found === pageLinks.length ? links('pass', t.allLinks, linkCount)
            : links(found / pageLinks.length >= linksPass ? 'pass' : 'none', t.someLinks(found, pageLinks.length), linkCount);

    return [h1Check, textCheck, headCheck, linksCheck];
}

/** The Response row: what a request without cookies for this page got */
function responseCheck(page: Answer, path: string, address: string, samePage: boolean): PageCheck {
    const { crawler: t, found } = words();
    const status = row('status', t.response);
    if (page.kind === 'timeout') return status('none', t.timeout);
    if (page.kind === 'away') return status('none', t.away(t.protectedSite));
    if (page.kind !== 'response') return status('none', t.failed);
    const measure = String(page.status);
    if (page.status === 401 || page.status === 403) return status('none', t.refuses(t.withoutCookies, t.protectedSite), { measure });
    if (page.redirected && !samePage) {
        return status('none', t.redirectedElsewhere(t.protectedSite), { measure, value: writtenAddress(page.url) });
    }
    if (page.status >= 400) {
        return status('warn', t.answersTo(statusLine(page), t.withoutCookies), {
            measure,
            issues: seoIssue(path, 'status', t.statusSummary(page.status, t.withoutCookies),
                `${t.statusComment(statusLine(page))}${requested(address)}${foundLine(found.answer, statusLine(page))}`)
        });
    }
    if (!ok(page)) return status('none', t.answers(statusLine(page)), { measure });
    if (page.redirected && page.url !== address) {
        return status('none', t.redirectedFirst, { measure, value: writtenAddress(page.url) });
    }
    return status('pass', t.sends(t.withoutCookies), { measure });
}

/** Who a header's noindex is for: "search engines", "Google" or the crawlers it names; empty for nobody */
function noindexFor(rules: Map<string, string[]>) {
    const agents = [...rules].filter(([, directives]) => keepsOut(directives)).map(([agent]) => agent);
    return agents.includes('*') ? words().crawler.searchEngines : names(agents.map(agent => agent === 'googlebot' ? 'Google' : agent === 'bingbot' ? 'Bing' : agent));
}

function headerCheck(page: Received, live: PageFacts): PageCheck {
    const t = words().crawler;
    const header = row('x-robots-tag', 'X-Robots-Tag');
    const value = page.headers.get('x-robots-tag');
    if (!value) return header('pass', t.notSent);
    const who = noindexFor(robotsHeader(value));
    const shown = { value: oneLine(value) };
    if (!who) {
        return live.noindex ? header('none', t.metaNoindex, shown)
            : header('pass', t.noNoindex, shown);
    }
    return header('none', t.headerNoindex(who, Boolean(live.robots && !live.noindex)), shown);
}

/** Why a robots.txt has no rules to evaluate, as the reason of its rows; nothing when it has */
function robotsUnread(robots: Answer, text: string | undefined): { state: CheckState; reason: string } | undefined {
    const t = words().crawler;
    const anyCrawler = t.anyCrawler;
    if (robots.kind === 'blocked') return { state: 'none', reason: t.notCheckedCsp(t.csp) };
    if (robots.kind !== 'response') return { state: 'none', reason: t.robotsNotRead(answered(robots)) };
    if (robots.status === 404 || robots.status === 410) return { state: 'pass', reason: t.noRobots(anyCrawler) };
    if (robots.status >= 400 && robots.status < 500) return { state: 'none', reason: t.robotsNone(answered(robots), anyCrawler) };
    if (robots.status >= 500) return { state: 'none', reason: t.robotsServerError(answered(robots)) };
    if (!ok(robots)) return { state: 'none', reason: t.robotsNotRead(answered(robots)) };
    if (text !== undefined && isHtml(robots, text)) return { state: 'none', reason: t.robotsHtml(anyCrawler) };
    return undefined;
}


function robotsChecks(robots: Answer, file: RobotsFile | undefined, unread: ReturnType<typeof robotsUnread>, target: string,
    indexable: boolean, why: string, path: string, address: string): { checks: PageCheck[]; ai?: AiCrawlerVerdict[] } {
    const { crawler: t, found } = words();
    const search = row('robots', t.searchCrawlers);
    const aiRow = row('robots-ai', t.aiCrawlers);
    if (unread || !file || robots.kind !== 'response') {
        const { state, reason } = unread ?? { state: 'none' as const, reason: t.notRead };
        return { checks: [search(state, reason), aiRow('none', reason)] };
    }
    const cut = robots.truncated ? t.cut : '';
    const crawlers = [...searchCrawlers.map(token => ({ token, name: token })), { token: '*', name: t.otherCrawlers }]
        .map(crawler => ({ ...crawler, verdict: robotsVerdict(file, crawler.token, target) }));
    const blocked = crawlers.filter(crawler => !crawler.verdict.allowed);
    const blockedNames = names(blocked.map(crawler => crawler.name));
    const rules = [...new Set(blocked.map(crawler => crawler.verdict.rule).filter((rule): rule is RobotsRule => Boolean(rule)))];
    const searchCheck = !blocked.length ? search('pass', t.mayRead(names(crawlers.map(crawler => crawler.name)), cut))
        : search(indexable ? 'warn' : 'none', t.robotsBlocks(blockedNames, why, cut), {
            value: rules[0]?.text,
            issues: indexable ? seoIssue(path, 'robots', t.robotsBlocksSummary,
                `${t.robotsBlocksComment(blockedNames)}${requested(robots.url)}${foundLine(found.answer, statusLine(robots))}${rules.slice(0, 3).map(rule => foundLine(found.line(rule.line), rule.text)).join('')}${foundLine(found.page, writtenAddress(address))}`) : undefined
        });
    const ai = aiCrawlers.map(({ token, by, use }) => {
        const verdict = robotsVerdict(file, token, target);
        // The use stays its stable value: the panel names it in the toolbar's language
        return { token, by, use, allowed: verdict.allowed, rule: verdict.rule?.text };
    });
    const aiBlocked = ai.filter(crawler => !crawler.allowed).map(crawler => crawler.token);
    const allowed = ai.length - aiBlocked.length;
    const aiCheck = aiRow('none', t.aiAllowed(allowed, ai.length, cut),
        { value: aiBlocked.length ? t.aiBlocked(aiBlocked.join(', ')) : undefined });
    return { checks: [searchCheck, aiCheck], ai };
}

/**
 * The Sitemap row: whether the sitemaps list the page (`key`, its canonical address when it has one).
 * `unlisted` says why the page needs no listing (a noindex page); undefined when it may be indexed,
 * which makes a page missing from sitemaps read in full worth a look.
 */
async function sitemapCheck(state: Sitemaps, key: string | undefined, lookup: string, unlisted: string | undefined,
    path: string, requests: Requests): Promise<PageCheck> {
    const { crawler: t, found: names_ } = words();
    const sitemap = row('sitemap', t.sitemap);
    if (!state.queue.length && !state.read.length && state.elsewhere.length && !state.failed.length) {
        return sitemap('none', t.sitemapElsewhere, { value: writtenAddress(state.elsewhere[0]) });
    }
    const found = key ? await findListed(state, key, requests) : undefined;
    if (found) return sitemap('pass', t.listedIn(pathOf(found)));
    if (state.missing && !state.read.length) return sitemap('none', t.noSitemap(state.robotsRead));
    const failed = state.failed[0] && t.failedFile(pathOf(state.failed[0].url), state.failed[0].what);
    if (!state.read.length && failed) return sitemap('none', t.sitemapNotRead(failed));
    const gap = failed || (state.truncated || state.bytes >= sitemapBytes ? t.tooBig
        : state.queue.length ? t.tooMany(sitemapFiles)
            : state.elsewhere.length && t.elsewhere);
    const addresses = t.addresses(state.listed.size);
    if (gap) return sitemap('none', t.notListedRead(addresses, gap));
    const files = state.read.length === 1 ? pathOf(state.read[0]!.url) : t.sitemapFiles(state.read.length);
    if (unlisted !== undefined) return sitemap('none', t.notListedIn(files, unlisted));
    return sitemap('warn', t.notListed(files, addresses), {
        issues: seoIssue(path, 'sitemap', t.notListedSummary,
            `${t.notListedComment}${foundLine(names_.page, writtenAddress(lookup))}${state.read.slice(0, 5).map(file => foundLine(names_.sitemap, `${writtenAddress(file.url)}: ${file.what}`)).join('')}`)
    });
}

function llmsCheck(llms: Answer, here: string | undefined): PageCheck {
    const t = words().crawler;
    const llmsRow = row('llms', 'llms.txt');
    if (llms.kind === 'blocked') return llmsRow('none', t.notCheckedCsp(t.csp));
    if (llms.kind === 'response' && llms.status >= 400 && llms.status < 500) return llmsRow('none', t.noLlms(t.engines));
    if (!ok(llms)) return llmsRow('none', t.llmsNotRead(answered(llms)));
    const text = decode(llms);
    if (isHtml(llms, text)) return llmsRow('none', t.llmsHtml(t.engines));
    // A page's Markdown version, as the llms.txt proposal suggests, counts as the page
    const links = new Set(textLinks(text).map(link => pageKey(link, llms.url)?.replace(/(\/index\.html)?\.md$/, '')));
    return llmsRow('none', t.llmsFound(Boolean(here && links.has(here)), t.engines),
        { value: oneLine(/^#\s+(.+)$/m.exec(text)?.[1]) || undefined });
}

/**
 * What a crawler gets from this page: the page's own response (status, X-Robots-Tag, the HTML the
 * server sends against the rendered page), what robots.txt allows search and AI crawlers, whether
 * the sitemap lists the page, and llms.txt. Requests without cookies, same-origin only; a site whose
 * CSP blocks them gets one note instead.
 */
export async function checkCrawler({ path, signal }: SectionContext): Promise<CrawlerReport> {
    const t = words().crawler;
    const note = t.note;
    const origin = window.location.origin;
    const address = window.location.href.replace(/#.*$/, '');
    const watch = watchCsp();
    const requests: Requests = { signal, csp: watch };
    try {
        const page = await request(address, pageLimit, requests, htmlAccept);
        if (page.kind === 'blocked') return { checks: [row('blocked', t.requests)('none', t.blockedOwn(t.csp))], note };
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
        const why = noindex ? t.noindexWhy : '';

        const checks: PageCheck[] = [responseCheck(page, path, address, samePage)];
        if (thePage) checks.push(headerCheck(thePage, live));
        const url = new URL(address);
        const robotsRows = robotsChecks(robots, robotsFile, unread, `${url.pathname}${url.search}`, !noindex && reachable, why, path, address);
        checks.push(...robotsRows.checks);
        // The canonical address when the page has one: that is the one a sitemap lists
        const lookup = live.canonical && /^https?:/i.test(live.canonical) ? live.canonical : address;
        const unlisted = noindex ? t.noindexNotNeeded : pageKey(lookup) !== pageKey(address) ? t.canonicalElsewhere
            : reachable ? undefined : '';
        checks.push(await sitemapCheck(files.sitemaps, pageKey(lookup), lookup, unlisted, path, requests));

        if (!thePage) {
            // The Response row says what the request got instead
            checks.push(row('served', t.servedHtml)('none', t.notThisPage));
        } else if (thePage.contentType && !/html|xml/i.test(thePage.contentType)) {
            checks.push(row('served', t.servedHtml)('none', t.otherType(oneLine(thePage.contentType.split(';')[0], 60))));
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
