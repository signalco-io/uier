import { expect, test } from '@playwright/test';
import { assertAccessibility } from './accessibility';

const pairs = [
    { slug: 'bugherd', name: 'BugHerd', advantage: 'Custom Kanban columns' },
    { slug: 'marker-io', name: 'Marker.io', advantage: 'Scheduled monitoring' },
    { slug: 'usersnap', name: 'Usersnap', advantage: 'Surveys and voting boards' },
    { slug: 'pastel', name: 'Pastel', advantage: 'Multi-format canvases' }
];

for (const pair of pairs) {
    test(`${pair.name} comparison exposes tradeoffs, source links and a contained table`, async ({ page }, testInfo) => {
        const response = await page.goto(`/compare/${pair.slug}`);
        expect(response?.status()).toBe(200);
        const main = page.getByRole('main');
        await expect(main.getByRole('heading', { level: 1, name: `uier vs ${pair.name}` })).toBeVisible();
        await expect(main).toContainText('Written by uier.');
        const table = main.getByRole('table');
        await expect(table.getByRole('columnheader')).toHaveText(['Workflow or feature', 'uier', pair.name]);
        await expect(table.getByRole('row').filter({ hasText: pair.advantage })).toHaveCount(1);
        const recordingCell = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Screen and audio recording', exact: true }) }).getByRole('cell').first();
        await expect(recordingCell).toContainText('Short screen recordings');
        for (const gap of ['Session replay before a report', 'Console and network capture', 'File and design proofing', 'Surveys and request voting']) {
            const uierCell = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: gap, exact: true }) }).getByRole('cell').first();
            await expect(uierCell).toContainText('Not supported');
        }
        await expect(main.getByRole('region', { name: 'What changes if you switch' })).toContainText(`There is no built-in importer for ${pair.name}`);
        await expect(main.getByRole('region', { name: 'Sources and scope' }).getByRole('link').first()).toHaveAttribute('href', /^https:\/\/github.com\//);
        await expect(table.getByRole('link', { name: new RegExp(`^${pair.name.replace('.', '\\.')}: source`) }).first()).toHaveAttribute('href', /^https:\/\//);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(main.getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/app');
        await expect(main.getByRole('link', { name: 'Compare all five tools' })).toHaveAttribute('href', '/compare/website-feedback-tools');
        await main.getByRole('region', { name: 'Choose by the work you need to finish' }).screenshot({ path: testInfo.outputPath('workflow.png') });
    });
}

test('the full matrix retains caveats and source links behind keyboard disclosures', async ({ page }) => {
    await page.goto('/compare/website-feedback-tools');
    const main = page.getByRole('main');
    const table = main.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText(['Workflow or feature', 'uier', 'BugHerd', 'Marker.io', 'Usersnap', 'Pastel']);
    const row = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Screen and audio recording', exact: true }) });
    const usersnap = row.getByRole('cell').nth(3);
    await usersnap.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(usersnap.locator('details')).toHaveAttribute('open', '');
    await expect(usersnap).toContainText('Not supported in mobile web browsers or desktop Safari');
    await expect(usersnap.getByRole('link', { name: 'Usersnap: source for screen and audio recording' })).toHaveAttribute('href', 'https://help.usersnap.com/docs/feedback-with-a-screen-recording');
    const scrollingTable = main.getByRole('region', { name: 'Feature comparison table' });
    await scrollingTable.focus();
    await expect(scrollingTable).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(main).toContainText('Unknown is not a missing feature.');
    await expect(main).toContainText('uier supports short screen recordings with explicit permission.');
    await expect(main).toContainText('Built-in capture has no audio and ends on full-page navigation.');
});

test('the hub links every comparison and is linked from the public site', async ({ page }, testInfo) => {
    await page.goto('/compare');
    const main = page.getByRole('main');
    for (const pair of pairs)
        await expect(main.getByRole('link', { name: `uier vs ${pair.name}`, exact: true })).toHaveAttribute('href', `/compare/${pair.slug}`);
    await main.getByRole('region', { name: 'Start with the job' }).screenshot({ path: testInfo.outputPath('workflows.png') });
    await main.getByRole('link', { name: 'Compare all five tools' }).click();
    await expect(page).toHaveURL(/\/compare\/website-feedback-tools$/);
    await page.goto('/');
    await expect(page.getByRole('main').getByRole('link', { name: 'Compare website feedback tools' })).toHaveAttribute('href', '/compare');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Compare website feedback tools' })).toHaveAttribute('href', '/compare');
});

for (const path of ['/compare', '/compare/website-feedback-tools', ...pairs.map(pair => `/compare/${pair.slug}`)])
    test(`${path} is accessible`, ({ page }) => assertAccessibility(page, path));
