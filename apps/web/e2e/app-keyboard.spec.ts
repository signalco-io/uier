import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { appNavigation, commentRowLink, commentRows, createProject, inBackground, openBoardMove, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// The app with the keyboard (src/components/app/keyboard): the board, My work, the sidebar and tabs are
// composites with one tab stop and arrow keys; single-key shortcuts (J, K, R, S, A, /, C, G then I, B,
// M or P) never act while typing, list themselves on ?, and can be turned off.

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test.beforeEach(({}, info) => {
    test.skip(Boolean(info.project.use.hasTouch), 'A hardware keyboard');
});

async function project(page: Page, request: APIRequestContext, count: number) {
    await signIn(page, uniqueEmail('keys'));
    const id = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, id, 'Anyone with the link');
    const headers = await verifiedReviewHeaders(request, id, site.origin());
    const numbers: number[] = [];
    for (let index = 1; index <= count; index++) {
        const response = await request.post(`/api/review/${id}/comments`, { headers, data: {
            path: `/${id}/pricing`, text: `Keyboard thread ${index}`, authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
        numbers.push((await response.json()).number);
    }
    return { id, numbers };
}

const openId = (page: Page) => new URL(page.url()).searchParams.get('comment');
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
/** Links in the Tab order among these */
const tabStops = (links: Locator) => links.and(links.page().locator(':not([tabindex="-1"])'));

test('the board is one tab stop: the arrows move between cards and columns, J and K between threads', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { id, numbers } = await project(page, request, 3);
    await page.goto(`/app/projects/${id}?view=board`);
    const column = (name: string) => page.getByRole('region', { name: `${name} comments`, exact: true });
    await expect(column('Open').getByRole('listitem')).toHaveCount(3);
    // One thread in Done, through Move
    const [third, second, first] = [...numbers].sort((a, b) => b - a);
    const menu = await openBoardMove(page, first!, column('Open'));
    await animationsFinished(menu);
    await menu.getByRole('menuitem', { name: 'Done', exact: true }).click();
    await expect(column('Done').getByRole('listitem')).toHaveCount(1);
    await blur(page);

    // Highest number first in a column; one card link in the Tab order
    const links = page.getByRole('link', { name: /^Comment #\d+/ });
    await expect(tabStops(links)).toHaveCount(1);
    const link = (number: number) => commentRowLink(page, number);
    await link(third!).focus();
    await page.keyboard.press('ArrowDown');
    await expect(link(second!)).toBeFocused();
    await expect(tabStops(links)).toHaveCount(1);
    await expect(link(second!)).not.toHaveAttribute('tabindex', '-1');
    // At the end of a column the key does nothing
    await page.keyboard.press('ArrowDown');
    await expect(link(second!)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(link(third!)).toBeFocused();
    await page.keyboard.press('End');
    await expect(link(second!)).toBeFocused();
    // → goes past the empty columns to Done, ← back to the card in the same place (or the last)
    await page.keyboard.press('ArrowRight');
    await expect(link(first!)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(link(third!)).toBeFocused();
    // Tab reaches the card's Move, then leaves the board
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: `Move comment #${third}`, exact: true })).toBeFocused();

    // J and K: the next and the previous card in reading order (column by column), then in the sheet the next thread
    await blur(page);
    await page.keyboard.press('j');
    await expect(link(second!)).toBeFocused();
    await page.keyboard.press('k');
    await expect(link(third!)).toBeFocused();
    await page.keyboard.press('j');
    await expect(link(second!)).toBeFocused();
    await page.keyboard.press('Enter');
    const thread = page.getByRole('article');
    await expect(thread).toContainText(`Comment #${second}`);
    const opened = openId(page);
    await page.keyboard.press('j');
    await expect(thread).toContainText(`Comment #${first}`);
    expect(openId(page)).not.toBe(opened);
    await page.keyboard.press('k');
    await expect(thread).toContainText(`Comment #${second}`);
    // S and A open the thread's menus as Enter does; R its reply box
    await page.keyboard.press('s');
    const statusMenu = page.getByRole('menu');
    await expect(statusMenu.getByRole('menuitem', { name: 'In progress', exact: true })).toBeVisible();
    await animationsFinished(statusMenu);
    await page.keyboard.press('Escape');
    await expect(statusMenu).toBeHidden();
    await expect(thread.getByRole('button', { name: 'Status: Open. Change status', exact: true })).toBeFocused();
    await page.keyboard.press('r');
    await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toBeFocused();
    await page.keyboard.type('jk');
    await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toHaveValue('jk');
    await expect(thread).toContainText(`Comment #${second}`);
});

test('the list: J and K from the open thread, R, S, A and /, and ? lists them with the switch that turns them off', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { id } = await project(page, request, 3);
    await page.goto(`/app/projects/${id}`);
    await expect(commentRows(page)).toHaveCount(3);
    const links = commentRows(page).getByRole('link');
    const thread = page.getByRole('article');
    const rowText = async (index: number) => /Keyboard thread \d/.exec(await links.nth(index).innerText())![0];

    // From the open thread (its Reply button has the focus): J opens the next, K the previous
    await expect(thread).toContainText(await rowText(0));
    const reply = thread.getByRole('button', { name: 'Reply', exact: true });
    await expect(reply).toHaveAttribute('aria-keyshortcuts', 'R');
    await reply.focus();
    await page.keyboard.press('j');
    await expect(thread).toContainText(await rowText(1));
    await expect(links.nth(1)).toBeFocused();
    await thread.getByRole('button', { name: 'Reply', exact: true }).focus();
    await page.keyboard.press('j');
    await expect(thread).toContainText(await rowText(2));
    await page.keyboard.press('k');
    await expect(thread).toContainText(await rowText(1));

    // A opens the assignee menu, S the status menu; R the reply box, where the letters are text
    const status = thread.getByRole('button', { name: 'Status: Open. Change status', exact: true });
    await expect(status).toHaveAttribute('aria-keyshortcuts', 'S');
    await page.keyboard.press('a');
    const menu = page.getByRole('menu');
    await expect(menu.getByText('Assign to', { exact: true })).toBeVisible();
    await animationsFinished(menu);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await page.keyboard.press('s');
    await expect(menu.getByRole('menuitem', { name: 'Done', exact: true })).toBeVisible();
    await animationsFinished(menu);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await page.keyboard.press('r');
    const box = thread.getByRole('textbox', { name: 'Reply', exact: true });
    await expect(box).toBeFocused();
    await page.keyboard.type('jsa?/');
    await expect(box).toHaveValue('jsa?/');
    await expect(thread).toContainText(await rowText(1));
    await box.fill('');

    // / goes to the search
    await blur(page);
    const search = page.getByRole('searchbox', { name: 'Search feedback' });
    await expect(search).toHaveAttribute('aria-keyshortcuts', '/');
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');

    // ? lists every shortcut, with the switch for the single keys
    await blur(page);
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help).toBeVisible();
    await expect(help.getByText('Next thread', { exact: true })).toBeVisible();
    await animationsFinished(help);
    await expectNoAxeViolations(page);
    const toggle = help.getByRole('switch', { name: 'Single-key shortcuts' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    // Off: the letters do nothing, the arrows still move
    const shown = await rowText(1);
    await blur(page);
    await page.keyboard.press('j');
    await page.keyboard.press('?');
    await expect(help).toBeHidden();
    await expect(thread).toContainText(shown);
    await expect(status).not.toHaveAttribute('aria-keyshortcuts');
    await links.nth(1).focus();
    await page.keyboard.press('ArrowDown');
    await expect(thread).toContainText(await rowText(2));
    // The account menu opens them too, and turns them back on
    await page.getByRole('button', { name: /^Account:/ }).click();
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
    await expect(help).toBeVisible();
    await help.getByRole('switch', { name: 'Single-key shortcuts' }).click();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await blur(page);
    await page.keyboard.press('k');
    await expect(thread).toContainText(shown);
});

test('one switch for the app and its toolbar: turned off on either side, the other stops too', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, uniqueEmail('keys'));
    await page.goto('/app/projects');
    // uier's toolbar on the page (its own bundle, its own listeners): Give feedback mounts it
    await appNavigation(page);
    const giveFeedback = page.getByRole('button', { name: 'Give feedback' });
    await expect(giveFeedback).toHaveAttribute('aria-keyshortcuts', 'C');
    await giveFeedback.click();
    const feedback = page.getByRole('dialog', { name: 'Send feedback' });
    await expect(feedback).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(feedback).toBeHidden();
    const add = toolbar(page).getByRole('button', { name: 'Add comment', exact: true });
    const pointMode = page.getByRole('status').filter({ hasText: 'anywhere to pin a comment' });
    await expect(add).toHaveAttribute('aria-keyshortcuts', 'C');
    // With the focus in the toolbar, C is the toolbar's
    await add.focus();
    await page.keyboard.press('c');
    await expect(pointMode).toBeVisible();
    await page.keyboard.press('c');
    await expect(pointMode).toHaveCount(0);

    // Off in the app's dialog: the toolbar's letters stop as well
    await blur(page);
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await help.getByRole('switch', { name: 'Single-key shortcuts' }).click();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await expect(giveFeedback).not.toHaveAttribute('aria-keyshortcuts');
    await expect(add).not.toHaveAttribute('aria-keyshortcuts');
    await add.focus();
    await page.keyboard.press('c');
    await expect(pointMode).toHaveCount(0);

    // On in the toolbar's Options: the app's come back
    const optionsButton = toolbar(page).getByRole('button', { name: 'Options', exact: true });
    const options = page.getByRole('dialog', { name: 'Options' });
    await optionsButton.click();
    await options.getByRole('button', { name: 'Turn on shortcuts', exact: true }).click();
    await expect(options).toBeHidden();
    await expect(giveFeedback).toHaveAttribute('aria-keyshortcuts', 'C');
    await expect(add).toHaveAttribute('aria-keyshortcuts', 'C');

    // Off in the toolbar's Options: the app's letters stop
    await optionsButton.click();
    await options.getByRole('button', { name: 'Turn off shortcuts', exact: true }).click();
    await expect(options).toBeHidden();
    await expect(giveFeedback).not.toHaveAttribute('aria-keyshortcuts');
    await blur(page);
    await page.keyboard.press('?');
    await page.keyboard.press('c');
    await expect(help).toBeHidden();
    await expect(feedback).toBeHidden();
});

test('the sidebar, the tabs and My work are one tab stop each; G then I, B, M or P goes there', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { id, numbers } = await project(page, request, 2);
    // The threads stay unread while shown, for My work's Unread
    await inBackground(page);
    await page.goto(`/app/projects/${id}`);
    await expect(commentRows(page)).toHaveCount(2);

    // G then B and G then I switch the view in place; a letter alone does nothing
    await blur(page);
    await page.keyboard.press('b');
    expect(new URL(page.url()).searchParams.get('view')).toBeNull();
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('board');
    await expect(page.getByRole('region', { name: 'Open comments', exact: true })).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBeNull();
    await expect(commentRows(page)).toHaveCount(2);

    // On a focused card, M after G goes to My work instead of opening the card's Move
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await commentRowLink(page, numbers[0]!).focus();
    await page.keyboard.press('g');
    await page.keyboard.press('m');
    await expect(page).toHaveURL(/\/app\/my-work$/);
    await expect(page.getByRole('menu')).toHaveCount(0);

    // My work's rows move like the list's, J and K across its lists
    const unread = page.getByRole('list', { name: 'Unread', exact: true });
    const rows = unread.getByRole('link', { name: /^Comment #\d+/ });
    await expect(rows).toHaveCount(2);
    await expect(tabStops(rows)).toHaveCount(1);
    await blur(page);
    await page.keyboard.press('j');
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    await expect(tabStops(rows)).toHaveCount(1);
    await page.keyboard.press('k');
    await expect(rows.first()).toBeFocused();

    // The navigation: the current page's link is its tab stop; ↓ and ↑, Home and End move between its links
    const nav = page.getByRole('navigation', { name: 'App' });
    const navLinks = nav.locator('[data-roving-item]');
    await expect(navLinks.and(page.locator(':not([tabindex="-1"])'))).toHaveCount(1);
    const myWork = nav.getByRole('link', { name: 'My work', exact: true });
    await expect(myWork).not.toHaveAttribute('tabindex', '-1');
    await myWork.focus();
    await page.keyboard.press('ArrowUp');
    await expect(nav.getByRole('link', { name: 'Projects', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(myWork).toBeFocused();
    await page.keyboard.press('End');
    await expect(navLinks.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(nav.getByRole('link', { name: 'Projects', exact: true })).toBeFocused();

    // G then P: Projects. The workspace's tabs: ← and → move, Enter opens
    await blur(page);
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await expect(page).toHaveURL(/\/app\/projects$/);
    await page.goto('/app/workspace/users');
    const tabs = page.getByRole('navigation', { name: 'Workspace' }).getByRole('link');
    await expect(tabStops(tabs)).toHaveCount(1);
    await tabs.filter({ hasText: 'Users' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabStops(tabs)).toHaveCount(1);
    const next = await tabs.nth(1).getAttribute('href');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${next}$`));
});
