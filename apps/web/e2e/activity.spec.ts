import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { addToolbarScript, inboxSearch, isolatedOrigin, newVisitor, animationsFinished, commentBubbles, inboxPages, openThread, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';
import { startReviewedSite } from './support/reviewedSite';
import { allCommentRowLinks, commentRowLink, commentRows, createProject, inBackground, openComment, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { selectText, selectedText } from './support/composer';

async function foreground(page: Page) {
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

async function load(page: Page, origin: string) {
    await page.goto(`${origin}/brand?review=true`);
    await addToolbarScript(page);
    await expect(toolbar(page)).toBeVisible();
}

const inbox = (page: Page) => page.getByRole('button', { name: /^Inbox(?:,|$)/ });

test('anonymous direct thread opening sends no read and sets no cookie; explicit read actions still work', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const author = await newVisitor(browser, testInfo);
    const reader = await newVisitor(browser, testInfo);
    try {
        const posted = await author.context.request.post(`${origin}/api/comments`, { data: {
            path: '/brand', text: 'Read without an identity', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }
        } });
        expect(posted.status()).toBe(201);
        const comment = await posted.json();
        const reads: string[] = [];
        reader.page.on('request', request => {
            if (request.method() === 'POST' && /\/comments\/(?:[^/]+\/)?read$/.test(new URL(request.url()).pathname)) reads.push(request.url());
        });
        await reader.page.goto(`${origin}/brand?review=true&uier-comment=${comment.id}`);
        await addToolbarScript(reader.page);
        await expect(openThread(reader.page)).toContainText('Read without an identity');
        await foreground(reader.page);
        await reader.page.waitForTimeout(1500); // Longer than the automatic read's 800 ms dwell.
        expect(reads).toEqual([]);
        expect((await reader.context.cookies()).filter(cookie => cookie.name === 'uier_visitor')).toEqual([]);
        await inbox(reader.page).click();
        const card = reader.page.getByRole('article', { name: `Comment #${comment.number}` });
        // The unread dot is the Mark as read button
        await card.getByRole('button', { name: 'Unread. Mark as read', exact: true }).click();
        await expect.poll(() => reads.length).toBe(1);
        await expect.poll(async () => (await reader.context.cookies()).some(cookie => cookie.name === 'uier_visitor')).toBe(true);
        await expect(card.getByRole('button', { name: 'Unread. Mark as read', exact: true })).toHaveCount(0);
        await expect(inbox(reader.page)).toHaveAccessibleName('Inbox');
        // Mark as unread is in the thread's options once it is read
        await card.getByRole('button', { name: 'Thread options', exact: true }).click();
        await expect(reader.page.getByRole('button', { name: 'Mark as unread', exact: true })).toBeFocused();
        // Opened from the inbox, the menu stays dark like the inbox (the ink scope), and each item has an icon
        const options = reader.page.getByRole('dialog', { name: 'Thread options', exact: true });
        expect(await options.evaluate(menu => Boolean(menu.closest('.dark')))).toBe(true);
        for (const button of await options.getByRole('button').all())
            await expect(button.locator('svg')).toHaveCount(1);
        await reader.page.getByRole('button', { name: 'Mark as unread', exact: true }).click();
        await expect(card.getByRole('button', { name: 'Unread. Mark as read', exact: true })).toBeVisible();
        await expect(card.getByRole('button', { name: 'Thread options', exact: true })).toHaveCount(0);
        await expect(inbox(reader.page)).toHaveAccessibleName('Inbox, 1 unread thread');
    } finally { await author.context.close(); await reader.context.close(); }
});

test('true unread activity is per reviewer and survives reading, resolution, reload and other pages', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const first = await newVisitor(browser, testInfo);
    const second = await newVisitor(browser, testInfo);
    let releaseActivity: (() => void) | undefined;
    try {
        await load(first.page, origin);
        const posted = await first.context.request.post(`${origin}/api/comments`, { data: {
            path: '/brand', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'First reviewer feedback'
        } });
        const comment = await posted.json();
        await foreground(first.page);
        await expect(commentBubbles(first.page)).toHaveCount(1);
        await expect(inbox(first.page)).toHaveAccessibleName('Inbox');
        await load(second.page, origin);
        await expect(inbox(second.page)).toHaveAccessibleName('Inbox, 1 unread thread');
        // Listing previews does not mark everything read. Reading is separate from Open/Done.
        await inbox(second.page).click();
        await second.page.getByRole('button', { name: '1 unread', exact: true }).click();
        const card = second.page.getByRole('article', { name: `Comment #${comment.number}` });
        await expect(card).toContainText('First reviewer feedback');
        await card.getByRole('button', { name: 'Mark as read' }).click();
        await expect(inbox(second.page)).toHaveAccessibleName('Inbox');
        await second.page.reload();
        await expect(inbox(second.page)).toHaveAccessibleName('Inbox');
        expect((await (await second.context.request.get(`${origin}/api/comments?path=/brand`)).json())[0].resolved).toBe(false);
        await second.context.request.post(`${origin}/api/comments/${comment.id}/replies`, { data: { text: 'Second reviewer reply' } });
        await foreground(second.page);
        await expect(inbox(second.page)).toHaveAccessibleName('Inbox');
        await foreground(first.page);
        await expect(inbox(first.page)).toHaveAccessibleName('Inbox, 1 unread thread');
        // Resolving through a separate surface does not acknowledge unseen activity.
        await first.context.request.patch(`${origin}/api/comments/${comment.id}`, { data: { resolved: true } });
        await foreground(first.page);
        await inbox(first.page).click();
        await first.page.getByRole('button', { name: '1 unread', exact: true }).click();
        const done = first.page.getByRole('article', { name: `Comment #${comment.number}` });
        await expect(done).toContainText('Done');
        await expect(done).toContainText('Second reviewer reply');
        await done.getByRole('button', { name: 'Mark as read' }).click();
        await expect(inbox(first.page)).toHaveAccessibleName('Inbox');
        await first.page.getByRole('button', { name: 'Close sidebar' }).click();
        await expect(first.page.getByRole('complementary', { name: 'Comments' })).toBeHidden();
        await inbox(first.page).click();
        await expect(first.page.getByRole('button', { name: '0 unread', exact: true })).toHaveAttribute('aria-pressed', 'true');
        // The initial activity response can predate another person's change while still in flight.
        // Hold that real server snapshot so focus must queue a subsequent refresh, not wait for polling.
        let capturedUnread: number | undefined;
        const activityGate = new Promise<void>(resolve => { releaseActivity = resolve; });
        await first.page.route('**/api/comments/activity', async route => {
            if (capturedUnread !== undefined) { await route.continue(); return; }
            const response = await route.fetch();
            capturedUnread = (await response.json()).unread;
            await activityGate;
            await route.fulfill({ response });
        });
        await first.page.reload();
        await expect.poll(() => capturedUnread).toBe(0);
        await expect(inbox(first.page)).toHaveAccessibleName('Inbox');
        const other = await second.context.request.post(`${origin}/api/comments`, { data: {
            path: '/security', kind: 'feedback', position: { type: 'page' }, text: 'Feedback on another page'
        } });
        const otherComment = await other.json();
        const refreshedActivity = first.page.waitForResponse(async response => response.request().method() === 'GET'
            && new URL(response.url()).pathname === '/api/comments/activity' && response.ok()
            && (await response.json()).unread === 1, { timeout: 5000 });
        await foreground(first.page);
        releaseActivity!();
        await Promise.all([refreshedActivity, expect(inbox(first.page)).toHaveAccessibleName('Inbox, 1 unread thread')]);
        await first.page.unroute('**/api/comments/activity');
        // Open before the reload: it stays open
        await expect(first.page.getByRole('complementary', { name: 'Comments' })).toBeVisible();
        await first.page.getByRole('button', { name: '1 unread', exact: true }).click();
        // Unread lists every page, like the pill's count
        await expect(inboxPages(first.page)).toContainText('All pages');
        const otherGroup = first.page.getByRole('region', { name: 'All pages' });
        await expect(otherGroup.getByRole('article', { name: `Comment #${otherComment.number}` })).toContainText('Feedback on another page');
        await expectNoAxeViolations(first.page);
        await first.page.getByRole('button', { name: 'Close sidebar' }).click();
        await first.page.goto(`${origin}/security?review=true`);
        await addToolbarScript(first.page);
        await expect(inbox(first.page)).toHaveAccessibleName('Inbox, 1 unread thread');
    } finally {
        releaseActivity?.();
        await first.context.close();
        await second.context.close();
    }
});

