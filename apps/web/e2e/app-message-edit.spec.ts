import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, inBackground, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { animationsFinished } from './support/toolbar';

test('own replies are edited in place in the open thread, keeping mentions and never overwriting a newer message', async ({ page, request, baseURL }) => {
    const { startReviewedSite } = await import('./support/reviewedSite');
    const { verifiedReviewHeaders } = await import('./support/reviewVerification');
    const site = await startReviewedSite(baseURL!);
    await inBackground(page);
    try {
        const email = uniqueEmail('app-edit');
        await signIn(page, email);
        const project = await createProject(page, { urls: [site.origin()] });
        await setProjectAccess(page, project, 'Anyone with the link');
        const headers = await verifiedReviewHeaders(request, project, site.origin());
        const response = await request.post(`/api/review/${project}/comments`, { headers, data: {
            path: '/edit-in-app', position: { type: 'point', selector: '#missing-anchor', xNormal: 0.5, yNormal: 0.5 }, text: 'Thread to edit in the app', authorName: 'Guest reviewer'
        } });
        expect(response.status()).toBe(201);
        await page.goto(`/app/projects/${project}`);
        const card = await openComment(page, 'Thread to edit in the app');
        await card.getByRole('button', { name: 'Reply', exact: true }).click();
        const input = card.getByRole('textbox', { name: 'Reply', exact: true });
        const name = email.split('@')[0];
        await input.fill('Please check @');
        await expect(card.getByRole('listbox', { name: 'Mention people' }).getByRole('option')).toHaveCount(1);
        // Typing straight after choosing a mention continues after it (the caret never jumps back)
        await input.press('Tab');
        await input.pressSequentially('first draft');
        await expect(input).toHaveValue(`Please check @${name} first draft`);
        await input.press('Enter');
        await expect(card.getByRole('status').filter({ hasText: /^Reply posted$/ })).toHaveText('Reply posted');
        await card.getByRole('button', { name: 'Close reply' }).click();

        // The reply's menu: Edit first, wide enough that no item wraps
        const actions = card.getByRole('button', { name: 'More actions for reply by you', exact: true });
        await actions.click();
        const menu = page.getByRole('menu');
        await expect(menu.getByRole('menuitem', { name: 'Edit', exact: true })).toBeVisible();
        await animationsFinished(menu);
        expect((await menu.boundingBox())!.width).toBeGreaterThanOrEqual(192);
        const lineHeight = (await menu.getByRole('menuitem', { name: 'Edit', exact: true }).boundingBox())!.height;
        expect((await menu.getByRole('menuitem', { name: 'More from this author', exact: true }).boundingBox())!.height).toBe(lineHeight);
        await menu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
        const editor = card.getByRole('textbox', { name: 'Edit reply', exact: true });
        await expect(editor).toBeFocused();
        await expect(editor).toHaveValue(`Please check @${name} first draft`);
        await expect(actions).toHaveCount(0);
        await expectNoAxeViolations(page);
        // Escape and Cancel leave the message as it was and give the focus back to its menu
        await editor.press('Escape');
        await expect(editor).toHaveCount(0);
        await expect(actions).toBeFocused();
        await actions.click();
        await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
        await editor.fill('');
        await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
        await card.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(card.getByText(`Please check @${name} first draft`, { exact: true })).toBeVisible();

        // Typing after the mention keeps it, a new mention continues where it was chosen; the edit shows at once, labeled
        await actions.click();
        await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
        await editor.press('End');
        await editor.pressSequentially(', ask @');
        await expect(card.getByRole('listbox', { name: 'Mention people' }).getByRole('option')).toHaveCount(1);
        await editor.press('Enter');
        await editor.pressSequentially('then ship');
        await expect(editor).toHaveValue(`Please check @${name} first draft, ask @${name} then ship`);
        // Reload while editing: both the text and selected mention identities come back in this message.
        await page.reload();
        await expect(editor).toHaveValue(`Please check @${name} first draft, ask @${name} then ship`);
        await card.getByRole('button', { name: 'Save', exact: true }).click();
        const edited = `Please check @${name} first draft, ask @${name} then ship (edited)`;
        await expect(card.getByText(edited, { exact: true })).toBeVisible();
        await expect(actions).toBeFocused();
        await page.reload();
        await expect(card.getByText(edited, { exact: true })).toBeVisible();
        await expect(card.locator('[data-mention]')).toHaveText([`@${name}`, `@${name}`]);

        // Another tab saves first: this edit is refused, its text kept until the person cancels
        const other = await page.context().newPage();
        // The page's address opens this thread
        await other.goto(page.url());
        const otherCard = other.getByRole('article');
        await otherCard.getByRole('button', { name: 'More actions for reply by you', exact: true }).click();
        await other.getByRole('menuitem', { name: 'Edit', exact: true }).click();
        await otherCard.getByRole('textbox', { name: 'Edit reply', exact: true }).fill('Edited in another tab');
        await otherCard.getByRole('textbox', { name: 'Edit reply', exact: true }).press('Enter');
        await expect(otherCard.getByText('Edited in another tab (edited)', { exact: true })).toBeVisible();
        await other.close();
        await actions.click();
        await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
        await editor.fill('My stale edit');
        // The restored editor must retain the original expectedText even though the page now has a newer reply.
        await page.reload();
        await expect(editor).toHaveValue('My stale edit');
        await editor.press('Enter');
        await expect(card.getByRole('alert')).toContainText('This message changed while you were editing.');
        await expect(editor).toHaveValue('My stale edit');
        await page.reload();
        await expect(editor).toHaveValue('My stale edit');
        await card.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.reload();
        await expect(card.getByText('Edited in another tab (edited)', { exact: true })).toBeVisible();
        await expect(card.getByText('My stale edit')).toHaveCount(0);
    } finally { await site.close(); }
});
