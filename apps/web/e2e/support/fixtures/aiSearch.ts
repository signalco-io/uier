import type { PageFixture } from './types';

// The SEO panel's AI search section (page-checks-ai-search.spec.ts): an article in a `main` with
// headings, a list, a table, a quote, code, a link to another site (with a query to leave out), an
// image with and one without alt text, a hidden block, a closed accordion and a frame, and JSON-LD with
// an author and a published date that disagrees with the visible `<time>`. `?no-main`: a page without
// a main landmark or article, its content between the site's navigation, aside, form and footer.

/** A 1 × 1 PNG */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'Reviewing websites',
    author: { '@type': 'Person', name: 'Ada Lovelace' },
    datePublished: '2026-05-01',
    publisher: { '@type': 'Organization', name: 'Example Reviews' }
});

const article = (embed: string) => `<!doctype html>
<html lang="en">
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reviewing websites with comments</title>
    <meta name="description" content="A short guide to reviewing a live website by leaving comments pinned to its elements.">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Example Reviews">
    <script type="application/ld+json">${structuredData}</script>
</head>
<body>
    <header><nav><a href="/">Home</a> <a href="/plans">Plans</a></nav></header>
    <main>
        <article>
            <h1>Reviewing websites</h1>
            <p>Published <time datetime="2026-03-04">4 March 2026</time> by Ada Lovelace.</p>
            <p>A <strong>short</strong> guide with <a href="https://example.org/source?token=secret">a source</a>.</p>
            <h2>Steps</h2>
            <ul>
                <li>Open the page</li>
                <li>Leave a comment<ul><li>On an element</li></ul></li>
            </ul>
            <table>
                <thead><tr><th>Plan</th><th>Price</th></tr></thead>
                <tbody><tr><td>Free</td><td>0</td></tr></tbody>
            </table>
            <blockquote><p>Say it on the page.</p></blockquote>
            <pre><code>npm install</code></pre>
            <img src="/chart.png" alt="Plans chart" width="40" height="40">
            <img id="no-alt" src="/photo.png" width="40" height="40">
            <div hidden><p>This text is in a tab panel that is closed right now.</p></div>
            <details><summary>More plans</summary><p>Enterprise plans are available on request.</p></details>
            <iframe src="/frame.html" title="Map" width="120" height="60"></iframe>
        </article>
    </main>
    <footer><p>Example Reviews, all rights kept.</p></footer>
    ${embed}
</body>
</html>`;

const withoutMain = (embed: string) => `<!doctype html>
<html lang="en">
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Plans</title>
</head>
<body>
    <header><nav><a href="/">Home</a> <a href="/plans">Plans</a></nav></header>
    <div class="content">
        <h1>Plans</h1>
        <p>Every plan includes the toolbar.</p>
    </div>
    <aside><p>Related reading for later.</p></aside>
    <form><label>Email <input name="email"></label> <button type="button">Subscribe</button></form>
    <footer><p>Example Reviews, all rights kept.</p></footer>
    ${embed}
</body>
</html>`;

const fixture: PageFixture = {
    page: (url, embed) => url.searchParams.has('no-main') ? withoutMain(embed) : article(embed),
    route: (url, _request, response) => {
        if (url.pathname === '/chart.png' || url.pathname === '/photo.png') {
            response.writeHead(200, { 'Content-Type': 'image/png' });
            response.end(png);
            return true;
        }
        if (url.pathname === '/frame.html') {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end('<!doctype html><title>Map</title><p>A map of the office.</p>');
            return true;
        }
        return false;
    }
};

export default fixture;
