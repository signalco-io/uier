import type { CommentItem } from '../../../packages/toolbar/src/components/@types/Comments';
import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { startReviewedSite } from './support/reviewedSite';
import { backToComments, createProject, openComment, signIn, uniqueEmail } from './support/app';
import { animationsFinished, commentBubble, openThread, threadOptions } from './support/toolbar';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(baseURL!); });
test.afterAll(async () => { await site.close(); });

async function fixture(page: Page) {
    await signIn(page, uniqueEmail('archive'));
    const projectId = await createProject(page, { urls: [site.origin()] });
    const path = `/${projectId}/pricing`;
    const reviewUrl = `/app/review/${projectId}?url=${encodeURIComponent(`${site.origin()}${path}`)}`;
    await page.goto(reviewUrl);
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill('Keep this feedback for later');
    const posted = page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/review\/[^/]+\/comments$/.test(new URL(response.url()).pathname));
    await composer.press('Enter');
    const response = await posted;
    expect(response.status()).toBe(201);
    const comment = await response.json() as CommentItem;
    await expect(commentBubble(page, 1, 1)).toBeVisible();
    return { projectId, comment, reviewUrl };
}

test('app archive stays separate from Done and All, reloads and restores the prior status', async ({ page }) => {
    const f = await fixture(page);
    await page.goto(`/app/projects/${f.projectId}`);
    let card = await openComment(page, 1);
    await card.getByRole('button', { name: /^Status: Open/ }).click();
    await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
    await backToComments(page);
    const tabs = page.getByRole('group', { name: 'Status', exact: true });
    await tabs.getByRole('button', { name: 'Done 1', exact: true }).click();
    card = await openComment(page, 1);
    await card.getByRole('button', { name: /^More actions for the comment/ }).click();
    await page.getByRole('menuitem', { name: 'Archive comment', exact: true }).click();
    await expect(page.getByText('Nothing done yet', { exact: true })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Done 0', exact: true })).toBeVisible();
    await tabs.getByRole('button', { name: 'All 0', exact: true }).click();
    await expect(page.locator('[data-comment-row]')).toHaveCount(0);
    await tabs.getByRole('button', { name: 'Archive 1', exact: true }).click();
    await page.reload();
    card = await openComment(page, 1);
    await expect(card.getByText('Archived', { exact: true })).toBeVisible();
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
        await animationsFinished(page.locator('body'));
        await expectNoAxeViolations(page);
    }
    await expect(card.getByRole('button', { name: /^Status: Done/ })).toBeVisible();
    await card.getByRole('button', { name: /^More actions for the comment/ }).click();
    await page.getByRole('menuitem', { name: 'Restore comment', exact: true }).click();
    await expect(page.getByText('Nothing archived', { exact: true })).toBeVisible();
    await tabs.getByRole('button', { name: 'Done 1', exact: true }).click();
    card = await openComment(page, 1);
    await expect(card).toContainText('Keep this feedback for later');
    await expect(card.getByRole('button', { name: /^Status: Done/ })).toBeVisible();
});

