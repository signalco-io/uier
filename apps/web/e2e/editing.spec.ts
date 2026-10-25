import { expect, test } from '@playwright/test';
import { isolatedOrigin, newVisitor, openLanding, openThread } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

test('own comments and replies can be edited, canceled and opened in the inbox after reload', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await page.evaluate(async () => {
        await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            path: '/', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Original message'
        }) });
    });
    await page.reload();
    await page.locator('[data-uier-comment]').click();
    const thread = openThread(page);
    const menu = thread.getByRole('button', { name: 'More options for your comment' });
    const startEdit = async () => {
        await menu.click();
        await page.getByRole('dialog', { name: 'Comment options', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
    };
    await startEdit();
    const editor = thread.getByRole('textbox', { name: 'Edit comment', exact: true });
    await expect(editor).toHaveValue('Original message');
    await editor.fill('');
    await expect(thread.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await editor.fill('Canceled change');
    await thread.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(thread.getByText('Original message', { exact: true })).toBeVisible();
    await expect(menu).toBeFocused();
    await startEdit();
    await editor.fill('Corrected message');
    await thread.getByRole('button', { name: 'Save changes' }).click();
    await expect(thread.getByText('Corrected message (edited)', { exact: true })).toBeVisible();
    await expect(menu).toBeFocused();
    await thread.getByRole('textbox', { name: 'Reply', exact: true }).fill('Original reply');
    await thread.getByRole('button', { name: 'Post reply', exact: true }).click();
    await thread.getByRole('button', { name: 'More options for your reply' }).click();
    await page.getByRole('dialog', { name: 'Reply options', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
    await thread.getByRole('textbox', { name: 'Edit reply', exact: true }).fill('Corrected reply');
    await thread.getByRole('button', { name: 'Save changes' }).click();
    await expect(thread.getByText('Corrected reply (edited)', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    await expect(inbox).toContainText('Corrected message (edited)');
    await expect(inbox).toContainText('Corrected reply (edited)');
    await page.reload();
    await page.locator('[data-uier-comment]').click();
    await expect(openThread(page)).toContainText('Corrected message (edited)');
    await expect(openThread(page)).toContainText('Corrected reply (edited)');
    await context.close();
});

test('failed and stale edits keep the attempted text and never overwrite the newer message', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    const comment = await page.evaluate(async () => (await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        path: '/', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Original message'
    }) })).json()) as { id: string; thread: { items: { id: string }[] } };
    await page.reload();
    await page.locator('[data-uier-comment]').click();
    const thread = openThread(page);
    await thread.getByRole('button', { name: 'More options for your comment' }).click();
    await page.getByRole('dialog', { name: 'Comment options', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = thread.getByRole('textbox', { name: 'Edit comment', exact: true });
    await editor.fill('Keep my attempted correction');
    const endpoint = `**/api/comments/${comment.id}/replies/${comment.thread.items[0]!.id}`;
    await page.route(endpoint, route => route.abort('failed'));
    await thread.getByRole('button', { name: 'Save changes' }).click();
    await expect(thread.getByRole('alert')).toContainText('Check your connection');
    await expect(editor).toHaveValue('Keep my attempted correction');
    await page.unroute(endpoint);
    await page.route(endpoint, route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'comments_disabled', message: 'Comments off' }) }));
    await thread.getByRole('button', { name: 'Save changes' }).click();
    await expect(thread.getByRole('alert')).toContainText('Comments are turned off');
    await expect(editor).toHaveValue('Keep my attempted correction');
    await page.unroute(endpoint);
    // Another editor saves while this edit is open. The API compares only this message's text.
    await page.evaluate(async ({ id, itemId }) => {
        const response = await fetch(`/api/comments/${id}/replies/${itemId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'Newer saved message', expectedText: 'Original message' }) });
        if (!response.ok) throw new Error('Concurrent edit failed');
    }, { id: comment.id, itemId: comment.thread.items[0]!.id });
    await thread.getByRole('button', { name: 'Save changes' }).click();
    await expect(thread.getByRole('alert')).toContainText('This message changed');
    await expect(editor).toHaveValue('Keep my attempted correction');
    await thread.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(thread).toContainText('Newer saved message (edited)');
    await thread.getByRole('button', { name: 'More options for your comment' }).click();
    await page.getByRole('dialog', { name: 'Comment options', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(editor).toHaveValue('Newer saved message');
    await editor.fill('Reviewed correction');
    await thread.getByRole('button', { name: 'Save changes' }).click();
    await expect(thread).toContainText('Reviewed correction (edited)');
    await context.close();
});

test('missing browser hints stay unknown and public feedback never exposes reproduction details', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await page.addInitScript(() => Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: undefined }));
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await page.getByRole('button', { name: 'Add comment' }).click();
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    const draft = page.getByRole('dialog', { name: 'New comment' });
    await draft.getByRole('textbox', { name: 'Comment', exact: true }).fill('A report without client hints');
    const posted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/comments' && response.request().method() === 'POST');
    await draft.getByRole('button', { name: 'Post comment' }).click();
    const response = await posted;
    const sent = response.request().postDataJSON();
    expect(sent.device.browser).toBeUndefined();
    expect(sent.device.os).toBeUndefined();
    expect(sent.device.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const saved = await response.json();
    expect(saved.device).toEqual({ size: sent.device.size, windowSize: sent.device.windowSize });
    expect(saved.reproduction).toBeUndefined();
    await expect(openThread(page).getByRole('button', { name: 'Reproduction details' })).toHaveCount(0);
    await context.close();
});
