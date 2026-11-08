import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';

// Point mode takes the page's presses on the window before the page sees them, without covering
// the page (packages/toolbar/src/components/CommentPointOverlay.tsx), and the toolbar moves into the
// page's open popover, menu or dialog (packages/toolbar/src/modalLayer.ts): what opens on a click or
// a hover stays open while the toolbar is used, and what is in it can be pinned.
let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });
test.setTimeout(90_000);

const newComment = (page: Page) => page.getByRole('dialog', { name: 'New comment', exact: true });
const thread = (page: Page) => page.getByRole('dialog', { name: 'Comment thread', exact: true });
const addComment = (page: Page) => page.getByRole('button', { name: 'Add comment', exact: true });
const pointInstruction = (page: Page) => page.getByRole('status').filter({ hasText: 'to pin a comment' });

/** Moves to the target, checks that it is the outlined element, and clicks it */
async function pointAt(page: Page, target: Locator) {
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const outline = page.locator('[data-uier-outline]');
    await expect(outline).toBeVisible();
    await expect.poll(async () => Math.abs((await outline.boundingBox())!.width - box.width)).toBeLessThan(1);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Posts from the keyboard (a press in the toolbar would count as outside the page's menu) and returns the saved selector */
async function postNewComment(page: Page, project: string, text: string) {
    const response = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/review/${project}/comments`);
    const composer = newComment(page).getByRole('textbox', { name: 'Comment', exact: true });
    // Engines without the background member sign-in on this origin comment as a named guest
    const guestName = newComment(page).getByRole('textbox', { name: 'Your name' });
    if (await guestName.isVisible()) await guestName.fill('Menu reviewer');
    await composer.focus();
    await expect(composer).toBeFocused();
    await composer.fill(text);
    await composer.press('Enter');
    const saved = await response;
    expect(saved.status()).toBe(201);
    await expect(thread(page)).toContainText(text);
    await page.keyboard.press('Escape');
    await expect(thread(page)).toBeHidden();
    return (await saved.json() as { id: string; position: { selector: string } });
}

/** The saved selector names exactly this element */
async function expectAnchoredTo(page: Page, selector: string, target: Locator) {
    expect(await target.evaluate((element, saved) => {
        const matches = document.querySelectorAll(saved);
        return matches.length === 1 && matches[0] === element;
    }, selector)).toBe(true);
}

function siteOrigin(testInfo: TestInfo) {
    return testInfo.project.name.includes('Chrome') ? site.origin() : site.loopbackOrigin;
}

test('a modal menu stays open while the toolbar is used, pinned into and typed about', async ({ page }, testInfo) => {
    test.skip(Boolean(testInfo.project.use.hasTouch), 'Pointing with a mouse; taps keep the same press handling');
    const origin = siteOrigin(testInfo);
    await signIn(page, uniqueEmail('transient-ui-menu'));
    const project = await createProject(page, { urls: [origin] });
    await setProjectAccess(page, project, 'Anyone with the link');
    await page.goto(`${origin}/${project}/account?review=true&host-menus`);
    await expect(addComment(page)).toBeVisible();

    const accountButton = page.getByRole('button', { name: 'Account', exact: true });
    await accountButton.click();
    const menu = page.getByRole('menu', { name: 'Account' });
    const signOut = menu.getByRole('menuitem', { name: 'Sign out' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Edit profile' })).toBeFocused();
    // The toolbar is in the menu, so the page counts it as inside; the menu's `aria-hidden` for the
    // rest of the page is taken off it, and its `pointer-events: none` on <body> does not reach it
    await expect(page.locator('#host-menu > #uier-toolbar')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'uier feedback' })).toBeVisible();
    await addComment(page).click();
    await expect(pointInstruction(page)).toBeVisible();
    await expect(menu).toBeVisible();

    const response = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/review/${project}/comments`);
    await pointAt(page, signOut);
    const composer = newComment(page).getByRole('textbox', { name: 'Comment', exact: true });
    const guestName = newComment(page).getByRole('textbox', { name: 'Your name' });
    if (await guestName.isVisible()) await guestName.fill('Menu reviewer');
    await composer.focus();
    // The composer's focus is not focus outside the menu, and its letters are not the menu's typeahead
    await composer.pressSequentially('Explain sign out');
    await expect(composer).toHaveValue('Explain sign out');
    await expect(composer).toBeFocused();
    await expect(menu).toBeVisible();
    expect(await page.evaluate(() => document.body.dataset.chosen)).toBeUndefined();
    await composer.press('Enter');
    const saved = await response;
    expect(saved.status()).toBe(201);
    const comment = await saved.json() as { id: string; position: { selector: string } };
    await expectAnchoredTo(page, comment.position.selector, signOut);
    await expect(thread(page)).toContainText('Explain sign out');
    // Escape closes the thread; the page's own Escape listener does not see it
    await page.keyboard.press('Escape');
    await expect(thread(page)).toBeHidden();
    await expect(menu).toBeVisible();
    const pin = page.locator(`[data-uier-comment="${comment.id}"]`);
    await expect(pin).toBeVisible();

    // A press on the page outside the menu still closes it, and the toolbar returns to <body>
    await page.mouse.click(5, 5);
    await expect(menu).toBeHidden();
    await expect(pin).toHaveCount(0);
    await expect(page.locator('body > #uier-toolbar')).toHaveCount(1);
    expect(await page.locator('#uier-toolbar').getAttribute('popover')).toBeNull();
    await expect(page.getByRole('navigation', { name: 'uier feedback' })).toBeVisible();
});

