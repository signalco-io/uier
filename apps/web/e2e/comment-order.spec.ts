import { expect, test, type Page } from '@playwright/test';
import { commentRowLink, commentRows, createProject, openBoardMove, selectionBox, selectThread, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { newVisitor } from './support/toolbar';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

// A project's comments show by priority (Urgent, High, Normal, Low), then by number, highest first:
// in the list and active columns. Done uses latest completion, including after reopening. Each board
// column can have its own sort instead, saved on the project for everyone.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

/** Sets one thread's priority with the selection's Prioritize selected */
async function prioritize(page: Page, number: number, priority: 'Urgent' | 'High' | 'Low') {
    await selectThread(page, number);
    await page.getByRole('combobox', { name: 'Prioritize selected' }).click();
    await page.getByRole('option', { name: priority, exact: true }).click();
    await expect(selectionBox(page, number)).toBeEnabled();
    await expect(selectionBox(page, number)).not.toBeChecked();
}

test('active threads use priority and number; Done uses latest completion', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'The order is the same on every screen');
    await signIn(page, uniqueEmail('comment-order'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const numbers: number[] = [];
    for (let index = 1; index <= 4; index++) {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text: `Order thread ${index}`, authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
        numbers.push((await response.json() as { number: number }).number);
    }
    await page.goto(`/app/projects/${project}`);
    // All Normal: by number, highest first
    await expect(commentRows(page)).toHaveText([/Order thread 4/, /Order thread 3/, /Order thread 2/, /Order thread 1/]);

    // A new priority moves the thread at once
    await prioritize(page, numbers[2]!, 'Urgent');
    await expect(commentRows(page)).toHaveText([/Order thread 3/, /Order thread 4/, /Order thread 2/, /Order thread 1/]);
    await prioritize(page, numbers[0]!, 'Low');
    await prioritize(page, numbers[3]!, 'High');
    const order = [/Order thread 3/, /Order thread 4/, /Order thread 2/, /Order thread 1/];
    await expect(commentRows(page)).toHaveText(order);
    await page.reload();
    await expect(commentRows(page)).toHaveText(order);

    // The board column, in the same order
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Open comments', exact: true }).getByRole('listitem')).toHaveText(order);
    const done = page.getByRole('region', { name: 'Done comments', exact: true });
    for (const index of [2, 3, 0]) {
        await openBoardMove(page, numbers[index]!);
        await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
        await expect(done.getByRole('listitem').first()).toContainText(`Order thread ${index + 1}`);
    }
    await expect(done.getByRole('listitem')).toHaveText([/Order thread 1/, /Order thread 4/, /Order thread 3/]);
    await page.reload();
    await expect(done.getByRole('listitem')).toHaveText([/Order thread 1/, /Order thread 4/, /Order thread 3/]);
    await openBoardMove(page, numbers[2]!, done);
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
    await openBoardMove(page, numbers[2]!);
    await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
    await expect(done.getByRole('listitem').first()).toContainText('Order thread 3');
});

test('each board column keeps the project\'s sort for everyone, and drops, Move and the keys follow it', async ({ page, request, browser }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('Mobile'), 'The order is the same on every screen');
    test.setTimeout(60_000);
    // Every column fits beside the sidebar, so a card is dragged from one to another without scrolling the board
    await page.setViewportSize({ width: 1674, height: 900 });
    await signIn(page, uniqueEmail('board-sort'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const numbers: number[] = [];
    for (let index = 1; index <= 3; index++) {
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: `/${project}/pricing`, text: `Sorted thread ${index}`, authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
        numbers.push((await response.json() as { number: number }).number);
    }
    const [first, second, third] = numbers as [number, number, number];
    await page.goto(`/app/projects/${project}`);
    // The first thread is Urgent: by priority it leads, by age it is the oldest
    await prioritize(page, first, 'Urgent');
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    const open = page.getByRole('region', { name: 'Open comments', exact: true });
    const done = page.getByRole('region', { name: 'Done comments', exact: true });
    await expect(open.getByRole('listitem')).toHaveText([/Sorted thread 1/, /Sorted thread 3/, /Sorted thread 2/]);

    // Each column's header has its sort; the usual one shows only the icon
    const sortOpen = open.getByRole('button', { name: /^Sort Open: / });
    await expect(sortOpen).toHaveAccessibleName('Sort Open: Priority');
    await expect(sortOpen).toHaveText('');
    await sortOpen.click();
    let menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Priority', 'Newest first', 'Oldest first', 'Recently updated']);
    await expect(menu.getByRole('menuitemradio', { name: 'Priority', exact: true })).toBeChecked();
    await menu.getByRole('menuitemradio', { name: 'Newest first', exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(open.getByRole('listitem')).toHaveText([/Sorted thread 3/, /Sorted thread 2/, /Sorted thread 1/]);
    // Another order than the column's usual one says which
    await expect(sortOpen).toHaveAccessibleName('Sort Open: Newest first');
    await expect(sortOpen).toHaveText('Newest');

    // ↓ and J follow the column's order
    await commentRowLink(open, third).focus();
    await page.keyboard.press('ArrowDown');
    await expect(commentRowLink(open, second)).toBeFocused();
    await page.keyboard.press('j');
    await expect(commentRowLink(open, first)).toBeFocused();

    // Done offers Recently completed too, its usual order
    const sortDone = done.getByRole('button', { name: /^Sort Done: / });
    await expect(sortDone).toHaveAccessibleName('Sort Done: Recently completed');
    await sortDone.click();
    menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Recently completed', 'Priority', 'Newest first', 'Oldest first', 'Recently updated']);
    await menu.getByRole('menuitemradio', { name: 'Oldest first', exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(sortDone).toHaveText('Oldest');

    // Move lands a card in its new column's order: the oldest first, not the latest completed
    for (const number of [first, third]) {
        await openBoardMove(page, number);
        await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
        await expect(commentRowLink(done, number)).toBeVisible();
    }
    await expect(done.getByRole('listitem')).toHaveText([/Sorted thread 1/, /Sorted thread 3/]);

    // A dragged card's place in the column is where it lands: between them, by age. Move's menu has closed
    // (it holds the page's pointer until then) and the card has slid into place.
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.locator('[data-drag-preview], [data-motion]')).toHaveCount(0);
    const card = open.locator('[data-board-card]').filter({ hasText: 'Sorted thread 2' });
    const from = (await card.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
    await expect(page.locator('[data-drag-preview]')).toBeVisible();
    const to = (await done.boundingBox())!;
    await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 10 });
    await expect(done.locator('ul > li').nth(1)).toHaveAttribute('data-drop-placeholder', '');
    await page.mouse.up();
    await expect(done.getByRole('listitem')).toHaveText([/Sorted thread 1/, /Sorted thread 2/, /Sorted thread 3/]);

    // Saved on the project: after a reload, and for a teammate in their own browser
    await page.reload();
    await expect(done.getByRole('listitem')).toHaveText([/Sorted thread 1/, /Sorted thread 2/, /Sorted thread 3/]);
    await expect(sortOpen).toHaveAccessibleName('Sort Open: Newest first');
    await page.goto('/app/users');
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    const invitation = page.getByRole('dialog');
    await invitation.getByLabel('Email').fill(uniqueEmail('board-sort-teammate'));
    await invitation.getByRole('radio', { name: /^Admin/ }).click();
    await invitation.getByRole('button', { name: 'Send invitation' }).click();
    const inviteLink = await invitation.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    const teammate = await newVisitor(browser, testInfo);
    try {
        await teammate.page.goto(inviteLink!);
        await teammate.page.getByRole('button', { name: 'Accept invitation' }).click();
        await expect(teammate.page).not.toHaveURL(/invitation/);
        await teammate.page.goto(`/app/projects/${project}?view=board`);
        await expect(teammate.page.getByRole('region', { name: 'Done comments', exact: true }).getByRole('listitem'))
            .toHaveText([/Sorted thread 1/, /Sorted thread 2/, /Sorted thread 3/]);
        await expect(teammate.page.getByRole('region', { name: 'Done comments', exact: true }).getByRole('button', { name: /^Sort Done: / }))
            .toHaveAccessibleName('Sort Done: Oldest first');
    } finally {
        await teammate.context.close();
    }
});
