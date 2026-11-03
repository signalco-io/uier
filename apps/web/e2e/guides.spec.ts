import { expect, test } from '@playwright/test';
import { brand } from '@uier/brand';
import { guides } from '../src/lib/guides';
import { nextJsSnippet } from '../src/lib/app/integration';
import { assertAccessibility } from './accessibility';
import { signIn, uniqueEmail, createProject } from './support/app';

test('guides link the shipped workflow and show the same Next.js snippet as installation', async ({ page }) => {
    await page.goto('/guides');
    await expect(page.getByRole('heading', { level: 1, name: 'Guides' })).toBeVisible();
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Guides', exact: true })).toHaveAttribute('href', '/guides');
    await page.locator(`main a[href="${guides.nextJs.path}"]`).click();
    await expect(page.getByRole('heading', { level: 1, name: guides.nextJs.title })).toBeVisible();
    await expect(page.locator('main pre code')).toHaveText(nextJsSnippet(brand.url, 'YOUR_PROJECT_CODE'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'Plan a client review' }).click();
    await expect(page.getByRole('heading', { level: 1, name: guides.clientReviews.title })).toBeVisible();
    await expect(page.locator('main a[href="/features/fix-verification"]')).toBeVisible();
    await expect(page.locator('main a[href="/features/feedback-triage"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('new-account sign-in and real project creation reach the authenticated measurement endpoint once', async ({ page, baseURL }) => {
    await signIn(page, uniqueEmail('acquisition'));
    const post = (data: unknown) => page.request.post('/api/acquisition', { headers: { Origin: baseURL! }, data });
    for (const data of [{ channel: 'ai_search', source: 'private@example.com' }, { channel: 'ai_search', source: 'chatgpt', userId: 'someone-else' }, 'x'.repeat(300)])
        expect((await post(data)).status()).toBe(400);
    const first = await post({ channel: 'ai_search', source: 'chatgpt' });
    expect(first.status()).toBe(200);
    expect(await first.json()).toMatchObject({ enabled: true, events: [{ stage: 'sign_in', channel: 'ai_search', source: 'chatgpt' }] });
    expect(await (await post({ channel: 'direct', source: 'direct' })).json()).toEqual({ enabled: true, events: [] });
    await createProject(page, { urls: ['https://acquisition.example.test'] });
    const project = await (await post({ channel: 'direct', source: 'direct' })).json();
    expect(project.events).toHaveLength(1);
    expect(project.events[0]).toMatchObject({ stage: 'first_project', channel: 'ai_search', source: 'chatgpt' });
    expect(Object.keys(project.events[0]).sort()).toEqual(['channel', 'source', 'stage']);
});

for (const guide of Object.values(guides))
    test(`${guide.path} is accessible`, ({ page }) => assertAccessibility(page, guide.path));
