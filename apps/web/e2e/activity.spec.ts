import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { addToolbarScript, isolatedOrigin, newVisitor, animationsFinished, commentBubbles, openThread, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';

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

test('true unread activity is per reviewer and survives reading, resolution, reload and other pages', async ({ browser }, testInfo) => {
    const origin = isolatedOrigin(testInfo);
    const first = await newVisitor(browser, testInfo);
    const second = await newVisitor(browser, testInfo);
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
        await second.page.getByRole('button', { name: 'Unread 1', exact: true }).click();
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
        await first.page.getByRole('button', { name: 'Unread 1', exact: true }).click();
        const done = first.page.getByRole('article', { name: `Comment #${comment.number}` });
        await expect(done).toContainText('Done');
        await expect(done).toContainText('Second reviewer reply');
        await done.getByRole('button', { name: 'Mark as read' }).click();
        await expect(inbox(first.page)).toHaveAccessibleName('Inbox');
        await first.page.getByRole('button', { name: 'Close sidebar' }).click();
        await expect(first.page.getByRole('complementary', { name: 'Comments' })).toBeHidden();
        await inbox(first.page).click();
        await expect(first.page.getByRole('button', { name: 'Unread 0', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await first.page.reload();
        await expect(inbox(first.page)).toHaveAccessibleName('Inbox');
        const other = await second.context.request.post(`${origin}/api/comments`, { data: {
            path: '/security', kind: 'feedback', position: { type: 'page' }, text: 'Feedback on another page'
        } });
        const otherComment = await other.json();
        await foreground(first.page);
        await expect(inbox(first.page)).toHaveAccessibleName('Inbox, 1 unread thread');
        await inbox(first.page).click();
        await first.page.getByRole('button', { name: 'Unread 1', exact: true }).click();
        const otherGroup = first.page.getByRole('region', { name: 'Other pages' });
        await expect(otherGroup.getByRole('article', { name: `Comment #${otherComment.number}` })).toContainText('Feedback on another page');
        await expectNoAxeViolations(first.page);
        await first.page.getByRole('button', { name: 'Close sidebar' }).click();
        await first.page.goto(`${origin}/security?review=true`);
        await addToolbarScript(first.page);
        await expect(inbox(first.page)).toHaveAccessibleName('Inbox, 1 unread thread');
    } finally {
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
        await expect(reply).toHaveValue('Keep this draft');
        await expect(reply).toBeFocused();
        expect(reads).toBeGreaterThan(0);
        // A remote resolve must not dismiss the reply being written.
        await first.context.request.patch(`${origin}/api/comments/${comment.id}`, { data: { resolved: true } });
        await foreground(first.page);
        await expect(openThread(first.page)).toContainText('Done');
        await expect(reply).toHaveValue('Keep this draft');
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
        await expect(reply).toHaveValue('Keep this draft');
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
        await reader.page.route('**/api/comments/activity', route => route.fulfill({ json: { unread: 205, open: 205, done: 0, total: 205 } }));
        await reader.page.reload();
        await expect(inbox(reader.page)).toHaveAccessibleName('Inbox, 99+ unread threads, 205 in total');
        const highCountAudit = await new AxeBuilder({ page: reader.page }).include('#uier-toolbar').analyze();
        expect(highCountAudit.violations).toEqual([]);
    } finally { await author.context.close(); await reader.context.close(); }
});

test('a review losing access removes cached comments and annotations immediately on foreground refresh', async ({ page, browser, baseURL }, testInfo) => {
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
        await guest.page.goto(`${site.origin()}/${projectId}/pricing?toolbar-code=${projectId}`);
        await expect(commentBubbles(guest.page)).toHaveCount(1);
        await inbox(guest.page).click();
        await expect(guest.page.getByText('Visible only while access remains')).toBeVisible();
        await setProjectAccess(page, projectId, 'Invited people');
        await foreground(guest.page);
        await expect(toolbar(guest.page)).toContainText('Sign in to see and leave comments.');
        await expect(commentBubbles(guest.page)).toHaveCount(0);
        await expect(guest.page.getByText('Visible only while access remains')).toHaveCount(0);
    } finally { await guest.context.close(); await site.close(); }
});

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
        const card = page.getByRole('article', { name: 'Comment by Guest' });
        await expect(card.getByRole('button', { name: 'Mark as read' })).toBeVisible();
        await card.getByRole('button', { name: 'Mark as read' }).click();
        await expect(card.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
        const reviewUrl = `${site.origin()}/${projectId}/pricing`;
        await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(reviewUrl)}`);
        await expect(inbox(page)).toHaveAccessibleName('Inbox');
        await page.request.post(`/api/review/${projectId}/comments/${comment.id}/replies`, { headers, data: { text: 'A guest replied', authorName: 'Guest' } });
        await foreground(page);
        await expect(inbox(page)).toHaveAccessibleName('Inbox, 1 unread thread');
        await page.goto(`/app/projects/${projectId}?unread=true`);
        await card.getByRole('button', { name: 'Mark as read' }).click();
        await expect(card).toHaveCount(0);
        const secondSite = `${site.origin('second-site')}/${projectId}/pricing`;
        await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(secondSite)}`);
        await expect(inbox(page)).toHaveAccessibleName('Inbox');
        await page.reload();
        await expect(inbox(page)).toHaveAccessibleName('Inbox');
    } finally { await site.close(); }
});
