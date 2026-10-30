import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
    addToolbarScript,
    animationsFinished,
    chooseInboxPages,
    inboxPages,
    inboxPageOptions,
    isolatedOrigin,
    newVisitor,
    openLanding,
    openThread,
    toolbar
} from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// The inbox sidebar: this page's comments by default, another page's or all pages' from the page
// picker (review mode), searched and filtered by status, each with its public id; threads show
// their first and last message.

type SavedComment = { id: string; number: number };

test('bulk inbox read follows listed pages/search/status and retries the rendered cursor after a racing reply', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const origin = isolatedOrigin(testInfo);
    const author = await newVisitor(browser, testInfo);
    const reader = await newVisitor(browser, testInfo);
    try {
        const saved: { id: string; sequence: number }[] = [];
        for (const [path, text] of [['/brand', 'Selected feedback'], ['/brand', 'Keep unread'], ['/security', 'Selected other page']]) {
            const response = await author.context.request.post(`${origin}/api/comments`, { data: { path, kind: 'feedback', position: { type: 'page' }, text } });
            expect(response.status()).toBe(201);
            saved.push({ id: (await response.json()).id, sequence: 1 });
        }
        await author.context.request.patch(`${origin}/api/comments/${saved[2]!.id}`, { data: { resolved: true } });
        await reader.page.goto(`${origin}/brand?review=true`);
        await addToolbarScript(reader.page);
        const inbox = reader.page.getByRole('button', { name: /^Inbox(?:,|$)/ });
        await expect(inbox).toHaveAccessibleName('Inbox, 3 unread threads');
        await inbox.click();
        const sidebar = reader.page.getByRole('complementary', { name: 'Comments' });
        await sidebar.getByRole('searchbox', { name: 'Search comments' }).fill('Selected');
        await expect(sidebar.getByRole('article')).toHaveCount(1);
        expect((await inboxPages(reader.page).boundingBox())!.width).toBeGreaterThanOrEqual(144);
        for (const colorScheme of ['light', 'dark'] as const) {
            await reader.page.emulateMedia({ colorScheme });
            await expect(reader.page.locator('html')).toHaveClass(new RegExp(colorScheme));
            await animationsFinished(reader.page.locator('body'));
            await animationsFinished(sidebar);
            await expectNoAxeViolations(reader.page);
            await reader.page.screenshot({ path: testInfo.outputPath(`bulk-inbox-${colorScheme}.png`) });
        }
        const batches: { id: string; sequence: number }[][] = [];
        let fail = true;
        await reader.page.route('**/api/comments/read', async route => {
            batches.push(route.request().postDataJSON().threads);
            if (fail) { fail = false; await route.abort(); }
            else await route.continue();
        });
        await sidebar.getByRole('button', { name: 'Mark all as read', exact: true }).click();
        await expect(sidebar.getByRole('alert')).toContainText('Some threads could not be marked as read.');
        await expect(inbox).toHaveAccessibleName('Inbox, 3 unread threads');
        await author.context.request.post(`${origin}/api/comments/${saved[0]!.id}/replies`, { data: { text: 'Racing reply stays unread' } });
        await sidebar.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect(sidebar.getByText('Racing reply stays unread')).toBeVisible();
        expect(batches).toEqual([[saved[0]], [saved[0]]]);
        await expect(inbox).toHaveAccessibleName('Inbox, 3 unread threads');
        await sidebar.getByRole('button', { name: 'Mark all as read', exact: true }).click();
        await expect(inbox).toHaveAccessibleName('Inbox, 2 unread threads');
        await chooseInboxPages(reader.page, /^All pages/);
        await expect(sidebar.getByRole('button', { name: 'Mark all as read', exact: true })).toHaveCount(0); // Done is still excluded.
        await sidebar.getByRole('group', { name: 'Show comments' }).getByRole('button', { name: /^All/ }).click();
        await expect(sidebar.getByRole('article')).toHaveCount(2);
        await sidebar.getByRole('button', { name: 'Mark all as read', exact: true }).click();
        await expect(inbox).toHaveAccessibleName('Inbox, 1 unread thread');
        await sidebar.getByRole('button', { name: 'Unread 1', exact: true }).click();
        await expect(sidebar.getByRole('article')).toHaveCount(0); // Search still applies.
        await sidebar.getByRole('searchbox', { name: 'Search comments' }).fill('');
        await expect(sidebar.getByRole('article')).toHaveCount(1);
        await sidebar.getByRole('button', { name: 'Mark all as read', exact: true }).click();
        await expect(inbox).toHaveAccessibleName('Inbox');
        await expect(sidebar.getByRole('button', { name: 'Unread 0', exact: true })).toBeVisible();
        await expectNoAxeViolations(reader.page);
        await reader.page.reload();
        await expect(inbox).toHaveAccessibleName('Inbox');
    } finally { await author.context.close(); await reader.context.close(); }
});

