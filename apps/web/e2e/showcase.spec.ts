import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { brand } from '@uier/brand';
import {
    commentBubble,
    commentBubbles,
    isolatedOrigin,
    newVisitor,
    openLanding,
    openThread,
    showcaseHint,
    toolbar
} from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// The landing page runs the uier toolbar in showcase mode: anonymous visitors leave public feedback.
// Every test uses its own origin (see `isolatedOrigin`), so it only sees its own comments.

// The landing page's description paragraph (selected to leave a text comment)
const heroText = brand.description;

/** Status of a comments API call made from the page (with the visitor's cookie and BotID headers) */
async function apiStatus(page: Page, path: string, method: 'PATCH' | 'DELETE', body?: unknown) {
    return await page.evaluate(async ({ path, method, body }) => {
        const response = await fetch(path, {
            method,
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return response.status;
    }, { path, method, body });
}

async function pageCommentIds(page: Page) {
    return await page.evaluate(async () => {
        const response = await fetch('/api/comments?path=/');
        const comments = await response.json() as { id: string }[];
        return comments.map(comment => comment.id);
    });
}

test('toolbar runs on the landing page without ?review=true', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo));

    // Embedded like on a customer site
    await expect(page.locator('script[src="/toolbar.js"][data-uier-mode="showcase"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Add comment' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inbox', exact: true })).toBeVisible();

    // First-run hint, dismissible with the keyboard
    const hint = showcaseHint(page);
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Click the comment button or select text to leave feedback. Comments are public.');
    await hint.getByRole('button', { name: 'Got it' }).focus();
    await page.keyboard.press('Enter');
    await expect(hint).toBeHidden();
    await expect(page.getByRole('button', { name: 'About uier' })).toBeFocused();

    // Dismissal is remembered
    await page.reload();
    await expect(toolbar(page)).toBeVisible();
    await expect(hint).toBeHidden();

    // "About uier" shows it again, Escape closes it
    await page.getByRole('button', { name: 'About uier' }).click();
    await expect(hint).toBeVisible();
    await hint.getByRole('button', { name: 'Dismiss' }).focus();
    await page.keyboard.press('Escape');
    await expect(hint).toBeHidden();

    await context.close();
});

test('visitors leave public feedback; only the author resolves or deletes it', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);

    // Visitor A: point comment on the heading
    const a = await newVisitor(browser, testInfo);
    const author = a.page;
    await openLanding(author, origin, { dismissHint: true });
    await expect(commentBubbles(author)).toHaveCount(0);

    await author.getByRole('button', { name: 'Add comment' }).click();
    const heading = await author.getByRole('heading', { level: 1, name: 'uier' }).boundingBox();
    expect(heading).not.toBeNull();
    await author.mouse.click(heading!.x + heading!.width / 2, heading!.y + heading!.height / 2);

    const pointComposer = author.getByRole('textbox', { name: 'Comment', exact: true });
    await expect(pointComposer).toBeFocused();
    await expect(pointComposer).toHaveAttribute('maxlength', '1000');
    await pointComposer.fill('The heading could use a subtitle.');
    const createRequest = author.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/comments');
    await pointComposer.press('Enter');
    // Same-origin API call protected by BotID (instrumentation-client.ts adds the challenge header)
    expect((await createRequest).headers()['x-is-human']).toBeTruthy();
    await expect(commentBubble(author, 1)).toBeVisible();
    await expect(openThread(author)).toBeHidden();

    // Visitor A: text-selection comment
    await author.getByText(heroText).selectText();
    await author.getByRole('button', { name: 'Comment...', exact: true }).click();
    await expect(openThread(author).locator('blockquote')).toContainText(heroText);
    const selectionComposer = author.getByRole('textbox', { name: 'Comment', exact: true });
    await selectionComposer.fill('Could you show an example?');
    await selectionComposer.press('Enter');
    await expect(commentBubbles(author)).toHaveCount(2);
    await expect(author.getByRole('button', { name: 'Inbox, 2 comments' })).toBeVisible();
    await author.evaluate(() => window.getSelection()?.removeAllRanges());
    await expectNoAxeViolations(author);

    // Visitor B sees both comments (public), can reply, but can't resolve or delete them
    const b = await newVisitor(browser, testInfo);
    const visitor = b.page;
    await openLanding(visitor, origin, { dismissHint: true });
    await expect(commentBubbles(visitor)).toHaveCount(2);
    await expect(visitor.getByRole('button', { name: 'Inbox, 2 comments' })).toBeVisible();

    await commentBubbles(visitor).first().click();
    const visitorThread = openThread(visitor);
    await expect(visitorThread.getByText(/^Guest [0-9A-F]{4}$/)).toBeVisible();
    await expect(visitorThread.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
    await expect(visitorThread.getByRole('button', { name: 'More options' })).toHaveCount(0);

    const reply = visitorThread.getByRole('textbox', { name: 'Reply' });
    await reply.fill('Agreed, +1');
    await reply.press('Enter');
    await expect(commentBubble(visitor, 2)).toBeVisible();
    await expect(reply).toHaveValue('');
    await expect(visitorThread.getByText('You', { exact: true })).toBeVisible();
    // Only the own reply can be deleted
    await expect(visitorThread.getByRole('button', { name: 'More options' })).toHaveCount(1);
    await expect(visitorThread.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
    await visitor.keyboard.press('Escape');
    await expect(visitorThread).toBeHidden();

    // The API enforces it too
    const ids = await pageCommentIds(visitor);
    expect(ids).toHaveLength(2);
    for (const id of ids) {
        expect(await apiStatus(visitor, `/api/comments/${id}`, 'PATCH', { resolved: true })).toBe(403);
        expect(await apiStatus(visitor, `/api/comments/${id}`, 'DELETE')).toBe(403);
    }

    // Visitor A (the author) resolves the replied comment and deletes the other one
    await author.reload();
    await expect(toolbar(author)).toBeVisible();
    await commentBubble(author, 2).click();
    const authorThread = openThread(author);
    await expect(authorThread.getByText(/^Guest [0-9A-F]{4}$/)).toBeVisible();
    await expect(authorThread.getByRole('button', { name: 'More options' })).toHaveCount(1);
    await authorThread.getByRole('button', { name: 'Resolve' }).click();
    await expect(commentBubbles(author)).toHaveCount(1);
    await expect(author.getByRole('button', { name: 'Inbox, 1 comment' })).toBeVisible();

    await commentBubble(author, 1).click();
    await authorThread.getByRole('button', { name: 'More options' }).click();
    await author.getByRole('button', { name: 'Delete' }).click();
    await expect(commentBubbles(author)).toHaveCount(0);
    await expect(author.getByRole('button', { name: 'Inbox', exact: true })).toBeVisible();

    // Visitor B: the resolved comment is hidden, the deleted one is gone
    await visitor.reload();
    await expect(toolbar(visitor)).toBeVisible();
    await expect(visitor.getByRole('button', { name: 'Inbox', exact: true })).toBeVisible();
    await expect(commentBubbles(visitor)).toHaveCount(0);
    expect(await pageCommentIds(visitor)).toHaveLength(1);

    await a.context.close();
    await b.context.close();
});

test('other pages: the toolbar keeps its review mode (?review=true)', async ({ page }) => {
    // Embedded without data-uier-mode, like on a reviewed customer site
    await page.goto('/e2e-review-mode');
    await expect(page.locator('script[src="/toolbar.js"]')).toHaveCount(0);
    await page.addScriptTag({ url: '/toolbar.js' });
    await expect(page.locator('#uier-toolbar')).toHaveCount(0);

    await page.goto('/e2e-review-mode?review=true');
    await page.addScriptTag({ url: '/toolbar.js' });
    await expect(toolbar(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'About uier' })).toHaveCount(0);
    await expect(showcaseHint(page)).toHaveCount(0);
});
