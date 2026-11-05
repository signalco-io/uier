import { expect, test } from '@playwright/test';
import { appNavigation, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { expectNoAxeViolations } from './accessibility';
import { animationsFinished } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test('My work lists what needs you across projects, each thread once, and opens it in its project', async ({ page, request }) => {
    await signIn(page, uniqueEmail('my-work'));
    const first = await createProject(page, { urls: [site.origin()], name: 'Shop' });
    const second = await createProject(page, { urls: [site.origin('blog')], name: 'Blog' });
    for (const [project, origin, text] of [[first, site.origin(), 'Checkout total is wrong'], [second, site.origin('blog'), 'Typo in the post title']] as const) {
        await setProjectAccess(page, project, 'Anyone with the link');
        const headers = await verifiedReviewHeaders(request, project, origin);
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text, authorName: 'Guest', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
    }
    // A guest's comment in each project is unread; one of them is assigned to you
    await page.goto(`/app/projects/${first}`);
    const thread = await openComment(page, 'Checkout total is wrong');
    await thread.getByRole('button', { name: 'Unassigned. Change assignee', exact: true }).click();
    await page.getByRole('menuitem', { name: /^my-work-/ }).click();
    await expect(thread.getByRole('button', { name: 'Assigned to you. Change assignee', exact: true })).toBeVisible();

    await appNavigation(page);
    await page.getByRole('link', { name: 'My work', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/my-work$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My work' })).toBeVisible();
    const assigned = page.getByRole('list', { name: 'Assigned to you', exact: true });
    const unread = page.getByRole('list', { name: 'Unread', exact: true });
    await expect(assigned.getByRole('listitem')).toHaveCount(1);
    await expect(assigned).toContainText('Shop');
    await expect(assigned).toContainText('Checkout total is wrong');
    // Each thread once: the assigned one is not listed again as unread
    await expect(unread.getByRole('listitem')).toHaveCount(1);
    await expect(unread).toContainText('Blog');
    await expect(unread).toContainText('Typo in the post title');
    // On a phone the navigation sheet closes once the page opens
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);

    await unread.getByRole('link', { name: /Typo in the post title/ }).click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${second}\\?comment=`));
    await expect(page.getByRole('article')).toContainText('Typo in the post title');
});

test('My work says so when nothing needs you', async ({ page }) => {
    await signIn(page, uniqueEmail('my-work-empty'));
    await page.goto('/app/my-work');
    await expect(page.getByText('Nothing needs you', { exact: true })).toBeVisible();
});