test('foreground refresh keeps drafts/focus, stops hidden/collapsed/offline work and refreshes on return', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const origin = isolatedOrigin(testInfo);
    const first = await newVisitor(browser, testInfo);
    const second = await newVisitor(browser, testInfo);
    try {
        await first.page.clock.install();
        const response = await first.context.request.post(`${origin}/api/comments`, { data: {
            path: '/brand', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Live feedback'
        } });
        const comment = await response.json();
        await load(first.page, origin);
        await commentBubbles(first.page).click();
        const reply = openThread(first.page).getByRole('textbox', { name: 'Reply' });
        await reply.fill('Keep this draft');
        let reads = 0;
        first.page.on('request', request => {
            if (request.method() === 'GET' && new URL(request.url()).pathname.startsWith('/api/comments')) reads++;
        });
        await second.context.request.post(`${origin}/api/comments/${comment.id}/replies`, { data: { text: 'Fresh reply from another person' } });
        await first.page.clock.runFor(15_100);
        await expect(openThread(first.page).getByText('Fresh reply from another person')).toBeVisible();
        await expect(reply).toHaveText('Keep this draft', { useInnerText: true });
        await expect(reply).toBeFocused();
        expect(reads).toBeGreaterThan(0);
        // A remote resolve must not dismiss the reply being written.
        await first.context.request.patch(`${origin}/api/comments/${comment.id}`, { data: { resolved: true } });
        await foreground(first.page);
        await expect(openThread(first.page)).toContainText('Done');
        await expect(reply).toHaveText('Keep this draft', { useInnerText: true });
        await expect(reply).toBeFocused();
        await first.page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await first.page.clock.runFor(100);
        const hiddenReads = reads;
        await first.page.clock.runFor(45_100);
        expect(reads).toBe(hiddenReads);
        await second.context.request.post(`${origin}/api/comments/${comment.id}/replies`, { data: { text: 'While hidden' } });
        await first.page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await expect(openThread(first.page).getByText('While hidden')).toBeVisible();
        await expect(reply).toBeFocused();
        await first.context.setOffline(true);
        const offlineReads = reads;
        await first.page.clock.runFor(30_100);
        expect(reads).toBe(offlineReads);
        await second.context.request.post(`${origin}/api/comments/${comment.id}/replies`, { data: { text: 'While offline' } });
        await first.context.setOffline(false);
        await expect(openThread(first.page).getByText('While offline')).toBeVisible();
        await expect(reply).toHaveText('Keep this draft', { useInnerText: true });
        await first.page.keyboard.press('Escape');
        await toolbar(first.page).getByRole('button', { name: 'Collapse toolbar' }).click();
        await first.page.clock.runFor(100);
        const collapsedReads = reads;
        await first.page.clock.runFor(30_100);
        expect(reads).toBe(collapsedReads);
        await first.page.getByRole('button', { name: /^Expand toolbar/ }).click();
        await expect.poll(() => reads).toBeGreaterThan(collapsedReads);
    } finally {
        await first.context.close();
        await second.context.close();
    }
});

