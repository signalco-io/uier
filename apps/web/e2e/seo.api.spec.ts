import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { integrationCatalog } from '../src/lib/integrations/catalog';

const publicPaths = [
    '/', '/brand', '/integrations',
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
