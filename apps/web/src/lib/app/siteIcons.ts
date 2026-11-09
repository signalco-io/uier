import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { isLocalRuntime } from '../comments/environment';
import { isPublicAddress, publicLookup } from '../mcp/publicNetwork';

/*
 * A project's icon, found the way a browser tab finds a site's: the `<link rel="icon">` of the page at
 * the project's main address (then its `apple-touch-icon`), then the usual paths (`/favicon.ico`,
 * `/favicon.svg`, `/apple-touch-icon.png`). uier's server fetches them and `/api/projects/<id>/icon`
 * serves the icon from uier.io, so a viewer's browser never contacts the site for it.
 *
 * Requests reach only public addresses: `publicLookup` checks each connection's own DNS answer, IP
 * literals must be public, single-label and `localhost` names are refused. Ports are the defaults
 * or the address's own. At most 5 redirects, each checked again; 5 s per request and 10 s in all;
 * at most 512 KiB of the page and 256 KiB of an icon, which must be an image by its bytes (PNG, ICO,
 * GIF, JPEG, WebP, AVIF, BMP or SVG; the declared type is ignored). Results stay in this server's
 * memory per address: an icon for a day, none for 30 minutes.
 */

export const MAX_PAGE_BYTES = 512 * 1024;
export const MAX_ICON_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 5;
const MAX_ICON_ATTEMPTS = 6;
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 30 * 60 * 1000;
const CACHE_ENTRIES = 500;
const CACHE_BYTES = 16 * 1024 * 1024;
/** Seconds the browser keeps an icon, or the answer that there is none (`/api/projects/<id>/icon`) */
export const SITE_ICON_MAX_AGE = FOUND_TTL_MS / 1000;
export const MISSING_SITE_ICON_MAX_AGE = MISSING_TTL_MS / 1000;

const USER_AGENT = 'Mozilla/5.0 (compatible; uier-site-icons/1.0; +https://uier.io)';
const PAGE_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5';
const ICON_ACCEPT = 'image/avif,image/webp,image/svg+xml,image/png,image/x-icon,image/*;q=0.8,*/*;q=0.5';
/** Where sites keep an icon they do not declare, tried after the declared ones */
const usualPaths = ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png'];

export type SiteIcon = { data: Buffer; contentType: string };
export type SiteIconOptions = {
    /** DNS lookup of each connection; tests map their own host names, production uses `publicLookup` */
    lookup?: typeof publicLookup;
    /** Per request; the whole lookup gets twice as long */
    timeoutMs?: number;
};

type Context = { lookup: typeof publicLookup; timeoutMs: number; deadline: number; ports: ReadonlySet<number> };
type Read = { accept: string; maxBytes: number; /** Keep what fits instead of failing: a page's head comes first */ truncate?: boolean };
type Fetched = { url: URL; status: number; contentType: string; body: Buffer };

// --- Addresses ---

function portOf(url: URL) {
    return url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
}

/** Whether the server may request a URL: HTTP(S), no credentials, an allowed port, a public host */
export function isFetchableUrl(url: URL, ports: ReadonlySet<number> = new Set([80, 443])) {
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || !ports.has(portOf(url)))
        return false;
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    // An address is checked here: a connection to one makes no DNS lookup for `publicLookup` to check
    if (isIP(host))
        return isPublicAddress(host);
    return host.includes('.') && host !== 'localhost' && !host.endsWith('.localhost');
}

/** Local test runs only: `UIER_SITE_ICONS_TEST_UPSTREAM` (http://127.0.0.1:<port>) receives every request, the site's host in `Host` */
function testUpstream() {
    const value = process.env.UIER_SITE_ICONS_TEST_UPSTREAM;
    if (!value || !isLocalRuntime())
        return null;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' && url.hostname === '127.0.0.1' ? url : null;
    } catch {
        return null;
    }
}

// --- Requests ---

