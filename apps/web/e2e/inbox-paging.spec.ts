import type { CommentItem } from '../../../packages/toolbar/src/components/@types/Comments';
import { expect, test } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, signIn, uniqueEmail } from './support/app';
import { chooseInboxPages, commentBubble, expectInboxListed } from './support/toolbar';

// The toolbar inbox with many threads: a virtualized list (only the cards near the view are rendered) that loads the
// site's list in pages as it scrolls (`?before=`), with J and K reaching cards that are not rendered
let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

test('a long inbox renders only the cards in view and loads older pages as it scrolls', async ({ page }) => {
    await signIn(page, uniqueEmail('inbox-paging'));
    const projectId = await createProject(page, { urls: [site.origin()] });
    const path = `/${projectId}/pricing`;
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${site.origin()}${path}`)}`);
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill('The template thread');
    const posted = page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/review\/[^/]+\/comments$/.test(new URL(response.url()).pathname));
    await composer.press('Enter');
    const template = await (await posted).json() as CommentItem;
    await expect(commentBubble(page, 1, 1)).toBeVisible();

    // 451 threads on other pages, newest first, served as the API pages them
    const total = 451;
    const threads = Array.from({ length: total }, (_, index) => ({ ...template, id: `comment_paging_${String(index).padStart(3, '0')}`, number: index + 2,
        path: `/${projectId}/page-${index % 7}`, position: { type: 'page' }, kind: 'feedback',
        createdAt: new Date(Date.UTC(2026, 9, 1) - index * 60_000).toISOString(),
        thread: { items: [{ ...template.thread.items[0]!, id: `item_${index}`, text: `Paged thread ${index}` }] } }));
    const cursors: (string | null)[] = [];
    await page.route(`**/api/review/${projectId}/comments?**`, async route => {
        const params = new URL(route.request().url()).searchParams;
        if (params.get('scope') !== 'site') return await route.continue();
        if (params.get('archive') === 'only') return await route.fulfill({ json: [] });
        const before = params.get('before');
        cursors.push(before);
        const start = before ? threads.findIndex(thread => `${thread.createdAt}|${thread.id}` === before) + 1 : 0;
        await route.fulfill({ json: threads.slice(start, start + Number(params.get('limit') ?? 200)) });
    });
    await page.route(`**/api/review/${projectId}/comments/activity**`, route => route.fulfill({ json: { unread: 0, open: total + 1, inProgress: 0, ready: 0, done: 0, total: total + 1, archived: 0 } }));

    await page.getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    await chooseInboxPages(page, /^All pages/);
    // The first page: more may follow, so the list's size is not known yet
    await expectInboxListed(inbox, -1);
    expect(await inbox.getByRole('article').count()).toBeLessThan(30);
    expect(cursors).toEqual([null]);

    // Scrolling to the end loads the next pages, each after the oldest loaded thread
    const scroller = inbox.locator('[data-uier-inbox-scroll]');
    await expect.poll(async () => {
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
        return await inbox.getByRole('article').first().getAttribute('aria-setsize');
    }, { timeout: 15_000 }).toBe(String(total + 1));
    expect(cursors).toEqual([null, `${threads[199]!.createdAt}|${threads[199]!.id}`, `${threads[399]!.createdAt}|${threads[399]!.id}`]);
    await expect(inbox.getByText('Paged thread 450', { exact: true })).toBeVisible();
    expect(await inbox.getByRole('article').count()).toBeLessThan(30);

    // J and K go from card to card, also to one that is not rendered yet
    await scroller.evaluate(element => { element.scrollTop = 0; });
    await page.getByRole('button', { name: /^Inbox/ }).focus();
    await page.keyboard.press('k');
    await expect(inbox.locator('article:focus')).toHaveAttribute('aria-posinset', String(total + 1));
    await page.keyboard.press('k');
    await expect(inbox.locator('article:focus')).toHaveAttribute('aria-posinset', String(total));
    await scroller.evaluate(element => { element.scrollTop = 0; });
    await page.keyboard.press('j');
    await expect(inbox.locator('article:focus')).toHaveAttribute('aria-posinset', String(total + 1));
    await expect(inbox.locator('article:focus')).toBeInViewport();
});