test('bulk inbox read sends more than 200 listed threads in sequential bounded requests', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const reader = await newVisitor(browser, testInfo);
    const items = Array.from({ length: 205 }, (_, index) => ({ id: `comment_bulk_${index}`, number: index + 1,
        path: index < 200 ? '/brand' : '/security', kind: 'feedback', position: { type: 'page' }, resolved: false,
        activity: { sequence: 1, readSequence: 0, lastOtherSequence: 1, unread: true },
        thread: { items: [{ id: 'first', text: `Batch thread ${index}`, author: { name: 'Reviewer', isMe: false } }] } }));
    let active = 0, maximum = 0;
    const batches: number[] = [];
    const read = new Set<string>();
    try {
        await reader.page.route('**/api/comments?*', async route => {
            const params = new URL(route.request().url()).searchParams;
            const list = params.get('scope') === 'site' ? items.slice(200) : items.slice(0, 200);
            await route.fulfill({ json: list.map(item => ({ ...item, activity: { ...item.activity, readSequence: read.has(item.id) ? 1 : 0, unread: !read.has(item.id) } })) });
        });
        await reader.page.route('**/api/comments/activity', route => route.fulfill({ json: { unread: 205 - read.size, open: 205, done: 0, total: 205 } }));
        await reader.page.route('**/api/comments/read', async route => {
            maximum = Math.max(maximum, ++active);
            const threads = route.request().postDataJSON().threads as { id: string; sequence: number }[];
            batches.push(threads.length);
            await new Promise(resolve => setTimeout(resolve, 50));
            threads.forEach(thread => read.add(thread.id));
            active--;
            await route.fulfill({ json: { reads: threads.map(thread => ({ id: thread.id, activity: { sequence: 1, readSequence: 1, lastOtherSequence: 1, unread: false } })) } });
        });
        await reader.page.goto(`${origin}/brand?review=true`);
        await addToolbarScript(reader.page);
        await reader.page.getByRole('button', { name: /^Inbox/ }).click();
        await chooseInboxPages(reader.page, /^All pages/);
        const sidebar = reader.page.getByRole('complementary', { name: 'Comments' });
        await expect(sidebar.getByRole('article')).toHaveCount(205);
        await sidebar.getByRole('button', { name: 'Mark all as read', exact: true }).click();
        await expect.poll(() => read.size).toBe(205);
        expect(batches).toEqual([200, 5]);
        expect(maximum).toBe(1);
        await expect(reader.page.getByRole('button', { name: /^Inbox/ })).toHaveAccessibleName('Inbox');
    } finally { await reader.context.close(); }
});

/** A request to the comments API from the page (same origin, as the reviewer) */
async function api(page: Page, method: 'POST' | 'PATCH', url: string, body: unknown) {
    return await page.evaluate(async ({ method, url, body }) => {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            throw new Error(`${method} ${url}: ${response.status} ${await response.text()}`);
        }
        return await response.json() as SavedComment;
    }, { method, url, body });
}

async function comment(page: Page, path: string, text: string, { replies = [] as string[], resolved = false, selector = 'main' } = {}) {
    const saved = await api(page, 'POST', '/api/comments', {
        path,
        position: { type: 'point', selector, xNormal: 0.5, yNormal: 0.1 },
        text
    });
    for (const reply of replies) {
        await api(page, 'POST', `/api/comments/${saved.id}/replies`, { text: reply });
    }
    if (resolved) {
        await api(page, 'PATCH', `/api/comments/${saved.id}`, { resolved: true });
    }
    return saved;
}

