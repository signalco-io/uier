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
    await expect(hint).toContainText(/(Click|Tap) the \+ button, or select text, to leave feedback\./);
    await expect(hint).toContainText('Anyone can see and reply to comments. They are deleted after 90 days.');
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
    const heading = await author.getByRole('heading', { level: 1, name: brand.tagline }).boundingBox();
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
    await authorThread.getByRole('button', { name: 'More options for your comment' }).click();
    const options = author.getByRole('dialog', { name: 'Comment options' });
    // Asks first: deleting a comment deletes its replies as well
    await expect(options.getByRole('button', { name: 'Delete...' })).toBeFocused();
    await options.getByRole('button', { name: 'Delete...' }).click();
    await expect(options).toContainText('Delete this comment?');
    await options.getByRole('button', { name: 'Delete', exact: true }).click();
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

/**
 * Adds the toolbar script like a site would. Not `page.addScriptTag`: it fails on the CSP
 * report for the Google Fonts stylesheet the toolbar adds (blocked here, the toolbar then uses
 * system-ui).
 */
async function addToolbarScript(page: Page) {
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/toolbar.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('The toolbar script did not load'));
        document.head.appendChild(script);
    }));
}

test('other pages: the toolbar keeps its review mode (?review=true)', async ({ page }) => {
    // Embedded without data-uier-mode, like on a reviewed customer site
    await page.goto('/e2e-review-mode');
    await expect(page.locator('script[src="/toolbar.js"]')).toHaveCount(0);
    await addToolbarScript(page);
    await expect(page.locator('#uier-toolbar')).toHaveCount(0);

    await page.goto('/e2e-review-mode?review=true');
    await addToolbarScript(page);
    await expect(toolbar(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'About uier' })).toHaveCount(0);
    await expect(showcaseHint(page)).toHaveCount(0);
});

/** Creates a comment on `/` through the API from the page (visitor cookie and BotID headers) */
async function postComment(page: Page, body: Record<string, unknown>) {
    return await page.evaluate(async (body) => {
        const response = await fetch('/api/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '/', ...body })
        });
        return { status: response.status, body: await response.json() as { id?: string } };
    }, body);
}

