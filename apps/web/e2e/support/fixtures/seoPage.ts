import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { PageFixture } from './types';

// The SEO panel's more Page, Links and Images checks (packages/toolbar/docs/page-checks-seo-page.md),
// on `site.origin('fixture-seo-page')`: hreflang tags, generic link text, links that answer with an
// error (and one to /logout this server counts, so a test proves it is never requested), and PNG
// files of known dimensions and weight. Every link address is under `/seo-page/<project code>/`, so
// each test counts only its own requests (`linkRequests`).
//
// - `?hreflang=bad`: an invalid value, a relative address, a value used twice, this page not among them;
//   `?hreflang=good`: a valid set with this page; `?hreflang=canonical`: a canonical link to another page
//   that none of the tags names
// - `?bare`: a page without a viewport meta tag and without `lang`; `?lang=de`: a page in German
// - `?many-links`: 120 links, each answering after 100 ms (Stop, the 100 address cap)
// - `?blocked-links`: a CSP whose `connect-src` leaves out the site's own origin

/** The host the page was last asked for at (`fixture-seo-page.localhost:<port>`), for its full addresses */
let host = '';
const requests: string[] = [];

/** The slow `item-<n>` requests of each project being answered, and the most at once */
const slow = new Map<string, { now: number; most: number }>();

/** The requests to this test's link addresses, `HEAD /seo-page/<project>/missing`, in order */
export function linkRequests(project: string) {
    return requests.filter(line => line.includes(`/seo-page/${project}/`));
}

/** How many of this test's `?many-links` requests the server was answering at most at once */
export function mostAtOnce(project: string) {
    return slow.get(project)?.most ?? 0;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(data: Buffer) {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

/**
 * A grey PNG of these dimensions, its first `noise` rows random pixels that do not compress: all of
 * them make a heavy file, a few make an image Chrome counts for Largest Contentful Paint (it leaves out
 * images of under 0.05 bits per shown pixel, such as a plain colour)
 */
function png(width: number, height: number, noise = 0) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // 8 bits, greyscale (colour type 0), no interlace
    const row = width + 1;
    const pixels = Buffer.alloc(row * height, 200);
    randomBytes(row * noise).copy(pixels);
    for (let y = 0; y < height; y++) pixels[y * row] = 0; // Each row's filter: none
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
        chunk('IDAT', deflateSync(pixels, { level: noise === height ? 0 : 6 })), chunk('IEND', Buffer.alloc(0))]);
}

const imageSizes: Record<string, [number, number, number?]> = {
    'hero.png': [1200, 600, 40], 'photo.png': [2400, 1600], 'badge.png': [200, 100], 'heavy.png': [1000, 700, 700]
};
const images = new Map<string, Buffer>();

/** The page's project code: its first path segment */
const projectOf = (url: URL) => url.pathname.split('/')[1] ?? '';

function hreflangTags(url: URL) {
    const variant = url.searchParams.get('hreflang');
    const self = `http://${host}${url.pathname}`;
    if (variant === 'good') {
        return `<link rel="alternate" hreflang="en" href="${self}">
            <link rel="alternate" hreflang="de" href="http://${host}/de${url.pathname}">
            <link rel="alternate" hreflang="x-default" href="${self}">`;
    }
    if (variant === 'bad') {
        return `<link rel="alternate" hreflang="en_US" href="http://${host}/en-us/plans">
            <link rel="alternate" hreflang="de" href="/de/plans">
            <link rel="alternate" hreflang="fr" href="http://${host}/fr/plans">
            <link rel="alternate" hreflang="fr" href="http://${host}/fr/tarifs">`;
    }
    if (variant === 'canonical') {
        return `<link rel="canonical" href="http://${host}/plans">
            <link rel="alternate" hreflang="en" href="${self}">
            <link rel="alternate" hreflang="de" href="http://${host}/de/plans">`;
    }
    return '';
}

