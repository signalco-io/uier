import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { commentBubbles, selectText, selectionToolbar } from './support/toolbar';

// A native modal dialog (`showModal()`) makes the rest of the page inert and sits in the top layer.
// The toolbar moves into it while it is open (packages/toolbar/src/modalLayer.ts).
let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });
test.setTimeout(90_000);

function siteOrigin(testInfo: TestInfo) {
    // Other engines have no wildcard `*.localhost` DNS: the site's separate loopback port
    return testInfo.project.name.includes('Chrome') ? site.origin() : site.loopbackOrigin;
}

const hostDialog = (page: Page) => page.getByRole('dialog', { name: 'Project brief', exact: true });
const newComment = (page: Page) => page.getByRole('dialog', { name: 'New comment', exact: true });
const thread = (page: Page) => page.getByRole('dialog', { name: 'Comment thread', exact: true });
const addComment = (page: Page) => page.getByRole('button', { name: 'Add comment', exact: true });
const pointInstruction = (page: Page) => page.getByRole('status').filter({ hasText: 'to pin a comment' });

async function postNewComment(page: Page, text: string) {
    const composer = newComment(page).getByRole('textbox', { name: 'Comment', exact: true });
    await expect(composer).toBeFocused();
    await composer.fill(text);
    await newComment(page).getByRole('button', { name: 'Post comment' }).click();
    await expect(thread(page)).toContainText(text);
    // Escape closes the thread, not the page's modal
    await page.keyboard.press('Escape');
    await expect(thread(page)).toBeHidden();
    await expect(hostDialog(page)).toBeVisible();
}

/** Every pin is drawn inside the dialog's box */
async function expectPinsInside(page: Page, count: number) {
    await expect(commentBubbles(page)).toHaveCount(count);
    const box = (await page.locator('#host-dialog').boundingBox())!;
    for (const pin of await commentBubbles(page).all()) {
        const { x, y } = (await pin.boundingBox())!;
        expect(x).toBeGreaterThanOrEqual(box.x - 24);
        expect(x).toBeLessThanOrEqual(box.x + box.width + 24);
        expect(y).toBeGreaterThanOrEqual(box.y - 24);
        expect(y).toBeLessThanOrEqual(box.y + box.height + 24);
    }
}