/** The body, decompressed, up to `maxBytes`; `null` when it is larger (unless truncated) or unreadable */
function readBody(response: IncomingMessage, { maxBytes, truncate }: Read) {
    return new Promise<Buffer | null>(resolve => {
        const encoding = String(response.headers['content-encoding'] ?? '').trim().toLowerCase();
        const declared = Number(response.headers['content-length']);
        if (!truncate && (!encoding || encoding === 'identity') && declared > maxBytes) {
            resolve(null);
            return;
        }
        let stream: Readable = response;
        if (encoding === 'gzip' || encoding === 'x-gzip') stream = response.pipe(createGunzip());
        else if (encoding === 'deflate') stream = response.pipe(createInflate());
        else if (encoding === 'br') stream = response.pipe(createBrotliDecompress());
        else if (encoding && encoding !== 'identity') {
            resolve(null);
            return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;
        const finish = (body: Buffer | null) => {
            if (settled) return;
            settled = true;
            resolve(body);
            if (stream !== response) stream.destroy();
            response.destroy();
        };
        stream.on('data', (chunk: Buffer) => {
            if (size + chunk.length > maxBytes) {
                if (truncate) chunks.push(chunk.subarray(0, maxBytes - size));
                finish(truncate ? Buffer.concat(chunks) : null);
                return;
            }
            size += chunk.length;
            chunks.push(chunk);
        });
        stream.on('end', () => finish(Buffer.concat(chunks)));
        stream.on('error', () => finish(null));
        // Also a connection closed early (the request's timer bounds the rest)
        response.on('error', () => finish(null));
    });
}

type Answer = { status: number; contentType: string; location?: string; body: Buffer };

/** One GET, without following redirects; `null` on any failure, including the time running out */
function get(url: URL, read: Read, timeoutMs: number, lookup: typeof publicLookup) {
    return new Promise<Answer | null>(resolve => {
        let settled = false;
        const finish = (answer: Answer | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(answer);
            outgoing.destroy();
        };
        const onResponse = (response: IncomingMessage) => {
            const status = response.statusCode ?? 0;
            const contentType = String(response.headers['content-type'] ?? '');
            const location = response.headers.location;
            if ([301, 302, 303, 307, 308].includes(status) && location) {
                response.resume();
                finish({ status, contentType, location, body: Buffer.alloc(0) });
                return;
            }
            void readBody(response, read).then(body => finish(body ? { status, contentType, body } : null));
        };
        const headers = { Accept: read.accept, 'Accept-Encoding': 'gzip, deflate, br', 'User-Agent': USER_AGENT };
        const upstream = testUpstream();
        // A connection of its own (`agent: false`): nothing is pooled between sites or kept open
        const outgoing = upstream
            ? httpRequest({ host: upstream.hostname, port: upstream.port, path: `${url.pathname}${url.search}`, method: 'GET',
                headers: { ...headers, Host: url.host }, agent: false }, onResponse)
            : (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: 'GET', headers, agent: false,
                lookup: lookup as unknown as LookupFunction }, onResponse);
        // Bounds the whole exchange, including a slowly dripping response
        const timer = setTimeout(() => finish(null), timeoutMs);
        outgoing.on('error', () => finish(null));
        outgoing.end();
    });
}

/** A GET that follows redirects, each to an address `isFetchableUrl` accepts */
async function fetchFollowing(start: URL, read: Read, context: Context): Promise<Fetched | null> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const remaining = context.deadline - Date.now();
        if (remaining <= 0 || !isFetchableUrl(url, context.ports))
            return null;
        const answer = await get(url, read, Math.min(context.timeoutMs, remaining), context.lookup);
        if (!answer)
            return null;
        if (answer.location === undefined)
            return { url, status: answer.status, contentType: answer.contentType, body: answer.body };
        try {
            url = new URL(answer.location, url);
        } catch {
            return null;
        }
        url.hash = '';
    }
    return null;
}

// --- The page's icons ---

const namedEntities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

