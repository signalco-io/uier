import { expect, test } from '@playwright/test';
import { assertAccessibility } from './accessibility';

const pairs = [
    { slug: 'bugherd', name: 'BugHerd', advantage: 'Custom Kanban columns', checked: '2026-11-11', logo: '/compare/bugherd.png' },
    { slug: 'marker-io', name: 'Marker.io', advantage: 'Scheduled monitoring', checked: '2026-11-11', logo: '/compare/marker-io.svg' },
    { slug: 'usersnap', name: 'Usersnap', advantage: 'Surveys and voting boards', checked: '2026-11-11', logo: '/compare/usersnap.png' },
    { slug: 'pastel', name: 'Pastel', advantage: 'Multi-format canvases', checked: '2026-11-11', logo: '/compare/pastel.png' },
    { slug: 'userback', name: 'Userback', advantage: 'Feedback and full-session replay', checked: '2026-11-15', logo: '/compare/userback.png' },
    { slug: 'ruttl', name: 'ruttl', advantage: 'Custom Kanban lists', checked: '2026-11-15', logo: '/compare/ruttl.png' }
];

for (const pair of pairs) {
    test(`${pair.name} comparison exposes tradeoffs, source links and a contained table`, async ({ page }, testInfo) => {
        const response = await page.goto(`/compare/${pair.slug}`);
        expect(response?.status()).toBe(200);
        const main = page.getByRole('main');
        await expect(main.getByRole('heading', { level: 1, name: `uier vs ${pair.name}` })).toBeVisible();
        // The cover: uier's mark and the alternative's official logo, decorative, each with its name under it
        const cover = main.getByRole('list', { name: 'Compared tools', exact: true });
        await expect(cover.getByRole('listitem')).toHaveText(['uier', pair.name]);
        const logo = cover.locator(`img[src="${pair.logo}"][alt=""][aria-hidden="true"]`);
        await expect(logo).toHaveCount(1);
        await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
        await expect(main.getByRole('region', { name: 'Sources and scope' })).toContainText('Written by uier.');
        const table = main.getByRole('table');
        await expect(table.getByRole('columnheader')).toHaveText(['Workflow or feature', 'uier', pair.name]);
        await expect(table.getByRole('row').filter({ hasText: pair.advantage })).toHaveCount(1);
        const workflowCell = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Organizing the work', exact: true }) }).getByRole('cell').first();
        await expect(workflowCell).toContainText('Custom statuses and labels');
        await expect(workflowCell).toContainText('paged results');
        await expect(workflowCell).toContainText('at most 50');
        await expect(main).not.toContainText('no custom statuses');
        await expect(main).not.toContainText('1,000 recent');
        const recordingCell = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Screen and audio recording', exact: true }) }).getByRole('cell').first();
        await expect(recordingCell).toContainText('Available: Short screen recordings');
        for (const gap of ['Session replay before a report', 'Console and network capture', 'File and design proofing', 'Surveys and request voting']) {
            const uierCell = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: gap, exact: true }) }).getByRole('cell').first();
            await expect(uierCell).toContainText('Not supported');
        }
        await expect(main.getByRole('region', { name: 'What changes if you switch' })).toContainText(`There is no built-in importer for ${pair.name}`);
        await expect(main.getByRole('region', { name: 'Sources and scope' }).getByRole('link').first()).toHaveAttribute('href', /^https:\/\/github.com\//);
        const vendorSources = main.getByRole('region', { name: 'Sources and scope' }).getByRole('heading', { name: pair.name, exact: true }).locator('..');
        await expect(vendorSources.locator(':scope > p time')).toHaveAttribute('datetime', pair.checked);
        await expect(vendorSources.locator('li time').first()).toHaveAttribute('datetime', '2026-11-19');
        await expect(table.getByRole('link', { name: new RegExp(`^${pair.name.replace('.', '\\.')}: source`) }).first()).toHaveAttribute('href', /^https:\/\//);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(main.getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/app');
        await expect(main.getByRole('link', { name: 'Compare all seven tools' })).toHaveAttribute('href', '/compare/website-feedback-tools');
        await expect(main.getByRole('link', { name: 'MCP setup guide' })).toHaveAttribute('href', '/guides/mcp');
        await main.getByRole('region', { name: 'Choose by the work you need to finish' }).screenshot({ path: testInfo.outputPath('workflow.png') });
    });
}

