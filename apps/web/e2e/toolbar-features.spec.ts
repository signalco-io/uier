import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './accessibility';
import { createProject, hydrated, openProjectInvite, projectPublicId, signIn, uniqueEmail } from './support/app';
import { auditAssetPath } from './support/auditRuns';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';
import { animationsFinished, newVisitor, selectText, selectionToolbar, toolbar } from './support/toolbar';

test.use({ actionTimeout: 15_000 });
let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });
const review = (page: Page) => page.getByRole('region', { name: 'Review', exact: true });
const projectTools = (page: Page) => review(page).getByRole('group', { name: 'Project tools', exact: true });
const guestTools = (page: Page) => review(page).getByRole('group', { name: 'Signed-out reviewers', exact: true });
async function settings(page: Page, project: string) {
    await page.goto(`/app/projects/${project}/settings/review`);
    await hydrated(review(page).locator('form'));
}
async function save(page: Page) {
    const request = page.waitForRequest(req => req.method() === 'POST' && Boolean(req.headers()['next-action']));
    await review(page).getByRole('button', { name: 'Save', exact: true }).click();
    const action = await request;
    await expect(review(page).getByRole('status').filter({ hasText: 'Saved.' })).toContainText('Saved.');
    await expect(review(page).getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    return action;
}
async function openChecks(page: Page, mobile: boolean, name: RegExp) {
    if (mobile) await toolbar(page).getByRole('button', { name: 'Options', exact: true }).click();
    const scope = mobile ? page.getByRole('dialog', { name: 'Options', exact: true }) : toolbar(page);
    await scope.getByRole('button', { name }).click();
}
async function hasTools(page: Page, mobile: boolean, accessibility: boolean, seo: boolean) {
    await expect(toolbar(page)).toBeVisible();
    if (mobile) await toolbar(page).getByRole('button', { name: 'Options', exact: true }).click();
    const scope = mobile ? page.getByRole('dialog', { name: 'Options', exact: true }) : toolbar(page);
    await expect(scope.getByRole('button', { name: /^Accessibility/ })).toHaveCount(accessibility ? 1 : 0);
    await expect(scope.getByRole('button', { name: /^SEO/ })).toHaveCount(seo ? 1 : 0);
    if (mobile) {
        await animationsFinished(scope);
        await page.keyboard.press('Escape');
        await expect(scope).toBeHidden();
    }
}

test('admins save, discard and reset tool lists; commenters and signed-out callers cannot change them', async ({ page, browser }) => {
    test.setTimeout(90_000);
    await signIn(page, uniqueEmail('tool-settings'));
    const origin = new URL(page.url()).origin;
    const project = await createProject(page, { urls: [site.origin()], name: 'Toolbar tools' });
    await settings(page, project);
    const all = projectTools(page).getByRole('checkbox', { name: 'Show all current and future tools', exact: true });
    await expect(all).toBeChecked();
    await expect(guestTools(page)).toHaveCount(0);
    await all.uncheck();
    await projectTools(page).getByRole('checkbox', { name: 'SEO', exact: true }).uncheck();
    await review(page).getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(all).toBeChecked();
    await all.uncheck();
    await projectTools(page).getByRole('checkbox', { name: 'SEO', exact: true }).uncheck();
    const action = await save(page);
    await page.reload();
    await hydrated(review(page).locator('form'));
    await expect(all).not.toBeChecked();
    await expect(projectTools(page).getByRole('checkbox', { name: 'SEO', exact: true })).not.toBeChecked();
    await expect(projectTools(page).getByRole('checkbox', { name: 'Accessibility', exact: true })).toBeChecked();
    await expectNoAxeViolations(page, { include: ['#review'] });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Invalid values reject the whole save and leave the previous configuration in place.
    const invalid = action.postData()!.replace('accessibility', 'unknown-tool');
    expect(invalid).not.toBe(action.postData());
    const replay = (context: BrowserContext, body = action.postDataBuffer()!) => context.request.post(action.url(), {
        headers: { 'Next-Action': action.headers()['next-action']!, 'Content-Type': action.headers()['content-type']!, Origin: origin },
        data: body, maxRedirects: 0
    });
    expect(await (await replay(page.context(), Buffer.from(invalid))).text()).toContain('Invalid');
    await settings(page, project);
    await expect(projectTools(page).getByRole('checkbox', { name: 'SEO', exact: true })).not.toBeChecked();
    await all.check();
    await save(page);
    await page.reload();
    await expect(all).toBeChecked();

    await page.goto(`/app/projects/${project}`);
    await openProjectInvite(page, 'Invited people');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email').fill(uniqueEmail('tool-commenter'));
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    const invitation = await dialog.getByRole('link', { name: 'Open the invitation link' }).getAttribute('href');
    const other = await browser.newContext();
    try {
        const member = await other.newPage();
        await member.goto(invitation!);
        await member.getByRole('button', { name: 'Accept invitation' }).click();
        const publicId = await projectPublicId(page, project);
        await member.waitForURL(url => url.searchParams.get('toolbar-code') === publicId);
        expect(await (await replay(other)).text()).toContain('Only admins can do this.');
        await other.clearCookies();
        expect((await replay(other)).status()).toBe(307);
    } finally { await other.close(); }
});

test('guest tools can be hidden while members keep them and guests still leave feedback and use the inbox', async ({ page, browser }, testInfo) => {
    test.setTimeout(90_000);
    const mobile = testInfo.project.use.isMobile === true;
    await signIn(page, uniqueEmail('guest-tools'));
    const project = await createProject(page, { urls: [site.origin()] });
    await settings(page, project);
    await review(page).getByRole('radio', { name: 'Anyone with the link', exact: true }).check();
    await guestTools(page).getByRole('checkbox', { name: 'Follow project tools', exact: true }).uncheck();
    for (const feature of ['Accessibility', 'SEO', 'Text rewrites']) await guestTools(page).getByRole('checkbox', { name: feature, exact: true }).uncheck();
    await save(page);
    const destination = `${site.origin()}/${project}/pricing?page-checks`;
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(destination)}`);
    await hasTools(page, mobile, true, true);
    const seed = await page.request.post(`/api/review/${project}/comments`, {
        headers: await verifiedReviewHeaders(page.request, project, site.origin()),
        data: { path: new URL(destination).pathname, position: { type: 'page' }, kind: 'feedback',
            text: 'Existing accessibility finding', authorName: 'Earlier reviewer', check: { type: 'accessibility', id: 'image-alt' } }
    });
    expect(seed.status()).toBe(201);
    const guest = await newVisitor(browser, testInfo);
    try {
        const audit = await auditAssetPath();
        const auditRequests: string[] = [];
        guest.page.on('request', request => { if (new URL(request.url()).pathname === audit) auditRequests.push(request.url()); });
        const infoPromise = guest.page.waitForResponse(response => /\/api\/review\/[^/]+$/.test(new URL(response.url()).pathname));
        await guest.page.goto(`${destination}&review=true`);
        const info = await (await infoPromise).json();
        expect(info).toMatchObject({ canComment: true, project: { toolbarFeatures: [] }, viewer: { kind: 'guest' } });
        await hasTools(guest.page, mobile, false, false);
        await selectText(guest.page, await guest.page.getByRole('heading', { level: 1 }).innerText());
        await expect(selectionToolbar(guest.page).getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
        await expect(selectionToolbar(guest.page).getByRole('button', { name: 'Rewrite', exact: true })).toHaveCount(0);
        await toolbar(guest.page).getByRole('button', { name: 'Send feedback', exact: true }).click();
        const form = guest.page.getByRole('dialog', { name: 'Send feedback', exact: true });
        await form.getByRole('textbox', { name: 'Your name', exact: true }).fill('Guest reviewer');
        await form.getByRole('textbox', { name: 'Feedback', exact: true }).fill('Feedback stays available with tools hidden');
        const posted = guest.page.waitForResponse(response => response.request().method() === 'POST' && /\/comments$/.test(new URL(response.url()).pathname));
        await form.getByRole('button', { name: 'Send feedback', exact: true }).click();
        expect((await posted).status()).toBe(201);
        await expect(form).toBeHidden();
        await toolbar(guest.page).getByRole('button', { name: /^Inbox/ }).click();
        await expect(guest.page.getByRole('complementary', { name: 'Comments', exact: true })).toContainText('Feedback stays available');
        await expect(guest.page.getByRole('complementary', { name: 'Comments', exact: true })).toContainText('Existing accessibility finding');
        await expect(guest.page.locator('[data-uier-recheck]')).toHaveCount(0);
        // This journey gives background checks ample time to run if they were accidentally left enabled.
        expect(auditRequests).toEqual([]);
    } finally { await guest.context.close(); }
});

test('custom project tools apply to mobile options, selection actions and remembered panels', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const mobile = testInfo.project.use.isMobile === true;
    await signIn(page, uniqueEmail('restored-tools'));
    const appOrigin = new URL(page.url()).origin;
    const project = await createProject(page, { urls: [site.origin()] });
    const destination = `${site.origin()}/${project}/pricing?page-checks`;
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(destination)}`);
    await hasTools(page, mobile, true, true);
    await openChecks(page, mobile, /^SEO/);
    await expect(page.getByRole('complementary', { name: 'SEO', exact: true })).toBeVisible();
    const settingsPage = await page.context().newPage();
    try {
        await settingsPage.goto(`${appOrigin}/app/projects/${project}/settings/review`);
        await hydrated(review(settingsPage).locator('form'));
        await projectTools(settingsPage).getByRole('checkbox', { name: 'Show all current and future tools', exact: true }).uncheck();
        for (const feature of ['SEO', 'Text rewrites']) await projectTools(settingsPage).getByRole('checkbox', { name: feature, exact: true }).uncheck();
        await save(settingsPage);
    } finally { await settingsPage.close(); }
    await page.reload();
    await hasTools(page, mobile, true, false);
    await expect(page.getByRole('complementary', { name: 'SEO', exact: true })).toHaveCount(0);
    await selectText(page, await page.getByRole('heading', { level: 1 }).innerText());
    await expect(selectionToolbar(page).getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    await expect(selectionToolbar(page).getByRole('button', { name: 'Rewrite', exact: true })).toHaveCount(0);
    await openChecks(page, mobile, /^Accessibility/);
    await expect(page.getByRole('complementary', { name: 'Accessibility', exact: true })).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
});
