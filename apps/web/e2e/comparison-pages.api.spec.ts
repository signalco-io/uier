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
    for (const domain of ['bugherd.com', 'marker.io', 'usersnap.com', 'usepastel.com'])
        expect(html).toContain(`href="https://${domain}/`);
    expect(/<time\b[^>]*datetime="2026-11-11"/i.test(html)).toBe(true);
});
