import { expect, test } from '@playwright/test';
import { appNavigation, createProject, projectPublicId, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { startReviewedSite } from './support/reviewedSite';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test('public ids work in embeds, guest writes, verification and member review redirects', async ({ page, browser }) => {
    await signIn(page, uniqueEmail('public-ids'));
    const id = await createProject(page, { urls: [site.origin()], name: 'Public ids' });
    const publicId = await projectPublicId(page, id);
    expect(publicId).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(publicId).not.toBe(id);
    await expect(page.getByText(`data-uier-project="${publicId}"`).first()).toBeVisible();
    await setProjectAccess(page, id, 'Anyone with the link');
    await page.goto(`/app/projects/${id}`);
    await page.getByRole('button', { name: /^Anyone with the link/ }).click();
    await expect(page.getByRole('dialog', { name: 'Anyone with the link' }).locator('code')).toHaveText(`${site.origin()}/?toolbar-code=${publicId}`);
    const guest = await browser.newContext();
    try {
        const guestPage = await guest.newPage();
        await guestPage.goto(`${site.origin()}/${publicId}/pricing?toolbar-code=${publicId}`);
        await expect(guestPage.getByRole('button', { name: 'Add comment' })).toBeVisible();
        await guestPage.getByRole('button', { name: 'Add comment' }).click();
        const heading = await guestPage.getByRole('heading', { level: 1 }).boundingBox();
        await guestPage.mouse.click(heading!.x + 20, heading!.y + heading!.height / 2);
        await guestPage.getByRole('textbox', { name: 'Your name' }).fill('Guest');
        const createdResponse = guestPage.waitForResponse(response => response.url().endsWith(`/api/review/${publicId}/comments`) && response.request().method() === 'POST');
        const composer = guestPage.getByRole('textbox', { name: 'Comment', exact: true });
        await composer.fill('Feedback via public id');
        await composer.press('Enter');
        const created = await createdResponse;
        expect(created.status()).toBe(201);
        await page.reload();
        await expect(page.getByText('Feedback via public id', { exact: true })).toBeVisible();
        const target = `${site.origin()}/${publicId}/pricing`;
        await page.goto(`/app/review/${id}?url=${encodeURIComponent(target)}`);
        await expect(page).toHaveURL(`${target}?toolbar-code=${publicId}`);
        await expect(page.getByRole('button', { name: 'Add comment' })).toBeVisible();
    } finally { await guest.close(); }
});

test('the predictable showcase id cannot be used as a public review code', async ({ page }) => {
    await signIn(page, uniqueEmail('showcase-public-id'));
    await page.goto('/app/projects');
    await appNavigation(page);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await page.getByRole('menuitem', { name: /uier.*Commenter/ }).click();
    await expect(page.getByRole('list', { name: 'Active projects' }).getByRole('link', { name: 'uier.io public feedback' })).toBeVisible();
    await page.goto('/app/projects/uier00000001/install');
    const script = await page.getByText('/toolbar.js" data-uier-project=').first().textContent();
    const publicId = /data-uier-project="([A-Za-z0-9_-]{21})"/.exec(script ?? '')?.[1];
    expect(publicId).toBeTruthy();
    expect((await page.request.get('/api/review/uier00000001')).status()).toBe(404);
    expect((await page.request.get('/api/review/uier00000001/comments?path=/')).status()).toBe(404);
    const info = await page.request.get(`/api/review/${publicId}`);
    expect(info.status()).toBe(200);
    expect((await info.json()).project.id).toBe(publicId);
    await page.reload();
    await expect(page.getByText(`data-uier-project="${publicId}"`).first()).toBeVisible();
});
