import type { CommentItem } from '../../../packages/toolbar/src/components/@types/Comments';
import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { startReviewedSite } from './support/reviewedSite';
import { backToComments, createProject, expectArchiveCount, openComment, setProjectAccess, signIn, toggleArchive, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { animationsFinished, commentBubble, expectInboxListed, openThread, threadOptions } from './support/toolbar';

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
    await expect(tabs.getByRole('button', { name: /^Archive/ })).toHaveCount(0);
    // The Archive is in the Filter popover (uier #485), and shows as a filter in effect
    const archived = page.getByRole('button', { name: 'Archived, clear filter', exact: true });
    await expectArchiveCount(page, 1);
    await toggleArchive(page);
    await expect(page).toHaveURL(/archive=only/);
    await expect(archived).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Done 1', exact: true })).toBeVisible();
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
    await archived.click();
    await expect(archived).toHaveCount(0);
    await tabs.getByRole('button', { name: 'Done 1', exact: true }).click();
    card = await openComment(page, 1);
    await expect(card).toContainText('Keep this feedback for later');
    await expect(card.getByRole('button', { name: /^Status: Done/ })).toBeVisible();
});

test('the board archives to a separate list and restores to the same column', async ({ page }) => {
    const f = await fixture(page);
    const project = `/app/projects/${f.projectId}`;
    await page.goto(`${project}?view=board`);
    const column = (name: string) => page.getByRole('region', { name: `${name} comments`, exact: true });
    const archived = page.getByRole('button', { name: 'Archived, clear filter', exact: true });
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    await expect(page.locator('[data-board-scroll] > section')).toHaveCount(3);
    await expect(column('Archived')).toHaveCount(0);
    await expect(archived).toHaveCount(0);

    let thread = await openComment(page, 1);
    await page.mouse.move(0, page.viewportSize()!.height - 1);
    await thread.getByRole('button', { name: /^More actions for the comment/ }).click();
    await page.getByRole('menuitem', { name: 'Archive comment', exact: true }).click();
    await expect(thread.getByText('Archived', { exact: true })).toBeVisible();
    await backToComments(page);
    await expect(column('Open').getByRole('listitem')).toHaveCount(0);
    await expectArchiveCount(page, 1);

    // The legacy toolbar link lands in the same archive. Workflow filters compose with it.
    await page.goto(`${project}?view=board&status=archived`);
    await expect(archived).toBeVisible();
    await expect(page.locator('[data-board-scroll]')).toHaveCount(0);
    const row = page.locator('[data-comment-row]').filter({ hasText: 'Keep this feedback for later' });
    await expect(row).toContainText(/Status:\s*Open/);
    const tabs = page.getByRole('group', { name: 'Status', exact: true });
    await tabs.getByRole('button', { name: 'Done 0', exact: true }).click();
    await expect(page).toHaveURL(/archive=only/);
    await expect(row).toHaveCount(0);
    await tabs.getByRole('button', { name: 'All 1', exact: true }).click();
    await expect(row).toBeVisible();

    await page.getByRole('button', { name: 'Sort Archive: Recently archived', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Recently archived', exact: true })).toHaveAttribute('aria-checked', 'true');
    const sorted = page.waitForResponse(response => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined);
    await page.getByRole('menuitemradio', { name: 'Oldest first', exact: true }).click();
    expect((await sorted).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sort Archive: Oldest first', exact: true })).toBeVisible();

    thread = await openComment(page, 1);
    await expect(thread.getByRole('button', { name: /^Status: Open/ })).toBeVisible();
    await thread.getByRole('button', { name: /^More actions for the comment/ }).click();
    await page.getByRole('menuitem', { name: 'Restore comment', exact: true }).click();
    await expect(page.getByText('Nothing archived', { exact: true })).toBeVisible();
    await archived.click();
    await expect(column('Open').getByRole('listitem')).toHaveCount(1);
    await expect(archived).toHaveCount(0);
});

test('Archive all in a board column archives every thread in it, the ones not loaded yet too, after a confirmation', async ({ page, request }) => {
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('archive-all'));
    const projectId = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, projectId, 'Anyone with the link');
    // More than a column's first page (25), so some are not loaded when Archive all runs (uier #357)
    let headers = await verifiedReviewHeaders(request, projectId, site.origin());
    for (let index = 0; index < 30; index++) {
        // A visitor may post only so often: a new one every ten comments
        if (index && index % 10 === 0) headers = await verifiedReviewHeaders(request, projectId, site.origin());
        const response = await request.post(`/api/review/${projectId}/comments`, { headers, data: {
            path: `/${projectId}/pricing`, text: `Column feedback ${index}`, authorName: 'Reviewer', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status(), await response.text()).toBe(201);
        // Archive all is only on Done columns (uier #370); one stays open to show Open has none
        if (index) {
            const resolved = await request.patch(`/api/review/${projectId}/comments/${(await response.json()).id}`, { headers, data: { resolved: true } });
            expect(resolved.status(), await resolved.text()).toBe(200);
        }
    }
    await page.goto(`/app/projects/${projectId}?view=board`);
    const column = (name: string) => page.getByRole('region', { name: `${name} comments`, exact: true });
    const done = column('Done');
    await expect(done.getByRole('heading')).toHaveText('Done29');
    await expect(done.locator('[data-comment-window]')).toHaveAttribute('data-loaded-count', '25');
    // A column with cards glows around its dot (uier #356); an empty one does not. Open has cards but no Archive all
    await expect(done.locator('[data-status-glow]')).toHaveCount(1);
    await expect(column('In progress').locator('[data-status-glow]')).toHaveCount(0);
    await expect(column('Open').getByRole('heading')).toHaveText('Open1');
    await expect(column('Open').getByRole('button', { name: /^Archive all/ })).toHaveCount(0);

    // Cancel changes nothing
    await done.getByRole('button', { name: 'Archive all in Done', exact: true }).click();
    let dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading')).toHaveText('Archive 29 threads in Done?');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(done.getByRole('heading')).toHaveText('Done29');

    await done.getByRole('button', { name: 'Archive all in Done', exact: true }).click();
    dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Archive all', exact: true }).click();
    // The column empties and Archive all goes with its cards: the focus is on the column's sort beside it (uier #444)
    await expect(done.getByRole('button', { name: /^Sort Done: / })).toBeFocused();
    await expect(page.getByText('29 threads archived.', { exact: true })).toBeVisible();
    await expect(done.getByRole('button', { name: /^Archive all/ })).toHaveCount(0);
    await expect(done.getByRole('button', { name: /^Sort Done: / })).toBeFocused();
    await expectArchiveCount(page, 29);
    await page.reload();
    await expect(done.getByRole('heading')).toHaveText('Done0');
    await expect(column('Open').getByRole('heading')).toHaveText('Open1');
    await expectArchiveCount(page, 29);
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
    const archive = inbox.getByRole('button', { name: /^Archive\s*1$/ });
    await archive.click();
    await expect(archive).toHaveAttribute('aria-pressed', 'true');
    await expect(tabs.getByRole('button', { name: 'Active 1', exact: true })).toBeVisible();
    const openInApp = inbox.getByRole('link', { name: 'Open in app', exact: true });
    await expect(openInApp).toHaveAttribute('href', /[?&]archive=only/);
    const archived = inbox.getByRole('article');
    await expect(archived).toContainText('Keep this feedback for later');
    await expect(archived).toContainText(/Status:\s*Open/);
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
    await inbox.getByRole('button', { name: /^Archive\s*0$/ }).click();
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
    await inbox.getByRole('button', { name: /^Archive\s*\d+$/ }).click();
    await expectInboxListed(inbox, 200);
});