test('opened short threads become read in light/dark without moving composer focus', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const author = await newVisitor(browser, testInfo);
    const reader = await newVisitor(browser, testInfo);
    try {
        await author.context.request.post(`${origin}/api/comments`, { data: {
            path: '/brand', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Read on opening'
        } });
        await reader.context.request.post(`${origin}/api/comments`, { data: {
            path: '/security', kind: 'feedback', position: { type: 'page' }, text: 'Existing identified reader'
        } });
        await load(reader.page, origin);
        await foreground(reader.page);
        await expect(inbox(reader.page)).toHaveAccessibleName('Inbox, 1 unread thread');
        await commentBubbles(reader.page).click();
        const composer = openThread(reader.page).getByRole('textbox', { name: 'Reply' });
        await composer.fill('Unsent reply');
        await expect(inbox(reader.page)).toHaveAccessibleName('Inbox');
        await expect(composer).toBeFocused();
        for (const colorScheme of ['light', 'dark'] as const) {
            await reader.page.emulateMedia({ colorScheme });
            await expect(reader.page.locator('#uier-toolbar').locator('[data-uier-root]').first())
                .toHaveAttribute('class', colorScheme === 'dark' ? 'dark' : '');
            await animationsFinished(openThread(reader.page));
            // The toolbar is embedded on arbitrary host pages; inspect its shadow-root UI.
            const audit = await new AxeBuilder({ page: reader.page }).include('#uier-toolbar')
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag21aaa']).analyze();
            expect(audit.violations).toEqual([]);
            await reader.page.screenshot({ path: testInfo.outputPath(`unread-${colorScheme}.png`) });
        }
        await reader.page.reload();
        await expect(inbox(reader.page)).toHaveAccessibleName('Inbox');
        // Mark as unread in the open thread keeps it unread: no automatic read while it stays open
        await foreground(reader.page);
        await commentBubbles(reader.page).click();
        await openThread(reader.page).getByRole('button', { name: 'Thread options', exact: true }).click();
        await reader.page.getByRole('button', { name: 'Mark as unread', exact: true }).click();
        await expect(inbox(reader.page)).toHaveAccessibleName('Inbox, 1 unread thread');
        await reader.page.waitForTimeout(1500); // Longer than the automatic read's 800 ms dwell.
        await expect(inbox(reader.page)).toHaveAccessibleName('Inbox, 1 unread thread');
        await expect(openThread(reader.page).getByRole('button', { name: 'Unread. Mark as read', exact: true })).toBeVisible();
        await reader.page.route('**/api/comments/activity', route => route.fulfill({ json: { unread: 205, open: 205, done: 0, total: 205 } }));
        await reader.page.reload();
        await expect(inbox(reader.page)).toHaveAccessibleName('Inbox, 99+ unread threads, 205 in total');
        const highCountAudit = await new AxeBuilder({ page: reader.page }).include('#uier-toolbar').analyze();
        expect(highCountAudit.violations).toEqual([]);
    } finally { await author.context.close(); await reader.context.close(); }
});

