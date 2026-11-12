import { expect, test } from '@playwright/test';
import { isolatedOrigin, newVisitor, openLanding } from './support/toolbar';

// The rich message editor (uier #290) in the toolbar, on desktop and mobile: Markdown typed while writing
// formats the text, the formatting keys work, what is sent is Markdown and the thread shows it formatted.
// The app's reply box (the same editor, loaded on demand) is in message-markdown.spec.ts.

test('Markdown typed in the toolbar formats as it is written and is sent as Markdown', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
    const feedback = page.getByRole('dialog', { name: 'Send feedback', exact: true });
    const text = feedback.getByRole('textbox', { name: 'Feedback', exact: true });
    await expect(text).toBeFocused();

    // `## ` makes a heading, `- ` a list, `**…**` bold and `*…*` italic once the closing delimiter is typed;
    // Shift+Enter is a new line or item, a second one on an empty item leaves the list
    await text.pressSequentially('## Pricing');
    await expect(text.locator('h2')).toHaveText('Pricing');
    await text.press('Shift+Enter');
    await text.pressSequentially('- The total wraps');
    await text.press('Shift+Enter');
    await text.pressSequentially('**Save** is hidden');
    await text.press('Shift+Enter');
    await text.press('Shift+Enter');
    await expect(text.getByRole('listitem')).toHaveText(['The total wraps', 'Save is hidden']);
    await expect(text.getByRole('listitem').locator('strong')).toHaveText('Save');
    // Ctrl/⌘+B turns bold on and off for what is typed next
    await text.press('ControlOrMeta+b');
    await text.pressSequentially('Fix');
    await text.press('ControlOrMeta+b');
    await text.pressSequentially(' soon with *care*');
    await expect(text.locator(':scope > p strong')).toHaveText('Fix');
    await expect(text.locator('em')).toHaveText('care');
    await expect(text).toHaveText('PricingThe total wrapsSave is hiddenFix soon with care', { useInnerText: false });

    const sent = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/comments');
    await text.press('Enter');
    expect((await sent).postDataJSON().text).toBe('## Pricing\n\n- The total wraps\n- **Save** is hidden\n\n**Fix** soon with *care*');
    await expect(page.getByRole('status').filter({ hasText: 'Feedback sent' })).toBeAttached();

    // The inbox shows the message formatted, as every thread does
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Inbox/ }).click();
    const message = page.getByRole('complementary', { name: 'Comments' }).locator('[data-markdown]').filter({ hasText: 'Pricing' });
    await expect(message.getByRole('listitem')).toHaveCount(2);
    await expect(message.locator('strong').filter({ hasText: /^Fix$/ })).toBeVisible();
    await expect(message.locator('em')).toHaveText('care');
    await context.close();
});

test('the toolbar editor keeps typed Markdown characters as text after Backspace and stops at the length limit', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
    const feedback = page.getByRole('dialog', { name: 'Send feedback', exact: true });
    const text = feedback.getByRole('textbox', { name: 'Feedback', exact: true });

    // Backspace right after a conversion brings the typed characters back, and they stay text
    await text.pressSequentially('2 *3*');
    await expect(text.locator('em')).toHaveText('3');
    await text.press('Backspace');
    await expect(text.locator('em')).toHaveCount(0);
    await expect(text).toHaveText('2 *3*', { useInnerText: true });

    // Pasted Markdown is formatted too
    await text.press('ControlOrMeta+a');
    await text.press('Delete');
    await text.evaluate(element => {
        const data = new DataTransfer();
        data.setData('text/plain', 'Steps:\n\n1. Open **Pricing**\n2. Scroll down');
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(text.getByRole('listitem')).toHaveText(['Open Pricing', 'Scroll down']);
    await expect(text.locator('li strong')).toHaveText('Pricing');

    // Over the 1000-character limit, as much as fits is kept
    await text.fill('a'.repeat(1100));
    await expect.poll(async () => (await text.innerText()).length).toBe(1000);
    await expect(feedback.getByText('1000/1000')).toBeVisible();
    await context.close();
});
