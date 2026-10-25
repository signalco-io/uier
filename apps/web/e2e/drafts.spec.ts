import type { CommentDto } from '../src/lib/comments/dto';
import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { animationsFinished, isolatedOrigin, newVisitor, openLanding, openThread, selectText, selectionToolbar } from './support/toolbar';

async function startPoint(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    return page.getByRole('dialog', { name: 'New comment', exact: true });
}

test('pinned and rewrite drafts restore text/anchors on navigation and reload, with explicit discard', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    const origin = isolatedOrigin(info);
    await openLanding(page, origin, { dismissHint: true });
    const draft = await startPoint(page);
    await draft.getByRole('textbox', { name: 'Comment', exact: true }).fill('Keep my anchored feedback');
    const before = await page.locator('[data-uier-comment="new"]').boundingBox();
    await page.keyboard.press('Escape');
    await page.locator('[data-uier-comment="new"]').click();
    await expect(draft.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Keep my anchored feedback');
    await page.goto(`${origin}/brand`);
    await expect(page.locator('[data-uier-comment="new"]')).toHaveCount(0);
    await page.goto(origin);
    await page.getByRole('button', { name: 'New comment', exact: true }).click();
    await expect(draft.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Keep my anchored feedback');
    const after = await page.locator('[data-uier-comment="new"]').boundingBox();
    expect(Math.abs(after!.x - before!.x)).toBeLessThan(3);
    await expect(draft.locator('img')).toHaveCount(0);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await page.getByRole('button', { name: 'New comment', exact: true }).click();
    await expect(draft.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Keep my anchored feedback');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
    await page.screenshot({ path: info.outputPath('draft-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    await page.getByRole('button', { name: 'New comment', exact: true }).click();
    await expect(draft.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Keep my anchored feedback');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await animationsFinished(page.locator('body'));
    await expectNoAxeViolations(page);
    await page.screenshot({ path: info.outputPath('draft-light.png') });
    await draft.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.reload();
    await expect(page.locator('[data-uier-comment="new"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await (await startPoint(page)).getByRole('textbox', { name: 'Comment', exact: true }).fill('Another anchored draft');
    await page.keyboard.press('Escape');
    await selectText(page, 'Review any live website');
    await selectionToolbar(page).getByRole('button', { name: 'Rewrite' }).click();
    const rewrite = page.getByRole('dialog', { name: 'New rewrite suggestion' });
    await rewrite.getByRole('textbox', { name: 'Suggested text' }).fill('Keep the rewrite');
    await page.reload();
    await page.getByRole('button', { name: 'New rewrite suggestion', exact: true }).click();
    await expect(rewrite.getByRole('textbox', { name: 'Suggested text' })).toHaveValue('Keep the rewrite');
    await expect(rewrite).toContainText('Review any live website');
    await expect(page.locator('[data-uier-comment="new"]')).toHaveCount(2);
    expect(await page.evaluate(() => JSON.stringify(Object.values(localStorage)))).not.toContain('data:image');
    await rewrite.getByRole('button', { name: 'Discard' }).click();
    await page.getByRole('button', { name: 'New comment', exact: true }).click();
    await expect(draft.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Another anchored draft');
    await draft.getByRole('button', { name: 'Discard' }).click();
    await context.close();
});

test('uncertain create and reply responses survive reload and repeated submission saves once', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    const origin = isolatedOrigin(info);
    await openLanding(page, origin, { dismissHint: true });
    const draft = await startPoint(page);
    await draft.getByRole('textbox', { name: 'Comment', exact: true }).fill('Save once after a lost response');
    let posts = 0;
    let firstKey: string | undefined;
    await page.route('**/api/comments', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        posts++;
        firstKey = route.request().postDataJSON().idempotencyKey;
        const saved = await route.fetch();
        expect(saved.status()).toBe(201);
        await route.abort('failed');
    });
    await draft.locator('form').evaluate(form => {
        (form as HTMLFormElement).requestSubmit();
        (form as HTMLFormElement).requestSubmit();
        (form as HTMLFormElement).requestSubmit();
    });
    await expect(draft.getByRole('alert')).toContainText('Check your connection');
    expect(posts).toBe(1);
    await expect(draft.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Save once after a lost response');
    await page.reload();
    await page.getByRole('button', { name: 'New comment', exact: true }).click();
    await expect(draft.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Save once after a lost response');
    await page.unroute('**/api/comments');
    const retry = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/comments');
    await draft.getByRole('button', { name: 'Post comment' }).click();
    expect((await retry).postDataJSON().idempotencyKey).toBe(firstKey);
    await expect(page.getByRole('dialog', { name: 'Comment thread' })).toContainText('Save once after a lost response');
    const comments = await page.evaluate(async () => (await fetch('/api/comments?path=/')).json()) as CommentDto[];
    expect(comments).toHaveLength(1);
    const thread = page.getByRole('dialog', { name: 'Comment thread' });
    await thread.getByRole('textbox', { name: 'Reply', exact: true }).fill('Keep this reply too');
    const repliesUrl = `**/api/comments/${comments[0]!.id}/replies`;
    await page.route(repliesUrl, async route => { expect((await route.fetch()).status()).toBe(201); await route.abort('failed'); });
    await thread.getByRole('button', { name: 'Post reply' }).click();
    await expect(thread.getByRole('alert')).toContainText('Check your connection');
    await page.reload();
    await page.locator(`[data-uier-comment="${comments[0]!.id}"]`).click();
    await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toHaveValue('Keep this reply too');
    await page.unroute(repliesUrl);
    await thread.getByRole('button', { name: 'Post reply' }).click();
    await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toHaveValue('');
    const saved = await page.evaluate(async () => (await (await fetch('/api/comments?path=/')).json() as CommentDto[])[0]) as CommentDto;
    expect(saved.thread.items.map(item => 'text' in item ? item.text : '')).toEqual(['Save once after a lost response', 'Keep this reply too']);
    await context.close();
});

test('page feedback, bugs and edits keep separate drafts and sign-out clears every page', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    const origin = isolatedOrigin(info);
    await openLanding(page, origin, { dismissHint: true });
    await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
    const feedback = page.getByRole('dialog', { name: 'Send feedback', exact: true });
    await feedback.getByRole('textbox', { name: 'Feedback', exact: true }).fill('Feedback draft');
    await feedback.getByRole('button', { name: 'Bug report', exact: true }).click();
    await feedback.getByRole('textbox', { name: 'Bug report', exact: true }).fill('Bug draft');
    await page.reload();
    await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
    await expect(feedback.getByRole('textbox', { name: 'Bug report', exact: true })).toHaveValue('Bug draft');
    await feedback.getByRole('button', { name: 'Feedback', exact: true }).click();
    await expect(feedback.getByRole('textbox', { name: 'Feedback', exact: true })).toHaveValue('Feedback draft');
    await feedback.getByRole('button', { name: 'Send feedback', exact: true }).click();
    await expect(feedback).toBeHidden();
    await page.keyboard.press('Escape');
    await page.goto(`${origin}/brand`);
    const other = await startPoint(page);
    await other.getByRole('textbox', { name: 'Comment', exact: true }).fill('Other page draft');
    await page.goto(origin);
    // Saved feedback has no pin. Open its edit in the inbox, then reload to restore the original edit snapshot.
    await page.getByRole('button', { name: /^Inbox/ }).click();
    await page.getByRole('button', { name: 'More options for your comment' }).click();
    await page.getByRole('dialog', { name: 'Comment options', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('textbox', { name: 'Edit comment', exact: true }).fill('Edit draft');
    await page.reload();
    await page.getByRole('button', { name: /^Inbox/ }).click();
    await expect(page.getByRole('textbox', { name: 'Edit comment', exact: true })).toHaveValue('Edit draft');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Close sidebar' }).click();
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out...' }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('uier:draft:v1:')))).toEqual([]);
    await page.goto(`${origin}/brand`);
    await expect(page.locator('[data-uier-comment="new"]')).toHaveCount(0);
    await context.close();
});

test('blocked browser storage retains a working composer and reports the recovery limitation', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
    });
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    const draft = await startPoint(page);
    await draft.getByRole('textbox', { name: 'Comment', exact: true }).fill('Still send my feedback');
    await expect(draft.getByRole('status')).toContainText('Keep this page open');
    await page.keyboard.press('Escape');
    await page.locator('[data-uier-comment="new"]').click();
    await expect(draft.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Still send my feedback');
    await draft.getByRole('button', { name: 'Post comment' }).click();
    await expect(openThread(page)).toContainText('Still send my feedback');
    await context.close();
});

test('a failed reviewer lookup offers retry before restoring the authorized draft', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    await (await startPoint(page)).getByRole('textbox', { name: 'Comment', exact: true }).fill('Recover when the service returns');
    await page.route('**/api/visitor', route => route.abort('failed'));
    await page.reload();
    await expect(page.getByText('Your reviewer details could not be loaded.')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-uier-comment="new"]')).toHaveCount(0);
    await page.unroute('**/api/visitor');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('button', { name: 'New comment', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Recover when the service returns');
    await context.close();
});

test('inline and pin composers share edit/reply drafts and pending state', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    const comment = await page.evaluate(async () => (await fetch('/api/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'One thread, two composers' })
    })).json()) as CommentDto;
    await page.reload();
    await page.evaluate(id => {
        const slot = document.createElement('div');
        slot.dataset.uierThread = id;
        document.querySelector('main')!.appendChild(slot);
    }, comment.id);
    const inline = page.getByRole('textbox', { name: 'Reply to the headline', exact: true });
    await expect(inline).toBeVisible();
    await page.locator(`[data-uier-comment="${comment.id}"]`).click();
    const pin = page.getByRole('textbox', { name: 'Reply', exact: true });
    const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
    await thread.getByRole('button', { name: 'More options for your comment' }).click();
    await page.getByRole('dialog', { name: 'Comment options', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
    await thread.getByRole('textbox', { name: 'Edit comment', exact: true }).fill('Keep the same edit from either surface');
    await page.keyboard.press('Escape');
    await expect(thread).toBeHidden();
    const inlineThread = page.getByRole('region', { name: 'Headline comment thread' });
    await inlineThread.getByRole('button', { name: 'More options for your comment' }).click();
    await page.getByRole('dialog', { name: 'Comment options', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(inlineThread.getByRole('textbox', { name: 'Edit comment', exact: true })).toHaveValue('Keep the same edit from either surface');
    await inlineThread.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(inlineThread.getByRole('button', { name: 'More options for your comment' })).toBeFocused();
    await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
    await page.locator(`[data-uier-comment="${comment.id}"]`).click();
    await pin.fill('Send from either composer');
    await expect(inline).toHaveValue('Send from either composer');
    let posts = 0;
    let release: (() => void) | undefined;
    await page.route(`**/api/comments/${comment.id}/replies`, async route => {
        posts++;
        await new Promise<void>(resolve => { release = resolve; });
        await route.continue();
    });
    try {
        await page.getByRole('dialog', { name: 'Comment thread', exact: true }).getByRole('button', { name: 'Post reply' }).click();
        await expect(inline).toHaveJSProperty('readOnly', true);
        await expect.poll(() => posts).toBe(1);
        await inline.evaluate(element => element.closest('form')!.requestSubmit());
        expect(posts).toBe(1);
        release?.();
        await expect(pin).toHaveValue('');
        await expect(inline).toHaveValue('');
        const saved = await page.evaluate(async () => (await (await fetch('/api/comments?path=/')).json() as CommentDto[])[0]);
        expect(saved!.thread.items).toHaveLength(2);
    } finally {
        release?.();
        await context.close();
    }
});