for (const refresh of ['foreground', 'idle'] as const) {
    test(`a review losing access removes cached comments and annotations on ${refresh} refresh`, async ({ page, browser, baseURL }, testInfo) => {
        test.setTimeout(60_000);
        const site = await startReviewedSite(new URL(baseURL!).origin);
        const guest = await newVisitor(browser, testInfo);
        try {
            await signIn(page, uniqueEmail('activity-owner'));
            const projectId = await createProject(page, { urls: [site.origin()] });
            await setProjectAccess(page, projectId, 'Anyone with the link');
            const headers = await verifiedReviewHeaders(page.request, projectId, site.origin());
            await page.request.post(`/api/review/${projectId}/comments`, { headers, data: {
                path: `/${projectId}/pricing`, position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 },
                text: 'Visible only while access remains', authorName: 'Reporter'
            } });
            if (refresh === 'idle') await guest.page.clock.install();
            await guest.page.goto(`${site.origin()}/${projectId}/pricing?toolbar-code=${projectId}`);
            await expect(commentBubbles(guest.page)).toHaveCount(1);
            await inbox(guest.page).click();
            await expect(guest.page.getByText('Visible only while access remains')).toBeVisible();
            if (refresh === 'idle') {
                const counter = refreshCounter(guest.page, `/api/review/${projectId}`, `/api/review/${projectId}/comments`);
                for (let i = 0; i < 12; i++) {
                    await guest.page.clock.runFor(15_100);
                    await counter.settle();
                }
            }
            await setProjectAccess(page, projectId, 'Invited people');
            if (refresh === 'foreground') await foreground(guest.page);
            else await guest.page.clock.runFor(60_100);
            await expect(toolbar(guest.page)).toContainText('Sign in to see and leave comments.');
            await expect(commentBubbles(guest.page)).toHaveCount(0);
            await expect(guest.page.getByText('Visible only while access remains')).toHaveCount(0);
        } finally { await guest.context.close(); await site.close(); }
    });
}

test('a member shares read state between the app and reviews on different configured sites', async ({ page, baseURL }) => {
    const site = await startReviewedSite(new URL(baseURL!).origin);
    try {
        await signIn(page, uniqueEmail('member-cursors'));
        const projectId = await createProject(page, { urls: [site.origin(), site.origin('second-site')] });
        await setProjectAccess(page, projectId, 'Anyone with the link');
        const headers = await verifiedReviewHeaders(page.request, projectId, site.origin());
        const posted = await page.request.post(`/api/review/${projectId}/comments`, { headers, data: {
            path: `/${projectId}/pricing`, position: { type: 'page' }, kind: 'feedback', text: 'Member inbox feedback', authorName: 'Guest'
        } });
        expect(posted.status()).toBe(201);
        const comment = await posted.json();
        await page.goto(`/app/projects/${projectId}`);
        const card = await openComment(page, 'Member inbox feedback');
        await expect(card).toHaveAccessibleName('Comment by Guest');
        // The open thread is read once it has been shown; Mark as unread is in More actions and keeps it
        // unread while it stays open, so the unread dot (the Mark as read button) waits for a click
        await expect(card.getByRole('button', { name: 'Unread. Mark as read', exact: true })).toHaveCount(0);
        await card.getByRole('button', { name: 'More actions for the comment by guest', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Mark as unread', exact: true }).click();
        await expect(card.getByRole('button', { name: 'Unread. Mark as read', exact: true })).toBeVisible();
        await card.getByRole('button', { name: 'More actions for the comment by guest', exact: true }).click();
        await expect(page.getByRole('menuitem', { name: 'Mark as unread', exact: true })).toHaveCount(0);
        // Base UI dismisses on Escape once the menu has opened
        await animationsFinished(page.getByRole('menu'));
        await page.keyboard.press('Escape');
        await card.getByRole('button', { name: 'Unread. Mark as read', exact: true }).click();
        await expect(card.getByRole('button', { name: 'Unread. Mark as read', exact: true })).toHaveCount(0);
        const reviewUrl = `${site.origin()}/${projectId}/pricing`;
        await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(reviewUrl)}`);
        await expect(inbox(page)).toHaveAccessibleName('Inbox');
        await page.request.post(`/api/review/${projectId}/comments/${comment.id}/replies`, { headers, data: { text: 'A guest replied', authorName: 'Guest' } });
        await foreground(page);
        await expect(inbox(page)).toHaveAccessibleName('Inbox, 1 unread thread');
        // Shown again it is read again (beside the list as soon as the page shows it, on a phone once opened);
        // Only unread keeps it while it is open and leaves it out afterwards
        const read = page.waitForResponse(response => response.request().method() === 'POST' && Boolean(response.request().headers()['next-action']));
        await page.goto(`/app/projects/${projectId}?unread=true`);
        const reread = await openComment(page, 'Member inbox feedback');
        await expect(reread.getByRole('button', { name: 'Unread. Mark as read', exact: true })).toHaveCount(0);
        await read;
        await page.goto(`/app/projects/${projectId}?unread=true`);
        await expect(commentRowLink(page, 'Member inbox feedback')).toHaveCount(0);
        const secondSite = `${site.origin('second-site')}/${projectId}/pricing`;
        await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(secondSite)}`);
        await expect(inbox(page)).toHaveAccessibleName('Inbox');
        await page.reload();
        await expect(inbox(page)).toHaveAccessibleName('Inbox');
    } finally { await site.close(); }
});

