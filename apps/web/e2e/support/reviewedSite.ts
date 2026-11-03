import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { cspSources, embedScript } from '../../src/lib/app/integration';

let reactApp: Promise<string> | undefined;

/**
 * The script of a React site that renders `<UierToolbar project src />` from `@uier/toolbar/react`
 * (the built `dist/react.js`, with React and react-dom bundled like a site's bundler would). The
 * props come from the script tag's `data-project` and `data-src`.
 */
function buildReactApp() {
    reactApp ??= build({
        stdin: {
            contents: [
                'import { createElement } from \'react\';',
                'import { createRoot } from \'react-dom/client\';',
                'import { UierToolbar } from \'@uier/toolbar/react\';',
                'const { project, src } = document.currentScript.dataset;',
                'createRoot(document.getElementById(\'root\')).render(createElement(UierToolbar, { project, src }));'
            ].join('\n'),
            resolveDir: dirname(fileURLToPath(import.meta.url)),
            loader: 'js'
        },
        bundle: true,
        format: 'iife',
        platform: 'browser',
        minify: true,
        define: { 'process.env.NODE_ENV': '"production"' },
        write: false,
        logLevel: 'silent'
    }).then(result => result.outputFiles[0]!.text);
    return reactApp;
}

/**
 * A reviewed site on another origin than the app: `http://<label>.localhost:<port>/<project code>/<page>`
 * (or any page with `?toolbar-code=<project code>`) serves a page with the project's embed script
 * from the install guide, and sends a
 * Content-Security-Policy with exactly the install guide's sources. `<label>.localhost` is a
 * loopback origin, another site than the app on 127.0.0.1 (Chromium does not let a page fulfilled
 * by `page.route` or on a public address load scripts from loopback). With `?embed=react` the page
 * is a React app that adds the toolbar with its React component instead (`/react-app.js`).
 */
const layouts: Record<string, string> = {
    'html-scroll': 'html { overflow-y: scroll; } body { margin: 0 16px; }',
    'body-hidden': 'html, body { height: 100%; } body { margin: 0 16px; overflow-x: hidden; }'
};

/** `?sections=<n>` (at most 1,000): a longer page, like a real one, under a sticky header with a fixed badge (#319) */
const longPageCss = `
    .site-header { position: sticky; top: 0; z-index: 1; display: flex; gap: 12px; padding: 8px 16px; background: rgb(250, 236, 180); }
    .site-badge { position: fixed; right: 16px; bottom: 16px; padding: 4px 8px; border-radius: 4px; background: rgb(190, 30, 60); color: rgb(255, 255, 255); }
    .card { margin: 12px 0; padding: 12px 16px; border: 1px solid rgb(210, 210, 220); border-radius: 8px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }
    .card h2 { margin: 0 0 4px; font-size: 18px; }
    .card h2::before { content: '§ '; color: rgb(120, 120, 140); }
    .card p { margin: 0; }`;

function sectionCount(url: URL) {
    return Math.min(1_000, Math.max(0, Number.parseInt(url.searchParams.get('sections') ?? '', 10) || 0));
}

function longPage(count: number) {
    return Array.from({ length: count }, (_, i) => `<section class="card" id="section-${i + 1}"><h2>Plan section ${i + 1}</h2><p>Details of this part of the plan, with <a href="#section-${i + 1}">a link to it</a>.</p></section>`).join('');
}

