import { crc32, deflateSync } from 'node:zlib';
import type { PageFixture } from './types';

// The SEO panel's Sharing and Structured data sections (packages/toolbar/docs/page-checks-seo-head.md),
// on `site.origin('fixture-seo-head')/<project>/<variant>`:
// - `complete`: Open Graph and X card tags with a 1200 × 630 image this fixture serves, and JSON-LD
//   (a WebSite, an Article and a BreadcrumbList in one `@graph`);
// - `broken`: two og:title tags, a relative og:image that is missing (404), an og:url that is not the
//   canonical link, an unknown twitter:card; an invalid JSON-LD block, an Article without what Google
//   recommends, a Product without offers, review or rating; and a microdata item;
// - `small`: a 120 × 120 og:image and no twitter:card; no structured data;
// - `blocked`: an og:image on another origin, which the site's CSP (`img-src 'self' data:`) blocks;
// - `noindex`: a page that asks not to be indexed, without sharing tags.

/** A real grey PNG of this size (8-bit greyscale), which the browser loads and measures */
function png(width: number, height: number) {
    const chunk = (type: string, data: Buffer) => {
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const checksum = Buffer.alloc(4);
        checksum.writeUInt32BE(crc32(body));
        return Buffer.concat([length, body, checksum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bit depth; colour type 0 (greyscale), default compression, filter and interlace
    const row = Buffer.alloc(width + 1, 0x99);
    row[0] = 0; // no filter
    const pixels = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

const images: Record<string, () => Buffer> = {
    '/share/card.png': () => png(1200, 630),
    '/share/small.png': () => png(120, 120)
};
const served = new Map<string, Buffer>();

/** The host of the request being answered (`route` runs first): the tags need full addresses */
let host = '';

const variant = (url: URL) => url.pathname.split('/').at(-1) ?? '';

const json = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

function head(url: URL) {
    const origin = `http://${host}`;
    const page = `${origin}${url.pathname}`;
    switch (variant(url)) {
        case 'complete': return `
    <meta name="description" content="Plans and prices for teams that review live websites, with comments pinned to the page.">
    <link rel="canonical" href="${page}">
    <meta property="og:title" content="Plans for review teams">
    <meta property="og:description" content="Every plan includes the toolbar and comments pinned to the page.">
    <meta property="og:image" content="${origin}/share/card.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="The plans side by side">
    <meta property="og:url" content="${page}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Reviewed site">
    <meta name="twitter:card" content="summary_large_image">
    ${json({
        '@context': 'https://schema.org',
        '@graph': [
            { '@type': 'WebSite', '@id': `${origin}/#website`, name: 'Reviewed site', url: `${origin}/` },
            { '@type': 'Article', headline: 'Plans for review teams', image: `${origin}/share/card.png`, datePublished: '2026-11-01',
                author: { '@type': 'Person', name: 'Ana Reviewer' }, isPartOf: { '@id': `${origin}/#website` } },
            { '@type': 'BreadcrumbList', itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
                { '@type': 'ListItem', position: 2, name: 'Plans' }
            ] }
        ]
    })}`;
        case 'broken': return `
    <meta name="description" content="A page whose sharing tags and structured data need a look before the launch.">
    <link rel="canonical" href="${page}">
    <meta property="og:title" content="Plans for review teams">
    <meta property="og:title" content="Pricing">
    <meta property="og:image" content="/share/missing.png">
    <meta property="og:url" content="${origin}/elsewhere">
    <meta name="twitter:card" content="large">
    <script type="application/ld+json">{ "@context": "https://schema.org", "@type": "Article", "headline": "Plans", }</script>
    ${json({ '@context': 'https://schema.org', '@type': 'Article', author: { '@type': 'Person', name: 'Ana Reviewer' } })}
    ${json({ '@context': 'https://schema.org', '@type': 'Product', name: 'Team plan' })}`;
        case 'small': return `
    <meta property="og:type" content="website">
    <meta property="og:title" content="Plans for review teams">
    <meta property="og:description" content="Every plan includes the toolbar and comments pinned to the page.">
    <meta property="og:image" content="${origin}/share/small.png">`;
        case 'blocked': return `
    <meta property="og:image" content="http://${host.replace(/^[^.:]+/, 'images')}/share/card.png">`;
        case 'noindex': return '<meta name="robots" content="noindex">';
        default: return '';
    }
}

const fixture: PageFixture = {
    head,
    body: url => variant(url) === 'broken'
        ? '<div itemscope itemtype="https://schema.org/Organization"><p>By <span itemprop="name">Reviewed site</span></p></div>'
        : '',
    route: (url, request, response) => {
        host = request.headers.host ?? '';
        const image = images[url.pathname];
        if (image) {
            const bytes = served.get(url.pathname) ?? image();
            served.set(url.pathname, bytes);
            response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
            response.end(bytes);
            return true;
        }
        if (url.pathname.startsWith('/share/')) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return true;
        }
        return false;
    }
};

export default fixture;
