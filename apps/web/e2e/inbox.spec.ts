import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
    addToolbarScript,
    animationsFinished,
    isolatedOrigin,
    newVisitor,
    openLanding,
    openThread,
    toolbar
} from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// The inbox sidebar: this page's comments and the other pages' (review mode), searched and
// filtered by status, each with its public id; threads show their first and last message.

type SavedComment = { id: string; number: number };

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

async function comment(page: Page, path: string, text: string, { replies = [] as string[], resolved = false } = {}) {
    const saved = await api(page, 'POST', '/api/comments', {
        path,
        position: { type: 'point', selector: 'main', xNormal: 0.5, yNormal: 0.1 },
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

/** The group lists these comments (by public id), in this order */
async function expectListed(group: Locator, ids: string[]) {
    await expect.poll(async () => await group.getByRole('article').evaluateAll(articles =>
        articles.map(article => article.getAttribute('aria-label')))).toEqual(ids);
}

test('inbox: this page and other pages, searched and filtered by status', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await page.goto(`${origin}/brand?review=true`);
    await addToolbarScript(page);
    await expect(toolbar(page)).toBeVisible();

    const subtitle = await comment(page, '/brand', 'The heading could use a subtitle.', { replies: ['First reply.', 'Second reply.', 'Third reply.'] });
    await comment(page, '/brand', 'Name the colours.', { resolved: true });
    const policy = await comment(page, '/security', 'Link the security policy.', { replies: ['Where?', 'In the footer.', 'Added it there.'] });
    await comment(page, '/security', 'Old contact address.', { resolved: true });
    const feedback = await api(page, 'POST', '/api/comments', { path: '/brand', kind: 'feedback', position: { type: 'page' }, text: 'Love the tokens table.' });
    // Numbered per site, in the order they were posted
    expect([subtitle.number, policy.number, feedback.number]).toEqual([1, 3, 5]);

    await page.reload();
    await addToolbarScript(page);
    const inbox = page.getByRole('button', { name: 'Inbox, 2 comments' });
    await inbox.click();
    await expect(inbox).toHaveAttribute('aria-expanded', 'true');
    const sidebar = page.getByRole('complementary', { name: 'Comments' });
    const thisPage = sidebar.getByRole('region', { name: 'This page' });
    const otherPages = sidebar.getByRole('region', { name: 'Other pages' });

    // Open comments, newest first, with their public id and status
    await expectListed(thisPage, ['Comment #5', 'Comment #1']);
    await expectListed(otherPages, ['Comment #3']);
    const subtitleCard = thisPage.getByRole('article', { name: 'Comment #1' });
    await expect(subtitleCard).toContainText('Status: Open');
    await expect(subtitleCard).toContainText('Comment #1');
    await expect(sidebar.getByText('Name the colours.')).toHaveCount(0);

    // A thread shows its first and last message; Show all shows the rest, in both groups
    const policyCard = otherPages.getByRole('article', { name: 'Comment #3' });
    for (const [card, first, hidden, last] of [
        [subtitleCard, 'The heading could use a subtitle.', ['First reply.', 'Second reply.'], 'Third reply.'],
        [policyCard, 'Link the security policy.', ['Where?', 'In the footer.'], 'Added it there.']
    ] as const) {
        await expect(card.getByText(first)).toBeVisible();
        await expect(card.getByText(last)).toBeVisible();
        for (const text of hidden) {
            await expect(card.getByText(text)).toHaveCount(0);
        }
        await card.getByRole('button', { name: 'Show all 4 messages' }).click();
        for (const text of hidden) {
            await expect(card.getByText(text)).toBeVisible();
        }
    }

    // The other page's comment links to its thread there, in the review
    const policyLink = policyCard.getByRole('link', { name: 'Open on /security' });
    await expect(policyLink).toHaveAttribute('href', `${origin}/security?review=true&uier-comment=${policy.id}`);
    await animationsFinished(sidebar);
    await expectNoAxeViolations(page);

    // Search: messages, pages and public ids, in both groups
    const search = sidebar.getByRole('searchbox', { name: 'Search comments' });
    await search.fill('security');
    await expect(thisPage).toContainText('No matches');
    await expectListed(otherPages, ['Comment #3']);
    await expect(sidebar.getByRole('status').filter({ hasText: '1 comment found' })).toBeAttached();
    await search.fill('second REPLY');
    await expect(otherPages).toContainText('No matches');
    await expectListed(thisPage, ['Comment #1']);
    await search.fill('#5');
    await expectListed(thisPage, ['Comment #5']);
    await expect(otherPages).toContainText('No matches');

    // Status: done comments, then all of them, still searched
    await search.fill('');
    await sidebar.getByRole('button', { name: 'Done', exact: true }).click();
    await expectListed(thisPage, ['Comment #2']);
    await expectListed(otherPages, ['Comment #4']);
    await expect(otherPages.getByRole('article', { name: 'Comment #4' })).toContainText('Status: Done');
    await search.fill('contact');
    await expect(thisPage).toContainText('No matches');
    await expectListed(otherPages, ['Comment #4']);
    await sidebar.getByRole('button', { name: 'All', exact: true }).click();
    await search.fill('');
    await expectListed(thisPage, ['Comment #5', 'Comment #2', 'Comment #1']);
    await expectListed(otherPages, ['Comment #4', 'Comment #3']);

    // The Inbox button closes it again
    await inbox.click();
    await expect(sidebar).toBeHidden();
    await expect(inbox).toHaveAttribute('aria-expanded', 'false');

    // Show on page: the inbox closes and the thread opens on its pin
    await inbox.click();
    await thisPage.getByRole('article', { name: 'Comment #1' }).getByRole('button', { name: 'Show on page' }).click();
    await expect(sidebar).toBeHidden();
    await expect(openThread(page).getByText('The heading could use a subtitle.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(openThread(page)).toBeHidden();

    // The link goes to the other page, where the thread opens
    await inbox.click();
    await otherPages.getByRole('link', { name: 'Open on /security' }).click();
    await page.waitForURL(url => url.pathname === '/security');
    await addToolbarScript(page);
    await expect(openThread(page).getByText('Link the security policy.')).toBeVisible();
    expect(new URL(page.url()).search).toBe('?review=true');

    await context.close();
});

test('inbox: the showcase lists this page only', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, origin, { dismissHint: true });
    await comment(page, '/', 'Pinned on the landing page.');
    await comment(page, '/brand', 'Somewhere else.');

    await page.reload();
    await page.getByRole('button', { name: 'Inbox, 1 comment' }).click();
    const sidebar = page.getByRole('complementary', { name: 'Comments' });
    await expect(sidebar.getByRole('region', { name: 'This page' }).getByText('Pinned on the landing page.')).toBeVisible();
    await expect(sidebar.getByRole('region', { name: 'Other pages' })).toHaveCount(0);
    await expect(sidebar.getByText('Somewhere else.')).toHaveCount(0);

    await context.close();
});
