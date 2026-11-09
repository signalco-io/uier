import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { GET as readIcon } from '../app/api/projects/[projectId]/icon/route';
import { projectIconUrl } from '../src/components/app/projects/ProjectMark';
import type { AppContext } from '../src/lib/app/context';
import { createProject } from '../src/lib/app/projects';
import { SESSION_TTL_SECONDS } from '../src/lib/app/sessionIdentity';
import { getSiteIcon, iconLinks, iconType, isFetchableUrl, MAX_ICON_BYTES, resolveSiteIcon } from '../src/lib/app/siteIcons';
import { signToken } from '../src/lib/app/tokens';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace } from '../src/lib/app/workspaces';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { publicLookup } from '../src/lib/mcp/publicNetwork';

// uier #47: a project's tile shows its site's favicon even when the site declares it at its own path
// (`<link rel="icon">`), not at `/favicon.ico`. Sites are served on 127.0.0.1; `*.icons.test` names
// reach them through a test lookup, every other name through the production `publicLookup`.

const originalEnv = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_SITE_ICONS_TEST_UPSTREAM: process.env.UIER_SITE_ICONS_TEST_UPSTREAM };
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; });
test.afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

type Handler = (request: IncomingMessage, response: ServerResponse) => void;
type Site = Record<string, Handler>;

const lookup: typeof publicLookup = (hostname, options, callback) => {
    if (!hostname.endsWith('.icons.test'))
        return publicLookup(hostname, options, callback);
    if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
    else callback(null, '127.0.0.1', 4);
};