test('point mode keeps popovers and hover menus open, and pins what is in them and in frames', async ({ page }, testInfo) => {
    test.skip(Boolean(testInfo.project.use.hasTouch), 'Hover and drawing need a mouse; taps keep the same press handling');
    const origin = siteOrigin(testInfo);
    await signIn(page, uniqueEmail('transient-ui'));
    const project = await createProject(page, { urls: [origin] });
    await setProjectAccess(page, project, 'Anyone with the link');
    await page.goto(`${origin}/${project}/account?review=true&host-menus`);
    await expect(addComment(page)).toBeVisible();

    // A native popover closes on any press outside it: the toolbar is in it, above it
    const popover = page.locator('#host-popover');
    const shipping = popover.getByText('Orders ship within two days.');
    await page.getByRole('button', { name: 'Shipping details' }).click();
    await expect(popover).toBeVisible();
    await expect(page.locator('#host-popover > #uier-toolbar')).toHaveCount(1);
    await addComment(page).click();
    await expect(popover).toBeVisible();
    await pointAt(page, shipping);
    await expect(newComment(page)).toBeVisible();
    await expect(popover).toBeVisible();
    const popoverComment = await postNewComment(page, project, 'Give the cut-off time.');
    await expectAnchoredTo(page, popoverComment.position.selector, popover.locator('p'));
    // Escape in the toolbar did not close it either
    await expect(popover).toBeVisible();
    await popover.evaluate((element: HTMLElement) => element.hidePopover());
    await expect(page.locator('body > #uier-toolbar')).toHaveCount(1);

    // C works where the page's focus is, without a press in the toolbar
    await page.getByRole('button', { name: 'Shipping details' }).click();
    await expect(popover).toBeVisible();
    await page.keyboard.press('c');
    await expect(pointInstruction(page)).toBeVisible();
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pointInstruction(page)).toBeHidden();
    await popover.evaluate((element: HTMLElement) => element.hidePopover());

    // A menu shown on hover: the page is not covered, so it stays open while pointing into it
    await page.getByRole('heading', { level: 1 }).click();
    await page.getByText('Help', { exact: true }).hover();
    const contact = page.getByRole('link', { name: 'Contact support' });
    await expect(contact).toBeVisible();
    await page.keyboard.press('c');
    await expect(pointInstruction(page)).toBeVisible();
    await pointAt(page, contact);
    await expect(newComment(page)).toBeVisible();
    // The link was not followed
    expect(new URL(page.url()).hash).toBe('');
    const hoverComment = await postNewComment(page, project, 'Link the help centre too.');
    await expectAnchoredTo(page, hoverComment.position.selector, contact);

    // A script dialog shown and hidden with a class: the toolbar follows it in and back out
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: 'Chat with us' }).click();
    const chat = page.getByRole('dialog', { name: 'Chat', exact: true });
    await expect(chat).toBeVisible();
    await expect(page.locator('#host-sheet > #uier-toolbar')).toHaveCount(1);
    await chat.getByRole('button', { name: 'Close chat' }).click();
    await expect(chat).toBeHidden();
    await expect(page.locator('body > #uier-toolbar')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'uier feedback' })).toBeVisible();

    // A frame's presses go to its own document: a shield takes them, and the frame is pinned
    await page.mouse.move(0, 0);
    await addComment(page).click();
    const frame = page.locator('#host-frame');
    await pointAt(page, frame);
    await expect(newComment(page)).toBeVisible();
    expect(await page.frameLocator('#host-frame').locator('body').getAttribute('data-clicks')).toBeNull();
    const frameComment = await postNewComment(page, project, 'Show the nearest store first.');
    await expectAnchoredTo(page, frameComment.position.selector, frame);
    await expect(page.locator('[data-uier-shield]')).toHaveCount(0);
});

test('a drag that starts on the page draws an area even when it ends over the toolbar', async ({ page }, testInfo) => {
    test.skip(Boolean(testInfo.project.use.hasTouch), 'A finger keeps scrolling the page');
    const origin = siteOrigin(testInfo);
    await signIn(page, uniqueEmail('transient-ui-drag'));
    const project = await createProject(page, { urls: [origin] });
    await setProjectAccess(page, project, 'Anyone with the link');
    await page.goto(`${origin}/${project}/account?review=true&host-menus`);
    await expect(addComment(page)).toBeVisible();

    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    const pill = (await page.getByRole('navigation', { name: 'uier feedback' }).boundingBox())!;
    await addComment(page).click();
    await page.mouse.move(heading.x + 4, heading.y + 4);
    await page.mouse.down();
    await page.mouse.move(heading.x + 80, heading.y + 40, { steps: 4 });
    await expect(page.locator('[data-uier-drawing]')).toBeVisible();
    // Over the toolbar the drag goes on; releasing there ends it without pressing the toolbar
    await page.mouse.move(pill.x + pill.width / 2, pill.y + pill.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('[data-uier-drawing]')).toHaveCount(0);
    await expect(newComment(page)).toBeVisible();
    await expect(page.locator('[data-uier-area=""]')).toHaveCount(1);
    // Nothing on the page was selected by the drag
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
});
