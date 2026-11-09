import { expect, test, type Page } from '@playwright/test';
import { brand } from '@uier/brand';
import { animationsFinished, isolatedOrigin, newVisitor, openLanding, selectText, selectionToolbar, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// The toolbar's keyboard shortcuts (packages/toolbar/src/shortcuts.ts): C for point mode or a comment on
// selected text, never while typing or when the page handles the key; ? lists them all in Options, with
// the switch; G then I, /, J, K, R and S in the inbox; the pill, its status tabs and menus move with arrows.

const instruction = (page: Page) => page.getByRole('status').filter({ hasText: 'anywhere to pin a comment' });
const addComment = (page: Page) => toolbar(page).getByRole('button', { name: 'Add comment', exact: true });
const newComment = (page: Page) => page.getByRole('dialog', { name: 'New comment', exact: true });

test.beforeEach(({}, info) => {
    test.skip(Boolean(info.project.use.hasTouch), 'A hardware keyboard shortcut');
});

test('C starts and ends point mode, but not while typing or when the page handles it', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    const add = addComment(page);
    await expect(add).toHaveAttribute('aria-keyshortcuts', 'C');
    await add.hover();
    await expect(page.locator('[data-uier-tooltip]').locator('kbd')).toHaveText('C');

    await page.keyboard.press('c');
    await expect(instruction(page)).toBeVisible();
    await expect(add).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('c');
    await expect(instruction(page)).toHaveCount(0);
    await expect(add).toHaveAttribute('aria-pressed', 'false');

    // With a modifier the key is not the shortcut; the plain key after them starts point mode once
    await page.keyboard.press('Shift+C');
    await page.keyboard.press('Alt+c');
    await page.keyboard.press('c');
    await expect(instruction(page)).toBeVisible();

    // A click pins the comment; the letter in its text box is text
    const heading = (await page.locator('h1').boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    const text = newComment(page).getByRole('textbox', { name: 'Comment', exact: true });
    await expect(text).toBeFocused();
    await page.keyboard.type('Clear copy');
    await expect(text).toHaveValue('Clear copy');
    await expect(add).toHaveAttribute('aria-pressed', 'false');
    await newComment(page).getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(newComment(page)).toHaveCount(0);

    // A text field on the page keeps its letters
    await page.evaluate(() => {
        const field = document.createElement('input');
        field.setAttribute('aria-label', 'Page search');
        document.querySelector('main')!.prepend(field);
    });
    const field = page.getByRole('textbox', { name: 'Page search' });
    await field.focus();
    await page.keyboard.press('c');
    await expect(field).toHaveValue('c');
    await expect(instruction(page)).toHaveCount(0);

    // A page that handles the key itself keeps it
    await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        document.addEventListener('keydown', event => {
            if (event.key !== 'c') return;
            event.preventDefault();
            document.body.dataset.pageShortcut = 'handled';
        });
    });
    await page.keyboard.press('c');
    await expect(page.locator('body')).toHaveAttribute('data-page-shortcut', 'handled');
    await expect(instruction(page)).toHaveCount(0);
    await context.close();
});

test('C comments on selected text', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    await selectText(page, brand.shortDescription);
    await expect(selectionToolbar(page).getByRole('button', { name: 'Add comment', exact: true }))
        .toHaveAttribute('aria-keyshortcuts', 'C');

    await page.keyboard.press('c');
    await expect(newComment(page).getByRole('textbox', { name: 'Comment', exact: true })).toBeFocused();
    await expect(selectionToolbar(page)).toHaveCount(0);
    await expect(instruction(page)).toHaveCount(0);
    await context.close();
});