function decodeEntities(value: string) {
    return value.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (match, hex?: string, decimal?: string, name?: string) => {
        if (name)
            return namedEntities[name.toLowerCase()] ?? match;
        const code = hex ? parseInt(hex, 16) : Number(decimal);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
}

function attributes(source: string) {
    const found = new Map<string, string>();
    for (const [, name, double, single, bare] of source.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        const key = name!.toLowerCase();
        if (!found.has(key))
            found.set(key, decodeEntities(double ?? single ?? bare ?? ''));
    }
    return found;
}

/** How well an icon suits a tile drawn from 10 to 36 px: scalable, then larger up to 256 px */
function quality(sizes: string, svg: boolean, touch: boolean) {
    if (svg || /(?:^|\s)any(?:\s|$)/i.test(sizes))
        return 1000;
    const declared = Math.max(0, ...sizes.split(/\s+/).map(size => Number(/^(\d+)x\d+$/i.exec(size)?.[1] ?? 0)));
    const size = declared || (touch ? 180 : 32);
    return size <= 256 ? size : 256 - size / 10_000;
}

/**
 * The icons a page declares, best first: `icon` links before `apple-touch-icon`, ones for a dark
 * theme last (the tile is light), then SVG and larger sizes. Absolute HTTP(S) or `data:` URLs,
 * resolved against `<base href>` and the page's address. Comments, scripts and styles are skipped.
 */
export function iconLinks(html: string, pageUrl: string | URL) {
    const markup = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style|template|noscript|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    let base = new URL(pageUrl);
    let baseFound = false;
    const declared: { href: string; touch: boolean; dark: boolean; quality: number; order: number }[] = [];
    for (const [, tag, source] of markup.matchAll(/<(link|base)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
        const attrs = attributes(source!);
        const href = attrs.get('href')?.trim();
        if (!href)
            continue;
        let url: URL;
        try {
            url = new URL(href, base);
        } catch {
            continue;
        }
        if (tag!.toLowerCase() === 'base') {
            // Only the first `<base href>` counts
            if (!baseFound && (url.protocol === 'https:' || url.protocol === 'http:')) base = url;
            baseFound = true;
            continue;
        }
        const rels = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
        const touch = rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed');
        if (!touch && !rels.includes('icon'))
            continue;
        if (url.protocol !== 'https:' && url.protocol !== 'http:' && !/^data:image\//i.test(url.href))
            continue;
        url.hash = '';
        const svg = /svg/i.test(attrs.get('type') ?? '') || /\.svg$/i.test(url.pathname) || /^data:image\/svg/i.test(url.href);
        declared.push({ href: url.href, touch, dark: /prefers-color-scheme\s*:\s*dark/i.test(attrs.get('media') ?? ''),
            quality: quality(attrs.get('sizes') ?? '', svg, touch), order: declared.length });
    }
    declared.sort((a, b) => Number(a.touch) - Number(b.touch) || Number(a.dark) - Number(b.dark)
        || b.quality - a.quality || a.order - b.order);
    return [...new Set(declared.map(icon => icon.href))];
}

// --- Icons ---

/** The image type of an icon by its first bytes, or `null` when it is not one (an HTML page served for a missing icon) */
export function iconType(bytes: Buffer) {
    const ascii = (start: number, end: number) => bytes.subarray(start, end).toString('latin1');
    if (bytes.length >= 8 && ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
    if (bytes.length >= 6 && bytes.readUInt32BE(0) === 0x00000100) return 'image/x-icon';
    if (ascii(0, 4) === 'GIF8') return 'image/gif';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    if (ascii(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 12))) return 'image/avif';
    if (ascii(0, 2) === 'BM' && bytes.length >= 18 && [12, 40, 52, 56, 108, 124].includes(bytes.readUInt32LE(14))) return 'image/bmp';
    const text = bytes.subarray(0, 4096).toString('utf8').replace(/^﻿/, '');
    if (/^\s*(?:<\?xml[^>]*>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg[\s>]/i.test(text)) return 'image/svg+xml';
    return null;
}

/** Percent-decodes like a browser reading a `data:` URL: an invalid escape (`100%`) stays as it is */
function percentDecode(text: string) {
    const bytes = Buffer.from(text, 'utf8');
    const decoded: number[] = [];
    for (let index = 0; index < bytes.length; index++) {
        const escape = bytes[index] === 0x25 ? bytes.subarray(index + 1, index + 3).toString('latin1') : '';
        if (/^[0-9a-f]{2}$/i.test(escape)) {
            decoded.push(parseInt(escape, 16));
            index += 2;
        } else {
            decoded.push(bytes[index]!);
        }
    }
    return Buffer.from(decoded);
}

function dataIcon(href: string): SiteIcon | null {
    const match = /^data:([^,]*),([\s\S]*)$/i.exec(href);
    if (!match || href.length > MAX_ICON_BYTES * 2)
        return null;
    const body = percentDecode(match[2]!);
    const data = /;base64\s*$/i.test(match[1]!) ? Buffer.from(body.toString('latin1').replace(/\s/g, ''), 'base64') : body;
    const contentType = data.length && data.length <= MAX_ICON_BYTES ? iconType(data) : null;
    return contentType ? { data, contentType } : null;
}

async function loadIcon(href: string, context: Context): Promise<SiteIcon | null> {
    if (href.startsWith('data:'))
        return dataIcon(href);
    const fetched = await fetchFollowing(new URL(href), { accept: ICON_ACCEPT, maxBytes: MAX_ICON_BYTES }, context);
    if (!fetched || fetched.status < 200 || fetched.status > 299 || !fetched.body.length)
        return null;
    const contentType = iconType(fetched.body);
    return contentType ? { data: fetched.body, contentType } : null;
}

/** The site's icon, uncached: the page's declared icons, then the usual paths */
export async function resolveSiteIcon(siteUrl: string, { lookup = publicLookup, timeoutMs = REQUEST_TIMEOUT_MS }: SiteIconOptions = {}) {
    let site: URL;
    try {
        site = new URL(siteUrl);
    } catch {
        return null;
    }
    site.hash = '';
    const context: Context = { lookup, timeoutMs, deadline: Date.now() + 2 * timeoutMs, ports: new Set([80, 443, portOf(site)]) };
    if (!isFetchableUrl(site, context.ports))
        return null;
    // An error page or a sign-in page (after its redirect) usually declares the same icons
    const page = await fetchFollowing(site, { accept: PAGE_ACCEPT, maxBytes: MAX_PAGE_BYTES, truncate: true }, context);
    const declared = page && (!page.contentType || /html/i.test(page.contentType)) ? iconLinks(page.body.toString('utf8'), page.url) : [];
    const origins = [...new Set([page?.url.origin ?? site.origin, site.origin])];
    const usual = usualPaths.flatMap(path => origins.map(origin => `${origin}${path}`));
    for (const href of [...new Set([...declared, ...usual])].slice(0, MAX_ICON_ATTEMPTS)) {
        if (Date.now() >= context.deadline)
            break;
        const icon = await loadIcon(href, context);
        if (icon)
            return icon;
    }
    return null;
}

// --- Cache ---

type Entry = { icon: SiteIcon | null; expires: number };
// Least recently used first (a `Map` keeps insertion order)
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<SiteIcon | null>>();
let cachedBytes = 0;

function forget(key: string) {
    const entry = cache.get(key);
    if (!entry) return;
    cachedBytes -= entry.icon?.data.length ?? 0;
    cache.delete(key);
}

function remember(key: string, icon: SiteIcon | null) {
    forget(key);
    cache.set(key, { icon, expires: Date.now() + (icon ? FOUND_TTL_MS : MISSING_TTL_MS) });
    cachedBytes += icon?.data.length ?? 0;
    for (const oldest of cache.keys()) {
        if (cache.size <= CACHE_ENTRIES && cachedBytes <= CACHE_BYTES) break;
        forget(oldest);
    }
}

/** {@link resolveSiteIcon}, cached in memory per address; concurrent requests for one address share a lookup */
export async function getSiteIcon(siteUrl: string, options?: SiteIconOptions) {
    const entry = cache.get(siteUrl);
    if (entry && entry.expires > Date.now()) {
        cache.delete(siteUrl);
        cache.set(siteUrl, entry);
        return entry.icon;
    }
    const running = pending.get(siteUrl);
    if (running)
        return await running;
    const lookup = resolveSiteIcon(siteUrl, options)
        .catch(() => null)
        .then(icon => {
            remember(siteUrl, icon);
            return icon;
        })
        .finally(() => pending.delete(siteUrl));
    pending.set(siteUrl, lookup);
    return await lookup;
}
