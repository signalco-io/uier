import { expect, test } from '@playwright/test';
import { appNavigation, createProject, openBoardMove, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
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
    await page.getByRole('menuitemcheckbox', { name: /^my-work-/ }).click();
    await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
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

test('My work shows its threads on a board: each card names its project, moves save there, and the view is its own', async ({ page, request }) => {
    await signIn(page, uniqueEmail('my-work-board'));
    const shop = await createProject(page, { urls: [site.origin()], name: 'Shop' });
    const blog = await createProject(page, { urls: [site.origin('blog')], name: 'Blog' });
    for (const [project, origin, text] of [[shop, site.origin(), 'Checkout total is wrong'], [blog, site.origin('blog'), 'Typo in the post title']] as const) {
        await setProjectAccess(page, project, 'Anyone with the link');
        const headers = await verifiedReviewHeaders(request, project, origin);
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text, authorName: 'Guest', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
    }
    const view = () => new URL(page.url()).searchParams.get('view');
    const column = (name: string) => page.getByRole('region', { name: `${name} comments`, exact: true });
    const card = (text: string) => page.locator('[data-board-card]').filter({ hasText: text });

    await page.goto('/app/my-work');
    await expect(page.getByRole('list', { name: 'Unread', exact: true }).getByRole('listitem')).toHaveCount(2);
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect.poll(view).toBe('board');
    // The statuses as columns, no Archive (My work leaves archived threads out), each card with its project
    await expect(page.getByRole('region', { name: /comments$/ })).toHaveText([/^Open/, /^In progress/, /^Ready to verify/, /^Done/]);
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    await expect(card('Typo in the post title')).toContainText('Blog');
    await expect(card('Checkout total is wrong')).toContainText('Shop');
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);

    // Moved with Move, saved in the thread's own project
    await openBoardMove(page, /Typo in the post title/);
    await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await expect(column('Done')).toContainText('Typo in the post title');

    // A card opens its thread in a sheet over the board, with its project's controls. Shown, the thread is read: a done
    // thread you have read no longer needs you, but it stays open, and on the board until My work is loaded again
    await card('Typo in the post title').getByRole('link').first().click();
    const thread = page.getByRole('dialog').getByRole('article');
    await expect(thread).toContainText('Typo in the post title');
    await expect(thread.getByRole('button', { name: 'Unassigned. Change assignee', exact: true })).toBeVisible();
    await expect(thread.getByRole('button', { name: 'Unread. Mark as read', exact: true })).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await expect(thread).toContainText('Typo in the post title');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(column('Done')).toContainText('Typo in the post title');
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);

    // Remembered for My work, apart from a project's comments. Loaded again, the read done thread has left
    await page.goto('/app/my-work');
    await expect.poll(view).toBe('board');
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    await expect(column('Done').getByRole('listitem')).toHaveCount(0);
    await page.goto(`/app/projects/${shop}`);
    await expect(page.getByRole('list', { name: 'Comments', exact: true })).toBeVisible();
    expect(view()).toBeNull();
    // The project has the move: its Done tab lists the thread
    await page.goto(`/app/projects/${blog}?status=done`);
    await expect(page.getByRole('list', { name: 'Comments', exact: true })).toContainText('Typo in the post title');
    await page.goto(`/app/projects/${shop}?status=done`);
    await expect(page.getByRole('list', { name: 'Comments', exact: true })).toHaveCount(0);

    // G then I goes back to the lists on My work
    await page.goto('/app/my-work?view=board');
    await expect(column('Open')).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await expect.poll(view).toBe('list');
    await expect(page.getByRole('list', { name: 'Unread', exact: true })).toContainText('Checkout total is wrong');
});

test('My work says so when nothing needs you', async ({ page }) => {
    await signIn(page, uniqueEmail('my-work-empty'));
    await page.goto('/app/my-work');
    await expect(page.getByText('Nothing needs you', { exact: true })).toBeVisible();
});
