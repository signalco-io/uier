import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { cspSources, embedScript, type EmbedVersion } from '../../src/lib/app/integration';

// Representative documents for the public HTML/React guides. This checks their installation
// contract with the real toolbar/API; it is not a WordPress, Webflow or Shopify account fixture.
export async function startGuideInstallationSite(apiOrigin: string, platform: 'html' | 'react') {
    let projectCode: string | undefined;
    let version: EmbedVersion = 'latest';
    const policy = ["default-src 'self'", ...cspSources(apiOrigin).map(({ directive, sources }) => `${directive} 'self' ${sources.join(' ')}`)].join('; ');
    const reactScript = platform === 'react' ? (await build({
        stdin: {
            contents: `import { createElement as h, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
function Site() {
    const [path, setPath] = useState(location.pathname);
    useEffect(() => {
        const back = () => setPath(location.pathname);
        addEventListener('popstate', back);
        return () => removeEventListener('popstate', back);
    }, []);
    return h('main', null,
        h('h1', { id: 'review-heading' }, path === '/' ? 'Menu' : 'About'),
        h('p', null, 'A fictional restaurant site.'),
        h('button', { type: 'button', onClick: () => {
            const next = path === '/' ? '/about' : '/';
            history.pushState(null, '', next);
            setPath(next);
        } }, 'Next page'));
}
createRoot(document.getElementById('app')).render(h(Site));`,
            loader: 'js',
            resolveDir: dirname(fileURLToPath(import.meta.url))
        },
        bundle: true, format: 'iife', platform: 'browser', minify: true, write: false,
        define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent'
    })).outputFiles[0]!.text : '';
    const server = createServer((request, response) => {
        const path = new URL(request.url ?? '/', 'http://installation.localhost').pathname;
        if (path === '/site.js') {
            response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
            response.end(reactScript);
            return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': policy, 'Cache-Control': 'no-store' });
        response.end(`<!doctype html><html lang="en"><head>
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Installation guide fixture</title>
</head><body>
${platform === 'react' ? '<div id="app"></div><script src="/site.js" defer></script>'
    : `<main><h1 id="review-heading">${path === '/' ? 'Menu' : 'About'}</h1><p>A fictional restaurant site.</p><a href="${path === '/' ? '/about' : '/'}">Next page</a></main>`}
${projectCode ? embedScript(apiOrigin, projectCode, version) : ''}
</body></html>`);
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    return {
        origin: `http://installation.localhost:${(server.address() as AddressInfo).port}`,
        install: (code: string, selectedVersion: EmbedVersion = 'latest') => { projectCode = code; version = selectedVersion; },
        remove: () => { projectCode = undefined; },
        close: () => new Promise<void>(resolve => server.close(() => resolve()))
    };
}