/** A server for several sites, told apart by `Host`; it records every request it receives */
async function sitesServer(handle?: Handler) {
    const sites = new Map<string, Site>();
    const requests: { host: string; path: string }[] = [];
    const server: Server = createServer((request, response) => {
        const host = (request.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
        requests.push({ host, path: request.url ?? '' });
        if (handle) return handle(request, response);
        const handler = sites.get(host)?.[request.url ?? ''];
        if (handler) return handler(request, response);
        response.writeHead(404, { 'Content-Type': 'text/html' });
        response.end('<!doctype html><html><head><title>Not found</title></head><body>Not found</body></html>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    return {
        port, requests,
        /** A new host name of this server with its pages; returns the site's address */
        site(name: string, pages: Site) {
            const host = `${name}-${randomUUID().slice(0, 8)}.icons.test`;
            sites.set(host, pages);
            return { host, url: `http://${host}:${port}` };
        },
        /** A site of this server under a fixed host name (the route test's project address) */
        add(host: string, pages: Site) { sites.set(host, pages); },
        close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })
    };
}

const page = (head: string, { status = 200, gzip = false } = {}): Handler => (_, response) => {
    const body = Buffer.from(`<!doctype html><html><head><meta charset="utf-8">${head}</head><body><p>Site</p></body></html>`);
    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
    response.end(gzip ? gzipSync(body) : body);
};
const file = (body: Buffer | string, type: string, status = 200): Handler => (_, response) => {
    response.writeHead(status, { 'Content-Type': type, 'Content-Length': String(Buffer.byteLength(body)) });
    response.end(body);
};
const redirect = (location: string, status = 307): Handler => (_, response) => {
    response.writeHead(status, { Location: location });
    response.end();
};

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>';
const png = (size = 64) => sharp({ create: { width: size, height: size, channels: 4, background: { r: 30, g: 90, b: 200, alpha: 1 } } }).png().toBuffer();
/** An ICO file holding one PNG image, as most current `favicon.ico` files do */
function ico(image: Buffer) {
    const header = Buffer.alloc(22);
    header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
    header.writeUInt8(32, 6); header.writeUInt8(32, 7); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
    header.writeUInt32LE(image.length, 14); header.writeUInt32LE(22, 18);
    return Buffer.concat([header, image]);
}

let server: Awaited<ReturnType<typeof sitesServer>>;
test.beforeAll(async () => { server = await sitesServer(); });
test.afterAll(async () => { await server.close(); });

test('the icons a page declares are read best first: icons before touch icons, light before dark, scalable and larger first', () => {
    const html = `<!doctype html><html><head>
        <base href="/app/"><base href="https://elsewhere.example/">
        <!-- <link rel="icon" href="/commented.png"> -->
        <script>document.write('<link rel="icon" href="/scripted.png">')</script>
        <link rel="apple-touch-icon" href="/touch.png">
        <LINK REL="shortcut icon" HREF=favicon.ico>
        <link rel='icon' type='image/png' sizes='16x16' href='/16.png?v=1&amp;size=16#top'>
        <link rel="icon" sizes="192x192" href="//cdn.example.net/192.png">
        <link rel="icon" href="/dark.svg" media="(prefers-color-scheme: dark)">
        <link title="a > b" rel="icon" href="/light.svg" type="image/svg+xml">
        <link rel="icon" href="javascript:alert(1)">
        <link rel="stylesheet" href="/style.css">
        <link rel="mask-icon" href="/mask.svg">
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
        </head><body></body></html>`;
    expect(iconLinks(html, 'https://site.example/pricing')).toEqual([
        'https://site.example/light.svg',
        new URL('data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E').href,
        'https://cdn.example.net/192.png',
        // Relative to the first `<base href>`
        'https://site.example/app/favicon.ico',
        // Entities decoded, fragment dropped
        'https://site.example/16.png?v=1&size=16',
        'https://site.example/dark.svg',
        'https://site.example/touch.png'
    ]);
    expect(iconLinks('<html><head><title>No icons</title></head></html>', 'https://site.example/')).toEqual([]);
});

test('icons are recognized by their bytes, never by the type a site declares', async () => {
    const image = await png();
    expect(iconType(image)).toBe('image/png');
    expect(iconType(ico(image))).toBe('image/x-icon');
    expect(iconType(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1'))).toBe('image/gif');
    expect(iconType(await sharp(image).jpeg().toBuffer())).toBe('image/jpeg');
    expect(iconType(await sharp(image).webp().toBuffer())).toBe('image/webp');
    expect(iconType(Buffer.from(svg))).toBe('image/svg+xml');
    expect(iconType(Buffer.from(`﻿<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${svg}`))).toBe('image/svg+xml');
    // What a site serves for a missing icon
    for (const other of ['<!doctype html><html><head><title>Not found</title></head></html>', '{"error":"not found"}', 'Not found', ''])
        expect(iconType(Buffer.from(other)), other).toBeNull();
});

test('requests go only to public HTTP(S) hosts on the default ports or the address\'s own', () => {
    const allowed = (url: string, ports?: number[]) => isFetchableUrl(new URL(url), ports && new Set(ports));
    expect(allowed('https://uredan.com/')).toBe(true);
    expect(allowed('http://app.uredan.com/sign-in')).toBe(true);
    expect(allowed('https://93.184.215.14/')).toBe(true);
    expect(allowed('https://staging.example.com:8443/', [80, 443, 8443])).toBe(true);
    for (const url of ['https://staging.example.com:8443/', 'http://localhost/', 'http://app.localhost/', 'http://intranet/',
        'http://127.0.0.1/', 'http://10.1.2.3/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
        'http://[fd00::1]/', 'http://0x7f000001/', 'ftp://example.com/favicon.ico', 'https://user:secret@example.com/', 'file:///etc/passwd'])
        expect(allowed(url), url).toBe(false);
});

test('an icon a page declares at its own path is found behind redirects (uier #47)', async () => {
    // Like app.uredan.com: the address redirects to sign-in, which declares a hashed SVG; there is no /favicon.ico
    const www = server.site('www', {
        '/': redirect('/sign-in', 302),
        '/sign-in': page('<link rel="icon" href="/_next/static/immutable/media/favicon.0_0ic.svg" sizes="any" type="image/svg+xml"/><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" sizes="180x180"/>'),
        '/_next/static/immutable/media/favicon.0_0ic.svg': file(svg, 'text/plain')
    });
    const app = server.site('app', { '/': redirect(`${www.url}/`, 301) });
    const found = await resolveSiteIcon(`${app.url}`, { lookup });
    expect(found?.contentType).toBe('image/svg+xml');
    expect(found?.data.toString()).toBe(svg);

    // Like uredan.com: a generated PNG at /icon?<hash>, served with a generic type
    const image = await png();
    const site = server.site('generated', {
        '/': page('<link rel="icon" href="/icon?81b6fc1aef7c0b86" type="image/png" sizes="64x64"/>'),
        '/icon?81b6fc1aef7c0b86': file(image, 'application/octet-stream')
    });
    expect(await resolveSiteIcon(site.url, { lookup })).toEqual({ data: image, contentType: 'image/png' });
    expect(server.requests.filter(request => request.host === site.host).map(request => request.path)).toEqual(['/', '/icon?81b6fc1aef7c0b86']);
});

test('missing icons and pages served in their place are skipped, then the usual paths are tried', async () => {
    const image = await png(32);
    const declared = server.site('declared', {
        '/': page('<link rel="icon" href="/missing.png"><link rel="icon" href="/soft-404.png">', { gzip: true }),
        '/soft-404.png': page('<title>Not found</title>'),
        '/favicon.ico': file(ico(image), 'image/vnd.microsoft.icon')
    });
    expect(await resolveSiteIcon(declared.url, { lookup })).toEqual({ data: ico(image), contentType: 'image/x-icon' });
    expect(server.requests.filter(request => request.host === declared.host).map(request => request.path)).toEqual(['/', '/missing.png', '/soft-404.png', '/favicon.ico']);

    // A page that fails, a single-page app's HTML for every path, then a touch icon
    const spa = server.site('spa', {
        '/': file('Internal error', 'text/plain', 500),
        '/favicon.ico': page('<title>App</title>'),
        '/apple-touch-icon.png': file(image, 'image/png')
    });
    expect(await resolveSiteIcon(spa.url, { lookup })).toEqual({ data: image, contentType: 'image/png' });

    // An icon in the page itself
    const inline = server.site('inline', { '/': page(`<link rel="icon" href='data:image/svg+xml,${svg.replace('width="16"', 'width="100%"')}'>`) });
    expect((await resolveSiteIcon(inline.url, { lookup }))?.data.toString()).toBe(svg.replace('width="16"', 'width="100%"'));

    expect(await resolveSiteIcon(server.site('none', {}).url, { lookup })).toBeNull();
});

test('icons over 256 KiB are refused, with or without a declared length', async () => {
    const image = await png(16);
    const huge = Buffer.concat([await png(), Buffer.alloc(MAX_ICON_BYTES)]);
    const site = server.site('huge', {
        '/': page('<link rel="icon" href="/declared.png" sizes="512x512"><link rel="icon" href="/streamed.png" sizes="256x256">'),
        '/declared.png': file(huge, 'image/png'),
        '/streamed.png': (_, response) => {
            response.writeHead(200, { 'Content-Type': 'image/png', 'Transfer-Encoding': 'chunked' });
            response.write(huge.subarray(0, 1024));
            response.end(huge.subarray(1024));
        },
        '/favicon.ico': file(ico(image), 'image/x-icon')
    });
    expect((await resolveSiteIcon(site.url, { lookup }))?.contentType).toBe('image/x-icon');
    expect(server.requests.filter(request => request.host === site.host).map(request => request.path)).toEqual(['/', '/streamed.png', '/declared.png', '/favicon.ico']);
});

test('private addresses are never requested: not the site, not a redirect, not a declared icon, not another port', async () => {
    const before = server.requests.length;
    const other = await sitesServer();
    try {
        // With the production lookup: names that resolve to loopback, and loopback addresses
        expect(await resolveSiteIcon(`http://localhost:${server.port}/`)).toBeNull();
        expect(await resolveSiteIcon(`http://127.0.0.1:${server.port}/`)).toBeNull();
        expect(await resolveSiteIcon(`http://[::1]:${server.port}/`)).toBeNull();
        expect(server.requests.length).toBe(before);

        const redirecting = server.site('redirecting', { '/': redirect(`http://localhost:${server.port}/`) });
        const declaring = server.site('declaring', { '/': page(`
            <link rel="icon" href="http://localhost:${server.port}/icon.png">
            <link rel="icon" href="http://127.0.0.1:${server.port}/icon.png">
            <link rel="icon" href="http://10.0.0.1:${server.port}/icon.png">
            <link rel="icon" href="http://elsewhere.icons.test:${other.port}/icon.png">`) });
        other.add('elsewhere.icons.test', { '/icon.png': file(await png(), 'image/png') });
        expect(await resolveSiteIcon(redirecting.url, { lookup })).toBeNull();
        expect(await resolveSiteIcon(declaring.url, { lookup })).toBeNull();
        const hosts = new Set(server.requests.slice(before).map(request => request.host));
        expect([...hosts].sort()).toEqual([declaring.host, redirecting.host].sort());
        expect(other.requests).toEqual([]);
    } finally {
        await other.close();
    }
});

test('a site that does not answer in time has no icon', async () => {
    // Accepts the connection and never answers
    const silent = await sitesServer(() => undefined);
    try {
        const started = Date.now();
        expect(await resolveSiteIcon(`http://silent.icons.test:${silent.port}/`, { lookup, timeoutMs: 250 })).toBeNull();
        // Two requests at most: the page, then the first usual path, within twice the per-request time
        expect(Date.now() - started).toBeLessThan(1500);
        expect(silent.requests.length).toBeLessThanOrEqual(2);
    } finally {
        await silent.close();
    }
});

test('icons, and the lack of one, are kept per address; concurrent requests share one lookup', async () => {
    const image = await png();
    const site = server.site('cached', { '/': page('<link rel="icon" href="/icon.png">'), '/icon.png': file(image, 'image/png') });
    const missing = server.site('missing', {});
    const [first, second] = await Promise.all([getSiteIcon(site.url, { lookup }), getSiteIcon(site.url, { lookup })]);
    expect(first).toEqual({ data: image, contentType: 'image/png' });
    expect(second).toBe(first);
    expect(await getSiteIcon(site.url, { lookup })).toBe(first);
    expect(server.requests.filter(request => request.host === site.host).length).toBe(2);

    expect(await getSiteIcon(missing.url, { lookup })).toBeNull();
    const asked = server.requests.filter(request => request.host === missing.host).length;
    expect(await getSiteIcon(missing.url, { lookup })).toBeNull();
    expect(server.requests.filter(request => request.host === missing.host).length).toBe(asked);
});

test('the icon route serves a project\'s icon from uier to its members only, for its own addresses', async () => {
    // The route uses the production network; in local runtime the test upstream stands in for the internet
    process.env.UIER_SITE_ICONS_TEST_UPSTREAM = `http://127.0.0.1:${server.port}`;
    const host = `route-${randomUUID().slice(0, 8)}.example.com`;
    server.add(host, { '/': page('<link rel="icon" href="/brand/icon.svg">'), '/brand/icon.svg': file(svg, 'image/svg+xml') });
    const user = await findOrCreateUser(`site-icons-${randomUUID()}@example.com`);
    const member = await ensureOwnWorkspace(user);
    const context = { user, member, workspace: { id: member.workspaceId }, isAdmin: true } as AppContext;
    const project = await createProject(context, { name: 'Icons', urls: [`https://${host}`, 'https://no-icon.example.com', `http://localhost:${server.port}`] });
    const outsider = await findOrCreateUser(`site-icons-outsider-${randomUUID()}@example.com`);
    await ensureOwnWorkspace(outsider);
    const session = (userId: string) => `${cookieName(cookieNames.session)}=${signToken('session', { uid: userId, iat: Math.floor(Date.now() / 1000) }, SESSION_TTL_SECONDS)}`;
    const get = (site: string, userId?: string, projectId = project.id) => readIcon(
        new Request(`http://localhost:4004${projectIconUrl(projectId, site)}`, { headers: userId ? { cookie: session(userId) } : {} }),
        { params: Promise.resolve({ projectId }) });

    const icon = await get(`https://${host}`, user.id);
    expect(icon.status).toBe(200);
    expect(Buffer.from(await icon.arrayBuffer()).toString()).toBe(svg);
    expect(Object.fromEntries(icon.headers)).toMatchObject({
        'content-type': 'image/svg+xml',
        'cache-control': 'private, max-age=86400',
        'content-security-policy': 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox',
        'content-disposition': 'attachment; filename="icon"',
        'cross-origin-resource-policy': 'same-origin',
        'x-content-type-options': 'nosniff'
    });

    // No icon: the browser keeps the answer for half an hour
    const none = await get('https://no-icon.example.com', user.id);
    expect(none.status).toBe(404);
    expect(none.headers.get('cache-control')).toBe('private, max-age=1800');

    // Signed out, not a member, not the project's address, an unknown project
    expect((await get(`https://${host}`)).status).toBe(401);
    expect((await get(`https://${host}`, outsider.id)).status).toBe(404);
    expect((await get('https://uredan.com', user.id)).status).toBe(404);
    expect((await get(`https://${host}/`, user.id)).status).toBe(404);
    expect((await get(`https://${host}`, user.id, 'aaaaaaaaaaaa')).status).toBe(404);
    for (const response of [await get(`https://${host}`, outsider.id), await get('https://uredan.com', user.id)])
        expect(response.headers.get('cache-control')).toBe('private, no-store');

    // A project address on this machine is never requested, also through the test upstream
    const before = server.requests.length;
    expect((await get(`http://localhost:${server.port}`, user.id)).status).toBe(404);
    expect(server.requests.length).toBe(before);
    delete process.env.UIER_SITE_ICONS_TEST_UPSTREAM;
});