async function postReply(page: Page, commentId: string, text: string) {
    return await page.evaluate(async ({ commentId, text }) => {
        const response = await fetch(`/api/comments/${commentId}/replies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        return response.status;
    }, { commentId, text });
}

test('a stored comment that can not be placed does not break the toolbar', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openLanding(page, origin, { dismissHint: true });

    const broken = [
        // Not a valid selector: `querySelector` throws
        { type: 'point', selector: 'main))((', xNormal: 0.5, yNormal: 0.5 },
        // Offsets past the end of the element and of the text: `Range.setStart` / `setEnd` throw
        { type: 'text', text: 'x', startSelector: 'main', startOffset: 99999, startType: 'element', endSelector: 'main', endOffset: 99999, endType: 'element' },
        { type: 'text', text: 'x', startSelector: 'main p', startOffset: 99999, startType: 'text', endSelector: 'main p', endOffset: 99999, endType: 'text' }
    ];
    const rejected: typeof broken = [];
    for (const position of broken) {
        const { status } = await postComment(page, { position, text: 'Broken position' });
        // The API may reject positions it recognises as invalid; those are served below instead
        expect([201, 400]).toContain(status);
        if (status === 400) {
            rejected.push(position);
        }
    }
    expect((await postComment(page, { position: { type: 'point', selector: 'main h1', xNormal: 0.5, yNormal: 0.5 }, text: 'A valid comment' })).status).toBe(201);

    // Positions the API refused are added to the list response, like comments stored before it validated them
    if (rejected.length) {
        await page.route('**/api/comments?path=*', async route => {
            const response = await route.fetch();
            const comments = await response.json() as unknown[];
            const now = new Date().toISOString();
            await route.fulfill({
                response,
                json: [
                    ...rejected.map((position, index) => ({
                        id: `broken-${index}`,
                        path: '/',
                        position,
                        thread: { items: [{ id: `broken-${index}-item`, text: 'Broken position', author: { name: 'Guest 0000', isMe: false }, createdAt: now }] },
                        resolved: false,
                        isMine: false,
                        createdAt: now
                    })),
                    ...comments
                ]
            });
        });
    }

    await page.reload();
    await expect(toolbar(page)).toBeVisible();
    const inbox = page.getByRole('button', { name: 'Inbox, 4 comments' });
    await expect(inbox).toBeVisible();
    // The valid comment is placed (the selections with clamped offsets may be placed as well)
    await expect(commentBubbles(page).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add comment' })).toBeEnabled();
    expect(errors).toEqual([]);

    // The inbox lists all of them; closing it gives the focus back to the Inbox button
    await inbox.click();
    const sidebar = page.getByRole('complementary', { name: 'Comments' });
    await expect(sidebar.getByText('Broken position')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(sidebar).toBeHidden();
    await expect(inbox).toBeFocused();

    await context.close();
});

test('a long thread keeps its reply box inside the window', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });

    // Under the description paragraph, about halfway down the first screen
    const created = await postComment(page, {
        position: { type: 'point', selector: 'main p', xNormal: 0.5, yNormal: 1 },
        text: 'A long comment. '.repeat(60).trim()
    });
    expect(created.status).toBe(201);
    for (const text of ['First reply. ', 'Second reply. ', 'Third reply. ']) {
        expect(await postReply(page, created.body.id!, text.repeat(20).trim())).toBe(201);
    }

    await page.reload();
    await commentBubble(page, 4).click();
    const thread = openThread(page);
    await thread.getByRole('button', { name: 'Show 2 more replies' }).click();
    const reply = thread.getByRole('textbox', { name: 'Reply' });
    await reply.fill('Still visible');

    const postReplyButton = thread.getByRole('button', { name: 'Post reply' });
    await expect(postReplyButton).toBeInViewport({ ratio: 1 });
    await expect(reply).toBeInViewport({ ratio: 1 });
    // Not underneath the toolbar pill
    const pill = await toolbar(page).boundingBox();
    const button = await postReplyButton.boundingBox();
    const box = await reply.boundingBox();
    expect(pill && button && box).toBeTruthy();
    expect(button!.y + button!.height).toBeLessThanOrEqual(pill!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(pill!.y);
    await postReplyButton.click();
    await expect(commentBubble(page, 5)).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Reply posted' })).toBeAttached();

    await context.close();
});

test('point comments: instructions, keyboard path, kept drafts', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin);
    const hint = showcaseHint(page);
    await expect(hint).toBeVisible();

    // Point mode says what to do, shows as pressed and closes the first-run hint
    const add = page.getByRole('button', { name: 'Add comment' });
    await add.click();
    await expect(add).toHaveAttribute('aria-pressed', 'true');
    await expect(hint).toBeHidden();
    const instruction = page.getByRole('status').filter({ hasText: 'anywhere to pin a comment' });
    await expect(instruction).toHaveText(testInfo.project.use.hasTouch
        ? 'Tap anywhere to pin a comment. Tap + to cancel.'
        : 'Click anywhere to pin a comment. Esc to cancel.');
    await page.keyboard.press('Escape');
    await expect(add).toHaveAttribute('aria-pressed', 'false');
    await expect(instruction).toHaveCount(0);

    // Keyboard: focus a page element, then Add comment pins the comment to it
    await page.getByRole('link', { name: 'How it works' }).focus();
    await add.focus();
    await page.keyboard.press('Enter');
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await expect(composer).toBeFocused();

    // Text survives Escape: the draft pin stays and brings the text back
    await composer.fill('Typed with the keyboard');
    await page.keyboard.press('Escape');
    await expect(composer).toBeHidden();
    await page.getByRole('button', { name: 'New comment' }).click();
    await expect(composer).toHaveValue('Typed with the keyboard');

    // Shift+Enter adds a new line, Enter posts
    await composer.press('Shift+Enter');
    await composer.pressSequentially('Second line');
    await expect(composer).toHaveValue('Typed with the keyboard\nSecond line');
    await composer.press('Enter');
    const bubble = commentBubble(page, 1);
    await expect(bubble).toBeVisible();
    // The new pin takes the focus, and the result is announced
    await expect(bubble).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Comment posted' })).toBeAttached();
    const comments = await page.evaluate(async () => {
        const response = await fetch('/api/comments?path=/');
        return await response.json() as { position: { selector: string }; thread: { items: { text: string }[] } }[];
    });
    expect(comments).toHaveLength(1);
    const [comment] = comments;
    expect(comment?.thread.items[0]?.text).toBe('Typed with the keyboard\nSecond line');
    expect(await page.evaluate(selector => document.querySelector(selector)?.textContent, comment?.position.selector ?? '')).toBe('How it works');

    await expectNoAxeViolations(page);
    await context.close();
});

test('rate limit messages tell a full page from a fast visitor', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });

    let reason: string | undefined = 'page_full';
    let retryAfter = '3600';
    await page.route('**/api/comments', async route => {
        if (route.request().method() !== 'POST') {
            await route.fallback();
            return;
        }
        await route.fulfill({
            status: 429,
            headers: { 'Retry-After': retryAfter },
            json: { error: 'rate_limited', ...(reason ? { reason } : {}), message: 'Rate limited.' }
        });
    });

    await page.getByRole('link', { name: 'How it works' }).focus();
    await page.getByRole('button', { name: 'Add comment' }).focus();
    await page.keyboard.press('Enter');
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill('Hello');
    await composer.press('Enter');
    const alert = openThread(page).getByRole('alert');
    await expect(alert).toHaveText('This page has reached its comment limit. Try again in about an hour.');
    await expect(composer).toHaveValue('Hello');
    await expectNoAxeViolations(page);

    // Without a reason: the visitor is sending too fast
    reason = undefined;
    retryAfter = '30';
    await composer.press('Enter');
    await expect(alert).toHaveText('You\'re sending feedback too quickly. Try again in 30 seconds.');

    await context.close();
});
