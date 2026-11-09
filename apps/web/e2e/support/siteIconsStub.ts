import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

/*
 * Project sites for the icon tiles (`ProjectMark`). With `UIER_SITE_ICONS_TEST_UPSTREAM` the test server
 * (local runtime only) sends every site icon request here, the site's host in `Host`, instead of to
 * the internet. `icon.example.com` is set up like the site of uier #47: its address redirects to a
 * sign-in page that declares an SVG icon at a hashed path, and it has no `/favicon.ico`. Any other
 * host has no icon (an HTML not-found page for every path), so tiles show the project's letter.
 */

export const STUB_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3"/></svg>';

const iconSite: Record<string, { status: number; headers: Record<string, string>; body?: string }> = {
    '/': { status: 307, headers: { Location: '/sign-in' } },
    '/sign-in': { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: '<!doctype html><html><head><title>Sign in</title><link rel="icon" href="/_next/static/media/favicon.0a1b2c.svg" sizes="any" type="image/svg+xml"/></head><body>Sign in</body></html>' },
    '/_next/static/media/favicon.0a1b2c.svg': { status: 200, headers: { 'Content-Type': 'image/svg+xml' }, body: STUB_ICON_SVG }
};

const notFound = { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<!doctype html><html><head><title>Not found</title></head><body>Not found</body></html>' };

export async function startSiteIconsStub(port = 0) {
    const server: Server = createServer((request, response) => {
        const host = (request.headers.host ?? '').toLowerCase();
        // Playwright's readiness check asks the stub's own address
        if (host.startsWith('127.0.0.1:')) {
            response.writeHead(200, { 'Content-Type': 'text/plain' });
            response.end('Site icons stub');
            return;
        }
        const reply = host === 'icon.example.com' ? iconSite[request.url ?? ''] ?? notFound : notFound;
        response.writeHead(reply.status, reply.headers);
        response.end(reply.body);
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Stub address unavailable');
    return { url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid local site icons stub PORT');
    const stub = await startSiteIconsStub(port);
    process.on('SIGTERM', () => { void stub.close().then(() => process.exit(0)); });
    process.on('SIGINT', () => { void stub.close().then(() => process.exit(0)); });
}