export async function startReviewedSite(apiBaseUrl: string) {
    const csp = [
        'default-src \'self\'',
        ...cspSources(apiBaseUrl).map(({ directive, sources }) => `${directive} 'self' ${sources.join(' ')}`)
    ].join('; ');

    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://reviewed.localhost');
        if (url.pathname === '/host.css') {
            response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
            response.end(`${layouts[url.searchParams.get('layout') ?? ''] ?? ''}
                ${sectionCount(url) ? longPageCss : ''}
                ${url.searchParams.has('host-dialog') ? `
                    dialog { transform: translateY(0); overflow: hidden; }
                    ::backdrop { background: rgba(0, 0, 0, 0.4); }
                ` : ''}
                ${url.searchParams.has('host-probe') ? `
                    body { color: rgb(30, 40, 50); font-family: monospace; text-transform: uppercase; letter-spacing: 3px; }
                    button { background: rgb(220, 230, 240) !important; color: rgb(30, 40, 50) !important; border-radius: 0 !important; }
                ` : ''}`);
            return;
        }
        if (url.pathname === '/host-probe.js') {
            response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
            response.end(`const probe = document.querySelector('#host-probe');
                probe.addEventListener('click', (event) => {
                    probe.dataset.clicks = String(Number(probe.dataset.clicks || 0) + 1);
                    requestAnimationFrame(() => {
                        performance.measure('host-click-to-frame', { start: event.timeStamp, end: performance.now() });
                    });
                });`);
            return;
        }
        if (url.pathname === '/host-dialog.js') {
            // A native modal the way sites write one: showModal(), a close button, and a click
            // outside the dialog's box (on its backdrop) that closes it too
            response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
            response.end(`const dialog = document.querySelector('#host-dialog');
                document.querySelector('#host-dialog-open').addEventListener('click', () => dialog.showModal());
                dialog.querySelector('#host-dialog-close').addEventListener('click', () => dialog.close());
                dialog.addEventListener('click', (event) => {
                    const box = dialog.getBoundingClientRect();
                    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
                });`);
            return;
        }
        if (url.pathname === '/react-app.js') {
            buildReactApp().then((script) => {
                response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
                response.end(script);
            }, (error: unknown) => {
                response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                response.end(String(error));
            });
            return;
        }

        const label = request.headers.host?.split('.')[0];
        if (label === 'redirect-denied') {
            response.writeHead(302, { Location: `http://denied.localhost:${request.headers.host?.split(':').at(-1)}${url.pathname}${url.search}` });
            response.end();
            return;
        }
        const [, pathProject = '', ...pagePath] = url.pathname.split('/');
        // `strict-slash.localhost` serves pages only at their trailing-slash address: `/<code>/plans/`, not `/<code>/plans`
        if (label === 'strict-slash' && pagePath.length && !url.pathname.endsWith('/')) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
        }
        // The project of /<code>/<page>; on other pages the review link's code (a project's main site)
        const projectId = pathProject || url.searchParams.get('toolbar-code') || '';
        const embed = label === 'missing-script' ? '' : label === 'wrong-project' ? embedScript(apiBaseUrl, 'zzzzzzzzzzzz')
            : label === 'wrong-api' ? embedScript(apiBaseUrl, projectId).replace(' defer', ' data-uier-api-url="https://wrong-api.example" defer') : url.searchParams.get('embed') === 'react'
            ? `<div id="root"></div>
    <script src="/react-app.js" data-project="${projectId}" data-src="${apiBaseUrl}/toolbar.js" defer></script>`
            : embedScript(apiBaseUrl, projectId);
        // `?layout=html-scroll` or `?layout=body-hidden`: a long page with CSS that makes a copy of the
        // page clip itself (`<html>` or `<body>` as a scroll box), and a lazy image below the window
        const layout = layouts[url.searchParams.get('layout') ?? ''];
        const sections = sectionCount(url);
        const policy = label === 'blocked-connect' ? csp.replace(/connect-src [^;]+/, "connect-src 'self'")
            : label === 'blocked-frame' ? csp.replace(/frame-src [^;]+/, "frame-src 'self'") : csp;
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': policy });
        response.end(`<!doctype html>
<html lang="en">
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reviewed site</title>
    <link rel="stylesheet" href="/host.css?${url.searchParams.toString()}">
</head>
<body>
    ${sections ? '<header class="site-header"><strong>Reviewed site</strong><a href="#plans">Plans</a><a href="#docs">Docs</a></header>' : ''}
    <main>
        <h1>Pricing for ${pagePath.join('/') || 'home'}</h1>
        <p>A page on a site under review. Every plan includes the toolbar.</p>
        ${url.searchParams.has('host-probe') ? '<button id="host-probe" type="button">Host interaction</button><input aria-label="Host input"><script src="/host-probe.js" defer></script>' : ''}
        ${url.searchParams.has('host-dialog') ? `<button id="host-dialog-open" type="button">Read the project brief</button>
        <dialog id="host-dialog" aria-labelledby="host-dialog-title">
            <h2 id="host-dialog-title">Project brief</h2>
            <p>Check the checkout copy before the launch on Friday.</p>
            <label>Discount code <input name="code"></label>
            <button id="host-dialog-close" type="button">Close brief</button>
        </dialog>
        <script src="/host-dialog.js" defer></script>` : ''}
        ${layout ? Array.from({ length: 40 }, (_, i) => `<p id="row-${i + 1}">Row ${i + 1}: every plan includes the toolbar, and this row is here to make the page long.</p>`).join('') : ''}
        ${layout ? '<img loading="lazy" src="/lazy-image.png" width="40" height="40" alt="">' : ''}
        ${longPage(sections)}
    </main>
    ${sections ? '<div class="site-badge">Beta</div>' : ''}
    ${embed}
</body>
</html>`);
    });
    // All interfaces (IPv4 and IPv6), whichever loopback address `<label>.localhost` resolves to
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    return {
        /** `http://<label>.localhost:<port>` */
        origin: (label = 'reviewed') => `http://${label}.localhost:${port}`,
        /** A separate server/port without wildcard DNS, for Firefox and WebKit engine checks. */
        loopbackOrigin: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>(resolve => server.close(() => resolve()))
    };
}
