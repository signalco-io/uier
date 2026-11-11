import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { appNavigation, closeAppNavigation, commentRowLink, commentRows, createProject, heldForDrag, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { expectNoAxeViolations } from './accessibility';
import { animationsFinished } from './support/toolbar';

// The Tablet Chrome project: an iPad mini's 768 × 1024 with touch, turned to landscape where a test says so.
// Below 1024 px the sidebar is a sheet and the page has the window's width; from 1024 px it is docked.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

const portrait = { width: 768, height: 1024 };
const landscape = { width: 1194, height: 834 };

/** A project with a guest's threads, on its comments page */
async function projectWithThreads(page: Page, request: APIRequestContext, texts: string[]) {
    await signIn(page, uniqueEmail('tablet'));
    const project = await createProject(page, { urls: [site.origin()], name: 'Corner bakery storefront and online ordering' });
    await setProjectAccess(page, project, 'Anyone with the link');
    for (const text of texts) {
        // A visitor each, under the review API's per-visitor rate limit
        const headers = await verifiedReviewHeaders(request, project, site.origin());
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text, authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
    }
    await page.goto(`/app/projects/${project}`);
    return project;
}

const box = async (locator: Locator) => (await locator.boundingBox())!;
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('in portrait the sidebar is a sheet, and the page, its header and settings use the width', async ({ page, request }) => {
    await page.setViewportSize(portrait);
    const project = await projectWithThreads(page, request, ['Checkout total is wrong']);
    // The navigation waits in a sheet: the page has the window's width
    await expect(page.getByRole('navigation', { name: 'App' })).toBeHidden();
    expect((await box(page.getByRole('main'))).width).toBe(portrait.width);
    const navigation = await appNavigation(page);
    await expect(navigation.getByRole('link', { name: 'My work', exact: true })).toBeVisible();
    await closeAppNavigation(page);

    // The project's actions stay on the title's row; the long name wraps beside them
    const title = await box(page.getByRole('heading', { level: 1 }));
    const openReview = await box(page.getByRole('button', { name: 'Open review' }));
    expect(openReview.y).toBeLessThan(title.y + title.height);
    expect(openReview.x).toBeGreaterThan(title.x + title.width);
    // The tabs' line runs to the window's edges without scrolling the page sideways (uier #237)
    expect(await noSidewaysScroll(page)).toBe(true);

    // Settings keep their sections beside the form, and the form has room
    await page.goto(`/app/projects/${project}/settings`);
    const sections = await box(page.getByRole('navigation', { name: 'Project settings' }));
    const general = await box(page.getByRole('region', { name: 'General', exact: true }));
    expect(general.x).toBeGreaterThan(sections.x + sections.width);
    expect(general.width).toBeGreaterThan(420);
    expect(await noSidewaysScroll(page)).toBe(true);
    await expectNoAxeViolations(page);
});

test('in portrait a tapped row opens its thread in the list\'s place, clear of the top bar', async ({ page, request }) => {
    await page.setViewportSize(portrait);
    const texts = Array.from({ length: 12 }, (_, index) => `Tablet thread ${index + 1}`);
    await projectWithThreads(page, request, texts);
    await expect(commentRows(page)).toHaveCount(texts.length);
    await expect(page.getByRole('article')).toBeHidden();
    // Far down the list: the thread starts under the sticky top bar, its Back in reach
    await commentRowLink(page, /Tablet thread 1(?!\d)/).tap();
    const thread = page.getByRole('article');
    await expect(thread).toContainText('Tablet thread 1');
    await expect(commentRows(page).first()).toBeHidden();
    const back = thread.getByRole('button', { name: 'Back to comments', exact: true });
    await expect(back).toBeInViewport({ ratio: 1 });
    const bar = await box(page.getByRole('main').locator(':scope > header'));
    expect((await box(back)).y).toBeGreaterThanOrEqual(bar.y + bar.height);
    await back.tap();
    await expect(commentRows(page)).toHaveCount(texts.length);
    await expect(thread).toBeHidden();
});

test('in portrait the board shows its columns side by side, scrolls sideways and moves a card held and moved', async ({ page, request }) => {
    await page.setViewportSize(portrait);
    const project = await projectWithThreads(page, request, ['First board thread', 'Second board thread']);
    await page.goto(`/app/projects/${project}?view=board`);
    const column = (name: string) => page.getByRole('region', { name: `${name} comments`, exact: true });
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    const open = await box(column('Open'));
    const inProgress = await box(column('In progress'));
    expect(inProgress.y).toBeCloseTo(open.y, 0);
    expect(inProgress.x).toBeGreaterThan(open.x + open.width);
    expect(open.width).toBeGreaterThanOrEqual(288);
    // The other columns are a swipe away; the page itself does not scroll sideways
    const grid = page.locator('[data-board-scroll]');
    expect(await grid.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await noSidewaysScroll(page)).toBe(true);

    // Held, the card lifts once the finger moves; it follows the finger into the column beside
    const card = column('Open').getByRole('listitem').filter({ hasText: 'First board thread' });
    const session = await page.context().newCDPSession(page);
    const from = await box(card);
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await heldForDrag(card);
    const end = { x: inProgress.x + inProgress.width / 2, y: inProgress.y + 40 };
    for (let step = 1; step <= 10; step++)
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 10, y: start.y + (end.y - start.y) * step / 10 }] });
    await expect(page.locator('[data-drag-preview]')).toBeVisible();
    await expect(column('In progress')).toHaveAttribute('data-drop', 'over');
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(column('In progress').getByRole('listitem').filter({ hasText: 'First board thread' })).toBeVisible();
    await expect(page.locator('[data-drag-preview]')).toHaveCount(0);
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
});

test('in landscape the sidebar stays, the thread opens beside the list and project cards keep their width', async ({ page, request }) => {
    await page.setViewportSize(landscape);
    await projectWithThreads(page, request, ['Checkout total is wrong', 'Typo in the hero heading']);
    await expect(page.getByRole('navigation', { name: 'App' })).toBeVisible();
    // The first thread shows beside the list; a tap opens another there
    const thread = page.getByRole('article');
    await expect(thread).toContainText('Typo in the hero heading');
    const list = await box(page.getByRole('list', { name: 'Comments', exact: true }));
    expect((await box(thread)).x).toBeGreaterThan(list.x + list.width);
    await commentRowLink(page, 'Checkout total is wrong').tap();
    await expect(thread).toContainText('Checkout total is wrong');
    await expect(commentRows(page)).toHaveCount(2);
    await expect(thread.getByRole('button', { name: 'Back to comments', exact: true })).toBeHidden();

    // A smaller tablet turned sideways: the docked sidebar leaves the projects room for two cards a row, not three squeezed
    await page.setViewportSize({ width: 1024, height: 768 });
    for (const name of ['Blog', 'Docs'])
        await createProject(page, { urls: [site.origin(name.toLowerCase())], name });
    await page.goto('/app/projects');
    await expect(page.getByRole('navigation', { name: 'App' })).toBeVisible();
    const cards = page.getByRole('list', { name: 'Active projects', exact: true }).getByRole('listitem');
    await expect(cards).toHaveCount(3);
    const [first, second, third] = await Promise.all([0, 1, 2].map(index => box(cards.nth(index))));
    expect(first!.width).toBeGreaterThanOrEqual(288);
    expect(second!.y).toBeCloseTo(first!.y, 0);
    expect(third!.y).toBeGreaterThan(first!.y + first!.height);
    expect(await noSidewaysScroll(page)).toBe(true);
});
