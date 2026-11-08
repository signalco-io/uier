import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { backToComments, createProject, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, toolbar, threadOptions } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });
async function fixture(page: Page, request: APIRequestContext) {
    await signIn(page, uniqueEmail('verification'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, project, site.origin());
    const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
        path: `/${project}/checkout`, text: 'Checkout needs a fix', authorName: 'Original reviewer', position: { type: 'page' }, kind: 'feedback'
    } });
    expect(response.status()).toBe(201);
    const comment = await response.json();
    await page.goto(`/app/projects/${project}`);
    return { project, headers, comment };
}

/** Ready to verify in a card's status menu opens the Request verification form */
async function openRequestForm(page: Page, card: Locator, from = 'Open') {
    await card.getByRole('button', { name: `Status: ${from}. Change status`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Ready to verify', exact: true }).click();
    return card.getByRole('form', { name: 'Request verification' });
}

for (const colorScheme of ['light', 'dark'] as const) {
    test(`request in app, original guest rejects and confirms in cross-origin inbox, with ${colorScheme} theme`, async ({ page, request, browser, baseURL }, testInfo) => {
        test.setTimeout(60_000);
        await page.emulateMedia({ colorScheme });
        const f = await fixture(page, request);
        const card = await openComment(page, 'Checkout needs a fix');
        // No standing button: the request starts from the status menu
        await expect(card.getByRole('button', { name: 'Request verification', exact: true })).toHaveCount(0);
        const form = await openRequestForm(page, card);
        await expect(form.getByRole('textbox', { name: 'Fix summary', exact: true })).toBeFocused();
        await form.getByRole('textbox', { name: 'Fix summary', exact: true }).fill('Fixed the checkout handler');
        await form.getByRole('textbox', { name: 'Fix link (optional)', exact: true }).fill('https://github.com/example/repo/pull/12');
        await form.getByRole('button', { name: 'Request verification', exact: true }).click();
        const status = card.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true });
        await expect(status).toBeVisible();
        await expect(card.getByRole('button', { name: 'Confirm fix', exact: true })).toHaveCount(0);
        await expect(status).toBeFocused();
        await expect(card.getByRole('link', { name: 'Open fix link' })).toHaveAttribute('href', 'https://github.com/example/repo/pull/12');
        await backToComments(page);
        await page.getByRole('button', { name: 'Board', exact: true }).click();
        const ready = page.getByRole('region', { name: 'Ready to verify comments', exact: true });
        await expect(ready.getByRole('listitem')).toHaveCount(1);
        await expect(page.getByRole('region', { name: 'Open comments', exact: true }).getByRole('listitem')).toHaveCount(0);
        await expectNoAxeViolations(page);
        const mobile = testInfo.project.name.startsWith('Mobile');
        const guestContext = await browser.newContext({ baseURL, viewport: page.viewportSize()!, isMobile: mobile, hasTouch: mobile, colorScheme });
        await guestContext.addInitScript(visitor => { try { localStorage.setItem('uier:visitor', visitor); } catch { /* Initial empty frame has no storage. */ } }, f.headers['X-Uier-Visitor']);
        const guest = await guestContext.newPage();
        try {
            await guest.goto(`${site.origin()}/${f.project}/checkout?review=true`);
            await expect(toolbar(guest)).toBeVisible();
            await guest.getByRole('button', { name: /^Inbox/ }).click();
            const inbox = guest.getByRole('complementary', { name: 'Comments' });
            await inbox.getByRole('button', { name: /^Ready to verify/ }).click();
            await expect(inbox.getByRole('button', { name: /^Ready to verify/ })).toHaveAttribute('aria-pressed', 'true');
            await expect(inbox.getByRole('article')).toHaveCount(1);
            await expectNoAxeViolations(guest);
            await guest.screenshot({ path: testInfo.outputPath(`verification-inbox-${colorScheme}.png`) });
            const rejected = guest.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/review/${f.project}/comments/${f.comment.id}/verification`);
            await inbox.getByRole('button', { name: 'Still needs work', exact: true }).click();
            expect((await rejected).status()).toBe(200);
            await expect(inbox.getByRole('article')).toHaveCount(0);
            await page.reload();
            // Still needs work: someone continues the fix
            await expect(page.getByRole('region', { name: 'In progress comments', exact: true }).getByRole('listitem')).toHaveCount(1);
            const thread = await openComment(page, 'Checkout needs a fix');
            await (await openRequestForm(page, thread, 'In progress')).getByRole('button', { name: 'Request verification', exact: true }).click();
            await expect(thread.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true })).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.getByRole('region', { name: 'Ready to verify comments', exact: true }).getByRole('listitem')).toHaveCount(1);
            await guest.reload();
            await guest.getByRole('button', { name: /^Inbox/ }).click();
            await inbox.getByRole('button', { name: /^Ready to verify/ }).click();
            const confirm = inbox.getByRole('button', { name: 'Confirm fix', exact: true });
            await confirm.focus();
            const confirmed = guest.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/review/${f.project}/comments/${f.comment.id}/verification`);
            await confirm.press('Enter');
            expect((await confirmed).status()).toBe(200);
            await expect(inbox.getByRole('article')).toHaveCount(0);
            await page.reload();
            await expect(page.getByRole('region', { name: 'Done comments', exact: true }).getByRole('listitem')).toHaveCount(1);
            const done = await openComment(page, 'Checkout needs a fix');
            await expect(done).toContainText('Fix confirmed by Original reviewer');
            await animationsFinished(page.locator('body'));
            await page.screenshot({ path: testInfo.outputPath(`verification-${colorScheme}.png`) });
            await expectNoAxeViolations(page);
            await guest.reload();
            await guest.getByRole('button', { name: /^Inbox/ }).click();
            await inbox.getByRole('button', { name: /^Done/ }).click();
            await expect(inbox.getByRole('article')).toContainText('Fix confirmed by Original reviewer');
        } finally { await guestContext.close(); }
    });
}

