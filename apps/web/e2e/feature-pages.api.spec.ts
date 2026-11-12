import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';

// The public feature pages: crawlable HTML with their own canonical, social card and description.
// Unpublished feature slugs are real 404s.

function attribute(tag: string, name: string) {
    return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]?.replaceAll('&amp;', '&');
}

function meta(html: string, name: string) {
    const tag = [...html.matchAll(/<meta\b[^>]*>/g)].map(match => match[0])
        .find(tag => attribute(tag, 'name') === name || attribute(tag, 'property') === name);
    return tag ? attribute(tag, 'content') : undefined;
}

test('feedback triage publishes its own canonical, description and social card', async ({ request }) => {
    const response = await request.get('/features/feedback-triage?utm_source=feature-test');
    expect(response.status()).toBe(200);
    const html = await response.text();
    const canonical = `${brand.url}/features/feedback-triage`;
    const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0]).filter(tag => attribute(tag, 'rel') === 'canonical');
    expect(links.map(tag => attribute(tag, 'href'))).toEqual([canonical]);
    expect(meta(html, 'og:url')).toBe(canonical);
    expect(meta(html, 'og:title')).toBe(`Feedback triage · ${brand.name}`);
    expect(meta(html, 'description')).toMatch(/up to 50 selected threads/);
    expect(meta(html, 'robots') ?? '').not.toMatch(/noindex/i);
    // The page's own card, not the brand card that the landing page uses
    const image = new URL(meta(html, 'og:image')!);
    expect(image.pathname).toMatch(/^\/features\/feedback-triage\/opengraph-image/);
    expect(meta(html, 'og:image:width')).toBe('1200');
    expect(meta(html, 'og:image:height')).toBe('630');
    expect(meta(html, 'og:image:alt')).toBe(`Feedback triage · ${brand.name}`);
    const card = await request.get(`${image.pathname}${image.search}`);
    expect(card.status()).toBe(200);
    expect(card.headers()['content-type']).toBe('image/png');
    expect((await card.body()).byteLength).toBeGreaterThan(10_000);
});

test('the AI page publishes its own canonical, description and social card', async ({ request }) => {
    const response = await request.get('/features/ai?utm_source=feature-test');
    expect(response.status()).toBe(200);
    const html = await response.text();
    const canonical = `${brand.url}/features/ai`;
    const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0]).filter(tag => attribute(tag, 'rel') === 'canonical');
    expect(links.map(tag => attribute(tag, 'href'))).toEqual([canonical]);
    expect(meta(html, 'og:url')).toBe(canonical);
    expect(meta(html, 'og:title')).toBe(`AI for website feedback · ${brand.name}`);
    expect(meta(html, 'description')).toMatch(/Claude Code, Codex or Cursor/);
    expect(meta(html, 'robots') ?? '').not.toMatch(/noindex/i);
    const image = new URL(meta(html, 'og:image')!);
    expect(image.pathname).toMatch(/^\/features\/ai\/opengraph-image/);
    const card = await request.get(`${image.pathname}${image.search}`);
    expect(card.status()).toBe(200);
    expect(card.headers()['content-type']).toBe('image/png');
});

test('the page checks page publishes its own canonical, description and social card', async ({ request }) => {
    const response = await request.get('/features/page-checks?utm_source=feature-test');
    expect(response.status()).toBe(200);
    const html = await response.text();
    const canonical = `${brand.url}/features/page-checks`;
    const links = [...html.matchAll(/<link\b[^>]*>/g)].map(match => match[0]).filter(tag => attribute(tag, 'rel') === 'canonical');
    expect(links.map(tag => attribute(tag, 'href'))).toEqual([canonical]);
    expect(meta(html, 'og:url')).toBe(canonical);
    expect(meta(html, 'og:title')).toBe(`Accessibility, SEO and security checks · ${brand.name}`);
    expect(meta(html, 'description')).toMatch(/accessibility, SEO, security and consent evidence in your browser/);
    expect(meta(html, 'robots') ?? '').not.toMatch(/noindex/i);
    const image = new URL(meta(html, 'og:image')!);
    expect(image.pathname).toMatch(/^\/features\/page-checks\/opengraph-image/);
    const card = await request.get(`${image.pathname}${image.search}`);
    expect(card.status()).toBe(200);
    expect(card.headers()['content-type']).toBe('image/png');
});

test('unpublished feature pages return a real 404', async ({ request }) => {
    for (const path of ['/features', '/features/unknown'])
        expect((await request.get(path)).status(), path).toBe(404);
});
