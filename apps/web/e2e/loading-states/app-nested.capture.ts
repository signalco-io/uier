import { expect, test } from '@playwright/test';
import { createProject, signIn, uniqueEmail } from '../support/app';
import { Capture, settled } from './capture';

// A fallback nested inside a page's own data: the lock cannot hold it, so this capture needs a build in which the
// section is slowed down (a temporary, uncommitted delay in `ProjectUsageSection`). Skipped when the page is not slow,
// and then the capture of an earlier run is kept.
test('nested fallback: project settings usage', async ({ page }, info) => {
    const capture = new Capture(info, 'app-nested');
    try {
        await signIn(page, uniqueEmail('nested'));
        const project = await createProject(page, { urls: ['https://nested.example.com'], name: 'Shop', clientName: 'Acme' });
        await page.goto(`/app/projects/${project}/settings`, { waitUntil: 'commit' });
        const status = page.getByRole('status', { name: 'Loading usage', exact: true });
        const shown = await status.waitFor({ state: 'visible', timeout: 6_000 }).then(() => true, () => false);
        test.skip(!shown, 'The usage section is not slowed down in this build');
        await expect(page.getByLabel('Project name', { exact: true })).toBeVisible();
        await status.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        const recorded = await capture.record(page, { id: 'state-settings-usage', surface: 'app', group: 'Inside a loaded page', trigger: 'in-page',
            title: 'Project settings: Usage section loading (AppPageLoading)', route: `/app/projects/${project}/settings`,
            note: 'A second generic skeleton (a title and two cards, pulsing) under the loaded General form; the section it stands for is one titled card.' });
        await expect(status).toBeHidden({ timeout: 20_000 });
        await settled(page);
        await page.getByRole('region', { name: 'Usage', exact: true }).scrollIntoViewIfNeeded().catch(() => {});
        recorded.loaded = await capture.shot(page, 'state-settings-usage--loaded');
    } finally {
        if (capture.entries.length) capture.save();
    }
});
