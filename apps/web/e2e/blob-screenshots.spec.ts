import { expect, test } from '@playwright/test';
import { isolatedOrigin, newVisitor, openLanding } from './support/toolbar';
import { pngImage } from './support/images';

for (const direct of [true, false]) test(direct
    ? 'saved screenshots download directly from Blob Storage without forwarding reviewer credentials'
    : 'existing embed CSPs retain the authenticated image fallback', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const blobOrigin = 'https://fixture.blob.core.windows.net';
    let apiRequests = 0;
    let fallbackRequests = 0;
    let blobHeaders: Record<string, string> | undefined;
    await page.route('**/*', async route => {
        const request = route.request();
        if (request.resourceType() !== 'document') return route.fallback();
        const response = await route.fetch();
        const headers = { ...response.headers() };
        if (direct) headers['content-security-policy'] = headers['content-security-policy']!.replace('connect-src ', `connect-src ${blobOrigin} `);
        return route.fulfill({ response, headers });
    });
    await page.route('**/api/comments/*/screenshot', async route => {
        if (route.request().method() !== 'GET') return route.fallback();
        if (route.request().headers().accept !== 'application/vnd.uier.screenshot-url+json') {
            fallbackRequests++;
            return route.fulfill({ contentType: 'image/png', body: Buffer.from(pngImage.split(',')[1]!, 'base64') });
        }
        apiRequests++;
        return route.fulfill({ contentType: 'application/vnd.uier.screenshot-url+json', body: JSON.stringify({
            url: `${blobOrigin}/screenshots/fixture?sp=r&sig=fixture`, expiresAt: new Date(Date.now() + 60_000).toISOString()
        }) });
    });
    await page.route(`${blobOrigin}/**`, async route => {
        blobHeaders = route.request().headers();
        return route.fulfill({ contentType: 'image/png', body: Buffer.from(pngImage.split(',')[1]!, 'base64'), headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    try {
        await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
        const id = await page.evaluate(async screenshot => {
            const response = await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: '/', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Direct screenshot', screenshot }) });
            return (await response.json() as { id: string }).id;
        }, pngImage);
        await page.reload();
        await page.locator(`[data-uier-comment="${id}"]`).click();
        const thumbnail = page.getByRole('button', { name: 'Screenshot of the commented part of the page' });
        await expect(thumbnail).toBeVisible();
        expect(apiRequests).toBeGreaterThan(0);
        if (direct) {
            expect(blobHeaders).toBeDefined();
            expect(fallbackRequests).toBe(0);
            for (const header of ['authorization', 'cookie', 'x-uier-visitor', 'x-uier-verification', 'referer']) expect(blobHeaders![header]).toBeUndefined();
        } else expect(fallbackRequests).toBeGreaterThan(0);
        await thumbnail.click();
        await expect(page.getByRole('img', { name: 'Expanded screenshot' })).toBeVisible();
    } finally { await context.close(); }
});
