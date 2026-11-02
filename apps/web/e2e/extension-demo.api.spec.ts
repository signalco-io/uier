import { expect, test } from '@playwright/test';
import { KnownPages } from '../src/knownPages';

test('reviewer demo stays unembedded, unindexed and restrictive even with a query string', async ({ request }) => {
    const response = await request.get(`${KnownPages.ExtensionDemo}?review=1`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expect(response.headers()['x-robots-tag']).toBe('noindex');
    expect(response.headers()['cache-control']).toContain('no-store');
    const policy = response.headers()['content-security-policy'];
    for (const directive of ['default-src', 'script-src', 'connect-src', 'frame-src', 'img-src', 'font-src', 'style-src', 'base-uri', 'form-action', 'frame-ancestors'])
        expect(policy).toContain(`${directive} 'none'`);
    const html = await response.text();
    expect(html).not.toMatch(/<script\b|<iframe\b|<style\b|\bsrc\s*=/i);
    expect(html).toContain('Create a test project');
    const sitemap = await request.get('/sitemap-0.xml');
    expect(await sitemap.text()).not.toContain(KnownPages.ExtensionDemo);
});
