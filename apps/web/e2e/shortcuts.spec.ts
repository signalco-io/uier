import { expect, test, type Page } from '@playwright/test';
import { brand } from '@uier/brand';
import { animationsFinished, isolatedOrigin, newVisitor, openLanding, selectText, selectionToolbar, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// C, the toolbar's keyboard shortcut (packages/toolbar/src/shortcuts.ts): point mode, a comment on
// selected text, never while typing or when the page handles the key, and the switch in Options.

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

test('the shortcut can be turned off in Options, and stays off in this browser', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    const add = addComment(page);
    const optionsButton = page.getByRole('button', { name: 'Options', exact: true });
    const options = page.getByRole('dialog', { name: 'Options' });

    await optionsButton.click();
    await expect(options.getByRole('button', { name: 'Turn off shortcut C', exact: true })).toBeVisible();
    // Faded in: measured colours are only final after that
    await animationsFinished(options);
    await expectNoAxeViolations(page);
    await options.getByRole('button', { name: 'Turn off shortcut C', exact: true }).click();
    await expect(options).toBeHidden();
    await expect(page.getByText('Shortcut C turned off')).toBeAttached();
    await expect(add).not.toHaveAttribute('aria-keyshortcuts');
    await page.keyboard.press('c');
    await expect(instruction(page)).toHaveCount(0);

    await page.reload();
    await expect(add).toBeVisible();
    await expect(add).not.toHaveAttribute('aria-keyshortcuts');
    await page.keyboard.press('c');
    await expect(instruction(page)).toHaveCount(0);

    await optionsButton.click();
    await options.getByRole('button', { name: 'Turn on shortcut C', exact: true }).click();
    // Closed: the toolbar's dialogs keep their keys
    await expect(options).toBeHidden();
    await expect(add).toHaveAttribute('aria-keyshortcuts', 'C');
    await page.keyboard.press('c');
    await expect(instruction(page)).toBeVisible();
    await context.close();
});
