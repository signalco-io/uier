import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CommentDto } from '../src/lib/comments/dto';
import { expectNoAxeViolations } from './accessibility';
import { animationsFinished, isolatedOrigin, newVisitor, openLanding, toolbar } from './support/toolbar';

// Several unsent comments on one page, each a draft pin, listed in the inbox (uier #296)

const draftPins = (page: Page) => page.locator('[data-uier-comment="new"]');
const inbox = (page: Page) => page.getByRole('complementary', { name: 'Comments' });
const draftCards = (page: Page) => inbox(page).getByRole('article', { name: 'Draft comment' });
const draftsHeading = (page: Page) => inbox(page).getByRole('heading', { name: /^Drafts/ });
const newCommentForm = (page: Page) => page.getByRole('dialog', { name: 'New comment', exact: true });

/** The composer's text, whichever text box it is (a textarea's value, else the editor's text) */
const composerText = (box: Locator) => box.evaluate(element => element instanceof HTMLTextAreaElement ? element.value : (element as HTMLElement).innerText.trim());

/** Points a new comment at the element, writes it and closes its form: a draft pin */
async function leaveDraft(page: Page, target: Locator, text: string) {
    await target.scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const box = (await target.boundingBox())!;
    await page.mouse.click(box.x + 20, box.y + Math.min(box.height / 2, 12));
    const field = newCommentForm(page).getByRole('textbox', { name: 'Comment', exact: true });
    await expect(field).toBeFocused();
    // A draft of its own: another unsent one is never reopened in its place
    expect(await composerText(field)).toBe('');
    await field.fill(text);
    await page.keyboard.press('Escape');
    await expect(newCommentForm(page)).toBeHidden();
}

async function openInbox(page: Page) {
    await page.getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
    await expect(inbox(page)).toBeVisible();
}

test('several drafts wait on a page and the inbox lists them to resume, post or discard', async ({ browser }, info) => {
    const { context, page } = await newVisitor(browser, info);
    await openLanding(page, isolatedOrigin(info), { dismissHint: true });
    await leaveDraft(page, page.getByRole('heading', { level: 1 }), 'First draft on the heading');
    await leaveDraft(page, page.getByRole('heading', { level: 2 }).first(), 'Second draft further down');
    await expect(draftPins(page)).toHaveCount(2);

    // Kept in this browser: both come back as pins
    await page.reload();
    await expect(toolbar(page)).toBeVisible();
    await expect(draftPins(page)).toHaveCount(2);
    await openInbox(page);
    await expect(draftsHeading(page)).toHaveText(/2$/);
    await expect(draftCards(page)).toHaveCount(2);
    // Newest first
    await expect(draftCards(page).nth(0)).toContainText('Second draft further down');
    await expect(draftCards(page).nth(1)).toContainText('First draft on the heading');
    // Drafts are not done: not under Done
    await inbox(page).getByRole('button', { name: /^Done \d+$/ }).click();
    await expect(draftsHeading(page)).toHaveCount(0);
    await inbox(page).getByRole('button', { name: /^Active \d+$/ }).click();
    await expect(draftCards(page)).toHaveCount(2);
    await animationsFinished(inbox(page));
    await expectNoAxeViolations(page);
    await page.screenshot({ path: info.outputPath('inbox-drafts.png') });

    // Resume: the inbox makes way for its form on its pin, with its text
    await draftCards(page).filter({ hasText: 'First draft on the heading' }).getByRole('button', { name: 'Resume draft' }).click();
    await expect(inbox(page)).toBeHidden();
    const field = newCommentForm(page).getByRole('textbox', { name: 'Comment', exact: true });
    await expect(field).toBeFocused();
    expect(await composerText(field)).toBe('First draft on the heading');
    await page.keyboard.press('Escape');
    await expect(newCommentForm(page)).toBeHidden();

    // Post from the inbox: a failed send lists it again, with its text
    await openInbox(page);
    const second = draftCards(page).filter({ hasText: 'Second draft further down' });
    await page.route('**/api/comments', route => route.request().method() === 'POST' ? route.abort('failed') : route.fallback());
    await second.getByRole('button', { name: 'Post comment' }).click();
    await expect(page.getByText('Check your connection').first()).toBeVisible();
    await expect(second).toBeVisible();
    await page.unroute('**/api/comments');
    // Then it is posted as it is: no form or thread opens, the thread is in the list and its pin on the page
    const posted = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/comments');
    await second.getByRole('button', { name: 'Post comment' }).click();
    expect((await posted).status()).toBe(201);
    await expect(draftCards(page)).toHaveCount(1);
    await expect(inbox(page).getByRole('article', { name: /^Comment #\d+$/ }).filter({ hasText: 'Second draft further down' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: /^(Comment thread|New comment)$/ })).toHaveCount(0);
    await expect(draftPins(page)).toHaveCount(1);
    const comments = await page.evaluate(async () => (await fetch('/api/comments?path=/')).json()) as CommentDto[];
    expect(comments.map(comment => comment.thread.items.map(item => 'text' in item ? item.text : ''))).toEqual([['Second draft further down']]);

    // Discard: gone, after a reload too
    await draftCards(page).getByRole('button', { name: 'Discard' }).click();
    await expect(draftsHeading(page)).toHaveCount(0);
    await expect(draftPins(page)).toHaveCount(0);
    await page.reload();
    await expect(toolbar(page)).toBeVisible();
    await expect(draftPins(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('uier:draft:v1:')))).toEqual([]);
    await context.close();
});
