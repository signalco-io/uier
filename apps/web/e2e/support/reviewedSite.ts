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
export async function startReviewedSite(apiBaseUrl: string) {
    const csp = [
        'default-src \'self\'',
        ...cspSources(apiBaseUrl).map(({ directive, sources }) => `${directive} 'self' ${sources.join(' ')}`)
    ].join('; ');

    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://reviewed.localhost');
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

        const [, pathProject = '', ...pagePath] = url.pathname.split('/');
        // The project of /<code>/<page>; on other pages the review link's code (a project's main site)
        const projectId = pathProject || url.searchParams.get('toolbar-code') || '';
        const embed = url.searchParams.get('embed') === 'react'
            ? `<div id="root"></div>
    <script src="/react-app.js" data-project="${projectId}" data-src="${apiBaseUrl}/toolbar.js" defer></script>`
            : embedScript(apiBaseUrl, projectId);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp });
        response.end(`<!doctype html>
<html lang="en">
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reviewed site</title>
</head>
<body>
    <main>
        <h1>Pricing for ${pagePath.join('/') || 'home'}</h1>
        <p>A page on a site under review. Every plan includes the toolbar.</p>
    </main>
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
        close: () => new Promise<void>(resolve => server.close(() => resolve()))
    };
}