test('a native modal dialog can be reviewed while it is open and keeps its own Escape and focus', async ({ page }, testInfo) => {
    const origin = siteOrigin(testInfo);
    const touch = Boolean(testInfo.project.use.hasTouch);
    await signIn(page, uniqueEmail('modal-dialog'));
    const project = await createProject(page, { urls: [origin] });
    await setProjectAccess(page, project, 'Anyone with the link');
    await page.goto(`${origin}/${project}/checkout?review=true&host-dialog`);
    await expect(addComment(page)).toBeVisible();

    // A pin on the page behind the modal
    await addComment(page).click();
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    // Engines without the background member sign-in on this origin comment as a named guest
    const guestName = newComment(page).getByRole('textbox', { name: 'Your name' });
    if (await guestName.isVisible()) await guestName.fill('Modal reviewer');
    await newComment(page).getByRole('textbox', { name: 'Comment', exact: true }).fill('Name the plan in the heading.');
    await newComment(page).getByRole('button', { name: 'Post comment' }).click();
    await expect(thread(page)).toContainText('Name the plan in the heading.');
    await page.keyboard.press('Escape');
    await expect(commentBubbles(page)).toHaveCount(1);

    // From the keyboard: Safari does not focus a clicked button, so it would have no focus to restore
    const opener = page.getByRole('button', { name: 'Read the project brief' });
    await opener.focus();
    await opener.press('Enter');
    await expect(hostDialog(page)).toBeVisible();
    // The toolbar is in the modal's subtree, so it stays usable and in the accessibility tree
    await expect(page.locator('#host-dialog > #uier-toolbar')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'uier feedback' })).toBeVisible();
    // The inert page behind the backdrop has no pins, and the page's backdrop is not doubled
    await expect(commentBubbles(page)).toHaveCount(0);
    expect(await page.locator('#uier-toolbar').evaluate(host => getComputedStyle(host, '::backdrop').display)).toBe('none');

    // Escape in point mode cancels placing the comment; the modal stays open
    await addComment(page).click();
    await expect(pointInstruction(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pointInstruction(page)).toBeHidden();
    await expect(hostDialog(page)).toBeVisible();

    // An element in the modal; a click on its backdrop does not pin the page behind it
    await addComment(page).click();
    await page.mouse.click(4, 4);
    await expect(newComment(page)).toHaveCount(0);
    await expect(hostDialog(page)).toBeVisible();
    const brief = (await hostDialog(page).getByText('Check the checkout copy').boundingBox())!;
    await page.mouse.click(brief.x + 10, brief.y + brief.height / 2);
    // Escape in the composer closes it (keeping the draft) and keeps the modal
    const composer = newComment(page).getByRole('textbox', { name: 'Comment', exact: true });
    await expect(composer).toBeFocused();
    await composer.fill('Say which day');
    await composer.press('Escape');
    await expect(newComment(page)).toBeHidden();
    await expect(hostDialog(page)).toBeVisible();
    await page.getByRole('button', { name: 'New comment', exact: true }).click();
    await postNewComment(page, 'Say which day the launch is.');

    // An area in the modal (mouse and pen draw areas; a finger keeps scrolling)
    if (!touch) {
        const title = (await hostDialog(page).getByRole('heading', { name: 'Project brief' }).boundingBox())!;
        await addComment(page).click();
        await page.mouse.move(title.x, title.y);
        await page.mouse.down();
        await page.mouse.move(title.x + 60, title.y + title.height / 2, { steps: 4 });
        await page.mouse.move(title.x + 120, title.y + title.height, { steps: 4 });
        await page.mouse.up();
        await expect(page.locator('[data-uier-area=""]')).toHaveCount(1);
        await postNewComment(page, 'More room around the title.');
    }

    // Selected text in the modal
    await selectText(page, 'before the launch on Friday');
    await selectionToolbar(page).getByRole('button', { name: 'Add comment', exact: true }).click();
    await postNewComment(page, 'Which Friday?');
    await page.evaluate(() => getSelection()?.removeAllRanges());

    const modalPins = touch ? 2 : 3;
    await expectPinsInside(page, modalPins);
    // Escape in the page's modal (nothing of the review open) closes it, and focus returns to its opener
    await hostDialog(page).getByRole('textbox', { name: 'Discount code' }).click();
    await page.keyboard.press('Escape');
    await expect(hostDialog(page)).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.locator('body > #uier-toolbar')).toHaveCount(1);
    // The modal's pins leave with it; the page's come back
    await expect(commentBubbles(page)).toHaveCount(1);
    await addComment(page).click();
    await expect(pointInstruction(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pointInstruction(page)).toBeHidden();

    // Open again: the pins are back, and the close button still closes it
    await opener.press('Enter');
    await expectPinsInside(page, modalPins);
    await hostDialog(page).getByRole('button', { name: 'Close brief' }).click();
    await expect(hostDialog(page)).toBeHidden();
    await expect(opener).toBeFocused();
});

test('pages without a modal and non-modal dialogs keep the toolbar in the body', async ({ page }, testInfo) => {
    const origin = siteOrigin(testInfo);
    await signIn(page, uniqueEmail('modal-dialog-none'));
    const project = await createProject(page, { urls: [origin] });
    await setProjectAccess(page, project, 'Anyone with the link');
    await page.goto(`${origin}/${project}/checkout?review=true&host-dialog`);
    await expect(addComment(page)).toBeVisible();
    await expect(page.locator('body > #uier-toolbar')).toHaveCount(1);
    expect(await page.locator('#uier-toolbar').getAttribute('popover')).toBeNull();

    // `show()` is not modal: the page stays interactive and the toolbar stays where it was
    await page.locator('#host-dialog').evaluate((dialog: HTMLDialogElement) => dialog.show());
    await expect(hostDialog(page)).toBeVisible();
    await expect(page.locator('body > #uier-toolbar')).toHaveCount(1);
    await addComment(page).click();
    const brief = (await hostDialog(page).getByText('Check the checkout copy').boundingBox())!;
    await page.mouse.click(brief.x + 10, brief.y + brief.height / 2);
    await expect(newComment(page).getByRole('textbox', { name: 'Comment', exact: true })).toBeFocused();
});