test('the shortcuts can be turned off in Options, and stay off in this browser', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    const add = addComment(page);
    const optionsButton = page.getByRole('button', { name: 'Options', exact: true });
    const options = page.getByRole('dialog', { name: 'Options' });

    await optionsButton.click();
    const shortcutsSwitch = options.getByRole('switch', { name: 'Shortcuts', exact: true });
    await expect(shortcutsSwitch).toBeChecked();
    // Faded in: measured colours are only final after that
    await animationsFinished(options);
    await expectNoAxeViolations(page);
    // Like a menu: ↓ goes to the first item, the switch in its own group, then to Keyboard shortcuts
    await page.keyboard.press('ArrowDown');
    await expect(shortcutsSwitch).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(options.getByRole('button', { name: 'Keyboard shortcuts', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    // The switch toggles in place: the menu stays open with the new state
    await page.keyboard.press('Enter');
    await expect(shortcutsSwitch).not.toBeChecked();
    await expect(shortcutsSwitch).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(options).toBeHidden();
    await expect(add).not.toHaveAttribute('aria-keyshortcuts');
    await page.keyboard.press('c');
    await expect(instruction(page)).toHaveCount(0);

    await page.reload();
    await expect(add).toBeVisible();
    await expect(add).not.toHaveAttribute('aria-keyshortcuts');
    await page.keyboard.press('c');
    await expect(instruction(page)).toHaveCount(0);

    // ? is off too
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
    await optionsButton.click();
    await options.getByRole('switch', { name: 'Shortcuts', exact: true }).click();
    await expect(options.getByRole('switch', { name: 'Shortcuts', exact: true })).toBeChecked();
    await page.keyboard.press('Escape');
    // Closed: the toolbar's dialogs keep their keys
    await expect(options).toBeHidden();
    await expect(add).toHaveAttribute('aria-keyshortcuts', 'C');
    await page.keyboard.press('c');
    await expect(instruction(page)).toBeVisible();
    await context.close();
});

test('the pill is one tab stop, ? lists the shortcuts, and G then I, /, J, K, R and S work in the inbox', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    const origin = isolatedOrigin(info);
    for (const text of ['First keyboard thread', 'Second keyboard thread']) {
        const response = await context.request.post(`${origin}/api/comments`, { data: { path: '/', kind: 'feedback', position: { type: 'page' }, text } });
        expect(response.status()).toBe(201);
    }
    await openLanding(page, origin, { dismissHint: true });

    // The pill's buttons: one tab stop, ← and → between them, Home and End to the ends
    const tools = toolbar(page).getByRole('toolbar', { name: 'Tools' });
    const stops = tools.locator('button:not([tabindex="-1"])');
    await expect(stops).toHaveCount(1);
    const add = addComment(page);
    await add.focus();
    await page.keyboard.press('ArrowRight');
    await expect(add).not.toBeFocused();
    await expect(stops).toHaveCount(1);
    await expect(stops).toBeFocused();
    await page.keyboard.press('End');
    await expect(tools.getByRole('button', { name: 'Collapse toolbar', exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(add).toBeFocused();

    // ? opens Options on the shortcuts, with the focus on their heading
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help).toBeVisible();
    await expect(help.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeFocused();
    await expect(help.getByText('Next thread', { exact: true })).toBeVisible();
    await animationsFinished(help);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    // G then I opens the inbox (Close has the focus, as when it opens), / goes to its search
    await add.focus();
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    await expect(inbox).toBeVisible();
    await expect(inbox.getByRole('button', { name: 'Close sidebar', exact: true })).toBeFocused();
    await page.keyboard.press('/');
    await expect(inbox.getByRole('searchbox', { name: 'Search comments' })).toBeFocused();
    await expect(inbox.getByRole('searchbox', { name: 'Search comments' })).toHaveValue('');

    // The status tabs: one tab stop, ← and → move, Enter chooses
    const tabs = inbox.getByRole('group', { name: 'Show comments' });
    await expect(tabs.locator('button:not([tabindex="-1"])')).toHaveCount(1);
    const open = tabs.getByRole('button', { name: /^Open/ });
    await open.focus();
    await page.keyboard.press('ArrowRight');
    const inProgress = tabs.getByRole('button', { name: /^In progress/ });
    await expect(inProgress).toBeFocused();
    await expect(open).toHaveAttribute('aria-pressed', 'true');

    // J and K go from card to card; R opens the reply box of the one with the focus, S goes to its status menu
    const cards = inbox.getByRole('article');
    await expect(cards.filter({ hasText: 'keyboard thread' })).toHaveCount(2);
    await inbox.getByRole('button', { name: 'Close sidebar', exact: true }).focus();
    await page.keyboard.press('j');
    await expect(cards.first()).toBeFocused();
    await page.keyboard.press('j');
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press('k');
    await expect(cards.first()).toBeFocused();
    const mine = cards.filter({ hasText: 'Second keyboard thread' });
    await mine.focus();
    await page.keyboard.press('s');
    const status = mine.getByRole('button', { name: 'Status: Open. Change status', exact: true });
    await expect(status).toBeFocused();
    await expect(status).toHaveAttribute('aria-keyshortcuts', 'S');
    // Enter opens the status menu, the current status focused; ↓ moves on, Esc goes back
    await page.keyboard.press('Enter');
    const statusMenu = page.getByRole('dialog', { name: 'Status', exact: true });
    await expect(statusMenu.getByRole('button', { name: 'Open', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(statusMenu.getByRole('button', { name: 'In progress', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(statusMenu).toBeHidden();
    await expect(status).toBeFocused();
    await mine.focus();
    await page.keyboard.press('r');
    const reply = mine.getByRole('textbox', { name: 'Reply', exact: true });
    await expect(reply).toBeFocused();
    await page.keyboard.type('jk');
    await expect(reply).toHaveValue('jk');
    await context.close();
});
