import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { useCases } from '../src/lib/useCases';

function attribute(tag: string, name: string) {
    return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]?.replaceAll('&amp;', '&');
}

function meta(html: string, name: string) {
    const tag = [...html.matchAll(/<meta\b[^>]*>/g)].map(match => match[0])
        .find(tag => attribute(tag, 'name') === name || attribute(tag, 'property') === name);
    return tag ? attribute(tag, 'content') : undefined;
}

for (const useCase of Object.values(useCases)) {
    test(`${useCase.path} serves substantive HTML with its own canonical and social image`, async ({ request }) => {
        const response = await request.get(`${useCase.path}?utm_source=use-case-test`);
        expect(response.status()).toBe(200);
        const html = await response.text();
        const canonical = `${brand.url}${useCase.path}`;
        const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0]).filter(tag => attribute(tag, 'rel') === 'canonical');
        expect(links.map(tag => attribute(tag, 'href'))).toEqual([canonical]);
        expect(meta(html, 'description')).toBe(useCase.description);
        expect(meta(html, 'og:url')).toBe(canonical);
        expect(meta(html, 'og:title')).toBe(`${useCase.title} · ${brand.name}`);
        expect(meta(html, 'robots') ?? '').not.toMatch(/noindex/i);
        expect(html).toMatch(/<h1\b/);
        expect(html).toContain('off by default');
        expect(html).toContain('/features/fix-verification');
        expect(html).toContain('/legal/privacy-policy');
        const image = new URL(meta(html, 'og:image')!);
        expect(image.pathname.startsWith(`${useCase.path}/opengraph-image`)).toBe(true);
        expect(meta(html, 'og:image:alt')).toBe(`${useCase.title} · ${brand.name}`);
        const card = await request.get(`${image.pathname}${image.search}`);
        expect(card.status()).toBe(200);
        expect(card.headers()['content-type']).toBe('image/png');
        expect((await card.body()).byteLength).toBeGreaterThan(10_000);
    });
}

test('annotation retains one canonical page and unshipped use-case slugs return real 404s', async ({ request }) => {
    expect((await request.get('/features/pinned-comments')).status()).toBe(200);
    for (const path of ['/use-cases', '/use-cases/unknown', '/features/website-annotation', '/use-cases/website-annotation', '/use-cases/website-uat'])
        expect((await request.get(path)).status(), path).toBe(404);
});
