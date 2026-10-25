import { expect, test } from '@playwright/test';
import { HEADLINE_COMMENT_ID } from '../src/lib/comments/publicProject';
import { expectNoAxeViolations } from './accessibility';
import { commentBubbles, openThread, toolbar } from './support/toolbar';

test('the headline thread is live and anonymous replies survive a reload', async ({ page }, testInfo) => {
    await page.goto('/');
    const headline = page.getByRole('region', { name: 'Headline comment thread' });
    await expect(headline.getByText('Will first-time visitors get what “the page” means before they scroll? “on the site” might land faster.')).toBeVisible();
    await expect(page.locator(`[data-uier-comment="${HEADLINE_COMMENT_ID}"]`)).toBeVisible();
    await expect(page.locator(`[data-uier-highlight="${HEADLINE_COMMENT_ID}"]`).first()).toBeVisible();
    expect((await page.context().cookies()).find(cookie => cookie.name === 'uier_visitor')).toBeUndefined();
    const text = `Headline reply ${testInfo.project.name} ${Date.now()}`;
    const reply = headline.getByRole('textbox', { name: 'Reply to the headline' });
    await reply.fill(text);
    const savedReply = page.waitForResponse(response => response.url().includes(`/api/comments/${HEADLINE_COMMENT_ID}/replies`) && response.request().method() === 'POST');
    await reply.press('Enter');
    expect((await savedReply).status()).toBe(201);
    await expect(headline.getByText(text)).toBeVisible();
    await page.reload();
    await expect(toolbar(page)).toBeVisible();
    // Replies are stored in the same thread as the pin and inbox, even when collapsed by Show all.
    const stored = await page.evaluate(async id => {
        const comments = await (await fetch('/api/comments?path=/')).json() as { id: string; thread: { items: { text: string }[] } }[];
        return comments.find(comment => comment.id === id);
    }, HEADLINE_COMMENT_ID);
    expect(stored?.thread.items.some(item => item.text === text)).toBe(true);
    await expectNoAxeViolations(page);
});

test('anonymous visitors can comment on another public page and keep the comment', async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext(testInfo.project.use);
    const page = await context.newPage();
    await page.goto(`${baseURL}/security`);
    await expect(toolbar(page)).toBeVisible();
    await page.getByRole('button', { name: 'Add comment' }).click();
    const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
    await page.mouse.click(heading!.x + heading!.width / 2, heading!.y + heading!.height / 2);
    const text = `Security page feedback ${testInfo.project.name} ${Date.now()}`;
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill(text);
    const savedComment = page.waitForResponse(response => response.url().endsWith('/api/comments') && response.request().method() === 'POST');
    await composer.press('Enter');
    expect((await savedComment).status()).toBe(201);
    await expect(openThread(page).getByText(text)).toBeVisible();
    await page.reload();
    await expect(commentBubbles(page).first()).toBeVisible();
    await page.getByRole('button', { name: /^Inbox/ }).click();
    await expect(page.getByRole('complementary', { name: 'Comments' }).getByText(text)).toBeVisible();
    await page.goto(`${baseURL}/`);
    await page.getByRole('button', { name: /^Inbox/ }).click();
    await expect(page.getByRole('region', { name: 'Other pages' }).getByText(text)).toBeVisible();
    await context.close();
});
