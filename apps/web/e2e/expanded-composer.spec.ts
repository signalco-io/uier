import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { isolatedOrigin, newVisitor, openLanding } from './support/toolbar';
import { pngImage } from './support/images';

// A new comment and feedback expand from their popover to a modal for focused writing, and collapse
// back; the form goes on (packages/toolbar/docs/expanded-composer.md)

const isModal = (dialog: Locator) => dialog.evaluate(element => element.matches('dialog:modal'));

function nextCreatedComment(page: Page) {
    return page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/comments')
        .then(request => request.postDataJSON() as { text: string; kind?: string; screenshot?: string });
}

test('feedback expands to a modal and back, keeping its text, type, image and screenshot choice', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    await page.getByRole('button', { name: 'Send feedback' }).click();
    const form = page.getByRole('dialog', { name: 'Send feedback' });
    await form.getByRole('button', { name: 'Bug report', exact: true }).click();
    const text = form.getByRole('textbox', { name: 'Bug report' });
    await text.fill('The pricing table overlaps the footer.');
    await form.getByRole('button', { name: 'Omit screenshot' }).click();
    await expect.poll(() => isModal(form)).toBe(false);

    // Expanded: the same form in a modal, the rest of the page inert behind it, the text box larger and focused
    const small = (await text.boundingBox())!;
    const popover = (await form.boundingBox())!;
    await form.getByRole('button', { name: 'Expand' }).click();
    await expect(form).toHaveCount(1);
    await expect.poll(() => isModal(form)).toBe(true);
    await expect(text).toBeFocused();
    await expect(text).toHaveValue('The pricing table overlaps the footer.');
    await expect(form.getByRole('button', { name: 'Bug report', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(form.getByRole('button', { name: 'Omit screenshot' })).toHaveAttribute('aria-pressed', 'true');
    expect((await text.boundingBox())!.height).toBeGreaterThan(small.height);
    expect((await form.boundingBox())!.width).toBeGreaterThan(popover.width);
    await expectNoAxeViolations(page);

    // Escape goes back to the popover (not closing it), with everything kept
    await text.press('End');
    await text.pressSequentially(' On narrow windows.');
    await page.keyboard.press('Escape');
    await expect(form).toBeVisible();
    await expect.poll(() => isModal(form)).toBe(false);
    await expect(text).toBeFocused();
    await expect(text).toHaveValue('The pricing table overlaps the footer. On narrow windows.');
    await expect(form.getByRole('button', { name: 'Omit screenshot' })).toHaveAttribute('aria-pressed', 'true');

    // An image attached in the modal is still attached after Collapse, and is sent
    await form.getByRole('button', { name: 'Expand' }).click();
    await form.locator('input[type="file"]').setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: Buffer.from(pngImage.split(',')[1]!, 'base64') });
    await expect(form.getByRole('button', { name: 'Remove attached image evidence.png' })).toBeVisible();
    await form.getByRole('button', { name: 'Collapse' }).click();
    await expect.poll(() => isModal(form)).toBe(false);
    await expect(form.getByRole('button', { name: 'Remove attached image evidence.png' })).toBeVisible();
    await expect(text).toBeFocused();

    // Sent from the modal: it closes, and the next feedback opens as a popover
    await form.getByRole('button', { name: 'Expand' }).click();
    const sent = nextCreatedComment(page);
    await text.press('Enter');
    expect(await sent).toMatchObject({ text: 'The pricing table overlaps the footer. On narrow windows.', kind: 'bug', screenshot: pngImage });
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Bug report sent' })).toBeAttached();
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await expect.poll(() => isModal(form)).toBe(false);
    await context.close();
});

test('a new comment expands to a modal; the backdrop and Collapse go back, and it posts from either', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    const draft = page.getByRole('dialog', { name: 'New comment', exact: true });
    const text = draft.getByRole('textbox', { name: 'Comment', exact: true });
    await text.fill('The heading could be shorter.');

    await draft.getByRole('button', { name: 'Expand' }).click();
    await expect.poll(() => isModal(draft)).toBe(true);
    await expect(text).toBeFocused();
    await expect(text).toHaveValue('The heading could be shorter.');
    // Tab stays in the modal: the page and the toolbar behind it are inert
    for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        expect(await draft.evaluate(dialog => {
            const root = dialog.getRootNode() as ShadowRoot;
            return !root.activeElement || dialog.contains(root.activeElement);
        })).toBe(true);
    }
    await expectNoAxeViolations(page);

    // A press on the backdrop collapses it to the popover on its pin
    await page.mouse.click(4, 4);
    await expect(draft).toBeVisible();
    await expect.poll(() => isModal(draft)).toBe(false);
    await expect(text).toHaveValue('The heading could be shorter.');

    // Posted from the modal: the comment's thread opens on its pin
    await draft.getByRole('button', { name: 'Expand' }).click();
    const sent = nextCreatedComment(page);
    await text.press('Enter');
    expect((await sent).text).toBe('The heading could be shorter.');
    const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
    await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toBeFocused();
    await expect.poll(() => isModal(thread)).toBe(false);
    await expect(page.locator('dialog')).toHaveCount(0);
    await context.close();
});
