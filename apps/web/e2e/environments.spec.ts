import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createProject, hydrated, setProjectAccess, signIn, uniqueEmail, commentRows, openComment, openCommentFilters } from './support/app';
import { startReviewedSite } from './support/reviewedSite';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { chooseInboxPages, commentBubbles, inboxPages } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test('environment labels, isolation, alias sharing, history, direct links and persistent filters', async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await signIn(page, uniqueEmail('environments'));
    const production = site.origin('production'), staging = site.origin('staging'), alias = site.origin('alias');
    const projectId = await createProject(page, { urls: [production, staging, alias], name: 'Environment review' });
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const path = `/${projectId}/same`;
    const ids: string[] = [];
    for (const [origin, text] of [[production, 'Production feedback'], [staging, 'Staging feedback'], [alias, 'Alias feedback']]) {
        const headers = await verifiedReviewHeaders(request, projectId, origin!, randomBytes(32).toString('base64url'));
        const response = await request.post(`/api/review/${projectId}/comments`, { headers, data: {
            path, text, authorName: 'Reviewer', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 }
        } });
        expect(response.status()).toBe(201); ids.push((await response.json()).id);
    }
    const settingsUrl = `/app/projects/${projectId}/settings/environments`;
    await page.goto(settingsUrl);
    // One table: each address with its label and the addresses it shares feedback with
    const settings = page.getByRole('region', { name: 'Site addresses', exact: true });
    const host = (origin: string) => origin.replace(/^https?:\/\//, '');
    await expect(settings.getByLabel('Main site address')).toHaveValue(host(production));
    await hydrated(settings.locator('form'));
    await settings.getByLabel(`Label for ${host(production)}`, { exact: true }).fill('Production');
    await settings.getByLabel(`Label for ${host(staging)}`, { exact: true }).fill('Staging');
    await settings.getByLabel(`Label for ${host(alias)}`, { exact: true }).fill('Live alias');
    await settings.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('Saved.');
    await page.reload();
    await expect(settings.getByLabel(`Label for ${host(staging)}`, { exact: true })).toHaveValue('Staging');
    await expect(settings.getByRole('combobox', { name: `${host(alias)} shares feedback with`, exact: true })).toContainText('No other address');
    await expectNoAxeViolations(page);
    await page.goto(`/app/projects/${projectId}`);
    // One control for where, in Filter: the environment, then the page
    const where = (await openCommentFilters(page)).getByRole('button', { name: /^Environment and page:/ });
    await expect(where).toContainText('All environments and pages');
    await expect(commentRows(page)).toHaveCount(3);
    await where.click();
    // Options that match no comments are hidden; long paths show in full on hover
    const environmentGroup = page.getByRole('group', { name: 'Environment' });
    await expect(environmentGroup.getByRole('button', { name: 'All environments', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(environmentGroup.getByRole('button', { name: 'Removed addresses', exact: true })).toHaveCount(0);
    await expect(environmentGroup.getByRole('button', { name: 'Source not recorded', exact: true })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Pages' }).getByRole('button', { name: new RegExp(`^${path}`) })).toHaveAttribute('title', path);
    await environmentGroup.getByRole('button', { name: 'Production', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(commentRows(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Clear environment filter: Production', exact: true })).toBeVisible();
    await page.reload();
    await expect(commentRows(page)).toHaveCount(1);
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${production}${path}`)}`);
    await expect(commentBubbles(page)).toHaveCount(1);
    await page.getByRole('button', { name: /^Inbox/ }).click();
    const inbox = page.getByRole('complementary', { name: 'Comments', exact: true });
    await expect(inbox).toContainText('Reviewing Production');
    // All environments, not the reviewed one: like the app's filter, the picker names only a chosen environment
    await expect(inboxPages(page)).toHaveAccessibleName('Environment and page: This page');
    await expect(inbox.getByRole('region', { name: 'This page', exact: true }).getByRole('article')).toHaveCount(1);
    await chooseInboxPages(page, /^All pages/);
    await expect(inbox.getByRole('article')).toHaveCount(3);
    const foreign = inbox.getByRole('article').filter({ hasText: 'Staging feedback' });
    await expect(foreign.getByRole('button', { name: 'Show on page' })).toHaveCount(0);
    await expect(foreign.locator('[data-uier-anchor-state]')).toHaveCount(0);
    await expect(foreign.getByRole('button', { name: 'Reattach comment' })).toHaveCount(0);
    await foreign.getByRole('button', { name: 'Reply', exact: true }).click();
    await foreign.getByRole('textbox', { name: 'Reply', exact: true }).fill('Reply across environments');
    await foreign.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(foreign.getByText('Reply across environments', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp('production\\.localhost'));
    const href = await foreign.getByRole('link').getAttribute('href');
    expect(new URL(href!).origin).toBe(staging);
    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expectNoAxeViolations(page);
        const screenshot = testInfo.outputPath(`environment-inbox-${colorScheme}.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(`environment-inbox-${colorScheme}`, { path: screenshot, contentType: 'image/png' });
    }
    await inboxPages(page).click();
    await page.getByRole('dialog', { name: 'Environment and page' }).getByRole('group', { name: 'Environment' })
        .getByRole('button', { name: 'Production', exact: true }).click();
    await page.reload();
    await expect(commentBubbles(page)).toHaveCount(1);
    await page.getByRole('button', { name: /^Inbox/ }).click();
    await expect(inboxPages(page)).toContainText('Production');
    await expect(inbox.getByRole('article')).toHaveCount(1);
    await chooseInboxPages(page, /^All pages/);
    await expect(inbox.getByRole('article')).toHaveCount(1);
    await page.goto(href!);
    await expect(page).toHaveURL(new RegExp('staging\\.localhost'));
    await expect(page.getByRole('dialog').filter({ hasText: 'Staging feedback' })).toBeVisible();

    await page.goto(settingsUrl);
    await hydrated(settings.locator('form'));
    await settings.getByRole('combobox', { name: `${host(alias)} shares feedback with`, exact: true }).click();
    await page.getByRole('option', { name: host(production), exact: true }).click();
    // Sharing goes both ways
    await expect(settings.getByRole('combobox', { name: `${host(production)} shares feedback with`, exact: true })).toContainText(host(alias));
    await settings.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('Saved.');
    await page.reload();
    await expect(settings.getByRole('combobox', { name: `${host(alias)} shares feedback with`, exact: true })).toContainText(host(production));
    await expect(settings.getByRole('combobox', { name: `${host(staging)} shares feedback with`, exact: true })).toContainText('No other address');
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${production}${path}`)}`);
    await expect(commentBubbles(page)).toHaveCount(2);
    await page.getByRole('button', { name: /^Inbox/ }).click();
    const aliasCard = inbox.getByRole('article').filter({ hasText: 'Alias feedback' });
    await expect(aliasCard.getByRole('button', { name: 'Reattach comment' })).toHaveCount(0);
    await expect(aliasCard).toContainText('Open the original reviewed site to reattach.');
    // App redirect uses the recorded staging source, even if a different allowed URL was supplied.
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${production}/wrong`)}&comment=${ids[1]}`);
    await expect(page).toHaveURL(new RegExp(`staging\\.localhost.*${path}`));
    await page.goto(settingsUrl);
    await hydrated(settings.locator('form'));
    await settings.getByRole('button', { name: 'Remove address 2', exact: true }).click();
    await expect(settings.getByLabel(`Label for ${host(staging)}`, { exact: true })).toHaveCount(0);
    await settings.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('Saved.');
    await expect(settings.getByRole('combobox', { name: `${host(alias)} shares feedback with`, exact: true })).toContainText(host(production));
    await page.goto(`/app/projects/${projectId}`);
    await (await openCommentFilters(page)).getByRole('button', { name: /^Environment and page:/ }).click();
    await expect(page.getByRole('group', { name: 'Environment' }).getByRole('button', { name: 'Removed addresses', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Environment' }).getByRole('button', { name: 'Source not recorded', exact: true })).toHaveCount(0);
    await page.goto(`/app/projects/${projectId}?environment=removed`);
    await expect(commentRows(page)).toHaveCount(1);
    const history = await openComment(page, 'Staging feedback');
    await expect(history).toContainText('Removed address');
    await expect(history.getByRole('link')).toHaveCount(0);
    await history.getByRole('button', { name: 'Reply', exact: true }).click();
    await history.getByRole('textbox', { name: 'Reply', exact: true }).fill('Reply after the source was removed');
    await history.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(history.getByText('Reply after the source was removed', { exact: true })).toBeVisible();
    await expect(history.getByRole('link')).toHaveCount(0);
    await page.goto(`/app/review/${projectId}?url=${encodeURIComponent(`${production}${path}`)}`);
    await page.getByRole('button', { name: /^Inbox/ }).click();
    await inboxPages(page).click();
    const location = page.getByRole('dialog', { name: 'Environment and page' });
    await location.getByRole('group', { name: 'Environment' }).getByRole('button', { name: 'All environments', exact: true }).click();
    await location.getByRole('group', { name: 'Pages' }).getByRole('button', { name: /^All pages/ }).click();
    const removed = inbox.getByRole('article').filter({ hasText: 'Staging feedback' });
    await expect(removed).toContainText('Original source unavailable');
    await expect(removed.getByRole('link')).toHaveCount(0);
    await removed.getByRole('button', { name: 'Reply', exact: true }).click();
    await removed.getByRole('textbox', { name: 'Reply', exact: true }).fill('Inbox reply without a source');
    await removed.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(removed.getByText('Inbox reply without a source', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp('production\\.localhost'));
    const gone = await page.goto(`/app/review/${projectId}?comment=${ids[1]}`);
    expect(gone!.status()).toBe(404); await expect(page.locator('body')).toContainText('original site address may have been removed');
    const deniedOrigin = await request.get(`/api/review/${projectId}/comments?scope=site&environment=all`, { headers: { origin: staging } });
    expect(deniedOrigin.status()).toBe(403);
    await setProjectAccess(page, projectId, 'Invited people');
    const deniedGuest = await request.get(`/api/review/${projectId}/comments?scope=site&environment=all`, { headers: { origin: production } });
    expect(deniedGuest.status()).toBe(401);
});


test('same-origin posting and default filters retain a secondary API origin', async ({ page, request, baseURL }) => {
    await signIn(page, uniqueEmail('same-origin-environment'));
    const own = new URL(baseURL!).origin;
    const production = site.origin('production');
    const projectId = await createProject(page, { urls: [production, own] });
    await setProjectAccess(page, projectId, 'Anyone with the link');
    const path = `/${projectId}/same`;
    const data = { path, text: 'Same path in two environments', authorName: 'Reviewer', position: { type: 'point', selector: 'h1', xNormal: 0.5, yNormal: 0.5 } };
    const foreign = await request.post(`/api/review/${projectId}/comments`, { headers: await verifiedReviewHeaders(request, projectId, production), data });
    expect(foreign.status()).toBe(201);
    const headers = { 'X-Uier-Visitor': randomBytes(32).toString('base64url') };
    const saved = await request.post(`/api/review/${projectId}/comments`, { headers, data });
    expect(saved.status()).toBe(201);
    expect((await saved.json()).source.origin).toBe(own);
    const list = await request.get(`/api/review/${projectId}/comments?scope=site`, { headers });
    const comments = await list.json();
    expect(comments).toHaveLength(1); expect(comments[0].source.origin).toBe(own);
    const activity = await request.get(`/api/review/${projectId}/comments/activity`, { headers });
    expect(await activity.json()).toMatchObject({ total: 1 });
});