test('ordinary Done and Reopen stay unconfirmed and retain replies, search and selection', async ({ page, request }) => {
    const f = await fixture(page, request);
    const card = await openComment(page, 'Checkout needs a fix');
    await card.getByRole('button', { name: 'Reply', exact: true }).click();
    await card.getByRole('textbox', { name: 'Reply', exact: true }).fill('Retained reply draft');
    await (await openRequestForm(page, card)).getByRole('button', { name: 'Request verification', exact: true }).click();
    await card.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Done without verification', exact: true }).click();
    await backToComments(page);
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    const doneColumn = page.getByRole('region', { name: 'Done comments', exact: true });
    await expect(doneColumn.getByRole('listitem')).toHaveCount(1);
    const done = await openComment(page, 'Checkout needs a fix');
    await expect(done).toContainText('Done without reviewer confirmation');
    await expect(done.getByRole('button', { name: 'Confirm fix', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await doneColumn.getByRole('checkbox', { name: `Select comment #${f.comment.number}`, exact: true }).check();
    await page.getByRole('button', { name: 'Reopen selected', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Open comments', exact: true }).getByRole('listitem')).toHaveCount(1);
    const search = page.getByRole('searchbox', { name: 'Search feedback' });
    await search.fill('Checkout');
    const reopened = await openComment(page, 'Checkout needs a fix');
    await reopened.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(reopened.getByRole('textbox', { name: 'Reply', exact: true })).toHaveValue('Retained reply draft');
});

test('members request and cancel from the toolbar using the existing participants and keyboard focus', async ({ page, request }) => {
    const f = await fixture(page, request);
    const url = `${site.origin()}/${f.project}/checkout`;
    await page.goto(`/app/review/${f.project}?url=${encodeURIComponent(url)}`);
    await expect(toolbar(page)).toBeVisible();
    await page.getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    // Request verification is in Thread options; the form opens in the thread
    await (await threadOptions(page, inbox.getByRole('article'))).getByRole('button', { name: 'Request verification', exact: true }).click();
    await expect(inbox.getByRole('textbox', { name: 'Fix summary', exact: true })).toBeFocused();
    await inbox.getByRole('textbox', { name: 'Fix summary', exact: true }).fill('Ready to check on the reviewed site');
    await inbox.getByRole('form', { name: 'Request verification' }).getByRole('button', { name: 'Request verification', exact: true }).click();
    await expect(inbox.getByRole('button', { name: 'Done without verification', exact: true })).toBeVisible();
    await expect(inbox.getByRole('button', { name: 'Confirm fix', exact: true })).toHaveCount(0);
    await expect(inbox.getByRole('button', { name: 'Thread options', exact: true })).toBeFocused();
    const bounds = (await inbox.getByRole('article').boundingBox())!;
    for (const button of await inbox.getByRole('article').getByRole('button').all()) {
        const box = await button.boundingBox();
        if (box) { expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1); expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1); }
    }
    await inbox.getByRole('button', { name: 'Cancel request', exact: true }).click();
    await expect(inbox.getByRole('article')).toContainText('Request canceled.');
    await expect(inbox.getByRole('button', { name: 'Mark as done', exact: true })).toBeVisible();
});

test('the status menu lists every status; Open and In progress from Ready to verify cancel the check', async ({ page, request }) => {
    await fixture(page, request);
    const card = await openComment(page, 'Checkout needs a fix');
    await card.getByRole('button', { name: 'Status: Open. Change status', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Open', 'In progress', 'Ready to verify', 'Done']);
    await page.keyboard.press('Escape');
    const form = await openRequestForm(page, card);
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(form).toBeHidden();
    await expect(card.getByRole('button', { name: 'Status: Open. Change status', exact: true })).toBeFocused();

    await (await openRequestForm(page, card)).getByRole('button', { name: 'Request verification', exact: true }).click();
    await card.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true }).click();
    await expect(menu.getByRole('menuitem')).toHaveText(['Open', 'In progress', 'Ready to verify', 'Done without verification']);
    await menu.getByRole('menuitem', { name: 'Open', exact: true }).click();
    await expect(card).toContainText('Request canceled.');
    await expect(card.getByRole('button', { name: 'Status: Open. Change status', exact: true })).toBeVisible();

    // In progress from Ready to verify cancels the check too, and the thread stays In progress
    await (await openRequestForm(page, card)).getByRole('button', { name: 'Request verification', exact: true }).click();
    await card.getByRole('button', { name: 'Status: Ready to verify. Change status', exact: true }).click();
    await menu.getByRole('menuitem', { name: 'In progress', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Status: In progress. Change status', exact: true })).toBeVisible();
    await expect(card).toContainText('Request canceled.');
    await page.reload();
    await expect(card.getByRole('button', { name: 'Status: In progress. Change status', exact: true })).toBeVisible();
});
