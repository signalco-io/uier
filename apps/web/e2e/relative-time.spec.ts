import { expect, test } from '@playwright/test';
import { createProject, hydrated, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

// Relative times ("just now", "1 minute ago"; "1 min ago" on rows) keep up as time passes, without a data refresh: one
// shared clock ticks while they are shown.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test('a row and its open thread move from just now to minutes ago on their own', async ({ page, request }, testInfo) => {
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
    // Beside the list the first thread is open. A phone shows a thread in the list's place, once it is opened
    const phone = testInfo.project.name.startsWith('Mobile');
    if (!phone) await expect(thread.locator('time').first()).toHaveText('just now');

    // The clock ticks for times that are on it: wait until the row's is, or the jump passes before it listens
    await hydrated(row.locator('time'));
    await page.clock.runFor('02:05');
    await expect(row.locator('time')).toHaveText('2 min ago');
    if (phone) await openComment(page, 'Guest thread');
    await expect(thread.locator('time').first()).toHaveText('2 minutes ago');
    await page.clock.runFor('03:00');
    await expect(thread.locator('time').first()).toHaveText('5 minutes ago');
});