/** The list shows these comments (by public id), in this order */
async function expectListed(group: Locator, ids: string[]) {
    await expect.poll(async () => await group.getByRole('article').evaluateAll(articles =>
        articles.map(article => article.getAttribute('aria-label')))).toEqual(ids);
}

test('inbox: this page by default, other pages from the picker, searched and filtered by status', async ({ browser, request }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await page.goto(`${origin}/brand?review=true`);
    await addToolbarScript(page);
    await expect(toolbar(page)).toBeVisible();

    const subtitle = await comment(page, '/brand', 'The heading could use a subtitle.', { replies: ['First reply.', 'Second reply.', 'Third reply.'] });
    const colours = await comment(page, '/brand', 'Name the colours.', { resolved: true });
    const policy = await comment(page, '/security', 'Link the security policy.', { replies: ['Where?', 'In the footer.', 'Added it there.'] });
    await comment(page, '/security', 'Old contact address.', { resolved: true });
    const feedback = await api(page, 'POST', '/api/comments', { path: '/brand', kind: 'feedback', position: { type: 'page' }, text: 'Love the tokens table.' });
    // A comment on selected text: the quote is searched too
    const quote = await api(page, 'POST', '/api/comments', {
        path: '/security',
        position: { type: 'text', text: 'Report a vulnerability', startSelector: 'main', startOffset: 0, startType: 'text', endOffset: 22, endType: 'text' },
        text: 'Make this a link.',
        quotedText: 'Report a vulnerability'
    });
    await api(page, 'PATCH', `/api/comments/${quote.id}`, { resolved: true });
    // Numbered per site, in the order they were posted
    expect([subtitle.number, policy.number, feedback.number, quote.number]).toEqual([1, 3, 5, 6]);

    // Another visitor (own cookie, same site) replies to the done comment: their guest name is searched too
    const otherReply = await request.post(`/api/comments/${colours.id}/replies`, {
        headers: { Host: new URL(origin).host },
        data: { text: 'Blue and ink.' }
    });
    expect(otherReply.status(), await otherReply.text()).toBe(201);
    const guestName = (await otherReply.json() as { thread: { items: { author: { name: string } }[] } }).thread.items.at(-1)!.author.name;
    expect(guestName).toMatch(/^Guest [0-9a-f]{4}$/i);

    await page.reload();
    await addToolbarScript(page);
    const inbox = page.getByRole('button', { name: /^Inbox(?:,|$)/ });
    await inbox.click();
    await expect(inbox).toHaveAttribute('aria-expanded', 'true');
    const sidebar = page.getByRole('complementary', { name: 'Comments' });
    const thisPage = sidebar.getByRole('region', { name: 'This page', exact: true });
    const allPages = sidebar.getByRole('region', { name: 'All pages', exact: true });
    const pagesButton = inboxPages(page);
    const pageOptions = inboxPageOptions(page);
    const choosePage = (name: RegExp) => chooseInboxPages(page, name);

    // This page first: its open comments, newest first, with their public id and status
    await expect(pagesButton).toContainText('This page');
    await expectListed(thisPage, ['Comment #5', 'Comment #1']);
    const subtitleCard = thisPage.getByRole('article', { name: 'Comment #1' });
    await expect(subtitleCard).toContainText('Status: Open');
    await expect(subtitleCard).toContainText('Comment #1');
    await expect(sidebar.getByText('Name the colours.')).toHaveCount(0);

    // The picker: this page, all pages and the other pages, with their open comments
    await pagesButton.click();
    await expect(pageOptions.getByRole('button', { name: /^This page/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(pageOptions.getByRole('button', { name: 'All pages, 3 comments' })).toBeVisible();
    await expect(pageOptions.getByRole('button')).toHaveCount(3);
    await pageOptions.getByRole('button', { name: '/security, 1 comment' }).click();
    await expect(pageOptions).toBeHidden();
    await expect(pagesButton).toContainText('/security');
    const security = sidebar.getByRole('region', { name: '/security', exact: true });
    await expectListed(security, ['Comment #3']);

    // A thread shows its first and last message; Show all shows the rest
    const policyCard = security.getByRole('article', { name: 'Comment #3' });
    await expect(policyCard.getByText('Link the security policy.')).toBeVisible();
    await expect(policyCard.getByText('Added it there.')).toBeVisible();
    for (const text of ['Where?', 'In the footer.']) {
        await expect(policyCard.getByText(text)).toHaveCount(0);
    }
    await policyCard.getByRole('button', { name: 'Show all 4 messages' }).click();
    for (const text of ['Where?', 'In the footer.']) {
        await expect(policyCard.getByText(text)).toBeVisible();
    }
    // The button is gone: the focus is on the first message it showed
    await expect(policyCard.locator('[tabindex="-1"]')).toBeFocused();
    await expect(policyCard.locator('[tabindex="-1"]')).toContainText('Where?');

    // The other page's comment links to its thread there, in the review
    const policyLink = policyCard.getByRole('link', { name: 'Open on /security' });
    await expect(policyLink).toHaveAttribute('href', `${origin}/security?review=true&uier-comment=${policy.id}`);
    await animationsFinished(sidebar);
    await expectNoAxeViolations(page);

    // Back on this page, Show all works the same
    await choosePage(/^This page/);
    await subtitleCard.getByRole('button', { name: 'Show all 4 messages' }).click();
    for (const text of ['First reply.', 'Second reply.']) {
        await expect(subtitleCard.getByText(text)).toBeVisible();
    }

    // Search on this page: "/security" is only in another page's path, which the empty list offers
    const search = sidebar.getByRole('searchbox', { name: 'Search comments' });
    await search.fill('/security');
    await expect(thisPage).toContainText('No matches on this page');
    await thisPage.getByRole('button', { name: 'Show 1 on other pages' }).click();
    await expect(pagesButton).toContainText('All pages');
    await expectListed(allPages, ['Comment #3']);
    await expect(sidebar.getByRole('status').filter({ hasText: '1 comment found' })).toBeAttached();
    // Messages and public ids, on every page
    await search.fill('second REPLY');
    await expectListed(allPages, ['Comment #1']);
    await search.fill('#5');
    await expectListed(allPages, ['Comment #5']);
    // Escape clears a search first, and the inbox stays
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(sidebar).toBeVisible();
    await expectListed(allPages, ['Comment #5', 'Comment #3', 'Comment #1']);

    // Status: done comments, then all of them, still searched
    await sidebar.getByRole('button', { name: /^Done \d+$/ }).click();
    await expectListed(allPages, ['Comment #6', 'Comment #4', 'Comment #2']);
    await expect(allPages.getByRole('article', { name: 'Comment #4' })).toContainText('Status: Done');
    await search.fill('contact');
    await expectListed(allPages, ['Comment #4']);
    // Only in the quoted text, then only in another visitor's guest name
    await search.fill('vulnerability');
    await expectListed(allPages, ['Comment #6']);
    await search.fill(guestName);
    await expectListed(allPages, ['Comment #2']);
    await sidebar.getByRole('button', { name: /^All \d+$/ }).click();
    await search.fill('');
    await expectListed(allPages, ['Comment #6', 'Comment #5', 'Comment #4', 'Comment #3', 'Comment #2', 'Comment #1']);
    await expect(sidebar.getByRole('button', { name: 'All 6', exact: true })).toBeVisible();

    // The Inbox button closes it again; it opens as it was
    await inbox.click();
    await expect(sidebar).toBeHidden();
    await expect(inbox).toHaveAttribute('aria-expanded', 'false');
    await inbox.click();
    await expect(sidebar.getByRole('button', { name: /^All \d+$/ })).toHaveAttribute('aria-pressed', 'true');
    await expectListed(allPages, ['Comment #6', 'Comment #5', 'Comment #4', 'Comment #3', 'Comment #2', 'Comment #1']);

    // Show on page: the inbox closes and the thread opens on its pin
    await choosePage(/^This page/);
    await thisPage.getByRole('article', { name: 'Comment #1' }).getByRole('button', { name: 'Show on page' }).click();
    await expect(sidebar).toBeHidden();
    await expect(openThread(page).getByText('The heading could use a subtitle.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(openThread(page)).toBeHidden();

    // The link goes to the other page, where the thread opens
    await inbox.click();
    await choosePage(/^\/security/);
    await policyCard.getByRole('link', { name: 'Open on /security' }).click();
    await page.waitForURL(url => url.pathname === '/security');
    await addToolbarScript(page);
    await expect(openThread(page).getByText('Link the security policy.')).toBeVisible();
    expect(new URL(page.url()).search).toBe('?review=true');

    await context.close();
});

test('inbox: the showcase lists comments on other public pages', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });
    await comment(page, '/', 'Pinned on the landing page.');
    await comment(page, '/brand', 'Somewhere else.');

    await page.reload();
    await page.getByRole('button', { name: /^Inbox(?:,|$)/ }).click();
    const sidebar = page.getByRole('complementary', { name: 'Comments' });
    await expect(sidebar.getByRole('region', { name: 'This page' }).getByText('Pinned on the landing page.')).toBeVisible();
    await expect(sidebar.getByText('Somewhere else.')).toHaveCount(0);
    await chooseInboxPages(page, /^All pages/);
    const allPages = sidebar.getByRole('region', { name: 'All pages' });
    await expect(allPages.getByText('Pinned on the landing page.')).toBeVisible();
    await expect(allPages.getByText('Somewhere else.')).toBeVisible();

    await context.close();
});

test('inbox: a comment\'s link never leaves the site', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await page.goto(`${origin}/brand?review=true`);
    await addToolbarScript(page);
    await expect(toolbar(page)).toBeVisible();

    // The API refuses such paths; a stored one (from before) still can't lead away
    const sneaky = {
        id: 'comment_sneaky',
        number: 7,
        path: '/\\evil.example/login',
        position: { type: 'point', selector: 'main', xNormal: 0.5, yNormal: 0.5 },
        kind: 'comment',
        thread: { items: [{ id: 'item_sneaky', text: 'The new design is here.', author: { name: 'Guest 1A2B', isMe: false } }] },
        resolved: false,
        isMine: false
    };
    await page.route('**/api/comments?scope=site', route => route.fulfill({ json: [sneaky] }));
    await page.getByRole('button', { name: /^Inbox/ }).click();
    await chooseInboxPages(page, /^All pages/);
    const link = page.getByRole('complementary', { name: 'Comments' }).getByRole('article', { name: 'Comment #7' }).getByRole('link');
    const href = await link.getAttribute('href');
    expect(new URL(href!).origin).toBe(origin);
    expect(new URL(href!).searchParams.get('uier-comment')).toBe('comment_sneaky');

    await context.close();
});

test('inbox: Show on page only where the pin can be placed; Show all counts like the pin', async ({ browser, request }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await page.goto(`${origin}/brand?review=true`);
    await addToolbarScript(page);
    await expect(toolbar(page)).toBeVisible();

    // #1 is pinned to an element this page doesn't have; #2 to the page's main content
    await comment(page, '/brand', 'On an element that is gone.', { selector: 'main>section:nth-of-type(99)' });
    const deleted = await comment(page, '/brand', 'Deleted after two replies.');
    // Another visitor replies twice, then the author deletes the comment: [deleted, reply, reply]
    for (const text of ['First answer.', 'Second answer.']) {
        const reply = await request.post(`/api/comments/${deleted.id}/replies`, { headers: { Host: new URL(origin).host }, data: { text } });
        expect(reply.status(), await reply.text()).toBe(201);
    }
    const removed = await page.evaluate(async (id) => (await fetch(`/api/comments/${id}`, { method: 'DELETE' })).status, deleted.id);
    expect(removed).toBe(200);

    await page.reload();
    await addToolbarScript(page);
    await page.getByRole('button', { name: /^Inbox/ }).click();
    const thisPage = page.getByRole('complementary', { name: 'Comments' }).getByRole('region', { name: 'This page' });
    await expectListed(thisPage, ['Comment #2', 'Comment #1']);

    // No pin for #1, so no way to show it on the page; #2's pin is there
    await expect(thisPage.getByRole('article', { name: 'Comment #2' }).getByRole('button', { name: 'Show on page' })).toBeVisible();
    await expect(thisPage.getByRole('article', { name: 'Comment #1' }).getByRole('button', { name: 'Show on page' })).toHaveCount(0);

    // Two messages, like its pin ("Comment deleted" is not one)
    const card = thisPage.getByRole('article', { name: 'Comment #2' });
    await expect(card.getByText('Comment deleted')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Comment, 2 messages', exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Show all 2 messages' }).click();
    await expect(card.getByText('First answer.')).toBeVisible();

    await context.close();
});
