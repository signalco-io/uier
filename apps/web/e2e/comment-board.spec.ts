import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { expectNoAxeViolations } from './accessibility';
import { animationsFinished } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

async function board(page: Page, request: APIRequestContext) {
    await signIn(page, uniqueEmail('board'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const comments: { id: string; number: number }[] = [];
    for (const text of ['First board thread', 'Second board thread']) {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text, authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
        comments.push(await response.json());
    }
    await page.goto(`/app/projects/${project}?view=board`);
    const column = (name: string) => page.getByRole('region', { name: `${name} comments`, exact: true });
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    return { project, comments, column };
}

test('board cards move with Move from the keyboard; Ready to verify asks for the request first', async ({ page, request }) => {
    const { comments, column } = await board(page, request);
    const move = column('Open').getByRole('button', { name: `Move comment #${comments[0]!.number}`, exact: true });
    await move.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Open', 'Ready to verify', 'Done']);
    await animationsFinished(menu);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    await page.reload();
    await expect(column('Done').getByRole('listitem').filter({ hasText: 'First board thread' })).toBeVisible();

    // Ready to verify opens the thread with the form; the card stays until the request is sent
    await column('Open').getByRole('button', { name: `Move comment #${comments[1]!.number}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Ready to verify', exact: true }).click();
    const thread = page.getByRole('article');
    const form = thread.getByRole('form', { name: 'Request verification' });
    await expect(form.getByRole('textbox', { name: 'Fix summary', exact: true })).toBeFocused();
    await form.getByRole('textbox', { name: 'Fix summary', exact: true }).fill('Moved on the board');
    await form.getByRole('button', { name: 'Request verification', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(column('Ready to verify').getByRole('listitem')).toHaveCount(1);
    await expect(column('Open').getByRole('listitem')).toHaveCount(0);
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
});

/** Where the comments sit in the page's scrolling panel (`room` leaves out its scrollbar) */
function placement(comments: Locator) {
    return comments.evaluate(element => {
        let scroller = element.parentElement!;
        while (getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement!;
        const box = element.getBoundingClientRect();
        const panel = scroller.getBoundingClientRect();
        return { width: box.width, room: scroller.clientWidth, left: box.left - panel.left, right: panel.left + scroller.clientWidth - box.right };
    });
}

test('the board takes the width of a wide window; the list keeps its reading width', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Desktop windows; a phone shows one column either way');
    // The window the feedback came from
    await page.setViewportSize({ width: 1674, height: 1366 });
    const { column } = await board(page, request);
    const comments = page.locator('#comments');
    // The whole panel but its 32 px gutters, three equal columns in one row
    const wide = await placement(comments);
    expect(wide.width).toBeCloseTo(wide.room - 64, 0);
    const boxes = await Promise.all(['Open', 'Ready to verify', 'Done'].map(async name => (await column(name).boundingBox())!));
    for (const box of boxes) {
        expect(box.y).toBeCloseTo(boxes[0]!.y, 0);
        expect(box.width).toBeCloseTo(boxes[0]!.width, 0);
    }
    expect(boxes[0]!.width).toBeGreaterThan(400);

    // The list keeps the reading width: 64rem with the gutters, centred
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect.poll(async () => (await placement(comments)).width).toBe(1024 - 64);
    const list = await placement(comments);
    expect(list.left).toBeCloseTo(list.right, 0);

    // On a very wide window the board stops at 1920 px with the gutters, centred
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await page.setViewportSize({ width: 2560, height: 1440 });
    await expect.poll(async () => (await placement(comments)).width).toBe(1920 - 64);
    const widest = await placement(comments);
    expect(widest.left).toBeCloseTo(widest.right, 0);

    // A card's thread opens in the sheet over the board, which keeps its width
    await expect(await openComment(page, 'First board thread')).toHaveAccessibleName('Comment by Reviewer');
    expect((await placement(comments)).width).toBe(1920 - 64);
});

test('on a phone the board stacks its columns without scrolling sideways', async ({ page, request }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('Mobile'), 'The phone layout');
    const { column } = await board(page, request);
    const open = (await column('Open').boundingBox())!;
    const done = (await column('Done').boundingBox())!;
    expect(done.y).toBeGreaterThan(open.y + open.height);
    expect(done.width).toBeCloseTo(open.width, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('board cards drag between the columns they can move to', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'Dragging takes a mouse; Move covers touch screens');
    const { column } = await board(page, request);
    const second = column('Open').getByRole('listitem').filter({ hasText: 'Second board thread' });
    await second.dragTo(column('Done'));
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    // Back to Open: Reopen
    await column('Done').getByRole('listitem').dragTo(column('Open'));
    await expect(column('Open').getByRole('listitem')).toHaveCount(2);
    // Dropped on Ready to verify: the request form opens; the card moves once it is sent
    await column('Open').getByRole('listitem').filter({ hasText: 'First board thread' }).dragTo(column('Ready to verify'));
    const thread = page.getByRole('article');
    await thread.getByRole('textbox', { name: 'Fix summary', exact: true }).fill('Dragged to Ready to verify');
    await thread.getByRole('form', { name: 'Request verification' }).getByRole('button', { name: 'Request verification', exact: true }).click();
    await expect(thread.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true })).toBeVisible();
    await thread.getByRole('button', { name: 'Back to comments', exact: true }).click();
    await expect(column('Ready to verify').getByRole('listitem')).toHaveCount(1);
    // The card opens its thread from the board too
    await expect(await openComment(page, 'Second board thread')).toHaveAccessibleName('Comment by Reviewer');
});
