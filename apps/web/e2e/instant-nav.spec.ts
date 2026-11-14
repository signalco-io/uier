import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { instant } from '@next/playwright';
import { appNavigation, createProject, hydrated, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

async function capture(page: Page, info: TestInfo, name: string) {
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await info.attach(name, { path, contentType: 'image/png' });
}

for (const populated of [false, true]) {
    const variant = populated ? 'populated workspace' : 'empty workspace';

    test(`Projects → Create project: ${variant}`, async ({ page }, info) => {
        test.setTimeout(60_000);
        await signIn(page, uniqueEmail('instant-new'));
        if (populated) await createProject(page, {
            urls: ['https://instant.example.com'], name: 'Existing project', clientName: 'Existing client',
        });
        await page.goto('/app/projects');
        const link = page.getByRole('link', { name: 'Create project', exact: true }).filter({ visible: true }).first();
        await hydrated(link);
        await instant(page, async () => {
            await link.click();
            await expect(page).toHaveURL(/\/app\/projects\/new$/);
            await capture(page, info, 'locked');
            await expect(page.getByTestId('new-project-heading')).toBeVisible();
            await expect(page.getByRole('list', { name: 'Onboarding progress' })).toBeVisible();
            await expect(page.getByRole('status', { name: 'Loading new', exact: true })).toBeVisible();
            await expect(page.getByLabel('Main site address')).toHaveCount(0);
            await expect(page.getByText('Tell uier which site you want to review. Then add the script and invite a reviewer.', { exact: true })).toBeVisible();
            await expect(page.getByRole('list', { name: 'Onboarding progress' }).getByRole('listitem')).toHaveCount(4);
        });
        await expect(page.getByLabel('Main site address')).toBeVisible();
        await expect(page.getByLabel('Project name', { exact: true })).toBeVisible();
        if (populated) {
            const client = page.getByLabel('Client name (optional)');
            await client.fill('Existing');
            await expect(page.getByRole('option', { name: 'Existing client' })).toBeVisible();
            await client.press('Escape');
        }
        await capture(page, info, 'completed');
    });

    test(`Projects → Account: ${variant}`, async ({ page }, info) => {
        test.setTimeout(60_000);
        const email = uniqueEmail('instant-account');
        await signIn(page, email);
        if (populated) await createProject(page, { urls: ['https://instant.example.com'], name: 'Existing project' });
        await page.goto('/app/projects');
        await appNavigation(page);
        const account = page.getByRole('button', { name: /^Account:/ });
        await hydrated(account);
        await account.click();
        const link = page.getByRole('menuitem', { name: 'Account', exact: true });
        await expect(link).toBeVisible();
        await instant(page, async () => {
            await link.click();
            await expect(page).toHaveURL(/\/app\/account$/);
            await capture(page, info, 'locked');
            await expect(page.getByTestId('account-heading')).toBeVisible();
            const sections = page.getByRole('navigation', { name: 'Account', exact: true });
            await expect(sections).toBeVisible();
            await expect(sections.getByRole('link')).toHaveText(['General', 'Sign-in', 'Notifications', 'Usage', 'Coding agents']);
            await expect(page.getByRole('status', { name: 'Loading account', exact: true })).toBeVisible();
            await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0);
            await expect(page.getByRole('main').getByText(email, { exact: true })).toHaveCount(0);
            await sections.getByRole('link', { name: 'General', exact: true }).focus();
        });
        await expect(page.getByRole('navigation', { name: 'Account', exact: true }).getByRole('link', { name: 'General', exact: true })).toBeFocused();
        await expect(page.getByRole('main').getByText(email, { exact: true })).toBeVisible();
        await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Your workspace access', exact: true }))
            .toContainText(populated ? 'Existing project' : 'None yet');
        await capture(page, info, 'completed');
    });
}

test('Status initial load already provides its useful shell', async ({ page, baseURL }, info) => {
    await instant(page, async () => {
        await page.goto('/status', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { level: 1, name: 'Status', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'How this works', exact: true })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Checking services…' })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Loading service checks…' })).toBeVisible();
        await expect(page.locator('time')).toHaveCount(0);
        await expect(page.locator('[data-state="operational"]')).toHaveCount(0);
        await capture(page, info, 'locked');
    }, { baseURL });
    await expect(page.locator('time')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'All services are operational.' })).toBeVisible();
});

