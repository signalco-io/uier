import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cspSources, embedScript } from '../../src/lib/app/integration';

/**
 * A reviewed site on another origin than the app: `http://<label>.localhost:<port>/<project code>/<page>`
 * (or any page with `?toolbar-code=<project code>`) serves a page with the project's embed script
 * from the install guide, and sends a
 * Content-Security-Policy with exactly the install guide's sources. `<label>.localhost` is a
 * loopback origin, another site than the app on 127.0.0.1 (Chromium does not let a page fulfilled
 * by `page.route` or on a public address load scripts from loopback).
 */
export async function startReviewedSite(apiBaseUrl: string) {
    const csp = [
        'default-src \'self\'',
        ...cspSources(apiBaseUrl).map(({ directive, sources }) => `${directive} 'self' ${sources.join(' ')}`)
    ].join('; ');

    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://reviewed.localhost');
        const [, pathProject = '', ...pagePath] = url.pathname.split('/');
        // The project of /<code>/<page>; on other pages the review link's code (a project's main site)
        const projectId = pathProject || url.searchParams.get('toolbar-code') || '';
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
    ${embedScript(apiBaseUrl, projectId)}
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
