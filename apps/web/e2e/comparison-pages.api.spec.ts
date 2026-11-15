import { expect, test } from '@playwright/test';

test('unknown comparison slugs return a real 404', async ({ request }) => {
    for (const path of ['/compare/unknown', '/compare/bugherd-alternative', '/compare/pastel/unknown'])
        expect((await request.get(path)).status(), path).toBe(404);
});

test('comparison caveats and official evidence are present in crawler HTML', async ({ request }) => {
    const response = await request.get('/compare/website-feedback-tools', { headers: { 'User-Agent': 'Googlebot' } });
    expect(response.status()).toBe(200);
    const html = await response.text();
    for (const text of ['Not supported', 'Not verified', 'Selected paid plans', 'desktop Safari', 'Asset-version approval', 'Written by uier.'])
        expect(html).toContain(text);
    for (const domain of ['bugherd.com', 'marker.io', 'usersnap.com', 'usepastel.com', 'userback.io', 'www.ruttl.com'])
        expect(html).toContain(`href="https://${domain}/`);
    expect(/<time\b[^>]*datetime="2026-11-11"/i.test(html)).toBe(true);
    expect(/<time\b[^>]*datetime="2026-11-15"/i.test(html)).toBe(true);
    expect(html).toContain('Custom statuses and labels');
    expect(html).not.toContain('no custom statuses');
    expect(html).not.toContain('1,000 recent threads');
});

test('new alternatives publish their own evidence and canonical HTML', async ({ request }) => {
    for (const [slug, name, evidence] of [
        ['userback', 'Userback', 'https://docs.userback.io/docs/userback-mcp'],
        ['ruttl', 'ruttl', 'https://www.ruttl.com/mcp']
    ]) {
        const response = await request.get(`/compare/${slug}?source=audit`, { headers: { 'User-Agent': 'Googlebot' } });
        expect(response.status()).toBe(200);
        const html = await response.text();
        expect(html).toContain(`uier vs ${name}`);
        expect(html).toContain(`rel="canonical" href="https://uier.io/compare/${slug}"`);
        expect(html).toContain(`href="${evidence}"`);
        expect(html).toContain('A fictional example, not a customer result.');
        expect(html).toContain('href="/guides/mcp"');
        expect(/<time\b[^>]*datetime="2026-11-15"/i.test(html)).toBe(true);
    }
});
