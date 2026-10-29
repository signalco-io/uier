import { expect, test } from '@playwright/test';
import { startReviewedSite } from './support/reviewedSite';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';

let site: Awaited<ReturnType<typeof startReviewedSite>>;
test.beforeAll(async ({ baseURL }) => { site = await startReviewedSite(new URL(baseURL!).origin); });
test.afterAll(async () => { await site.close(); });

test('authorized reviewer, project and canonical query/hash scopes survive SPA navigation and reload', async ({ page }) => {
    await signIn(page, uniqueEmail('durable-scope'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    const otherProject = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, otherProject, 'Anyone with the link');
    await page.goto(`/app/projects/${project}/settings`);
    const settings = page.getByRole('region', { name: 'Page state' });
    await settings.getByLabel('Meaningful query fields').fill('tab');
    await settings.getByLabel('Use hash routes (#/page or #!/page)').check();
    await settings.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('Saved.');
    const view = `/${project}/search?tab=a#/catalog`;
    await page.goto(`/app/review/${project}?url=${encodeURIComponent(`${site.origin()}${view}`)}`);
    const start = async () => {
        await page.getByRole('button', { name: 'Add comment', exact: true }).click();
        const h = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
        await page.mouse.click(h.x + 20, h.y + h.height / 2);
        return page.getByRole('dialog', { name: 'New comment', exact: true }).getByRole('textbox', { name: 'Comment', exact: true });
    };
    await (await start()).fill('Member view A');
    await page.evaluate(url => history.pushState(null, '', url), view.replace('tab=a', 'tab=b'));
    await expect(page.locator('[data-uier-comment="new"]')).toHaveCount(0);
    await (await start()).fill('Member view B');
    await page.reload();
    await page.getByRole('button', { name: 'New comment', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Member view B');
    await page.evaluate(url => history.replaceState(null, '', url), view);
    await page.getByRole('button', { name: 'New comment', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Member view A');
    await page.evaluate(url => history.replaceState(null, '', url), view.replace('#/catalog', '#!/details'));
    await expect(page.locator('[data-uier-comment="new"]')).toHaveCount(0);
    await page.goto(`${site.origin()}/${otherProject}/search?review=true&tab=a#/catalog`);
    await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    await expect(await start()).toHaveValue('');
    await page.goto(`${site.origin()}${view}`);
    await page.getByRole('button', { name: 'New comment', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Member view A');
    // Remove the authorized member token without signing out, to prove a guest cannot read member drafts.
    await page.evaluate(project => localStorage.removeItem(`uier:review-token:${project}`), project);
    await page.context().clearCookies({ name: '__Secure-uier_review_sso' });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    await expect(page.locator('[data-uier-comment="new"]')).toHaveCount(0);
    await expect(await start()).toHaveValue('');
});

test('a guest project review recovers lost create/reply responses across reload with one saved item', async ({ page, request }) => {
    await signIn(page, uniqueEmail('project-retry'));
    const project = await createProject(page, { urls: [site.origin()] });
    await setProjectAccess(page, project, 'Anyone with the link');
    // Project setup used the owner account; this scenario exercises a guest without background SSO.
    await page.context().clearCookies();
    const path = `/${project}/pricing`;
    await page.goto(`${site.origin()}${path}?review=true`);
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    await page.mouse.click(heading.x + 20, heading.y + heading.height / 2);
    const draft = page.getByRole('dialog', { name: 'New comment', exact: true });
    await draft.getByRole('textbox', { name: 'Your name' }).fill('Retry reviewer');
    await draft.getByRole('textbox', { name: 'Comment', exact: true }).fill('Guest feedback, once');
    const endpoint = `**/api/review/${project}/comments`;
    await page.route(endpoint, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        expect((await route.fetch()).status()).toBe(201);
        await route.abort('failed');
    });
    await draft.getByRole('button', { name: 'Post comment' }).click();
    await expect(draft.getByRole('alert')).toContainText('Check your connection');
    await page.reload();
    await page.getByRole('button', { name: 'New comment', exact: true }).click();
    await expect(draft.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Guest feedback, once');
    await page.unroute(endpoint);
    await draft.getByRole('button', { name: 'Post comment' }).click();
    const thread = page.getByRole('dialog', { name: 'Comment thread', exact: true });
    await expect(thread).toContainText('Guest feedback, once');
    const visitor = await page.evaluate(() => localStorage.getItem('uier:visitor'));
    const read = () => request.get(`/api/review/${project}/comments?path=${encodeURIComponent(path)}`, { headers: { Origin: site.origin(), 'X-Uier-Visitor': visitor! } });
    const comments = await (await read()).json();
    expect(comments).toHaveLength(1);
    await thread.getByRole('textbox', { name: 'Reply', exact: true }).fill('Guest reply, once');
    const replyEndpoint = `${endpoint}/${comments[0].id}/replies`;
    await page.route(replyEndpoint, async route => {
        expect((await route.fetch()).status()).toBe(201);
        await route.abort('failed');
    });
    await thread.getByRole('button', { name: 'Post reply' }).click();
    await expect(thread.getByRole('alert')).toContainText('Check your connection');
    await page.reload();
    await page.locator(`[data-uier-comment="${comments[0].id}"]`).click();
    await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toHaveValue('Guest reply, once');
    await page.unroute(replyEndpoint);
    await thread.getByRole('button', { name: 'Post reply' }).click();
    await expect(thread.getByRole('textbox', { name: 'Reply', exact: true })).toHaveValue('');
    // Sent in the background
    await expect.poll(async () => (await (await read()).json())[0].thread.items.length).toBe(2);
});
