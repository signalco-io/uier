import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { integrationCatalog } from '../src/lib/integrations/catalog';

const publicPaths = [
    '/guides', '/guides/browser-extension', '/guides/client-website-reviews', '/guides/nextjs',
    '/', '/brand', '/browser-extension', '/features/ai', '/features/feedback-triage', '/features/fix-verification', '/features/page-checks', '/integrations',
    ...Object.keys(integrationCatalog).map(provider => `/integrations/${provider}`),
    '/legal/acceptable-use-policy', '/legal/cookie-policy', '/legal/privacy-policy',
    '/legal/sla', '/legal/terms-of-service', '/open-source', '/security', '/status'
];

function attribute(tag: string, name: string) {
    return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function meta(html: string, name: string) {
    const tag = [...html.matchAll(/<meta\b[^>]*>/g)].map(match => match[0])
        .find(tag => attribute(tag, 'name') === name || attribute(tag, 'property') === name);
    return tag ? attribute(tag, 'content') : undefined;
}

function locations(xml: string) {
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]!);
}

test('public pages publish distinct canonical URLs in crawlable HTML', async ({ request }) => {
    for (const path of [...publicPaths, '/integrations/github?utm_source=seo-test']) {
        const response = await request.get(path, { headers: { 'User-Agent': 'Googlebot' } });
        expect(response.status(), path).toBe(200);
        const html = await response.text();
        const canonicalUrl = new URL(path, brand.url);
        canonicalUrl.search = '';
        const canonical = canonicalUrl.href;
        const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0])
            .filter(tag => attribute(tag, 'rel') === 'canonical');
        // Next normalizes the homepage to the bare origin; both serialize to the same URL.
        expect(links.map(tag => new URL(attribute(tag, 'href')!).href), path).toEqual([canonical]);
        expect(new URL(meta(html, 'og:url')!).href, path).toBe(canonical);
        expect(meta(html, 'description'), path).toBeTruthy();
        expect(meta(html, 'robots') ?? '', path).not.toMatch(/noindex/i);
        expect(response.headers()['x-robots-tag'] ?? '', path).not.toMatch(/noindex/i);
    }
});

test('the sitemap contains public pages and excludes assets and noindex flows', async ({ request }) => {
    const index = await request.get('/sitemap.xml');
    expect(index.status()).toBe(200);
    const sitemaps = locations(await index.text());
    expect(sitemaps.length).toBeGreaterThan(0);
    const pages: string[] = [];
    for (const sitemap of sitemaps) {
        expect(new URL(sitemap).origin).toBe(brand.url);
        const response = await request.get(new URL(sitemap).pathname);
        expect(response.status()).toBe(200);
        const xml = await response.text();
        pages.push(...locations(xml));
        // Rebuilds must not advertise an invented content modification date.
        expect(xml).not.toContain('<lastmod>');
    }
    expect(pages.map(url => new URL(url).href).sort())
        .toEqual(publicPaths.map(path => new URL(path, brand.url).href).sort());
});

test('the homepage identifies the website and its actual publisher with connected JSON-LD', async ({ request }) => {
    const html = await (await request.get('/')).text();
    const documents = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
        .map(match => JSON.parse(match[1]!) as { '@graph': Record<string, unknown>[] });
    const graph = documents.flatMap(doc => doc['@graph'] ?? [doc]);
    const website = graph.find(doc => doc['@type'] === 'WebSite');
    const publisher = graph.find(doc => doc['@type'] === 'Organization');
    expect(website).toMatchObject({ name: brand.name, url: brand.url, publisher: { '@id': `${brand.parent.url}/#organization` } });
    expect(publisher).toMatchObject({ '@id': `${brand.parent.url}/#organization`, name: brand.parent.name, url: brand.parent.url });
    expect(meta(html, 'msvalidate.01')).toBe('16CF0F06FF0F10896508557122F1DA5C');
});

test('IndexNow publishes proof and a manifest of static public pages only', async ({ request }) => {
    const response = await request.get('/search-index.json');
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest).toMatchObject({ version: 1, revision: expect.stringMatching(/^[a-f0-9]{40}$/) });
    expect(manifest.pages.map((page: { url: string }) => page.url).sort()).toEqual(publicPaths.filter(path => path !== '/status').map(path => new URL(path, brand.url).href).sort());
    for (const page of manifest.pages) expect(page.hash).toMatch(/^[a-f0-9]{64}$/);
    const key = '82a627b9c3ebc96ec72d4bb73ed020b2';
    const proof = await request.get(`/${key}.txt`);
    expect(proof.status()).toBe(200);
    expect((await proof.text()).trim()).toBe(key);
});

test('non-search pages expose noindex and robots.txt permits reading it', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    const text = await robots.text();
    expect(text).toContain(`Sitemap: ${brand.url}/sitemap.xml`);
    expect(text).not.toMatch(/^Disallow:\s*\S+/m);
    for (const path of ['/app/sign-in', '/notifications', '/review-verification', '/extension-verification', '/review-session']) {
        const response = await request.get(path, { headers: { 'User-Agent': 'Googlebot' } });
        expect(response.status(), path).toBe(200);
        expect(meta(await response.text(), 'robots'), path).toMatch(/\bnoindex\b/);
    }
});

test('security.txt is discoverable as plain text with current reporting details', async ({ request }) => {
    const path = '/.well-known/security.txt';
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^text\/plain;\s*charset=utf-8$/i);
    const text = await response.text();
    expect(text).toMatch(/\n$/);
    const fields = new Map<string, string[]>();
    for (const line of text.split(/\r?\n/).filter(line => line && !line.startsWith('#'))) {
        const match = /^([A-Za-z][A-Za-z-]*): (.+)$/.exec(line);
        expect(match, line).not.toBeNull();
        const name = match![1]!.toLowerCase();
        fields.set(name, [...(fields.get(name) ?? []), match![2]!]);
    }
    expect(fields.get('contact')).toContain(`mailto:${brand.contact.security}`);
    expect(fields.get('canonical')).toEqual([`${brand.url}${path}`]);
    expect(fields.get('policy')).toEqual([`${brand.repository}/security/policy`]);
    const expiry = fields.get('expires');
    expect(expiry).toHaveLength(1);
    expect(expiry![0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const expiresAt = Date.parse(expiry![0]!);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt).toBeLessThan(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const legacy = await request.get('/security.txt', { maxRedirects: 0 });
    expect(legacy.status()).toBe(308);
    expect(new URL(legacy.headers().location!, legacy.url()).pathname).toBe(path);
});
