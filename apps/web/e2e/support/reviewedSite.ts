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

/**
 * `?page-checks`: what the toolbar's Accessibility and SEO panels report: an h3 right after the h1,
 * an image without alt text, a script link, a link to a missing #faq and a link without text (the
 * page also has no meta description or canonical link). A 1 × 1 PNG, allowed by `img-src data:`.
 */
const pageCheckImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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
                ${url.searchParams.has('host-menus') ? `
                    .host-menus { display: flex; gap: 24px; align-items: flex-start; margin: 24px 0 160px; }
                    .host-dropdown, .host-hover { position: relative; }
                    #host-menu, .host-hover-menu { position: absolute; top: 100%; left: 0; z-index: 50; display: grid; gap: 4px; padding: 8px; background: white; border: 1px solid; }
                    #host-menu { pointer-events: auto; }
                    #host-menu[hidden], .host-hover:not(:hover) .host-hover-menu { display: none; }
                    #host-popover p { margin: 0; }
                    #host-sheet { display: none; position: fixed; right: 16px; bottom: 96px; padding: 12px; background: white; border: 1px solid; }
                    #host-sheet.open { display: block; }
                ` : ''}
                ${url.searchParams.has('page-checks') ? '#empty-link { display: inline-block; width: 24px; height: 24px; background: rgb(40, 40, 40); }' : ''}
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
        if (url.pathname === '/host-menus.js') {
            // A menu the way UI libraries write a modal one: focus moves into it, letters choose an item,
            // the rest of the page takes no presses and is hidden from assistive technologies, and it
            // closes on a press, focus or Escape outside it (on the document, so the toolbar's shadow
            // root counts as outside unless the toolbar is in the menu) and when an item is chosen
            response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
            response.end(`const trigger = document.querySelector('#host-menu-open');
                const menu = document.querySelector('#host-menu');
                const items = [...menu.querySelectorAll('[role=menuitem]')];
                let hidden = [];
                const setOpen = (open) => {
                    if (open === !menu.hidden) return;
                    menu.hidden = !open;
                    trigger.setAttribute('aria-expanded', String(open));
                    document.body.style.pointerEvents = open ? 'none' : '';
                    if (open) {
                        hidden = [...document.body.children].filter(element => !element.contains(menu) && !element.hasAttribute('aria-hidden'));
                        for (const element of hidden) element.setAttribute('aria-hidden', 'true');
                        items[0].focus();
                    } else {
                        for (const element of hidden) element.removeAttribute('aria-hidden');
                        hidden = [];
                    }
                };
                trigger.addEventListener('click', () => setOpen(menu.hidden));
                document.addEventListener('pointerdown', (event) => {
                    if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) setOpen(false);
                });
                document.addEventListener('focusin', (event) => {
                    if (!menu.hidden && !menu.contains(event.target) && event.target !== trigger) setOpen(false);
                });
                document.addEventListener('keydown', (event) => {
                    if (!menu.hidden && event.key === 'Escape') { setOpen(false); trigger.focus(); }
                });
                menu.addEventListener('keydown', (event) => {
                    if (event.key.length !== 1) return;
                    const item = items.find(item => item.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
                    if (item) { event.preventDefault(); item.focus(); }
                });
                menu.addEventListener('click', (event) => {
                    const item = event.target.closest('[role=menuitem]');
                    if (!item) return;
                    document.body.dataset.chosen = item.dataset.action;
                    setOpen(false);
                });
                // A script dialog shown and hidden with a class, its \`aria-modal\` always set
                const sheet = document.querySelector('#host-sheet');
                document.querySelector('#host-sheet-open').addEventListener('click', () => {
                    sheet.classList.add('open');
                    sheet.querySelector('#host-sheet-close').focus();
                });
                sheet.querySelector('#host-sheet-close').addEventListener('click', () => sheet.classList.remove('open'));`);
            return;
        }
        if (url.pathname === '/host-frame.html') {
            // An embedded frame (a map, a video) whose whole window is a button that counts its presses
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(`<!doctype html><html><body style="margin:0"><button id="frame-button" type="button" style="width:100vw;height:100vh">Zoom in</button>
                <script src="/host-frame.js"></script></body></html>`);
            return;
        }
        if (url.pathname === '/host-frame.js') {
            response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
            response.end(`document.querySelector('#frame-button').addEventListener('click', () => {
                document.body.dataset.clicks = String(Number(document.body.dataset.clicks || 0) + 1);
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
        if (url.pathname === '/anchor-layers.js') {
            build({ entryPoints: [fileURLToPath(new URL('./anchorLayers.tsx', import.meta.url))], bundle: true,
                platform: 'browser', format: 'iife', jsx: 'automatic', write: false,
                define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent'
            }).then(result => {
                response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
                response.end(result.outputFiles[0]!.text);
            }, () => { response.writeHead(500); response.end(); });
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
        ${url.searchParams.has('host-anchors') ? '<div id="anchor-layers"></div><script src="/anchor-layers.js" defer></script>' : ''}
        ${url.searchParams.has('host-menus') ? `<div class="host-menus">
            <div class="host-dropdown">
                <button id="host-menu-open" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="host-menu">Account</button>
                <div id="host-menu" role="menu" aria-labelledby="host-menu-open" hidden>
                    <button type="button" role="menuitem" data-action="profile">Edit profile</button>
                    <button type="button" role="menuitem" data-action="sign-out">Sign out</button>
                </div>
            </div>
            <button id="host-popover-open" type="button" popovertarget="host-popover">Shipping details</button>
            <div id="host-popover" popover><p>Orders ship within two days.</p></div>
            <div class="host-hover"><span>Help</span><div class="host-hover-menu"><a href="#contact">Contact support</a></div></div>
            <iframe id="host-frame" title="Store map" src="/host-frame.html" width="240" height="120"></iframe>
            <button id="host-sheet-open" type="button">Chat with us</button>
        </div>
        <div id="host-sheet" role="dialog" aria-modal="true" aria-label="Chat"><p>We reply within a day.</p><button id="host-sheet-close" type="button">Close chat</button></div>
        <script src="/host-menus.js" defer></script>` : ''}
        ${url.searchParams.has('page-checks') ? `<section id="page-checks">
            <h3>Plans in detail</h3>
            <img id="plan-chart" src="${pageCheckImage}" width="48" height="48">
            <p><a id="compare-plans" href="javascript:void(0)">Compare plans</a> or <a id="missing-anchor" href="#faq">read the questions</a>.</p>
            <a id="empty-link" href="/plans"></a>
        </section>` : ''}
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