test('app bulk read follows environment, page and people filters in list and board and offers retry', async ({ page, request, baseURL }, testInfo) => {
    test.setTimeout(90_000);
    // Bulk reads only: the thread shown beside the list stays unread
    await inBackground(page);
    const site = await startReviewedSite(new URL(baseURL!).origin);
    try {
        await signIn(page, uniqueEmail('bulk-owner'));
        const production = site.origin(), staging = site.origin('staging');
        const environment = encodeURIComponent(`origin:${production}`);
        const projectId = await createProject(page, { urls: [production, staging] });
        await setProjectAccess(page, projectId, 'Anyone with the link');
        const headers = await verifiedReviewHeaders(request, projectId, production);
        const stagingHeaders = await verifiedReviewHeaders(request, projectId, staging);
        const path = `/${projectId}/pricing`;
        let selectedId = '';
        for (const [originHeaders, pagePath, name] of [[headers, path, 'Selected'], [headers, path, 'Unassigned'],
            [headers, `/${projectId}/about`, 'Other page'], [stagingHeaders, path, 'Other environment']] as const) {
            const saved = await request.post(`/api/review/${projectId}/comments`, { headers: originHeaders, data: {
                path: pagePath, position: { type: 'page' }, kind: 'feedback', text: `${name} feedback`, authorName: name
            } });
            expect(saved.status()).toBe(201);
            if (name === 'Selected') selectedId = (await saved.json()).id;
        }
        await page.goto(`/app/projects/${projectId}`);
        const row = (name: string) => commentRowLink(page, `${name} feedback`);
        await (await openComment(page, 'Selected feedback')).getByRole('button', { name: 'Unassigned. Change assignee', exact: true }).click();
        const assignee = page.getByRole('menuitemcheckbox', { name: /^bulk-owner-/ });
        await assignee.click();
        await expect(assignee).toBeChecked();
        await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
        await expect(page.getByRole('button', { name: /^Assigned to you\. Change assignee$/ })).toBeVisible();
        const url = `/app/projects/${projectId}?unread=true&people=assigned&page=${encodeURIComponent(path)}&environment=${environment}`;
        await page.goto(url);
        await expect(commentRows(page)).toHaveCount(1);
        for (const colorScheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme });
            await expect(page.locator('html')).toHaveClass(new RegExp(colorScheme));
            await animationsFinished(page.locator('body'));
            await expectNoAxeViolations(page);
            await page.screenshot({ path: testInfo.outputPath(`bulk-app-${colorScheme}.png`) });
        }
        // A network failure leaves the thread unread and exposes an explicit toast retry.
        let fail = true;
        await page.route(`**/app/projects/${projectId}?*`, async route => {
            if (route.request().method() === 'POST' && fail) { fail = false; await route.abort(); }
            else await route.continue();
        });
        await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
        await expect(page.getByText('Some threads could not be marked as read.', { exact: true })).toBeVisible();
        await expect(row('Selected')).toBeVisible();
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect(row('Selected')).toHaveCount(0);
        await expect(page.getByText('1 thread marked as read.', { exact: true })).toBeVisible();
        await request.post(`/api/review/${projectId}/comments/${selectedId}/replies`, { headers, data: { text: 'New selected reply', authorName: 'Selected' } });
        await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${production}${path}`)}`);
        await inbox(page).click();
        const reviewInbox = page.getByRole('complementary', { name: 'Comments' });
        await reviewInbox.getByRole('button', { name: 'Assigned to me', exact: true }).click();
        await (await inboxSearch(reviewInbox)).fill('Selected');
        await expect(reviewInbox.getByRole('article')).toHaveCount(1);
        await reviewInbox.getByRole('button', { name: 'Mark all as read', exact: true }).click();
        // The toolbar defaults to all environments, so the staging thread counts here too.
        await expect(inbox(page)).toHaveAccessibleName('Inbox, 3 unread threads');
        await expect(reviewInbox.getByRole('button', { name: 'Mark all as read', exact: true })).toHaveCount(0);
        // Default views include all environments; select production for these scoped assertions.
        await page.goto(`/app/projects/${projectId}?unread=true&environment=${environment}`);
        await expect(commentRows(page)).toHaveCount(2);
        await expect(row('Unassigned')).toBeVisible();
        await expect(row('Other page')).toBeVisible();
        await page.goto(`/app/projects/${projectId}?unread=true&view=board&page=${encodeURIComponent(path)}&environment=${environment}`);
        await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
        await expect(allCommentRowLinks(page)).toHaveCount(0);
        await page.goto(`/app/projects/${projectId}?unread=true&environment=all`);
        await expect(commentRows(page)).toHaveCount(2);
        await expect(row('Other environment')).toBeVisible();
    } finally { await site.close(); }
});