test('the full matrix retains caveats and source links behind keyboard disclosures', async ({ page }) => {
    await page.goto('/compare/website-feedback-tools');
    const main = page.getByRole('main');
    const table = main.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText(['Workflow or feature', 'uier', 'BugHerd', 'Marker.io', 'Usersnap', 'Pastel', 'Userback', 'ruttl']);
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

test('CSS and text details show the documented workflow and sources for each tool', async ({ page }) => {
    await page.goto('/compare/website-feedback-tools');
    const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Demonstrating CSS and text changes', exact: true }) });
    const sources = page.getByRole('region', { name: 'Sources and scope' });
    const claims = [
        ['Available: On-page text and style previews', /one eligible element.*Original and Proposed.*exact values.*source/, '/features/pinned-comments#preview-a-change'],
        ['Has limits: Text replacement in a pinned task', /pinned task saves both the original and the replacement.*previews.*unverified/, 'https://bugherd.com/feature/suggest-text-edits'],
        ['Not verified: On-page edits not verified', /annotating a captured screenshot.*previews are unverified/, 'https://marker.io/website-design-feedback'],
        ['Not verified: On-page edits not verified', /highlight, pen, arrow, comment and hide.*previews are unverified/, 'https://help.usersnap.com/docs/feedback-with-a-screenshot'],
        ['Has limits: Text previews in a website canvas', /Before and After on the canvas.*copy the edited text.*CSS previews are unverified/, 'https://help.usepastel.com/en/articles/5063677-editing-text-in-a-canvas'],
        ['Not verified: On-page edits not verified', /boxes, arrows, text and pinned comments.*previews are unverified/, 'https://userback.io/feature/screen-annotation/'],
        ['Available: CSS and text in website projects', /edit mode is unavailable in web app projects/, 'https://www.ruttl.com/blog/marker-io-alternatives-best-web-annotation-bug-reporting-tools']
    ] as const;
    for (const [index, [label, detail, url]] of claims.entries()) {
        const cell = row.getByRole('cell').nth(index);
        await expect(cell).toContainText(label);
        await cell.locator('summary').click();
        await expect(cell.locator('details')).toHaveAttribute('open', '');
        await expect(cell.locator('details p').first()).toHaveText(detail);
        await expect(cell.locator(`a[href="${url}"]`)).toBeVisible();
        await expect(sources.locator('li').filter({ has: page.locator(`a[href="${url}"]`) }).locator('time')).toHaveAttribute('datetime', '2026-11-19');
    }
    const faq = 'https://www.ruttl.com/features/review-web-applications';
    await expect(row.getByRole('link', { name: 'Web application FAQ' })).toHaveAttribute('href', faq);
    await expect(sources.locator('li').filter({ has: page.locator(`a[href="${faq}"]`) }).locator('time')).toHaveAttribute('datetime', '2026-11-19');
});

test('the hub links every comparison and is linked from the public site', async ({ page }, testInfo) => {
    await page.goto('/compare');
    const main = page.getByRole('main');
    await expect(main).not.toContainText('Written by uier.');
    await expect(main.getByRole('region', { name: 'Start with the job' })).toContainText('Preview proposed text and style changes on the page');
    const preview = main.getByRole('link', { name: 'on-page previews' });
    await expect(preview).toHaveAttribute('href', '/features/pinned-comments#preview-a-change');
    await preview.click();
    const help = page.getByRole('region', { name: 'Preview text and style changes' });
    await expect(help).toBeVisible();
    await expect(help).toContainText('Suggest a change');
    await expect(help).toContainText('implement the change in the site’s source');
    await page.goto('/compare');
    for (const pair of pairs)
        await expect(main.getByRole('link', { name: `uier vs ${pair.name}`, exact: true })).toHaveAttribute('href', `/compare/${pair.slug}`);
    await main.getByRole('region', { name: 'Start with the job' }).screenshot({ path: testInfo.outputPath('workflows.png') });
    await main.getByRole('link', { name: 'Compare all seven tools' }).click();
    await expect(page).toHaveURL(/\/compare\/website-feedback-tools$/);
    await page.goto('/');
    await expect(page.getByRole('main').getByRole('link', { name: 'Compare website feedback tools' })).toHaveAttribute('href', '/compare');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Compare website feedback tools' })).toHaveAttribute('href', '/compare');
});

test('new comparisons retain distinct examples, current billing caveats and shared MCP limits', async ({ page }) => {
    await page.goto('/compare/userback');
    let main = page.getByRole('main');
    await expect(main.getByRole('region', { name: 'A checkout report needs reproduction evidence' })).toContainText('changing the collection time clears the basket');
    await expect(main.getByRole('region', { name: 'Setup, integrations and cost' })).toContainText('seven days');
    await expect(main.getByRole('region', { name: 'Sources and scope' })).toContainText('does not automatically fix code');
    await expect(main.getByRole('link', { name: 'manual acceptance review' })).toHaveAttribute('href', '/use-cases/user-acceptance-testing');

    await page.goto('/compare/ruttl');
    main = page.getByRole('main');
    const layout = main.getByRole('region', { name: 'A client wants to show a layout change' });
    await expect(layout).toContainText('separate PDF menu');
    await expect(layout).toContainText('choose Suggest a change');
    await expect(layout).toContainText('side padding');
    await expect(main.getByRole('region', { name: 'What changes if you switch' })).toContainText('single element');
    await expect(main.getByRole('region', { name: 'Setup, integrations and cost' })).toContainText('Cards and the detailed table differ');
    const checks = main.getByRole('table').getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Accessibility and SEO checks', exact: true }) }).getByRole('cell').last();
    await expect(checks).toContainText('Not verified');
    await expect(checks).toContainText('coming soon');
    await expect(main.getByRole('link', { name: 'client website feedback' })).toHaveAttribute('href', '/use-cases/client-feedback');
});

for (const path of ['/compare', '/compare/website-feedback-tools', ...pairs.map(pair => `/compare/${pair.slug}`)])
    test(`${path} is accessible`, ({ page }) => assertAccessibility(page, path));
