import { expect, test } from '@playwright/test';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

// Relative times ("just now", "1 minute ago") keep up as time passes, without a data refresh: one
// shared clock ticks while they are shown.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test('a row and its open thread move from just now to minutes ago on their own', async ({ page, request }) => {
    await signIn(page, uniqueEmail('relative-time'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/pricing`, text: 'Guest thread', authorName: 'Guest', position: { type: 'page' }, kind: 'feedback'
    } });
    expect(response.status()).toBe(201);

    await page.clock.install();
    await page.goto(`/app/projects/${project}`);
    const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: /^Comment #\d+/ }) }).filter({ hasText: 'Guest thread' });
    const thread = page.getByRole('article');
    await expect(row.locator('time')).toHaveText('just now');
    await expect(thread.locator('time').first()).toHaveText('just now');

    await page.clock.runFor('02:05');
    await expect(row.locator('time')).toHaveText('2 minutes ago');
    await expect(thread.locator('time').first()).toHaveText('2 minutes ago');
});
