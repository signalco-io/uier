import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';

// /features/fix-verification has its own social card. Its canonical URL and sitemap entry are
// covered with every public page in seo.api.spec.ts.

const path = '/features/fix-verification';

function attribute(tag: string, name: string) {
    return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function meta(html: string, name: string) {
    const tag = [...html.matchAll(/<meta\b[^>]*>/g)].map(match => match[0])
        .find(tag => attribute(tag, 'name') === name || attribute(tag, 'property') === name);
    return tag ? attribute(tag, 'content')?.replaceAll('&amp;', '&') : undefined;
}

test('fix verification page has its own social card', async ({ request }) => {
    const html = await (await request.get(path)).text();
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