test('the board shows Archive as its last column, collapsed until someone expands it for the project', async ({ page }) => {
    const f = await fixture(page);
    await page.goto(`/app/projects/${f.projectId}?view=board`);
    const column = (name: string) => page.getByRole('region', { name: `${name} comments`, exact: true });
    const archive = column('Archived');
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    // Collapsed: its name and count, no cards; the filters have no Archive button of their own
    const expand = archive.getByRole('button', { name: 'Archive 0', exact: true });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(archive.getByRole('listitem')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Archive \d+$/ })).toHaveCount(1);
    // Last, after Done
    const regions = page.locator('[data-board-scroll] > section');
    await expect(regions.last()).toHaveAttribute('aria-label', 'Archived comments');

    // Archiving from the board's sheet moves the card out of its column; the count follows
    let thread = await openComment(page, 1);
    await thread.getByRole('button', { name: /^More actions for the comment/ }).click();
    await page.getByRole('menuitem', { name: 'Archive comment', exact: true }).click();
    await expect(thread.getByText('Archived', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(column('Open').getByRole('listitem')).toHaveCount(0);
    await expect(archive.getByRole('button', { name: 'Archive 1', exact: true })).toBeVisible();

    // Expanded: a column of its cards, which don't move; the focus goes to its Collapse button
    const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined);
    await archive.getByRole('button', { name: 'Archive 1', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    const collapse = archive.getByRole('button', { name: 'Collapse Archive', exact: true });
    await expect(collapse).toBeFocused();
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    const archivedCard = archive.getByRole('listitem').filter({ hasText: 'Keep this feedback for later' });
    await expect(archivedCard).toBeVisible();
    await expect(archivedCard.getByRole('button', { name: /^Move / })).toHaveCount(0);
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
        await animationsFinished(page.locator('body'));
        await expectNoAxeViolations(page);
    }

    // Saved on the project: still expanded after a reload
    await page.reload();
    await expect(archive.getByRole('listitem')).toHaveCount(1);
    // Its own sort, like Done's: newest archived first by default, saved on the project too
    await archive.getByRole('button', { name: 'Sort Archive: Recently archived', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Recently archived', exact: true })).toHaveAttribute('aria-checked', 'true');
    const sorted = page.waitForResponse(response => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined);
    await page.getByRole('menuitemradio', { name: 'Oldest first', exact: true }).click();
    expect((await sorted).ok()).toBe(true);
    await page.reload();
    await expect(archive.getByRole('button', { name: 'Sort Archive: Oldest first', exact: true })).toBeVisible();
    // Restore from its thread returns it to its column
    thread = await openComment(page, 1);
    await thread.getByRole('button', { name: /^More actions for the comment/ }).click();
    await page.getByRole('menuitem', { name: 'Restore comment', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    await expect(archive.getByText('Nothing archived.', { exact: true })).toBeVisible();

    // Collapsed again, for the next load too; the focus goes back to the strip
    const collapsed = page.waitForResponse(response => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined);
    await archive.getByRole('button', { name: 'Collapse Archive', exact: true }).click();
    await collapsed;
    await expect(archive.getByRole('button', { name: 'Archive 0', exact: true })).toBeFocused();
    await page.reload();
    await expect(archive.getByRole('button', { name: 'Archive 0', exact: true })).toHaveAttribute('aria-expanded', 'false');
});

test('toolbar archive removes the pin, restores from Archive and rolls back a failed save', async ({ page }) => {
    const f = await fixture(page);
    await page.goto(f.reviewUrl);
    if (!await openThread(page).isVisible()) await commentBubble(page, 1, 1).click();
    const archivedSave = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname.endsWith(`/comments/${f.comment.id}`));
    await (await threadOptions(page, openThread(page))).getByRole('button', { name: 'Archive comment', exact: true }).click();
    await expect(commentBubble(page, 1, 1)).toHaveCount(0);
    expect((await archivedSave).status()).toBe(200);
    await page.reload();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    if (await page.getByRole('button', { name: /^Inbox/ }).getAttribute('aria-expanded') !== 'true')
        await page.getByRole('button', { name: /^Inbox/ }).click();
    const tabs = inbox.getByRole('group', { name: 'Show comments' });
    await expect(tabs.getByRole('button', { name: 'Active 0', exact: true })).toBeVisible();
    await tabs.getByRole('button', { name: 'All 0', exact: true }).click();
    await expect(inbox.getByRole('article')).toHaveCount(0);
    await tabs.getByRole('button', { name: 'Archive 1', exact: true }).click();
    const archived = inbox.getByRole('article');
    await expect(archived).toContainText('Keep this feedback for later');
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await animationsFinished(page.locator('#uier-toolbar'));
        await expectNoAxeViolations(page, { include: ['#uier-toolbar'] });
    }
    await expect(archived.getByRole('button', { name: 'Show on page', exact: true })).toHaveCount(0);
    const restored = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname.endsWith(`/comments/${f.comment.id}`));
    await (await threadOptions(page, archived)).getByRole('button', { name: 'Restore comment', exact: true }).click();
    expect((await restored).status()).toBe(200);
    await expect(inbox.getByRole('article')).toHaveCount(0);
    await expect(commentBubble(page, 1, 1)).toBeVisible();
    await tabs.getByRole('button', { name: 'Active 1', exact: true }).click();
    const thread = inbox.getByRole('article');
    await expect(thread).toContainText('Keep this feedback for later');
    const endpoint = `**/api/review/*/comments/${f.comment.id}`;
    await page.route(endpoint, route => route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server_error', message: 'Could not archive the comment.' }) })
        : route.continue());
    await (await threadOptions(page, thread)).getByRole('button', { name: 'Archive comment', exact: true }).click();
    await expect(thread).toContainText('Keep this feedback for later');
    await expect(commentBubble(page, 1, 1)).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' }).first()).toBeVisible();
    await page.unroute(endpoint);
});


test('toolbar page and site windows retain active feedback behind 1001 newer archived threads', async ({ page }) => {
    const f = await fixture(page);
    const endpoint = `/api/review/${f.projectId}/comments`;
    const ordinary = f.comment;
    const records = [...Array.from({ length: 1001 }, (_, index) => ({ ...ordinary,
        id: `comment_archived_${index}`, number: index + 2, archivedAt: '2026-11-10T00:00:00.000Z' })), ordinary];
    const scopes = new Set<string>();
    await page.route(`**${endpoint}?**`, async route => {
        const query = new URL(route.request().url()).searchParams;
        const archive = query.get('archive');
        scopes.add(`${query.get('scope') ?? 'page'}:${archive}`);
        const filtered = records.filter(comment => archive === 'only' ? comment.archivedAt : archive === 'exclude' ? !comment.archivedAt : true);
        await route.fulfill({ json: filtered.slice(0, 200) });
    });
    await page.goto(f.reviewUrl);
    await expect(commentBubble(page, 1, 1)).toBeVisible();
    await page.getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments' });
    await expect(inbox).toContainText('Keep this feedback for later');
    await expect.poll(() => [...scopes].sort()).toEqual(['page:exclude', 'page:only', 'site:exclude', 'site:only']);
    await inbox.getByRole('button', { name: /^Archive / }).click();
    await expect(inbox.getByRole('article')).toHaveCount(200);
});
