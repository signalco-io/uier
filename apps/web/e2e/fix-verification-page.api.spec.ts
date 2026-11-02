import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';

// /features/fix-verification is crawlable with its own canonical URL and social card

const path = '/features/fix-verification';

function attribute(tag: string, name: string) {
    return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function meta(html: string, name: string) {
    const tag = [...html.matchAll(/<meta\b[^>]*>/g)].map(match => match[0])
        .find(tag => attribute(tag, 'name') === name || attribute(tag, 'property') === name);
    return tag ? attribute(tag, 'content')?.replaceAll('&amp;', '&') : undefined;
}

test('fix verification page has its canonical URL and social card', async ({ request }) => {
    const response = await request.get(`${path}?utm_source=test`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    const canonical = `${brand.url}${path}`;
    const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0]).filter(tag => attribute(tag, 'rel') === 'canonical');
    expect(links.map(tag => attribute(tag, 'href'))).toEqual([canonical]);
    expect(meta(html, 'og:url')).toBe(canonical);
    expect(meta(html, 'og:title')).toBe(`Fix verification for website feedback · ${brand.name}`);
    expect(meta(html, 'og:description')).toBe(meta(html, 'description'));
    expect(meta(html, 'twitter:card')).toBe('summary_large_image');

    const image = new URL(meta(html, 'og:image')!);
    expect(image.origin).toBe(brand.url);
    expect(image.pathname).toMatch(new RegExp(`^${path}/opengraph-image`));
    expect(meta(html, 'twitter:image')).toBe(image.href);
    const card = await request.get(`${image.pathname}${image.search}`);
    expect(card.status()).toBe(200);
    expect(card.headers()['content-type']).toBe('image/png');
    // The PNG header's width and height
    const png = await card.body();
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
});

test('the sitemap lists fix verification but not its social card', async ({ request }) => {
    const index = await request.get('/sitemap.xml');
    expect(index.status()).toBe(200);
    const pages: string[] = [];
    for (const [, sitemap] of (await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const xml = await (await request.get(new URL(sitemap!).pathname)).text();
        pages.push(...[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]!));
    }
    expect(pages).toContain(`${brand.url}${path}`);
    expect(pages.filter(page => page.includes('opengraph-image') && page !== `${brand.url}/opengraph-image`)).toEqual([]);
});
