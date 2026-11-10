import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PageFixture } from './types';

// The SEO panel's Crawlers section (packages/toolbar/docs/page-checks-crawler.md) on its own origin,
// `fixture-crawler`: robots.txt, a sitemap index, llms.txt and these pages after the project's code
// (`/<code>/<page>`):
// - `listed`: the usual page, in the sitemap (with a trailing slash) and in llms.txt
// - `unlisted`, `drafts`: the usual page, not in the sitemap; robots.txt blocks search crawlers from `drafts`
// - `script`: its h1, most of its text, its links and its meta description are added by `/crawler.js`
// - `noindex`: an `X-Robots-Tag: noindex` header, and a robots meta tag that allows indexing
// - `private`: a request that is not a navigation (the toolbar's, like a crawler's) is redirected to
//   `/login`, like a sign-in the reviewer is past
// - `missing`: a request that is not a navigation gets 404, like a single-page app's server
// - `csp`: a Content-Security-Policy whose `connect-src` leaves the site's own origin out

/** The project codes whose pages the site served: its sitemap and llms.txt list their `listed` page */
const projects = new Set<string>();

const pageName = (url: URL) => url.pathname.split('/')[2] ?? '';

function send(response: ServerResponse, type: string, body: string, status = 200) {
    response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
    response.end(body);
}

const robots = (origin: string) => `# Search crawlers may read every page but the drafts
User-agent: *
Disallow: /*/drafts
Allow: /*/drafts/published$

User-agent: Googlebot
User-agent: bingbot
Crawl-delay: 1
Disallow: /*/drafts

# Two AI crawlers may read nothing
User-agent: GPTBot
User-agent: CCBot
Disallow: /

Sitemap: ${origin}/sitemap.xml
`;

const sitemapIndex = (origin: string) => `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap><loc>${origin}/sitemaps/pages.xml</loc></sitemap>
    <sitemap><loc>${origin}/sitemaps/posts.xml</loc></sitemap>
</sitemapindex>
`;

const urlset = (locations: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locations.map(location => `    <url><loc>${location}</loc></url>`).join('\n')}
</urlset>
`;

const llms = (origin: string) => `# Reviewed site

> A site under review.

## Pages

${[...projects].map(code => `- [Plans](${origin}/${code}/listed): every plan`).join('\n')}
`;

/** Renders the `script` page in the browser: what its server leaves out */
const script = `const app = document.getElementById('app');
app.innerHTML = '<h1>Plans rendered in the browser</h1>'
    + '<p>Every plan of the reviewed site comes with the review toolbar, comments pinned to the page and an inbox for the whole team.</p>'
    + '<p>The team plan adds assignments, priorities and a weekly summary, so nothing that reviewers find gets lost between releases.</p>'
    + '<p>Prices are per month and billed yearly. Changing plans keeps every comment, screenshot and reply that the project has.</p>'
    + '<nav><a href="/plans/basic">Basic</a> <a href="/plans/team">Team</a> <a href="/plans/business">Business</a></nav>';
const description = document.createElement('meta');
description.name = 'description';
description.content = 'Plans and prices of the reviewed site, rendered in the browser.';
document.head.append(description);
`;

/** A navigation of the browser, not a request from a page's script (the toolbar's, which asks like a crawler) */
const isNavigation = (request: IncomingMessage) => request.headers['sec-fetch-mode'] === 'navigate' || request.headers['upgrade-insecure-requests'] === '1';

const fixture: PageFixture = {
    head: url => pageName(url) === 'noindex' ? '<meta name="robots" content="index, follow">' : '',
    headers: (url): Record<string, string> => {
        const code = url.pathname.split('/')[1] ?? '';
        if (/^[\w-]{12,21}$/.test(code)) projects.add(code);
        return pageName(url) === 'noindex' ? { 'X-Robots-Tag': 'noindex' } : {};
    },
    csp: (policy, url) => pageName(url) === 'csp' ? policy.replace(/connect-src 'self' /, 'connect-src ') : policy,
    page: (url, embed) => pageName(url) !== 'script' ? undefined : `<!doctype html>
<html lang="en">
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reviewed site</title>
    <link rel="stylesheet" href="/host.css">
</head>
<body>
    <main id="app"><p>Loading the plans.</p></main>
    <footer><p>Reviewed site, every plan reviewed.</p></footer>
    <script src="/crawler.js" defer></script>
    ${embed}
</body>
</html>`,
    route: (url, request, response) => {
        const origin = `http://${request.headers.host ?? ''}`;
        switch (url.pathname) {
            case '/robots.txt': send(response, 'text/plain', robots(origin)); return true;
            case '/sitemap.xml': send(response, 'application/xml', sitemapIndex(origin)); return true;
            case '/sitemaps/pages.xml': send(response, 'application/xml', urlset([...projects].map(code => `${origin}/${code}/listed/`))); return true;
            case '/sitemaps/posts.xml': send(response, 'application/xml', urlset([`${origin}/blog/first-post`])); return true;
            case '/llms.txt': send(response, 'text/plain', llms(origin)); return true;
            case '/crawler.js': send(response, 'text/javascript', script); return true;
        }
        if (isNavigation(request)) return false;
        if (pageName(url) === 'private') {
            response.writeHead(302, { Location: `${origin}/login` });
            response.end();
            return true;
        }
        if (pageName(url) === 'missing') {
            send(response, 'text/html', '<!doctype html><title>Not found</title><h1>Not found</h1>', 404);
            return true;
        }
        return false;
    }
};

export default fixture;