test('A project\'s Comments and Page checks tabs load as wide as they will be, shaped like each page', async ({ page, request, baseURL }, info) => {
    test.setTimeout(60_000);
    const site = await startReviewedSite(new URL(baseURL!).origin);
    try {
        await signIn(page, uniqueEmail('instant-tabs'));
        const project = await createProject(page, { urls: [site.origin()], name: 'Shop' });
        await setProjectAccess(page, project, 'Anyone with the link');
        const response = await request.post(`/api/review/${project}/comments`, { headers: await verifiedReviewHeaders(request, project, site.origin()), data: {
            path: `/${project}/pricing`, text: 'Checkout total is wrong', authorName: 'Guest', position: { type: 'page' }, kind: 'feedback'
        } });
        expect(response.status()).toBe(201);
        const header = page.locator('main [data-header-wide]').filter({ visible: true }).first();
        const title = page.getByRole('heading', { level: 1, name: 'Shop', exact: true });
        const width = async () => ({ header: (await header.boundingBox())!.width, title: (await title.boundingBox())!.x });

        // From another of the project's pages, so neither tab has been shown (and kept) before
        await page.goto(`/app/projects/${project}/install`);
        const comments = page.getByRole('link', { name: 'Comments', exact: true });
        await hydrated(comments);
        let loading!: Awaited<ReturnType<typeof width>>;
        await instant(page, async () => {
            await comments.click();
            const status = page.getByRole('status', { name: 'Loading project', exact: true });
            await expect(status).toBeVisible();
            // The search row, the status tabs and the list, before any comment is shown
            await expect(page.getByRole('searchbox')).toHaveCount(0);
            await capture(page, info, 'comments-loading');
            loading = await width();
        });
        await expect(page.getByRole('list', { name: 'Comments', exact: true })).toBeVisible();
        await capture(page, info, 'comments-loaded');
        // As wide as the loaded comments, and the project's name stays where it was
        const loaded = await width();
        expect(Math.abs(loading.header - loaded.header)).toBeLessThanOrEqual(1);
        expect(Math.abs(loading.title - loaded.title)).toBeLessThanOrEqual(1);

        // Board remembered loads as a board (uier #362): the columns' skeleton under the search row, which is drawn
        // (search, Filter and List/Board with Board pressed) but inert and hidden from assistive tech, without the list's
        // status tabs; as wide as the loaded board, from the left (uier #363)
        await page.context().addCookies([{ name: 'uier_comments_view', value: 'board', url: page.url() }]);
        await page.goto(`/app/projects/${project}/install`);
        await hydrated(comments);
        await instant(page, async () => {
            await comments.click();
            const skeleton = page.locator('[data-comments-loading]').filter({ visible: true });
            await expect(skeleton).toHaveAttribute('data-comments-loading', 'board');
            await expect(skeleton.getByPlaceholder('Search feedback')).toBeVisible();
            await expect(skeleton.locator('[inert] button[aria-label="Filter"]')).toBeVisible();
            await expect(skeleton.locator('[data-pressed]')).toHaveCount(1);
            await expect(page.getByRole('searchbox')).toHaveCount(0);
            await capture(page, info, 'board-loading');
            loading = await width();
        });
        await expect(page.getByRole('region', { name: 'Open comments', exact: true })).toBeVisible();
        const boardLoaded = await width();
        expect(Math.abs(loading.title - boardLoaded.title)).toBeLessThanOrEqual(1);
        expect(Math.abs(loading.header - boardLoaded.header)).toBeLessThanOrEqual(1);

        const checks = page.getByRole('link', { name: 'Page checks', exact: true });
        await hydrated(checks);
        await instant(page, async () => {
            await checks.click();
            await expect(page.getByRole('status', { name: 'Loading page checks', exact: true })).toBeVisible();
            await capture(page, info, 'page-checks-loading');
            loading = await width();
        });
        await expect(page.getByRole('region', { name: 'Page checks', exact: true })).toBeVisible();
        const checked = await width();
        expect(Math.abs(loading.header - checked.header)).toBeLessThanOrEqual(1);
        expect(Math.abs(loading.title - checked.title)).toBeLessThanOrEqual(1);
    } finally { await site.close(); }
});