/** Links to this site that answer in every way the check knows, and some it must never request */
function links(url: URL) {
    const base = `/seo-page/${projectOf(url)}`;
    if (url.searchParams.has('many-links')) {
        return `<ul id="many-links">${Array.from({ length: 120 }, (_, i) => `<li><a href="${base}/item-${i + 1}">Plan ${i + 1}</a></li>`).join('')}</ul>`;
    }
    return `<p id="seo-links">
        <a id="read-more" href="${base}/ok">Read more</a>
        <a id="click-here" href="${base}/ok#top">click here</a>
        <a id="labelled-more" href="${base}/ok" aria-label="More about plans">More</a>
        <a id="missing-link" href="${base}/missing">Old plans</a>
        <a id="broken-link" href="${base}/broken">Status page</a>
        <a id="head-refused" href="${base}/head-refused">Plan comparison</a>
        <a id="moved-link" href="${base}/moved">Moved plans</a>
        <a id="private-link" href="${base}/private">Team settings</a>
        <a id="logout-link" href="${base}/logout">Sign out</a>
        <a id="download-link" href="${base}/report.pdf" download>Annual report</a>
        <a href="https://partner.example/plans">Our partner</a>
        <a href="mailto:team@example.com">Email the team</a>
    </p>`;
}

const imagesHtml = `<img id="hero" src="/seo-page/images/hero.png" alt="The product on a wide screen" width="1200" height="600" loading="lazy">
    <img id="oversized" src="/seo-page/images/photo.png" alt="A photo of the team" width="300" height="200">
    <img id="no-size" src="/seo-page/images/badge.png" alt="A badge">
    <img id="ratio" src="/seo-page/images/badge.png" alt="A badge with an aspect ratio">
    <div class="seo-page-spacer"></div>
    <img id="heavy" src="/seo-page/images/heavy.png" alt="A detailed photo" width="1000" height="700">`;

const fixture: PageFixture = {
    head: url => hreflangTags(url),
    body: url => `<section id="seo-page">${url.searchParams.has('many-links') ? '' : imagesHtml}${links(url)}</section>`,
    // A page without the usual head (no viewport, no lang) or in another language
    page: (url, embed) => url.searchParams.has('bare') || url.searchParams.has('lang') ? `<!doctype html>
<html${url.searchParams.has('lang') ? ` lang="${url.searchParams.get('lang')}"` : ''}>
<head><title>Plans for every team</title></head>
<body><main><h1>Plans</h1><p>Every plan includes the toolbar. <a href="/seo-page/${projectOf(url)}/ok">Read more</a></p></main>
${embed}
</body>
</html>` : undefined,
    css: '#ratio { width: 100px; aspect-ratio: 2 / 1; } .seo-page-spacer { height: 2500px; }',
    csp: (policy, url) => url.searchParams.has('blocked-links') ? policy.replace('connect-src \'self\' ', 'connect-src ') : policy,
    route: (url, request, response) => {
        // Every request comes here first, the page's own before its head is written
        if (request.headers.host) host = request.headers.host;
        const [, area, project, name] = url.pathname.split('/');
        if (area !== 'seo-page') return false;
        if (project === 'images') {
            const size = imageSizes[name ?? ''];
            if (!size) return false;
            let body = images.get(name!);
            if (!body) images.set(name!, body = png(...size));
            response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
            response.end(request.method === 'HEAD' ? undefined : body);
            return true;
        }
        requests.push(`${request.method} ${url.pathname}`);
        const page = (status: number, headers: Record<string, string> = {}) => {
            response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
            response.end(request.method === 'HEAD' ? undefined : `<!doctype html><title>${status}</title><p>${status}</p>`);
        };
        if (name === 'missing') page(404);
        else if (name === 'broken') page(500);
        else if (name === 'private') page(403);
        else if (name === 'moved') page(301, { Location: `/seo-page/${project}/ok` });
        else if (name === 'head-refused') page(request.method === 'HEAD' ? 405 : 200, request.method === 'HEAD' ? { Allow: 'GET' } : {});
        else if (name?.startsWith('item-')) {
            const count = slow.get(project!) ?? { now: 0, most: 0 };
            slow.set(project!, count);
            count.most = Math.max(count.most, ++count.now);
            setTimeout(() => {
                count.now--;
                page(200);
            }, 100);
        }
        else page(200);
        return true;
    }
};

export default fixture;