type RefreshCounts = { identity: number; comments: number; activity: number };

// Count only background rounds: attach after initial loads and keep mutations/explicit returns
// outside the measured windows. The open inbox mounts both page and site-list queries.
function refreshCounter(page: Page, identityPath: string, commentsPath: string) {
    const counts: RefreshCounts = { identity: 0, comments: 0, activity: 0 };
    const pending = new Set<import('@playwright/test').Request>();
    page.on('request', request => {
        if (request.method() !== 'GET') return;
        const path = new URL(request.url()).pathname;
        const key = path === identityPath ? 'identity' : path === commentsPath ? 'comments'
            : path === `${commentsPath}/activity` ? 'activity' : undefined;
        if (key) { counts[key]++; pending.add(request); }
    });
    page.on('requestfinished', request => pending.delete(request));
    page.on('requestfailed', request => pending.delete(request));
    return { counts, async settle() {
        // Identity/content phases and observer notifications can start another request. Flush
        // their zero-delay tasks without advancing the observation window or sleeping in real time.
        for (let i = 0; i < 3; i++) {
            await expect.poll(() => pending.size).toBe(0);
            await page.clock.runFor(0);
        }
    } };
}

for (const mode of ['showcase', 'project'] as const) {
    test(`${mode} idle lifecycle coalesces held reads and preserves the open draft`, async ({ page, browser, baseURL }, testInfo) => {
        test.setTimeout(90_000);
        const reviewer = await newVisitor(browser, testInfo);
        const site = mode === 'project' ? await startReviewedSite(new URL(baseURL!).origin) : undefined;
        let release: (() => void) | undefined;
        try {
            const origin = isolatedOrigin(testInfo);
            let identityPath = '/api/visitor', commentsPath = '/api/comments', path = '/brand';
            let url = `${origin}/brand`, api = origin;
            let headers: Record<string, string> | undefined;
            if (site) {
                await signIn(page, uniqueEmail('poll-lifecycle'));
                const id = await createProject(page, { urls: [site.origin()] });
                await setProjectAccess(page, id, 'Anyone with the link');
                identityPath = `/api/review/${id}`;
                commentsPath = `${identityPath}/comments`;
                path = `/${id}/pricing`; api = baseURL!;
                url = `${site.origin()}${path}?toolbar-code=${id}`;
                headers = await verifiedReviewHeaders(page.request, id, site.origin());
            }
            const posted = await page.request.post(`${api}${commentsPath}`, { headers, data: {
                path, position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Idle thread', authorName: 'Author'
            } });
            expect(posted.status()).toBe(201);
            const comment = await posted.json();
            await reviewer.page.clock.install();
            await reviewer.page.goto(url);
            await expect(commentBubbles(reviewer.page)).toHaveCount(1);
            await commentBubbles(reviewer.page).click();
            const reply = openThread(reviewer.page).getByRole('textbox', { name: 'Reply', exact: true });
            await reply.fill('Keep my idle draft');
            await selectText(reply, 2, 7);
            await reviewer.page.clock.pauseAt(new Date(Date.now() + 1000));
            const counter = refreshCounter(reviewer.page, identityPath, commentsPath);
            const { counts } = counter;
            const advance = async (ms: number) => { await reviewer.page.clock.runFor(ms); await counter.settle(); };
            // Reach 30 seconds, then 60 seconds without dismissing or acknowledging this thread.
            for (let i = 0; i < 8; i++) await advance(15_000);
            let heldReads = 0;
            const gate = new Promise<void>(resolve => { release = resolve; });
            await reviewer.page.route(`**${commentsPath}?*`, async route => {
                heldReads++;
                if (heldReads > 1) { await route.continue(); return; }
                const response = await route.fetch();
                await gate;
                await route.fulfill({ response });
            });
            await reviewer.page.clock.runFor(60_000);
            await expect.poll(() => heldReads).toBe(1);
            const held = { ...counts };
            // No timer ticks accumulate while the first response is held for three minutes.
            await reviewer.page.clock.runFor(180_000);
            expect(counts).toEqual(held);
            const replied = await page.request.post(`${api}${commentsPath}/${comment.id}/replies`, { headers, data: { text: 'After the held snapshot', authorName: 'Author' } });
            expect(replied.status()).toBe(201);
            for (let i = 0; i < 3; i++) await foreground(reviewer.page);
            release!();
            await expect.poll(() => heldReads).toBe(2);
            await counter.settle();
            await advance(100);
            await expect(openThread(reviewer.page).getByText('After the held snapshot')).toBeVisible();
            expect(heldReads).toBe(2);
            await expect(reply).toHaveText('Keep my idle draft', { useInnerText: true });
            await expect(reply).toBeFocused();
            expect(await selectedText(reply)).toBe('ep my');
            await expect(inbox(reviewer.page)).toHaveAccessibleName('Inbox, 1 unread thread');
            await advance(14_000);
            expect(heldReads).toBe(2);
            await advance(1000);
            expect(heldReads).toBe(3);
            await reviewer.page.unroute(`**${commentsPath}?*`);
            for (const pause of ['hidden', 'offline', 'collapsed'] as const) {
                if (pause === 'hidden') await reviewer.page.evaluate(() => {
                    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
                    document.dispatchEvent(new Event('visibilitychange'));
                });
                else if (pause === 'offline') await reviewer.context.setOffline(true);
                else {
                    await reviewer.page.keyboard.press('Escape');
                    await toolbar(reviewer.page).getByRole('button', { name: 'Collapse toolbar' }).click();
                }
                await counter.settle();
                const paused = { ...counts };
                await advance(180_000);
                expect(counts).toEqual(paused);
                if (pause === 'hidden') await reviewer.page.evaluate(() => {
                    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
                    document.dispatchEvent(new Event('visibilitychange'));
                });
                else if (pause === 'offline') await reviewer.context.setOffline(false);
                else await reviewer.page.getByRole('button', { name: /^Expand toolbar/ }).click();
                await expect.poll(() => counts.activity).toBe(paused.activity + 1);
                await counter.settle();
                await advance(15_000);
                expect(counts.activity).toBe(paused.activity + 2);
            }
            await commentBubbles(reviewer.page).click();
            await reviewer.page.clock.runFor(200);
            await expect(reply).toHaveText('Keep my idle draft', { useInnerText: true });
            await expect(reply).toBeFocused();
        } finally { release?.(); await reviewer.context.close(); await site?.close(); }
    });

    test(`${mode} scheduled refresh request budget and bounded idle freshness`, async ({ page, browser, baseURL }, testInfo) => {
        test.setTimeout(90_000);
        const reviewer = await newVisitor(browser, testInfo);
        const site = mode === 'project' ? await startReviewedSite(new URL(baseURL!).origin) : undefined;
        try {
            const origin = isolatedOrigin(testInfo);
            let url = `${origin}/brand`;
            let identityPath = '/api/visitor', commentsPath = '/api/comments';
            let headers: Record<string, string> | undefined;
            let path = '/brand';
            if (site) {
                await signIn(page, uniqueEmail('poll-budget'));
                const id = await createProject(page, { urls: [site.origin()] });
                await setProjectAccess(page, id, 'Anyone with the link');
                path = `/${id}/pricing`;
                url = `${site.origin()}${path}?toolbar-code=${id}`;
                identityPath = `/api/review/${id}`;
                commentsPath = `${identityPath}/comments`;
                headers = await verifiedReviewHeaders(page.request, id, site.origin());
            }
            const counter = refreshCounter(reviewer.page, identityPath, commentsPath);
            await reviewer.page.clock.install();
            await reviewer.page.goto(url);
            await expect(toolbar(reviewer.page)).toBeVisible();
            await inbox(reviewer.page).click();
            await expect(reviewer.page.getByRole('complementary', { name: 'Comments' })).toBeVisible();
            await reviewer.page.clock.pauseAt(new Date(Date.now() + 1000));
            await counter.settle();
            const { counts } = counter;
            // Align the cadence after all initial loads; this explicit read is outside sampling.
            const initial = counts.activity;
            await foreground(reviewer.page);
            await expect.poll(() => counts.activity).toBe(initial + 1);
            await counter.settle();
            const search = reviewer.page.getByRole('complementary', { name: 'Comments' }).getByRole('button', { name: 'Search comments', exact: true });
            const sample = async (interact = false) => {
                const start = { ...counts };
                for (let i = 0; i < 8; i++) {
                    if (interact) await search.press('ArrowLeft');
                    await reviewer.page.clock.runFor(15_000);
                    await counter.settle();
                }
                return { identity: counts.identity - start.identity, comments: counts.comments - start.comments, activity: counts.activity - start.activity };
            };
            const active = await sample(true);
            expect(active).toEqual({ identity: 8, comments: 16, activity: 8 });
            await sample(); // Reach the healthy idle cap, outside the observation window.
            const idle = await sample();
            expect(idle).toEqual({ identity: 2, comments: 4, activity: 2 });
            await testInfo.attach(`${mode}-polling-counts`, { body: JSON.stringify({ windowSeconds: 120, active, idle,
                baseline: { identity: 8, comments: 16, activity: 8 }, reduction: '75%' }), contentType: 'application/json' });
            console.log(mode, 'scheduled refresh counts (120 seconds)', { active, idle });
            // Align with a completed idle round so the update exercises the full idle bound.
            const beforeAlignment = counts.activity;
            for (let i = 0; i < 4 && counts.activity === beforeAlignment; i++) {
                await reviewer.page.clock.runFor(15_000);
                await counter.settle();
            }
            expect(counts.activity).toBe(beforeAlignment + 1);
            // A change just after an idle read is discovered at the next 60-second deadline.
            const beforeRemote = counts.activity;
            const posted = await page.request.post(`${site ? baseURL : origin}${commentsPath}`, { headers, data: {
                path, position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }, text: 'Arrived during idle', authorName: 'Other reviewer'
            } });
            expect(posted.status()).toBe(201);
            await reviewer.page.clock.runFor(58_000);
            expect(counts.activity).toBe(beforeRemote);
            await expect(commentBubbles(reviewer.page)).toHaveCount(0);
            await reviewer.page.clock.runFor(2000);
            await counter.settle();
            await reviewer.page.clock.runFor(100);
            await expect(commentBubbles(reviewer.page)).toHaveCount(1);
            await expect(inbox(reviewer.page)).toHaveAccessibleName('Inbox, 1 unread thread');
            await counter.settle();
            const changed = counts.activity;
            await reviewer.page.clock.runFor(15_000);
            await expect.poll(() => counts.activity).toBe(changed + 1);
            await counter.settle();
            // An idle review interaction refreshes immediately; host-page movement does not.
            await sample();
            await reviewer.page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })));
            const beforeReturn = counts.activity;
            await search.press('ArrowLeft');
            await expect.poll(() => counts.activity).toBe(beforeReturn + 1);
            await counter.settle();
            await reviewer.page.clock.runFor(15_000);
            await expect.poll(() => counts.activity).toBe(beforeReturn + 2);
            await counter.settle();
            // Navigation disposes the old scheduler; one new context owns the next deadline.
            await reviewer.page.evaluate(() => history.pushState({}, '', `${location.pathname}/other-view`));
            await counter.settle();
            await reviewer.page.clock.runFor(1000);
            await expect(toolbar(reviewer.page)).toBeVisible();
            await counter.settle();
            await expect(commentBubbles(reviewer.page)).toHaveCount(0);
            const navigated = counts.identity;
            await reviewer.page.clock.runFor(15_000);
            await expect.poll(() => counts.identity).toBe(navigated + 1);
            await counter.settle();
            // Project exit unmounts the layer; showcase navigation above replaces its timers.
            if (!site) return;
            await toolbar(reviewer.page).getByRole('button', { name: 'Options', exact: true }).click();
            await reviewer.page.getByRole('button', { name: 'Exit review', exact: true }).click();
            await reviewer.page.clock.runFor(100);
            await expect(toolbar(reviewer.page)).toHaveCount(0);
            await counter.settle();
            const exited = { ...counts };
            await foreground(reviewer.page);
            await reviewer.page.clock.runFor(180_000);
            expect(counts).toEqual(exited);
        } finally { await reviewer.context.close(); await site?.close(); }
    });
}
